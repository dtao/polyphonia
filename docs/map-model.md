# Map Model

**Source:** `src/map.ts`

The `CompositionMap` defines the walkable world: where the listener can move,
what the acoustic boundaries are, and how the space tiles (if at all). The map
is stored in `composition.map` and is authoritative for both movement and
acoustics. Environment packs are visual dressing layered on top.

## Map objects

### Segments (`WalkableSegment`)

A path segment is a directed strip with a start and end point, a width, and a
kind:

- `kind: "path"` (default) — open walkable strip, no acoustic effect
- `kind: "tunnel"` — same walkable strip but enclosed (side walls + ceiling)
  that occludes sound between inside and outside

Segment endpoints are **branch points**: coincident endpoints across multiple
segments share one logical branch point, identified by `mapPointKey(point)`
(a rounded coordinate string). A branch point with only one segment attached
is a **terminal point**; with two or more it is a **joint**.

### Rooms (`MapRoom`)

An enclosed rectangular space (walls + ceiling) with one or more doorways. Key
properties:

- `center` / `rotation` / `width` / `depth` / `height` — geometry in world XZ
- `wallThickness` — affects occlusion strength
- `elevation` — floor height (attached rooms inherit their branch point's height)
- `entrances: RoomEntrance[]` — doorways cut into the walls
- `attachment?: RoomAttachment` — rooms grown from a terminal path point stay
  attached, meaning they are positioned automatically relative to that point

A room's interior is a rectangle; each entrance adds a doorway threshold
(`DOOR_DEPTH = 2.6`) that extends outside so the room connects to a path.

### Entrances and doors (`RoomEntrance`, `DoorConfig`)

Each entrance specifies which wall it's on (`side`), how wide it is, and an
offset along the wall (0 = centered). An entrance may optionally have a door:

```ts
interface DoorConfig {
  openFrom: "both" | "inside" | "outside";
}
```

A door slides open as the listener approaches (within `DOOR_OPEN_RADIUS = 4.5`
units). Directional doors respond only from the configured side. A closed door
fills its doorway and occludes sound exactly like a wall.

### Platforms (`MapPlatform`)

An open walkable area — like a room with no walls or ceiling. Three shapes:
`rect`, `hex`, `circle`. Platforms attach to terminal path points just like
rooms, inheriting their branch point's elevation. Listeners and stems move
freely across them; platforms don't occlude sound.

### Walls (`MapWall`)

A free-standing line segment placed purely to occlude sound between the listener
and stems. Walls do **not** block movement. `wallOcclusionStrength` converts
thickness into a 0–1 obstruction factor.

### Start position

`map.start` stores the listener's initial position `[x, z]` and facing
direction `[fx, fz]`. The store action `resetViewToMapStart` teleports the
camera there when entering a composition or switching to a different one.

## Elevation

Heights are stored in `map.elevations`, a `Record<string, number>` keyed by
`mapPointKey`. Only branch points get heights; segment floors ramp linearly
between their endpoints. Rooms and attached platforms inherit their branch
point's height; free platforms store their own elevation.

`surfaceHeightAt(map, point)` is the single source of truth for floor height
at any XZ position — used by the player, the floor mesh, and `focusY` tracking.

All elevations are clamped to `±ELEVATION_LIMIT` (100 units) to prevent runaway
drag values from escaping the playable world.

## Movement and collision

Movement is handled by `stepOnMap(map, previous, attempted)`:

1. If the map has no segments, rooms, or platforms ("open" map), movement is
   unconstrained.
2. Otherwise, movement is tracked by **support**: which segment, room, or
   platform the listener is currently on.
3. `transitionSupport` handles valid transitions: path→room (through a doorway),
   room→path, segment→adjacent segment (at shared endpoints), and
   anything→platform (when the footprint overlaps at a compatible elevation).
4. Walls and closed doors are hard stops via `stepHitsRoomWall`.
5. `clampToMap` finds the nearest walkable point when the attempted position is
   completely outside the map.

The player collision radius is `0.35` units, so doorways narrower than
`0.7` are impassable (movement geometry is inset by the radius).

## Topology rules

- A terminal point can host **at most one** attached room or platform.
- A path-loop requires exactly two terminal, unattached points as its endpoints.
- Attached rooms always face the path: the primary entrance is locked to the
  north wall (facing the path), centered at zero offset.
- Coincident endpoints are unified as one branch point. `normalizeMap` infers
  connections (`inferSegmentEndpointConnections`) and aligns endpoint
  coordinates (`alignConnectedSegmentEndpoints`) so the stored data is always
  self-consistent.

## Tiling

`map.tiling.type` controls how the space repeats:

| Type | Behavior |
|---|---|
| `"none"` | No repetition; finite map |
| `"path-loop"` | Two terminal points are identified; walking off one end wraps to the other |
| `"square"` | Map tiles on a square grid |
| `"hex"` | Map tiles on a hex grid |

For `path-loop`, the listener is teleported with a yaw correction when they
walk past a terminal endpoint (`wrapLoopPosition`). Tiled preview copies
(`tiledMapTransforms`) generate `LoopPreviewTransform` objects used by the
scene to position ghost geometry and virtual audio instances.

## Occlusion functions

The audio engine calls these pure geometry functions from `map.ts`:

- `roomWallObstructionCount(map, from, to)` — how many room walls the line
  crosses, weighted by thickness
- `tunnelObstructionCount(map, from, to)` — same for tunnel side walls
- `wallObstructionCount(map, from, to)` — same for standalone walls

Each returns a float in `[0, N]`. The engine combines them to set occlusion gain
and filter frequency.

## Normalization

`normalizeMap(value)` is always called on incoming manifests. It:

- Falls back to a preset's defaults for missing fields
- Validates and normalizes all geometry (segments, rooms, platforms, walls)
- Migrates the legacy `loop` field to `tiling.pathLoop`
- Infers and aligns segment endpoint connections
- Strips stale elevation keys (keys that no longer correspond to any segment endpoint)
- Clamps all elevations and validates the visible radius range
- Clamps the start position to the walkable map

## Visible radius override

`map.visibleRadius` lets composers set a custom radial fade band per composition:

```ts
interface { inner: number; outer: number }
```

When set, it overrides the engine defaults (`RADIAL_FADE_INNER = 90`,
`RADIAL_FADE_OUTER = 130`). The scene pushes this value into `src/scene/fade.ts`
on mount; the debug sliders take precedence over it. See
[scene-and-rendering.md](scene-and-rendering.md) for how radial fade works.

## Preset maps

`MAP_PRESETS` provides three built-in starting points:
- `"open"` — no segments, unconstrained movement
- `"line"` — a single straight tunnel segment
- `"y"` — a trunk segment splitting into two branches

`"custom"` is the preset stored when the user has edited the map.
