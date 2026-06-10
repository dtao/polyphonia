# Architecture Review: Performance and Efficiency

**Date:** 2026-06-09  
**Scope:** Full codebase — rendering, audio, state management, persistence, memory

---

## Summary

The app's core architecture is sound. The design decisions that matter most —
non-reactive module singletons for frame-sensitive state, throttled audio
parameter updates, adaptive performance mode, radial-fade culling of distant
lights — are all correct and intentional. What follows are the inefficiencies
that exist on top of that solid base, ranked by impact.

---

## High Impact

### 1. `withHistory` deep-clones AND re-normalizes the entire composition on every undoable edit

**File:** `src/store.ts` — `withHistory`, `cloneComposition`

Every undoable action (moving a stem, tweaking a value, editing a map point)
calls `cloneComposition`, which runs `structuredClone` (or `JSON.parse /
JSON.stringify` as fallback) on the full `Composition` object and then
immediately passes the result through `normalizeComposition`. `normalizeComposition`
is not cheap: it calls `normalizeMap`, which runs topology inference
(`inferSegmentEndpointConnections`), endpoint alignment
(`alignConnectedSegmentEndpoints`), and elevation normalization on every segment
and room.

This means dragging a stem runs: deep clone + full topology normalization pass.
Scrubbing a slider triggers this on every change event.

There are also 60 full composition clones held in `undoStack` at any one time.
For a composition with many tracks and a complex map, each clone can be 100KB+;
the stack alone can occupy several MB.

**Recommendations:**
- Drop `normalizeComposition` from `cloneComposition`. Compositions in the store
  should already be normalized; the clone doesn't need to re-validate them.
- Consider storing undo entries as structural diffs (patches) rather than full
  clones, at least for common single-field edits. For map edits this is harder,
  but track position/volume/falloff edits are simple enough to patch cheaply.
- Alternatively, lower the undo limit for compositions with many stems or a
  large map; 60 entries at full fidelity may not be worth the cost.

---

### 2. `TrackMarker` subscribes to the entire `composition.map`

**File:** `src/scene/TrackMarker.tsx`

```ts
const map = useStore((s) => s.composition.map);
```

This selector returns a new object reference on every map edit, so every map
change (moving a path point, changing a segment width, adding a room, anything)
causes **all** `TrackMarker` instances to re-render — including markers for
stems nowhere near the changed geometry.

On a tiled map with preview copies this is multiplied: 8 stems × 8 visible
copies = 64 `TrackMarker` re-renders per map edit.

**What it actually needs:** two derived values — `onWalkablePath` (bool) and
`floorY` (number). Both depend only on the stem's XZ position and the map.

**Recommendation:** Replace with a memoized selector that computes those two
values and only triggers a re-render when they change:

```ts
const { onWalkablePath, floorY } = useStore(
  useCallback(
    (s) => {
      const [x, , z] = track.position;
      const map = s.composition.map;
      const inside = !map.segments.length || isPointInsideMap(map, [x, z]);
      return { onWalkablePath: inside, floorY: inside ? surfaceHeightAt(map, [x, z]) : UNDERFLOOR_HEIGHT };
    },
    [track.position]
  ),
  shallow
);
```

This means map edits that don't affect this stem's floor height produce zero
re-renders in `TrackMarker`.

---

### 3. `TrackMarker` calls geometry functions in the render body without memoization

**File:** `src/scene/TrackMarker.tsx` (lines 46–51)

```ts
const onWalkablePath = !map.segments.length || isPointInsideMap(map, [x, z]);
const floorY = onWalkablePath ? surfaceHeightAt(map, [x, z]) : UNDERFLOOR_HEIGHT;
```

Both `isPointInsideMap` and `surfaceHeightAt` are O(segments + rooms + platforms)
operations. They run synchronously in the React render body — not memoized, not
deferred. With N stems and M map objects, every re-render costs N×M geometry
tests. Combined with finding #2 (which causes re-renders on every map edit),
this is the worst-case composition: large map × many stems × frequent edits.

**Recommendation:** Even before fixing the subscription, wrapping these in
`useMemo` with stable deps would prevent recomputation on renders caused by
unrelated state changes:

```ts
const { onWalkablePath, floorY } = useMemo(() => {
  const inside = !map.segments.length || isPointInsideMap(map, [x, z]);
  return { onWalkablePath: inside, floorY: inside ? surfaceHeightAt(map, [x, z]) : UNDERFLOOR_HEIGHT };
}, [map, x, z]);
```

The real fix is #2 above; this is a safety net.

---

### 4. N independent `useFrame` callbacks — one per `TrackMarker` instance

**File:** `src/scene/TrackMarker.tsx`

Every stem (base + each preview copy) mounts its own `useFrame` hook. On a
tiled map with 8 stems and 8 visible tile copies, that's 64 R3F frame callbacks
firing every render frame. Each one:
- Calls `engine.level(track.id)` — an AnalyserNode read
- Calls `Math.hypot` for light-fade distance
- Calls `Math.sin` for the breathing animation
- Mutates multiple `ref.current` properties

R3F processes `useFrame` callbacks sequentially in registration order. The
overhead is not per-callback fixed cost but it does accumulate, and AnalyserNode
reads in particular involve copying typed array data from the audio thread.

**Recommendation:** Consolidate stem animation updates into a single `useFrame`
in `<Scene>`. Pass level and fade values to markers via a shared typed array or
context that markers read imperatively in their own `useFrame`. This reduces
audio-thread cross-thread reads to one sweep per frame regardless of stem count.

---

### 5. `updateLoopSettings` rebuilds loop buffers for all tracks on every call

**File:** `src/audio/AudioEngine.ts` — `updateLoopSettings`

Changing any loop parameter (BPM, beats, loopCrossfade, loopEndTrim, loopTail)
triggers `prepareLoopBuffer` for every track in the composition. Each call
allocates a new `AudioBuffer` — a large `Float32Array` in the audio subsystem.

At 44.1 kHz stereo, a 32-second stem occupies ~11 MB per buffer. `prepareLoopBuffer`
allocates a fresh one. With 8 stems that's ~88 MB reallocated on every
`updateLoopSettings` call. If the user drags a BPM slider, this fires on every
`input` event — dozens of times per second.

The existing undo coalescing (700 ms window) limits the undo entry spam, but
there is no equivalent throttling on the audio buffer rebuild.

**Recommendations:**
- Debounce `updateLoopSettings` calls from slider inputs in the store action,
  or debounce the engine call specifically (~200–300 ms).
- For parameters that only affect loop alignment (not buffer content), consider
  separating them from parameters that require a buffer rebuild. BPM and beats
  require a rebuild; `loopStart`/`loopEndTrim` could potentially be handled
  via source offset adjustments without rebuilding.

---

## Medium Impact

### 6. `MapScene` computes `endpointCounts` inline without memoization

**File:** `src/scene/MapScene.tsx` (lines 30–35)

```ts
const endpointCounts = new Map<string, number>();
for (const segment of map.segments) {
  for (const point of [segment.start, segment.end]) {
    const key = pointKey(point);
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  }
}
```

This runs on every `MapScene` render. `MapScene` re-renders whenever `map`,
`tracks`, or `editMode` changes. The computation is O(segments) and the output
is a new `Map` object every time, which is then passed as a prop to each
`<Segment>` component — triggering re-renders there too even when endpoint
counts haven't actually changed.

**Recommendation:** `useMemo(() => ..., [map.segments])`.

---

### 7. `Player`'s `useLayoutEffect` depends on the entire `map` object

**File:** `src/scene/Player.tsx` (line 44)

```ts
useLayoutEffect(() => {
  // ... resets support.current via mapSupportAt
}, [camera, entered, map]);
```

Every map edit re-fires this layout effect, resetting `support.current` —
the movement support tracker that `stepOnMap` uses to maintain continuity
through rooms and segment transitions. Losing support state means the next
movement step has to re-infer the player's position from scratch, which can
cause a brief positional recalculation on every map edit while the player is
moving.

**Recommendation:** Depend on a stable map reference or on specific structural
fields that actually affect the player's starting support (e.g. `map.segments`,
`map.rooms`, `map.platforms`). Alternatively, reset support only when the player's
current support structure is deleted, rather than on any map change.

---

### 8. localStorage persistence is not debounced

**File:** `src/store.ts` / `src/persistence.ts`

`persistLibrary` (or its equivalent) is called whenever the composition changes.
This serializes the entire library — every saved composition — to a single
`localStorage.setItem` call via `JSON.stringify`. During rapid edits (dragging a
stem, scrubbing a BPM slider), this fires on every state update.

`JSON.stringify` of a multi-composition library with audio metadata is not
free. Done synchronously on the main thread during a drag, it can introduce
jank, particularly on lower-end devices.

**Recommendation:** Debounce persistence writes with a ~500 ms delay. Only the
most recent state needs to be persisted; intermediate states during a drag are
throwaway. This is a particularly high-value fix because it reduces both
serialization cost and storage I/O on every change event.

---

### 9. Undo stack holds up to 60 full composition clones

**File:** `src/store.ts` — `HISTORY_LIMIT = 60`

Even if the normalization issue (#1) is fixed, 60 deep copies of a large
composition is a significant heap footprint. For a composition with 20 stems,
detailed map topology, and environment landmarks, each snapshot could be
50–200 KB. The stack alone can reach 3–12 MB.

This is a dormant cost most of the time, but it matters on lower-memory
devices and it makes garbage collection pauses more likely during extended
editing sessions.

**Recommendation:** Consider a tiered limit — e.g. 30 entries for
compositions with ≥10 tracks or complex maps — or switch the oldest entries
to a more compact representation after they age past a threshold.

---

### 10. Audio buffer memory: original + prepared copy per track

**File:** `src/audio/AudioEngine.ts`

Each `LiveTrack` stores both `originalBuffer` (the decoded source) and `buffer`
(the prepared loop copy). For compositions with long stems this doubles the
audio memory footprint. An 8-track composition with 32-second 44.1 kHz stereo
stems occupies approximately 175 MB in audio buffers alone.

`originalBuffer` is retained to support `setTrackLoop` re-preparation and
`trackPeaks` waveform display without re-fetching. Both are valid use cases,
but it means the full unprocessed audio is always in memory even for simple
compositions.

**Recommendation:** For compositions where stems are not user-uploaded (i.e.
`kind: "file"` with a stable CDN URL), `originalBuffer` could potentially be
released after `prepareLoopBuffer` if there is no `loopStart`/`loopEnd` in
play and no waveform display is active. This is a tricky tradeoff but worth
noting for memory-constrained environments.

---

## Low Impact / Cleanup

### 11. `mapPointKey` allocates a new string on every call

**File:** `src/map.ts`

```ts
export const mapPointKey = (point: [number, number]): string =>
  `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
```

`.toFixed(3)` is one of the slower number-to-string conversions in JS. This
function is called in tight loops during topology inference (once per segment
endpoint per normalization pass), during every movement step, and for every
occlusion check. The string allocation itself adds GC pressure.

This is unlikely to be a measurable bottleneck on its own, but it is called on
the hot path. A faster alternative is `Math.round(v * 1000)` as an integer key
(or using a pair of integers as a compound Map key).

---

### 12. High-segment-count geometry in edit-mode-only objects

**File:** `src/scene/TrackMarker.tsx` — `FalloffMap`

```ts
<ringGeometry args={[near, far, 96, 12]} />
<torusGeometry args={[near, 0.04, 8, 128]} />
<torusGeometry args={[far, 0.04, 8, 160]} />
```

These are only rendered when a stem is selected in edit mode, so they don't
affect the explore-mode frame budget. However, for a thin torus ring (radius
0.04) 128 and 160 radial segments is very high — 32–48 would be visually
indistinguishable and half the vertex count.

---

### 13. `Billboard` components invoke quaternion math every frame per stem

**File:** `src/scene/TrackMarker.tsx` — `<Billboard>` (drei)

The drei `<Billboard>` wrapper realigns its children to face the camera every
frame. With N stems × M tile copies, this is N×M quaternion computations per
frame. Each orb uses at least one Billboard for the flare/rays group.

This is not catastrophic but it's worth knowing. On a 50-stem composition with
several tile copies it can add up to 200+ quaternion updates per frame just for
billboard alignment.

---

## What's done well

These are areas where the existing code makes deliberate, correct performance
tradeoffs worth preserving:

- **Non-reactive module singletons** (`viewState`, `markerObjects`, `loopWrap`,
  etc.) for frame-sensitive state — the right call; reactive equivalents would
  trigger re-renders on every frame.
- **Throttled audio updates** (`listenerUpdateInterval`, `acousticsUpdateInterval`,
  `roomUpdateInterval`) with movement-threshold early exit — prevents unnecessary
  Web Audio param writes when the listener hasn't moved.
- **Adaptive performance mode** (HRTF → equalpower, 4 → 2 virtual instances,
  lower update rates on mobile) — correctly detects mobile and scales down.
- **Radial-fade point-light culling** in `TrackMarker` — drops lights from the
  renderer's active set beyond the fade radius, which is the primary control
  on fragment shader cost for large stem counts.
- **History coalescing** (700 ms window) — prevents rapid slider drags from
  generating 60 discrete undo entries.
- **`shouldUpdateListenerParams` movement threshold** — skips Web Audio
  `AudioParam` writes when position and facing haven't changed enough to matter.
- **Hash-based stem dedup on re-publish** — avoids re-uploading unchanged audio.

---

## Priority order for fixes

| # | Finding | Effort | Impact |
|---|---|---|---|
| 1 | Remove `normalizeComposition` from `cloneComposition` | Low | High — eliminates full topology pass on every edit |
| 8 | Debounce localStorage persistence | Low | High — eliminates main-thread stalls during drags |
| 5 | Debounce `updateLoopSettings` buffer rebuild | Low | High — prevents 88MB+ reallocation per slider event |
| 2+3 | Narrow `TrackMarker` map subscription + memoize geometry calls | Medium | High — eliminates cascade re-renders on map edits |
| 6 | Memoize `endpointCounts` in `MapScene` | Low | Medium |
| 7 | Narrow `Player` `useLayoutEffect` map dependency | Low | Medium |
| 4 | Consolidate `useFrame` into single stem-animation loop | High | Medium — mostly relevant for large/tiled compositions |
| 9 | Lower undo limit for complex compositions | Low | Low-medium |
| 11 | Faster `mapPointKey` | Low | Low |
| 12 | Reduce torus/ring segment counts in edit mode | Low | Low |
