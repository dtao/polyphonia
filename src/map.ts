export type MapPreset = "open" | "line" | "y" | "custom";

export interface WalkableSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  width: number;
}

export type RoomSide = "north" | "south" | "east" | "west";
export type SegmentEnd = "start" | "end";

export interface RoomAttachment {
  segmentId: string;
  end: SegmentEnd;
}

// An enclosed rectangular space (walls + ceiling) with one doorway that opens
// onto the rest of the walkable map. (Sonic character — reverb/echo from wall
// reflections — is intended for a later change.)
export interface MapRoom {
  id: string;
  center: [number, number]; // x, z of the interior center
  rotation: number; // radians around y; room geometry is defined in local x/z
  width: number; // interior extent along x
  depth: number; // interior extent along z
  height: number; // wall / ceiling height
  entranceSide: RoomSide; // which wall has the doorway
  entranceWidth: number; // doorway opening width
  entranceOffset: number; // doorway center offset along the entrance wall (0 = centered)
  attachment?: RoomAttachment; // rooms created from path endpoints stay attached to that branch point
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
  const map = alignAttachedRooms({
    preset,
    segments,
    rooms,
    wallHeight: clamp(value?.wallHeight ?? fallback.wallHeight, 0, 8),
    start: {
      position: startPosition,
      direction: startDirection,
    },
  });
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
  for (const room of map.rooms) for (const rect of roomRegionRects(room)) consider(fromRoomLocal(room, closestInRect(toRoomLocal(room, point), rect)));
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
  return { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
}

// The walkable doorway threshold: a strip the entrance width wide that bridges
// the wall gap and extends DOOR_DEPTH outside, so the room connects to a path.
function doorwayRect(room: MapRoom): Rect {
  const r = interiorRect(room);
  const ew = Math.max(0.5, room.entranceWidth);
  const a = room.entranceOffset - ew / 2;
  const b = room.entranceOffset + ew / 2;
  const c = room.entranceOffset - ew / 2;
  const d = room.entranceOffset + ew / 2;
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

export function roomRegionRects(room: MapRoom): Rect[] {
  return [interiorRect(room), doorwayRect(room)];
}

export function roomContains(room: MapRoom, point: [number, number]): boolean {
  const local = toRoomLocal(room, point);
  return roomRegionRects(room).some((rect) => pointInRect(local, rect));
}

export function roomInteriorContains(room: MapRoom, point: [number, number]): boolean {
  return pointInRect(toRoomLocal(room, point), interiorRect(room));
}

export function containingRoom(map: Pick<CompositionMap, "rooms">, point: [number, number]): MapRoom | null {
  return map.rooms.find((room) => roomInteriorContains(room, point)) ?? null;
}

export function roomWallObstructionCount(map: Pick<CompositionMap, "rooms">, from: [number, number], to: [number, number]): number {
  let count = 0;
  for (const room of map.rooms) {
    const a = toRoomLocal(room, from);
    const b = toRoomLocal(room, to);
    const aInside = pointInRect(a, interiorRect(room));
    const bInside = pointInRect(b, interiorRect(room));
    if (aInside === bInside) continue;
    if (lineHitsSolidRoomWall(room, a, b)) count++;
  }
  return count;
}

export function mapPointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
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

export function canAddRoomAtPoint(map: Pick<CompositionMap, "segments" | "rooms">, key: string): boolean {
  return isTerminalMapPoint(map, key) && !roomAttachedToPoint(map, key);
}

export function canAddBranchAtPoint(map: Pick<CompositionMap, "segments" | "rooms">, key: string): boolean {
  return endpointCount(map, key) > 0 && !roomAttachedToPoint(map, key);
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

export function alignAttachedRooms(map: CompositionMap): CompositionMap {
  return {
    ...map,
    rooms: map.rooms.map((room) => {
      if (!room.attachment) return room;
      const placed = attachedRoomPlacement(map, room);
      return placed ? { ...room, ...placed, entranceOffset: 0 } : room;
    }),
  };
}

function attachedRoomPlacement(map: Pick<CompositionMap, "segments">, room: MapRoom): Pick<MapRoom, "center" | "rotation" | "entranceSide"> | null {
  if (!room.attachment) return null;
  const segment = map.segments.find((s) => s.id === room.attachment?.segmentId);
  if (!segment) return null;
  const point = room.attachment.end === "start" ? segment.start : segment.end;
  const other = room.attachment.end === "start" ? segment.end : segment.start;
  const out = normalizeDirection([point[0] - other[0], point[1] - other[1]]);
  const rotation = Math.atan2(out[0], out[1]);
  const center: [number, number] = [point[0] + out[0] * (room.depth / 2), point[1] + out[1] * (room.depth / 2)];
  return { center, rotation, entranceSide: "north" };
}

function toRoomLocal(room: MapRoom, point: [number, number]): [number, number] {
  const dx = point[0] - room.center[0];
  const dz = point[1] - room.center[1];
  const c = Math.cos(room.rotation);
  const s = Math.sin(room.rotation);
  return [dx * c - dz * s, dx * s + dz * c];
}

function fromRoomLocal(room: MapRoom, point: [number, number]): [number, number] {
  const c = Math.cos(room.rotation);
  const s = Math.sin(room.rotation);
  return [room.center[0] + point[0] * c + point[1] * s, room.center[1] - point[0] * s + point[1] * c];
}

function lineHitsSolidRoomWall(room: MapRoom, from: [number, number], to: [number, number]): boolean {
  const r = interiorRect(room);
  const walls: Array<[[number, number], [number, number]]> = [];
  for (const [s, e] of splitWall(r.maxX, room.entranceSide === "north", room.entranceWidth, room.entranceOffset)) walls.push([[s, r.minZ], [e, r.minZ]]);
  for (const [s, e] of splitWall(r.maxX, room.entranceSide === "south", room.entranceWidth, room.entranceOffset)) walls.push([[s, r.maxZ], [e, r.maxZ]]);
  for (const [s, e] of splitWall(r.maxZ, room.entranceSide === "west", room.entranceWidth, room.entranceOffset)) walls.push([[r.minX, s], [r.minX, e]]);
  for (const [s, e] of splitWall(r.maxZ, room.entranceSide === "east", room.entranceWidth, room.entranceOffset)) walls.push([[r.maxX, s], [r.maxX, e]]);
  return walls.some(([a, b]) => lineSegmentsIntersect(from, to, a, b));
}

function splitWall(half: number, isEntrance: boolean, entranceWidth: number, offset: number): Array<[number, number]> {
  if (!isEntrance) return [[-half, half]];
  const a = offset - entranceWidth / 2;
  const b = offset + entranceWidth / 2;
  const parts: Array<[number, number]> = [];
  if (a > -half + 0.05) parts.push([-half, a]);
  if (b < half - 0.05) parts.push([b, half]);
  return parts;
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

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
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
    (r.rotation === undefined || (typeof r.rotation === "number" && Number.isFinite(r.rotation))) &&
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
    rotation: Number.isFinite(room.rotation) ? room.rotation : 0,
    width,
    depth,
    height: clamp(room.height ?? 3.2, 2, 12),
    entranceSide: room.entranceSide,
    entranceWidth,
    entranceOffset: clamp(room.entranceOffset ?? 0, -maxOffset, maxOffset),
    attachment: isRoomAttachment(room.attachment) ? room.attachment : undefined,
  };
}

function isRoomAttachment(value: unknown): value is RoomAttachment {
  const attachment = value as RoomAttachment;
  return typeof attachment?.segmentId === "string" && (attachment.end === "start" || attachment.end === "end");
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
