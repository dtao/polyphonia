# Scene and Rendering

**Sources:** `src/scene/`, `src/scene/fade.ts`, `src/scene/Scene.tsx`,
`src/scene/MapScene.tsx`, `src/scene/Player.tsx`

The 3D world is rendered using React Three Fiber (R3F) inside a `<Canvas>`
element in `src/App.tsx`. All 3D components live under `src/scene/`.

## Component tree

```
<Canvas dpr={[1, 1.5]}>     ← DPR capped; see gotcha below
  <Scene>
    <EnvironmentScene />    ← lights, scene fog, mounts the layers below
    <GeneratedWorld />      ← generated terrain, gradient sky, mood lighting
    <SurfaceMapDressing />  ← imported-material shells over map geometry
    <CreatorLandmarks />    ← imported GLB objects (placed landmarks)
    <MapScene />            ← path/room/platform/wall meshes + edit handles
    <LightDirector />       ← the ONLY stem point lights (budgeted pool)
    <TrackMarker /> × N     ← glowing orbs for each stem (no lights)
    <TrackGizmo />          ← transform gizmo on selected stem
    <EditControls />        ← orbit camera for edit mode
    <Player />              ← movement + pointer-lock for explore mode
    <ListenerSync />        ← drives AudioEngine from camera position
    <DebugSampler />        ← diagnostics (dev builds)
    <ARWalkSession />       ← WebXR movement (experimental)
  </Scene>
</Canvas>
```

## Dual-fade architecture

Two separate fading systems coexist. Understanding which to use when is
critical to avoiding "pop-in" (objects blinking into existence on the horizon):

### 1. Scene fog (for standard opaque geometry)

`<EnvironmentScene>` sets a `<fog>` with `far = RADIAL_FADE_OUTER`. Standard
opaque meshes respect Three.js fog automatically: they fade to the background
color as they approach `RADIAL_FADE_OUTER` and are invisible beyond it.

**Use this** for: path floors, room walls, platform meshes, most environment
geometry.

### 2. `radialFade()` (for everything else)

Some materials can't use scene fog cleanly:
- Additive or transparent blending (glows, orbs) — fog applies to the material
  color but additive blends stay visible even at opacity 0 unless you
  also modulate `opacity`.
- GPU-instanced meshes — need per-instance opacity.
- Point lights — need intensity scaled to zero before the horizon.
- Tiled copies — each copy is a separate scene subtree; its parent Group needs
  an explicit opacity/scale ramp.

These must call `radialFade(distance)` from `src/scene/fade.ts` to get a
`[1 → 0]` multiplier and apply it to `opacity`, `intensity`, or `scale`.

**Key rule:** never invent your own fade start/end constants. Route everything
through `radialFade` so that all objects disappear at the same circle.

### `src/scene/fade.ts`

```ts
// Default band (engine constants):
RADIAL_FADE_INNER = 90   // fully visible inside this radius
RADIAL_FADE_OUTER = 130  // fully gone outside this radius

// Priority override chain (highest to lowest):
// 1. debug sliders (setDebugFadeRadii)
// 2. per-composition authored radius (setCompositionFadeRadii, from map.visibleRadius)
// 3. constants

radialFade(distance)         // returns [0, 1] at the effective band
radialFadeAt(viewer, x, z)   // convenience for XZ-plane objects
```

`<Scene>` subscribes to fade changes and bumps a render version so React
re-evaluates the orbit even when the viewer hasn't moved.

### Map-copy fade (a deliberate exception)

Tiled map copies (floor geometry, environment dressing) fade as a **whole copy**
by anchor distance, not by per-object distance. This uses separate constants
`MAP_COPY_FADE_START = 85` / `MAP_COPY_FADE_END = 178` in `Scene.tsx`,
deliberately decoupled from the per-object radial fade. Its purpose is to hide
the tiling seam rather than enforce the per-object visibility horizon.

### Generation vs. culling

Actual render instances may cull at `RADIAL_FADE_OUTER`, but tile/loop anchors
must be generated beyond it by the maximum object offset within the copy plus
a movement buffer. Otherwise a newly admitted copy can place an object inside
the fully visible circle before `radialFade` has applied to it. The
`TILE_PREVIEW_RADIUS = 180` in `Scene.tsx` (larger than `RADIAL_FADE_OUTER`)
serves this purpose.

## Player and movement

`<Player>` handles all movement input in explore mode:

- **Keyboard** (WASD / arrow keys) — reads key state each frame
- **Touch** — reads `touchMove.forward`/`touchMove.strafe` (set by `<TouchControls>`)
- **AR** — reads `arWalk.pendingX`/`pendingZ` (set by `<ARWalkSession>`)
- **Geo** — reads `geoWalk.pendingX`/`pendingZ` (set by `<GeoWalkControls>`)

Each frame, `<Player>` calls `stepOnMap` to clamp movement, then updates
`viewState` and the R3F camera. It also handles path-loop seam wrapping
(`wrapLoopPosition`) and bumps `loopWrap.generation` on teleport.

## Pointer lock

`<Player>` in explore mode uses drei's `<PointerLockControls>`. Selector
scoping:
- Before entry: `selector="#enter-btn"` — the entry click both starts audio
  and locks the pointer in one gesture (required by browser autoplay policy).
- After entry: `selector="canvas"` — clicking UI buttons doesn't grab the
  pointer.

Do not change the selector without testing entry, Exit button, and all UI
button clicks.

## `<ListenerSync>`

Runs in `useFrame` and calls `engine.updateListener(position, forward, map)`
every frame. This drives spatialization without triggering React re-renders.

## `<EditControls>`

An orbit camera active in edit mode. It reads `pendingTeleport` each frame
(set by double-clicking a path point or room in `<MapScene>`) and smoothly
shifts the orbit pivot there.

## `<MapScene>`

Renders and handles editing for all map objects:
- Path segment centerlines with width handles
- Room meshes (walls, ceiling, floor) with entrance slots
- Platform meshes
- Standalone wall meshes
- Start-position marker with translate/rotate gizmo

In edit mode it dispatches mouse events to select, drag, and grow map objects.
In explore mode it still renders geometry but is not interactive.

## Visual world layers

The detail-pack system was retired (its `environment.pack` manifest field is
still normalized for old compositions but renders nothing). The visual layers
are now:

- The generated world — see
  [generated-environments.md](generated-environments.md).
- Imported creator materials applied to map surfaces by
  `src/scene/SurfaceDressing.tsx` (textured shells over floors, walls,
  ceilings; see [creator-assets.md](creator-assets.md)).
- Imported GLB objects placed via `<CreatorLandmarks>`.

All of it is visual only: the map remains authoritative for movement and
acoustics.

## Point-light budget

Three.js forward rendering evaluates every visible light on every lit
fragment, so light cost = light count × lit surface area — and generated
terrain makes the lit surface the whole screen. Stems therefore do NOT own
point lights. `<LightDirector>` owns a small fixed pool and assigns it per
frame to the highest-priority light sources (each stem, plus its nearest
tiled copy), where priority = audio-driven intensity, full inside the
light's range, falling quadratically beyond it, and zero past the
radial-fade cutoff. An FPS controller (`lightBudget.ts`) steps the pool
through `LIGHT_TIERS` (16 → 0) with hysteresis and cooldowns; slot handoffs
damp intensity so lights never pop, and the pool size only changes on tier
transitions, keeping shader programs stable.

Do not mount per-object `<pointLight>`s for new features — add candidates to
the director instead. Debug: `?debug=1` exposes `window.polyLights`
(fps/tier/pool/active) and `?lightBudget=N` pins the pool size (dev builds).

## DPR cap

The canvas `dpr` is capped at `[1, 1.5]`. On Retina displays this halves the
render resolution compared to the device default (`[1, 2]`). The cap is
intentional: full Retina resolution is too expensive for a realtime 3D scene
with postprocessing. Do not remove it.

## Debug tools

- `?debug=1` enables the debug overlay.
- `debugFlag("debugNoPointLights")` — disable point lights.
- `debugFlag("debugNoLoopPreview")` — disable tiled preview copies.
- `debugFlag("debugNoLoopLights")` — disable echo lights on tiled maps.
- `debugFlag("debugTerrainProbe")` — log generated-terrain state under the
  viewer once a second.
- The debug panel includes sliders for `RADIAL_FADE_INNER`/`RADIAL_FADE_OUTER`
  that call `setDebugFadeRadii` in `fade.ts`.
