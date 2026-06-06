import * as THREE from "three";
import type { CompositionMap, LoopPreviewTransform } from "../map";
import { loopPreviewElevationOffset } from "../map";

export interface EnvironmentInstanceBatch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrices: THREE.Matrix4[];
}

// Convert the authored fallback scene into a small set of instanced batches.
// Pack assets keep one hidden source mesh below the world as a geometry
// template; it should not become part of the visible repeated arrangement.
export function environmentInstanceBatches(
  scene: THREE.Object3D,
  map: CompositionMap,
  previews: LoopPreviewTransform[],
): EnvironmentInstanceBatch[] {
  scene.updateMatrixWorld(true);
  const batches = new Map<string, EnvironmentInstanceBatch>();
  const position = new THREE.Vector3();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    position.setFromMatrixPosition(object.matrixWorld);
    if (position.y < -500) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const key = `${object.geometry.uuid}:${materials.map((material) => material.uuid).join(",")}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { geometry: object.geometry, material: object.material, matrices: [] };
      batches.set(key, batch);
    }

    batch.matrices.push(object.matrixWorld.clone());
    for (const preview of previews) {
      batch.matrices.push(previewMatrix(map, preview).multiply(object.matrixWorld));
    }
  });

  return [...batches.values()];
}

function previewMatrix(map: CompositionMap, preview: LoopPreviewTransform): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(preview.anchor[0], loopPreviewElevationOffset(map, preview), preview.anchor[1])
    .multiply(new THREE.Matrix4().makeRotationY(preview.rotation))
    .multiply(new THREE.Matrix4().makeTranslation(-preview.source[0], 0, -preview.source[1]));
}
