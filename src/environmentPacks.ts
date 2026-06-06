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
  effects?: {
    exposure: number;
    bloomStrength: number;
    bloomThreshold: number;
    bloomRadius: number;
    ambientOcclusion: boolean;
    vignette: number;
    contrast: number;
    saturation: number;
    tint: [number, number, number];
  };
}

// Authored packs are registered here rather than embedded in composition data.
// A composition stores only a stable id/variant/quality selection, keeping
// manifests portable and allowing asset URLs or delivery formats to evolve.
export const ENVIRONMENT_PACKS: readonly EnvironmentPackDefinition[] = [
  {
    id: "atlas-cavern",
    name: "Atlas Cavern",
    environmentType: "cavern",
    material: "stone",
    description: "Authored rock chambers, columns, and overhead formations",
    variants: ["ember"],
    assets: [
      {
        url: "/environments/atlas-cavern/cavern-kit.glb",
        quality: "high",
      },
    ],
    attribution: [
      {
        title: "Atlas Cavern",
        author: "Polyphonia",
        license: "Project asset",
      },
    ],
    budgets: {
      maxTextureSize: 2048,
      maxTriangles: 180_000,
      maxDrawCalls: 120,
    },
    effects: {
      exposure: 1.08,
      bloomStrength: 0.22,
      bloomThreshold: 0.72,
      bloomRadius: 0.38,
      ambientOcclusion: true,
      vignette: 0.28,
      contrast: 1.06,
      saturation: 0.9,
      tint: [1.02, 0.99, 0.96],
    },
  },
];

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

export function resolvedEnvironmentQuality(quality: EnvironmentQuality): Exclude<EnvironmentQuality, "auto"> {
  if (quality !== "auto") return quality;
  if (typeof navigator === "undefined") return "high";
  const device = navigator as Navigator & { deviceMemory?: number };
  const lowMemory = device.deviceMemory !== undefined && device.deviceMemory <= 4;
  const lowConcurrency = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 4;
  return lowMemory || lowConcurrency ? "low" : "high";
}
