// Path-loop awareness for generated environments.
//
// A path-loop map wraps the listener from the end loop point back to the start
// (a rigid transform: translate + rotate + lift). For the wrap to be invisible,
// the terrain and objects visible around the end seam must be the start's
// surroundings, transformed — your hill next to the start loop point should be
// visible ahead as you approach the end.
//
// Rather than rendering overlapping terrain copies (a dense opaque blanket
// would z-fight itself), the *field* is made loop-invariant: every sample point
// is canonicalized into the fundamental domain (the corridor cell between the
// two seams) and, in a band before the end seam, blended toward the transported
// start-side values. Invariance is exact at the seam — where the player wraps —
// and approximate elsewhere; far-off-corridor mismatch hides under the same
// distance fade that already masks the structural map-copy seam.
//
// Discrete objects do get transformed copies (they're sparse, like stems), and
// composer edits near the end seam are stored at their fundamental-domain
// position so they land where the display says they are. See loopEditPoint.

import {
  CompositionMap,
  LoopPreviewTransform,
  inverseTransformLoopPoint,
  loopPreviewElevationOffset,
  loopPreviewTransforms,
  transformLoopPoint,
} from "../map";

export interface LoopFieldContext {
  /** Maps the base domain (anchored at the start seam) onto the copy beyond the end seam. */
  forward: LoopPreviewTransform;
  start: [number, number];
  end: [number, number];
  /** Straight-line distance between the loop endpoints. */
  length: number;
  /** Vertical lift per loop step (endless ascent/descent corridors). */
  lift: number;
}

/** Fraction of loop progress, before the end seam, over which the field blends. */
export const LOOP_BLEND_BAND = 0.25;

export function loopFieldContext(
  map: Pick<CompositionMap, "segments" | "tiling" | "elevations">,
): LoopFieldContext | null {
  if (map.tiling.type !== "path-loop") return null;
  const forward = loopPreviewTransforms(map, [0, 0], Infinity).find((preview) => preview.id === "end");
  if (!forward) return null;
  const start = forward.source;
  const end = forward.anchor;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (length < 4) return null;
  return { forward, start, end, length, lift: loopPreviewElevationOffset(map, forward) };
}

/**
 * Progress along the loop: ~0 at (and behind) the start seam, ~1 at the end
 * seam, growing past 1 beyond it. Built from the distance difference to the
 * two seam points, so it needs no corridor axis and tolerates curved loops;
 * it is only approximately transform-equivariant away from the corridor.
 */
export function loopProgress(ctx: LoopFieldContext, x: number, z: number): number {
  const dStart = Math.hypot(x - ctx.start[0], z - ctx.start[1]);
  const dEnd = Math.hypot(x - ctx.end[0], z - ctx.end[1]);
  return (dStart - dEnd) / (2 * ctx.length) + 0.5;
}

export interface CanonicalLoopPoint {
  x: number;
  z: number;
  /** How many forward loop steps were unwound to reach the fundamental cell. */
  steps: number;
}

/** Map a point into the fundamental cell (loop progress in [0, 1)). */
export function canonicalizeLoopPoint(ctx: LoopFieldContext, x: number, z: number): CanonicalLoopPoint {
  let steps = 0;
  for (let i = 0; i < 6; i++) {
    const s = loopProgress(ctx, x, z);
    if (s >= 1) {
      [x, z] = inverseTransformLoopPoint(ctx.forward, [x, z]);
      steps++;
    } else if (s < 0) {
      [x, z] = transformLoopPoint(ctx.forward, [x, z]);
      steps--;
    } else {
      break;
    }
  }
  return { x, z, steps };
}

/**
 * Where a composer edit (brush center, placed object) clicked at `point`
 * should be stored. Inside the override zone before the end seam the display
 * shows the transported start-side world, so the edit is stored there — one
 * loop step back — and shows up under the cursor via the transport.
 */
export function loopEditPoint(
  map: Pick<CompositionMap, "segments" | "tiling" | "elevations">,
  point: [number, number],
): [number, number] {
  const ctx = loopFieldContext(map);
  if (!ctx) return point;
  const canonical = canonicalizeLoopPoint(ctx, point[0], point[1]);
  let mapped: [number, number] = [canonical.x, canonical.z];
  if (loopProgress(ctx, mapped[0], mapped[1]) >= 1 - LOOP_BLEND_BAND / 2) {
    mapped = inverseTransformLoopPoint(ctx.forward, mapped);
  }
  return [Math.round(mapped[0] * 100) / 100, Math.round(mapped[1] * 100) / 100];
}
