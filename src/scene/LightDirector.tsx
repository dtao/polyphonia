import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import * as THREE from "three";
import { arWalk, useStore, viewState } from "../store";
import { TrackDef } from "../composition";
import { CompositionMap, loopPreviewElevationOffset, tiledMapTransforms, transformLoopPoint } from "../map";
import { debugEnabled, debugFlag, debugValue } from "../debug";
import { effectiveFadeOuter, radialFade, verticalFadeAtY } from "./fade";
import { LIGHT_TIERS, LightCandidate, adaptLightTier, selectLights } from "./lightBudget";

// One light pool for the whole scene. Stems no longer own point lights;
// instead every stem (and, on tiled maps, its nearest repeated copy) is a
// light *candidate*, and a fixed pool of real lights is assigned each frame
// to the highest-priority candidates (see lightBudget.ts). This bounds the
// per-fragment lighting cost regardless of how many stems a composition has
// or how much surface a generated world adds, and an FPS-driven controller
// shrinks the pool further (down to zero) when the frame budget is blown.
//
// The pool size only changes on tier transitions, so shader programs stay
// stable frame-to-frame; slot handoffs damp intensity so lights never pop.

const TILE_PREVIEW_RADIUS = 180;
const FPS_EMA_ALPHA = 0.05;

export function LightDirector() {
  const tracks = useStore((s) => s.composition.tracks);
  const map = useStore((s) => s.composition.map);
  const engine = useStore((s) => s.engine);
  const [tier, setTier] = useState(0);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const slotIds = useRef<(string | null)[]>([]);
  const pulses = useRef(new Map<string, number>());
  const fpsEma = useRef(60);
  const tierChangedAt = useRef(0);
  const lastDebugLog = useRef(-Infinity);

  const forced = forcedBudget();
  const poolSize = debugFlag("debugNoPointLights") ? 0 : forced ?? LIGHT_TIERS[tier];

  useFrame(({ camera, clock }, dt) => {
    // Smoothed frame rate drives the adaptive tier (skip while a debug
    // override pins the budget).
    if (dt > 0 && dt < 0.5) {
      fpsEma.current += (1 / dt - fpsEma.current) * FPS_EMA_ALPHA;
    }
    if (forced === undefined) {
      const now = performance.now();
      if (tierChangedAt.current === 0) tierChangedAt.current = now;
      const next = adaptLightTier(tier, fpsEma.current, now - tierChangedAt.current);
      if (next !== tier) {
        tierChangedAt.current = now;
        setTier(next);
      }
    }

    const listener: [number, number] = arWalk.active
      ? [viewState.x, viewState.z]
      : [camera.position.x, camera.position.z];
    const selectedId = useStore.getState().selectedId;
    const candidates = gatherCandidates(tracks, map, listener, selectedId, (id) => {
      const level = engine?.level(id) ?? 0;
      const pulse = THREE.MathUtils.damp(pulses.current.get(id) ?? 0, level, 14, dt);
      pulses.current.set(id, pulse);
      return pulse;
    });
    const chosen = selectLights(
      candidates,
      camera.position.x,
      camera.position.y,
      camera.position.z,
      effectiveFadeOuter(),
      poolSize,
    );

    // Stable slot assignment: candidates keep their slot while selected;
    // freed slots take the newcomers. Handoffs restart from zero intensity
    // and damp up, so a reassigned light never pops.
    const byId = new Map(chosen.map((candidate) => [candidate.id, candidate]));
    const claimed = new Set<string>();
    for (let i = 0; i < poolSize; i++) {
      const id = slotIds.current[i];
      if (id && byId.has(id)) claimed.add(id);
      else slotIds.current[i] = null;
    }
    const incoming = chosen.filter((candidate) => !claimed.has(candidate.id));
    for (let i = 0; i < poolSize && incoming.length; i++) {
      if (slotIds.current[i] === null) {
        const candidate = incoming.shift()!;
        slotIds.current[i] = candidate.id;
        const light = lights.current[i];
        if (light) light.intensity = 0;
      }
    }

    for (let i = 0; i < poolSize; i++) {
      const light = lights.current[i];
      if (!light) continue;
      const candidate = slotIds.current[i] ? byId.get(slotIds.current[i]!) : undefined;
      if (candidate) {
        light.position.set(candidate.x, candidate.y, candidate.z);
        light.color.set(candidate.color);
        light.distance = candidate.range;
        light.intensity = THREE.MathUtils.damp(light.intensity, candidate.intensity, 10, dt);
      } else {
        light.intensity = THREE.MathUtils.damp(light.intensity, 0, 10, dt);
      }
    }

    if (debugEnabled() && clock.elapsedTime - lastDebugLog.current > 1) {
      lastDebugLog.current = clock.elapsedTime;
      const round = (n: number) => Math.round(n * 100) / 100;
      const planarDist = (c: LightCandidate) => Math.hypot(listener[0] - c.x, listener[1] - c.z);
      let nearest: LightCandidate | null = null;
      let nearestDist = Infinity;
      for (const c of candidates) {
        const d = planarDist(c);
        if (d < nearestDist) { nearestDist = d; nearest = c; }
      }
      (window as unknown as { polyLights?: unknown }).polyLights = {
        fps: Math.round(fpsEma.current),
        tier,
        poolSize,
        candidates: candidates.length,
        active: chosen.length,
        listener: [round(listener[0]), round(camera.position.y), round(listener[1])],
        cutoff: round(effectiveFadeOuter()),
        nearest: nearest
          ? { id: nearest.id, dist: round(nearestDist), intensity: round(nearest.intensity), y: round(nearest.y), range: round(nearest.range) }
          : null,
        chosen: chosen.map((c) => ({ id: c.id, dist: round(planarDist(c)), intensity: round(c.intensity), y: round(c.y) })),
      };
    }
  });

  return (
    <group>
      {Array.from({ length: poolSize }, (_, i) => (
        <pointLight
          key={i}
          ref={(light) => (lights.current[i] = light)}
          intensity={0}
          distance={14}
        />
      ))}
    </group>
  );
}

// Dev override: ?lightBudget=N pins the pool size for testing.
function forcedBudget(): number | undefined {
  const raw = debugValue("lightBudget");
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 32)) : undefined;
}

// One candidate per stem at its base position plus, on tiled maps, one at its
// nearest repeated copy (so the room beyond a seam lights up as you approach,
// matching the old echo-light behavior). Intensity formulas mirror what the
// per-marker lights used, scaled by the radial fade so a light dims before
// the cutoff drops it.
function gatherCandidates(
  tracks: TrackDef[],
  map: CompositionMap,
  listener: [number, number],
  selectedId: string | null,
  pulseFor: (id: string) => number,
): LightCandidate[] {
  const previews = map.tiling.type !== "none" ? tiledMapTransforms(map, listener, TILE_PREVIEW_RADIUS) : [];
  const candidates: LightCandidate[] = [];
  for (const track of tracks) {
    const pulse = pulseFor(track.id);
    const volume = track.volume ?? 1;
    const orb = !track.stemShape || track.stemShape.kind === "orb";
    const intensity = orb
      ? (track.id === selectedId ? 8 : 4.8) + volume * 3.2 + pulse * 44
      : 1.5 + volume * 1.2 + pulse * 12;
    const range = orb ? 12 + volume * 8 + pulse * 16 : 7 + volume * 3 + pulse * 7;

    const baseFade = radialFade(Math.hypot(listener[0] - track.position[0], listener[1] - track.position[2])) * verticalFadeAtY(track.position[1]);
    if (baseFade > 0.002) {
      candidates.push({
        id: track.id,
        x: track.position[0],
        y: track.position[1],
        z: track.position[2],
        color: track.color,
        intensity: intensity * baseFade,
        range,
      });
    }

    if (previews.length) {
      let nearestSq = Infinity;
      let nearest: [number, number, number] | null = null;
      for (const preview of previews) {
        const [px, pz] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        const distSq = (listener[0] - px) ** 2 + (listener[1] - pz) ** 2;
        if (distSq < nearestSq) {
          nearestSq = distSq;
          nearest = [px, track.position[1] + loopPreviewElevationOffset(map, preview), pz];
        }
      }
      const copyFade = nearest ? radialFade(Math.sqrt(nearestSq)) * verticalFadeAtY(nearest[1]) : 0;
      if (nearest && copyFade > 0.002) {
        candidates.push({
          id: `${track.id}:copy`,
          x: nearest[0],
          y: nearest[1],
          z: nearest[2],
          color: track.color,
          intensity: intensity * copyFade,
          range,
        });
      }
    }
  }
  return candidates;
}
