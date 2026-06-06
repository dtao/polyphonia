import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENVIRONMENT_PACKS,
  environmentPackAsset,
  environmentPackById,
  resolvedEnvironmentQuality,
} from "./environmentPacks";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("environment pack registry", () => {
  it("resolves registered packs and their preferred assets", () => {
    const pack = environmentPackById("atlas-cavern");

    expect(pack?.materials.floor.albedo).toContain("stone-albedo");
    expect(pack?.landmarks[0]?.nodePrefix).toBe("WallRock_");
    expect(environmentPackAsset(pack!, "auto")?.quality).toBe("high");
    expect(environmentPackById("missing")).toBeUndefined();
  });

  it("keeps pack ids unique", () => {
    const ids = ENVIRONMENT_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses reduced quality for constrained devices in auto mode", () => {
    vi.stubGlobal("navigator", { deviceMemory: 4, hardwareConcurrency: 8 });
    expect(resolvedEnvironmentQuality("auto")).toBe("low");

    vi.stubGlobal("navigator", { deviceMemory: 8, hardwareConcurrency: 8 });
    expect(resolvedEnvironmentQuality("auto")).toBe("high");
    expect(resolvedEnvironmentQuality("low")).toBe("low");
  });
});
