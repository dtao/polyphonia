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

## Round (2026-06-19): reported at −67 on a path-loop, synthetic still clean

User reports terrain visibly covering the path (and hiding nearby stems in
Edit mode) on a **path-loop** map whose path dips to about −67 — roughly twice
the previously reported depth. User's intuition: the loop elevation
smoothing/averaging (`applyLoopToField` / the loop blend band) is involved.

Synthetic reproduction attempt (offline scan of `buildTerrainField` +
`applyLoopToField`, size-200 region, two-segment loop, every corridor point
−3..+3 across, x from 0 into the wrapped copy):

| Config | lift | worst `terrain − surface` |
|---|---|---|
| dip to −67 at the joint, endpoints 0 | 0 | −0.12 (= `FLATTEN_DROP`, fine) |
| uniform −67 across the whole loop | 0 | −0.12 |
| descending 0 → −34 → −67 | −67 | −1.84 |
| descending 0 → −67 (steep) | −67 | −0.12 |

Every synthetic deep path-loop keeps terrain strictly below the path, including
across the seam and into the wrapped copy. So the loop blend (and the
sentinel-0 / rim-toward-0 hypotheses below) do **not** fire on straight,
on-grid loop geometry at −67 — consistent with rounds 1–4, where only the
user's authored (off-grid / curved / branched) map exercised the defect.

Untriggered-but-still-live hypotheses, both depth-proportional (worse at −67):

- **Sentinel-0 loop blend** (`terrain.ts` `applyLoopToField`, ~L489/L495):
  `terrainHeightAt` returns 0 outside the region; the blend mixes `here`/`there`
  transported samples that can fall outside, injecting a +67 spike. Needs the
  blend band (or a canonicalized/transported sample) to reach beyond the region
  edge — which curved/branched loops can do but a straight corridor can't.
- **Rim-toward-0** (`terrain.ts` `buildTerrainField` pass 3, ~L381): free noise
  fades to height 0 within `RIM_BLEND` of the region edge, lifting the rim band
  ~67 units toward sea level on a deep map.

### Next discriminating checks (for the reporter) — the decisive data

Run the build with `?debug=1&debugTerrainProbe=1`, stand on a spot where
terrain visibly covers the path, and collect a few `[terrain-probe]` console
lines (also `window.polyTerrainProbe`). The single decisive comparison:

- **`terrainY > surfaceY`** → the terrain *mesh* is genuinely above the path
  (field bug). Note `flattenWeight` (should be 0 on the path), `flattenTarget`,
  `loopProgress`/`loopBand`, and the `at` coords. `loopBand: true` near the spot
  implicates the loop blend; a spot near the region rim implicates rim-toward-0.
- **`terrainY ≤ surfaceY`** (terrain is actually below) → it is NOT the terrain
  field; the visual cover is something else (a structural map copy, an
  enclosure/room mesh, or scatter objects). Look at what is actually drawn.

Also export the composition's `.polyphonia.json` — with map + generated params
the exact field can be rebuilt and scanned offline, which is what every prior
round needed and only the authored map provides.

## Root cause found and fixed (2026-06-21)

User probe on the affected spot was decisive:

`{"at":[41.3,-414.9],"surfaceY":-54.6,"terrainY":-51.94,"flattenWeight":0,
"flattenTarget":-54.72,"loopProgress":0.79,"loopBand":true}`

`flattenWeight: 0` (fully pinned, on a path) with `terrainY` **2.66 ABOVE**
`surfaceY` and 2.78 above its own `flattenTarget`, inside the loop blend band.
So it was the **terrain mesh**, lifted by `applyLoopToField`, not scatter or a
structural copy.

Mechanism: the seam blend transports the start side's terrain across the end
seam (`here*(1-w) + (there+lift)*w`) to hide the wrap. That transported height
ignores the path running *through* the display point. On a long/curved loop the
distance-based `loopProgress` and the single rigid transform mismap off the
corridor, so `there + lift` is the *wrong* (shallow) elevation — and the blend
lifts terrain that is pinned to the local deep path up above its floor. Scales
with depth and with the loop's elevation asymmetry, so it was invisible at −35
on near-symmetric synthetic loops but blanketed the path at −67.

Why synthetic loops never reproduced: `flattenSources` tiles every segment into
loop copies, so a straight/axis-aligned loop's base field is loop-periodic
(`there ≈ here − lift`) and the blend is a no-op at pinned points. The break
only appears when the rigid transform can't realign the geometry (curved loop,
or features off the corridor) — reproduced with a deep spur jutting
perpendicular near the end seam.

Fix (`buildTerrainField` + `applyLoopToField` in `worldgen/terrain.ts`): the
base field now carries its eroded flatten weight/target grids. In the loop
blend, any vertex whose display position is pinned (or near-pinned) has its
*overshoot above the local floor* pulled back down, weighted by pinned-ness —
free vertices keep the full blend (hills still transport across the seam), and a
transported dip *below* the floor is left untouched so the seam stays
continuous. Regression test: "never lifts terrain above a pinned path in the
seam blend band (deep loop)".

Status: fixed; awaiting user confirmation on the actual −67 composition.
