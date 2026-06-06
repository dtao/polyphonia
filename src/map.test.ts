import { describe, expect, it } from "vitest";
import { MAP_PRESETS, clampToMap, defaultMap, normalizeMap } from "./map";

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
});
