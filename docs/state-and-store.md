# State and Store

**Source:** `src/store.ts`

The Zustand store (`useStore`) is the single source of truth for the entire
application. The scene renders from it; UI panels read from it; edits flow
back through it; persistence and audio updates are triggered by it.

## Reactive state

The store holds two broad categories of reactive state:

### Composition + library

| Field | Type | Purpose |
|---|---|---|
| `composition` | `Composition` | The currently open and playing composition |
| `library` | `SerializedComposition[]` | All saved compositions (serialized manifests) |
| `undoStack` | `Composition[]` | Previous compositions for Ctrl-Z |
| `redoStack` | `Composition[]` | Forward compositions for Ctrl-Y |
| `engine` | `AudioEngine \| null` | The live audio engine |
| `audioLoading` | `AudioLoadingState` | Loading/error state for the entry screen |
| `publishProgress` | `PublishProgress \| null` | Cloud upload progress |

### Editor / UI state

| Field | Purpose |
|---|---|
| `mode` | `"explore"` or `"edit"` — which camera and controls are active |
| `selectedId` | Track id of the selected stem (null = none) |
| `selectedMapPointKey` | Selected path endpoint, keyed by `mapPointKey()` |
| `selectedMapSegmentId` | Selected path segment id |
| `selectedRoomId` | Selected room id |
| `selectedEntranceIndex` | Sub-selection within a room |
| `selectedPlatformId` | Selected platform id |
| `selectedWallId` | Selected wall id |
| `selectedLandmarkId` | Selected environment landmark id |
| `selectedStart` | Whether the map start marker is selected |
| `entered` | Whether the user has passed the entry screen |
| `viewer` | Read-only viewer mode (no autosave, no editing) |
| `user` | Signed-in `AuthUser` or null |
| `accountArtist` | Primary artist identity for the signed-in user |
| `authReady` | Whether the initial Supabase session lookup completed |

Selections are mutually exclusive: selecting one object type clears all others.
The store enforces this in each `select*` action.

## Non-reactive module singletons

Frame-sensitive state that must never trigger React re-renders lives in
module-level variables exported directly from `store.ts`:

```ts
export const viewState = { x, y, z, focusY, fx, fz };
export const markerObjects = new Map<string, THREE.Object3D>();
export const loopWrap = { generation: number };
export const loopPreviewGroups = new Set<THREE.Object3D>();
export const touchMove = { forward, strafe };
export const arWalk = { active, pendingX, pendingZ, renderX, … };
export const geoWalk = { active, pendingX, pendingZ };
export const pendingTeleport = { value: null | { x, z } };
```

These are written and read inside `useFrame` callbacks and event handlers.
Importing them does not subscribe to changes; they are plain mutable objects.

- `viewState` — the listener's XZ ground anchor, elevation `y`, focus elevation
  `focusY`, and facing direction `fx`/`fz`. Shared across explore and edit modes
  so switching preserves position and heading.
- `markerObjects` — map from track id to the `THREE.Object3D` of its marker,
  so the `<TrackGizmo>` can attach without prop-drilling refs.
- `loopWrap` — bumped by `<Player>` on each path-loop seam wrap. `<Scene>` reads
  it to suppress preview-group rendering for one frame.
- `loopPreviewGroups` — groups registered by preview components that can't run
  their own wrap guard; hidden by `<Scene>` on wrap frames.
- `touchMove` — virtual joystick vector from `<TouchControls>`, consumed by
  `<Player>` alongside WASD.
- `arWalk` / `geoWalk` — alternative mobile inputs.
- `pendingTeleport` — written by `<MapScene>` on double-click; consumed by
  `<EditControls>` to shift the orbit pivot.

## Undo / redo with `withHistory`

Composition edits that should be reversible go through `withHistory`:

```ts
function withHistory(state: StoreState, next: Composition): Partial<StoreState> {
  return {
    composition: next,
    undoStack: [...state.undoStack, state.composition],
    redoStack: [],
  };
}
```

Every store action that calls `withHistory` produces a new undo entry. Actions
that do *not* use `withHistory` (e.g. selecting an object, toggling mode) are
not undoable.

Map, room, environment, loop, and stem edits all go through `withHistory`. The
only deliberate exception is live audio parameters (volume, position, falloff)
that also call engine setters — these use `withHistory` so they're undoable,
but the engine setter fires regardless so the audio responds immediately.

## Audio stays live

Track edits that affect audio follow a two-step pattern:

```ts
setTrackPosition: (id, position) => {
  const next = /* update composition.tracks */;
  get().engine?.setPosition(id, position);  // live update, no restart
  set(withHistory(state, next));            // undoable state update
}
```

The engine is never restarted to apply an edit. Setters on `AudioEngine`
(`setPosition`, `setVolume`, `setFalloff`) update the Web Audio graph in place.

## Auto-save

The store automatically persists the library to localStorage whenever the
composition changes. This is a thin side effect in the relevant actions, not a
separate sync loop.

## Dev access

In development builds `window.polyStore` exposes the full Zustand store. Call
`window.polyStore.getState()` to inspect state or `window.polyStore.setState()`
to inject values (e.g. to shim a fake auth session for previewing the editor
without a Supabase account — see AGENTS.md "Driving the editor in preview").

## StrictMode is intentionally off

React StrictMode's dev-only double-mount duplicates pointer-lock listeners and
rebuilds the `AudioContext`. It is permanently disabled in `src/main.tsx`. Do
not re-enable it.
