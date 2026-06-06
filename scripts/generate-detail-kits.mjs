import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
}

globalThis.FileReader = NodeFileReader;

await writePack("verdant-grove", forestScene());
await writePack("prismatic-reach", crystalScene());

function forestScene() {
  const scene = new THREE.Scene();
  scene.name = "VerdantGrove";
  const bark = new THREE.MeshStandardMaterial({ name: "GroveBark", color: "#3e3226", roughness: 1 });
  const foliage = new THREE.MeshStandardMaterial({ name: "GroveFoliage", color: "#41623b", roughness: 0.92 });
  const treeGeometry = mergeGeometries([
    transformed(new THREE.CylinderGeometry(0.34, 0.52, 5.2, 8), [0, 2.6, 0], [1, 1, 1]),
    transformed(new THREE.ConeGeometry(2.1, 4.4, 9), [0, 5.1, 0], [1, 1, 1]),
    transformed(new THREE.ConeGeometry(1.65, 3.8, 9), [0, 7.0, 0], [1, 1, 1]),
  ], true);
  const tree = new THREE.Mesh(treeGeometry, [bark, foliage, foliage]);
  tree.name = "Tree_00";
  scene.add(tree);

  for (let index = 0; index < 22; index += 1) {
    const clone = tree.clone();
    clone.name = `LandmarkTree_${String(index).padStart(2, "0")}`;
    const angle = (index / 22) * Math.PI * 2;
    const radius = 19 + seeded(index, 1) * 10;
    clone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    clone.scale.setScalar(0.7 + seeded(index, 2) * 0.75);
    clone.rotation.y = seeded(index, 3) * Math.PI;
    scene.add(clone);
  }
  return scene;
}

function crystalScene() {
  const scene = new THREE.Scene();
  scene.name = "PrismaticReach";
  const crystal = new THREE.MeshStandardMaterial({
    name: "PrismaticCrystal",
    color: "#73a6c8",
    emissive: "#274f80",
    emissiveIntensity: 0.65,
    roughness: 0.28,
    metalness: 0.18,
  });
  const shard = new THREE.ConeGeometry(0.85, 4.8, 6);
  const clusterGeometry = mergeGeometries([
    transformed(shard, [0, 2.3, 0], [1, 1, 1], [0, 0.1, 0.04]),
    transformed(shard, [1.05, 1.65, 0.3], [0.62, 0.72, 0.62], [0.08, -0.35, -0.18]),
    transformed(shard, [-0.9, 1.35, -0.25], [0.48, 0.58, 0.48], [-0.12, 0.45, 0.22]),
  ]);
  const cluster = new THREE.Mesh(clusterGeometry, crystal);
  cluster.name = "CrystalCluster_00";
  scene.add(cluster);

  for (let index = 0; index < 26; index += 1) {
    const clone = cluster.clone();
    clone.name = `LandmarkCrystal_${String(index).padStart(2, "0")}`;
    const angle = (index / 26) * Math.PI * 2;
    const radius = 14 + seeded(index, 4) * 16;
    clone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    clone.scale.setScalar(0.55 + seeded(index, 5) * 1.1);
    clone.rotation.y = seeded(index, 6) * Math.PI;
    scene.add(clone);
  }
  return scene;
}

function transformed(geometry, position, scale, rotation = [0, 0, 0]) {
  const result = geometry.clone();
  result.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    ),
  );
  return result;
}

async function writePack(id, scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  const exporter = new GLTFExporter();
  const output = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, truncateDrawRange: true });
  const directory = new URL(`../public/environments/${id}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`${id}-kit.glb`, directory), Buffer.from(output));
}

function seeded(index, salt) {
  const value = Math.sin(index * 91.713 + salt * 17.17) * 43758.5453;
  return value - Math.floor(value);
}
