export type MapPreset = "open" | "line" | "y" | "custom";

// A plain "path" is an open walkable strip. A "tunnel" is the same walkable
// strip but enclosed by side walls + a ceiling, so it occludes sound between
// the inside of the corridor and the world outside it.
export type SegmentKind = "path" | "tunnel";

export interface WalkableSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  width: number;
  kind?: SegmentKind; // absent = "path"
  wallThickness?: number; // tunnel side/ceiling thickness; absent = thin default
  connections?: Partial<Record<SegmentEnd, SegmentEndpointConnection>>;
}

export type RoomSide = "north" | "south" | "east" | "west";
export type SegmentEnd = "start" | "end";
export type MapTilingType = "none" | "path-loop" | "square" | "hex";

export type SegmentEndpointConnection =
  | { kind: "room"; roomId: string; localPoint: [number, number]; entranceIndex?: number; entranceOffset?: number }
  | { kind: "platform"; platformId: string; localPoint: [number, number] };

export interface RoomAttachment {
  segmentId: string;
  end: SegmentEnd;
}

// A door that slides open as the listener approaches. `openFrom` controls which
// side it responds to: "both", only from "inside" the room, or only from
// "outside". A closed door fills its doorway and occludes sound like a wall.
export interface DoorConfig {
  openFrom: "both" | "inside" | "outside";
}

// A doorway cut into one of a room's walls. A room can have several, on any
// combination of walls, so it can open onto multiple paths/rooms.
export interface RoomEntrance {
  side: RoomSide; // which wall this opening is cut into
  width: number; // doorway opening width
  offset: number; // center offset along the wall (0 = centered)
  door?: DoorConfig; // absent = permanently open gap
}

// An enclosed rectangular space (walls + ceiling) with one or more doorways that
// open onto the rest of the walkable map. (Sonic character — reverb/echo from
// wall reflections — is handled by the audio engine's room acoustics.)
export interface MapRoom {
  id: string;
  center: [number, number]; // x, z of the interior center
  rotation: number; // radians around y; room geometry is defined in local x/z
  width: number; // interior extent along x
  depth: number; // interior extent along z
  height: number; // wall / ceiling height
  wallThickness?: number; // wall / ceiling mass; absent = thin default
  elevation?: number; // flat floor height (attached legacy rooms inherit branch height when absent)
  entrances: RoomEntrance[]; // doorways cut into the walls (at least one)
  attachment?: RoomAttachment; // rooms created from path endpoints stay attached to that branch point
}

// Older manifests stored a single entrance inline; accepted on read and
// migrated to `entrances` by `normalizeRoom`.
type LegacyRoomEntrance = Partial<{ entranceSide: RoomSide; entranceWidth: number; entranceOffset: number }>;
type RawMapRoom = Omit<MapRoom, "entrances" | "rotation" | "height" | "elevation"> &
  Partial<Pick<MapRoom, "entrances" | "rotation" | "height" | "elevation">> &
  LegacyRoomEntrance;

// A free-standing wall placed anywhere on the map purely to occlude sound — it
// is not a walkable boundary, just an obstacle between listener and stems.
export interface MapWall {
  id: string;
  start: [number, number];
  end: [number, number];
  height: number;
  wallThickness?: number;
}

export type PlatformShape = "rect" | "hex" | "circle";

// A large open walkable area — like a room with no walls or ceiling. Stems and
// the listener move across it freely; it connects to any path/room/platform
// whose walkable area it overlaps.
export interface MapPlatform {
  id: string;
  center: [number, number];
  rotation: number; // radians around y
  shape: PlatformShape;
  width: number; // rect: extent along x; circle/hex: outer diameter
  depth: number; // rect: extent along z (unused for circle/hex)
  elevation: number; // flat surface height (ignored when attached — inherits the branch point)
  attachment?: RoomAttachment; // platforms attach to a terminal branch point, like rooms
}

export interface MapTiling {
  type: MapTilingType;
  origin: [number, number];
  tileSize: number;
  pathLoop?: {
    start?: RoomAttachment;
    end?: RoomAttachment;
  };
}

export interface CompositionMap {
  preset: MapPreset;
  segments: WalkableSegment[];
  rooms: MapRoom[];
  platforms: MapPlatform[];
  walls: MapWall[];
  tiling: MapTiling;
  /** @deprecated Use tiling.pathLoop. Kept as a compatibility mirror for older code/manifests. */
  loop?: {
    start?: RoomAttachment;
    end?: RoomAttachment;
  };
  /**
   * Surface height (y) at each branch point, keyed by `mapPointKey`. Segments
   * ramp linearly between their endpoints' elevations; absent or 0 means flat.
   * Joints share one height because they share a key.
   */
  elevations?: Record<string, number>;
  wallHeight: number;
  start: {
    position: [number, number];
    direction: [number, number];
  };
}

export type MapSupport =
  | { kind: "open" }
  | { kind: "segment"; segmentId: string }
  | { kind: "room"; roomId: string }
  | { kind: "platform"; platformId: string };

export const DEFAULT_WALL_THICKNESS = 0.3;
export const MIN_WALL_THICKNESS = 0.15;
export const MAX_WALL_THICKNESS = 3;
export const ROOM_WALL_THICKNESS = DEFAULT_WALL_THICKNESS;
// How far the walkable doorway "threshold" extends outside the entrance wall, so
// a room positioned against a path connects to it.
export const DOOR_DEPTH = 2.6;
const PLAYER_COLLISION_RADIUS = 0.35;

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

export const defaultTiling: MapTiling = { type: "none", origin: [0, 0], tileSize: 80 };

export const MAP_PRESETS: Record<Exclude<MapPreset, "custom">, CompositionMap> = {
  open: { preset: "open", segments: [], rooms: [], platforms: [], walls: [], tiling: defaultTiling, wallHeight: 0, start: { position: [0, 0], direction: [0, -1] } },
  line: {
    preset: "line",
    wallHeight: 2.1,
    rooms: [],
    platforms: [],
    walls: [],
    tiling: defaultTiling,
    start: { position: [0, 36], direction: [0, -1] },
    segments: [{ id: "line", start: [0, 40.5], end: [0, -40.5], width: 7.5 }],
  },
  y: {
    preset: "y",
    wallHeight: 2.1,
    rooms: [],
    platforms: [],
    walls: [],
    tiling: defaultTiling,
    start: { position: [0, 36], direction: [0, -1] },
    segments: [
      { id: "trunk", start: [0, 40.5], end: [0, -6.75], width: 7.5 },
      { id: "left", start: [0, -6.75], end: [-27, -38.25], width: 7.5 },
      { id: "right", start: [0, -6.75], end: [27, -38.25], width: 7.5 },
    ],
  },
};

export const defaultMap: CompositionMap = MAP_PRESETS.open;

export function normalizeMap(value: Partial<CompositionMap> | undefined): CompositionMap {
  const preset = isMapPreset(value?.preset) ? value.preset : defaultMap.preset;
  const fallback = preset === "custom" ? defaultMap : MAP_PRESETS[preset];
  const segments = Array.isArray(value?.segments) ? value.segments.filter(isWalkableSegment).map(normalizeSegment) : fallback.segments;
  const rooms = Array.isArray(value?.rooms) ? value.rooms.filter(isMapRoom).map(normalizeRoom) : fallback.rooms;
  const platforms = Array.isArray(value?.platforms) ? value.platforms.filter(isMapPlatform).map(normalizePlatform) : fallback.platforms;
  const walls = Array.isArray(value?.walls) ? value.walls.filter(isMapWall).map(normalizeWall) : fallback.walls;
  const startPosition = isPoint(value?.start?.position) ? value.start.position : fallback.start.position;
  const startDirection = normalizeDirection(isPoint(value?.start?.direction) ? value.start.direction : fallback.start.direction);
  const legacyLoop = isMapLoop(value?.loop) ? value.loop : undefined;
  const tiling = normalizeMapTiling(value?.tiling, legacyLoop, fallback.tiling);
  const map = alignConnectedSegmentEndpoints(inferSegmentEndpointConnections(alignAttachedRooms({
    preset,
    segments,
    rooms,
    platforms,
    walls,
    tiling,
    loop: tiling.type === "path-loop" ? tiling.pathLoop : legacyLoop,
    wallHeight: clamp(value?.wallHeight ?? fallback.wallHeight, 0, 8),
    start: {
      position: startPosition,
      direction: startDirection,
    },
  })));
  map.loop = normalizeMapLoop(map);
  map.tiling = normalizeMapTiling({ ...tiling, pathLoop: map.loop }, undefined, fallback.tiling);
  map.loop = map.tiling.type === "path-loop" ? map.tiling.pathLoop : undefined;
  const elevations = normalizeElevations(value?.elevations, map.segments);
  return {
    ...map,
    // Omit when flat so untiled/older compositions keep an identical shape (and
    // an identical publish revision hash).
    ...(Object.keys(elevations).length ? { elevations } : {}),
    start: {
      ...map.start,
      position: clampToMap(map, map.start.position),
    },
  };
}

// Keep only finite, non-zero heights whose key still matches a segment endpoint,
// so stale entries don't accumulate as points move or are deleted.
function normalizeElevations(value: unknown, segments: WalkableSegment[]): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const keys = new Set<string>();
  for (const segment of segments) {
    keys.add(mapPointKey(segment.start));
    keys.add(mapPointKey(segment.end));
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof raw === "number" && Number.isFinite(raw) && raw !== 0) out[key] = raw;
  }
  return out;
}

function normalizeSegment(segment: WalkableSegment): WalkableSegment {
  const connections = normalizeSegmentConnections(segment.connections);
  return {
    ...segment,
    ...(segment.kind === "tunnel" ? { wallThickness: normalizeWallThickness(segment.wallThickness) } : { wallThickness: undefined }),
    ...(connections ? { connections } : {}),
  };
}

function normalizeSegmentConnections(value: unknown): WalkableSegment["connections"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<Record<SegmentEnd, unknown>>;
  const start = normalizeSegmentConnection(raw.start);
  const end = normalizeSegmentConnection(raw.end);
  return start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined;
}

function normalizeSegmentConnection(value: unknown): SegmentEndpointConnection | undefined {
  const connection = value as SegmentEndpointConnection | undefined;
  if (!connection || typeof connection !== "object") return undefined;
  if (connection.kind === "room" && typeof connection.roomId === "string" && isPoint(connection.localPoint)) {
    const entranceIndex = typeof connection.entranceIndex === "number" && Number.isInteger(connection.entranceIndex) && connection.entranceIndex >= 0 ? connection.entranceIndex : undefined;
    const entranceOffset = typeof connection.entranceOffset === "number" && Number.isFinite(connection.entranceOffset) ? connection.entranceOffset : undefined;
    return { kind: "room", roomId: connection.roomId, localPoint: connection.localPoint, ...(entranceIndex !== undefined ? { entranceIndex } : {}), ...(entranceOffset !== undefined ? { entranceOffset } : {}) };
  }
  if (connection.kind === "platform" && typeof connection.platformId === "string" && isPoint(connection.localPoint)) {
    return { kind: "platform", platformId: connection.platformId, localPoint: connection.localPoint };
  }
  return undefined;
}

function inferSegmentEndpointConnections(map: CompositionMap): CompositionMap {
  return {
    ...map,
    segments: map.segments.map((segment) => {
      const start = validConnection(map, segment.connections?.start) ?? inferEndpointConnection(map, segment, "start");
      const end = validConnection(map, segment.connections?.end) ?? inferEndpointConnection(map, segment, "end");
      return {
        ...segment,
        ...(start || end ? { connections: { ...(start ? { start } : {}), ...(end ? { end } : {}) } } : { connections: undefined }),
      };
    }),
  };
}

function alignConnectedSegmentEndpoints(map: CompositionMap): CompositionMap {
  return {
    ...map,
    segments: map.segments.map((segment) => {
      let next = segment;
      for (const end of ["start", "end"] as const) {
        const point = segmentConnectionPoint(map, segment.connections?.[end]);
        if (!point) continue;
        next = { ...next, [end]: point };
      }
      return next;
    }),
  };
}

function validConnection(map: CompositionMap, connection: SegmentEndpointConnection | undefined): SegmentEndpointConnection | undefined {
  if (!connection) return undefined;
  if (connection.kind === "room") return map.rooms.some((room) => room.id === connection.roomId) ? connection : undefined;
  return map.platforms.some((platform) => platform.id === connection.platformId) ? connection : undefined;
}

function inferEndpointConnection(map: CompositionMap, segment: WalkableSegment, end: SegmentEnd): SegmentEndpointConnection | undefined {
  const point = end === "start" ? segment.start : segment.end;
  for (const room of map.rooms) {
    const localPoint = toRoomLocal(room, point);
    const entranceIndex = room.entrances.findIndex((entrance) => pointInRect(localPoint, doorwayRect(room, entrance)));
    if (entranceIndex >= 0) {
      return { kind: "room", roomId: room.id, localPoint, entranceIndex, entranceOffset: room.entrances[entranceIndex].offset };
    }
  }
  for (const platform of map.platforms) {
    if (platformContains(platform, point)) return { kind: "platform", platformId: platform.id, localPoint: toPlatformLocal(platform, point) };
  }
  return undefined;
}

function segmentConnectionPoint(map: Pick<CompositionMap, "rooms" | "platforms">, connection: SegmentEndpointConnection | undefined): [number, number] | null {
  if (!connection) return null;
  if (connection.kind === "room") {
    const room = map.rooms.find((r) => r.id === connection.roomId);
    return room ? fromRoomLocal(room, roomConnectionLocalPoint(room, connection)) : null;
  }
  const platform = map.platforms.find((p) => p.id === connection.platformId);
  return platform ? fromPlatformLocal(platform, connection.localPoint) : null;
}

function roomConnectionLocalPoint(room: MapRoom, connection: Extract<SegmentEndpointConnection, { kind: "room" }>): [number, number] {
  const entrance = connection.entranceIndex !== undefined ? room.entrances[connection.entranceIndex] : undefined;
  if (!entrance) return connection.localPoint;
  const [cx, cz] = entranceLocalCenter(room, entrance);
  const originalOffset = connection.entranceOffset ?? entrance.offset;
  const local = connection.localPoint;
  if (entrance.side === "north" || entrance.side === "south") return [entrance.offset + (local[0] - originalOffset), cz];
  return [cx, entrance.offset + (local[1] - originalOffset)];
}

function hasWalkableBounds(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">): boolean {
  return map.segments.length > 0 || map.rooms.length > 0 || map.platforms.length > 0;
}

export function clampToMap(map: CompositionMap, point: [number, number]): [number, number] {
  // No constraints on a fully open map (no segments, rooms, or platforms).
  if (!hasWalkableBounds(map)) return point;
  if (isPointInsideMap(map, point)) return point;

  let best: [number, number] = point;
  let bestDistanceSq = Infinity;
  const consider = (candidate: [number, number]) => {
    const dx = point[0] - candidate[0];
    const dz = point[1] - candidate[1];
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  };
  for (const segment of map.segments) consider(closestPointInSegment(point, segment));
  for (const room of map.rooms) for (const rect of roomRegionRects(room)) consider(fromRoomLocal(room, closestInRect(toRoomLocal(room, point), rect)));
  for (const platform of map.platforms) consider(closestPointInPlatform(platform, point));
  return best;
}

export interface MapStep {
  position: [number, number];
  support: MapSupport;
}

export function mapSupportAt(map: CompositionMap, point: [number, number], previous?: MapSupport | null): MapSupport {
  if (!hasWalkableBounds(map)) return { kind: "open" };
  const previousSupport = previous && supportExists(map, previous) ? previous : null;
  if (previousSupport && supportContains(map, previousSupport, point)) return previousSupport;

  const room = containingRoom(map, point);
  if (room) return { kind: "room", roomId: room.id };

  const segment = nearestSegmentContaining(map, point);
  if (segment) return { kind: "segment", segmentId: segment.id };

  const platform = containingPlatform(map, point);
  if (platform) return { kind: "platform", platformId: platform.id };

  const clamped = clampToMap(map, point);
  const clampedRoom = containingRoom(map, clamped);
  if (clampedRoom) return { kind: "room", roomId: clampedRoom.id };
  const clampedPlatform = containingPlatform(map, clamped);
  if (clampedPlatform) return { kind: "platform", platformId: clampedPlatform.id };
  if (!map.segments.length) return { kind: "platform", platformId: map.platforms[0]?.id ?? "" };
  return { kind: "segment", segmentId: nearestSegment(map.segments, clamped)?.id ?? map.segments[0]?.id ?? "" };
}

export function stepOnMap(map: CompositionMap, previous: [number, number], attempted: [number, number], previousSupport?: MapSupport | null): MapStep {
  if (!hasWalkableBounds(map)) return { position: attempted, support: { kind: "open" } };
  const support = previousSupport && supportExists(map, previousSupport) ? previousSupport : mapSupportAt(map, previous, previousSupport);

  if (stepHitsRoomWall(map, previous, attempted)) return { position: previous, support };

  if (supportContainsForMovement(map, support, attempted, previous)) return { position: attempted, support };

  const transition = transitionSupport(map, support, previous, attempted);
  if (transition) return transition;

  return {
    position: clampToSupport(map, support, attempted, previous) ?? clampToMap(map, attempted),
    support,
  };
}

export function isPointInsideMap(map: CompositionMap, point: [number, number]): boolean {
  if (!hasWalkableBounds(map)) return true;
  return (
    map.segments.some((segment) => pointInSegment(point, segment)) ||
    map.rooms.some((room) => roomContains(room, point)) ||
    map.platforms.some((platform) => platformContains(platform, point))
  );
}

// --- Room geometry ---

export function interiorRect(room: MapRoom): Rect {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  return { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
}

export function wallThickness(value: number | undefined): number {
  return normalizeWallThickness(value);
}

export function wallOcclusionStrength(value: number | undefined): number {
  const thickness = normalizeWallThickness(value);
  if (thickness <= DEFAULT_WALL_THICKNESS) {
    return lerp(0.32, 0.5, (thickness - MIN_WALL_THICKNESS) / (DEFAULT_WALL_THICKNESS - MIN_WALL_THICKNESS));
  }
  const t = (thickness - DEFAULT_WALL_THICKNESS) / (MAX_WALL_THICKNESS - DEFAULT_WALL_THICKNESS);
  return lerp(0.5, 1, Math.pow(clamp(t, 0, 1), 0.72));
}

// The walkable doorway threshold for one entrance: a strip the entrance width
// wide that bridges the wall gap and extends DOOR_DEPTH outside, so the room
// connects to a path.
function doorwayRect(room: MapRoom, entrance: RoomEntrance): Rect {
  const r = interiorRect(room);
  const ew = Math.max(0.5, entrance.width);
  const a = entrance.offset - ew / 2;
  const b = entrance.offset + ew / 2;
  switch (entrance.side) {
    case "north":
      return { minX: a, maxX: b, minZ: r.minZ - DOOR_DEPTH, maxZ: r.minZ };
    case "south":
      return { minX: a, maxX: b, minZ: r.maxZ, maxZ: r.maxZ + DOOR_DEPTH };
    case "west":
      return { minX: r.minX - DOOR_DEPTH, maxX: r.minX, minZ: a, maxZ: b };
    case "east":
      return { minX: r.maxX, maxX: r.maxX + DOOR_DEPTH, minZ: a, maxZ: b };
  }
}

export function roomRegionRects(room: MapRoom): Rect[] {
  return [interiorRect(room), ...room.entrances.map((entrance) => doorwayRect(room, entrance))];
}

function movementRoomRegionRects(room: MapRoom, listener: [number, number]): Rect[] {
  const r = insetRect(interiorRect(room), PLAYER_COLLISION_RADIUS);
  return [r, ...room.entrances.filter((entrance) => doorIsOpen(room, entrance, listener)).map((entrance) => movementDoorwayRect(room, entrance)).filter(rectHasArea)];
}

function movementDoorwayRect(room: MapRoom, entrance: RoomEntrance): Rect {
  const r = interiorRect(room);
  const halfWidth = Math.max(0.5, entrance.width) / 2;
  const a = entrance.offset - halfWidth + PLAYER_COLLISION_RADIUS;
  const b = entrance.offset + halfWidth - PLAYER_COLLISION_RADIUS;
  switch (entrance.side) {
    case "north":
      return { minX: a, maxX: b, minZ: r.minZ - DOOR_DEPTH, maxZ: r.minZ + PLAYER_COLLISION_RADIUS };
    case "south":
      return { minX: a, maxX: b, minZ: r.maxZ - PLAYER_COLLISION_RADIUS, maxZ: r.maxZ + DOOR_DEPTH };
    case "west":
      return { minX: r.minX - DOOR_DEPTH, maxX: r.minX + PLAYER_COLLISION_RADIUS, minZ: a, maxZ: b };
    case "east":
      return { minX: r.maxX - PLAYER_COLLISION_RADIUS, maxX: r.maxX + DOOR_DEPTH, minZ: a, maxZ: b };
  }
}

function insetRect(rect: Rect, amount: number): Rect {
  return { minX: rect.minX + amount, maxX: rect.maxX - amount, minZ: rect.minZ + amount, maxZ: rect.maxZ - amount };
}

function rectHasArea(rect: Rect): boolean {
  return rect.minX < rect.maxX && rect.minZ < rect.maxZ;
}

// Local-space (x,z) center of an entrance's doorway, on its wall line.
export function entranceLocalCenter(room: MapRoom, entrance: RoomEntrance): [number, number] {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  switch (entrance.side) {
    case "north":
      return [entrance.offset, -hd];
    case "south":
      return [entrance.offset, hd];
    case "west":
      return [-hw, entrance.offset];
    case "east":
      return [hw, entrance.offset];
  }
}

// Convert between world XZ and a room's local frame (for entrance editing).
export function roomLocalPoint(room: MapRoom, worldPoint: [number, number]): [number, number] {
  return toRoomLocal(room, worldPoint);
}

export function roomWorldPoint(room: MapRoom, localPoint: [number, number]): [number, number] {
  return fromRoomLocal(room, localPoint);
}

// Largest doorway width allowed on a given wall.
export function maxEntranceWidth(room: MapRoom, side: RoomSide): number {
  return Math.max(1, entranceSpan(side, room.width, room.depth, room.wallThickness));
}

// World point a short distance outside an entrance's doorway. Used to test
// whether the doorway leads anywhere, and to aim a path grown from it.
export function entranceOuterPoint(room: MapRoom, entrance: RoomEntrance, distance = 1.6): [number, number] {
  const [lx, lz] = entranceLocalCenter(room, entrance);
  const n: [number, number] =
    entrance.side === "north" ? [0, -1] : entrance.side === "south" ? [0, 1] : entrance.side === "west" ? [-1, 0] : [1, 0];
  return roomWorldPoint(room, [lx + n[0] * distance, lz + n[1] * distance]);
}

// A doorway "leads nowhere" when nothing walkable sits just outside it.
export function entranceConnects(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">, room: MapRoom, entrance: RoomEntrance): boolean {
  const outer = entranceOuterPoint(room, entrance);
  return (
    map.segments.some((segment) => pointInSegment(outer, segment)) ||
    map.rooms.some((other) => other.id !== room.id && roomContains(other, outer)) ||
    map.platforms.some((platform) => platformContains(platform, outer))
  );
}

function openingInterval(entrance: RoomEntrance): [number, number] {
  const ew = Math.max(0.5, entrance.width);
  return [entrance.offset - ew / 2, entrance.offset + ew / 2];
}

// Opening intervals along a given wall (in that wall's local coordinate), and
// the solid spans left over once every opening is removed. Used by the wall
// mesh builder, where every doorway is always a gap (a door is a separate
// sliding panel that fills it).
export function wallOpenings(room: MapRoom, side: RoomSide): Array<[number, number]> {
  return room.entrances.filter((entrance) => entrance.side === side).map(openingInterval);
}

// Like `wallOpenings`, but a doorway with a *closed* door (for the given
// listener) is treated as solid, so sound can't leak through it.
function openWallOpenings(room: MapRoom, side: RoomSide, listener: [number, number]): Array<[number, number]> {
  return room.entrances.filter((entrance) => entrance.side === side && doorIsOpen(room, entrance, listener)).map(openingInterval);
}

export function solidWallSpans(half: number, openings: Array<[number, number]>): Array<[number, number]> {
  let spans: Array<[number, number]> = [[-half, half]];
  for (const [a, b] of openings) {
    const next: Array<[number, number]> = [];
    for (const [s, e] of spans) {
      const lo = Math.max(s, a);
      const hi = Math.min(e, b);
      if (lo >= hi) {
        next.push([s, e]);
        continue;
      }
      if (lo - s > 0.05) next.push([s, lo]);
      if (e - hi > 0.05) next.push([hi, e]);
    }
    spans = next;
  }
  return spans;
}

export function roomContains(room: MapRoom, point: [number, number]): boolean {
  const local = toRoomLocal(room, point);
  return roomRegionRects(room).some((rect) => pointInRect(local, rect));
}

export function roomInteriorContains(room: MapRoom, point: [number, number]): boolean {
  return pointInRect(toRoomLocal(room, point), interiorRect(room));
}

function movementRoomContains(room: MapRoom, point: [number, number], listener: [number, number]): boolean {
  const local = toRoomLocal(room, point);
  return movementRoomRegionRects(room, listener).some((rect) => pointInRect(local, rect));
}

export function containingRoom(map: Pick<CompositionMap, "rooms">, point: [number, number]): MapRoom | null {
  return map.rooms.find((room) => roomInteriorContains(room, point)) ?? null;
}

export function roomWallObstructionCount(map: Pick<CompositionMap, "rooms">, from: [number, number], to: [number, number]): number {
  let amount = 0;
  for (const room of map.rooms) {
    const a = toRoomLocal(room, from);
    const b = toRoomLocal(room, to);
    const aInside = pointInRect(a, interiorRect(room));
    const bInside = pointInRect(b, interiorRect(room));
    if (aInside === bInside) continue;
    // `from` is the listener, so closed doors (relative to it) become solid.
    if (lineHitsSolidRoomWall(room, a, b, from)) amount += wallOcclusionStrength(room.wallThickness);
  }
  return amount;
}

// --- Doors ---

// How close (beyond the doorway threshold) the listener must be for a door to
// stand fully open.
const DOOR_OPEN_RADIUS = 4.5;

// World-space center of an entrance's doorway opening, on its wall line.
export function entranceDoorwayCenter(room: MapRoom, entrance: RoomEntrance): [number, number] {
  const r = interiorRect(room);
  let local: [number, number];
  switch (entrance.side) {
    case "north":
      local = [entrance.offset, r.minZ];
      break;
    case "south":
      local = [entrance.offset, r.maxZ];
      break;
    case "west":
      local = [r.minX, entrance.offset];
      break;
    case "east":
      local = [r.maxX, entrance.offset];
      break;
  }
  return fromRoomLocal(room, local);
}

// 0 (shut) … 1 (wide open) for an entrance's door given the listener position.
// No door = always 1. A directional door stays shut for a listener on the wrong
// side; otherwise it opens smoothly as the listener nears the doorway.
export function doorOpenAmount(room: MapRoom, entrance: RoomEntrance, listener: [number, number]): number {
  if (!entrance.door) return 1;
  const inside = roomInteriorContains(room, listener);
  const allowed = entrance.door.openFrom === "both" || (entrance.door.openFrom === "inside" ? inside : !inside);
  if (!allowed) return 0;
  const center = entranceDoorwayCenter(room, entrance);
  const distance = Math.hypot(listener[0] - center[0], listener[1] - center[1]);
  return clamp(1 - (distance - 0.5) / DOOR_OPEN_RADIUS, 0, 1);
}

export function doorIsOpen(room: MapRoom, entrance: RoomEntrance, listener: [number, number]): boolean {
  return doorOpenAmount(room, entrance, listener) > 0.5;
}

export function isTunnelSegment(segment: WalkableSegment): boolean {
  return segment.kind === "tunnel";
}

// The two long side walls of a tunnel segment, in XZ. Open ends let sound pass;
// crossing a side wall is what muffles it.
export function tunnelSideWalls(segment: WalkableSegment): Array<[[number, number], [number, number]]> {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const hw = segment.width / 2;
  return [
    [[segment.start[0] + nx * hw, segment.start[1] + nz * hw], [segment.end[0] + nx * hw, segment.end[1] + nz * hw]],
    [[segment.start[0] - nx * hw, segment.start[1] - nz * hw], [segment.end[0] - nx * hw, segment.end[1] - nz * hw]],
  ];
}

export function tunnelObstructionCount(map: Pick<CompositionMap, "segments">, from: [number, number], to: [number, number]): number {
  let amount = 0;
  for (const segment of map.segments) {
    if (!isTunnelSegment(segment)) continue;
    for (const [a, b] of tunnelSideWalls(segment)) {
      if (lineSegmentsIntersect(from, to, a, b)) amount += wallOcclusionStrength(segment.wallThickness);
    }
  }
  return amount;
}

// When a tunnel meets a room (its endpoint coincides with the room's
// attachment point), the tunnel takes the room's height so their ceilings line
// up. Otherwise it uses the given fallback height.
export function tunnelHeight(map: Pick<CompositionMap, "segments" | "rooms">, segment: WalkableSegment, fallback: number): number {
  const startKey = mapPointKey(segment.start);
  const endKey = mapPointKey(segment.end);
  for (const room of map.rooms) {
    const point = roomAttachmentPoint(map, room);
    if (!point) continue;
    const key = mapPointKey(point);
    if (key === startKey || key === endKey) return room.height;
  }
  return fallback;
}

// Free-standing walls between listener and stem each muffle the sound.
export function wallObstructionCount(map: Pick<CompositionMap, "walls">, from: [number, number], to: [number, number]): number {
  let amount = 0;
  for (const wall of map.walls) {
    if (lineSegmentsIntersect(from, to, wall.start, wall.end)) amount += wallOcclusionStrength(wall.wallThickness);
  }
  return amount;
}

// --- Platform geometry ---

// Local-space outline of a rect/hex platform (circles are tested analytically).
// Hex vertices match `circleGeometry(radius, 6)` so the mesh and the walkable
// area agree.
export function platformLocalPolygon(platform: MapPlatform): Array<[number, number]> {
  if (platform.shape === "rect") {
    const hw = platform.width / 2;
    const hd = platform.depth / 2;
    return [
      [hw, hd],
      [-hw, hd],
      [-hw, -hd],
      [hw, -hd],
    ];
  }
  const r = platform.width / 2;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

export function platformContains(platform: MapPlatform, point: [number, number]): boolean {
  const local = toPlatformLocal(platform, point);
  if (platform.shape === "circle") {
    const r = platform.width / 2;
    return local[0] * local[0] + local[1] * local[1] <= r * r;
  }
  return pointInPolygon(local, platformLocalPolygon(platform));
}

function toPlatformLocal(platform: MapPlatform, point: [number, number]): [number, number] {
  return toLocalXZ(platform.center, platform.rotation, point);
}

function fromPlatformLocal(platform: MapPlatform, point: [number, number]): [number, number] {
  return fromLocalXZ(platform.center, platform.rotation, point);
}

export function containingPlatform(map: Pick<CompositionMap, "platforms">, point: [number, number]): MapPlatform | null {
  return map.platforms.find((platform) => platformContains(platform, point)) ?? null;
}

export function platformAttachmentPoint(map: Pick<CompositionMap, "segments">, platform: MapPlatform): [number, number] | null {
  if (!platform.attachment) return null;
  const segment = map.segments.find((s) => s.id === platform.attachment?.segmentId);
  if (!segment) return null;
  return platform.attachment.end === "start" ? segment.start : segment.end;
}

export function platformAttachedToPoint(map: Pick<CompositionMap, "segments" | "platforms">, key: string): MapPlatform | null {
  return map.platforms.find((platform) => {
    const point = platformAttachmentPoint(map, platform);
    return point ? mapPointKey(point) === key : false;
  }) ?? null;
}

// An attached platform inherits its branch point's height; a free platform uses
// its stored elevation.
export function platformElevation(map: Pick<CompositionMap, "segments" | "elevations">, platform: MapPlatform): number {
  if (platform.attachment) {
    const point = platformAttachmentPoint(map, platform);
    if (point) return pointElevation(map, mapPointKey(point));
  }
  return Number.isFinite(platform.elevation) ? platform.elevation : 0;
}

function closestPointInPlatform(platform: MapPlatform, point: [number, number]): [number, number] {
  const local = toLocalXZ(platform.center, platform.rotation, point);
  let clamped: [number, number];
  if (platform.shape === "circle") {
    const r = platform.width / 2;
    const d = Math.hypot(local[0], local[1]);
    clamped = d <= r || d === 0 ? local : [(local[0] / d) * r, (local[1] / d) * r];
  } else {
    clamped = closestPointInPolygon(local, platformLocalPolygon(platform));
  }
  return fromLocalXZ(platform.center, platform.rotation, clamped);
}

export function mapPointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

// --- Elevation (the vertical dimension) ---

export function pointElevation(map: Pick<CompositionMap, "elevations">, key: string): number {
  const value = map.elevations?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function segmentEndElevation(map: Pick<CompositionMap, "elevations">, segment: WalkableSegment, end: SegmentEnd): number {
  return pointElevation(map, mapPointKey(end === "start" ? segment.start : segment.end));
}

export function roomElevation(map: Pick<CompositionMap, "segments" | "elevations">, room: MapRoom): number {
  if (Number.isFinite(room.elevation)) return room.elevation!;
  const point = roomAttachmentPoint(map, room);
  return point ? pointElevation(map, mapPointKey(point)) : 0;
}

// The walkable surface height at an XZ point — the single source of truth shared
// by the floor mesh and the player. Rooms are flat at their attachment height;
// on a path the height ramps along the nearest segment's length.
export function surfaceHeightAt(map: Pick<CompositionMap, "segments" | "rooms" | "platforms" | "elevations">, point: [number, number]): number {
  const room = containingRoom(map, point);
  if (room) return roomElevation(map, room);
  const platform = containingPlatform(map, point);
  if (platform) return platformElevation(map, platform);
  let best = 0;
  let bestDistSq = Infinity;
  for (const segment of map.segments) {
    const { t, px, pz } = centerlineProjection(point, segment);
    const dx = point[0] - px;
    const dz = point[1] - pz;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      const startElev = pointElevation(map, mapPointKey(segment.start));
      const endElev = pointElevation(map, mapPointKey(segment.end));
      best = startElev + (endElev - startElev) * t;
    }
  }
  return best;
}

export function surfaceHeightOnSupport(
  map: Pick<CompositionMap, "segments" | "rooms" | "platforms" | "elevations">,
  point: [number, number],
  support?: MapSupport | null,
): number {
  if (support?.kind === "room") {
    const room = map.rooms.find((r) => r.id === support.roomId);
    if (room) return roomElevation(map, room);
  }
  if (support?.kind === "platform") {
    const platform = map.platforms.find((p) => p.id === support.platformId);
    if (platform) return platformElevation(map, platform);
  }
  if (support?.kind === "segment") {
    const segment = map.segments.find((s) => s.id === support.segmentId);
    if (segment) return segmentHeightAt(map, segment, point);
  }
  return surfaceHeightAt(map, point);
}

export function endpointCount(map: Pick<CompositionMap, "segments">, key: string): number {
  return map.segments.reduce((count, segment) => count + (mapPointKey(segment.start) === key ? 1 : 0) + (mapPointKey(segment.end) === key ? 1 : 0), 0);
}

export function isTerminalMapPoint(map: Pick<CompositionMap, "segments">, key: string): boolean {
  return endpointCount(map, key) === 1;
}

export function roomAttachedToPoint(map: Pick<CompositionMap, "segments" | "rooms">, key: string): MapRoom | null {
  return map.rooms.find((room) => {
    const point = roomAttachmentPoint(map, room);
    return point ? mapPointKey(point) === key : false;
  }) ?? null;
}

// A terminal point can host at most one attached structure (a room or platform).
export function pointHasAttachment(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">, key: string): boolean {
  return !!roomAttachedToPoint(map, key) || !!platformAttachedToPoint(map, key);
}

export function canAddRoomAtPoint(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">, key: string): boolean {
  return isTerminalMapPoint(map, key) && !pointHasAttachment(map, key);
}

export function canAddPlatformAtPoint(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">, key: string): boolean {
  return isTerminalMapPoint(map, key) && !pointHasAttachment(map, key);
}

export function canAddBranchAtPoint(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">, key: string): boolean {
  return endpointCount(map, key) > 0 && !pointHasAttachment(map, key);
}

export function canSetLoopEndpoint(map: Pick<CompositionMap, "segments" | "rooms" | "platforms">, key: string): boolean {
  return isTerminalMapPoint(map, key) && !pointHasAttachment(map, key);
}

export function roomAttachmentPoint(map: Pick<CompositionMap, "segments">, room: MapRoom): [number, number] | null {
  if (!room.attachment) return null;
  const segment = map.segments.find((s) => s.id === room.attachment?.segmentId);
  if (!segment) return null;
  return room.attachment.end === "start" ? segment.start : segment.end;
}

export function attachmentForPoint(map: Pick<CompositionMap, "segments">, key: string): RoomAttachment | null {
  for (const segment of map.segments) {
    if (mapPointKey(segment.start) === key) return { segmentId: segment.id, end: "start" };
    if (mapPointKey(segment.end) === key) return { segmentId: segment.id, end: "end" };
  }
  return null;
}

export function endpointPoint(map: Pick<CompositionMap, "segments">, endpoint: RoomAttachment): [number, number] | null {
  const segment = map.segments.find((s) => s.id === endpoint.segmentId);
  if (!segment) return null;
  return endpoint.end === "start" ? segment.start : segment.end;
}

export function endpointKey(map: Pick<CompositionMap, "segments">, endpoint: RoomAttachment | undefined): string | null {
  if (!endpoint) return null;
  const point = endpointPoint(map, endpoint);
  return point ? mapPointKey(point) : null;
}

export function pathLoopForMap(map: Pick<CompositionMap, "tiling">): CompositionMap["loop"] {
  return map.tiling.type === "path-loop" ? map.tiling.pathLoop : undefined;
}

export function loopRoleForPoint(map: Pick<CompositionMap, "segments" | "tiling">, key: string): "start" | "end" | null {
  const loop = pathLoopForMap(map);
  if (endpointKey(map, loop?.start) === key) return "start";
  if (endpointKey(map, loop?.end) === key) return "end";
  return null;
}

export function wrapLoopPosition(
  map: Pick<CompositionMap, "segments" | "tiling">,
  previous: [number, number],
  attempted: [number, number],
): { position: [number, number]; yawDelta: number } | null {
  const loop = pathLoopForMap(map);
  if (!loop?.start || !loop.end) return null;
  return wrapFromEndpoint(map, loop.end, loop.start, previous, attempted) ?? wrapFromEndpoint(map, loop.start, loop.end, previous, attempted);
}

export interface LoopPreviewTransform {
  id: string;
  anchor: [number, number];
  source: [number, number];
  rotation: number;
}

const MAX_TILE_PREVIEW_RANGE = 3;

export function loopPreviewTransforms(
  map: Pick<CompositionMap, "segments" | "tiling">,
  viewer: [number, number],
  radius = 34,
): LoopPreviewTransform[] {
  const loop = pathLoopForMap(map);
  if (!loop?.start || !loop.end) return [];
  const endPreview = loopPreviewTransform(map, loop.end, loop.start, viewer, radius, "end");
  const startPreview = loopPreviewTransform(map, loop.start, loop.end, viewer, radius, "start");
  return [endPreview, startPreview].filter((preview): preview is LoopPreviewTransform => !!preview);
}

export function loopAdjacentTransforms(map: Pick<CompositionMap, "segments" | "tiling">): LoopPreviewTransform[] {
  return loopPreviewTransforms(map, [0, 0], Infinity);
}

export function tiledMapTransforms(
  map: Pick<CompositionMap, "segments" | "tiling">,
  viewer: [number, number],
  radius = 120,
): LoopPreviewTransform[] {
  if (map.tiling.type === "path-loop") return loopAdjacentTransforms(map);
  if (map.tiling.type === "square") return squareTileTransforms(map.tiling, viewer, radius);
  if (map.tiling.type === "hex") return hexTileTransforms(map.tiling, viewer, radius);
  return [];
}

export function transformLoopPoint(preview: LoopPreviewTransform, point: [number, number]): [number, number] {
  const dx = point[0] - preview.source[0];
  const dz = point[1] - preview.source[1];
  const c = Math.cos(preview.rotation);
  const s = Math.sin(preview.rotation);
  return [preview.anchor[0] + dx * c + dz * s, preview.anchor[1] - dx * s + dz * c];
}

// How far to raise/lower a loop preview copy so its source endpoint aligns with
// the anchor endpoint it sits against. Non-loop tilings (square/hex) stay flat.
export function loopPreviewElevationOffset(map: Pick<CompositionMap, "elevations" | "tiling">, preview: LoopPreviewTransform): number {
  if (map.tiling.type !== "path-loop") return 0;
  return pointElevation(map, mapPointKey(preview.anchor)) - pointElevation(map, mapPointKey(preview.source));
}

export function pointInOriginalTile(map: Pick<CompositionMap, "tiling">, point: [number, number]): [number, number] {
  if (map.tiling.type === "square") {
    const size = Math.max(1, map.tiling.tileSize);
    const [ox, oz] = map.tiling.origin;
    const ix = Math.round((point[0] - ox) / size);
    const iz = Math.round((point[1] - oz) / size);
    return [point[0] - ix * size, point[1] - iz * size];
  }

  if (map.tiling.type === "hex") {
    const size = Math.max(1, map.tiling.tileSize);
    const [ox, oz] = map.tiling.origin;
    const stepX = size;
    const stepZ = (Math.sqrt(3) / 2) * size;
    const r = Math.round((point[1] - oz) / stepZ);
    const q = Math.round((point[0] - ox) / stepX - r * 0.5);
    return [point[0] - (q + r * 0.5) * stepX, point[1] - r * stepZ];
  }

  return point;
}

function squareTileTransforms(tiling: MapTiling, viewer: [number, number], radius: number): LoopPreviewTransform[] {
  const size = Math.max(1, tiling.tileSize);
  const [ox, oz] = tiling.origin;
  const cx = Math.round((viewer[0] - ox) / size);
  const cz = Math.round((viewer[1] - oz) / size);
  const range = Math.min(MAX_TILE_PREVIEW_RANGE, Math.max(1, Math.ceil(radius / size) + 1));
  const transforms: LoopPreviewTransform[] = [];
  for (let ix = cx - range; ix <= cx + range; ix++) {
    for (let iz = cz - range; iz <= cz + range; iz++) {
      if (ix === 0 && iz === 0) continue;
      const dx = ix * size;
      const dz = iz * size;
      if (Math.hypot(viewer[0] - (ox + dx), viewer[1] - (oz + dz)) > radius + size * 1.5) continue;
      transforms.push({ id: `square:${ix}:${iz}`, anchor: [dx, dz], source: [0, 0], rotation: 0 });
    }
  }
  return transforms;
}

function hexTileTransforms(tiling: MapTiling, viewer: [number, number], radius: number): LoopPreviewTransform[] {
  const size = Math.max(1, tiling.tileSize);
  const [ox, oz] = tiling.origin;
  const stepX = size;
  const stepZ = (Math.sqrt(3) / 2) * size;
  const approxR = Math.round((viewer[1] - oz) / stepZ);
  const approxQ = Math.round((viewer[0] - ox) / stepX - approxR * 0.5);
  const range = Math.min(MAX_TILE_PREVIEW_RANGE, Math.max(1, Math.ceil(radius / Math.min(stepX, stepZ)) + 1));
  const transforms: LoopPreviewTransform[] = [];
  for (let q = approxQ - range; q <= approxQ + range; q++) {
    for (let r = approxR - range; r <= approxR + range; r++) {
      if (q === 0 && r === 0) continue;
      const dx = (q + r * 0.5) * stepX;
      const dz = r * stepZ;
      if (Math.hypot(viewer[0] - (ox + dx), viewer[1] - (oz + dz)) > radius + size * 1.5) continue;
      transforms.push({ id: `hex:${q}:${r}`, anchor: [dx, dz], source: [0, 0], rotation: 0 });
    }
  }
  return transforms;
}

export function inverseTransformLoopPoint(preview: LoopPreviewTransform, point: [number, number]): [number, number] {
  const dx = point[0] - preview.anchor[0];
  const dz = point[1] - preview.anchor[1];
  const c = Math.cos(preview.rotation);
  const s = Math.sin(preview.rotation);
  return [preview.source[0] + dx * c - dz * s, preview.source[1] + dx * s + dz * c];
}

export function alignAttachedRooms(map: CompositionMap): CompositionMap {
  return {
    ...map,
    rooms: map.rooms.map((room) => {
      if (!room.attachment) return room;
      const placed = attachedRoomPlacement(map, room);
      if (!placed) return room;
      // The attachment doorway is the first entrance, locked facing the path
      // (north, centered). Any additional entrances the composer added on other
      // walls are preserved as-is.
      const [primary, ...rest] = room.entrances;
      const lockedPrimary: RoomEntrance = { side: "north", width: primary?.width ?? 5, offset: 0, ...(primary?.door ? { door: primary.door } : {}) };
      return { ...room, ...placed, entrances: [lockedPrimary, ...rest] };
    }),
    platforms: map.platforms.map((platform) => {
      if (!platform.attachment) return platform;
      const placed = attachedPlatformPlacement(map, platform);
      return placed ? { ...platform, ...placed } : platform;
    }),
  };
}

// An attached platform sits just past its branch point, its near edge meeting
// the path, oriented to face it.
function attachedPlatformPlacement(map: Pick<CompositionMap, "segments">, platform: MapPlatform): Pick<MapPlatform, "center" | "rotation"> | null {
  if (!platform.attachment) return null;
  const segment = map.segments.find((s) => s.id === platform.attachment?.segmentId);
  if (!segment) return null;
  const point = platform.attachment.end === "start" ? segment.start : segment.end;
  const other = platform.attachment.end === "start" ? segment.end : segment.start;
  const out = normalizeDirection([point[0] - other[0], point[1] - other[1]]);
  const extent = platform.shape === "rect" ? platform.depth / 2 : platform.width / 2;
  const center: [number, number] = [point[0] + out[0] * extent, point[1] + out[1] * extent];
  return { center, rotation: Math.atan2(out[0], out[1]) };
}

function normalizeMapLoop(map: CompositionMap): CompositionMap["loop"] {
  const loop = map.loop;
  if (!loop) return undefined;
  const startKey = endpointKey(map, loop.start);
  const endKey = endpointKey(map, loop.end);
  const start = startKey && startKey !== endKey && canSetLoopEndpoint(map, startKey) ? loop.start : undefined;
  const end = endKey && startKey !== endKey && canSetLoopEndpoint(map, endKey) ? loop.end : undefined;
  return start || end ? { start, end } : undefined;
}

function normalizeMapTiling(value: unknown, legacyLoop: CompositionMap["loop"], fallback = defaultTiling): MapTiling {
  const tiling = value as Partial<MapTiling> | undefined;
  const type = isMapTilingType(tiling?.type) ? tiling.type : legacyLoop ? "path-loop" : fallback.type;
  const origin = isPoint(tiling?.origin) ? tiling.origin : fallback.origin;
  const tileSize = clamp(typeof tiling?.tileSize === "number" && Number.isFinite(tiling.tileSize) ? tiling.tileSize : fallback.tileSize, 5, 1000);
  const pathLoop = isMapLoop(tiling?.pathLoop) ? tiling.pathLoop : legacyLoop;
  return {
    type,
    origin,
    tileSize,
    pathLoop: type === "path-loop" ? pathLoop : undefined,
  };
}

function wrapFromEndpoint(
  map: Pick<CompositionMap, "segments">,
  from: RoomAttachment,
  to: RoomAttachment,
  previous: [number, number],
  attempted: [number, number],
): { position: [number, number]; yawDelta: number } | null {
  const fromArm = endpointArm(map, from);
  const toArm = endpointArm(map, to);
  if (!fromArm || !toArm) return null;
  const [fx, fz] = fromArm.point;
  const movementPastEndpoint = (attempted[0] - fx) * fromArm.out[0] + (attempted[1] - fz) * fromArm.out[1];
  if (movementPastEndpoint <= 0) return null;
  const wasNearEndpoint = Math.hypot(previous[0] - fx, previous[1] - fz) <= fromArm.width * 0.8 + 0.8;
  if (!wasNearEndpoint) return null;
  const lateral = (attempted[0] - fx) * fromArm.right[0] + (attempted[1] - fz) * fromArm.right[1];
  if (Math.abs(lateral) > fromArm.width * 0.55 + 0.8) return null;

  const fromAngle = Math.atan2(fromArm.out[0], fromArm.out[1]);
  const toAngle = Math.atan2(-toArm.out[0], -toArm.out[1]);
  const position = inverseTransformLoopPoint({ id: "end", anchor: fromArm.point, source: toArm.point, rotation: fromAngle - toAngle }, attempted);
  return { position, yawDelta: toAngle - fromAngle };
}

function loopPreviewTransform(
  map: Pick<CompositionMap, "segments">,
  from: RoomAttachment,
  to: RoomAttachment,
  viewer: [number, number],
  radius: number,
  id: "start" | "end",
): LoopPreviewTransform | null {
  const fromArm = endpointArm(map, from);
  const toArm = endpointArm(map, to);
  if (!fromArm || !toArm) return null;
  const distance = Math.hypot(viewer[0] - fromArm.point[0], viewer[1] - fromArm.point[1]);
  if (distance > radius) return null;
  const fromAngle = Math.atan2(fromArm.out[0], fromArm.out[1]);
  const toAngle = Math.atan2(-toArm.out[0], -toArm.out[1]);
  return {
    id,
    anchor: fromArm.point,
    source: toArm.point,
    rotation: fromAngle - toAngle,
  };
}

function endpointArm(map: Pick<CompositionMap, "segments">, endpoint: RoomAttachment): { point: [number, number]; out: [number, number]; right: [number, number]; width: number } | null {
  const segment = map.segments.find((s) => s.id === endpoint.segmentId);
  if (!segment) return null;
  const point = endpoint.end === "start" ? segment.start : segment.end;
  const other = endpoint.end === "start" ? segment.end : segment.start;
  const out = normalizeDirection([point[0] - other[0], point[1] - other[1]]);
  return { point, out, right: [out[1], -out[0]], width: segment.width };
}

function supportExists(map: CompositionMap, support: MapSupport): boolean {
  if (support.kind === "open") return !hasWalkableBounds(map);
  if (support.kind === "room") return map.rooms.some((room) => room.id === support.roomId);
  if (support.kind === "platform") return map.platforms.some((platform) => platform.id === support.platformId);
  return map.segments.some((segment) => segment.id === support.segmentId);
}

function supportContains(map: CompositionMap, support: MapSupport, point: [number, number]): boolean {
  if (support.kind === "open") return true;
  if (support.kind === "room") {
    const room = map.rooms.find((r) => r.id === support.roomId);
    return room ? roomContains(room, point) : false;
  }
  if (support.kind === "platform") {
    const platform = map.platforms.find((p) => p.id === support.platformId);
    return platform ? platformContains(platform, point) : false;
  }
  const segment = map.segments.find((s) => s.id === support.segmentId);
  return segment ? pointInSegment(point, segment) : false;
}

function supportContainsForMovement(map: CompositionMap, support: MapSupport, point: [number, number], listener: [number, number]): boolean {
  if (support.kind !== "room") return supportContains(map, support, point);
  const room = map.rooms.find((r) => r.id === support.roomId);
  return room ? movementRoomContains(room, point, listener) : false;
}

function transitionSupport(map: CompositionMap, support: MapSupport, previous: [number, number], attempted: [number, number]): MapStep | null {
  if (support.kind === "open") return { position: attempted, support };

  // Platforms are open hubs: step onto any platform whose area you enter (from
  // any support), and off a platform onto any segment/room you enter.
  for (const platform of map.platforms) {
    if (support.kind === "platform" && support.platformId === platform.id) continue;
    if (platformContains(platform, attempted)) return { position: attempted, support: { kind: "platform", platformId: platform.id } };
  }
  if (support.kind === "platform") {
    const segment = nearestSegmentContaining(map, attempted);
    if (segment) return { position: attempted, support: { kind: "segment", segmentId: segment.id } };
    const room = map.rooms.find((r) => movementRoomContains(r, attempted, previous));
    if (room) return { position: attempted, support: { kind: "room", roomId: room.id } };
    return null;
  }

  if (support.kind === "room") {
    const room = map.rooms.find((r) => r.id === support.roomId);
    if (!room) return null;
    for (const other of map.rooms) {
      if (other.id === room.id || !movementRoomContains(other, attempted, previous)) continue;
      if (roomsConnectThroughDoorways(room, other)) return { position: attempted, support: { kind: "room", roomId: other.id } };
    }
    // Step out through any doorway onto a segment that reaches into it.
    for (const segment of map.segments) {
      if (pointInSegment(attempted, segment) && segmentTouchesRoomDoorway(room, segment)) {
        return { position: attempted, support: { kind: "segment", segmentId: segment.id } };
      }
    }
    return null;
  }

  const segment = map.segments.find((s) => s.id === support.segmentId);
  if (!segment) return null;
  // Step into any room whose doorway this segment reaches.
  for (const room of map.rooms) {
    if (movementRoomContains(room, attempted, previous) && segmentTouchesRoomDoorway(room, segment)) {
      return { position: attempted, support: { kind: "room", roomId: room.id } };
    }
  }

  for (const candidate of map.segments) {
    if (candidate.id === segment.id || !pointInSegment(attempted, candidate)) continue;
    if (segmentsShareEndpoint(segment, candidate) && nearSharedEndpoint(segment, candidate, previous, attempted)) {
      return { position: attempted, support: { kind: "segment", segmentId: candidate.id } };
    }
  }
  return null;
}

function clampToSupport(map: CompositionMap, support: MapSupport, point: [number, number], listener: [number, number] = point): [number, number] | null {
  if (support.kind === "open") return point;
  if (support.kind === "room") {
    const room = map.rooms.find((r) => r.id === support.roomId);
    if (!room) return null;
    let best: [number, number] = point;
    let bestDistanceSq = Infinity;
    for (const rect of movementRoomRegionRects(room, listener)) {
      const candidate = fromRoomLocal(room, closestInRect(toRoomLocal(room, point), rect));
      const dx = point[0] - candidate[0];
      const dz = point[1] - candidate[1];
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        best = candidate;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }
  if (support.kind === "platform") {
    const platform = map.platforms.find((p) => p.id === support.platformId);
    return platform ? closestPointInPlatform(platform, point) : null;
  }
  const segment = map.segments.find((s) => s.id === support.segmentId);
  return segment ? closestPointInSegment(point, segment) : null;
}

function stepHitsRoomWall(map: CompositionMap, previous: [number, number], attempted: [number, number]): boolean {
  for (const room of map.rooms) {
    const from = toRoomLocal(room, previous);
    const to = toRoomLocal(room, attempted);
    if (lineHitsMovementRoomWall(room, from, to, previous)) return true;
  }
  return false;
}

function nearestSegmentContaining(map: CompositionMap, point: [number, number]): WalkableSegment | null {
  const containing = map.segments.filter((segment) => pointInSegment(point, segment));
  return nearestSegment(containing, point);
}

function nearestSegment(segments: WalkableSegment[], point: [number, number]): WalkableSegment | null {
  let best: WalkableSegment | null = null;
  let bestDistSq = Infinity;
  for (const segment of segments) {
    const { px, pz } = centerlineProjection(point, segment);
    const dx = point[0] - px;
    const dz = point[1] - pz;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      best = segment;
      bestDistSq = distSq;
    }
  }
  return best;
}

function segmentsShareEndpoint(a: WalkableSegment, b: WalkableSegment): boolean {
  return sharedEndpoint(a, b) !== null;
}

function nearSharedEndpoint(a: WalkableSegment, b: WalkableSegment, previous: [number, number], attempted: [number, number]): boolean {
  const point = sharedEndpoint(a, b);
  if (!point) return false;
  const threshold = Math.max(a.width, b.width) * 0.65 + 0.8;
  return Math.hypot(previous[0] - point[0], previous[1] - point[1]) <= threshold || Math.hypot(attempted[0] - point[0], attempted[1] - point[1]) <= threshold;
}

function sharedEndpoint(a: WalkableSegment, b: WalkableSegment): [number, number] | null {
  const aStart = mapPointKey(a.start);
  const aEnd = mapPointKey(a.end);
  if (aStart === mapPointKey(b.start) || aStart === mapPointKey(b.end)) return a.start;
  if (aEnd === mapPointKey(b.start) || aEnd === mapPointKey(b.end)) return a.end;
  return null;
}

// A segment is connected to a room through a doorway when its walkable
// footprint overlaps that doorway's threshold. Checking the footprint rather
// than exact endpoint containment keeps angled approaches and wall-line
// endpoints traversable.
export function segmentTouchesRoomDoorway(room: MapRoom, segment: WalkableSegment): boolean {
  const startLocal = toRoomLocal(room, segment.start);
  const endLocal = toRoomLocal(room, segment.end);
  return room.entrances.some((entrance) => {
    const rect = doorwayRect(room, entrance);
    return segmentFootprintIntersectsRect(startLocal, endLocal, segment.width, rect);
  });
}

export function segmentEndTouchesRoomDoorway(room: MapRoom, segment: WalkableSegment, end: SegmentEnd): boolean {
  const point = end === "start" ? segment.start : segment.end;
  const local = toRoomLocal(room, point);
  return room.entrances.some((entrance) => pointInRect(local, doorwayRect(room, entrance)));
}

function roomsConnectThroughDoorways(a: MapRoom, b: MapRoom): boolean {
  return a.entrances.some((entrance) => roomContains(b, entranceOuterPoint(a, entrance))) || b.entrances.some((entrance) => roomContains(a, entranceOuterPoint(b, entrance)));
}

function segmentHeightAt(map: Pick<CompositionMap, "elevations">, segment: WalkableSegment, point: [number, number]): number {
  const { t } = centerlineProjection(point, segment);
  const startElev = pointElevation(map, mapPointKey(segment.start));
  const endElev = pointElevation(map, mapPointKey(segment.end));
  return startElev + (endElev - startElev) * t;
}

function attachedRoomPlacement(map: Pick<CompositionMap, "segments">, room: MapRoom): Pick<MapRoom, "center" | "rotation"> | null {
  if (!room.attachment) return null;
  const segment = map.segments.find((s) => s.id === room.attachment?.segmentId);
  if (!segment) return null;
  const point = room.attachment.end === "start" ? segment.start : segment.end;
  const other = room.attachment.end === "start" ? segment.end : segment.start;
  const out = normalizeDirection([point[0] - other[0], point[1] - other[1]]);
  const rotation = Math.atan2(out[0], out[1]);
  const center: [number, number] = [point[0] + out[0] * (room.depth / 2), point[1] + out[1] * (room.depth / 2)];
  return { center, rotation };
}

function toLocalXZ(center: [number, number], rotation: number, point: [number, number]): [number, number] {
  const dx = point[0] - center[0];
  const dz = point[1] - center[1];
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [dx * c - dz * s, dx * s + dz * c];
}

function fromLocalXZ(center: [number, number], rotation: number, point: [number, number]): [number, number] {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [center[0] + point[0] * c + point[1] * s, center[1] - point[0] * s + point[1] * c];
}

function toRoomLocal(room: MapRoom, point: [number, number]): [number, number] {
  return toLocalXZ(room.center, room.rotation, point);
}

function fromRoomLocal(room: MapRoom, point: [number, number]): [number, number] {
  return fromLocalXZ(room.center, room.rotation, point);
}

// Even-odd ray cast; works for any simple polygon.
function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function closestPointInPolygon(point: [number, number], polygon: Array<[number, number]>): [number, number] {
  if (pointInPolygon(point, polygon)) return point;
  let best: [number, number] = point;
  let bestDistSq = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const candidate = closestPointOnSegment(point, polygon[j], polygon[i]);
    const dx = point[0] - candidate[0];
    const dz = point[1] - candidate[1];
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      best = candidate;
      bestDistSq = distSq;
    }
  }
  return best;
}

function closestPointOnSegment(point: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lenSq, 0, 1);
  return [a[0] + dx * t, a[1] + dz * t];
}

// `from`/`to` are in room-local coords; `listener` is the world-space listener
// used to decide which doors are currently open (and therefore not solid).
function lineHitsSolidRoomWall(room: MapRoom, from: [number, number], to: [number, number], listener: [number, number]): boolean {
  const r = interiorRect(room);
  const walls: Array<[[number, number], [number, number]]> = [];
  for (const [s, e] of solidWallSpans(r.maxX, openWallOpenings(room, "north", listener))) walls.push([[s, r.minZ], [e, r.minZ]]);
  for (const [s, e] of solidWallSpans(r.maxX, openWallOpenings(room, "south", listener))) walls.push([[s, r.maxZ], [e, r.maxZ]]);
  for (const [s, e] of solidWallSpans(r.maxZ, openWallOpenings(room, "west", listener))) walls.push([[r.minX, s], [r.minX, e]]);
  for (const [s, e] of solidWallSpans(r.maxZ, openWallOpenings(room, "east", listener))) walls.push([[r.maxX, s], [r.maxX, e]]);
  return walls.some(([a, b]) => lineSegmentsIntersect(from, to, a, b));
}

function lineHitsMovementRoomWall(room: MapRoom, from: [number, number], to: [number, number], listener: [number, number]): boolean {
  const r = interiorRect(room);
  const walls: Rect[] = [];
  for (const [s, e] of solidWallSpans(r.maxX, movementWallOpenings(room, "north", listener))) walls.push(horizontalWallRect(s, e, r.maxX, r.minZ, room));
  for (const [s, e] of solidWallSpans(r.maxX, movementWallOpenings(room, "south", listener))) walls.push(horizontalWallRect(s, e, r.maxX, r.maxZ, room));
  for (const [s, e] of solidWallSpans(r.maxZ, movementWallOpenings(room, "west", listener))) walls.push(verticalWallRect(s, e, r.maxZ, r.minX, room));
  for (const [s, e] of solidWallSpans(r.maxZ, movementWallOpenings(room, "east", listener))) walls.push(verticalWallRect(s, e, r.maxZ, r.maxX, room));
  return walls.some((rect) => lineIntersectsRectInclusive(from, to, rect));
}

function movementWallOpenings(room: MapRoom, side: RoomSide, listener: [number, number]): Array<[number, number]> {
  return openWallOpenings(room, side, listener)
    .map(([a, b]) => [a + PLAYER_COLLISION_RADIUS, b - PLAYER_COLLISION_RADIUS] as [number, number])
    .filter(([a, b]) => a < b);
}

function horizontalWallRect(start: number, end: number, half: number, z: number, room: MapRoom): Rect {
  const thickness = wallThickness(room.wallThickness) / 2 + PLAYER_COLLISION_RADIUS;
  const minX = start - PLAYER_COLLISION_RADIUS - (touchesWallEdge(start, -half) ? thickness : 0);
  const maxX = end + PLAYER_COLLISION_RADIUS + (touchesWallEdge(end, half) ? thickness : 0);
  return { minX, maxX, minZ: z - thickness, maxZ: z + thickness };
}

function verticalWallRect(start: number, end: number, half: number, x: number, room: MapRoom): Rect {
  const thickness = wallThickness(room.wallThickness) / 2 + PLAYER_COLLISION_RADIUS;
  const minZ = start - PLAYER_COLLISION_RADIUS - (touchesWallEdge(start, -half) ? thickness : 0);
  const maxZ = end + PLAYER_COLLISION_RADIUS + (touchesWallEdge(end, half) ? thickness : 0);
  return { minX: x - thickness, maxX: x + thickness, minZ, maxZ };
}

function touchesWallEdge(value: number, edge: number): boolean {
  return Math.abs(value - edge) < 0.001;
}

function lineSegmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const acx = c[0] - a[0];
  const acz = c[1] - a[1];
  const cdx = d[0] - c[0];
  const cdz = d[1] - c[1];
  const denom = cross(abx, abz, cdx, cdz);
  if (Math.abs(denom) < 0.000001) return false;
  const t = cross(acx, acz, cdx, cdz) / denom;
  const u = cross(acx, acz, abx, abz) / denom;
  return t > 0.0001 && t < 0.9999 && u > 0.0001 && u < 0.9999;
}

function lineSegmentsIntersectInclusive(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const acx = c[0] - a[0];
  const acz = c[1] - a[1];
  const cdx = d[0] - c[0];
  const cdz = d[1] - c[1];
  const denom = cross(abx, abz, cdx, cdz);
  if (Math.abs(denom) < 0.000001) return false;
  const t = cross(acx, acz, cdx, cdz) / denom;
  const u = cross(acx, acz, abx, abz) / denom;
  return t >= -0.0001 && t <= 1.0001 && u >= -0.0001 && u <= 1.0001;
}

function lineIntersectsRectInclusive(a: [number, number], b: [number, number], r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const corners: [number, number][] = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  const edges: Array<[[number, number], [number, number]]> = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  return edges.some(([c, d]) => lineSegmentsIntersectInclusive(a, b, c, d));
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function pointInRect(p: [number, number], r: Rect): boolean {
  return p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minZ && p[1] <= r.maxZ;
}

function segmentFootprintIntersectsRect(a: [number, number], b: [number, number], width: number, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const corners: [number, number][] = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  if (corners.some((corner) => pointInLocalSegment(corner, a, b, width))) return true;
  const edges: Array<[[number, number], [number, number]]> = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  return edges.some(([c, d]) => lineSegmentsIntersect(a, b, c, d));
}

function pointInLocalSegment(point: [number, number], a: [number, number], b: [number, number], width: number): boolean {
  const closest = closestPointOnSegment(point, a, b);
  const dx = point[0] - closest[0];
  const dz = point[1] - closest[1];
  const radius = width / 2;
  return dx * dx + dz * dz <= radius * radius;
}

function closestInRect(p: [number, number], r: Rect): [number, number] {
  return [clamp(p[0], r.minX, r.maxX), clamp(p[1], r.minZ, r.maxZ)];
}

function pointInSegment(point: [number, number], segment: WalkableSegment): boolean {
  const projected = centerlineProjection(point, segment);
  const radius = segment.width / 2;
  if (projected.t <= 0 || projected.t >= 1) {
    const ax = segment.start[0];
    const az = segment.start[1];
    const bx = segment.end[0];
    const bz = segment.end[1];
    const along = projected.t <= 0 ? (point[0] - ax) * (bx - ax) + (point[1] - az) * (bz - az) : (point[0] - bx) * (bx - ax) + (point[1] - bz) * (bz - az);
    if ((projected.t <= 0 && along < 0) || (projected.t >= 1 && along > 0)) return false;
  }
  const dx = point[0] - projected.px;
  const dz = point[1] - projected.pz;
  return dx * dx + dz * dz <= radius * radius;
}

function closestPointInSegment(point: [number, number], segment: WalkableSegment): [number, number] {
  const center = closestPointOnCenterline(point, segment);
  const radius = segment.width / 2;
  const ax = segment.start[0];
  const az = segment.start[1];
  const bx = segment.end[0];
  const bz = segment.end[1];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = -(bz - az) / len;
  const nz = (bx - ax) / len;
  const side = clamp((point[0] - center[0]) * nx + (point[1] - center[1]) * nz, -radius, radius);
  return [center[0] + nx * side, center[1] + nz * side];
}

function closestPointOnCenterline(point: [number, number], segment: WalkableSegment): [number, number] {
  const { px, pz } = centerlineProjection(point, segment);
  return [px, pz];
}

// Project an XZ point onto a segment's centerline, returning the clamped
// progress `t` (0 at start, 1 at end) and the projected point.
function centerlineProjection(point: [number, number], segment: WalkableSegment): { t: number; px: number; pz: number } {
  const ax = segment.start[0];
  const az = segment.start[1];
  const bx = segment.end[0];
  const bz = segment.end[1];
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : clamp(((point[0] - ax) * dx + (point[1] - az) * dz) / lenSq, 0, 1);
  return { t, px: ax + dx * t, pz: az + dz * t };
}

function isMapPreset(value: unknown): value is MapPreset {
  return value === "open" || value === "line" || value === "y" || value === "custom";
}

function isWalkableSegment(value: unknown): value is WalkableSegment {
  const s = value as WalkableSegment;
  return (
    typeof s?.id === "string" &&
    isPoint(s.start) &&
    isPoint(s.end) &&
    typeof s.width === "number" &&
    Number.isFinite(s.width) &&
    s.width > 0
  );
}

function isMapRoom(value: unknown): value is RawMapRoom {
  const r = value as RawMapRoom;
  return (
    typeof r?.id === "string" &&
    isPoint(r.center) &&
    (r.rotation === undefined || (typeof r.rotation === "number" && Number.isFinite(r.rotation))) &&
    typeof r.width === "number" &&
    typeof r.depth === "number"
  );
}

function isMapPlatform(value: unknown): value is MapPlatform {
  const p = value as MapPlatform;
  return typeof p?.id === "string" && isPoint(p.center) && typeof p.width === "number" && Number.isFinite(p.width);
}

function isPlatformShape(value: unknown): value is PlatformShape {
  return value === "rect" || value === "hex" || value === "circle";
}

function isMapWall(value: unknown): value is MapWall {
  const w = value as MapWall;
  return typeof w?.id === "string" && isPoint(w.start) && isPoint(w.end);
}

function normalizeWall(wall: MapWall): MapWall {
  return {
    id: wall.id,
    start: wall.start,
    end: wall.end,
    height: clamp(Number.isFinite(wall.height) ? wall.height : 3, 0.5, 12),
    wallThickness: normalizeWallThickness(wall.wallThickness),
  };
}

function normalizePlatform(platform: MapPlatform): MapPlatform {
  const width = clamp(platform.width, 4, 200);
  return {
    id: platform.id,
    center: platform.center,
    rotation: Number.isFinite(platform.rotation) ? platform.rotation : 0,
    shape: isPlatformShape(platform.shape) ? platform.shape : "rect",
    width,
    depth: clamp(Number.isFinite(platform.depth) ? platform.depth : width, 4, 200),
    elevation: Number.isFinite(platform.elevation) ? platform.elevation : 0,
    attachment: isRoomAttachment(platform.attachment) ? platform.attachment : undefined,
  };
}

function isRoomEntrance(value: unknown): value is RoomEntrance {
  const e = value as RoomEntrance;
  return isRoomSide(e?.side) && typeof e.width === "number" && Number.isFinite(e.width) && typeof e.offset === "number" && Number.isFinite(e.offset);
}

function isRoomSide(value: unknown): value is RoomSide {
  return value === "north" || value === "south" || value === "east" || value === "west";
}

// Wall span available for a doorway on a given side (interior extent minus the
// two corner wall thicknesses).
function entranceSpan(side: RoomSide, width: number, depth: number, thickness = DEFAULT_WALL_THICKNESS): number {
  return (side === "north" || side === "south" ? width : depth) - normalizeWallThickness(thickness) * 2;
}

function normalizeEntrance(entrance: RoomEntrance, width: number, depth: number, thickness = DEFAULT_WALL_THICKNESS): RoomEntrance {
  const span = entranceSpan(entrance.side, width, depth, thickness);
  const entranceWidth = clamp(entrance.width, 1, Math.max(1, span));
  const maxOffset = Math.max(0, span / 2 - entranceWidth / 2);
  const normalized: RoomEntrance = { side: entrance.side, width: entranceWidth, offset: clamp(entrance.offset, -maxOffset, maxOffset) };
  if (isDoorConfig(entrance.door)) normalized.door = { openFrom: entrance.door.openFrom };
  return normalized;
}

function isDoorConfig(value: unknown): value is DoorConfig {
  const door = value as DoorConfig;
  return door?.openFrom === "both" || door?.openFrom === "inside" || door?.openFrom === "outside";
}

function normalizeRoom(room: RawMapRoom): MapRoom {
  const width = clamp(room.width, 3, 80);
  const depth = clamp(room.depth, 3, 80);
  const wallThickness = normalizeWallThickness(room.wallThickness);
  // Prefer the new entrances array; fall back to the legacy single-entrance
  // fields, then to a centered south doorway.
  const rawEntrances: RoomEntrance[] = Array.isArray(room.entrances) && room.entrances.some(isRoomEntrance)
    ? room.entrances.filter(isRoomEntrance)
    : [{ side: isRoomSide(room.entranceSide) ? room.entranceSide : "south", width: room.entranceWidth ?? 4, offset: room.entranceOffset ?? 0 }];
  return {
    id: room.id,
    center: room.center,
    rotation: Number.isFinite(room.rotation) ? (room.rotation as number) : 0,
    width,
    depth,
    height: clamp(room.height ?? 3.2, 2, 12),
    wallThickness,
    ...(Number.isFinite(room.elevation) ? { elevation: clamp(room.elevation!, -20, 40) } : {}),
    entrances: rawEntrances.map((entrance) => normalizeEntrance(entrance, width, depth, wallThickness)),
    attachment: isRoomAttachment(room.attachment) ? room.attachment : undefined,
  };
}

function normalizeWallThickness(value: unknown): number {
  return clamp(typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_WALL_THICKNESS, MIN_WALL_THICKNESS, MAX_WALL_THICKNESS);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function isRoomAttachment(value: unknown): value is RoomAttachment {
  const attachment = value as RoomAttachment;
  return typeof attachment?.segmentId === "string" && (attachment.end === "start" || attachment.end === "end");
}

function isMapLoop(value: unknown): value is NonNullable<CompositionMap["loop"]> {
  const loop = value as NonNullable<CompositionMap["loop"]>;
  return isRoomAttachment(loop?.start) || isRoomAttachment(loop?.end);
}

function isMapTilingType(value: unknown): value is MapTilingType {
  return value === "none" || value === "path-loop" || value === "square" || value === "hex";
}

function isPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function normalizeDirection(direction: [number, number]): [number, number] {
  const length = Math.hypot(direction[0], direction[1]);
  return length > 0 ? [direction[0] / length, direction[1] / length] : [0, -1];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
