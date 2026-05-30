import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Composition } from "./composition";
import { newId } from "./id";

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
const isUploaded = (url: string) => url.startsWith("blob:");

// SHA-256 of a blob's bytes, as hex — used to detect when a stem's audio changed.
async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

// Publish (or re-publish) a composition (requires sign-in). Uploads uploaded
// stems to Storage, rewrites their URLs to public CDN URLs, and upserts the
// manifest as a row owned by the current user. Reuses the composition's existing
// publishedId so re-publishing keeps the same stable link.
export async function publishComposition(comp: Composition): Promise<string> {
  const sb = supabase();
  const user = await getCurrentUser();
  if (!user) throw new Error("Please sign in to publish.");
  const id = comp.publishedId ?? newId();

  // Prior published manifest, to skip re-uploading stems whose audio is unchanged.
  const prev = comp.publishedId ? await fetchPublishedComposition(id) : null;
  const prevHash: Record<string, string | undefined> = {};
  for (const t of prev?.tracks ?? []) prevHash[t.id] = t.hash;

  const tracks = [];
  for (const t of comp.tracks) {
    if (t.source.kind === "file" && isUploaded(t.source.url)) {
      const blob = await (await fetch(t.source.url)).blob();
      const hash = await sha256(blob);
      const path = `${id}/${t.id}`;
      const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; // deterministic from the path

      // Only upload if new or the audio changed since last publish.
      if (prevHash[t.id] !== hash) {
        const { error } = await sb.storage
          .from(BUCKET)
          .upload(path, blob, { contentType: blob.type || "audio/mpeg", upsert: true });
        if (error) throw error;
      }
      tracks.push({ ...t, source: { kind: "file" as const, url }, hash });
    } else {
      tracks.push(t); // built-in /stems URL or synth — leave as-is
    }
  }

  const manifest: Composition = { ...comp, tracks, publishedId: id };
  // title/artist are denormalized columns (for the gallery); manifest stays canonical.
  const { error } = await sb.from(TABLE).upsert({ id, manifest, owner: user.id, title: comp.title, artist: comp.artist });
  if (error) throw error;
  return id;
}

// Fetch a published composition's manifest by share id (null if not found).
export async function fetchPublishedComposition(id: string): Promise<Composition | null> {
  const { data, error } = await supabase().from(TABLE).select("manifest").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data?.manifest as Composition) ?? null;
}

export interface GallerySummary {
  id: string;
  title: string;
  artist: string;
  createdAt: string;
}

function toGallerySummary(r: any): GallerySummary {
  return {
    id: r.id,
    title: r.title ?? "Untitled",
    artist: r.artist ?? "Unknown",
    createdAt: r.created_at,
  };
}

// The most recently published compositions, for the public gallery.
export async function listRecent(limit = 50): Promise<GallerySummary[]> {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("id, title, artist, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toGallerySummary);
}

// Published compositions for one artist, newest first.
export async function listByArtist(artist: string, limit = 50): Promise<GallerySummary[]> {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("id, title, artist, created_at")
    .eq("artist", artist)
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
