import * as THREE from "three";

const INSTANCE_FADE_ATTRIBUTE = "instanceFade";
export const ENVIRONMENT_INSTANCE_UPDATE_INTERVAL = 1 / 30;

export interface FadedInstancedMesh extends THREE.InstancedMesh {
  fadedGeometry: THREE.BufferGeometry;
  fadedMaterials: THREE.Material[];
  fadedShadowMaterials: THREE.Material[];
}

export function createFadedInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  capacity: number,
): FadedInstancedMesh {
  const fadedGeometry = geometry.clone();
  fadedGeometry.setAttribute(
    INSTANCE_FADE_ATTRIBUTE,
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  const fadedMaterials = (Array.isArray(material) ? material : [material]).map(fadedInstanceMaterial);
  const mesh = new THREE.InstancedMesh(
    fadedGeometry,
    Array.isArray(material) ? fadedMaterials : fadedMaterials[0],
    capacity,
  ) as FadedInstancedMesh;
  const depthMaterial = fadedInstanceMaterial(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
  );
  const distanceMaterial = fadedInstanceMaterial(new THREE.MeshDistanceMaterial());
  mesh.fadedGeometry = fadedGeometry;
  mesh.fadedMaterials = fadedMaterials;
  mesh.fadedShadowMaterials = [depthMaterial, distanceMaterial];
  mesh.customDepthMaterial = depthMaterial;
  mesh.customDistanceMaterial = distanceMaterial;
  mesh.count = 0;
  return mesh;
}

export function setInstanceFade(mesh: FadedInstancedMesh, index: number, fade: number): void {
  const attribute = mesh.geometry.getAttribute(INSTANCE_FADE_ATTRIBUTE) as THREE.InstancedBufferAttribute;
  attribute.setX(index, fade);
}

export function finishInstanceFadeUpdate(mesh: FadedInstancedMesh): void {
  const attribute = mesh.geometry.getAttribute(INSTANCE_FADE_ATTRIBUTE) as THREE.InstancedBufferAttribute;
  attribute.needsUpdate = true;
}

export function disposeFadedInstancedMesh(mesh: FadedInstancedMesh): void {
  mesh.dispose();
  mesh.fadedGeometry.dispose();
  for (const material of mesh.fadedMaterials) material.dispose();
  for (const material of mesh.fadedShadowMaterials) material.dispose();
}

function fadedInstanceMaterial(source: THREE.Material): THREE.Material {
  const material = source.clone();
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.alphaHash = true;
  material.transparent = false;
  material.depthWrite = true;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${INSTANCE_FADE_ATTRIBUTE};
varying float vInstanceFade;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vInstanceFade = ${INSTANCE_FADE_ATTRIBUTE};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vInstanceFade;`,
      )
      .replace(
        "#include <alphahash_fragment>",
        `diffuseColor.a *= vInstanceFade;
#include <alphahash_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}:instance-fade-v1`;
  material.needsUpdate = true;
  return material;
}
