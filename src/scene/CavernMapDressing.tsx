import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CompositionMap, MapPlatform, MapRoom, WalkableSegment } from "../map";
import { mapPointKey, platformElevation, roomElevation } from "../map";

const TEXTURES: string[] = [
  "/environments/atlas-cavern/textures/stone-albedo.webp",
  "/environments/atlas-cavern/textures/stone-normal.webp",
  "/environments/atlas-cavern/textures/stone-roughness.webp",
  "/environments/atlas-cavern/textures/stone-ao.webp",
];

export function CavernMapDressing({
  map,
  rockGeometry,
  editMode,
  quality,
}: {
  map: CompositionMap;
  rockGeometry: THREE.BufferGeometry;
  editMode: boolean;
  quality: "low" | "high";
}) {
  const material = useStoneMaterial(editMode);
  const rocks = useMemo(() => rockTransforms(map, quality), [map, quality]);

  return (
    <group>
      {map.segments.map((segment) => (
        <SegmentShell key={segment.id} map={map} segment={segment} material={material} />
      ))}
      {map.rooms.map((room) => (
        <RoomFloor key={room.id} map={map} room={room} material={material} />
      ))}
      {map.platforms.map((platform) => (
        <PlatformFloor key={platform.id} map={map} platform={platform} material={material} />
      ))}
      {map.walls.map((wall) => {
        const dx = wall.end[0] - wall.start[0];
        const dz = wall.end[1] - wall.start[1];
        const length = Math.hypot(dx, dz);
        return (
          <mesh
            key={wall.id}
            position={[(wall.start[0] + wall.end[0]) / 2, wall.height / 2, (wall.start[1] + wall.end[1]) / 2]}
            rotation={[0, Math.atan2(dx, dz), 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[wall.wallThickness ?? 0.3, wall.height, length]} />
            <primitive object={material} attach="material" />
          </mesh>
        );
      })}
      <RockInstances geometry={rockGeometry} material={material} transforms={rocks} quality={quality} />
    </group>
  );
}

function SegmentShell({
  map,
  segment,
  material,
}: {
  map: CompositionMap;
  segment: WalkableSegment;
  material: THREE.MeshStandardMaterial;
}) {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const planarLength = Math.hypot(dx, dz);
  if (planarLength < 0.01) return null;

  const startY = map.elevations?.[mapPointKey(segment.start)] ?? 0;
  const endY = map.elevations?.[mapPointKey(segment.end)] ?? 0;
  const rise = endY - startY;
  const length = Math.hypot(planarLength, rise);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(rise, planarLength);
  const position: [number, number, number] = [
    (segment.start[0] + segment.end[0]) / 2,
    (startY + endY) / 2 - 0.13,
    (segment.start[1] + segment.end[1]) / 2,
  ];
  const wallHeight = Math.max(map.wallHeight, 3.2);
  const tunnel = segment.kind === "tunnel";

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh rotation={[pitch, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[segment.width, 0.26, length]} />
        <primitive object={material} attach="material" />
      </mesh>
      {tunnel && (
        <>
          <mesh position={[-segment.width / 2, wallHeight / 2, 0]} rotation={[pitch, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.45, wallHeight, length]} />
            <primitive object={material} attach="material" />
          </mesh>
          <mesh position={[segment.width / 2, wallHeight / 2, 0]} rotation={[pitch, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.45, wallHeight, length]} />
            <primitive object={material} attach="material" />
          </mesh>
          <mesh position={[0, wallHeight, 0]} rotation={[pitch, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[segment.width + 0.8, 0.45, length]} />
            <primitive object={material} attach="material" />
          </mesh>
        </>
      )}
    </group>
  );
}

function RoomFloor({ map, room, material }: { map: CompositionMap; room: MapRoom; material: THREE.MeshStandardMaterial }) {
  return (
    <mesh
      position={[room.center[0], roomElevation(map, room) - 0.13, room.center[1]]}
      rotation={[0, room.rotation, 0]}
      receiveShadow
    >
      <boxGeometry args={[room.width, 0.26, room.depth]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function PlatformFloor({
  map,
  platform,
  material,
}: {
  map: CompositionMap;
  platform: MapPlatform;
  material: THREE.MeshStandardMaterial;
}) {
  const y = platformElevation(map, platform) - 0.13;
  if (platform.shape === "rect") {
    return (
      <mesh position={[platform.center[0], y, platform.center[1]]} rotation={[0, platform.rotation, 0]} receiveShadow>
        <boxGeometry args={[platform.width, 0.26, platform.depth]} />
        <primitive object={material} attach="material" />
      </mesh>
    );
  }

  return (
    <mesh position={[platform.center[0], y, platform.center[1]]} rotation={[0, platform.rotation, 0]} receiveShadow>
      <cylinderGeometry args={[platform.width / 2, platform.width / 2, 0.26, platform.shape === "hex" ? 6 : 48]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function RockInstances({
  geometry,
  material,
  transforms,
  quality,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  transforms: THREE.Matrix4[];
  quality: "low" | "high";
}) {
  const lowGeometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);
  const nearMesh = useMemo(() => emptyInstancedMesh(geometry, material, transforms.length), [geometry, material, transforms.length]);
  const farMesh = useMemo(() => emptyInstancedMesh(lowGeometry, material, transforms.length), [lowGeometry, material, transforms.length]);
  const lastUpdate = useRef(-Infinity);
  const position = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    nearMesh.castShadow = true;
    nearMesh.receiveShadow = true;
    farMesh.castShadow = false;
    farMesh.receiveShadow = true;
    return () => {
      nearMesh.dispose();
      farMesh.dispose();
    };
  }, [farMesh, nearMesh]);
  useEffect(() => () => lowGeometry.dispose(), [lowGeometry]);

  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastUpdate.current < 0.35) return;
    lastUpdate.current = clock.elapsedTime;
    let nearCount = 0;
    let farCount = 0;
    for (const matrix of transforms) {
      position.setFromMatrixPosition(matrix);
      const distance = position.distanceTo(camera.position);
      if (distance > 115) continue;
      if (quality === "high" && distance < 42) nearMesh.setMatrixAt(nearCount++, matrix);
      else farMesh.setMatrixAt(farCount++, matrix);
    }
    nearMesh.count = nearCount;
    farMesh.count = farCount;
    nearMesh.instanceMatrix.needsUpdate = true;
    farMesh.instanceMatrix.needsUpdate = true;
    nearMesh.computeBoundingSphere();
    farMesh.computeBoundingSphere();
  });

  return (
    <group>
      <primitive object={nearMesh} />
      <primitive object={farMesh} />
    </group>
  );
}

function emptyInstancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.count = 0;
  return mesh;
}

function useStoneMaterial(editMode: boolean): THREE.MeshStandardMaterial {
  const loaded = useTexture(TEXTURES) as THREE.Texture[];
  const textures = useMemo(
    () =>
      loaded.map((source, index) => {
        const texture = source.clone();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2.5, 2.5);
        if (index === 0) texture.colorSpace = THREE.SRGBColorSpace;
        if (index === 3) texture.channel = 0;
        texture.needsUpdate = true;
        return texture;
      }),
    [loaded],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: textures[0],
        normalMap: textures[1],
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughnessMap: textures[2],
        roughness: 0.92,
        aoMap: textures[3],
        aoMapIntensity: 0.75,
        metalness: 0.02,
        transparent: editMode,
        opacity: editMode ? 0.58 : 1,
        depthWrite: !editMode,
      }),
    [editMode, textures],
  );

  useEffect(
    () => () => {
      material.dispose();
      textures.forEach((texture) => texture.dispose());
    },
    [material, textures],
  );

  return material;
}

function rockTransforms(map: CompositionMap, quality: "low" | "high"): THREE.Matrix4[] {
  const transforms: THREE.Matrix4[] = [];
  for (const segment of map.segments) {
    if (segment.kind === "tunnel") continue;
    const dx = segment.end[0] - segment.start[0];
    const dz = segment.end[1] - segment.start[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const nx = -dz / length;
    const nz = dx / length;
    const count = Math.max(2, Math.floor(length / (quality === "high" ? 4.5 : 8)));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const x = segment.start[0] + dx * t;
      const z = segment.start[1] + dz * t;
      const startY = map.elevations?.[mapPointKey(segment.start)] ?? 0;
      const endY = map.elevations?.[mapPointKey(segment.end)] ?? 0;
      const y = THREE.MathUtils.lerp(startY, endY, t);
      for (const side of [-1, 1]) {
        const seed = hash(`${segment.id}:${index}:${side}`);
        const offset = segment.width / 2 + 0.7 + seeded(seed, 1) * 1.2;
        transforms.push(
          transform(
            [x + nx * offset * side, y + 0.35, z + nz * offset * side],
            [1.1 + seeded(seed, 2) * 1.5, 0.8 + seeded(seed, 3) * 1.8, 1 + seeded(seed, 4) * 1.3],
            seeded(seed, 5) * Math.PI,
          ),
        );
      }
    }
  }

  for (const room of map.rooms) {
    const y = roomElevation(map, room) + 0.4;
    const rockCount = quality === "high" ? 8 : 4;
    for (let index = 0; index < rockCount; index += 1) {
      const angle = (index / rockCount) * Math.PI * 2 + room.rotation;
      const radiusX = room.width / 2 + 0.8;
      const radiusZ = room.depth / 2 + 0.8;
      transforms.push(
        transform(
          [room.center[0] + Math.cos(angle) * radiusX, y, room.center[1] + Math.sin(angle) * radiusZ],
          [1.2, 1.5 + (index % 3) * 0.4, 1.2],
          angle,
        ),
      );
    }
  }

  return transforms;
}

function transform(position: [number, number, number], scale: [number, number, number], rotationY: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(...scale),
  );
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seeded(seed: number, salt: number): number {
  const value = Math.sin(seed * 0.0001 + salt * 91.713) * 43758.5453;
  return value - Math.floor(value);
}
