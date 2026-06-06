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

export interface EnvironmentPackMaterial {
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

export interface EnvironmentPackLandmark {
  id: string;
  name: string;
  nodePrefix: string;
  placement: "floor" | "wall" | "ceiling";
  fallback: "rock" | "tree" | "crystal";
  autoPlacement?: {
    spacing: number;
    edgeOffset: number;
    edgeJitter: number;
    baseY: number;
    scaleMin: [number, number, number];
    scaleMax: [number, number, number];
  };
}

export interface EnvironmentPackDefinition {
  id: string;
  name: string;
  description: string;
  variants: readonly string[];
  assets: readonly EnvironmentPackAsset[];
  materials: {
    floor: EnvironmentPackMaterial;
    wall?: EnvironmentPackMaterial;
    ceiling?: EnvironmentPackMaterial;
  };
  landmarks: readonly EnvironmentPackLandmark[];
  lighting?: "cavern" | "forest" | "crystal";
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
    description: "Authored rock chambers, columns, and overhead formations",
    variants: ["ember"],
    assets: [
      {
        url: "/environments/atlas-cavern/cavern-kit.glb",
        quality: "high",
      },
    ],
    materials: {
      floor: {
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
    landmarks: [
      {
        id: "wall-rock",
        name: "Wall rock",
        nodePrefix: "WallRock_",
        placement: "floor",
        fallback: "rock",
        autoPlacement: {
          spacing: 4.5,
          edgeOffset: 0.7,
          edgeJitter: 1.2,
          baseY: 0.35,
          scaleMin: [1.1, 0.8, 1],
          scaleMax: [2.6, 2.6, 2.3],
        },
      },
    ],
    lighting: "cavern",
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
    description: "Moss-covered paths framed by authored evergreen landmarks",
    variants: ["temperate"],
    assets: [
      {
        url: "/environments/verdant-grove/verdant-grove-kit.glb",
        quality: "high",
      },
    ],
    materials: {
      floor: {
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
    landmarks: [
      {
        id: "evergreen",
        name: "Evergreen",
        nodePrefix: "Tree_",
        placement: "floor",
        fallback: "tree",
        autoPlacement: {
          spacing: 6.5,
          edgeOffset: 2.2,
          edgeJitter: 2.6,
          baseY: 0,
          scaleMin: [0.75, 0.8, 0.75],
          scaleMax: [1.4, 1.6, 1.4],
        },
      },
    ],
    lighting: "forest",
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
    description: "Luminous mineral floors and prismatic crystal landmarks",
    variants: ["azure"],
    assets: [
      {
        url: "/environments/prismatic-reach/prismatic-reach-kit.glb",
        quality: "high",
      },
    ],
    materials: {
      floor: {
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
    landmarks: [
      {
        id: "crystal-cluster",
        name: "Crystal cluster",
        nodePrefix: "CrystalCluster_",
        placement: "floor",
        fallback: "crystal",
        autoPlacement: {
          spacing: 5.2,
          edgeOffset: 1.1,
          edgeJitter: 1.7,
          baseY: 0.2,
          scaleMin: [0.65, 1, 0.65],
          scaleMax: [1.8, 3.3, 1.8],
        },
      },
    ],
    lighting: "crystal",
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
