import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALL_THICKNESS,
  MAP_PRESETS,
  canAddBranchAtPoint,
  canAddRoomAtPoint,
  canSetLoopEndpoint,
  clampToMap,
  defaultMap,
  doorOpenAmount,
  mapPointKey,
  normalizeMap,
  pointInOriginalTile,
  roomElevation,
  roomWallObstructionCount,
  stepOnMap,
  surfaceHeightAt,
  tiledMapTransforms,
  wallObstructionCount,
  wrapLoopPosition,
  type CompositionMap,
  type MapRoom,
} from "./map";
import { DEFAULT_ENCLOSURE_HEIGHT, EYE_HEIGHT } from "./spatialConstants";

const noTiling = { type: "none" as const, origin: [0, 0] as [number, number], tileSize: 80 };

function roomWithNorthEntrance(door?: MapRoom["entrances"][number]["door"]): MapRoom {
  return {
    id: "room",
    center: [0, 0],
    rotation: 0,
    width: 10,
    depth: 10,
    height: 3,
    entrances: [{ side: "north", width: 3, offset: 0, ...(door ? { door } : {}) }],
  };
}

function roomMap(room: MapRoom): CompositionMap {
  return normalizeMap({
    preset: "custom",
    segments: [{ id: "approach", start: [0, -5], end: [0, -15], width: 3 }],
    rooms: [room],
    platforms: [],
    walls: [],
    tiling: noTiling,
    wallHeight: 2,
    start: { position: [0, -10], direction: [0, 1] },
  });
}

describe("map normalization", () => {
  it("defaults older manifests to an open map", () => {
    expect(normalizeMap(undefined)).toEqual(defaultMap);
  });

  it("normalizes start direction and clamps start position to the walkable area", () => {
    const map = normalizeMap({
      preset: "line",
      start: { position: [30, 0], direction: [10, 0] },
    });

    expect(map.start.direction).toEqual([1, 0]);
    expect(map.start.position[0]).toBeCloseTo(3.75);
    expect(map.start.position[1]).toBeCloseTo(0);
  });

  it("clamps arbitrary points to the nearest walkable segment", () => {
    const clamped = clampToMap(MAP_PRESETS.line, [10, 0]);
    expect(clamped[0]).toBeCloseTo(3.75);
    expect(clamped[1]).toBeCloseTo(0);
  });

  it("keeps points unchanged in open maps", () => {
    expect(clampToMap(defaultMap, [100, -100])).toEqual([100, -100]);
  });

  it("migrates legacy single-entrance rooms", () => {
    const map = normalizeMap({
      preset: "custom",
      segments: [],
      rooms: [
        {
          id: "legacy-room",
          center: [4, 5],
          width: 6,
          depth: 8,
          entranceSide: "east",
          entranceWidth: 99,
          entranceOffset: 20,
        } as any,
      ],
      platforms: [],
      walls: [],
      tiling: noTiling,
      wallHeight: 2,
      start: { position: [4, 5], direction: [0, 0] },
    });

    expect(map.rooms[0]).toMatchObject({
      rotation: 0,
      height: DEFAULT_ENCLOSURE_HEIGHT,
      wallThickness: DEFAULT_WALL_THICKNESS,
      entrances: [{ side: "east", width: 7.4, offset: 0 }],
    });
    expect(map.start.direction).toEqual([0, -1]);
  });

  it("keeps default enclosure height above listener eye height", () => {
    expect(DEFAULT_ENCLOSURE_HEIGHT).toBe(EYE_HEIGHT * 1.5);
    expect(MAP_PRESETS.line.wallHeight).toBe(DEFAULT_ENCLOSURE_HEIGHT);
    expect(MAP_PRESETS.y.wallHeight).toBe(DEFAULT_ENCLOSURE_HEIGHT);
  });

  it("normalizes barriers and removes stale elevation entries", () => {
    const startKey = mapPointKey([0, 0]);
    const endKey = mapPointKey([0, 10]);
    const map = normalizeMap({
      preset: "custom",
      segments: [
        { id: "path", start: [0, 0], end: [0, 10], width: 4, wallThickness: 2 },
        { id: "tunnel", start: [0, 10], end: [10, 10], width: 4, kind: "tunnel", wallThickness: 99 },
      ],
      rooms: [],
      platforms: [],
      walls: [{ id: "wall", start: [-2, 5], end: [2, 5], height: 99, wallThickness: 0 }],
      tiling: noTiling,
      elevations: { [startKey]: 2, [endKey]: 0, "missing,point": 8 },
      wallHeight: 2,
      start: { position: [0, 0], direction: [0, 1] },
    });

    expect(map.segments[0].wallThickness).toBeUndefined();
    expect(map.segments[1].wallThickness).toBe(3);
    expect(map.walls[0]).toMatchObject({ height: 12, wallThickness: 0.15 });
    expect(map.elevations).toEqual({ [startKey]: 2 });
  });

  it("migrates legacy loop endpoints into path-loop tiling", () => {
    const map = normalizeMap({
      preset: "custom",
      segments: [{ id: "corridor", start: [0, 10], end: [0, -10], width: 4 }],
      rooms: [],
      platforms: [],
      walls: [],
      loop: {
        start: { segmentId: "corridor", end: "start" },
        end: { segmentId: "corridor", end: "end" },
      },
      wallHeight: 2,
      start: { position: [0, 0], direction: [0, -1] },
    });

    expect(map.tiling.type).toBe("path-loop");
    expect(map.tiling.pathLoop).toEqual(map.loop);
  });
});

describe("map topology and elevation", () => {
  it("allows branches at joints but reserves loop endpoints for terminals", () => {
    const map = normalizeMap({
      preset: "custom",
      segments: [
        { id: "a", start: [0, 0], end: [0, 10], width: 4 },
        { id: "b", start: [0, 10], end: [10, 10], width: 4 },
      ],
      rooms: [],
      platforms: [],
      walls: [],
      tiling: noTiling,
      wallHeight: 2,
      start: { position: [0, 0], direction: [0, 1] },
    });
    const terminal = mapPointKey([0, 0]);
    const joint = mapPointKey([0, 10]);

    expect(canAddRoomAtPoint(map, terminal)).toBe(true);
    expect(canSetLoopEndpoint(map, terminal)).toBe(true);
    expect(canAddBranchAtPoint(map, joint)).toBe(true);
    expect(canSetLoopEndpoint(map, joint)).toBe(false);
  });

  it("interpolates ramp height and lets attached rooms inherit endpoint elevation", () => {
    const segment = { id: "ramp", start: [0, 0] as [number, number], end: [0, 10] as [number, number], width: 4 };
    const room: MapRoom = {
      ...roomWithNorthEntrance(),
      attachment: { segmentId: "ramp", end: "end" },
    };
    const map = normalizeMap({
      preset: "custom",
      segments: [segment],
      rooms: [room],
      platforms: [],
      walls: [],
      tiling: noTiling,
      elevations: {
        [mapPointKey(segment.start)]: 2,
        [mapPointKey(segment.end)]: 8,
      },
      wallHeight: 2,
      start: { position: [0, 0], direction: [0, 1] },
    });

    expect(surfaceHeightAt(map, [0, 5])).toBeCloseTo(5);
    expect(roomElevation(map, map.rooms[0])).toBe(8);
  });
});

describe("doors and acoustic barriers", () => {
  it("opens one-way doors only from their configured side", () => {
    const room = roomWithNorthEntrance({ openFrom: "outside" });
    const entrance = room.entrances[0];

    expect(doorOpenAmount(room, entrance, [0, -6])).toBeGreaterThan(0.5);
    expect(doorOpenAmount(room, entrance, [0, -4])).toBe(0);
  });

  it("blocks movement through a closed door and permits it from the opening side", () => {
    const map = roomMap(roomWithNorthEntrance({ openFrom: "outside" }));

    const blocked = stepOnMap(map, [0, -4], [0, -6], { kind: "room", roomId: "room" });
    const entering = stepOnMap(map, [0, -6], [0, -4], { kind: "segment", segmentId: "approach" });

    expect(blocked.position).toEqual([0, -4]);
    expect(entering.position).toEqual([0, -4]);
    expect(entering.support).toEqual({ kind: "room", roomId: "room" });
  });

  it("treats an open doorway as acoustically transparent and a closed door as solid", () => {
    const openMap = roomMap(roomWithNorthEntrance());
    const closedMap = roomMap(roomWithNorthEntrance({ openFrom: "inside" }));

    expect(roomWallObstructionCount(openMap, [0, -7], [0, 0])).toBe(0);
    expect(roomWallObstructionCount(closedMap, [0, -7], [0, 0])).toBeGreaterThan(0);
  });

  it("makes thicker standalone walls more obstructive", () => {
    const thin = wallObstructionCount(
      { walls: [{ id: "thin", start: [0, -2], end: [0, 2], height: 3, wallThickness: 0.15 }] },
      [-2, 0],
      [2, 0],
    );
    const thick = wallObstructionCount(
      { walls: [{ id: "thick", start: [0, -2], end: [0, 2], height: 3, wallThickness: 3 }] },
      [-2, 0],
      [2, 0],
    );

    expect(thin).toBeGreaterThan(0);
    expect(thick).toBeGreaterThan(thin);
  });
});

describe("spatial tiling", () => {
  it("maps square-tiled positions back into the authored tile", () => {
    const map = {
      ...defaultMap,
      tiling: { type: "square" as const, origin: [0, 0] as [number, number], tileSize: 10 },
    };

    expect(pointInOriginalTile(map, [16, -14])).toEqual([-4, -4]);
    expect(tiledMapTransforms(map, [0, 0], 12).some((copy) => copy.id === "square:1:0")).toBe(true);
  });

  it("allows object previews to expand beyond the structural tile range", () => {
    const map = {
      ...defaultMap,
      tiling: { type: "square" as const, origin: [0, 0] as [number, number], tileSize: 10 },
    };

    expect(tiledMapTransforms(map, [0, 0], 45).some((copy) => copy.id === "square:4:0")).toBe(false);
    expect(
      tiledMapTransforms(map, [0, 0], 45, { tileRange: 8 }).some(
        (copy) => copy.id === "square:4:0",
      ),
    ).toBe(true);
  });

  it("wraps movement past one path-loop endpoint to the other", () => {
    const map = normalizeMap({
      preset: "custom",
      segments: [{ id: "corridor", start: [0, 10], end: [0, -10], width: 4 }],
      rooms: [],
      platforms: [],
      walls: [],
      tiling: {
        type: "path-loop",
        origin: [0, 0],
        tileSize: 80,
        pathLoop: {
          start: { segmentId: "corridor", end: "start" },
          end: { segmentId: "corridor", end: "end" },
        },
      },
      wallHeight: 2,
      start: { position: [0, 0], direction: [0, -1] },
    });

    const wrapped = wrapLoopPosition(map, [0, -9.5], [0, -11]);
    expect(wrapped?.position[0]).toBeCloseTo(0);
    expect(wrapped?.position[1]).toBeCloseTo(9);
    expect(Math.sin(wrapped!.yawDelta)).toBeCloseTo(0);
    expect(Math.cos(wrapped!.yawDelta)).toBeCloseTo(1);
  });
});
