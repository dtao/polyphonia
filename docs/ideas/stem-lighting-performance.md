# Stem lighting: how it works, why tunnels were slow, and where to take it

Context captured from a debugging session: a map with ~50 stems ran smoothly
in the open but became very sluggish the moment the listener walked into a
tunnel. Confirmed cause and the design space for fixes, so the reasoning isn't
lost.

## Two completely different lighting methods are in play

A stem marker's glowing *orb* and the colored *pool it casts on the world* are
produced by two unrelated mechanisms:

1. **The orb itself is self-illuminated, not lit.** The white core, the inner
   and outer auras, the lens flare, and the star-ray burst
   (`src/scene/TrackMarker.tsx`) are all `MeshBasicMaterial` /additive
   `shaderMaterial` — *unlit* materials that emit their own color and ignore
   scene lighting entirely. They render identically with or without any light.

2. **The floor glow is a shader, not a light.** The walkable floor
   (`WalkableFloor` → `PathMaterial`, `pathFragmentShader` in
   `src/scene/MapScene.tsx`) is a custom `ShaderMaterial`. Every stem's
   position, color, and live audio level is uploaded as uniform arrays (up to
   `MAX_TRACK_LIGHTS = 64`); the fragment shader loops over them and fakes a
   soft, audio-pulsing pool per stem. This is the throbbing-floor effect you
   still see with `?debug=1&debugNoPointLights=1`.

3. **The walls and ceiling are the only things that use *real* lights.** Tunnel
   side walls and ceiling (`src/scene/MapScene.tsx`, the `Tunnel` component) are
   plain `meshStandardMaterial` (PBR). They only light up if an actual light
   shines on them — and that light is the per-stem `pointLight` in
   `TrackMarker` (and, on tiled maps, the `PreviewEchoLights` pool in
   `Scene.tsx`). Kill the point lights and the walls go dark while the floor
   keeps glowing — exactly the observed behavior.

## Why the point lights are so expensive (and tunnel-specific)

three.js's forward renderer evaluates **every active light for every fragment
of every lit surface**. `pointLight.distance` only attenuates the contribution
to zero; it does **not** remove the light from the per-fragment loop. So:

- With ~50 stems, every lit fragment on screen shades ~50 lights.
- In the open, lit PBR surfaces cover little of the screen (floor uses the
  custom shader, not PBR lighting; much of the view is void/fog/distance).
- Inside a tunnel, the PBR walls and ceiling wrap around you and fill the entire
  viewport at point-blank range. Now *every screen pixel* runs the 50-light PBR
  loop. Cost ≈ (screen pixels of lit surface) × (active light count) → the
  fragment-shading cliff.

Confirmed: `?debug=1&debugNoPointLights=1` removes the drop entirely.

Notably, the place the point lights would be *most* visible (enclosed tunnel
walls catching each stem's color) is also where they are *most* expensive — in
the open they are nearly invisible because there's little near lit geometry to
catch them.

## Why the shader approach (floor) is cheap

- **No shader recompiles.** Real `pointLight`s are baked into three.js's light
  system; the program cache key includes the light counts, so changing the
  count recompiles materials. The shader passes lights as plain uniform data in
  a fixed-size array — the program never changes.
- **Runs on one surface only.** The floor shader executes only on floor
  fragments. Real lights hit *every* lit surface in view.
- **Trivial falloff.** A distance + `smoothstep`, no PBR BRDF, no shadow maps,
  no per-light setup.

## Option A (recommended long-term): give walls/ceiling the shader treatment

Replace the tunnel wall/ceiling `meshStandardMaterial` with a vertical variant
of `PathMaterial`, then delete the point lights. You'd get the throbbing-walls
effect (which today only exists where it's too expensive to render) at a tiny
fraction of the cost. Considerations:

- **2D vs 3D distance.** The floor shader is flat (XZ distance) and packs the
  glow radius into `trackPositions[i].z`. Walls are vertical, so a wall glow
  needs true 3D distance including the stem's height — pass stem Y separately;
  the radius-in-`.z` packing won't survive.
- **Loss of ambient/pack lighting.** Standard-material walls also pick up the
  environment's ambient and authored-pack lights. A custom shader replaces
  that, so bake a neutral base color like the floor does. Fine for the neutral
  environment; a tradeoff for authored packs.
- **Per-segment CPU cost.** Each tunnel segment is its own mesh/material, each
  copying 64 positions+levels per frame. Share one uniforms object across all
  tunnel materials (as `PreviewEchoLights` shares a fixed pool) so the per-frame
  CPU update happens once.
- **Rooms** are the obvious next candidate for the same treatment.

## Option B (do #2 if Option A is deferred): cap to nearest-N lights

Keep real point lights but maintain a *fixed* pool of N (e.g. 8–12) assigned
each frame to the nearest stems. Constant light count ⇒ no recompiles ⇒ smooth,
and cost is bounded regardless of stem count. This is exactly the
`PreviewEchoLights` pattern, generalized.

## Option C (implemented now): cull point lights by the radial fade

Keep every stem's point light, but drop it from the renderer's active set once
the stem is beyond the radial-fade band (`src/scene/fade.ts`,
`RADIAL_FADE_OUTER` / the debug override). A point light with reach ~18 placed
>130 units from the camera only illuminates geometry that is itself faded to
the void, so culling it is **visually free** while removing its per-fragment
cost.

- On **non-tiled** maps, `fadeBaseMarkers` is false, so previously *all* base
  stem lights were mounted at full intensity at all distances — the main source
  of "50 lights at once." Culling fixes this directly.
- On **tiled** maps, base markers already unmount past the fade epsilon; the
  remaining always-on cost is the `PreviewEchoLights` pool, which deliberately
  keeps a constant light count (one per track) to avoid recompile churn — see
  its comment. Extending culling there is possible but trades that churn back
  in; left as a follow-up.

**Mental model / the key tradeoff:** the GPU cost is driven by the *count of
active lights*, not by each light's own distance (three.js loops all active
lights per lit fragment regardless). Culling reduces the count, so a **smaller
radial-fade radius ⇒ fewer stems lit at once ⇒ lower cost** — true, with the
floor being however many stems are packed *within* the radius. In a dense
cluster (or a tunnel lined with stems), reducing the radius helps until you hit
that local density; past that you'd want Option A or B. Culling does mean the
active light count changes as you move, which can cause occasional program
swaps (three.js caches programs per distinct count, so these amortize after
warm-up); intensity is faded to ~0 before the cull flips so there's no visible
pop.

The `?debug=1` fade-radius sliders (`setDebugFadeRadii`) let you A/B the
cost-vs-radius relationship live.
