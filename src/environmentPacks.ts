import type { EnvironmentMaterial, EnvironmentQuality, EnvironmentType } from "./environment";

export interface EnvironmentPackAttribution {
  title: string;
  author: string;
  license: string;
  url?: string;
}

export interface EnvironmentPackAsset {
  url: string;
  quality: Exclude<EnvironmentQuality, "auto">;
  compressedGeometry?: "draco" | "meshopt";
  compressedTextures?: "ktx2";
}

export interface EnvironmentPackDefinition {
  id: string;
  name: string;
  environmentType: EnvironmentType;
  material: EnvironmentMaterial;
  description: string;
  variants: readonly string[];
  assets: readonly EnvironmentPackAsset[];
  attribution: readonly EnvironmentPackAttribution[];
  budgets: {
    maxTextureSize: number;
    maxTriangles: number;
    maxDrawCalls: number;
  };
}

// Authored packs are registered here rather than embedded in composition data.
// A composition stores only a stable id/variant/quality selection, keeping
// manifests portable and allowing asset URLs or delivery formats to evolve.
export const ENVIRONMENT_PACKS: readonly EnvironmentPackDefinition[] = [];

export function environmentPackById(id: string | undefined): EnvironmentPackDefinition | undefined {
  return id ? ENVIRONMENT_PACKS.find((pack) => pack.id === id) : undefined;
}

export function environmentPacksForType(type: EnvironmentType): readonly EnvironmentPackDefinition[] {
  return ENVIRONMENT_PACKS.filter((pack) => pack.environmentType === type);
}

export function environmentPackAsset(
  pack: EnvironmentPackDefinition,
  quality: EnvironmentQuality,
): EnvironmentPackAsset | undefined {
  if (quality !== "auto") {
    const exact = pack.assets.find((asset) => asset.quality === quality);
    if (exact) return exact;
  }
  return pack.assets.find((asset) => asset.quality === "high") ?? pack.assets[0];
}
