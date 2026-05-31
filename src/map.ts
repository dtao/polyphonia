export type MapPreset = "open" | "line" | "y" | "custom";

export interface WalkableSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  width: number;
}

export interface CompositionMap {
  preset: MapPreset;
  segments: WalkableSegment[];
  wallHeight: number;
  start: {
    position: [number, number];
    direction: [number, number];
  };
}

export const MAP_PRESETS: Record<Exclude<MapPreset, "custom">, CompositionMap> = {
  open: { preset: "open", segments: [], wallHeight: 0, start: { position: [0, 0], direction: [0, -1] } },
  line: {
    preset: "line",
    wallHeight: 2.1,
    start: { position: [0, 36], direction: [0, -1] },
    segments: [{ id: "line", start: [0, 40.5], end: [0, -40.5], width: 7.5 }],
  },
  y: {
    preset: "y",
    wallHeight: 2.1,
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
  const startPosition = isPoint(value?.start?.position) ? value.start.position : fallback.start.position;
  const startDirection = normalizeDirection(isPoint(value?.start?.direction) ? value.start.direction : fallback.start.direction);
  const map = {
    preset,
    segments,
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
  if (!map.segments.length) return point;
  if (map.segments.some((segment) => pointInSegment(point, segment))) return point;

  let best: [number, number] = point;
  let bestDistanceSq = Infinity;
  for (const segment of map.segments) {
    const projected = closestPointInSegment(point, segment);
    const dx = point[0] - projected[0];
    const dz = point[1] - projected[1];
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      best = projected;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
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
