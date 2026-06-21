import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Composition, TrackDef, audioAssetKey, normalizeComposition } from "./composition";
import { newId } from "./id";
import { ArtistIdentity, slugifyArtist } from "./artist";
import { storedAsset } from "./assetStorage";
import {
  creatorAssetReferences,
  getStoredCreatorAssets,
  registerCreatorAssets,
  rewriteCreatorAssetUrls,
  type CreatorAsset,
} from "./creatorAssets";

// Cloud sharing via Supabase: stems go to a public Storage bucket, the manifest
// (with stems rewritten to public CDN URLs) goes to a Postgres row owned by the
// signed-in user. No custom server — the frontend uses the public anon key plus
// the user's session JWT, gated by RLS.

const URL_ENV = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const KEY_ENV = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSharingConfigured = Boolean(URL_ENV && KEY_ENV);

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!isSharingConfigured) throw new Error("Sharing isn't configured (missing Supabase env vars).");
  if (!client) client = createClient(URL_ENV!, KEY_ENV!);
  return client;
}

const BUCKET = "stems";
const TABLE = "compositions";
const ARTISTS_TABLE = "artists";
const CREATOR_ASSETS_TABLE = "creator_assets";
// Bucket name predates the pack removal; creator assets still publish here.
const ENVIRONMENT_ASSET_BUCKET = "environment-assets";
const isUploaded = (url: string) => url.startsWith("blob:");
export const normalizePublishedTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase() || "untitled";
export const publishedStemAssetKey = (track: Pick<TrackDef, "id" | "audioAssetId">): string => audioAssetKey(track);

// SHA-256 of a blob's bytes, as hex — used to detect when a stem's audio changed.
async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Text(value: string): Promise<string> {
  return sha256(new Blob([value], { type: "text/plain" }));
}

// ===== Auth (email magic link) =====

export interface AuthUser {
  id: string;
  email: string | null;
}

export async function signInWithEmail(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!isSharingConfigured) return null;
  const { data } = await supabase().auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email ?? null } : null;
}

// Subscribe to auth changes; returns an unsubscribe function.
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  if (!isSharingConfigured) return () => {};
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    const u = session?.user;
    cb(u ? { id: u.id, email: u.email ?? null } : null);
  });
  return () => data.subscription.unsubscribe();
}

// ===== Publish / fetch / manage =====

interface ArtistRow {
  id: string;
  name: string;
  slug: string;
  avatar_url?: string | null;
  avatar_email_hash?: string | null;
}

function toArtistIdentity(row: ArtistRow): ArtistIdentity {
  return {
    artistId: row.id,
    artist: row.name,
    artistSlug: row.slug,
    artistAvatarUrl: row.avatar_url ?? undefined,
    artistAvatarEmailHash: row.avatar_email_hash ?? undefined,
  };
}

export async function getAccountArtist(): Promise<ArtistIdentity | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase()
    .from(ARTISTS_TABLE)
    .select("id, name, slug, avatar_url, avatar_email_hash")
    .eq("owner", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ? toArtistIdentity(data[0] as ArtistRow) : null;
}

export async function ensureArtistForCurrentUser(name: string): Promise<ArtistIdentity> {
  const sb = supabase();
  const user = await getCurrentUser();
  if (!user) throw new Error("Please sign in to publish.");
  const artist = name.trim() || "Unknown";

  const { data: existing, error: existingError } = await sb
    .from(ARTISTS_TABLE)
    .select("id, name, slug, avatar_url, avatar_email_hash")
    .eq("owner", user.id)
    .eq("name", artist)
    .limit(1);
  if (existingError) throw existingError;
  if (existing?.[0]) return toArtistIdentity(existing[0] as ArtistRow);

  const base = slugifyArtist(artist);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await sb
      .from(ARTISTS_TABLE)
      .insert({ owner: user.id, name: artist, slug })
      .select("id, name, slug, avatar_url, avatar_email_hash")
      .single();
    if (!error) return toArtistIdentity(data as ArtistRow);
    if (error.code !== "23505") throw error;
  }
  throw new Error("Couldn't create a unique artist slug.");
}

async function assertUniqueTitleForArtist(artistId: string, title: string, publishedId: string): Promise<void> {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("id")
    .eq("artist_id", artistId)
    .eq("title_key", normalizePublishedTitle(title))
    .neq("id", publishedId)
    .limit(1);
  if (error) throw error;
  if ((data ?? []).length) throw new Error(`"${title}" is already published for this artist.`);
}

export interface PublishResult extends ArtistIdentity {
  id: string;
}

export interface PublishProgress {
  completed: number;
  total: number;
  label: string;
}

interface CompositionRow {
  id: string;
  manifest: Composition;
  owner: string;
  artist_id: string | undefined;
  title: string;
  title_key: string;
  artist: string;
  artist_slug: string | undefined;
  artist_avatar_url: string | null;
  artist_avatar_email_hash: string | null;
}

export function buildPublishedCompositionRow(args: {
  comp: Composition;
  tracks: Composition["tracks"];
  id: string;
  userId: string;
  artist: ArtistIdentity;
  title: string;
}): CompositionRow {
  const { comp, tracks, id, userId, artist, title } = args;
  const manifest: Composition = normalizeComposition({ ...comp, ...artist, title, tracks, publishedId: id });
  return {
    id,
    manifest,
    owner: userId,
    artist_id: artist.artistId,
    title,
    title_key: normalizePublishedTitle(title),
    artist: artist.artist,
    artist_slug: artist.artistSlug,
    artist_avatar_url: artist.artistAvatarUrl ?? null,
    artist_avatar_email_hash: artist.artistAvatarEmailHash ?? null,
  };
}

// Publish (or re-publish) a composition (requires sign-in). Uploads uploaded
// stems to Storage, rewrites their URLs to public CDN URLs, and upserts the
// manifest as a row owned by the current user. Reuses the composition's existing
// publishedId so re-publishing keeps the same stable link.
export async function publishComposition(
  comp: Composition,
  onProgress?: (progress: PublishProgress) => void,
  { force = false }: { force?: boolean } = {},
): Promise<PublishResult> {
  const sb = supabase();
  const user = await getCurrentUser();
  if (!user) throw new Error("Please sign in to publish.");
  const id = comp.publishedId ?? newId();
  const artist = (await getAccountArtist()) ?? (await ensureArtistForCurrentUser(comp.artist));
  const title = comp.title.trim() || "Untitled";
  await assertUniqueTitleForArtist(artist.artistId!, title, id);

  // Prior published manifest, to skip re-uploading stems whose audio is unchanged.
  const prev = comp.publishedId ? await fetchPublishedComposition(id) : null;
  const prevHash: Record<string, string | undefined> = {};
  for (const t of prev?.tracks ?? []) prevHash[publishedStemAssetKey(t)] = t.hash;

  const total = comp.tracks.length + 3;
  let completed = 0;
  const report = (label: string, advance = false) => {
    if (advance) completed++;
    onProgress?.({ completed, total, label });
  };

  const tracks = [];
  const publishedAssets = new Map<string, { url: string; hash: string }>();
  for (const t of comp.tracks) {
    report(`Preparing ${t.name}`);
    if (t.source.kind === "file" && isUploaded(t.source.url)) {
      const assetId = publishedStemAssetKey(t);
      let published = publishedAssets.get(assetId);
      if (!published) {
        const blob = await (await fetch(t.source.url)).blob();
        const hash = await sha256(blob);
        const path = `${id}/${assetId}`;
        const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

        // Only upload if new, the audio changed, or a force re-upload was requested.
        if (force || prevHash[assetId] !== hash) {
          const { error } = await sb.storage
            .from(BUCKET)
            .upload(path, blob, { contentType: blob.type || "audio/mpeg", upsert: true, cacheControl: "31536000" });
          if (error) throw error;
        }
        published = { url, hash };
        publishedAssets.set(assetId, published);
      }
      tracks.push({
        ...t,
        audioAssetId: assetId,
        source: { kind: "file" as const, url: published.url },
        hash: published.hash,
      });
    } else {
      tracks.push(t); // built-in /stems URL or synth — leave as-is
    }
    report(`Prepared ${t.name}`, true);
  }

  report("Publishing creator assets");
  const creatorEnvironment = await publishCreatorAssets(comp, user.id);
  report("Published creator assets", true);
  const publishedComposition = creatorEnvironment
    ? { ...comp, environment: creatorEnvironment }
    : comp;

  // title/artist are denormalized columns (for the gallery); manifest stays canonical.
  report("Saving composition");
  const { error } = await sb.from(TABLE).upsert(
    buildPublishedCompositionRow({
      comp: publishedComposition,
      tracks,
      id,
      userId: user.id,
      artist,
      title,
    }),
  );
  if (error) throw error;
  report("Published", true);
  return { id, ...artist };
}

// Fetch a published composition's manifest by share id (null if not found).
export async function fetchPublishedComposition(id: string): Promise<Composition | null> {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("manifest, artist, artist_id, artist_slug, artist_avatar_url, artist_avatar_email_hash")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.manifest) return null;
  const composition = normalizeComposition({
    ...(data.manifest as Composition),
    artist: data.artist ?? (data.manifest as Composition).artist,
    artistId: data.artist_id ?? (data.manifest as Composition).artistId,
    artistSlug: data.artist_slug ?? (data.manifest as Composition).artistSlug,
    artistAvatarUrl: data.artist_avatar_url ?? (data.manifest as Composition).artistAvatarUrl,
    artistAvatarEmailHash: data.artist_avatar_email_hash ?? (data.manifest as Composition).artistAvatarEmailHash,
  });
  const creatorIds = environmentCreatorAssetIds(composition);
  if (creatorIds.length) {
    const { data: creatorAssets, error: creatorError } = await supabase()
      .from(CREATOR_ASSETS_TABLE)
      .select("manifest")
      .in("id", creatorIds);
    if (creatorError) throw creatorError;
    registerCreatorAssets(
      (creatorAssets ?? []).flatMap((row) => row.manifest ? [row.manifest as CreatorAsset] : []),
    );
  }
  return composition;
}

async function publishCreatorAssets(
  comp: Composition,
  userId: string,
): Promise<Composition["environment"] | undefined> {
  const ids = environmentCreatorAssetIds(comp);
  if (!ids.length) return undefined;
  const stored = await getStoredCreatorAssets();
  const catalog = new Map(stored.map((asset) => [asset.id, asset]));
  const remoteIds = new Map<string, string>();
  for (const id of ids) {
    const asset = catalog.get(id);
    if (!asset) continue;
    const version = (await sha256Text(`${userId}:${id}:${JSON.stringify(asset)}`)).slice(0, 32);
    const remoteId = `asset-${version}`;
    const urls = new Map<string, string>();
    for (const reference of [...new Set(creatorAssetReferences(asset))]) {
      if (!reference.startsWith("asset:")) continue;
      const hash = reference.slice("asset:".length);
      const entry = await storedAsset(hash);
      if (!entry) throw new Error(`Creator asset ${hash} is missing from local storage.`);
      const safeName = (entry.name || "asset").replace(/[^\w.-]+/g, "_");
      const path = `${userId}/${remoteId}/${hash}/${safeName}`;
      const bucket = supabase().storage.from(ENVIRONMENT_ASSET_BUCKET);
      const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
      const { error } = await bucket.upload(path, entry.blob, {
        contentType: entry.type || entry.blob.type || "application/octet-stream",
        upsert: true,
        cacheControl: "31536000",
      });
      if (error) throw error;
      urls.set(reference, publicUrl);
    }
    const manifest = rewriteCreatorAssetUrls(
      { ...asset, id: remoteId },
      (url) => urls.get(url) ?? url,
    );
    const { error } = await supabase()
      .from(CREATOR_ASSETS_TABLE)
      .upsert({ id: remoteId, owner: userId, manifest });
    if (error) throw error;
    remoteIds.set(id, remoteId);
  }
  if (!remoteIds.size) return undefined;
  return {
    ...comp.environment,
    ...(comp.environment.surfaces ? {
      surfaces: Object.fromEntries(
        Object.entries(comp.environment.surfaces).map(([surface, id]) => [
          surface,
          remoteIds.get(id) ?? id,
        ]),
      ),
    } : {}),
    ...(comp.environment.landmarks ? {
      landmarks: comp.environment.landmarks.map((landmark) => ({
        ...landmark,
        assetId: remoteIds.get(landmark.assetId) ?? landmark.assetId,
      })),
    } : {}),
  };
}

function environmentCreatorAssetIds(comp: Composition): string[] {
  return [...new Set([
    ...Object.values(comp.environment.surfaces ?? {}).filter((id): id is string => !!id),
    ...(comp.environment.landmarks ?? []).map((landmark) => landmark.assetId),
  ])];
}

export interface GallerySummary {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artistSlug?: string;
  artistAvatarUrl?: string;
  artistAvatarEmailHash?: string;
  createdAt: string;
}

function toGallerySummary(r: any): GallerySummary {
  return {
    id: r.id,
    title: r.title ?? "Untitled",
    artist: r.artist ?? "Unknown",
    artistId: r.artist_id ?? undefined,
    artistSlug: r.artist_slug ?? undefined,
    artistAvatarUrl: r.artist_avatar_url ?? undefined,
    artistAvatarEmailHash: r.artist_avatar_email_hash ?? undefined,
    createdAt: r.created_at,
  };
}

// The most recently published compositions, for the public gallery.
export async function listRecent(limit = 50): Promise<GallerySummary[]> {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("id, title, artist, artist_id, artist_slug, artist_avatar_url, artist_avatar_email_hash, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toGallerySummary);
}

// Published compositions for one artist slug, newest first.
export async function listByArtistSlug(slug: string, limit = 50): Promise<GallerySummary[]> {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("id, title, artist, artist_id, artist_slug, artist_avatar_url, artist_avatar_email_hash, created_at")
    .eq("artist_slug", slug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toGallerySummary);
}

// Unpublish: remove the row and its stored stems (owner-gated by RLS).
export async function unpublish(id: string): Promise<void> {
  const sb = supabase();
  const { data: files } = await sb.storage.from(BUCKET).list(id);
  if (files?.length) {
    await sb.storage.from(BUCKET).remove(files.map((f) => `${id}/${f.name}`));
  }
  const { error } = await sb.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}
