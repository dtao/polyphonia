import { describe, expect, it } from "vitest";
import {
  defaultEnvironment,
  defaultGeneratedParams,
  normalizeEnvironment,
  normalizeGenerated,
} from "./environment";

describe("environment normalization", () => {
  it("defaults older manifests to the neutral environment", () => {
    expect(normalizeEnvironment(undefined)).toEqual(defaultEnvironment);
  });

  it("normalizes reusable surface material references", () => {
    expect(normalizeEnvironment({
      surfaces: { ground: " moss ", floor: " stone ", wall: "", ceiling: "crystal" },
    })).toEqual({
      surfaces: { ground: "moss", floor: "stone", ceiling: "crystal" },
    });
  });

  it("normalizes authored pack selections", () => {
    expect(
      normalizeEnvironment({
        pack: { id: "  atlas-cavern  ", variant: "  ember  ", quality: "high" },
      }),
    ).toEqual({
      pack: { id: "atlas-cavern", variant: "ember", quality: "high" },
    });
  });

  it("defaults invalid pack quality and omits blank variants", () => {
    expect(
      normalizeEnvironment({
        pack: { id: "verdant-grove", variant: " ", quality: "ultra" as any },
      }),
    ).toEqual({
      pack: { id: "verdant-grove", quality: "auto" },
    });
  });

  it("ignores legacy preset fields and malformed pack ids", () => {
    expect(
      normalizeEnvironment({
        type: "warehouse",
        material: "metal",
        tiling: { mode: "spiral" as any, size: 32, origin: [0, 0] },
        pack: { id: " ", quality: "high" },
      } as any),
    ).toEqual(defaultEnvironment);
  });

  it("normalizes creator-authored landmark placements", () => {
    expect(
      normalizeEnvironment({
        pack: { id: "verdant-grove", quality: "auto" },
        landmarks: [
          {
            id: " tree-1 ",
            assetId: " evergreen ",
            packId: " verdant-grove ",
            position: [2, 0, -3],
            rotation: [0, Math.PI / 2, 0],
            scale: [1.5, 1.5, 1.5],
          },
          {
            id: "",
            assetId: "broken",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      }),
    ).toEqual({
      pack: { id: "verdant-grove", quality: "auto" },
      landmarks: [
        {
          id: "tree-1",
          assetId: "evergreen",
          packId: "verdant-grove",
          position: [2, 0, -3],
          rotation: [0, Math.PI / 2, 0],
          scale: [1.5, 1.5, 1.5],
        },
      ],
    });
  });
});

describe("generated environment normalization", () => {
  const object = { id: "o1", kind: "pine", position: [1, 0, 2], yaw: 0.5, scale: 1.2 };

  it("round-trips a valid generated environment", () => {
    const generated = {
      biome: "meadow",
      seed: 1234,
      params: defaultGeneratedParams("meadow"),
      center: [3, -4] as [number, number],
      size: 120,
      constraints: { stems: true, paths: false, buffer: 5 },
      objects: [object],
      edits: [
        { id: "e1", type: "terrain", mode: "raise", center: [0, 5], radius: 8, amount: 2, at: "2026-01-01T00:00:00.000Z", level: "minor" },
        { id: "e2", type: "reseed", center: [10, 10], radius: 20, seed: 77, at: "2026-01-01T00:00:00.000Z", level: "major" },
      ],
      locks: { o1: true },
    };
    expect(normalizeGenerated(generated)).toEqual(generated);
    expect(normalizeEnvironment({ generated } as any).generated).toEqual(generated);
  });

  it("requires a numeric seed and falls back to the forest biome", () => {
    expect(normalizeGenerated({ biome: "forest" })).toBeUndefined();
    expect(normalizeGenerated({ biome: "volcano", seed: 1 })?.biome).toBe("forest");
  });

  it("drops malformed objects and edits, and prunes locks to live objects", () => {
    const generated = normalizeGenerated({
      biome: "forest",
      seed: 5,
      objects: [object, { id: "", kind: "pine", position: [0, 0, 0] }, { id: "x", kind: "lamppost", position: [0, 0, 0] }],
      edits: [
        { id: "bad", type: "terrain", mode: "tilt", center: [0, 0], radius: 5, amount: 1 },
        { id: "ok", type: "terrain", mode: "lower", center: [0, 0], radius: 5, amount: -1, at: "t", level: "weird" },
      ],
      locks: { o1: true, ghost: true, x: false },
    });
    expect(generated?.objects.map((candidate) => candidate.id)).toEqual(["o1"]);
    expect(generated?.edits.map((edit) => edit.id)).toEqual(["ok"]);
    expect(generated?.edits[0]).toMatchObject({ level: "minor" });
    expect(generated?.locks).toEqual({ o1: true });
  });

  it("clamps params and fills defaults from the biome", () => {
    const generated = normalizeGenerated({
      biome: "cavern",
      seed: 5,
      params: { density: 9, terrainAmplitude: -2, skyColor: "purple", palette: ["#101010"] },
    });
    const defaults = defaultGeneratedParams("cavern");
    expect(generated?.params).toEqual({
      ...defaults,
      density: 1,
      terrainAmplitude: 0,
      palette: ["#101010", defaults.palette[1], defaults.palette[2]],
    });
    expect(generated?.center).toEqual([0, 0]);
  });

  it("keeps a valid zenith sky color and drops invalid ones", () => {
    const params = (skyColor2: unknown) =>
      normalizeGenerated({ biome: "meadow", seed: 5, params: { skyColor2 } })?.params;
    expect(params("#7a1d2e")?.skyColor2).toBe("#7a1d2e");
    expect(params("red")?.skyColor2).toBeUndefined();
    expect(params(undefined)?.skyColor2).toBeUndefined();
  });
});
