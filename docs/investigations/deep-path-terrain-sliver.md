# Sliver of terrain visible over a deep path (P32)

## Symptom

On a map whose path descends well below 0 elevation (observed around −35), a
thin sliver of generated terrain is visible crossing over/through the walkable
path surface. Reported after the earlier chord-bowing fix (the 3×3 target
erosion in `buildTerrainField`), so this is a distinct or residual mechanism.

## Reproduction conditions (as known)

- Generated world enabled; path reaching roughly −35 elevation.
- Exact map shape, tiling mode, region size, and the sliver's location relative
  to the path (mid-strip? near a joint? near the loop seam? near the region
  rim?) are not yet recorded — these are the key discriminators below.

## Attempts

1. **3×3 target erosion** (pre-existing): made interpolated flatten *targets*
   conservative. Fixed ramped-corridor blobs; sliver still reported at depth.
2. **3×3 weight erosion** (this change, 2026-06-11): the *weight* field is now
   eroded with the same minimum filter. Rationale: a vertex one cell outside
   the clearance carries a small nonzero blend weight, and at depth −35 even
   5% of free noise lifts it metres above the pinned target; the triangle
   chord back to a pinned in-strip vertex could rise above the floor's 0.12
   `FLATTEN_DROP` margin while still hanging over the strip (cell size exceeds
   the 3-unit buffer once the region's resolution caps at 128). With weights
   eroded, every triangle touching the strip has all corners fully pinned at
   any depth. A regression test covers this geometry
   (`worldgen.test.ts`, "never pokes terrain above a deep path").

## Evidence gathered

- Synthetic deep maps (straight −35 corridor, size 200; descending −35
  path-loop with `applyLoopToField`) scanned across the whole strip stay below
  the floor both before and after attempt 2 — so the authored map exercises a
  condition the synthetic ones don't.

## Current hypotheses

1. **Per-vertex weight lift** (addressed by attempt 2) — depth-proportional;
   matches "deep maps only".
2. **Loop-seam sentinel**: `terrainHeightAt` returns 0 for samples outside the
   generated region; `applyLoopToField` blends toward transported samples that
   could fall outside, mixing a 0-height sentinel with a large negative lift
   and landing terrain at/above the floor near the seam. Synthetic test didn't
   trigger it (samples stayed in-region) — would require the seam band to
   reach the region edge.
3. **Rim blend**: within `RIM_BLEND` (26 units) of the region edge, free
   terrain fades toward height 0, far above a −35 path. Weight stays 0 over
   the strip, but partially-blended vertices beside it are lifted toward 0; a
   chained interaction with large cells could still cross the floor near the
   rim.

## Next discriminating checks (for the reporter)

1. Re-test the affected composition on this build. If the sliver is gone,
   attempt 2 was the cause — close this note.
2. If still visible, note WHERE the sliver appears relative to (a) the
   path-loop seam, (b) the edge of the generated region (toggle the world off
   and on to gauge the rim), and (c) path joints. Near the seam → hypothesis 2;
   near the rim → hypothesis 3.
3. A screenshot plus the composition's exported `.polyphonia.json` (map +
   generated params reproduce the terrain deterministically from the seed)
   would let the field be rebuilt and scanned offline exactly.
