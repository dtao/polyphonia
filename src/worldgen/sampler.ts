// Memoized terrain field for the active composition.
//
// The scene mesh, the edit brushes, and the Player's ground-following all need
// height lookups every frame, so the field is cached and rebuilt only when its
// inputs actually change. Two fast paths keep editing fluid:
//  - brush strokes append edit ops; when the new edit list extends the cached
//    one, only the new ops are applied to the cached grid (localized work)
//    instead of rebuilding the field;
//  - stem drags change the flatten mask continuously; those rebuilds are
//    throttled so dragging stays smooth and the terrain settles right after.
//
// Edit `level` reclassification (minor → major at stroke end) is deliberately
// excluded from the signature: it doesn't change geometry.

import type { Composition } from "../composition";
import type { GeneratedEdit, GeneratedEnvironment } from "../environment";
import type { CompositionMap } from "../map";
import {
  applyEditsToField,
  buildTerrainField,
  flattenSources,
  terrainHeightAt,
  TerrainField,
  FlattenSource,
} from "./terrain";

const STEM_REBUILD_THROTTLE_MS = 300;

interface CacheEntry {
  field: TerrainField;
  sources: FlattenSource[];
  map: CompositionMap;
  baseKey: string;
  tracksKey: string;
  editSignatures: string[];
  builtAt: number;
}

let cache: CacheEntry | null = null;

function editSignature(edit: GeneratedEdit): string {
  return edit.type === "terrain"
    ? `t:${edit.mode}:${edit.center[0]},${edit.center[1]}:${edit.radius}:${edit.amount}`
    : `r:${edit.center[0]},${edit.center[1]}:${edit.radius}:${edit.seed}`;
}

function baseKey(generated: GeneratedEnvironment): string {
  return JSON.stringify([generated.seed, generated.params, generated.center, generated.size, generated.constraints]);
}

function tracksKey(composition: Composition): string {
  return composition.tracks.map((track) => `${track.position[0]},${track.position[2]}`).join(";");
}

export function terrainFieldFor(composition: Composition): TerrainField | null {
  const generated = composition.environment.generated;
  if (!generated) {
    cache = null;
    return null;
  }
  const map = composition.map;
  const base = baseKey(generated);
  const tracks = tracksKey(composition);
  const signatures = generated.edits.map(editSignature);

  if (cache && cache.baseKey === base && cache.map === map) {
    const sameEdits =
      signatures.length === cache.editSignatures.length &&
      cache.editSignatures.every((signature, i) => signature === signatures[i]);
    if (cache.tracksKey === tracks && sameEdits) return cache.field;

    // Appended brush ops: apply just the new edits to the cached grid.
    const extendsCache =
      cache.tracksKey === tracks &&
      signatures.length > cache.editSignatures.length &&
      cache.editSignatures.every((signature, i) => signature === signatures[i]);
    if (extendsCache) {
      const partial: GeneratedEnvironment = {
        ...generated,
        edits: generated.edits.slice(cache.editSignatures.length),
      };
      const field = buildIncremental(cache.field, partial, cache.sources);
      cache = { ...cache, field, editSignatures: signatures, builtAt: Date.now() };
      return field;
    }

    // Stem positions moved (flatten mask change only): serve the stale field
    // during the drag, rebuilding at most a few times per second.
    if (sameEdits && Date.now() - cache.builtAt < STEM_REBUILD_THROTTLE_MS) {
      return cache.field;
    }
  }

  const sources = flattenSources(map, composition.tracks, generated);
  const field = buildTerrainField(generated, sources);
  cache = { field, sources, map, baseKey: base, tracksKey: tracks, editSignatures: signatures, builtAt: Date.now() };
  return field;
}

// Applying only new ops reuses buildTerrainField's edit pass by handing it a
// pre-built grid: clone the cached field and replay the partial edit list.
function buildIncremental(
  previous: TerrainField,
  partial: GeneratedEnvironment,
  sources: FlattenSource[],
): TerrainField {
  const field: TerrainField = { ...previous, heights: previous.heights.slice() };
  applyEditsToField(field, partial, sources);
  return field;
}

/** Terrain height under (x, z) for the active composition; 0 when no generated terrain. */
export function generatedGroundHeight(composition: Composition, x: number, z: number): number {
  const field = terrainFieldFor(composition);
  return field ? terrainHeightAt(field, x, z) : 0;
}

/** Invalidate the cache (tests / composition switches). */
export function resetTerrainCache(): void {
  cache = null;
}
