import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createFadedInstancedMesh,
  disposeFadedInstancedMesh,
  finishInstanceFadeUpdate,
  setInstanceFade,
} from "./fadedInstances";

describe("faded instanced meshes", () => {
  it("stores per-instance opacity without changing the instance transform", () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const mesh = createFadedInstancedMesh(geometry, material, 2);
    const matrix = new THREE.Matrix4().makeScale(3, 4, 5);

    mesh.setMatrixAt(0, matrix);
    setInstanceFade(mesh, 0, 0.25);
    finishInstanceFadeUpdate(mesh);

    const stored = new THREE.Matrix4();
    mesh.getMatrixAt(0, stored);
    expect(stored.elements).toEqual(matrix.elements);
    expect(mesh.geometry.getAttribute("instanceFade").getX(0)).toBe(0.25);
    expect((mesh.material as THREE.Material).alphaHash).toBe(true);
    expect(mesh.customDepthMaterial?.alphaHash).toBe(true);
    expect(mesh.customDistanceMaterial?.alphaHash).toBe(true);

    disposeFadedInstancedMesh(mesh);
    geometry.dispose();
    material.dispose();
  });
});
