# Debug visible-radius control has no visible effect

## Symptom

A debug-mode UI control (inner/outer "fade radius" sliders in the bottom-right
`?debug=1` panel) was added so the visible radius around the listener can be
tuned live. The intent: the sliders should govern how far you can see —
applying to **everything** (orbs, paths, environment, etc.).

On a **large, non-looping map** (`tiling.type === "none"`) in explore mode, the
sliders appear to do nothing. The teal/orange visualization rings track the
slider values and move with the camera, but the perimeter of what is visible is
unaffected: orbs, paths, and other objects render well beyond both rings, and
changing the values has no perceptible effect on the scene.

## Reproduction

- Open the editor with `?debug=1`.
- Enter explore mode on a large map with `tiling.type === "none"`.
- Drag "Fade inner" / "Fade outer" in the debug panel.
- Observe: rings resize/move correctly; nothing else changes.

## Architecture recap (relevant pieces)

The codebase has **two** distinct distance-fade mechanisms:

1. **Three.js scene fog** (`<fog>` in `EnvironmentScene`, far pinned to
   `RADIAL_FADE_OUTER`). Fades fog-respecting *opaque* materials for free —
   walls (`meshStandardMaterial`), room/platform floors, etc.
2. **`radialFade(distance)`** (`src/scene/fade.ts`). Per-object opacity for
   renderables fog can't cleanly handle: additive glows, instanced env meshes,
   tiled map/loop copies, and preview stem orbs.

The slider plumbing (`setDebugFadeRadii` / `subscribeDebugFade` /
`effectiveFadeInner/Outer` in `fade.ts`) feeds both. The rings read
`effectiveFade*()` and demonstrably update — so the slider state propagation
itself works.

## Attempts

### Attempt 1 — slider + reactive fog far + dynamic radialFade bounds
- Added `setDebugFadeRadii`/`subscribeDebugFade` and made `radialFade` default
  to `effectiveFade*()`.
- Made `EnvironmentScene` fog `far` reactive via a `useFogFar` React state hook.
- Result: no visible effect reported.

### Attempt 2 — dynamic culls + fog as direct prop + shader fog + rings
- `AuthoredEnvironmentScene` and `DetailMapDressing` were culling instances at
  the **constant** `RADIAL_FADE_OUTER`; switched both to `effectiveFadeOuter()`
  and forced a refill on fade change.
- Switched fog from `args` to direct `near`/`far` props (suspected `args`
  wouldn't update in place).
- **Found that the dominant walkable surface uses custom `ShaderMaterial`s**
  (`PathMaterial`, `ReflectiveUnderfloorMaterial`) which ignore Three.js fog
  entirely. Added fog uniforms + `vFogDepth` + a `smoothstep` fog blend to both
  shaders, synced from `scene.fog` each frame.
- Added teal/orange ground rings (`FadeRadiusDebug`) for visual confirmation.
- Result: rings work; scene perimeter still unaffected on a non-looping map.

### Attempt 3 (current) — root-caused two independent bugs

Static analysis (no remaining speculation) identified two distinct reasons the
radius fails to apply to "everything" on a non-tiled map:

**Bug A — base orbs never distance-fade on non-tiled maps.**
`Scene.tsx`: `fadeBaseMarkers = mode === "explore" && loopPreviewsEnabled &&
map.tiling.type !== "none"`. On a non-looping map this is `false`, so every base
`TrackMarker` is rendered with `fade = 1`. `TrackMarker` already multiplies all
its layers — including the additive flare/rays/auras — by `fade`, so the only
reason orbs ignore the radius is that the radius value never reaches them in the
untiled case. This fully explains "orbs render well beyond both circles."

**Bug B — fog `far` driven through fragile React reactivity.**
Fog far is a frame-sensitive value once a live slider drives it. Routing it
through React state (`useFogFar` → `<fog far={…}>`) is both unreliable for
`<fog>` and contrary to the codebase convention of writing frame-sensitive
state imperatively (AGENTS.md: store-owned non-reactive singletons for
frame-sensitive state). The path shaders read `scene.fog` every frame, so if
`scene.fog.far` is kept correct imperatively, they track it for free.

### Fixes applied in attempt 3

1. **`fade.ts`**: added `isDebugFadeOverridden()` (true once a slider leaves its
   default).
2. **`Scene.tsx`**: `fadeBaseMarkers` is now also true on non-tiled maps when
   `isDebugFadeOverridden()`, so base orbs (and their additive layers) fade by
   `radialFade`. Added a `subscribeDebugFade` re-render bump so the base-marker
   fades recompute while standing still (dragging the slider doesn't move the
   viewer, which previously kept the memoized fades stale).
3. **`EnvironmentScene.tsx`**: replaced reactive fog far with an imperative
   per-frame `FogSync` (`scene.fog.far = effectiveFadeOuter()`, `near` scaled by
   the default 38/130 ratio). The `<fog>` element only seeds the Fog object now.
4. **Diagnostic**: `DebugSampler` records live `scene.fog.near/far`; the debug
   panel shows "Live fog near … · far …" above the sliders.

## Discriminating check (hand off to user)

Run `?debug=1`, explore, drag "Fade outer":

- **If "Live fog near/far" tracks the slider** → fog plumbing is fixed. Opaque
  geometry and the path shaders should now close in with the orange ring. If
  some object still doesn't fade, it's a *material* that neither respects fog nor
  routes through `radialFade` — identify it and route it through one of the two.
- **If "Live fog far" does NOT track the slider** → `FogSync` isn't running or
  `scene.fog` isn't a `THREE.Fog` (e.g. overridden by an authored pack or the
  AR backdrop path). Capture the panel readout and the active environment pack.

Also confirm base orbs now fade with the inner/outer band (Bug A). If they do
but you want the same in tiled maps / non-debug builds, that's a product
decision, not a bug.

### Attempt 4 — path floor fades by planar radial band, not eye-space fog

User confirmed orbs now fade correctly (committed). The path floor still did
not. Root cause of the path miss: the shader fog from attempt 2 faded by
**eye-space depth** (`-mvPosition.z`) against a fog band scaled by `38/130`,
which is neither the same metric nor the same band as the rings/orbs (planar XZ
distance, `effectiveFadeInner → effectiveFadeOuter`). So even when it faded, it
didn't fade *at the outer ring*.

Fix: `PathMaterial` and `ReflectiveUnderfloorMaterial` now fade by **planar XZ
distance from the built-in `cameraPosition`** across `fadeInner → fadeOuter`
uniforms set from `effectiveFade*()` each frame — identical metric and band to
`radialFade`. The opaque path mixes its color to the void color (stays opaque,
no depth change); the transparent underfloor also drops alpha by `1 - radial`.
The `vFogDepth`/`fogNear`/`fogFar` plumbing from attempt 2 was removed.

This also makes edit mode and tiled preview copies fade the path consistently
with the already-fogged walls/rooms.

### Attempt 5 — the real root cause: fog was never on the scene

User confirmed the path surface now darkens at the boundary, but the map still
extended into the distance — non-surface map elements (e.g. `BorderRail`, and
other fog-respecting walls/rooms/rails) did not fade.

**Root cause (the one that explains every earlier failure):** `EnvironmentScene`
renders inside `<ARWorldTransform>`, which is a `<group>`. R3F's
`<fog attach="fog">` attaches to the nearest parent Object3D — the group — so it
set `group.fog`, which the renderer ignores. **Scene fog was never applied at
all.** Every attempt to "update fog far" was updating an object the renderer
never read. Only the path/orbs faded because they had explicit per-object fades
independent of fog.

Fix: `FogSync` now sets `scene.fog` imperatively via `useThree` (unambiguously
the real scene) in a mount effect, and updates near/far each frame from
`effectiveFadeInner/Outer()`. The broken JSX `<fog>` was removed. Fog near is
pinned to the radial **inner** and far to the radial **outer**, so all
fog-respecting geometry (standard-material walls/rooms, additive basic-material
rails like `BorderRail`) fades across the exact same circle as the rings, orbs,
and path shader.

Note: `<color attach="background">` in the same file has the identical
group-attach issue, but it is out of scope here (scene reads dark via the
canvas/CSS fallback, so fogging to the void color still reads as "gone"). Flag
for later if a perfect fog/background color match is wanted.

## Status

Orb fix committed (`3f405df`). Path + fog-on-scene fixes implemented (build +
tests green), pending user visual confirmation that the **whole** map — surface,
rails, walls, rooms — now disappears at the outer ring. Once confirmed, commit
and close.
