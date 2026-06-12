# Adding a New System

This is a practical checklist for common extension patterns. Each pattern
assumes you've read [architecture-overview.md](architecture-overview.md) and
the relevant deep-dive docs.

---

## New composition field

Use when you need to add a settable property to the composition itself (e.g. a
new loop setting, a global acoustic parameter).

1. **Add the field to `Composition` or the relevant sub-type** (`src/composition.ts`,
   `src/map.ts`, or `src/environment.ts`). Make it optional with a sane default.

2. **Add a normalization rule** in `normalizeComposition`, `normalizeMap`, or
   `normalizeEnvironment`. This is where legacy manifests get defaults and
   invalid values are coerced to valid ones. Never scatter compat checks through
   rendering or audio code.

3. **Add a store action** in `src/store.ts`. Most composition edits go through
   `withHistory` to be undoable. Pick the right granularity — one action per
   logical user intent, not one per field.

4. **Wire up the audio engine** if the field affects audio. Add a live setter on
   `AudioEngine` that updates the Web Audio graph without restarting any source,
   and call it from the store action alongside `withHistory`. Also update
   `AudioEngine.updateLoopSettings` or the appropriate method that handles
   composition reload.

5. **Add a UI control** in `src/ui/`. Composition-level settings belong in the
   top-left panel stack (Environment, Map, or Loop, or a new panel in that
   area). Per-object properties belong in the bottom-left inspector for that
   object type.

6. **Update `compositionRevision`** in `src/composition.ts` if the field
   affects the published content (i.e. the viewer would render differently with
   the new value). This keeps `publishedRevision` accurate for the cloud
   publish/re-publish check.

7. **Write a test** for the normalization logic in `src/composition.test.ts` or
   `src/map.test.ts` if the normalization is non-trivial.

---

## New map object type

Use when adding a new kind of walkable or acoustic structure to the map (e.g. a
ramp, a one-way barrier, a ladder).

1. **Define the interface** in `src/map.ts`. Keep the data minimal — only what
   is needed for movement and acoustics. Visual representation is handled by the
   scene, not the data model.

2. **Add it to `CompositionMap`** as an optional array (default `[]`).

3. **Add normalization** in `normalizeMap`: a filter for valid objects + a
   `normalize*` helper.

4. **Implement movement geometry**: add a `*Contains` or `stepHits*` function
   and wire it into `stepOnMap`, `isPointInsideMap`, and `clampToMap` as needed.

5. **Implement occlusion geometry** (if it blocks sound): add a
   `*ObstructionCount(map, from, to)` function and call it from
   `AudioEngine.updateListener`'s acoustics update. Follow the same
   `wallOcclusionStrength`-weighted return value convention.

6. **Add scene rendering** in `src/scene/MapScene.tsx`:
   - Render geometry for explore mode.
   - Add edit handles for edit mode.
   - Route any transparent/additive materials through `radialFade` (see
     [scene-and-rendering.md](scene-and-rendering.md)).

7. **Add store actions**: select, add, update, delete (+ duplicate if useful).
   Use `withHistory` for actions the user should be able to undo.

8. **Add an inspector** in `src/ui/`. Follow the bottom-left inspector
   pattern: shown when the object is selected, cleared when selection changes.

9. **Update `compositionRevision`** to include the new array.

---

## New UI panel

Use when adding a new composition-level configuration surface (e.g. a "Room
Acoustics" panel).

1. Create the component in `src/ui/`.

2. Add a panel button in the top-left control area (`src/ui/PropertiesPanel.tsx`
   or similar). Do not introduce a new floating location.

3. Follow the existing drawer pattern: a button that toggles open/closed state,
   with the panel sliding in below/beside the button.

4. All settable values in the panel should go through store actions with
   `withHistory`.

---

## New visual layer for the world

The detail-pack system was retired; the visual layers are now the generated
world ([generated-environments.md](generated-environments.md)) and imported
creator assets ([creator-assets.md](creator-assets.md)): PBR surface
materials assigned to map surfaces and self-contained GLB objects placed
directly. Rules that still apply to anything visual:

1. It is purely visual: it must not affect movement or acoustics.

2. Test against the radial-fade rules: any geometry using non-opaque
   materials must route opacity/intensity through `radialFade`.

---

## New audio parameter on stems

Use when adding a per-stem audio property (e.g. a reverb send amount, a filter
type).

1. Add the field to `TrackDef` in `src/composition.ts` (optional, with defaults).

2. Normalize it in `normalizeTrack`.

3. Add a live setter on `AudioEngine` that updates the Web Audio graph in place.
   The setter must not restart the `AudioBufferSourceNode`.

4. Add a store action that calls `withHistory` AND the engine setter.

5. Add the control to the stem inspector in `src/ui/`.

6. Include the field in `compositionRevision` if it affects the published
   listener experience.

---

## Key invariants to never break

- **One `AudioContext`.** Never create a second one. Never restart the context
  to apply an edit.

- **`normalizeComposition` is the compatibility boundary.** All legacy migration
  and input validation belongs there. Rendering and audio code should trust that
  the manifest is already normalized.

- **`withHistory` for all undoable edits.** If a user action changes the
  composition in a way they might want to reverse, it goes through `withHistory`.

- **`radialFade` for all custom materials.** Non-fog-respecting renderables
  must route opacity/intensity through `radialFade`. Do not invent new
  start/end constants.

- **Blob URLs are ephemeral.** Never serialize them. Never store them in
  localStorage. Revoke them when the stem is deleted.

- **Stems started together.** Any new audio source must be scheduled off
  `engine.ctx.currentTime` using the engine's existing start machinery, not
  independently.
