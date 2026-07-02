import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { flatHeading, renderTranslationFor, rotateFlat, worldYawFor } from "./vrExplore";

// The VR session rotates/offsets the world group (rotation.y = worldYaw,
// position = renderTranslationFor) instead of moving the XR camera. These
// tests lock the sign conventions against real three.js transforms so the
// session math can't silently drift from what the scene group actually does.

function groupMatrix(yaw: number, translation: [number, number, number]): THREE.Matrix4 {
  const group = new THREE.Object3D();
  group.rotation.set(0, yaw, 0);
  group.position.set(...translation);
  group.updateMatrixWorld(true);
  return group.matrixWorld;
}

describe("rotateFlat", () => {
  it("adds the angle to a vector's heading and preserves length", () => {
    const cases: Array<[number, number, number]> = [
      [1, 0, Math.PI / 2],
      [0.3, -0.9, 1.234],
      [-2, 5, -2.5],
      [0.577, 0.577, 0],
    ];
    for (const [x, z, angle] of cases) {
      const [rx, rz] = rotateFlat(x, z, angle);
      const heading = flatHeading(rx, rz);
      const expected = flatHeading(x, z) + angle;
      expect(Math.atan2(Math.sin(heading - expected), Math.cos(heading - expected))).toBeCloseTo(0, 10);
      expect(Math.hypot(rx, rz)).toBeCloseTo(Math.hypot(x, z), 10);
    }
  });
});

describe("worldYawFor + world group rotation", () => {
  it("maps physical directions to virtual ones, and the rotated group shows them back along the physical direction", () => {
    // The user physically faces `physical`; the composition start faces
    // `virtual`. worldYaw must satisfy both directions of the mapping.
    const physical: [number, number] = [Math.SQRT1_2, -Math.SQRT1_2];
    const virtual: [number, number] = [-0.6, 0.8];
    const yaw = worldYawFor(flatHeading(virtual[0], virtual[1]), flatHeading(physical[0], physical[1]));

    // Physical → virtual: rotateFlat(+yaw).
    const [vx, vz] = rotateFlat(physical[0], physical[1], yaw);
    expect(vx).toBeCloseTo(virtual[0], 10);
    expect(vz).toBeCloseTo(virtual[1], 10);

    // Virtual → rendered: a three group with rotation.y = yaw renders the
    // virtual facing direction along the user's physical facing direction.
    const rendered = new THREE.Vector3(virtual[0], 0, virtual[1]).applyMatrix4(groupMatrix(yaw, [0, 0, 0]));
    expect(rendered.x).toBeCloseTo(physical[0], 10);
    expect(rendered.z).toBeCloseTo(physical[1], 10);
  });
});

describe("renderTranslationFor", () => {
  it("places the virtual eye exactly at the physical anchor under the group transform", () => {
    const eye = new THREE.Vector3(12.5, 4.7, -8.25); // viewState eye, world units
    const anchor = new THREE.Vector3(0.31, 1.62, -0.08); // physical head, meters
    const yaw = 2.1;
    const t = renderTranslationFor(eye.x, eye.y, eye.z, anchor.x, anchor.y, anchor.z, yaw);
    const rendered = eye.clone().applyMatrix4(groupMatrix(yaw, t));
    expect(rendered.x).toBeCloseTo(anchor.x, 10);
    expect(rendered.y).toBeCloseTo(anchor.y, 10);
    expect(rendered.z).toBeCloseTo(anchor.z, 10);
  });

  it("keeps physical head motion 1:1: a fixed transform renders nearby virtual points rigidly", () => {
    // With the translation held (the head is the anchor), a virtual point 2
    // units in front of the eye stays 2 meters from the head — no scaling.
    const eye = new THREE.Vector3(3, 1.7, 9);
    const anchor = new THREE.Vector3(0, 1.6, 0);
    const yaw = -0.7;
    const t = renderTranslationFor(eye.x, eye.y, eye.z, anchor.x, anchor.y, anchor.z, yaw);
    const m = groupMatrix(yaw, t);
    const ahead = eye.clone().add(new THREE.Vector3(0, 0, -2)).applyMatrix4(m);
    expect(ahead.distanceTo(anchor)).toBeCloseTo(2, 10);
  });
});
