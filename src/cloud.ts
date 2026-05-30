import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Composition } from "./composition";
import { newId } from "./id";

// Cloud sharing via Supabase: stems go to a public Storage bucket, the manifest
// (with stems rewritten to public CDN URLs) goes to a Postgres row. No custom
// server — the frontend uses the public anon key, gated by RLS.

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
const OWNER_TOKEN_KEY = "polyphonia:owner-tokens"; // map of shareId -> token, for future edit/unpublish

const isUploaded = (url: string) => url.startsWith("blob:");

// Publish the current composition. Uploads uploaded stems to Storage, rewrites
// their URLs to public CDN URLs, and inserts the manifest. Returns the share id.
export async function publishComposition(comp: Composition): Promise<string> {
  const sb = supabase();
  const id = newId();
  const ownerToken = newId();

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

  const manifest: Composition = { ...comp, tracks };
  const { error } = await sb.from(TABLE).insert({ id, manifest, owner_token: ownerToken });
  if (error) throw error;

  rememberOwnerToken(id, ownerToken);
  return id;
}

// Fetch a published composition's manifest by share id (null if not found).
export async function fetchPublishedComposition(id: string): Promise<Composition | null> {
  const { data, error } = await supabase().from(TABLE).select("manifest").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data?.manifest as Composition) ?? null;
}

function rememberOwnerToken(id: string, token: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(OWNER_TOKEN_KEY) ?? "{}");
    map[id] = token;
    localStorage.setItem(OWNER_TOKEN_KEY, JSON.stringify(map));
  } catch {
    /* non-critical */
  }
}
