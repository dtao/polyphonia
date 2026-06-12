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

// Runtime overrides of the band, in priority order: debug sliders win over the
// per-composition radius (map.visibleRadius), which wins over the constants. null
// at a layer = defer to the next. Call the setters to adjust; subscribeDebugFade
// to react to changes (both layers share the one listener set).
let _debugInner: number | null = null;
let _debugOuter: number | null = null;
let _compInner: number | null = null;
let _compOuter: number | null = null;
// Optional vertical band (P29): when authored, objects also fade with their
// |Δy| from the viewer, independently of the horizontal circle. null = no
// vertical limit (the historical behavior — fades are purely planar).
let _compVerticalInner: number | null = null;
let _compVerticalOuter: number | null = null;
// The viewer's world y, written once per frame by FogSync so per-object fades
// (which often only have planar viewer coordinates) can compute Δy cheaply.
let _viewerY = 0;
const _fadeListeners = new Set<() => void>();

export function setDebugFadeRadii(inner: number | null, outer: number | null): void {
  _debugInner = inner;
  _debugOuter = outer;
  _fadeListeners.forEach((fn) => fn());
}

// Apply a composition's authored visible radius (or null to clear, inheriting the
// defaults). The active composition's map drives this from Scene; the debug
// sliders still take precedence so live tuning isn't fought by the saved value.
export function setCompositionFadeRadii(inner: number | null, outer: number | null): void {
  if (_compInner === inner && _compOuter === outer) return;
  _compInner = inner;
  _compOuter = outer;
  _fadeListeners.forEach((fn) => fn());
}

// Apply a composition's authored vertical visibility band (or nulls to clear —
// no vertical limit). Driven from Scene like setCompositionFadeRadii.
export function setCompositionVerticalFadeRadii(inner: number | null, outer: number | null): void {
  if (_compVerticalInner === inner && _compVerticalOuter === outer) return;
  _compVerticalInner = inner;
  _compVerticalOuter = outer;
  _fadeListeners.forEach((fn) => fn());
}

export function setFadeViewerY(y: number): void {
  _viewerY = y;
}

export function effectiveVerticalFadeInner(): number | null { return _compVerticalInner; }
export function effectiveVerticalFadeOuter(): number | null { return _compVerticalOuter; }

// 1 (fully visible) .. 0 (invisible) for an object's world y against the
// viewer's y. 1 when no vertical band is authored. Multiply with the planar
// radialFade — the bands are independent, so visibility is the product.
export function verticalFadeAtY(y: number): number {
  if (_compVerticalInner === null || _compVerticalOuter === null) return 1;
  return 1 - THREE.MathUtils.smoothstep(Math.abs(y - _viewerY), _compVerticalInner, _compVerticalOuter);
}

export function subscribeDebugFade(fn: () => void): () => void {
  _fadeListeners.add(fn);
  return () => { _fadeListeners.delete(fn); };
}

export function effectiveFadeInner(): number { return _debugInner ?? _compInner ?? RADIAL_FADE_INNER; }
export function effectiveFadeOuter(): number { return _debugOuter ?? _compOuter ?? RADIAL_FADE_OUTER; }

// True once the band has been overridden away from the constants — by the debug
// sliders or by a composition's authored radius. Used to extend the per-object
// radial fade to renderables that normally don't distance-fade (base stem orbs on
// non-tiled maps), so the active radius applies to *everything*.
export function isFadeRadiusOverridden(): boolean {
  return (
    _debugInner !== null ||
    _debugOuter !== null ||
    _compInner !== null ||
    _compOuter !== null ||
    _compVerticalInner !== null ||
    _compVerticalOuter !== null
  );
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
