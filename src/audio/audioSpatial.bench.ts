// Benchmarks for the hot spatial-audio paths that run every acoustics tick.
// Run with: npm run bench
// Save a new baseline: npm run bench:baseline
// Compare against baseline: npm run bench:compare

import { bench, describe } from "vitest";
import { effectivePannerPosition, distanceSqToListener, filterAudibleCandidates } from "./audioSpatial";
import type { StemShape } from "../composition";

// ---------------------------------------------------------------------------
// effectivePannerPosition — called once per live audio instance per tick.
// For a 200-stem composition this runs 200+ times per acoustics frame.
// ---------------------------------------------------------------------------

const STEM_POS: [number, number, number] = [0, 0, 0];
const TILE_POS: [number, number, number] = [0, 0, 0];
const LX = 7.3, LY = 1.7, LZ = -4.1;

describe("effectivePannerPosition", () => {
  bench("orb (undefined shape)", () => {
    effectivePannerPosition(undefined, STEM_POS, TILE_POS, LX, LY, LZ);
  });

  bench("pillar", () => {
    const shape: StemShape = { kind: "pillar" };
    effectivePannerPosition(shape, STEM_POS, TILE_POS, LX, LY, LZ);
  });

  bench("wall (listener front side)", () => {
    const shape: StemShape = { kind: "wall", facing: [1, 0], width: 20 };
    effectivePannerPosition(shape, STEM_POS, TILE_POS, LX, LY, LZ);
  });

  bench("wall (listener clamped at edge)", () => {
    const shape: StemShape = { kind: "wall", facing: [1, 0], width: 4 };
    effectivePannerPosition(shape, STEM_POS, TILE_POS, 50, LY, LZ);
  });

  bench("river (listener near midpoint)", () => {
    const shape: StemShape = { kind: "river", end: [30, 0, 0] };
    effectivePannerPosition(shape, STEM_POS, TILE_POS, LX, LY, LZ);
  });

  bench("river (degenerate zero-length)", () => {
    const shape: StemShape = { kind: "river", end: [0, 0, 0] };
    effectivePannerPosition(shape, STEM_POS, TILE_POS, LX, LY, LZ);
  });
});

// ---------------------------------------------------------------------------
// distanceSqToListener — called multiple times per instance per tick.
// ---------------------------------------------------------------------------

describe("distanceSqToListener", () => {
  const POS: [number, number, number] = [12, 3, -8];
  bench("point distance", () => {
    distanceSqToListener(POS, LX, LY, LZ);
  });
});

// ---------------------------------------------------------------------------
// filterAudibleCandidates — the sort + cull inside audibleTrackInstances.
// With a tiled map each track builds a candidate list of base + tile copies
// before filtering. Worst case per-track is ~maxVirtualInstances copies.
// These benches simulate the full-composition loop at various stem counts.
// ---------------------------------------------------------------------------

function makeCandidates(n: number, audibleFraction: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? "base" : `tile-${i}`,
    position: [
      (i / n) * 200 - 100,
      0,
      (i / n) * 200 * (audibleFraction - 0.5),
    ] as [number, number, number],
    direction: [0, -1] as [number, number],
  }));
}

// Simulate single-track candidate lists (base + a few tile copies).
const CANDIDATES_4 = makeCandidates(4, 0.5);
const CANDIDATES_8 = makeCandidates(8, 0.5);

describe("filterAudibleCandidates (per track, tiled map)", () => {
  bench("4 candidates (base + 3 tiles)", () => {
    filterAudibleCandidates(CANDIDATES_4, 3600, 4, LX, LY, LZ);
  });

  bench("8 candidates (base + 7 tiles)", () => {
    filterAudibleCandidates(CANDIDATES_8, 3600, 4, LX, LY, LZ);
  });
});

// Simulate the HRTF tier sort: one entry per live audio instance across all
// tracks. For a composition with N stems each having 1 base instance this is
// an N-element sort run once per acoustics tick (not per track).
function makeInstances(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    distSq: ((i * 137.5) % 10000), // deterministic pseudo-spread
  }));
}

const INSTANCES_10 = makeInstances(10);
const INSTANCES_50 = makeInstances(50);
const INSTANCES_200 = makeInstances(200);

describe("HRTF tier sort (all instances, one sort per tick)", () => {
  bench("N=10 stems", () => {
    INSTANCES_10.slice().sort((a, b) => a.distSq - b.distSq);
  });

  bench("N=50 stems", () => {
    INSTANCES_50.slice().sort((a, b) => a.distSq - b.distSq);
  });

  bench("N=200 stems", () => {
    INSTANCES_200.slice().sort((a, b) => a.distSq - b.distSq);
  });
});
