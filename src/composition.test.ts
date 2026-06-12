import { describe, expect, it } from "vitest";
import {
  compositionRevision,
  defaultComposition,
  normalizeAutopilot,
  normalizeComposition,
  sampleAutopilotRoute,
  touchComposition,
} from "./composition";

describe("composition compatibility and revisions", () => {
  it("preserves an existing creation timestamp when backfilling updatedAt", () => {
    const createdAt = "2026-01-02T03:04:05.000Z";
    const normalized = normalizeComposition({
      ...defaultComposition,
      createdAt,
      updatedAt: undefined,
    });

    expect(normalized.createdAt).toBe(createdAt);
    expect(normalized.updatedAt).toBe(createdAt);
  });

  it("touches updatedAt without replacing createdAt", () => {
    const createdAt = "2026-01-02T03:04:05.000Z";
    const updatedAt = "2026-06-06T12:00:00.000Z";

    expect(touchComposition({ createdAt, updatedAt: "old" }, updatedAt)).toEqual({
      createdAt,
      updatedAt,
    });
  });

  it("ignores local and cloud bookkeeping when detecting unpublished changes", () => {
    const base = {
      ...defaultComposition,
      id: "local-a",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      publishedId: "published-a",
      publishedRevision: "old",
      publishedAt: "2026-01-03T00:00:00.000Z",
    };
    const bookkeepingOnly = {
      ...base,
      id: "local-b",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
      publishedId: "published-b",
      publishedRevision: "new",
      publishedAt: "2026-06-06T00:00:00.000Z",
    };

    expect(compositionRevision(bookkeepingOnly)).toBe(compositionRevision(base));
  });

  it("treats stored and runtime file sources as the same audio identity", () => {
    const runtime = {
      ...defaultComposition,
      tracks: [
        {
          ...defaultComposition.tracks[0],
          source: { kind: "file" as const, url: "blob:http://localhost/runtime-a" },
          hash: "hash-a",
        },
      ],
    };
    const stored = {
      ...runtime,
      tracks: [
        {
          ...runtime.tracks[0],
          source: { kind: "stored", key: "stem-a" },
          hash: "hash-b",
        },
      ],
    };

    expect(compositionRevision(stored)).toBe(compositionRevision(runtime));
  });

  it("changes revision for audible, visual, and map edits", () => {
    const baseline = compositionRevision(defaultComposition);
    const changedVolume = {
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], volume: 0.5 }, ...defaultComposition.tracks.slice(1)],
    };
    const changedEnvironment = {
      ...defaultComposition,
      environment: { pack: { id: "atlas-cavern", quality: "high" as const } },
    };
    const changedMap = {
      ...defaultComposition,
      map: { ...defaultComposition.map, wallHeight: 3 },
    };
    const changedLoopTail = { ...defaultComposition, loopTail: true };
    const changedStemLoop = {
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], loopStart: 0.5, loopEnd: 2, loopRepeat: true }, ...defaultComposition.tracks.slice(1)],
    };
    const changedDirectivity = {
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        directivity: {
          direction: [1, 0] as [number, number],
          width: 90,
          dispersion: 60,
          outsideGain: 0.15,
        },
      }, ...defaultComposition.tracks.slice(1)],
    };
    const changedBeats = { ...defaultComposition, beats: 32 };
    const changedBeatsPerBar = { ...defaultComposition, beatsPerBar: 7 };
    const changedOffset = {
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], offsetBeats: 3 }, ...defaultComposition.tracks.slice(1)],
    };
    const changedOffsetFine = {
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], offsetFineBeats: 0.25 }, ...defaultComposition.tracks.slice(1)],
    };

    expect(compositionRevision(changedVolume)).not.toBe(baseline);
    expect(compositionRevision(changedEnvironment)).not.toBe(baseline);
    expect(compositionRevision(changedMap)).not.toBe(baseline);
    expect(compositionRevision(changedLoopTail)).not.toBe(baseline);
    expect(compositionRevision(changedStemLoop)).not.toBe(baseline);
    expect(compositionRevision(changedDirectivity)).not.toBe(baseline);
    expect(compositionRevision(changedBeats)).not.toBe(baseline);
    expect(compositionRevision(changedBeatsPerBar)).not.toBe(baseline);
    expect(compositionRevision(changedOffset)).not.toBe(baseline);
    expect(compositionRevision(changedOffsetFine)).not.toBe(baseline);
  });

  it("changes revision when a stem's shape changes", () => {
    const baseline = compositionRevision(defaultComposition);
    const withPillar = {
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], stemShape: { kind: "pillar" as const } }, ...defaultComposition.tracks.slice(1)],
    };

    expect(compositionRevision(withPillar)).not.toBe(baseline);
  });

  it("normalizes orb stemShape to undefined (it is the default)", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], stemShape: { kind: "orb" } }, ...defaultComposition.tracks.slice(1)],
    });

    expect(normalized.tracks[0].stemShape).toBeUndefined();
  });

  it("preserves pillar stemShape through normalization", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], stemShape: { kind: "pillar" } }, ...defaultComposition.tracks.slice(1)],
    });

    expect(normalized.tracks[0].stemShape).toEqual({ kind: "pillar" });
  });

  it("drops unknown stemShape kinds", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{ ...defaultComposition.tracks[0], stemShape: { kind: "unknown" } as never }, ...defaultComposition.tracks.slice(1)],
    });

    expect(normalized.tracks[0].stemShape).toBeUndefined();
  });

  it("normalizes wall facing to a unit vector and clamps width", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        stemShape: { kind: "wall", facing: [3, 4], width: 500 },
      }, ...defaultComposition.tracks.slice(1)],
    });

    const shape = normalized.tracks[0].stemShape as Extract<import("./composition").StemShape, { kind: "wall" }>;
    expect(shape.kind).toBe("wall");
    expect(shape.facing[0]).toBeCloseTo(0.6);
    expect(shape.facing[1]).toBeCloseTo(0.8);
    expect(shape.width).toBe(200);
    expect(shape.emitBothSides).toBeUndefined();
  });

  it("preserves emitBothSides on wall shapes", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        stemShape: { kind: "wall", facing: [1, 0], width: 10, emitBothSides: true },
      }, ...defaultComposition.tracks.slice(1)],
    });

    const shape = normalized.tracks[0].stemShape as Extract<import("./composition").StemShape, { kind: "wall" }>;
    expect(shape.emitBothSides).toBe(true);
  });

  it("changes revision when a wall shape is added", () => {
    const baseline = compositionRevision(defaultComposition);
    const withWall = {
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        stemShape: { kind: "wall" as const, facing: [1, 0] as [number, number], width: 10 },
      }, ...defaultComposition.tracks.slice(1)],
    };

    expect(compositionRevision(withWall)).not.toBe(baseline);
  });

  it("preserves river stemShape through normalization", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        stemShape: { kind: "river", end: [5, 0, 10] },
      }, ...defaultComposition.tracks.slice(1)],
    });

    expect(normalized.tracks[0].stemShape).toEqual({ kind: "river", end: [5, 0, 10] });
  });

  it("drops river stemShape with invalid end point", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        stemShape: { kind: "river", end: [Infinity, 0, 0] },
      }, ...defaultComposition.tracks.slice(1)],
    });

    expect(normalized.tracks[0].stemShape).toBeUndefined();
  });

  it("changes revision when a river shape is added", () => {
    const baseline = compositionRevision(defaultComposition);
    const withRiver = {
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        stemShape: { kind: "river" as const, end: [20, 0, 0] as [number, number, number] },
      }, ...defaultComposition.tracks.slice(1)],
    };

    expect(compositionRevision(withRiver)).not.toBe(baseline);
  });

  it("migrates a legacy bars loop length to beats", () => {
    const legacy = { ...defaultComposition, beats: undefined, bars: 8 } as unknown as Parameters<typeof normalizeComposition>[0];
    const normalized = normalizeComposition(legacy);

    expect(normalized.beats).toBe(32);
    expect((normalized as { bars?: number }).bars).toBeUndefined();
  });

  it("keeps an explicit beats value over a legacy bars value", () => {
    const both = { ...defaultComposition, beats: 12, bars: 8 } as unknown as Parameters<typeof normalizeComposition>[0];
    const normalized = normalizeComposition(both);

    expect(normalized.beats).toBe(12);
    expect((normalized as { bars?: number }).bars).toBeUndefined();
  });

  it("normalizes directional speaker settings from saved manifests", () => {
    const normalized = normalizeComposition({
      ...defaultComposition,
      tracks: [{
        ...defaultComposition.tracks[0],
        directivity: {
          direction: [3, 4],
          width: 400,
          dispersion: 90,
          outsideGain: -1,
        },
      }],
    });

    expect(normalized.tracks[0].directivity).toEqual({
      direction: [0.6, 0.8],
      width: 360,
      dispersion: 0,
      outsideGain: 0,
    });
  });
});

describe("auto-pilot routes", () => {
  const route = {
    duration: 2,
    samples: [
      { t: 0, x: 0, z: 0, yaw: 0, pitch: 0 },
      { t: 1, x: 4, z: 0, yaw: 1, pitch: 0.2 },
      { t: 2, x: 4, z: 4, yaw: 1, pitch: 0.2 },
    ],
  };

  it("normalizes valid routes and drops malformed ones", () => {
    expect(normalizeAutopilot(route)).toEqual(route);
    expect(normalizeAutopilot(undefined)).toBeUndefined();
    expect(normalizeAutopilot({ duration: 5, samples: [] })).toBeUndefined();
    expect(normalizeAutopilot({ duration: 5, samples: [route.samples[0]] })).toBeUndefined();
    // Bad samples are dropped; out-of-order ones are sorted; duration covers
    // the last sample.
    expect(
      normalizeAutopilot({
        duration: 0.5,
        samples: [route.samples[1], route.samples[0], { t: NaN, x: 0, z: 0, yaw: 0, pitch: 0 }],
      }),
    ).toEqual({ duration: 1, samples: [route.samples[0], route.samples[1]] });
  });

  it("keeps a normalized route on the composition and strips invalid ones", () => {
    const withRoute = normalizeComposition({ ...defaultComposition, autopilot: route });
    expect(withRoute.autopilot).toEqual(route);
    const withBad = normalizeComposition({ ...defaultComposition, autopilot: { duration: 1, samples: [] } as any });
    expect(withBad).not.toHaveProperty("autopilot");
  });

  it("interpolates position and look along the route, clamping at the ends", () => {
    expect(sampleAutopilotRoute(route, -1)).toMatchObject({ x: 0, z: 0, yaw: 0 });
    expect(sampleAutopilotRoute(route, 0.5)).toMatchObject({ x: 2, z: 0, yaw: 0.5, pitch: 0.1, jump: false });
    expect(sampleAutopilotRoute(route, 1.5)).toMatchObject({ x: 4, z: 2, jump: false });
    expect(sampleAutopilotRoute(route, 99)).toMatchObject({ x: 4, z: 4 });
  });

  it("flags recorded teleports instead of sweeping across them", () => {
    const wrap = {
      duration: 2,
      samples: [
        { t: 0, x: 0, z: 0, yaw: 0, pitch: 0 },
        { t: 1, x: 0, z: -40, yaw: 0, pitch: 0 }, // recorded loop wrap
        { t: 2, x: 2, z: -40, yaw: 0, pitch: 0 },
      ],
    };
    const before = sampleAutopilotRoute(wrap, 0.4);
    expect(before).toMatchObject({ x: 0, z: 0, jump: true });
    const after = sampleAutopilotRoute(wrap, 0.6);
    expect(after).toMatchObject({ x: 0, z: -40, jump: true });
  });
});
