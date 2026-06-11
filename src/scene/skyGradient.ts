import * as THREE from "three";

// Generated environments show a vertical sky gradient derived from the single
// authored sky color: a lighter shade of the same hue at the horizon rising to
// a darker shade at the zenith. The composer picks one color; both shades are
// derived so the mood control stays a single swatch.
//
// The HORIZON shade is the canonical "background" color: scene fog and the
// scene/AR background must use it (see EnvironmentScene's FogSync) so geometry
// fading out at the radial band dissolves into the sky exactly at eye level.
export function skyGradient(skyColor: string): { horizon: string; zenith: string } {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(skyColor).getHSL(hsl);
  const horizon = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.min(0.62, hsl.l * 1.5 + 0.13));
  const zenith = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l * 0.5);
  return { horizon: `#${horizon.getHexString()}`, zenith: `#${zenith.getHexString()}` };
}
