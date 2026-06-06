import * as THREE from "three";

export const ENVIRONMENT_LOD_NEAR = 34;
export const ENVIRONMENT_LOD_FAR = 50;

export function environmentLodFade(
  distance: number,
  quality: "low" | "high",
  noLod: boolean,
): { near: number; far: number } {
  if (quality === "low") return { near: 0, far: 1 };
  if (noLod) return { near: 1, far: 0 };
  const far = THREE.MathUtils.smoothstep(distance, ENVIRONMENT_LOD_NEAR, ENVIRONMENT_LOD_FAR);
  return { near: 1 - far, far };
}
