// Point-light budgeting: which lights deserve one of the limited slots, and
// how many slots the frame budget can afford.
//
// Three.js forward rendering evaluates EVERY visible light on every lit
// fragment, so the cost of point lights is (light count) × (lit surface
// area). Generated terrain made the lit surface effectively the whole screen,
// so light count must be bounded for performance to scale with map size.
// The director (LightDirector.tsx) therefore owns a small pool of real
// lights and assigns them per frame to the highest-priority light *sources*;
// everything here is the pure logic so it can be unit tested.
//
// Two mechanisms combine:
//  - Priority selection: each candidate scores by its perceived contribution
//    at the camera — full strength inside the light's range, falling with
//    the square of the distance beyond it, and zero past the radial-fade
//    cutoff (surfaces there are fogged out, so lighting them is wasted).
//  - An adaptive budget: a smoothed-FPS controller steps the pool size down
//    through LIGHT_TIERS when the frame rate sags and back up when it
//    recovers, with hysteresis and cooldowns so it never thrashes (each pool
//    resize means a one-off shader program switch).

export interface LightCandidate {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  /** Target intensity right now (audio-pulsing). */
  intensity: number;
  /** PointLight.distance — the light's reach. */
  range: number;
}

/** Pool sizes the adaptive controller steps through (index = tier). */
export const LIGHT_TIERS = [16, 12, 8, 5, 3, 0] as const;

/** Step down when smoothed FPS sits below this. */
const FPS_LOW = 42;
/** Step back up only when smoothed FPS sits above this (hysteresis gap). */
const FPS_HIGH = 56;
/** Minimum ms between downward steps (lets the change take effect first). */
const DOWN_COOLDOWN_MS = 1500;
/** Minimum ms before trying to climb back up (avoid oscillation). */
const UP_COOLDOWN_MS = 8000;

/**
 * Perceived contribution of a candidate for a camera at (camX, camY, camZ).
 * Zero beyond `cutoff` (the radial-fade outer radius: geometry there has
 * dissolved into fog, so its lighting cannot be seen).
 */
export function lightPriority(
  candidate: Pick<LightCandidate, "x" | "y" | "z" | "intensity" | "range">,
  camX: number,
  camY: number,
  camZ: number,
  cutoff: number,
): number {
  if (candidate.intensity <= 0.001) return 0;
  const distance = Math.hypot(candidate.x - camX, candidate.y - camY, candidate.z - camZ);
  if (distance > cutoff) return 0;
  const reach = Math.max(candidate.range, 1);
  const attenuation = distance <= reach ? 1 : (reach / distance) * (reach / distance);
  return candidate.intensity * attenuation;
}

/** The `budget` highest-priority candidates, strongest first. */
export function selectLights(
  candidates: LightCandidate[],
  camX: number,
  camY: number,
  camZ: number,
  cutoff: number,
  budget: number,
): LightCandidate[] {
  if (budget <= 0) return [];
  return candidates
    .map((candidate) => ({ candidate, priority: lightPriority(candidate, camX, camY, camZ, cutoff) }))
    .filter((entry) => entry.priority > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, budget)
    .map((entry) => entry.candidate);
}

/**
 * Adaptive tier step. Returns the next tier index given the smoothed FPS and
 * how long the current tier has been active. Tier indexes grow as budgets
 * shrink; the last tier is 0 lights.
 */
export function adaptLightTier(tierIndex: number, smoothedFps: number, msSinceChange: number): number {
  if (smoothedFps < FPS_LOW && msSinceChange >= DOWN_COOLDOWN_MS && tierIndex < LIGHT_TIERS.length - 1) {
    return tierIndex + 1;
  }
  if (smoothedFps > FPS_HIGH && msSinceChange >= UP_COOLDOWN_MS && tierIndex > 0) {
    return tierIndex - 1;
  }
  return tierIndex;
}
