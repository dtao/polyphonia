import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { defaultMap } from "../map";
import { environmentInstanceBatches } from "./environmentInstances";

describe("environmentInstanceBatches", () => {
  it("repeats authored fallback objects with tile transforms", () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const visible = new THREE.Mesh(geometry, material);
    visible.position.set(4, 1, -3);
    scene.add(visible);

    const batches = environmentInstanceBatches(scene, defaultMap, [
      { id: "square:1:0", anchor: [20, 0], source: [0, 0], rotation: 0 },
    ]);
    const positions = batches[0].matrices.map((matrix) => new THREE.Vector3().setFromMatrixPosition(matrix));

    expect(positions).toHaveLength(2);
    expect(positions[0].toArray()).toEqual([4, 1, -3]);
    expect(positions[1].toArray()).toEqual([24, 1, -3]);
  });

  it("omits hidden source geometry from the repeated arrangement", () => {
    const scene = new THREE.Group();
    const source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    source.position.y = -1000;
    scene.add(source);

    expect(environmentInstanceBatches(scene, defaultMap, [])).toEqual([]);
  });
});
