// Terrain field for generated environments.
//
// The terrain is a square heightfield derived from the environment's seed and
// params, with three layers applied in order:
//   1. base fractal noise, faded to zero at the region rim,
//   2. a flatten mask that pins the field to walkable-surface height around
//      paths/rooms/platforms, stems, and the map start (constraint awareness),
//   3. the composer's stored edit operations (brush strokes, regional reseeds).
//
// The field is visual dressing only — movement and acoustics stay owned by the
// map — except on maps with no walkable bounds, where the player follows it
// (see Player.tsx). Because the flatten mask is recomputed from the *live* map
// and stem positions, constraints stay respected when stems or paths move
// after generation.

import type { GeneratedEdit, GeneratedEnvironment } from "../environment";
import {
  CompositionMap,
  loopPreviewElevationOffset,
  pointElevation,
  mapPointKey,
  platformElevation,
  roomElevation,
  surfaceHeightAt,
  tiledMapTransforms,
  transformLoopPoint,
} from "../map";
import type { TrackDef } from "../composition";
import { fbm2 } from "./noise";

export const STEM_CLEAR_RADIUS = 2.5;
export const START_CLEAR_RADIUS = 5;
/**
 * Flattened terrain seats this far BELOW the walkable surface it pins to.
 * Path/room/platform floors are flat planes at exactly their elevation, so a
 * terrain pinned to the same height would be coplanar and z-fight; the drop
 * keeps the map's floor geometry unambiguously on top.
 */
export const FLATTEN_DROP = 0.12;
/** Width of the band over which terrain blends from flattened to free. */
const FLATTEN_BLEND = 10;
/** Width of the rim band where terrain falls back to the base level. */
const RIM_BLEND = 26;

export type FlattenSource =
  | { kind: "strip"; a: [number, number]; b: [number, number]; halfWidth: number; ya: number; yb: number }
  | { kind: "disc"; center: [number, number]; radius: number; y: number };

export interface TerrainField {
  center: [number, number];
  size: number;
  resolution: number;
  /** (resolution + 1)^2 heights, row-major over z then x. */
  heights: Float32Array;
}

export function terrainResolution(size: number): number {
  return Math.max(64, Math.min(128, Math.round(size / 1.5)));
}

/**
 * The protected geometry the terrain flattens around and the scatterer keeps
 * clear of, honoring the environment's constraint toggles.
 */
export function flattenSources(
  map: CompositionMap,
  tracks: Pick<TrackDef, "position">[],
  generated: Pick<GeneratedEnvironment, "center" | "size" | "constraints">,
): FlattenSource[] {
  const sources: FlattenSource[] = [];
  // The spawn area always stays clear so entering a composition never drops
  // the listener into a tree or against a sudden slope.
  sources.push({
    kind: "disc",
    center: map.start.position,
    radius: START_CLEAR_RADIUS,
    y: surfaceHeightAt(map, map.start.position),
  });

  if (generated.constraints.paths) {
    const copies = [
      null,
      ...tiledMapTransforms(map, generated.center, generated.size + RIM_BLEND, {}),
    ];
    for (const copy of copies) {
      const lift = copy ? loopPreviewElevationOffset(map, copy) : 0;
      for (const segment of map.segments) {
        const a = copy ? transformLoopPoint(copy, segment.start) : segment.start;
        const b = copy ? transformLoopPoint(copy, segment.end) : segment.end;
        sources.push({
          kind: "strip",
          a,
          b,
          halfWidth: segment.width / 2,
          ya: pointElevation(map, mapPointKey(segment.start)) + lift,
          yb: pointElevation(map, mapPointKey(segment.end)) + lift,
        });
      }
      for (const room of map.rooms) {
        sources.push({
          kind: "disc",
          center: copy ? transformLoopPoint(copy, room.center) : room.center,
          radius: Math.hypot(room.width, room.depth) / 2,
          y: roomElevation(map, room) + lift,
        });
      }
      for (const platform of map.platforms) {
        sources.push({
          kind: "disc",
          center: copy ? transformLoopPoint(copy, platform.center) : platform.center,
          radius: Math.max(platform.width, platform.depth) / 2,
          y: platformElevation(map, platform) + lift,
        });
      }
    }
  }

  if (generated.constraints.stems) {
    for (const track of tracks) {
      const at: [number, number] = [track.position[0], track.position[2]];
      sources.push({
        kind: "disc",
        center: at,
        radius: STEM_CLEAR_RADIUS,
        y: surfaceHeightAt(map, at),
      });
    }
  }

  return sources;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Distance from a point to a strip's centerline (segment, not line). */
function stripDistance(source: Extract<FlattenSource, { kind: "strip" }>, x: number, z: number): { d: number; t: number } {
  const dx = source.b[0] - source.a[0];
  const dz = source.b[1] - source.a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - source.a[0]) * dx + (z - source.a[1]) * dz) / lengthSq)) : 0;
  const px = source.a[0] + dx * t;
  const pz = source.a[1] + dz * t;
  return { d: Math.hypot(x - px, z - pz), t };
}

/**
 * How free the terrain is at (x, z): weight 0 = pinned to `target`, 1 = pure
 * noise. The nearest protected source wins the flatten target.
 */
export function flattenAt(
  sources: FlattenSource[],
  buffer: number,
  x: number,
  z: number,
): { weight: number; target: number } {
  let weight = 1;
  let target = 0;
  for (const source of sources) {
    let edge: number;
    let y: number;
    if (source.kind === "strip") {
      const { d, t } = stripDistance(source, x, z);
      edge = d - (source.halfWidth + buffer);
      y = source.ya + (source.yb - source.ya) * t;
    } else {
      edge = Math.hypot(x - source.center[0], z - source.center[1]) - (source.radius + buffer);
      y = source.y;
    }
    const m = smoothstep(edge / FLATTEN_BLEND);
    if (m < weight) {
      weight = m;
      target = y - FLATTEN_DROP;
    }
  }
  return { weight, target };
}

/** Clearance test for scatter placement: true if (x, z) is too close to protected geometry. */
export function insideClearZone(sources: FlattenSource[], buffer: number, x: number, z: number, margin = 1): boolean {
  for (const source of sources) {
    const edge =
      source.kind === "strip"
        ? stripDistance(source, x, z).d - (source.halfWidth + buffer)
        : Math.hypot(x - source.center[0], z - source.center[1]) - (source.radius + buffer);
    if (edge < margin) return true;
  }
  return false;
}

export function buildTerrainField(
  generated: Pick<GeneratedEnvironment, "seed" | "params" | "center" | "size" | "edits" | "constraints">,
  sources: FlattenSource[],
): TerrainField {
  const { size, center } = generated;
  const resolution = terrainResolution(size);
  const verts = resolution + 1;
  const heights = new Float32Array(verts * verts);
  const cell = (size * 2) / resolution;

  const noiseHeight = (seed: number, x: number, z: number): number => {
    const scale = generated.params.terrainScale;
    return fbm2(seed, x / scale, z / scale, 4) * generated.params.terrainAmplitude;
  };

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const rim = 1 - smoothstep((Math.max(Math.abs(x - center[0]), Math.abs(z - center[1])) - (size - RIM_BLEND)) / RIM_BLEND);
      const { weight, target } = flattenAt(sources, generated.constraints.buffer, x, z);
      const free = noiseHeight(generated.seed, x, z) * rim;
      heights[iz * verts + ix] = lerp(target, free, weight);
    }
  }

  const field: TerrainField = { center, size, resolution, heights };
  applyEditsToField(field, generated, sources);
  return field;
}

/** Apply a list of edit ops, in order, onto an existing field's grid. */
export function applyEditsToField(
  field: TerrainField,
  generated: Pick<GeneratedEnvironment, "params" | "center" | "size" | "edits" | "constraints">,
  sources: FlattenSource[],
): void {
  const noiseHeight = (seed: number, x: number, z: number): number => {
    const scale = generated.params.terrainScale;
    return fbm2(seed, x / scale, z / scale, 4) * generated.params.terrainAmplitude;
  };
  for (const edit of generated.edits) {
    applyEdit(field.heights, generated, field.resolution, edit, sources, noiseHeight);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function applyEdit(
  heights: Float32Array,
  generated: Pick<GeneratedEnvironment, "center" | "size" | "constraints">,
  resolution: number,
  edit: GeneratedEdit,
  sources: FlattenSource[],
  noiseHeight: (seed: number, x: number, z: number) => number,
): void {
  const verts = resolution + 1;
  const { center, size } = generated;
  const cell = (size * 2) / resolution;
  const minIx = Math.max(0, Math.floor((edit.center[0] - edit.radius - (center[0] - size)) / cell));
  const maxIx = Math.min(resolution, Math.ceil((edit.center[0] + edit.radius - (center[0] - size)) / cell));
  const minIz = Math.max(0, Math.floor((edit.center[1] - edit.radius - (center[1] - size)) / cell));
  const maxIz = Math.min(resolution, Math.ceil((edit.center[1] + edit.radius - (center[1] - size)) / cell));
  if (minIx > maxIx || minIz > maxIz) return;

  const smoothSource = edit.type === "terrain" && edit.mode === "smooth" ? heights.slice() : null;

  for (let iz = minIz; iz <= maxIz; iz++) {
    for (let ix = minIx; ix <= maxIx; ix++) {
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const distance = Math.hypot(x - edit.center[0], z - edit.center[1]);
      if (distance > edit.radius) continue;
      const falloff = smoothstep(1 - distance / edit.radius);
      const index = iz * verts + ix;
      // Edits never dig into the protected clear zones: scale by the flatten
      // weight so brushing across a path leaves the walkable strip untouched.
      const { weight } = flattenAt(sources, generated.constraints.buffer, x, z);
      if (edit.type === "reseed") {
        const fresh = noiseHeight(edit.seed, x, z);
        const { target } = flattenAt(sources, generated.constraints.buffer, x, z);
        heights[index] = lerp(heights[index], lerp(target, fresh, weight), falloff);
      } else if (edit.mode === "smooth" && smoothSource) {
        let sum = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = ix + dx;
            const nz = iz + dz;
            if (nx < 0 || nx > resolution || nz < 0 || nz > resolution) continue;
            sum += smoothSource[nz * verts + nx];
            count++;
          }
        }
        heights[index] = lerp(heights[index], sum / count, Math.min(1, edit.amount) * falloff * weight);
      } else {
        heights[index] += edit.amount * falloff * weight;
      }
    }
  }
}

/** Bilinear height lookup; returns 0 outside the generated region. */
export function terrainHeightAt(field: TerrainField, x: number, z: number): number {
  const { center, size, resolution, heights } = field;
  const verts = resolution + 1;
  const cell = (size * 2) / resolution;
  const gx = (x - (center[0] - size)) / cell;
  const gz = (z - (center[1] - size)) / cell;
  if (gx < 0 || gz < 0 || gx > resolution || gz > resolution) return 0;
  const ix = Math.min(resolution - 1, Math.floor(gx));
  const iz = Math.min(resolution - 1, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const a = heights[iz * verts + ix];
  const b = heights[iz * verts + ix + 1];
  const c = heights[(iz + 1) * verts + ix];
  const d = heights[(iz + 1) * verts + ix + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
