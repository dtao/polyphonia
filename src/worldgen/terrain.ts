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
  inverseTransformLoopPoint,
  isTunnelSegment,
  loopPreviewElevationOffset,
  pointElevation,
  mapPointKey,
  platformElevation,
  roomElevation,
  surfaceHeightAt,
  tiledMapTransforms,
  transformLoopPoint,
  tunnelHeight,
} from "../map";
import { DEFAULT_ENCLOSURE_HEIGHT } from "../spatialConstants";
import type { TrackDef } from "../composition";
import { fbm2 } from "./noise";
import { LOOP_BLEND_BAND, LoopFieldContext, canonicalizeLoopPoint, loopProgress } from "./loop";
import { LATTICE_BLEND_BAND, LatticeContext, latticeCoords, latticePoint } from "./lattice";

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
/**
 * How steeply a source's pinned height may rise per unit distance outside its
 * clearance. The flatten target is the LOWER ENVELOPE over all sources of
 * (surface height + this slope × distance beyond clearance), not simply the
 * nearest source's height. Two properties matter:
 *  - the envelope is ≤ every nearby walkable surface, so terrain pinned to it
 *    never pokes through a lower path/room/platform under a higher one;
 *  - inside clear zones the candidates are affine, so the envelope is concave
 *    there — linear interpolation across terrain grid cells stays BELOW it.
 *    Pinning to the nearest source instead made triangles cut a chord ABOVE
 *    the path at concave elevation kinks (the bottom of a ramp), which read
 *    as patches of terrain covering the path.
 * Must exceed the steepest realistic path slope so ramps regain their own
 * height once clear of a lower neighbor.
 *
 * The penalty exists ONLY to arbitrate between sources: the final target is
 * additionally capped at the nearest source's own surface height. Without
 * that cap, the blend band around an elevated path anchored at "path height
 * + penalty" — a collar ridge climbing above the path that read as terrain
 * spilling onto rising corridors.
 */
const FLATTEN_TARGET_SLOPE = 1.1;
/** Width of the rim band where terrain falls back to the base level. */
const RIM_BLEND = 26;

export type FlattenSource =
  | { kind: "strip"; a: [number, number]; b: [number, number]; halfWidth: number; ya: number; yb: number }
  | { kind: "disc"; center: [number, number]; radius: number; y: number }
  // Tunnels and rooms (P31): these are enclosed by their own floor/wall/ceiling
  // geometry, so the terrain is NOT carved down to them — it keeps its natural
  // height and the hillside stays overhead. Instead the terrain MESH is cut
  // (see terrainClipVolumes / the clip in GeneratedWorld): any terrain that
  // falls inside the interior is discarded, leaving a clean hole through the
  // hill. These sources exist only to keep scatter off the structure (they are
  // ignored by flattenAt, so they never pin the terrain height).
  | { kind: "clearStrip"; a: [number, number]; b: [number, number]; halfWidth: number }
  | { kind: "clearDisc"; center: [number, number]; radius: number };

export interface TerrainField {
  center: [number, number];
  size: number;
  resolution: number;
  /** (resolution + 1)^2 heights, row-major over z then x. */
  heights: Float32Array;
  /**
   * Loop-aware display fields only (see applyLoopToField): per-vertex height
   * with the loop lift removed, and canonical sample coordinates (x,z pairs),
   * so terrain coloring matches across loop copies. Absent on base fields.
   */
  shade?: Float32Array;
  patch?: Float32Array;
  /**
   * Base fields only: the per-vertex flatten weight (0 = pinned to a path, 1 =
   * free noise) and target floor, after the conservative 3×3 erosion. The loop
   * display transform reuses these so it never lifts terrain that is pinned to a
   * path above its floor (see applyLoopToField).
   */
  flattenWeight?: Float32Array;
  flattenTarget?: Float32Array;
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
        // Tunnels are enclosed: don't carve the terrain down to them. The
        // terrain keeps its natural height (so a hillside can sit overhead) and
        // the corridor is cleared by cutting a hole in the terrain mesh instead
        // (see terrainClipVolumes). The clear* source only keeps scatter off it.
        if (isTunnelSegment(segment)) {
          sources.push({ kind: "clearStrip", a, b, halfWidth: segment.width / 2 });
          continue;
        }
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
        // Rooms are enclosed like tunnels: keep the terrain natural and cut the
        // chamber out of the mesh rather than flattening the ground to it.
        const center = copy ? transformLoopPoint(copy, room.center) : room.center;
        sources.push({ kind: "clearDisc", center, radius: Math.hypot(room.width, room.depth) / 2 });
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
function stripDistance(source: { a: [number, number]; b: [number, number] }, x: number, z: number): { d: number; t: number } {
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
 * noise. The target is the lower envelope over all protected sources (see
 * FLATTEN_TARGET_SLOPE), seated FLATTEN_DROP below the walkable surface.
 */
export function flattenAt(
  sources: FlattenSource[],
  buffer: number,
  x: number,
  z: number,
): { weight: number; target: number } {
  let weight = 1;
  let envelope = Infinity;
  let nearestY = Infinity;
  for (const source of sources) {
    let edge: number;
    let y: number;
    if (source.kind === "strip") {
      const { d, t } = stripDistance(source, x, z);
      edge = d - (source.halfWidth + buffer);
      y = source.ya + (source.yb - source.ya) * t;
    } else if (source.kind === "disc") {
      edge = Math.hypot(x - source.center[0], z - source.center[1]) - (source.radius + buffer);
      y = source.y;
    } else {
      // Tunnel/room (clear*) sources never pin the terrain height — the
      // terrain keeps its natural height over them and the mesh is cut instead.
      continue;
    }
    const m = smoothstep(edge / FLATTEN_BLEND);
    if (m < weight) {
      weight = m;
      nearestY = y;
    }
    const candidate = y + Math.max(0, edge) * FLATTEN_TARGET_SLOPE;
    if (candidate < envelope) envelope = candidate;
  }
  if (envelope === Infinity) return { weight, target: 0 };
  return { weight, target: Math.min(envelope, nearestY) - FLATTEN_DROP };
}

/** Clearance test for scatter placement: true if (x, z) is too close to protected geometry. */
export function insideClearZone(sources: FlattenSource[], buffer: number, x: number, z: number, margin = 1): boolean {
  for (const source of sources) {
    let edge: number;
    if (source.kind === "strip" || source.kind === "clearStrip") {
      edge = stripDistance(source, x, z).d - (source.halfWidth + buffer);
    } else {
      edge = Math.hypot(x - source.center[0], z - source.center[1]) - (source.radius + buffer);
    }
    if (edge < margin) return true;
  }
  return false;
}

/**
 * A volume the terrain mesh is cut around so a tunnel/room interior reads as a
 * clean hole through the hill (P31). The renderer discards any terrain fragment
 * inside the footprint whose height is below `ceiling` — terrain ABOVE the
 * ceiling (the hillside overhead) is kept, terrain that would poke into the
 * enclosed space is removed. Heights are in base-map space (no loop/lattice
 * lift); the renderer tests against the canonical sample coordinate of each
 * vertex, so a single base volume covers every tiled copy.
 */
export type TerrainClipVolume =
  // A tunnel's ceiling follows its floor slope, so the cut is bounded by the
  // ceiling at each end (interpolated along the strip) rather than a single
  // height — otherwise a sloped tunnel clips terrain far above its deep end.
  | { kind: "strip"; a: [number, number]; b: [number, number]; halfWidth: number; ceilingA: number; ceilingB: number }
  | { kind: "box"; center: [number, number]; rotation: number; halfWidth: number; halfDepth: number; ceiling: number };

/**
 * Cut the hole slightly wider than the walkable interior (past the side walls,
 * which hide the cut) and slightly above the ceiling, so no rim of terrain
 * survives against the walls or roof of the opening.
 */
const CLIP_WIDTH_MARGIN = 0.35;
const CLIP_CEILING_MARGIN = 0.3;

/** Tunnel corridors and room chambers to cut out of the terrain mesh. */
export function terrainClipVolumes(map: CompositionMap): TerrainClipVolume[] {
  const volumes: TerrainClipVolume[] = [];
  for (const segment of map.segments) {
    if (!isTunnelSegment(segment)) continue;
    const height = tunnelHeight(map, segment, DEFAULT_ENCLOSURE_HEIGHT);
    const ya = pointElevation(map, mapPointKey(segment.start));
    const yb = pointElevation(map, mapPointKey(segment.end));
    volumes.push({
      kind: "strip",
      a: segment.start,
      b: segment.end,
      halfWidth: segment.width / 2 + CLIP_WIDTH_MARGIN,
      ceilingA: ya + height + CLIP_CEILING_MARGIN,
      ceilingB: yb + height + CLIP_CEILING_MARGIN,
    });
  }
  for (const room of map.rooms) {
    volumes.push({
      kind: "box",
      center: room.center,
      rotation: room.rotation,
      halfWidth: room.width / 2 + CLIP_WIDTH_MARGIN,
      halfDepth: room.depth / 2 + CLIP_WIDTH_MARGIN,
      ceiling: roomElevation(map, room) + room.height + CLIP_CEILING_MARGIN,
    });
  }
  return volumes;
}

export function buildTerrainField(
  generated: Pick<GeneratedEnvironment, "seed" | "params" | "center" | "size" | "edits" | "constraints">,
  sources: FlattenSource[],
  resolution = terrainResolution(generated.size),
): TerrainField {
  const { size, center } = generated;
  const verts = resolution + 1;
  const heights = new Float32Array(verts * verts);
  const cell = (size * 2) / resolution;

  const noiseHeight = (seed: number, x: number, z: number): number => {
    const scale = generated.params.terrainScale;
    return fbm2(seed, x / scale, z / scale, 4) * generated.params.terrainAmplitude;
  };

  // Pass 1: flatten mask per vertex.
  const weights = new Float32Array(verts * verts);
  const targets = new Float32Array(verts * verts);
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const { weight, target } = flattenAt(sources, generated.constraints.buffer, x, z);
      weights[iz * verts + ix] = weight;
      targets[iz * verts + ix] = target;
    }
  }

  // Pass 2: erode the target grid (3×3 minimum). The analytic target is NOT
  // concave — the envelope's outward penalty slope and clamped strip end caps
  // create convex creases — so interpolating per-vertex samples could bow a
  // chord ABOVE the true target between vertices, and through the path floor
  // (seen as terrain blobs on ramped corridors). Taking each vertex's minimum
  // over its neighborhood makes interpolated values conservative regardless
  // of the target field's shape: terrain may seat a little lower beside
  // slopes, never higher.
  // The WEIGHT field is eroded the same way (P32): a vertex one cell outside
  // the clearance carries a small nonzero weight, and on deep maps even a few
  // percent of free noise lifts it by metres (weight × |target − noise| scales
  // with depth). The triangle chord from a pinned in-strip vertex to that
  // lifted neighbor then rises above the path floor's FLATTEN_DROP margin
  // while still hanging over the walkable strip — the "sliver of terrain over
  // the path" seen around −35. With weights eroded, every vertex adjacent to a
  // pinned vertex is pinned too, so every triangle touching the strip has all
  // corners on the (eroded) target, regardless of depth or grid cell size.
  const eroded = targets.slice();
  const erodedWeights = weights.slice();
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      let lowest = targets[iz * verts + ix];
      let lowestWeight = weights[iz * verts + ix];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx;
          const nz = iz + dz;
          if (nx < 0 || nx > resolution || nz < 0 || nz > resolution) continue;
          const value = targets[nz * verts + nx];
          if (value < lowest) lowest = value;
          const weight = weights[nz * verts + nx];
          if (weight < lowestWeight) lowestWeight = weight;
        }
      }
      eroded[iz * verts + ix] = lowest;
      erodedWeights[iz * verts + ix] = lowestWeight;
    }
  }

  // Pass 3: combine with the free noise field.
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const index = iz * verts + ix;
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const rim = 1 - smoothstep((Math.max(Math.abs(x - center[0]), Math.abs(z - center[1])) - (size - RIM_BLEND)) / RIM_BLEND);
      const free = noiseHeight(generated.seed, x, z) * rim;
      heights[index] = lerp(eroded[index], free, erodedWeights[index]);
    }
  }

  const field: TerrainField = {
    center,
    size,
    resolution,
    heights,
    flattenWeight: erodedWeights,
    flattenTarget: eroded,
  };
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

/**
 * Derive the loop-aware display field from a base field: each vertex is
 * canonicalized into the loop's fundamental cell and, in a band before the
 * end seam, blended toward the transported start-side values (+ the loop's
 * vertical lift). The result is loop-invariant at the seam, so the wrap
 * teleport is invisible and edits near the start appear ahead of the end.
 * Also fills `shade`/`patch` so coloring matches across the seam.
 */
export function applyLoopToField(base: TerrainField, ctx: LoopFieldContext): TerrainField {
  const { center, size, resolution } = base;
  const verts = resolution + 1;
  const cell = (size * 2) / resolution;
  const heights = new Float32Array(verts * verts);
  const shade = new Float32Array(verts * verts);
  const patch = new Float32Array(verts * verts * 2);

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const index = iz * verts + ix;
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const canonical = canonicalizeLoopPoint(ctx, x, z);
      const s = loopProgress(ctx, canonical.x, canonical.z);
      const w = smoothstep((s - (1 - LOOP_BLEND_BAND)) / LOOP_BLEND_BAND);
      const here = terrainHeightAt(base, canonical.x, canonical.z);
      let blended = here;
      let px = canonical.x;
      let pz = canonical.z;
      if (w > 0) {
        const [bx, bz] = inverseTransformLoopPoint(ctx.forward, [canonical.x, canonical.z]);
        const there = terrainHeightAt(base, bx, bz);
        blended = here * (1 - w) + there * w;
        heights[index] = here * (1 - w) + (there + ctx.lift) * w + canonical.steps * ctx.lift;
        if (w > 0.5) {
          px = bx;
          pz = bz;
        }
      } else {
        heights[index] = here + canonical.steps * ctx.lift;
      }
      // The seam blend transports the start side's terrain (its hills) across
      // the end seam, but the transported height ignores the path running THROUGH
      // the display point. Where the two loop sides differ in elevation (a long
      // or curved loop, where the rigid transform mismaps off the corridor), the
      // blend lifts terrain pinned to the local path above its floor — terrain
      // visibly covering a deep path-loop. Pull such overshoot back DOWN toward
      // the local floor, weighted by how pinned the display point is: a vertex
      // on a path can't rise above its floor, free vertices keep the full blend,
      // and a transported dip (below the floor) is left untouched so the seam
      // stays continuous. The base field carries the floor/weight grids at this
      // display point because flattenSources includes the lifted loop copies.
      if (base.flattenWeight && base.flattenTarget) {
        const free = sampleGrid(base, base.flattenWeight, x, z, 1);
        if (free < 1) {
          const floor = sampleGrid(base, base.flattenTarget, x, z, 0);
          const excess = heights[index] - floor;
          if (excess > 0) heights[index] -= excess * (1 - free);
        }
      }
      shade[index] = blended;
      patch[index * 2] = px;
      patch[index * 2 + 1] = pz;
    }
  }

  return { center, size, resolution, heights, shade, patch };
}

/**
 * Derive the lattice-aware display field for square/hex tiled maps: each
 * vertex canonicalizes into the fundamental tile cell, and a band before each
 * far cell edge blends toward the neighboring translate (corner-weighted, so
 * the result is exactly periodic under both basis vectors). The analogue of
 * applyLoopToField for translation lattices; no vertical lift is involved.
 */
export function applyLatticeToField(base: TerrainField, ctx: LatticeContext): TerrainField {
  const { center, size, resolution } = base;
  // A cell that doesn't fit the generated region can't repeat meaningfully —
  // its neighbors' samples would fall outside the field.
  if (Math.max(Math.hypot(ctx.a[0], ctx.a[1]), Math.hypot(ctx.b[0], ctx.b[1])) > size) return base;
  const verts = resolution + 1;
  const cell = (size * 2) / resolution;
  const heights = new Float32Array(verts * verts);
  const shade = new Float32Array(verts * verts);
  const patch = new Float32Array(verts * verts * 2);

  const sample = (qx: number, qz: number, du: number, dv: number): number =>
    terrainHeightAt(base, qx - du * ctx.a[0] - dv * ctx.b[0], qz - du * ctx.a[1] - dv * ctx.b[1]);

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const index = iz * verts + ix;
      const x = center[0] - size + ix * cell;
      const z = center[1] - size + iz * cell;
      const [u, v] = latticeCoords(ctx, x, z);
      const fu = u - Math.floor(u);
      const fv = v - Math.floor(v);
      const [qx, qz] = latticePoint(ctx, fu, fv);
      const au = smoothstep((fu - (1 - LATTICE_BLEND_BAND)) / LATTICE_BLEND_BAND);
      const av = smoothstep((fv - (1 - LATTICE_BLEND_BAND)) / LATTICE_BLEND_BAND);
      const h =
        (1 - au) * (1 - av) * sample(qx, qz, 0, 0) +
        au * (1 - av) * sample(qx, qz, 1, 0) +
        (1 - au) * av * sample(qx, qz, 0, 1) +
        au * av * sample(qx, qz, 1, 1);
      heights[index] = h;
      shade[index] = h;
      // Patch-noise coords from the dominant corner so coloring repeats too.
      const du = au > 0.5 ? 1 : 0;
      const dv = av > 0.5 ? 1 : 0;
      patch[index * 2] = qx - du * ctx.a[0] - dv * ctx.b[0];
      patch[index * 2 + 1] = qz - du * ctx.a[1] - dv * ctx.b[1];
    }
  }

  return { center, size, resolution, heights, shade, patch };
}

/** Bilinear lookup of a per-vertex grid on a field; returns `outside` off-region. */
function sampleGrid(field: TerrainField, grid: Float32Array, x: number, z: number, outside: number): number {
  const { center, size, resolution } = field;
  const verts = resolution + 1;
  const cell = (size * 2) / resolution;
  const gx = (x - (center[0] - size)) / cell;
  const gz = (z - (center[1] - size)) / cell;
  if (gx < 0 || gz < 0 || gx > resolution || gz > resolution) return outside;
  const ix = Math.min(resolution - 1, Math.floor(gx));
  const iz = Math.min(resolution - 1, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const a = grid[iz * verts + ix];
  const b = grid[iz * verts + ix + 1];
  const c = grid[(iz + 1) * verts + ix];
  const d = grid[(iz + 1) * verts + ix + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Bilinear height lookup; returns 0 outside the generated region. */
export function terrainHeightAt(field: TerrainField, x: number, z: number): number {
  return sampleGrid(field, field.heights, x, z, 0);
}
