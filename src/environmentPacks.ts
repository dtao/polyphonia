import type { EnvironmentQuality } from "./environment";

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
  profile: "cavern" | "forest" | "crystal";
  geometryPrefix: string;
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
    profile: "cavern",
    geometryPrefix: "WallRock_",
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
  {
    id: "verdant-grove",
    name: "Verdant Grove",
    profile: "forest",
    geometryPrefix: "Tree_",
    description: "Moss-covered paths framed by authored evergreen landmarks",
    variants: ["temperate"],
    assets: [
      {
        url: "/environments/verdant-grove/verdant-grove-kit.glb",
        quality: "high",
      },
    ],
    attribution: [
      {
        title: "Verdant Grove",
        author: "Polyphonia",
        license: "Project asset",
      },
    ],
    budgets: {
      maxTextureSize: 2048,
      maxTriangles: 160_000,
      maxDrawCalls: 100,
    },
    effects: {
      exposure: 1.12,
      bloomStrength: 0.08,
      bloomThreshold: 0.86,
      bloomRadius: 0.28,
      ambientOcclusion: true,
      vignette: 0.16,
      contrast: 1.04,
      saturation: 1.08,
      tint: [0.98, 1.04, 0.94],
    },
  },
  {
    id: "prismatic-reach",
    name: "Prismatic Reach",
    profile: "crystal",
    geometryPrefix: "CrystalCluster_",
    description: "Luminous mineral floors and prismatic crystal landmarks",
    variants: ["azure"],
    assets: [
      {
        url: "/environments/prismatic-reach/prismatic-reach-kit.glb",
        quality: "high",
      },
    ],
    attribution: [
      {
        title: "Prismatic Reach",
        author: "Polyphonia",
        license: "Project asset",
      },
    ],
    budgets: {
      maxTextureSize: 2048,
      maxTriangles: 150_000,
      maxDrawCalls: 100,
    },
    effects: {
      exposure: 1.16,
      bloomStrength: 0.34,
      bloomThreshold: 0.62,
      bloomRadius: 0.48,
      ambientOcclusion: true,
      vignette: 0.22,
      contrast: 1.08,
      saturation: 1.12,
      tint: [0.96, 1.02, 1.08],
    },
  },
];

export function environmentPackById(id: string | undefined): EnvironmentPackDefinition | undefined {
  return id ? ENVIRONMENT_PACKS.find((pack) => pack.id === id) : undefined;
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
