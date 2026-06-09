import { describe, expect, it } from "vitest";
import {
  compositionRevision,
  defaultComposition,
  normalizeComposition,
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
      tracks: [{ ...defaultComposition.tracks[0], offsetBeats: 0.5 }, ...defaultComposition.tracks.slice(1)],
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
