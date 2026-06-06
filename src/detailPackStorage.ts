import type { EnvironmentPackDefinition } from "./environmentPacks";
import { ENVIRONMENT_PACKS } from "./environmentPacks";
import { ASSET_STORE, databaseRequest, DETAIL_PACK_STORE } from "./localDatabase";

export interface DetailPackBundleAsset {
  name: string;
  type: string;
  data: string;
}

export interface DetailPackBundle {
  version: 1;
  manifest: EnvironmentPackDefinition;
  assets: Record<string, DetailPackBundleAsset>;
}

const objectUrls = new Map<string, string>();

export async function importDetailPackBundle(file: File): Promise<EnvironmentPackDefinition> {
  const payload = JSON.parse(await file.text()) as Partial<DetailPackBundle>;
  return importDetailPackPayload(payload);
}

export async function importDetailPackPayload(
  payload: Partial<DetailPackBundle>,
): Promise<EnvironmentPackDefinition> {
  if (payload.version !== 1 || !payload.manifest || !payload.assets) {
    throw new Error("Unrecognized or unsupported detail-pack bundle.");
  }
  assertImportableManifest(payload.manifest);

  const replacements = new Map<string, string>();
  for (const [key, entry] of Object.entries(payload.assets)) {
    if (!entry || typeof entry.data !== "string" || typeof entry.type !== "string") {
      throw new Error(`Detail-pack asset "${key}" is malformed.`);
    }
    const blob = base64ToBlob(entry.data, entry.type);
    const hash = await sha256(blob);
    await databaseRequest<void>(ASSET_STORE, "readwrite", (store) =>
      store.put({ blob, name: entry.name || key, type: entry.type }, hash),
    );
    replacements.set(`bundle:${key}`, `asset:${hash}`);
  }

  const stored = rewritePackUrls(payload.manifest, (url) => replacements.get(url) ?? url);
  await databaseRequest<void>(DETAIL_PACK_STORE, "readwrite", (store) => store.put(stored, stored.id));
  return resolveStoredDetailPack(stored);
}

export async function detailPackBundleForId(id: string): Promise<DetailPackBundle | undefined> {
  const manifest = await getStoredDetailPack(id);
  if (!manifest) return undefined;
  const assets: Record<string, DetailPackBundleAsset> = {};
  for (const reference of [...new Set(packAssetReferences(manifest))]) {
    if (!reference.startsWith("asset:")) continue;
    const hash = reference.slice("asset:".length);
    const entry = await storedAsset(hash);
    if (!entry) throw new Error(`Detail-pack asset ${hash} is missing from local storage.`);
    assets[hash] = {
      name: entry.name,
      type: entry.type || entry.blob.type || "application/octet-stream",
      data: toBase64(await entry.blob.arrayBuffer()),
    };
  }
  return {
    version: 1,
    manifest: rewritePackUrls(manifest, (url) =>
      url.startsWith("asset:") ? `bundle:${url.slice("asset:".length)}` : url,
    ),
    assets,
  };
}

function assertImportableManifest(manifest: EnvironmentPackDefinition): void {
  if (typeof manifest.id !== "string" || !manifest.id.trim()) {
    throw new Error("The detail-pack manifest needs a stable id.");
  }
  if (ENVIRONMENT_PACKS.some((pack) => pack.id === manifest.id)) {
    throw new Error(`"${manifest.id}" is reserved by a built-in detail pack.`);
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("The detail-pack manifest needs a display name.");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error("The detail-pack manifest needs at least one GLB asset.");
  }
  if (!manifest.materials?.floor?.albedo) {
    throw new Error("The detail-pack manifest needs a floor albedo texture.");
  }
  if (!Array.isArray(manifest.landmarks)) {
    throw new Error("The detail-pack landmark catalog is malformed.");
  }
}

export async function loadStoredDetailPacks(): Promise<EnvironmentPackDefinition[]> {
  const packs = await databaseRequest<EnvironmentPackDefinition[]>(
    DETAIL_PACK_STORE,
    "readonly",
    (store) => store.getAll(),
  );
  return Promise.all(packs.map(resolveStoredDetailPack));
}

export async function getStoredDetailPack(id: string): Promise<EnvironmentPackDefinition | undefined> {
  return databaseRequest<EnvironmentPackDefinition | undefined>(
    DETAIL_PACK_STORE,
    "readonly",
    (store) => store.get(id),
  );
}

export async function removeStoredDetailPack(id: string): Promise<void> {
  await databaseRequest<void>(DETAIL_PACK_STORE, "readwrite", (store) => store.delete(id));
}

export function packAssetReferences(pack: EnvironmentPackDefinition): string[] {
  return [
    ...pack.assets.map((asset) => asset.url),
    ...Object.values(pack.materials).flatMap((material) =>
      material
        ? [
            material.albedo,
            material.normal,
            material.roughnessMap,
            material.metalnessMap,
            material.ao,
            material.emissiveMap,
          ].filter((url): url is string => !!url)
        : [],
    ),
  ];
}

export async function storedAsset(hash: string): Promise<{ blob: Blob; name: string; type: string } | undefined> {
  return databaseRequest(ASSET_STORE, "readonly", (store) => store.get(hash));
}

export function rewritePackUrls(
  pack: EnvironmentPackDefinition,
  rewrite: (url: string) => string,
): EnvironmentPackDefinition {
  const rewriteMaterial = (material: EnvironmentPackDefinition["materials"]["floor"]) => ({
    ...material,
    albedo: rewrite(material.albedo),
    ...(material.normal ? { normal: rewrite(material.normal) } : {}),
    ...(material.roughnessMap ? { roughnessMap: rewrite(material.roughnessMap) } : {}),
    ...(material.metalnessMap ? { metalnessMap: rewrite(material.metalnessMap) } : {}),
    ...(material.ao ? { ao: rewrite(material.ao) } : {}),
    ...(material.emissiveMap ? { emissiveMap: rewrite(material.emissiveMap) } : {}),
  });
  return {
    ...pack,
    assets: pack.assets.map((asset) => ({ ...asset, url: rewrite(asset.url) })),
    materials: {
      floor: rewriteMaterial(pack.materials.floor),
      ...(pack.materials.wall ? { wall: rewriteMaterial(pack.materials.wall) } : {}),
      ...(pack.materials.ceiling ? { ceiling: rewriteMaterial(pack.materials.ceiling) } : {}),
    },
  };
}

async function resolveStoredDetailPack(pack: EnvironmentPackDefinition): Promise<EnvironmentPackDefinition> {
  const urls = [...new Set(packAssetReferences(pack).filter((url) => url.startsWith("asset:")))];
  const resolved = new Map<string, string>();
  for (const reference of urls) {
    const hash = reference.slice("asset:".length);
    let url = objectUrls.get(hash);
    if (!url) {
      const entry = await storedAsset(hash);
      if (!entry) throw new Error(`Detail-pack asset ${hash} is missing from local storage.`);
      url = URL.createObjectURL(entry.blob);
      objectUrls.set(hash, url);
    }
    resolved.set(reference, url);
  }
  return rewritePackUrls(pack, (url) => resolved.get(url) ?? url);
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
