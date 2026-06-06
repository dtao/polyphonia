import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

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

const scene = new THREE.Scene();
scene.name = "AtlasCavern";

const stone = new THREE.MeshStandardMaterial({
  name: "AtlasStone",
  color: "#4d4645",
  roughness: 0.93,
  metalness: 0.02,
});
const darkStone = new THREE.MeshStandardMaterial({
  name: "AtlasStoneDark",
  color: "#272326",
  roughness: 0.98,
});
const mineral = new THREE.MeshStandardMaterial({
  name: "AtlasMineral",
  color: "#527b89",
  emissive: "#173b49",
  emissiveIntensity: 0.75,
  roughness: 0.3,
  metalness: 0.08,
});

const rockGeometry = new THREE.DodecahedronGeometry(1, 1);
const spikeGeometry = new THREE.ConeGeometry(1, 4, 7);
const columnGeometry = new THREE.CylinderGeometry(0.8, 1.25, 5, 9);
const crystalGeometry = new THREE.OctahedronGeometry(1, 0);

function seeded(index, salt = 0) {
  const x = Math.sin(index * 91.713 + salt * 17.17) * 43758.5453;
  return x - Math.floor(x);
}

for (let i = 0; i < 46; i += 1) {
  const angle = (i / 46) * Math.PI * 2;
  const radius = 25 + seeded(i, 1) * 5;
  const rock = new THREE.Mesh(rockGeometry, i % 4 === 0 ? darkStone : stone);
  rock.name = `WallRock_${String(i).padStart(2, "0")}`;
  rock.position.set(Math.cos(angle) * radius, 2.4 + seeded(i, 2) * 3, Math.sin(angle) * radius);
  rock.scale.set(3.4 + seeded(i, 3) * 3.4, 3.2 + seeded(i, 4) * 4.8, 2.6 + seeded(i, 5) * 3);
  rock.rotation.set(seeded(i, 6), -angle, seeded(i, 7));
  scene.add(rock);
}

for (let i = 0; i < 22; i += 1) {
  const angle = (i / 22) * Math.PI * 2 + 0.12;
  const radius = 8 + seeded(i, 8) * 15;
  const spike = new THREE.Mesh(spikeGeometry, i % 3 === 0 ? darkStone : stone);
  spike.name = `Stalactite_${String(i).padStart(2, "0")}`;
  spike.position.set(Math.cos(angle) * radius, 9.5 + seeded(i, 9) * 2, Math.sin(angle) * radius);
  spike.scale.set(0.55 + seeded(i, 10), 0.75 + seeded(i, 11) * 1.25, 0.55 + seeded(i, 12));
  spike.rotation.z = Math.PI;
  scene.add(spike);
}

for (let i = 0; i < 9; i += 1) {
  const angle = (i / 9) * Math.PI * 2;
  const column = new THREE.Mesh(columnGeometry, stone);
  column.name = `Column_${String(i).padStart(2, "0")}`;
  column.position.set(Math.cos(angle) * 18, 2.5, Math.sin(angle) * 18);
  column.scale.set(0.8 + seeded(i, 13) * 0.8, 1.2 + seeded(i, 14) * 0.7, 0.8 + seeded(i, 15) * 0.8);
  column.rotation.y = seeded(i, 16) * Math.PI;
  scene.add(column);
}

for (let i = 0; i < 12; i += 1) {
  const angle = (i / 12) * Math.PI * 2 + 0.25;
  const crystal = new THREE.Mesh(crystalGeometry, mineral);
  crystal.name = `Mineral_${String(i).padStart(2, "0")}`;
  crystal.position.set(Math.cos(angle) * (12 + seeded(i, 17) * 8), 0.8 + seeded(i, 18), Math.sin(angle) * (12 + seeded(i, 17) * 8));
  crystal.scale.set(0.35 + seeded(i, 19) * 0.65, 1.2 + seeded(i, 20) * 1.8, 0.35 + seeded(i, 21) * 0.65);
  crystal.rotation.set(seeded(i, 22) * 0.3, seeded(i, 23) * Math.PI, seeded(i, 24) * 0.25);
  scene.add(crystal);
}

scene.traverse((object) => {
  if (object instanceof THREE.Mesh) {
    object.castShadow = true;
    object.receiveShadow = true;
  }
});

const exporter = new GLTFExporter();
const output = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: true,
  truncateDrawRange: true,
});

const directory = new URL("../public/environments/atlas-cavern/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("cavern-kit.glb", directory), Buffer.from(output));
