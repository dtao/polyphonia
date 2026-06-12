# Terrain "blobs" covering paths in generated worlds

## Symptom

In a generated world (reported in "Open meadow"), green blobs / "patches of
grass" cover the walkable path. Reported in three rounds:

1. Around descending elevation changes (the bottom of ramps).
2. Around rising paths: draw a segment into open terrain, raise its terminal
   branch point's elevation — terrain appears to spill onto the path.
3. After two terrain-field fixes, round 2 reproduced with **no improvement**.

## Attempts

1. `018f204` — lower-envelope flatten target. Fixed a real defect: grid-cell
   chords cutting above the path at concave elevation kinks. User confirmed
   improvement for the descending case.
2. `eefee07` — cap the envelope at the nearest source's height. Fixed a real
   defect: the envelope's distance penalty anchored the blend band above
   rising paths (collar ridges). User saw **no improvement** for their repro.

## Evidence

Numeric probes (vitest, deterministic seeds) across flat, descending, rising,
and loop-with-branch maps all show the *field* is correct after the two
fixes: terrain ≤ path surface − `FLATTEN_DROP` along every probed corridor,
including inside the path-loop blend band (the loop transport stays
consistent because `flattenSources` includes tiled copies of all segments —
a hypothesis that the loop blend ignored new branches was disproved by
probe).

Therefore the visible spill is most likely **not the terrain mesh**. The
prime suspect matching the repro exactly: **scatter objects placed before the
path existed**. Constraint rejection only ran at generation time; drawing a
path through existing meadow left grass/shrub objects in the corridor, and
since object height rides the (correctly flattened) terrain, raising the path
lifts them onto the visible path surface — reading as grass patches on the
path. Neither terrain fix could affect this.

## Fix applied (third round)

Display-time suppression: generated (non-user-placed) objects whose footprint
falls inside the *current* clear zones are hidden, using the same margin the
scatterer uses for placement (`objectBlockedByClearZone`). Non-destructive —
the manifest keeps them, so they return if the path moves away. Loop copies
are filtered the same way. Regression test:
"flags previously generated objects that a NEW path now runs through".

## Diagnostics, if it still reproduces

Run with `?debug=1&debugTerrainProbe=1`, stand on an affected patch, and
collect a few `[terrain-probe]` lines from the console (also available as
`window.polyTerrainProbe`). Each sample reports:

- `surfaceY` vs `terrainY` — if `terrainY > surfaceY` the terrain mesh itself
  is above the path there (field bug; report coordinates).
- `flattenWeight` / `flattenTarget` — whether the position is recognized as
  inside a clear zone (`weight` should be 0 on the path).
- `constraints` — confirms the stems/paths toggles and buffer in effect
  (paths toggle OFF fully explains terrain crossing paths).
- `tiling` + `loopProgress`/`loopBand` — whether the spot sits in the
  path-loop blend band.
- `nearbyObjects` — scatter objects within 5 units, with kind, distance, and
  whether suppression applies; objects listed without `SUPPRESSED` while
  visually sitting on the path indicate the suppression rule missed them.

Also worth confirming on a repro: hard-reload so the dev server serves the
current build, and whether the blobs are smooth ground-colored mounds
(terrain) or shaped clumps (grass tufts / shrubs — scatter objects).

## Status

Third fix addresses the only mechanism consistent with all evidence that the
terrain fixes couldn't touch. Awaiting user verification; the probe exists to
discriminate the remaining hypotheses (constraints toggled off, stale build,
or a field defect at coordinates the probes didn't model).
