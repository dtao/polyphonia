import { describe, expect, it } from "vitest";
import { normalizeMap, tiledMapTransforms, type CompositionMap } from "../map";
import { selectAudibleTrackInstances } from "./audioSpatial";

// A long straight corridor whose two terminal endpoints are joined into a
// path-loop. Crossing one seam wraps the listener to the other endpoint.
function pathLoopCorridor(): CompositionMap {
  return normalizeMap({
    preset: "custom",
    segments: [{ id: "corridor", start: [0, 200], end: [0, -200], width: 4 }],
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
}

function nearestDistance(
  instances: { position: [number, number, number] }[],
  listener: [number, number, number],
): number {
  return Math.min(
    ...instances.map(({ position: [x, y, z] }) =>
      Math.hypot(x - listener[0], y - listener[1], z - listener[2]),
    ),
  );
}

describe("selectAudibleTrackInstances — path-loop seam", () => {
  // Regression: a stem near one seam must stay audible after the listener
  // crosses to the other seam. The stem's *base* position is now far in raw
  // world coordinates, but a wrapped loop copy sits right next to the listener.
  it("keeps a near-seam stem audible after the listener crosses the seam", () => {
    const map = pathLoopCorridor();
    // Stem hugs the -200 endpoint; listener has wrapped to the +200 endpoint.
    const base: [number, number, number] = [0, 0, -195];
    const listener: [number, number, number] = [0, 0, 195];
    const audibleDistanceSq = 40 * 40; // a normal stem's reach, well under 390u base gap

    // The base alone is far beyond reach — the old base-distance cull silenced it.
    const baseGap = Math.hypot(base[0] - listener[0], base[2] - listener[2]);
    expect(baseGap * baseGap).toBeGreaterThan(audibleDistanceSq);

    const previews = tiledMapTransforms(map, [listener[0], listener[2]], 120);
    const instances = selectAudibleTrackInstances(
      base,
      [0, -1],
      previews,
      map,
      audibleDistanceSq,
      4,
      listener[0],
      listener[1],
      listener[2],
    );

    expect(instances.length).toBeGreaterThan(0);
    // A wrapped copy lands just past the +200 seam, very close to the listener.
    expect(nearestDistance(instances, listener)).toBeLessThan(40);
  });

  it("still culls a stem with no copy within reach", () => {
    const map = pathLoopCorridor();
    // Mid-corridor stem, listener far down the corridor: no wrap brings them close.
    const base: [number, number, number] = [0, 0, 150];
    const listener: [number, number, number] = [0, 0, -150];
    const audibleDistanceSq = 40 * 40;

    const previews = tiledMapTransforms(map, [listener[0], listener[2]], 120);
    const instances = selectAudibleTrackInstances(
      base,
      [0, -1],
      previews,
      map,
      audibleDistanceSq,
      4,
      listener[0],
      listener[1],
      listener[2],
    );

    expect(instances).toHaveLength(0);
  });

  it("falls back to a plain base-distance cull with no tiling", () => {
    const audibleDistanceSq = 40 * 40;
    const near = selectAudibleTrackInstances([0, 0, 10], [0, -1], [], null, audibleDistanceSq, 4, 0, 0, 0);
    const far = selectAudibleTrackInstances([0, 0, 100], [0, -1], [], null, audibleDistanceSq, 4, 0, 0, 0);
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(0);
  });
});
