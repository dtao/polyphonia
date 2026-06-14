// Pure spatial math for audio — extracted from AudioEngine so it can be
// tested and benchmarked independently of the Web Audio API.

import type { StemShape } from "../composition";
import { CompositionMap, LoopPreviewTransform, loopPreviewElevationOffset, transformLoopPoint } from "../map";

export interface AudibleInstance {
  id: string;
  position: [number, number, number];
  direction: [number, number];
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Returns the closest point on the stem's spatial shape to the listener.
 * For point sources (orb, absent) this is just the tile centre.
 *
 * @param shape      The stem's StemShape (may be undefined for a plain orb).
 * @param stemPos    The stem's base world position (untiled).
 * @param tilePos    The tile copy's world position (equals stemPos for the base instance).
 * @param lx ly lz  Listener world position.
 */
export function effectivePannerPosition(
  shape: StemShape | undefined,
  stemPos: [number, number, number],
  tilePos: [number, number, number],
  lx: number,
  ly: number,
  lz: number,
): [number, number, number] {
  if (shape?.kind === "pillar") {
    // Elevate panner to listener height so only horizontal XZ distance drives falloff.
    return [tilePos[0], ly, tilePos[2]];
  }
  if (shape?.kind === "river") {
    // The segment runs from stemPos to shape.end. Tile copies get the same
    // offset as the tile base position, so the segment translates with the tile.
    const [bx, by, bz] = tilePos;
    const ox = tilePos[0] - stemPos[0];
    const oy = tilePos[1] - stemPos[1];
    const oz = tilePos[2] - stemPos[2];
    const ex = shape.end[0] + ox;
    const ey = shape.end[1] + oy;
    const ez = shape.end[2] + oz;
    const sdx = ex - bx, sdz = ez - bz;
    const lenSq = sdx * sdx + sdz * sdz;
    const t = lenSq > 0 ? clamp(((lx - bx) * sdx + (lz - bz) * sdz) / lenSq, 0, 1) : 0;
    return [bx + t * sdx, by + t * (ey - by), bz + t * sdz];
  }
  if (shape?.kind === "wall") {
    // Project listener XZ onto the wall's tangent axis (perpendicular to facing),
    // clamp to ±width/2, then resolve back to world XZ. Panner Y tracks the
    // listener so horizontal distance drives falloff correctly.
    const [fx, fz] = shape.facing;
    const tx = -fz, tz = fx; // tangent = 90° CCW from facing in XZ
    const dx = lx - tilePos[0];
    const dz = lz - tilePos[2];
    const along = dx * tx + dz * tz;
    const clamped = clamp(along, -shape.width / 2, shape.width / 2);
    return [tilePos[0] + clamped * tx, ly, tilePos[2] + clamped * tz];
  }
  return tilePos;
}

/** Squared distance from a world point to the listener. */
export function distanceSqToListener(
  [px, py, pz]: [number, number, number],
  lx: number,
  ly: number,
  lz: number,
): number {
  const dx = lx - px, dy = ly - py, dz = lz - pz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Filters and sorts candidate stem instances by distance, returning only those
 * within audibleDistanceSq and up to maxInstances count.
 */
export function filterAudibleCandidates<T extends { position: [number, number, number] }>(
  candidates: T[],
  audibleDistanceSq: number,
  maxInstances: number,
  lx: number,
  ly: number,
  lz: number,
): T[] {
  const sorted = candidates
    .slice()
    .sort((a, b) => distanceSqToListener(a.position, lx, ly, lz) - distanceSqToListener(b.position, lx, ly, lz));
  return sorted
    .filter((c) => distanceSqToListener(c.position, lx, ly, lz) <= audibleDistanceSq)
    .slice(0, maxInstances);
}

/**
 * Chooses which instances of a stem are audible for the current listener: the
 * base (untiled) stem plus any path-loop / tile copies near the listener,
 * limited to the nearest `maxInstances`.
 *
 * Crucially, the base-distance cull is only applied when there is NO loop/tile
 * wrapping near the listener (`previews` empty). When previews exist, a far base
 * may have a wrapped copy sitting right next to the listener — e.g. a stem near
 * a path-loop seam once the listener crosses it — so we build every candidate
 * and let the distance filter decide. Culling on base distance here is what
 * silenced near-seam stems across the seam.
 */
export function selectAudibleTrackInstances(
  base: [number, number, number],
  direction: [number, number],
  previews: LoopPreviewTransform[],
  map: Pick<CompositionMap, "elevations" | "tiling"> | null,
  audibleDistanceSq: number,
  maxInstances: number,
  lx: number,
  ly: number,
  lz: number,
): AudibleInstance[] {
  if (!map || !previews.length) {
    if (distanceSqToListener(base, lx, ly, lz) > audibleDistanceSq) return [];
    return [{ id: "base", position: base, direction }];
  }

  const candidates: AudibleInstance[] = [{ id: "base", position: base, direction }];
  for (const preview of previews) {
    const [x, z] = transformLoopPoint(preview, [base[0], base[2]]);
    const c = Math.cos(preview.rotation);
    const s = Math.sin(preview.rotation);
    candidates.push({
      id: preview.id,
      position: [x, base[1] + loopPreviewElevationOffset(map, preview), z],
      direction: [direction[0] * c + direction[1] * s, -direction[0] * s + direction[1] * c],
    });
  }
  return filterAudibleCandidates(candidates, audibleDistanceSq, maxInstances, lx, ly, lz);
}
