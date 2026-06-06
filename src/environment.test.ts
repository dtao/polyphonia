import { describe, expect, it } from "vitest";
import { defaultEnvironment, normalizeEnvironment } from "./environment";

describe("environment normalization", () => {
  it("defaults older manifests to the neutral environment", () => {
    expect(normalizeEnvironment(undefined)).toEqual(defaultEnvironment);
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
});
