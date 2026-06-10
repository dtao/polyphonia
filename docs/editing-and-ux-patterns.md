# Editing and UX Patterns

**Sources:** `src/ui/`, `src/scene/EditControls.tsx`, `src/scene/TrackGizmo.tsx`,
`src/scene/MapScene.tsx`, `src/store.ts`

This document describes the editor's spatial conventions, selection model, and
layout rules. Follow these when building new editing features.

## Layout

### Top left — composition-level controls

The top-left area is reserved for controls that affect the composition as a
whole. Currently: **Environment**, **Map**, and **Loop** panel buttons that
open their respective drawers. New composition-level configuration belongs in
this stack, not in a new floating location.

### Bottom left — selected-object inspector

One contextual inspector appears here at a time, determined by what's selected:
stems, path points, path segments, rooms, entrances, platforms, or walls. The
inspector exposes properties and actions for the selected object. This slot is
mutually exclusive: only one inspector shows at a time.

### Top right / other areas

These are currently unoccupied by editing controls. Add new composition-level
configuration to the top-left stack before placing anything in new locations.

## Selection model

Selections are mutually exclusive across all object types. Selecting any object
clears all other selections. Clicking empty canvas or pressing Escape clears
the selection entirely.

In the store, each object type has its own field:

```ts
selectedId: string | null             // track/stem
selectedMapPointKey: string | null    // path endpoint
selectedMapSegmentId: string | null   // path segment
selectedRoomId: string | null         // room
selectedEntranceIndex: number | null  // entrance (sub-selection within room)
selectedPlatformId: string | null     // platform
selectedWallId: string | null         // standalone wall
selectedLandmarkId: string | null     // environment landmark
selectedStart: boolean                // start-position marker
```

**Preserve editing context:** when an action creates a new object (grow a path
branch, add a room, add an entrance), immediately select the new object so the
next likely action is already ready.

## Direct manipulation first

Move spatial objects in the 3D view. Use inspectors for properties and actions
that can't be expressed by dragging.

### Affordances by object type

| Object | Primary manipulation |
|---|---|
| Stem | Transform gizmo (translate) |
| Path endpoint | Drag endpoint handle; height via elevation input |
| Path segment | Drag to move both endpoints together |
| Room (free) | Transform gizmo (translate + rotate) |
| Room (attached) | Drag attachment point moves room with path endpoint |
| Room entrance | Drag doorway handle along its wall |
| Platform (free) | Transform gizmo |
| Platform (attached) | Moves with attachment point |
| Standalone wall | Drag endpoints |
| Start marker | Translate or rotate gizmo (toggle via inspector) |

### Camera controls during drag

Camera controls are disabled while any object is being dragged. This prevents
accidental orbit while manipulating an object.

## Connectivity is visible behavior

Structural topology has real consequences for walkability and audio. The editor
should make these visible:

- **Branch points** are shared endpoints. Moving a shared endpoint moves all
  segments connected to it simultaneously.
- **Attached rooms/platforms** are positioned automatically relative to their
  branch point. Their inspector shows the attachment and offers a detach action.
- **Doorways** are visible gaps in room walls. An entrance with a door shows the
  door sliding open/closed as you approach in explore mode.
- **Path-loop endpoints** show a visual indicator distinguishing start from end.

## Rooms and platforms as graph destinations

Rooms and platforms are not decorative — they are destinations in the same path
graph. Growing a branch from a room entrance or platform edge creates a new
segment. Moving a room with connections preserves those connections and shared
elevation.

## Walkability and acoustics are distinct

- Paths, rooms, and platforms define where the listener can **move**.
- Room/tunnel walls and standalone walls shape **occlusion**.
- Environment packs are **visual only** — they have no effect on movement or
  acoustics.

When adding geometry to the map, be explicit about whether it affects movement,
acoustics, or only appearance.

## The undo/redo system

All map, room, environment, loop, and stem edits go through `withHistory` in the
store, making them reversible with Ctrl-Z / Ctrl-Y.

Exceptions that are intentionally not undoable:
- Mode switches (explore ↔ edit)
- Selections
- Camera position

Do not call `withHistory` for selection changes — it would pollute the undo
stack with undo entries the user can't meaningfully interpret.

## Mode switching

`mode: "explore" | "edit"` controls which camera and controls are active:

- **Explore** (`<Player>` + `<PointerLockControls>`) — listener moves freely
  through the map; audio is spatially active; no editing affordances visible.
- **Edit** (`<EditControls>` orbit camera) — orbit around the composition;
  all editing affordances visible; audio still plays but the listener position
  is the orbit pivot.

Switching mode preserves `viewState` (x, z, facing direction) so the camera
returns to where you were.

## Adding a stem

1. User clicks "Add Stem" in the `<PropertiesPanel>`.
2. A new `TrackDef` is created with `newId()` and placed at `viewState.x, 0,
   viewState.z` (or `focusY` for elevation).
3. A `{kind: "synth"}` source is used as placeholder until audio is uploaded.
4. The new track is selected immediately so the inspector is ready.

## Entry screen

`<EntryScreen>` (visible before `entered = true`) shows:
- Library chooser (list of saved compositions)
- New / export / import buttons
- Sign-in / account management
- Gallery link

Clicking "Enter" sets `entered = true` and starts audio. The entry click is
also the gesture that captures pointer lock (required by browser autoplay
policy). Do not add a separate click step between entry and audio start.
