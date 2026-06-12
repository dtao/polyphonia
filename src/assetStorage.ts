// Content-addressed blob storage for creator assets (imported GLB landmarks
// and PBR material textures). Blobs live in IndexedDB keyed by SHA-256;
// references use the "asset:<hash>" scheme and resolve to object URLs on
// demand. Extracted from the retired detail-pack system, which shared the
// same store.

import { ASSET_STORE, databaseRequest } from "./localDatabase";

/** Serialized blob inside an exported bundle (creator assets in .polyphonia.json). */
export interface StoredAssetPayload {
  name: string;
  type: string;
  data: string;
}

const objectUrls = new Map<string, string>();

export async function storedAsset(hash: string): Promise<{ blob: Blob; name: string; type: string } | undefined> {
  return databaseRequest(ASSET_STORE, "readonly", (store) => store.get(hash));
}

export async function storeAssetBlob(
  blob: Blob,
  name: string,
  type = blob.type || "application/octet-stream",
): Promise<string> {
  const hash = await sha256(blob);
  await databaseRequest<void>(ASSET_STORE, "readwrite", (store) =>
    store.put({ blob, name, type }, hash),
  );
  return `asset:${hash}`;
}

export async function resolveStoredAssetReference(reference: string): Promise<string> {
  if (!reference.startsWith("asset:")) return reference;
  const hash = reference.slice("asset:".length);
  let url = objectUrls.get(hash);
  if (!url) {
    const entry = await storedAsset(hash);
    if (!entry) throw new Error(`Asset ${hash} is missing from local storage.`);
    url = URL.createObjectURL(entry.blob);
    objectUrls.set(hash, url);
  }
  return url;
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
