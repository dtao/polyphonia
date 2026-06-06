import { describe, expect, it } from "vitest";
import { defaultMap } from "../map";
import { placedLandmarkPreviewPose } from "./placedLandmarkPreviewPose";

describe("placedLandmarkPreviewPose", () => {
  it("carries position, elevation, and facing through a loop copy", () => {
    const pose = placedLandmarkPreviewPose(
      {
        ...defaultMap,
        tiling: { ...defaultMap.tiling, type: "path-loop" },
      },
      {
        id: "end:1",
        anchor: [20, 10],
        source: [0, 0],
        rotation: Math.PI / 2,
        elevationOffset: 4,
      },
      {
        id: "landmark",
        assetId: "tree",
        position: [3, 2, -5],
        rotation: [0.1, 0.2, 0.3],
        scale: [1, 1, 1],
      },
    );

    expect(pose.position[0]).toBeCloseTo(15);
    expect(pose.position[1]).toBe(6);
    expect(pose.position[2]).toBeCloseTo(7);
    expect(pose.rotation).toEqual([0.1, 0.2 + Math.PI / 2, 0.3]);
  });
});
