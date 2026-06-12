import { describe, expect, it } from "vitest";
import { LIGHT_TIERS, LightCandidate, adaptLightTier, lightPriority, selectLights } from "./lightBudget";

function candidate(partial: Partial<LightCandidate> & { id: string }): LightCandidate {
  return { x: 0, y: 1, z: 0, color: "#fff", intensity: 6, range: 12, ...partial };
}

describe("light priority", () => {
  it("is full strength inside the light's range and falls off beyond it", () => {
    const near = lightPriority(candidate({ id: "a", x: 5 }), 0, 1, 0, 130);
    const inside = lightPriority(candidate({ id: "a", x: 11 }), 0, 1, 0, 130);
    const far = lightPriority(candidate({ id: "a", x: 48 }), 0, 1, 0, 130);
    expect(near).toBe(6);
    expect(inside).toBe(6);
    expect(far).toBeLessThan(1);
    expect(far).toBeGreaterThan(0);
  });

  it("is zero beyond the visibility cutoff and for dark lights", () => {
    expect(lightPriority(candidate({ id: "a", x: 140 }), 0, 1, 0, 130)).toBe(0);
    expect(lightPriority(candidate({ id: "a", intensity: 0 }), 0, 1, 0, 130)).toBe(0);
  });
});

describe("light selection", () => {
  it("keeps the strongest lights within budget, nearest-equivalent first", () => {
    const candidates = [
      candidate({ id: "far", x: 60 }),
      candidate({ id: "near", x: 4 }),
      candidate({ id: "mid", x: 25 }),
      candidate({ id: "out", x: 200 }),
    ];
    const chosen = selectLights(candidates, 0, 1, 0, 130, 2).map((entry) => entry.id);
    expect(chosen).toEqual(["near", "mid"]);
  });

  it("returns nothing on a zero budget and never includes cutoff lights", () => {
    const candidates = [candidate({ id: "near", x: 4 }), candidate({ id: "out", x: 200 })];
    expect(selectLights(candidates, 0, 1, 0, 130, 0)).toEqual([]);
    expect(selectLights(candidates, 0, 1, 0, 130, 8).map((entry) => entry.id)).toEqual(["near"]);
  });

  it("a louder distant light can outrank a quiet near one", () => {
    const candidates = [
      candidate({ id: "quiet", x: 3, intensity: 0.5 }),
      candidate({ id: "blast", x: 30, intensity: 50, range: 20 }),
    ];
    expect(selectLights(candidates, 0, 1, 0, 130, 1)[0].id).toBe("blast");
  });
});

describe("adaptive tier controller", () => {
  it("steps down under sustained low FPS, but only after the cooldown", () => {
    expect(adaptLightTier(0, 30, 100)).toBe(0); // too soon
    expect(adaptLightTier(0, 30, 2000)).toBe(1);
  });

  it("steps back up only after the longer recovery cooldown", () => {
    expect(adaptLightTier(2, 60, 2000)).toBe(2); // too soon
    expect(adaptLightTier(2, 60, 9000)).toBe(1);
  });

  it("holds in the hysteresis band and at the extremes", () => {
    expect(adaptLightTier(1, 50, 60000)).toBe(1); // between thresholds
    expect(adaptLightTier(LIGHT_TIERS.length - 1, 20, 60000)).toBe(LIGHT_TIERS.length - 1);
    expect(adaptLightTier(0, 60, 60000)).toBe(0);
  });

  it("can shed every light at the bottom tier", () => {
    expect(LIGHT_TIERS[LIGHT_TIERS.length - 1]).toBe(0);
  });
});
