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

  const tracks = [];
  for (const t of comp.tracks) {
    if (t.source.kind === "file" && isUploaded(t.source.url)) {
      const blob = await (await fetch(t.source.url)).blob();
      const path = `${id}/${t.id}`;
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: blob.type || "audio/mpeg", upsert: true });
      if (error) throw error;
      const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      tracks.push({ ...t, source: { kind: "file" as const, url } });
    } else {
      tracks.push(t); // built-in /stems URL or synth — leave as-is
    }
  }

  const manifest: Composition = { ...comp, tracks, publishedId: id };
  const { error } = await sb.from(TABLE).upsert({ id, manifest, owner: user.id });
  if (error) throw error;
  return id;
}

// Fetch a published composition's manifest by share id (null if not found).
export async function fetchPublishedComposition(id: string): Promise<Composition | null> {
  const { data, error } = await supabase().from(TABLE).select("manifest").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data?.manifest as Composition) ?? null;
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
