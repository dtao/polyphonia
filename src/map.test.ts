import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALL_THICKNESS,
  MAP_PRESETS,
  MAX_VISIBLE_RADIUS,
  MIN_VISIBLE_RADIUS,
  MIN_VISIBLE_RADIUS_GAP,
  canAddBranchAtPoint,
  canAddRoomAtPoint,
  canSetLoopEndpoint,
  clampToMap,
  defaultMap,
  doorOpenAmount,
  mapPointKey,
  MIN_VERTICAL_VISIBLE_RADIUS,
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
  type MapPlatform,
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

  it("omits visible radius when uncustomized so the shape stays stable", () => {
    expect(normalizeMap({ preset: "open" })).not.toHaveProperty("visibleRadius");
    expect(normalizeMap({ preset: "open", visibleRadius: undefined as any })).not.toHaveProperty("visibleRadius");
  });

  it("keeps a valid custom visible radius", () => {
    const map = normalizeMap({ preset: "open", visibleRadius: { inner: 60, outer: 100 } });
    expect(map.visibleRadius).toEqual({ inner: 60, outer: 100 });
  });

  it("clamps the visible radius into range and keeps outer above inner", () => {
    const tooBig = normalizeMap({ preset: "open", visibleRadius: { inner: 999, outer: 999 } });
    expect(tooBig.visibleRadius).toEqual({ inner: MAX_VISIBLE_RADIUS - MIN_VISIBLE_RADIUS_GAP, outer: MAX_VISIBLE_RADIUS });

    const inverted = normalizeMap({ preset: "open", visibleRadius: { inner: 120, outer: 40 } });
    expect(inverted.visibleRadius).toEqual({ inner: 120, outer: 120 + MIN_VISIBLE_RADIUS_GAP });

    const tooSmall = normalizeMap({ preset: "open", visibleRadius: { inner: 1, outer: 2 } });
    expect(tooSmall.visibleRadius).toEqual({ inner: MIN_VISIBLE_RADIUS, outer: MIN_VISIBLE_RADIUS + MIN_VISIBLE_RADIUS_GAP });
  });

  it("normalizes the vertical visible radius independently and omits when absent", () => {
    expect(normalizeMap({ preset: "open" })).not.toHaveProperty("visibleRadiusVertical");
    const map = normalizeMap({ preset: "open", visibleRadiusVertical: { inner: 10, outer: 25 } });
    expect(map.visibleRadiusVertical).toEqual({ inner: 10, outer: 25 });
    expect(map).not.toHaveProperty("visibleRadius");

    const tight = normalizeMap({ preset: "open", visibleRadiusVertical: { inner: 0, outer: 1 } });
    expect(tight.visibleRadiusVertical).toEqual({
      inner: MIN_VERTICAL_VISIBLE_RADIUS,
      outer: MIN_VERTICAL_VISIBLE_RADIUS + MIN_VISIBLE_RADIUS_GAP,
    });
  });

  it("keeps valid teleport pins, one per digit, sorted, and omits when empty", () => {
    expect(normalizeMap({ preset: "open" })).not.toHaveProperty("teleportPins");
    expect(normalizeMap({ preset: "open", teleportPins: [] })).not.toHaveProperty("teleportPins");

    const map = normalizeMap({
      preset: "open",
      teleportPins: [
        { key: 3, position: [1, 2] },
        { key: 0, position: [5, 6] },
        { key: 3, position: [9, 9] }, // later entry for the same digit wins
        { key: 12, position: [0, 0] }, // out of range → dropped
        { key: 1.5, position: [0, 0] }, // non-integer → dropped
        { key: 4, position: [NaN, 0] as any }, // bad point → dropped
      ] as any,
    });
    expect(map.teleportPins).toEqual([
      { key: 0, position: [5, 6] },
      { key: 3, position: [9, 9] },
    ]);
  });

  it("ignores a non-finite visible radius", () => {
    expect(normalizeMap({ preset: "open", visibleRadius: { inner: NaN, outer: 100 } as any })).not.toHaveProperty("visibleRadius");
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
      walls: [{ id: "wall", start: [-2, 5], end: [2, 5], height: 99, elevation: 150, wallThickness: 0 }],
      tiling: noTiling,
      elevations: { [startKey]: 2, [endKey]: 0, "missing,point": 8 },
      wallHeight: 2,
      start: { position: [0, 0], direction: [0, 1] },
    });

    expect(map.segments[0].wallThickness).toBeUndefined();
    expect(map.segments[1].wallThickness).toBe(3);
    expect(map.walls[0]).toMatchObject({ height: 12, elevation: 100, wallThickness: 0.15 });
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

  it("grows an attached platform's depth away from its path without dragging the endpoint", () => {
    const platform: MapPlatform = {
      id: "plat",
      center: [0, 0],
      rotation: 0,
      shape: "rect",
      width: 18,
      depth: 18,
      elevation: 0,
      attachment: { segmentId: "approach", end: "start" },
    };
    const make = (depth: number): CompositionMap =>
      normalizeMap({
        preset: "custom",
        segments: [{ id: "approach", start: [0, -5], end: [0, -15], width: 3 }],
        rooms: [],
        platforms: [{ ...platform, depth }],
        walls: [],
        tiling: noTiling,
        wallHeight: 2,
        start: { position: [0, -10], direction: [0, 1] },
      });

    const before = make(18);
    const nearBefore = before.platforms[0].center[1] - before.platforms[0].depth / 2;
    // Simulate the editor's depth slider: patch depth on the normalized map and
    // renormalize (the store's non-move updatePlatform path).
    const after = normalizeMap({
      ...before,
      platforms: before.platforms.map((p) => ({ ...p, depth: 30 })),
    });

    // The anchoring endpoint must not drift, the near edge stays pinned to it,
    // and the extra depth extends outward (the far edge moves, not the near).
    expect(after.segments[0].start).toEqual(before.segments[0].start);
    expect(after.platforms[0].center[1] - after.platforms[0].depth / 2).toBeCloseTo(nearBefore);
    expect(after.platforms[0].center[1] + after.platforms[0].depth / 2).toBeGreaterThan(
      before.platforms[0].center[1] + before.platforms[0].depth / 2,
    );
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
