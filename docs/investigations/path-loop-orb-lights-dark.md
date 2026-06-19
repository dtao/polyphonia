# Path-loop orbs render but cast no floor light

## Symptom

On a large path-loop composition, after teleporting a significant distance down
the path, glowing orb spheres are visible right next to the listener but they do
not illuminate the floor/path. Closer to the start the path lights normally.

## Reproduction conditions

- Map: `tiling.type === "path-loop"`, `tileSize: 80`, origin `[0,0]`.
- 174 tracks; track positions span x −48..101, z −566..32 (a long corridor).
- 15 segments; start at `[0,36]` facing `[0,-1]`.
- Explore mode, teleported to a pin far down the path (large |z|).

## Evidence

`window.polyLights` readings (via `?debug=1`):

- In the dark zone (default budget): `{ fps: 30, tier: 5, poolSize: 0, candidates: 52, active: 0 }`.
- Forcing budget `?lightBudget=8`: `{ fps: 30, tier: 0, poolSize: 8, candidates: 52, active: 8 }`
  — 8 lights are chosen and assigned, **but the floor still does not light.**
- `?debugNoFlare=1&debugNoStarRays=1`: no change to fps (still 30) — the orb glow
  shaders are not the frame-rate bottleneck.

## Ruled out

- **Light budget / adaptive tier collapse.** Forcing 8 active lights did not light
  the floor, so the zero-pool tier collapse is not the (whole) cause here.
- **Orb glow-shader fill cost.** Disabling flare/star-rays did not move fps.
- **`verticalFadeAtY`.** Returns 1 unless the composition authored a vertical band
  (`_compVerticalInner/Outer`); unconfirmed for this map but unlikely.

## Current hypotheses

1. The 8 chosen lights are real but **distant and/or near-zero intensity** — the
   only candidates within the radial-fade cutoff are far orbs faded toward 0, so
   their short `range` (~12–36) never reaches the listener's floor. The orbs the
   user *sees* nearby would then be visual preview copies that are **not present
   in the light candidate set** — i.e. the visual orb-copy generation range and
   the `gatherCandidates` copy range have diverged.
   - Light candidates use `tiledMapTransforms(map, listener, TILE_PREVIEW_RADIUS=180)`
     → path-loop chains capped at `MAX_PATH_LOOP_DEPTH = 8` (`map.ts:1252`,
     `LightDirector.tsx:155`).
   - Confirm whether the stem visual previews (Scene.tsx) generate copies with a
     larger range/depth than the light candidates.
2. Lights are placed at the correct orb positions but at an **orb Y far above the
   walkable floor** (range can't bridge the gap).

## Next discriminating checks

Added a debug readout to `window.polyLights` (LightDirector.tsx, gated on
`?debug=1`):

- `listener: [x, y, z]` — the listener world position.
- `cutoff` — the active radial-fade outer radius.
- `nearest: { id, dist, intensity, y, range }` — the closest light candidate.
- `chosen: [{ id, dist, intensity, y }]` — every assigned light.

Read `window.polyLights` from the dark zone (with `?debug=1&lightBudget=8`) and
compare:

- Is `nearest.dist` small (an orb really is next to the listener) or large?
- Are `chosen[].dist` small or all near `cutoff`?
- Are `chosen[].intensity` meaningful or ~0?
- Do candidate ids carry a `:copy` suffix (copies) or not (base stems)?
- Compare `listener.y` to `chosen[].y` (vertical gap vs light range).

## Result

**Root cause found — not the light budget, not location.** The path glow is not
produced by the `LightDirector` point lights (those light walls/standard
materials). It is the custom `PathMaterial` / `ReflectiveUnderfloorMaterial`
floor shaders in `MapScene.tsx`, which carry a fixed `MAX_TRACK_LIGHTS = 64`
uniform array and were filled with `tracks[i]` for `i = 0..63` — i.e. the first
64 stems by **insertion order**. A composition with 174 tracks therefore never
lit the floor from tracks 65+, anywhere, which matches the user's decisive
observation that newly added stems never illuminate the path even beside ones
that do.

The dark-zone readout confirmed it: the 8 `LightDirector` lights there were
close (8–39 u), strong (intensity 20–51), and well-placed (y −28..−45 vs
listener −46) — yet the floor stayed dark, because the floor shader is driven by
the `trackPositions` uniform, and the dark-zone stems were past index 64.

**Fix:** feed each floor shader the `nearestTracks(...)` to the camera every
frame (still capped at `MAX_TRACK_LIGHTS`), and key level smoothing by track id
(a `Map`) rather than slot index so the changing contributor set doesn't make a
slot inherit another stem's level. Per-fragment cost is unchanged (the shader
still breaks at `trackCount ≤ 64`). The debug readout added to
`window.polyLights` (listener/nearest/chosen) can stay; it's gated on `?debug=1`.

