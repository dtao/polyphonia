// Square/hex tile awareness for generated terrain.
//
// Square and hex tilings repeat the map by pure translations on a lattice
// (square: orthogonal basis; hex: skewed basis). Like the path-loop case
// (loop.ts), the terrain field is made invariant under those translations so
// hills repeat with the map: every sample canonicalizes into the fundamental
// cell, and a band before each cell edge blends toward the neighboring
// translate. The construction is exactly periodic, so crossing a tile seam
// never changes the scenery, and a sculpted hill appears in every copy.

import { CompositionMap, MapTiling } from "../map";
import { loopEditPoint } from "./loop";

export interface LatticeContext {
  origin: [number, number];
  /** Lattice basis vectors. */
  a: [number, number];
  b: [number, number];
  /** Inverse basis (row-major 2×2), for world → lattice coordinates. */
  inv: [number, number, number, number];
}

/** Fraction of a cell, before each far edge, over which the field blends. */
export const LATTICE_BLEND_BAND = 0.25;

export function latticeContext(map: Pick<CompositionMap, "tiling">): LatticeContext | null {
  const tiling: MapTiling = map.tiling;
  if (tiling.type !== "square" && tiling.type !== "hex") return null;
  const size = Math.max(1, tiling.tileSize);
  const a: [number, number] = [size, 0];
  // Hex centers step (size, 0) and (size/2, √3/2·size) — see the tile overlays
  // in Scene.tsx; these two translations generate the whole hex lattice.
  const b: [number, number] = tiling.type === "square" ? [0, size] : [size / 2, (Math.sqrt(3) / 2) * size];
  const det = a[0] * b[1] - a[1] * b[0];
  return {
    origin: tiling.origin,
    a,
    b,
    inv: [b[1] / det, -b[0] / det, -a[1] / det, a[0] / det],
  };
}

/** World position → lattice coordinates (integer part = cell index). */
export function latticeCoords(ctx: LatticeContext, x: number, z: number): [number, number] {
  const dx = x - ctx.origin[0];
  const dz = z - ctx.origin[1];
  return [ctx.inv[0] * dx + ctx.inv[1] * dz, ctx.inv[2] * dx + ctx.inv[3] * dz];
}

/** Lattice coordinates → world position. */
export function latticePoint(ctx: LatticeContext, u: number, v: number): [number, number] {
  return [
    ctx.origin[0] + ctx.a[0] * u + ctx.b[0] * v,
    ctx.origin[1] + ctx.a[1] * u + ctx.b[1] * v,
  ];
}

/**
 * Where a composer edit clicked at `point` should be stored on a tiled map:
 * the same spot expressed in the fundamental cell (the display field samples
 * only that cell, so an edit left in another tile would never show).
 * Handles path-loop maps too; non-tiled maps pass through.
 */
export function worldEditPoint(
  map: Pick<CompositionMap, "segments" | "tiling" | "elevations">,
  point: [number, number],
): [number, number] {
  if (map.tiling.type === "path-loop") return loopEditPoint(map, point);
  const ctx = latticeContext(map);
  if (!ctx) return point;
  const [u, v] = latticeCoords(ctx, point[0], point[1]);
  const [x, z] = latticePoint(ctx, u - Math.floor(u), v - Math.floor(v));
  return [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
}
