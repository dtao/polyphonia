export type MapPreset = "open" | "line" | "y" | "custom";

export interface WalkableSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  width: number;
}

export type RoomSide = "north" | "south" | "east" | "west";

// An enclosed rectangular space (walls + ceiling) with one doorway that opens
// onto the rest of the walkable map. Axis-aligned for now. (Sonic character —
// reverb/echo from wall reflections — is intended for a later change.)
export interface MapRoom {
  id: string;
  center: [number, number]; // x, z of the interior center
  width: number; // interior extent along x
  depth: number; // interior extent along z
  height: number; // wall / ceiling height
  entranceSide: RoomSide; // which wall has the doorway
  entranceWidth: number; // doorway opening width
  entranceOffset: number; // doorway center offset along the entrance wall (0 = centered)
}

export interface CompositionMap {
  preset: MapPreset;
  segments: WalkableSegment[];
  rooms: MapRoom[];
  wallHeight: number;
  start: {
    position: [number, number];
    direction: [number, number];
  };
}

export const ROOM_WALL_THICKNESS = 0.3;
// How far the walkable doorway "threshold" extends outside the entrance wall, so
// a room positioned against a path connects to it.
const DOOR_DEPTH = 2.6;

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

export const MAP_PRESETS: Record<Exclude<MapPreset, "custom">, CompositionMap> = {
  open: { preset: "open", segments: [], rooms: [], wallHeight: 0, start: { position: [0, 0], direction: [0, -1] } },
  line: {
    preset: "line",
    wallHeight: 2.1,
    rooms: [],
    start: { position: [0, 36], direction: [0, -1] },
    segments: [{ id: "line", start: [0, 40.5], end: [0, -40.5], width: 7.5 }],
  },
  y: {
    preset: "y",
    wallHeight: 2.1,
    rooms: [],
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
  const segments = Array.isArray(value?.segments) ? value.segments.filter(isWalkableSegment) : fallback.segments;
  const rooms = Array.isArray(value?.rooms) ? value.rooms.filter(isMapRoom).map(normalizeRoom) : fallback.rooms;
  const startPosition = isPoint(value?.start?.position) ? value.start.position : fallback.start.position;
  const startDirection = normalizeDirection(isPoint(value?.start?.direction) ? value.start.direction : fallback.start.direction);
  const map = {
    preset,
    segments,
    rooms,
    wallHeight: clamp(value?.wallHeight ?? fallback.wallHeight, 0, 8),
    start: {
      position: startPosition,
      direction: startDirection,
    },
  };
  return {
    ...map,
    start: {
      ...map.start,
      position: clampToMap(map, map.start.position),
    },
  };
}

export function clampToMap(map: CompositionMap, point: [number, number]): [number, number] {
  // No constraints on a fully open map (no segments and no rooms).
  if (!map.segments.length && !map.rooms.length) return point;
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
  for (const room of map.rooms) for (const rect of roomRegions(room)) consider(closestInRect(point, rect));
  return best;
}

export function isPointInsideMap(map: CompositionMap, point: [number, number]): boolean {
  if (!map.segments.length && !map.rooms.length) return true;
  return map.segments.some((segment) => pointInSegment(point, segment)) || map.rooms.some((room) => roomContains(room, point));
}

// --- Room geometry ---

export function interiorRect(room: MapRoom): Rect {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  return { minX: room.center[0] - hw, maxX: room.center[0] + hw, minZ: room.center[1] - hd, maxZ: room.center[1] + hd };
}

// The walkable doorway threshold: a strip the entrance width wide that bridges
// the wall gap and extends DOOR_DEPTH outside, so the room connects to a path.
function doorwayRect(room: MapRoom): Rect {
  const r = interiorRect(room);
  const ew = Math.max(0.5, room.entranceWidth);
  const a = room.center[0] + room.entranceOffset - ew / 2;
  const b = room.center[0] + room.entranceOffset + ew / 2;
  const c = room.center[1] + room.entranceOffset - ew / 2;
  const d = room.center[1] + room.entranceOffset + ew / 2;
  switch (room.entranceSide) {
    case "north":
      return { minX: a, maxX: b, minZ: r.minZ - DOOR_DEPTH, maxZ: r.minZ };
    case "south":
      return { minX: a, maxX: b, minZ: r.maxZ, maxZ: r.maxZ + DOOR_DEPTH };
    case "west":
      return { minX: r.minX - DOOR_DEPTH, maxX: r.minX, minZ: c, maxZ: d };
    case "east":
      return { minX: r.maxX, maxX: r.maxX + DOOR_DEPTH, minZ: c, maxZ: d };
  }
}

export function roomRegions(room: MapRoom): Rect[] {
  return [interiorRect(room), doorwayRect(room)];
}

export function roomContains(room: MapRoom, point: [number, number]): boolean {
  return roomRegions(room).some((rect) => pointInRect(point, rect));
}

function pointInRect(p: [number, number], r: Rect): boolean {
  return p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minZ && p[1] <= r.maxZ;
}

function closestInRect(p: [number, number], r: Rect): [number, number] {
  return [clamp(p[0], r.minX, r.maxX), clamp(p[1], r.minZ, r.maxZ)];
}

function pointInSegment(point: [number, number], segment: WalkableSegment): boolean {
  const projected = closestPointOnCenterline(point, segment);
  const radius = segment.width / 2;
  const dx = point[0] - projected[0];
  const dz = point[1] - projected[1];
  return dx * dx + dz * dz <= radius * radius;
}

function closestPointInSegment(point: [number, number], segment: WalkableSegment): [number, number] {
  const center = closestPointOnCenterline(point, segment);
  const radius = segment.width / 2;
  const dx = point[0] - center[0];
  const dz = point[1] - center[1];
  const distance = Math.hypot(dx, dz);
  if (distance <= radius || distance === 0) return center;
  return [center[0] + (dx / distance) * radius, center[1] + (dz / distance) * radius];
}

function closestPointOnCenterline(point: [number, number], segment: WalkableSegment): [number, number] {
  const ax = segment.start[0];
  const az = segment.start[1];
  const bx = segment.end[0];
  const bz = segment.end[1];
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : clamp(((point[0] - ax) * dx + (point[1] - az) * dz) / lenSq, 0, 1);
  return [ax + dx * t, az + dz * t];
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

function isMapRoom(value: unknown): value is MapRoom {
  const r = value as MapRoom;
  return (
    typeof r?.id === "string" &&
    isPoint(r.center) &&
    typeof r.width === "number" &&
    typeof r.depth === "number" &&
    typeof r.height === "number" &&
    (r.entranceSide === "north" || r.entranceSide === "south" || r.entranceSide === "east" || r.entranceSide === "west")
  );
}

function normalizeRoom(room: MapRoom): MapRoom {
  const width = clamp(room.width, 3, 80);
  const depth = clamp(room.depth, 3, 80);
  const span = (room.entranceSide === "north" || room.entranceSide === "south" ? width : depth) - ROOM_WALL_THICKNESS * 2;
  const entranceWidth = clamp(room.entranceWidth ?? 4, 1, Math.max(1, span));
  const maxOffset = Math.max(0, span / 2 - entranceWidth / 2);
  return {
    id: room.id,
    center: room.center,
    width,
    depth,
    height: clamp(room.height ?? 3.2, 2, 12),
    entranceSide: room.entranceSide,
    entranceWidth,
    entranceOffset: clamp(room.entranceOffset ?? 0, -maxOffset, maxOffset),
  };
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
