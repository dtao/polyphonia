# Room-to-room elevation floor

## Symptom

When adding a room to another room, the new room should always match the
source room's elevation. It does match for shallow elevations, but there is
an apparent **lower bound**: below some shallow negative depth the new room
stops descending and is created at that floor instead.

User's description (numbers illustrative, not exact): adding a room works at
elevation −1 and −2, but trying to create one at −10 still produces a room at
about −2. So there is an effective minimum elevation past which new rooms
won't go any deeper.

The user confirmed the trigger is the **doorway → "Room"** action
(`growFromEntrance(roomId, index, "room")`), i.e. "Add a room out of this
doorway" in `EntrancePanel`.

## Reproduction

Not yet reproduced by us. Unknown:

- Exact elevation where the floor kicks in (user said "making up the numbers").
- Whether the **source** room is genuinely at the deep elevation and only the
  new room floors, OR the source itself cannot be pushed below the floor (so
  the new room merely inherits the source's stuck-shallow value).
- Edit-camera angle when it happens (top-down vs oblique).
- Whether the source room is free or attached to a path point.
- Device / browser / specific composition.

## What has been ruled out (data/model layer is NOT the cause)

Verified with throwaway Vitest reproductions against the real store, and with
live `window.polyStore` calls in the running app:

- `growFromEntrance(_, _, "room")` sets `elevation: roomElevation(map, source)`
  and the new room matches the source exactly for **−1, −2, −5, −10, −18**
  (free source, attached source, attached-with-stale-explicit source, and
  rotated source with a non-cardinal entrance).
- `addRoomAtPoint` produces a room that follows its attachment point's
  elevation correctly down to −10.
- `updateRoom({ elevation })` reaches −18; `moveMapPoint(key, pt, e)` reaches
  −18 (and an incremental "drag-frame" simulation reaches ≈ −32 — only the
  normalize/clamp bounds of −20..40 apply).
- `connectMapPoint`'s elevation snap (`MAP_ELEVATION_CONNECT_DISTANCE = 3`) can
  pin a *shallow* drag near a neighbor segment, but does NOT create a deep
  floor — incremental downward dragging escapes it and reaches ≈ −32.
- `normalizeRoom`/`normalizeMap` only clamp to `[-20, 40]`; nothing clamps to a
  shallow value.
- Live check: grow B from A (both 0), then `updateRoom(B, {elevation:-10})` →
  both A and B become −10 (they move as a connected structure group). No floor.

Conclusion: there is **no elevation floor anywhere in the store/map logic**.
The floor must live in the **runtime 3D editing interaction**, which unit
tests cannot exercise.

## Attempted fix #1 (did NOT work — confirmed by user)

**Hypothesis at the time:** room elevation could only be set by dragging the
TransformControls Y axis, and from a top-down edit-camera angle the Y axis is
nearly parallel to the view direction, so it has almost no screen leverage and
"floors out" after a small drop. Supporting evidence: `PlatformPanel` already
exposes a numeric **Elevation** slider, but `RoomPanel` had none — so platforms
could be placed at any depth while rooms were drag-only.

**Change made (uncommitted, in the working tree):**

- `src/ui/RoomPanel.tsx`: added an Elevation slider (−20..40) for non-attached
  rooms, routed through `updateRoom({ elevation })`.
- `src/ui/MapPointPanel.tsx`: added an Elevation slider for the selected path
  point (so attached rooms/platforms can be set deep via their point), routed
  through `moveMapPoint(key, point, e)`. Added a `pointForKey` helper.

`npm run build`, `tsc --noEmit`, and `npm test` (721 passing) were all green.

**Result:** user reports the bug is **still not fixed**. So either the floor is
not (only) the gizmo-drag-leverage problem, or the slider path hits the same
underlying limit, or the actual failure is elsewhere entirely.

**Reverted (2026-06-09):** the attempt-#1 editable Elevation sliders in
`RoomPanel` and `MapPointPanel` were removed, since they did not fix the bug and
duplicated the new read-only readout below.

## Troubleshooting aid added (2026-06-09)

To make elevation issues observable, every bottom-left inspector now shows a
read-only **resolved elevation** readout via a shared
`src/ui/ElevationReadout.tsx` component:

- `RoomPanel` → `roomElevation(map, room)`
- `PlatformPanel` → `platformElevation(map, platform)`
- `MapPointPanel` → `pointElevation(map, key)`
- `MapSegmentPanel` → start→end endpoint elevations
- `WallPanel` → `wall.elevation`
- `PropertiesPanel` (stem) → `track.position[1]`

Verified live (via a dev `user` shim to mount the editor past the
`PublicLanding` gate) that the room readout updates to e.g. −7.25 and the stem
readout shows its Y. Use these numbers during the buggy drag to answer the
"is it the source or the new room that's stuck?" question above, and to watch
the connecting-path endpoints jump per the additional observation.

## Additional observation (2026-06-09, reported by user)

Dragging the vertical (Y) axis of the 3D transform gizmo on a room that is
already at a **very low** elevation produces a telling behavior in the
**connected path(s)**:

1. As the room is dragged down, the connecting path(s) **jump UP** to a much
   higher elevation.
2. They stay up there until the room is raised back up to meet them.
3. Once the room reaches them, the paths then go **higher still**, staying
   attached to (flush with) the room.
4. Below a certain point the room/paths **will not go any lower** — a hard
   lower limit.

This strongly implicates the **room ↔ connected-path-endpoint elevation
coupling** (`moveStructureGroup` + `setConnectedGroupEndpointElevations` /
`setConnectedEndpointElevations` in `src/store.ts`, and `connectMapPoint`'s
elevation snap). The path endpoints jumping UP when the room goes DOWN looks
like a wrong-sign / wrong-reference delta, or the endpoint elevation being set
from a stale or absolute value rather than tracking the room down. Hypothesis 3
below is now the leading candidate.

Note: this was observed by dragging the gizmo, but per attempt #1 the same
`updateRoom`/`moveMapPoint` code runs from the new sliders, so reproduce it via
both paths and compare. The earlier synthetic repros did NOT include a room
attached to a path **plus** additional connected segments, which is likely the
geometry that triggers this — build that exact topology when reproducing.

## Confirmed via the readout (2026-06-09)

With the elevation readout in place, the user confirmed a **hard cap at −20**:
dragging a room's gizmo below −20 keeps moving the mesh visually, but the
readout value stops changing at −20. This is the `normalizeRoom` clamp
(`clamp(room.elevation, -20, 40)` in `src/map.ts`) — expected, and a genuine
lower bound, but note it is *deeper* than the shallower floor originally
reported. So there appear to be (at least) two distinct effects:

1. The hard `[-20, 40]` normalize clamp (now confirmed at −20).
2. The shallower "won't go below ~−2" floor + connecting-paths-jump behavior
   (still unexplained; see above). This is the one to chase — it is not the
   −20 clamp.

The visual-vs-readout divergence below −20 is itself a minor bug: the gizmo's
mesh keeps following the pointer past the clamped value instead of staying
pinned at the limit. Low priority, but worth a note.

### Clamp widened and unified (2026-06-09)

The clamp was previously inconsistent: rooms and walls clamped to `[-20, 40]`,
the room/platform gizmo handlers separately clamped to `[-20, 40]`, while
platforms and path-point elevations were not clamped at all. Per the decision
that a clamp (if kept) must apply to everything, it is now:

- A single symmetric bound `ELEVATION_LIMIT = 100` with a shared
  `clampElevation()` helper in `src/map.ts`.
- Applied uniformly in `normalizeMap` to rooms, walls, platforms, and
  path-point elevations (`normalizeElevations`), and in the room/platform/wall
  gizmo handlers in `src/scene/MapScene.tsx`.
- The `PlatformPanel` elevation slider range widened to ±100 to match.

This is an interim choice — the clamp may be removed entirely later. It does
**not** address the shallow-floor / paths-jump bug, which is separate from the
clamp. Before fully removing the clamp, sanity-check the radial-fade/fog
distances and audio listener math against very large Y offsets.

## Current hypotheses (still open)

1. **Something resets/clamps elevation at render or on a later pass** that only
   manifests in the live app (not in direct store calls). E.g. a `useFrame`
   loop, a re-normalization, or a gizmo controlled-position feedback that snaps
   the value back up — but note the incremental-drag simulation did not show
   this.
2. **The source room is the one that's actually stuck**, and the new room is
   faithfully matching a source that the user cannot push past the floor. If
   so, the question becomes "why can't the source's elevation go below ~−2 in
   the live app?" — focus there, not on room creation.
3. **A connected-structure-group interaction**: dragging/lowering one member
   moves the whole group (`moveStructureGroup`), possibly with an anchor (an
   attached member that re-reads its path point) fighting the move, producing
   an equilibrium floor. Not reproduced, but the group-move coupling is real
   and worth instrumenting.
4. **Camera / drag-plane geometry** specific to the live canvas (the
   leverage/foreshortening idea from attempt #1) — but the numeric slider
   should have bypassed this, and didn't, which weakens it.

## Next discriminating checks (to run when resuming)

Ask the user (or capture via `window.polyStore` + `?debug=1` export) for a
concrete, reproducible case, and specifically:

1. **Is it the source or the new room that's stuck?** In the live app, before
   adding a room, read `roomElevation(map, sourceRoom)` for the source the
   user believes is deep. If it reports ≈ −2 while the user thinks it's −10,
   the bug is in *setting the source's* elevation, not in room creation.
   - `window.polyStore.getState().composition.map.rooms` — inspect each room's
     `elevation` / `attachment` and the `elevations` map.
2. **Does the new room's stored value actually equal the source's?** Right after
   the doorway "Room" action, compare the new room's `elevation` to the
   source's `roomElevation`. The store-level repro says they're equal — confirm
   that still holds in the user's real composition (which may have geometry the
   synthetic repros lacked: ramps, joints, tiling, multiple connected rooms).
3. **Does the new Elevation slider in `RoomPanel` reach −10 in the live app?**
   If the slider itself floors, the limit is downstream of `updateRoom`
   (rendering / re-normalization / group coupling). If the slider works but the
   doorway button still floors, the two paths diverge — compare them.
4. Capture the **edit-camera polar angle** and whether changing it changes the
   floor (tests hypothesis 4).
5. Gather **device, browser, and the exact composition** (export the manifest)
   — none of this is known yet.

## Useful pointers

- Creation paths: `growFromEntrance` and `addRoomAtPoint` in `src/store.ts`.
- Elevation resolution: `roomElevation`, `pointElevation`, `surfaceHeightAt` in
  `src/map.ts`. Clamp is `normalizeRoom` (`[-20, 40]`).
- Group elevation coupling: `connectedStructureKeys` / `moveStructureGroup` in
  `src/store.ts`.
- Point-drag elevation + snapping: `moveMapPoint` (store) → `connectMapPoint`
  (snap gate `MAP_ELEVATION_CONNECT_DISTANCE = 3`).
- Gizmos: `EndpointEditor` and `Room` in `src/scene/MapScene.tsx` bind
  TransformControls to a **React-controlled `position`** group (re-set every
  render), unlike `TrackGizmo` which uses a non-reactive `markerObjects`
  singleton — a possible source of mid-drag feedback worth ruling out.
