import { describe, expect, it } from "vitest";
import { defaultEnvironment, normalizeEnvironment } from "./environment";

describe("environment normalization", () => {
  it("defaults older manifests to the studio environment", () => {
    expect(normalizeEnvironment(undefined)).toEqual(defaultEnvironment);
  });

  it("uses preset material and ambience when only a type is supplied", () => {
    expect(normalizeEnvironment({ type: "cavern" })).toMatchObject({
      type: "cavern",
      material: "stone",
      ambience: 0.65,
    });
  });

  it("clamps invalid ambience and tiling values", () => {
    expect(
      normalizeEnvironment({
        type: "galaxy",
        ambience: 9,
        tiling: { mode: "square", size: 999, origin: [4, -2] },
      }),
    ).toEqual({
      type: "galaxy",
      material: "glass",
      ambience: 1,
      tiling: { mode: "square", size: 256, origin: [4, -2] },
    });
  });

  it("ignores unknown enum values from malformed manifests", () => {
    expect(
      normalizeEnvironment({
        type: "warehouse" as any,
        material: "metal" as any,
        tiling: { mode: "spiral" as any, size: 32, origin: [0, 0] },
      }),
    ).toEqual(defaultEnvironment);
  });
});
