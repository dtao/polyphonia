// Where the generated terrain region lives, derived from the LIVE map so its
// edge can never be seen ("the world goes on forever"):
//
//  - Bounded maps (paths/rooms/platforms): the region is the walkable
//    bounding box expanded by the visible radius plus a margin, so from any
//    reachable point the region edge (and its rim band) lies beyond the fog.
//    It re-derives when the map changes, so growing a path grows the world.
//  - Square/hex tiled maps: the region anchors to the tiling origin cell —
//    the field is exactly lattice-periodic (lattice.ts), so the scene slides
//    the terrain MESH by whole lattice steps to follow the viewer; sliding a
//    periodic mesh is visually a no-op, making the world infinite for free.
//  - Open boundless maps (no walkable bounds, no tiling): the region follows
//    the viewer, recentering in coarse quanta. The noise is world-anchored,
//    so a recentered rebuild reproduces identical terrain where the regions
//    overlap; the quantum is a multiple of the grid cell so vertices land on
//    the same world lattice and the rebuild is invisible.
//
// The stored manifest center/size are ignored (kept only for manifest
// compatibility); deriving live is what guarantees coverage.

import { CompositionMap, hasWalkableBounds } from "../map";
import { RADIAL_FADE_OUTER } from "../scene/fade";
import { LatticeContext, latticeContext, latticeCoords, latticePoint } from "./lattice";

export interface GeneratedRegion {
  center: [number, number];
  size: number;
  follow: "none" | "lattice" | "recenter";
}

/** Beyond the visible radius: room for the rim band plus slack. */
const REGION_SLACK = 34;
const MIN_REGION_SIZE = 140;
/** Resolution is capped, so giant regions trade cell size; cap the trade. */
const MAX_REGION_SIZE = 560;
/** Recenter quantum for viewer-following regions (multiple of the 4u cell). */
const RECENTER_QUANTUM = 64;
/** Fixed grid cell for viewer-following regions (keeps vertices on a fixed
 * world lattice across recenters — see terrainResolutionFor). */
const FOLLOW_CELL = 4;

function outerRadius(map: Pick<CompositionMap, "visibleRadius">): number {
  return map.visibleRadius?.outer ?? RADIAL_FADE_OUTER;
}

export function deriveRegion(map: CompositionMap, viewer: [number, number]): GeneratedRegion {
  const margin = outerRadius(map) + REGION_SLACK;

  const lattice = latticeContext(map);
  if (lattice) {
    const step = Math.max(Math.hypot(lattice.a[0], lattice.a[1]), Math.hypot(lattice.b[0], lattice.b[1]));
    return {
      center: latticePoint(lattice, 0.5, 0.5),
      size: clampSize(margin + step + 30),
      follow: "lattice",
    };
  }

  if (hasWalkableBounds(map)) {
    let minX = map.start.position[0];
    let maxX = map.start.position[0];
    let minZ = map.start.position[1];
    let maxZ = map.start.position[1];
    const include = (x: number, z: number, reach = 0) => {
      minX = Math.min(minX, x - reach);
      maxX = Math.max(maxX, x + reach);
      minZ = Math.min(minZ, z - reach);
      maxZ = Math.max(maxZ, z + reach);
    };
    for (const segment of map.segments) {
      include(segment.start[0], segment.start[1], segment.width / 2);
      include(segment.end[0], segment.end[1], segment.width / 2);
    }
    for (const room of map.rooms) include(room.center[0], room.center[1], Math.hypot(room.width, room.depth) / 2);
    for (const platform of map.platforms) include(platform.center[0], platform.center[1], Math.max(platform.width, platform.depth) / 2);
    for (const wall of map.walls) {
      include(wall.start[0], wall.start[1]);
      include(wall.end[0], wall.end[1]);
    }
    const halfExtent = Math.max(maxX - minX, maxZ - minZ) / 2;
    return {
      center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
      size: clampSize(halfExtent + margin),
      follow: "none",
    };
  }

  // Open boundless roaming: follow the viewer in cell-aligned quanta.
  const quantize = (value: number) => Math.round(value / RECENTER_QUANTUM) * RECENTER_QUANTUM;
  return {
    center: [quantize(viewer[0]), quantize(viewer[1])],
    size: followSize(map),
    follow: "recenter",
  };
}

function clampSize(size: number): number {
  return Math.max(MIN_REGION_SIZE, Math.min(MAX_REGION_SIZE, size));
}

function followSize(map: Pick<CompositionMap, "visibleRadius">): number {
  // Edge distance from the viewer ≥ size − quantum/2 must exceed the visible
  // radius + rim; round up to keep the cell exactly FOLLOW_CELL.
  const needed = outerRadius(map) + REGION_SLACK + RECENTER_QUANTUM / 2 + 30;
  return Math.ceil(needed / (FOLLOW_CELL * 2)) * (FOLLOW_CELL * 2);
}

/** Grid resolution for a derived region (follow regions pin the cell size). */
export function regionResolution(region: GeneratedRegion): number {
  if (region.follow === "recenter") return Math.round((region.size * 2) / FOLLOW_CELL);
  return Math.max(64, Math.min(192, Math.round(region.size / 1.5)));
}

/**
 * Canonicalize a world point for height lookups against a lattice-periodic
 * field: bring it within the field by whole lattice steps toward the field
 * center (the field repeats, so the height there is the height here).
 */
export function canonicalFieldPoint(
  lattice: LatticeContext | null,
  fieldCenter: [number, number],
  x: number,
  z: number,
): [number, number] {
  if (!lattice) return [x, z];
  const [u0, v0] = latticeCoords(lattice, fieldCenter[0], fieldCenter[1]);
  const [u, v] = latticeCoords(lattice, x, z);
  const di = Math.round(u - u0);
  const dj = Math.round(v - v0);
  if (di === 0 && dj === 0) return [x, z];
  return [
    x - di * lattice.a[0] - dj * lattice.b[0],
    z - di * lattice.a[1] - dj * lattice.b[1],
  ];
}
