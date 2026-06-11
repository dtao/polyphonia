// Constraint-aware object scatter for generated environments.
//
// Placement is a jittered grid: each cell hashes (seed, cell coords) into a
// fill decision, kind, jitter, scale, yaw, and tint — so the same seed always
// produces the same field of objects, independent of iteration order, and a
// regional regenerate with a fresh seed only reshuffles the cells it covers.

import type {
  GeneratedBiome,
  GeneratedEnvironment,
  WorldObjectKind,
  WorldObjectPlacement,
} from "../environment";
import { hash2 } from "./noise";
import { WORLD_OBJECT_SPECS } from "./objects";
import { FlattenSource, insideClearZone } from "./terrain";
import { LOOP_BLEND_BAND, LoopFieldContext, loopProgress } from "./loop";

/** Hard cap so dense settings can't balloon the manifest. */
export const MAX_WORLD_OBJECTS = 1100;

interface KindWeight {
  kind: WorldObjectKind;
  weight: number;
  scale: [number, number];
  /** Optional tint variants applied to a fraction of placements. */
  tints?: string[];
}

const BIOME_KINDS: Record<GeneratedBiome, KindWeight[]> = {
  forest: [
    { kind: "pine", weight: 0.38, scale: [0.8, 1.7] },
    { kind: "tree", weight: 0.17, scale: [0.8, 1.5] },
    { kind: "rock", weight: 0.15, scale: [0.6, 1.6] },
    { kind: "shrub", weight: 0.14, scale: [0.7, 1.4] },
    { kind: "grass", weight: 0.1, scale: [0.8, 1.3] },
    { kind: "mushroom", weight: 0.06, scale: [0.6, 1.2], tints: ["#b04a3f", "#b8893c", "#7d5db8"] },
  ],
  cavern: [
    { kind: "stalagmite", weight: 0.4, scale: [0.6, 2] },
    { kind: "rock", weight: 0.26, scale: [0.7, 1.8], tints: ["#4c4756", "#56505f"] },
    { kind: "crystal", weight: 0.2, scale: [0.6, 1.6], tints: ["#8d7df0", "#6fd8d0", "#e07ab8"] },
    { kind: "mushroom", weight: 0.14, scale: [0.6, 1.5], tints: ["#7d5db8", "#4f9c8f"] },
  ],
  meadow: [
    { kind: "grass", weight: 0.4, scale: [0.8, 1.5] },
    { kind: "flower", weight: 0.2, scale: [0.8, 1.4], tints: ["#d7719f", "#e0c068", "#8aa7e8", "#d8845f"] },
    { kind: "shrub", weight: 0.15, scale: [0.7, 1.3] },
    { kind: "boulder", weight: 0.12, scale: [0.5, 1.3] },
    { kind: "tree", weight: 0.13, scale: [0.7, 1.4] },
  ],
};

export interface ScatterOptions {
  /** Restrict placement to this circle (regional regenerate). */
  region?: { center: [number, number]; radius: number };
  /** Existing placements new objects must keep clear of. */
  avoid?: WorldObjectPlacement[];
  /** Seed override (regional regenerate uses a fresh region seed). */
  seed?: number;
  /** Cap on how many new objects this pass may add. */
  budget?: number;
  /**
   * Path-loop context: the zone before the end seam displays the transported
   * start-side world (see worldgen/loop.ts), so no base objects are generated
   * there — the start's objects appear there as loop copies instead.
   */
  loop?: LoopFieldContext | null;
}

export function scatterObjects(
  generated: Pick<GeneratedEnvironment, "biome" | "seed" | "params" | "center" | "size" | "constraints">,
  sources: FlattenSource[],
  options: ScatterOptions = {},
): WorldObjectPlacement[] {
  // Density 0 means a bare landscape: hills and valleys only, no objects.
  if (generated.params.density <= 0) return [];
  const seed = options.seed ?? generated.seed;
  const { center, size } = generated;
  const kinds = BIOME_KINDS[generated.biome];
  const totalWeight = kinds.reduce((sum, entry) => sum + entry.weight, 0);
  // Density narrows the cell grid; the per-cell fill chance stays fixed so
  // density reads as "more of the same biome", not a different composition.
  const cell = 9 - generated.params.density * 4.5;
  const fillChance = 0.62;
  const budget = options.budget ?? MAX_WORLD_OBJECTS;
  const placements: WorldObjectPlacement[] = [];
  const idPrefix = `w${(seed >>> 0).toString(36)}`;

  const bounds = options.region
    ? {
        minX: Math.max(center[0] - size, options.region.center[0] - options.region.radius),
        maxX: Math.min(center[0] + size, options.region.center[0] + options.region.radius),
        minZ: Math.max(center[1] - size, options.region.center[1] - options.region.radius),
        maxZ: Math.min(center[1] + size, options.region.center[1] + options.region.radius),
      }
    : { minX: center[0] - size, maxX: center[0] + size, minZ: center[1] - size, maxZ: center[1] + size };

  const minCx = Math.floor(bounds.minX / cell);
  const maxCx = Math.ceil(bounds.maxX / cell);
  const minCz = Math.floor(bounds.minZ / cell);
  const maxCz = Math.ceil(bounds.maxZ / cell);

  for (let cz = minCz; cz <= maxCz && placements.length < budget; cz++) {
    for (let cx = minCx; cx <= maxCx && placements.length < budget; cx++) {
      if (hash2(seed, cx, cz) > fillChance) continue;
      const x = (cx + 0.1 + hash2(seed + 1, cx, cz) * 0.8) * cell;
      const z = (cz + 0.1 + hash2(seed + 2, cx, cz) * 0.8) * cell;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      if (Math.abs(x - center[0]) > size - 2 || Math.abs(z - center[1]) > size - 2) continue;
      if (options.region && Math.hypot(x - options.region.center[0], z - options.region.center[1]) > options.region.radius) continue;
      if (options.loop && loopProgress(options.loop, x, z) >= 1 - LOOP_BLEND_BAND / 2) continue;

      const entry = pickKind(kinds, totalWeight, hash2(seed + 3, cx, cz));
      const spec = WORLD_OBJECT_SPECS[entry.kind];
      const scale = round2(entry.scale[0] + (entry.scale[1] - entry.scale[0]) * hash2(seed + 4, cx, cz));
      const footprint = spec.radius * scale;
      if (insideClearZone(sources, generated.constraints.buffer, x, z, 0.5 + footprint)) continue;
      if (options.avoid?.some((other) => tooClose(other, x, z, footprint))) continue;

      const tint =
        entry.tints && hash2(seed + 5, cx, cz) < 0.65
          ? entry.tints[Math.floor(hash2(seed + 6, cx, cz) * entry.tints.length) % entry.tints.length]
          : undefined;
      placements.push({
        id: `${idPrefix}-${cx}x${cz}`,
        kind: entry.kind,
        position: [round2(x), 0, round2(z)],
        yaw: round2(hash2(seed + 7, cx, cz) * Math.PI * 2),
        scale,
        ...(tint ? { tint } : {}),
      });
    }
  }

  return placements;
}

function pickKind(kinds: KindWeight[], totalWeight: number, roll: number): KindWeight {
  let remaining = roll * totalWeight;
  for (const entry of kinds) {
    remaining -= entry.weight;
    if (remaining <= 0) return entry;
  }
  return kinds[kinds.length - 1];
}

function tooClose(other: WorldObjectPlacement, x: number, z: number, footprint: number): boolean {
  const otherFootprint = WORLD_OBJECT_SPECS[other.kind].radius * other.scale;
  return Math.hypot(other.position[0] - x, other.position[2] - z) < footprint + otherFootprint + 0.6;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
