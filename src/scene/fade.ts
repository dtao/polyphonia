import * as THREE from "three";

// Camera-centered radial visibility gradient. Two concentric circles around the
// viewer: an object is fully visible within RADIAL_FADE_INNER, fully gone beyond
// RADIAL_FADE_OUTER, and smoothly fades across the band between. Every per-object
// renderable that the three.js scene fog can't cleanly fade (additive glows,
// instanced meshes, point lights, tiled copies) routes its opacity through
// `radialFade` so nothing ever pops into existence on the horizon. See AGENTS.md
// "Radial fade" for the convention new objects must follow.
//
// Keep RADIAL_FADE_OUTER aligned with the scene fog's far distance
// (EnvironmentScene) so fog-respecting opaque geometry and manually faded objects
// disappear at the same circle.
export const RADIAL_FADE_INNER = 90;
export const RADIAL_FADE_OUTER = 130;

// Debug-mode runtime overrides. null = use the constants above.
// Call setDebugFadeRadii to adjust live; subscribeDebugFade to react to changes.
let _debugInner: number | null = null;
let _debugOuter: number | null = null;
const _fadeListeners = new Set<() => void>();

export function setDebugFadeRadii(inner: number | null, outer: number | null): void {
  _debugInner = inner;
  _debugOuter = outer;
  _fadeListeners.forEach((fn) => fn());
}

export function subscribeDebugFade(fn: () => void): () => void {
  _fadeListeners.add(fn);
  return () => { _fadeListeners.delete(fn); };
}

export function effectiveFadeInner(): number { return _debugInner ?? RADIAL_FADE_INNER; }
export function effectiveFadeOuter(): number { return _debugOuter ?? RADIAL_FADE_OUTER; }

// True once the debug sliders have moved off the defaults. Used to extend the
// per-object radial fade to renderables that normally don't distance-fade (base
// stem orbs on non-tiled maps), so the debug radius applies to *everything*.
export function isDebugFadeOverridden(): boolean {
  return _debugInner !== null || _debugOuter !== null;
}

// 1 (fully visible) .. 0 (invisible) for a distance from the viewer. Defaults to
// the canonical band; pass explicit bounds only for structural fades that are not
// per-object visibility (e.g. the tiling map-copy fade in Scene.tsx, which fades
// a whole map copy by its anchor distance and is coupled to the preview radius,
// not to this gradient).
export function radialFade(
  distance: number,
  inner = effectiveFadeInner(),
  outer = effectiveFadeOuter(),
): number {
  return 1 - THREE.MathUtils.smoothstep(distance, inner, outer);
}

// Convenience for the common planar (XZ) case: fade an object at world (x, z)
// relative to the viewer's planar position.
export function radialFadeAt(viewer: [number, number], x: number, z: number): number {
  return radialFade(Math.hypot(viewer[0] - x, viewer[1] - z));
}
