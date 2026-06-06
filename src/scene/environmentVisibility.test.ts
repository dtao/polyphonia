import { describe, expect, it } from "vitest";
import { defaultMap } from "../map";
import { RADIAL_FADE_OUTER } from "./fade";
import { environmentGenerationRadius } from "./environmentVisibility";

describe("environmentGenerationRadius", () => {
  it("generates origin-based tiles beyond the fade radius by the farthest object offset", () => {
    expect(environmentGenerationRadius(defaultMap, [[30, 40]])).toBe(RADIAL_FADE_OUTER + 54);
  });

  it("accounts for both path-loop source endpoints", () => {
    const map = {
      ...defaultMap,
      segments: [{ id: "path", start: [0, 0] as [number, number], end: [100, 0] as [number, number], width: 4 }],
      tiling: {
        ...defaultMap.tiling,
        type: "path-loop" as const,
        pathLoop: {
          start: { segmentId: "path", end: "start" as const },
          end: { segmentId: "path", end: "end" as const },
        },
      },
    };

    expect(environmentGenerationRadius(map, [[10, 0]])).toBe(RADIAL_FADE_OUTER + 94);
  });
});
