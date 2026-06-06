import type { EnvironmentPackMaterial } from "./environmentPacks";
import { resolveStoredAssetReference } from "./detailPackStorage";
import { CREATOR_ASSET_STORE, databaseRequest } from "./localDatabase";

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
  material: EnvironmentPackMaterial;
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
  return Promise.all((await getStoredCreatorAssets()).map(resolveCreatorAsset));
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
