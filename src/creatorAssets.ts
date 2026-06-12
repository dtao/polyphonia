import {
  resolveStoredAssetReference,
  storeAssetBlob,
  storedAsset,
  type StoredAssetPayload,
} from "./assetStorage";
import { validateLandmarkGlb } from "./assetValidation";
import { newId } from "./id";
import { CREATOR_ASSET_STORE, databaseRequest } from "./localDatabase";

/**
 * A PBR surface material built from imported textures. Applied to map
 * surfaces (floor/wall/ceiling) and the generated terrain. Texture fields are
 * "asset:<hash>" references at rest, resolved to object URLs for rendering.
 */
export interface SurfaceMaterialDefinition {
  albedo: string;
  normal?: string;
  roughnessMap?: string;
  metalnessMap?: string;
  ao?: string;
  emissiveMap?: string;
  repeat: number;
  normalScale?: number;
  roughness: number;
  metalness: number;
  aoIntensity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface CreatorAssetAttribution {
  title: string;
  author: string;
  license: string;
  url?: string;
}

interface CreatorAssetBase {
  id: string;
  name: string;
  attribution: CreatorAssetAttribution;
  createdAt: string;
}

export interface CreatorMaterialAsset extends CreatorAssetBase {
  kind: "material";
  material: SurfaceMaterialDefinition;
}

export interface CreatorLandmarkAsset extends CreatorAssetBase {
  kind: "landmark";
  model: string;
  placement: "floor" | "wall" | "ceiling";
  anchor: [number, number, number];
  defaultScale: number;
  triangles: number;
  drawCalls: number;
}

export type CreatorAsset = CreatorMaterialAsset | CreatorLandmarkAsset;

export interface CreatorAssetBundle {
  version: 1;
  definitions: CreatorAsset[];
  assets: Record<string, StoredAssetPayload>;
}

// Built-in PBR materials (textures ship in public/environments/, inherited
// from the retired detail packs). Always available — in the editor, in the
// viewer, and after export/import — without being stored or uploaded; their
// ids are stable so manifests can reference them directly.
export const BUILTIN_MATERIALS: CreatorMaterialAsset[] = [
  {
    id: "builtin-cavern-stone",
    kind: "material",
    name: "Cavern stone",
    attribution: { title: "Atlas Cavern", author: "Polyphonia", license: "Project asset" },
    createdAt: "2026-06-06T00:00:00.000Z",
    material: {
      albedo: "/environments/atlas-cavern/textures/stone-albedo.webp",
      normal: "/environments/atlas-cavern/textures/stone-normal.webp",
      roughnessMap: "/environments/atlas-cavern/textures/stone-roughness.webp",
      ao: "/environments/atlas-cavern/textures/stone-ao.webp",
      repeat: 2.5,
      normalScale: 0.7,
      roughness: 0.92,
      metalness: 0.02,
      aoIntensity: 0.75,
    },
  },
  {
    id: "builtin-grove-forest",
    kind: "material",
    name: "Forest floor",
    attribution: { title: "Verdant Grove", author: "Polyphonia", license: "Project asset" },
    createdAt: "2026-06-06T00:00:00.000Z",
    material: {
      albedo: "/environments/verdant-grove/textures/forest-albedo.webp",
      normal: "/environments/verdant-grove/textures/forest-normal.webp",
      roughnessMap: "/environments/verdant-grove/textures/forest-roughness.webp",
      ao: "/environments/verdant-grove/textures/forest-ao.webp",
      repeat: 3.2,
      normalScale: 0.7,
      roughness: 0.96,
      metalness: 0,
      aoIntensity: 0.9,
    },
  },
  {
    id: "builtin-prismatic-crystal",
    kind: "material",
    name: "Crystal",
    attribution: { title: "Prismatic Reach", author: "Polyphonia", license: "Project asset" },
    createdAt: "2026-06-06T00:00:00.000Z",
    material: {
      albedo: "/environments/prismatic-reach/textures/crystal-albedo.webp",
      normal: "/environments/prismatic-reach/textures/crystal-normal.webp",
      roughnessMap: "/environments/prismatic-reach/textures/crystal-roughness.webp",
      ao: "/environments/prismatic-reach/textures/crystal-ao.webp",
      repeat: 2.1,
      normalScale: 0.7,
      roughness: 0.38,
      metalness: 0.16,
      aoIntensity: 0.62,
      emissive: "#183859",
      emissiveIntensity: 0.34,
    },
  },
];

let registeredAssets: CreatorAsset[] = [];

export function registerCreatorAssets(assets: CreatorAsset[]): void {
  registeredAssets = assets;
}

export function registeredCreatorAssets(): CreatorAsset[] {
  return [...BUILTIN_MATERIALS, ...registeredAssets];
}

export interface CreatorMaterialImport {
  name: string;
  attribution: CreatorAssetAttribution;
  albedo: File;
  normal?: File;
  roughnessMap?: File;
  metalnessMap?: File;
  ao?: File;
  emissiveMap?: File;
  repeat: number;
  normalScale?: number;
  roughness: number;
  metalness: number;
}

export interface CreatorLandmarkImport {
  name: string;
  attribution: CreatorAssetAttribution;
  model: File;
  placement: "floor" | "wall" | "ceiling";
  defaultScale: number;
}

export async function importCreatorMaterial(
  input: CreatorMaterialImport,
): Promise<CreatorMaterialAsset> {
  validateMetadata(input.name, input.attribution);
  const files = [
    input.albedo,
    input.normal,
    input.roughnessMap,
    input.metalnessMap,
    input.ao,
    input.emissiveMap,
  ].filter((file): file is File => !!file);
  await Promise.all(files.map(validateTexture));
  const reference = (file: File) => storeAssetBlob(file, file.name, file.type);
  const asset: CreatorMaterialAsset = {
    id: newId(),
    kind: "material",
    name: input.name.trim(),
    attribution: cleanAttribution(input.attribution),
    createdAt: new Date().toISOString(),
    material: {
      albedo: await reference(input.albedo),
      ...(input.normal ? { normal: await reference(input.normal) } : {}),
      ...(input.roughnessMap ? { roughnessMap: await reference(input.roughnessMap) } : {}),
      ...(input.metalnessMap ? { metalnessMap: await reference(input.metalnessMap) } : {}),
      ...(input.ao ? { ao: await reference(input.ao) } : {}),
      ...(input.emissiveMap ? { emissiveMap: await reference(input.emissiveMap) } : {}),
      repeat: clamp(input.repeat, 0.1, 20),
      ...(input.normalScale === undefined ? {} : { normalScale: clamp(input.normalScale, 0, 4) }),
      roughness: clamp(input.roughness, 0, 1),
      metalness: clamp(input.metalness, 0, 1),
    },
  };
  await saveCreatorAsset(asset);
  return (await resolveCreatorAsset(asset)) as CreatorMaterialAsset;
}

export async function importCreatorLandmark(
  input: CreatorLandmarkImport,
): Promise<CreatorLandmarkAsset> {
  validateMetadata(input.name, input.attribution);
  const metrics = await validateLandmarkGlb(input.model);
  const asset: CreatorLandmarkAsset = {
    id: newId(),
    kind: "landmark",
    name: input.name.trim(),
    attribution: cleanAttribution(input.attribution),
    createdAt: new Date().toISOString(),
    model: await storeAssetBlob(
      input.model,
      input.model.name,
      input.model.type || "model/gltf-binary",
    ),
    placement: input.placement,
    anchor: [0, 0, 0],
    defaultScale: clamp(input.defaultScale, 0.01, 100),
    ...metrics,
  };
  await saveCreatorAsset(asset);
  return (await resolveCreatorAsset(asset)) as CreatorLandmarkAsset;
}

export async function saveCreatorAsset(asset: CreatorAsset): Promise<void> {
  await databaseRequest<void>(CREATOR_ASSET_STORE, "readwrite", (store) =>
    store.put(asset, asset.id),
  );
}

export async function removeCreatorAssetRecord(id: string): Promise<void> {
  await databaseRequest<void>(CREATOR_ASSET_STORE, "readwrite", (store) =>
    store.delete(id),
  );
}

export async function getStoredCreatorAssets(): Promise<CreatorAsset[]> {
  return databaseRequest<CreatorAsset[]>(CREATOR_ASSET_STORE, "readonly", (store) =>
    store.getAll(),
  );
}

export async function loadCreatorAssets(): Promise<CreatorAsset[]> {
  const assets = await Promise.all((await getStoredCreatorAssets()).map(resolveCreatorAsset));
  registerCreatorAssets(assets);
  return assets;
}

export async function creatorAssetBundleForIds(ids: string[]): Promise<CreatorAssetBundle | undefined> {
  const wanted = new Set(ids);
  const definitions = (await getStoredCreatorAssets()).filter((asset) => wanted.has(asset.id));
  if (!definitions.length) return undefined;
  const assets: Record<string, StoredAssetPayload> = {};
  for (const reference of [...new Set(definitions.flatMap(creatorAssetReferences))]) {
    if (!reference.startsWith("asset:")) continue;
    const hash = reference.slice("asset:".length);
    const entry = await storedAsset(hash);
    if (!entry) throw new Error(`Creator asset ${hash} is missing from local storage.`);
    assets[hash] = {
      name: entry.name,
      type: entry.type || entry.blob.type || "application/octet-stream",
      data: toBase64(await entry.blob.arrayBuffer()),
    };
  }
  return {
    version: 1,
    definitions: definitions.map((asset) =>
      rewriteCreatorAssetUrls(asset, (url) =>
        url.startsWith("asset:") ? `bundle:${url.slice("asset:".length)}` : url,
      ),
    ),
    assets,
  };
}

export async function importCreatorAssetBundle(
  payload: Partial<CreatorAssetBundle>,
): Promise<CreatorAsset[]> {
  if (payload.version !== 1 || !Array.isArray(payload.definitions) || !payload.assets) {
    throw new Error("Unrecognized creator asset bundle.");
  }
  const replacements = new Map<string, string>();
  for (const [key, entry] of Object.entries(payload.assets)) {
    if (!entry || typeof entry.data !== "string" || typeof entry.type !== "string") {
      throw new Error(`Creator asset "${key}" is malformed.`);
    }
    replacements.set(
      `bundle:${key}`,
      await storeAssetBlob(base64ToBlob(entry.data, entry.type), entry.name || key, entry.type),
    );
  }
  for (const definition of payload.definitions) {
    const stored = rewriteCreatorAssetUrls(definition, (url) => replacements.get(url) ?? url);
    await saveCreatorAsset(stored);
  }
  return loadCreatorAssets();
}

export function creatorAssetReferences(asset: CreatorAsset): string[] {
  if (asset.kind === "landmark") return [asset.model];
  const material = asset.material;
  return [
    material.albedo,
    material.normal,
    material.roughnessMap,
    material.metalnessMap,
    material.ao,
    material.emissiveMap,
  ].filter((value): value is string => !!value);
}

export function rewriteCreatorAssetUrls(
  asset: CreatorAsset,
  rewrite: (url: string) => string,
): CreatorAsset {
  if (asset.kind === "landmark") return { ...asset, model: rewrite(asset.model) };
  const material = asset.material;
  return {
    ...asset,
    material: {
      ...material,
      albedo: rewrite(material.albedo),
      ...(material.normal ? { normal: rewrite(material.normal) } : {}),
      ...(material.roughnessMap ? { roughnessMap: rewrite(material.roughnessMap) } : {}),
      ...(material.metalnessMap ? { metalnessMap: rewrite(material.metalnessMap) } : {}),
      ...(material.ao ? { ao: rewrite(material.ao) } : {}),
      ...(material.emissiveMap ? { emissiveMap: rewrite(material.emissiveMap) } : {}),
    },
  };
}

async function resolveCreatorAsset(asset: CreatorAsset): Promise<CreatorAsset> {
  const resolved = new Map<string, string>();
  await Promise.all(
    creatorAssetReferences(asset).map(async (reference) => {
      resolved.set(reference, await resolveStoredAssetReference(reference));
    }),
  );
  return rewriteCreatorAssetUrls(asset, (url) => resolved.get(url) ?? url);
}

function validateMetadata(name: string, attribution: CreatorAssetAttribution): void {
  if (!name.trim() || name.trim().length > 80) throw new Error("Asset names must contain 1-80 characters.");
  if (!attribution.title.trim() || !attribution.author.trim() || !attribution.license.trim()) {
    throw new Error("Source title, author, and license are required.");
  }
}

function cleanAttribution(attribution: CreatorAssetAttribution): CreatorAssetAttribution {
  return {
    title: attribution.title.trim(),
    author: attribution.author.trim(),
    license: attribution.license.trim(),
    ...(attribution.url?.trim() ? { url: attribution.url.trim() } : {}),
  };
}

async function validateTexture(file: File): Promise<void> {
  if (!/\.(png|jpe?g|webp|ktx2)$/i.test(file.name)) {
    throw new Error(`Texture "${file.name}" must be PNG, JPEG, WebP, or KTX2.`);
  }
  if (file.size > 16 * 1024 * 1024) {
    throw new Error(`Texture "${file.name}" exceeds 16 MB.`);
  }
  if (typeof createImageBitmap !== "function" || file.name.toLowerCase().endsWith(".ktx2")) return;
  const image = await createImageBitmap(file);
  const dimension = Math.max(image.width, image.height);
  image.close();
  if (dimension > 4096) throw new Error(`Texture "${file.name}" exceeds 4096px.`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
