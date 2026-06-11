// Generation entry points, regeneration preservation modes, and the
// major/minor edit classification rules.
//
// Preservation semantics (see WorldPanel for the composer-facing labels):
//   overwrite        — wipe objects, edits, and locks; fresh seed.
//   keep-constraints — same wipe, but force the stem/path constraints on.
//   keep-major       — keep major terrain edits and major-edited / locked /
//                      user-placed objects; re-roll everything else.
//   keep-all         — keep every edit and every touched object; re-roll only
//                      what the composer never modified.
// Regional regeneration is separate (regenerateRegion): it reshuffles one
// circle and leaves the rest of the world untouched.

import type {
  GeneratedBiome,
  GeneratedEnvironment,
  GeneratedEdit,
  TerrainEditMode,
  WorldObjectPlacement,
} from "../environment";
import {
  DEFAULT_CONSTRAINT_BUFFER,
  DEFAULT_GENERATED_SIZE,
  defaultGeneratedParams,
} from "../environment";
import type { CompositionMap } from "../map";
import type { TrackDef } from "../composition";
import { flattenSources } from "./terrain";
import { MAX_WORLD_OBJECTS, scatterObjects } from "./scatter";

export type RegenerationMode = "overwrite" | "keep-constraints" | "keep-major" | "keep-all";

/** Threshold above which a brush stroke counts as a major terrain edit. */
const MAJOR_TERRAIN_IMPACT = 18;
/** An object dragged at least this far counts as a major edit. */
const MAJOR_MOVE_DISTANCE = 3;

export function classifyTerrainEdit(mode: TerrainEditMode, amount: number, radius: number): "minor" | "major" {
  if (mode === "smooth") return "minor";
  return Math.abs(amount) * radius >= MAJOR_TERRAIN_IMPACT ? "major" : "minor";
}

export function classifyObjectEdit(
  before: WorldObjectPlacement,
  patch: Partial<WorldObjectPlacement>,
): "minor" | "major" {
  if (before.edit === "major") return "major";
  if (patch.position) {
    const distance = Math.hypot(patch.position[0] - before.position[0], patch.position[2] - before.position[2]);
    if (distance >= MAJOR_MOVE_DISTANCE) return "major";
  }
  if (patch.scale !== undefined) {
    const ratio = patch.scale / before.scale;
    if (ratio >= 1.4 || ratio <= 0.7) return "major";
  }
  return "minor";
}

export function isObjectPreserved(
  generated: Pick<GeneratedEnvironment, "locks">,
  object: WorldObjectPlacement,
  level: "major" | "all",
): boolean {
  if (generated.locks[object.id]) return true;
  if (object.userPlaced) return true;
  if (!object.edit) return false;
  return level === "all" || object.edit === "major";
}

export function generateEnvironment(
  biome: GeneratedBiome,
  map: CompositionMap,
  tracks: TrackDef[],
  options: { seed: number; size?: number; now: string },
): GeneratedEnvironment {
  const generated: GeneratedEnvironment = {
    biome,
    seed: options.seed,
    params: defaultGeneratedParams(biome),
    center: [map.start.position[0], map.start.position[1]],
    size: options.size ?? DEFAULT_GENERATED_SIZE,
    constraints: { stems: true, paths: true, buffer: DEFAULT_CONSTRAINT_BUFFER },
    objects: [],
    edits: [],
    locks: {},
    generatedAt: options.now,
  };
  const sources = flattenSources(map, tracks, generated);
  return { ...generated, objects: scatterObjects(generated, sources) };
}

export function regenerateEnvironment(
  generated: GeneratedEnvironment,
  map: CompositionMap,
  tracks: TrackDef[],
  mode: RegenerationMode,
  options: { seed: number; now: string },
): GeneratedEnvironment {
  const constraints =
    mode === "keep-constraints" ? { ...generated.constraints, stems: true, paths: true } : generated.constraints;
  const wipe = mode === "overwrite" || mode === "keep-constraints";
  const level = mode === "keep-major" ? ("major" as const) : ("all" as const);
  const kept = wipe ? [] : generated.objects.filter((object) => isObjectPreserved(generated, object, level));
  const keptIds = new Set(kept.map((object) => object.id));
  const edits: GeneratedEdit[] = wipe
    ? []
    : mode === "keep-major"
      ? generated.edits.filter((edit) => edit.level === "major")
      : generated.edits;
  const locks: Record<string, boolean> = {};
  for (const id of Object.keys(generated.locks)) if (keptIds.has(id)) locks[id] = true;

  const next: GeneratedEnvironment = {
    ...generated,
    seed: options.seed,
    constraints,
    edits,
    locks,
    objects: kept,
    generatedAt: options.now,
  };
  const sources = flattenSources(map, tracks, next);
  const budget = Math.max(0, MAX_WORLD_OBJECTS - kept.length);
  return { ...next, objects: [...kept, ...scatterObjects(next, sources, { avoid: kept, budget })] };
}

export function regenerateRegion(
  generated: GeneratedEnvironment,
  map: CompositionMap,
  tracks: TrackDef[],
  region: { center: [number, number]; radius: number },
  options: { seed: number; editId: string; now: string },
): GeneratedEnvironment {
  const inRegion = (point: [number, number]) =>
    Math.hypot(point[0] - region.center[0], point[1] - region.center[1]) <= region.radius;

  // Terrain inside the circle re-rolls: drop the old strokes centered there and
  // blend in fresh noise via a reseed edit. Everything outside is untouched.
  const edits: GeneratedEdit[] = [
    ...generated.edits.filter((edit) => !inRegion(edit.center)),
    {
      id: options.editId,
      type: "reseed",
      center: region.center,
      radius: region.radius,
      seed: options.seed,
      at: options.now,
      level: "major",
    },
  ];

  const kept = generated.objects.filter(
    (object) =>
      !inRegion([object.position[0], object.position[2]]) || isObjectPreserved(generated, object, "all"),
  );
  const keptIds = new Set(kept.map((object) => object.id));
  const locks: Record<string, boolean> = {};
  for (const id of Object.keys(generated.locks)) if (keptIds.has(id)) locks[id] = true;

  const next: GeneratedEnvironment = { ...generated, edits, locks, objects: kept, generatedAt: options.now };
  const sources = flattenSources(map, tracks, next);
  const budget = Math.max(0, MAX_WORLD_OBJECTS - kept.length);
  const fresh = scatterObjects(next, sources, { region, avoid: kept, seed: options.seed, budget });
  return { ...next, objects: [...kept, ...fresh] };
}
