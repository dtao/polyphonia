import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_LOD_FAR,
  ENVIRONMENT_LOD_NEAR,
  environmentLodFade,
} from "./environmentLod";

describe("environmentLodFade", () => {
  it("crossfades high-detail and proxy geometry across an overlap band", () => {
    expect(environmentLodFade(ENVIRONMENT_LOD_NEAR - 1, "high", false)).toEqual({ near: 1, far: 0 });
    expect(environmentLodFade(ENVIRONMENT_LOD_FAR + 1, "high", false)).toEqual({ near: 0, far: 1 });

    const middle = environmentLodFade((ENVIRONMENT_LOD_NEAR + ENVIRONMENT_LOD_FAR) / 2, "high", false);
    expect(middle.near).toBeCloseTo(0.5);
    expect(middle.far).toBeCloseTo(0.5);
  });

  it("preserves low-quality and no-LOD modes", () => {
    expect(environmentLodFade(10, "low", false)).toEqual({ near: 0, far: 1 });
    expect(environmentLodFade(100, "high", true)).toEqual({ near: 1, far: 0 });
  });
});
