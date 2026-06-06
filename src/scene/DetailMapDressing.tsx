import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CompositionMap, MapPlatform, MapRoom, WalkableSegment } from "../map";
import {
  isPointInsideMap,
  loopPreviewElevationOffset,
  mapPointKey,
  platformElevation,
  roomElevation,
  tiledMapTransforms,
  transformLoopPoint,
} from "../map";
import { arWalk, viewState } from "../store";

type DetailProfile = "cavern" | "forest" | "crystal";

interface DetailPlacement {
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
}

// How far out (in world units) adjacent loop copies receive the textured floor
// shells and dressing. Kept near the full-opacity band of the reactive floor
// copies (which fade ~85–180); beyond it the copies are already fading, so the
// plainer reactive-only floor reads fine and we save the extra draw calls.
const DETAIL_TILE_RADIUS = 92;

export function DetailMapDressing({
  map,
  detailGeometry,
  profile,
  editMode,
  quality,
}: {
  map: CompositionMap;
  detailGeometry: THREE.BufferGeometry;
  profile: DetailProfile;
  editMode: boolean;
  quality: "low" | "high";
}) {
  const material = usePackMaterial(profile, editMode);
  const placements = useMemo(() => detailPlacements(map, quality, profile), [map, quality, profile]);
  const camera = useThree((s) => s.camera);

  // Adjacent tile copies of the textured floor/dressing keep the loop boundary
  // from looking dull then snapping detailed as you cross it. Only in explore
  // mode (edit shows the single authoring tile) and only on tiled maps.
  const tiled = !editMode && map.tiling.type !== "none";
  const [viewer, setViewer] = useState<[number, number]>([0, 0]);
  useFrame(() => {
    if (!tiled) return;
    const next: [number, number] = arWalk.active ? [viewState.x, viewState.z] : [camera.position.x, camera.position.z];
    // Coarser threshold than the reactive floor (detail copies are heavier):
    // only resample once the listener has moved a couple of units.
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > 1.5 ? next : current));
  });
  const previews = useMemo(
    () => (tiled ? tiledMapTransforms(map, viewer, DETAIL_TILE_RADIUS) : []),
    [tiled, map, viewer],
  );

  const detailMatrices = useMemo(() => {
    const matrices = placements.map((p) => transform(p.position, p.scale, p.rotationY));
    for (const preview of previews) {
      const lift = loopPreviewElevationOffset(map, preview);
      for (const p of placements) {
        const [tx, tz] = transformLoopPoint(preview, [p.position[0], p.position[2]]);
        matrices.push(transform([tx, p.position[1] + lift, tz], p.scale, p.rotationY + preview.rotation));
      }
    }
    return matrices;
  }, [placements, previews, map]);

  return (
    <group>
      <MapShell map={map} material={material} />
      {previews.map((preview) => (
        <group
          key={preview.id}
          position={[preview.anchor[0], loopPreviewElevationOffset(map, preview), preview.anchor[1]]}
          rotation={[0, preview.rotation, 0]}
        >
          <group position={[-preview.source[0], 0, -preview.source[1]]}>
            <MapShell map={map} material={material} />
          </group>
        </group>
      ))}
      <DetailInstances geometry={detailGeometry} material={material} transforms={detailMatrices} quality={quality} profile={profile} />
    </group>
  );
}

// The static textured shells (floor slabs, walls) for one copy of the map.
function MapShell({ map, material }: { map: CompositionMap; material: THREE.MeshStandardMaterial }) {
  return (
    <group>
      {map.segments.length === 0 && map.rooms.length === 0 && map.platforms.length === 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, 0]} receiveShadow>
          <circleGeometry args={[56, 96]} />
          <primitive object={material} attach="material" />
        </mesh>
      )}
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
  // The slab is 0.26 thick. Centering it at elevation - 0.10 puts its textured
  // top at elevation + 0.03 — just proud of the reactive PathMaterial floor
  // (which sits exactly at elevation) so the texture wins the depth test instead
  // of z-fighting it (flush tops flicker between texture and plain color). The
  // 0.03 lift stays below the edge rails (elevation + 0.045); the reactive floor
  // still shows through at joints/connectors the per-segment slabs don't cover.
  const position: [number, number, number] = [
    (segment.start[0] + segment.end[0]) / 2,
    (startY + endY) / 2 - 0.1,
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

function DetailInstances({
  geometry,
  material,
  transforms,
  quality,
  profile,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  transforms: THREE.Matrix4[];
  quality: "low" | "high";
  profile: DetailProfile;
}) {
  const lowGeometry = useMemo(() => lowDetailGeometry(profile), [profile]);
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

function usePackMaterial(profile: DetailProfile, editMode: boolean): THREE.MeshStandardMaterial {
  const config = PROFILE_CONFIG[profile];
  const loaded = useTexture(config.textures) as THREE.Texture[];
  const textures = useMemo(
    () =>
      loaded.map((source, index) => {
        const texture = source.clone();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(config.repeat, config.repeat);
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
        roughness: config.roughness,
        aoMap: textures[3],
        aoMapIntensity: config.ao,
        metalness: config.metalness,
        emissive: config.emissive,
        emissiveIntensity: config.emissiveIntensity,
        transparent: editMode,
        opacity: editMode ? 0.58 : 1,
        depthWrite: !editMode,
      }),
    [config, editMode, textures],
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

function detailPlacements(map: CompositionMap, quality: "low" | "high", profile: DetailProfile): DetailPlacement[] {
  const config = PROFILE_CONFIG[profile];
  const placements: DetailPlacement[] = [];
  for (const segment of map.segments) {
    if (segment.kind === "tunnel") continue;
    const dx = segment.end[0] - segment.start[0];
    const dz = segment.end[1] - segment.start[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const nx = -dz / length;
    const nz = dx / length;
    const count = Math.max(2, Math.floor(length / (quality === "high" ? config.spacing : config.spacing * 1.7)));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const x = segment.start[0] + dx * t;
      const z = segment.start[1] + dz * t;
      const startY = map.elevations?.[mapPointKey(segment.start)] ?? 0;
      const endY = map.elevations?.[mapPointKey(segment.end)] ?? 0;
      const y = THREE.MathUtils.lerp(startY, endY, t);
      for (const side of [-1, 1]) {
        const seed = hash(`${segment.id}:${index}:${side}`);
        const offset = segment.width / 2 + config.edgeOffset + seeded(seed, 1) * config.edgeJitter;
        const px = x + nx * offset * side;
        const pz = z + nz * offset * side;
        // Keep objects off any walkable surface: near junctions a segment's edge
        // offset can land on a connecting path/room/platform, so an object that
        // belongs beside one segment would otherwise sit in the middle of another.
        if (isPointInsideMap(map, [px, pz])) continue;
        placements.push({ position: [px, y + config.baseY, pz], scale: detailScale(profile, seed), rotationY: seeded(seed, 5) * Math.PI });
      }
    }
  }

  for (const room of map.rooms) {
    const y = roomElevation(map, room) + config.baseY;
    const rockCount = quality === "high" ? 8 : 4;
    for (let index = 0; index < rockCount; index += 1) {
      const angle = (index / rockCount) * Math.PI * 2 + room.rotation;
      const radiusX = room.width / 2 + 0.8;
      const radiusZ = room.depth / 2 + 0.8;
      const px = room.center[0] + Math.cos(angle) * radiusX;
      const pz = room.center[1] + Math.sin(angle) * radiusZ;
      // Skip ring rocks that fall on a path/platform connected to the room.
      if (isPointInsideMap(map, [px, pz])) continue;
      placements.push({ position: [px, y, pz], scale: detailScale(profile, hash(`${room.id}:${index}`)), rotationY: angle });
    }
  }

  return placements;
}

function lowDetailGeometry(profile: DetailProfile): THREE.BufferGeometry {
  if (profile === "forest") return new THREE.ConeGeometry(0.8, 4, 7);
  if (profile === "crystal") return new THREE.OctahedronGeometry(1, 0);
  return new THREE.DodecahedronGeometry(1, 0);
}

function detailScale(profile: DetailProfile, seed: number): [number, number, number] {
  if (profile === "forest") {
    const width = 0.75 + seeded(seed, 2) * 0.65;
    const height = 0.8 + seeded(seed, 3) * 0.8;
    return [width, height, width];
  }
  if (profile === "crystal") {
    const width = 0.65 + seeded(seed, 2) * 1.15;
    return [width, 1 + seeded(seed, 3) * 2.3, width];
  }
  return [1.1 + seeded(seed, 2) * 1.5, 0.8 + seeded(seed, 3) * 1.8, 1 + seeded(seed, 4) * 1.3];
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

const PROFILE_CONFIG: Record<
  DetailProfile,
  {
    textures: string[];
    repeat: number;
    roughness: number;
    metalness: number;
    ao: number;
    emissive: string;
    emissiveIntensity: number;
    spacing: number;
    edgeOffset: number;
    edgeJitter: number;
    baseY: number;
  }
> = {
  cavern: {
    textures: [
      "/environments/atlas-cavern/textures/stone-albedo.webp",
      "/environments/atlas-cavern/textures/stone-normal.webp",
      "/environments/atlas-cavern/textures/stone-roughness.webp",
      "/environments/atlas-cavern/textures/stone-ao.webp",
    ],
    repeat: 2.5,
    roughness: 0.92,
    metalness: 0.02,
    ao: 0.75,
    emissive: "#000000",
    emissiveIntensity: 0,
    spacing: 4.5,
    edgeOffset: 0.7,
    edgeJitter: 1.2,
    baseY: 0.35,
  },
  forest: {
    textures: [
      "/environments/verdant-grove/textures/forest-albedo.webp",
      "/environments/verdant-grove/textures/forest-normal.webp",
      "/environments/verdant-grove/textures/forest-roughness.webp",
      "/environments/verdant-grove/textures/forest-ao.webp",
    ],
    repeat: 3.2,
    roughness: 0.96,
    metalness: 0,
    ao: 0.9,
    emissive: "#000000",
    emissiveIntensity: 0,
    spacing: 6.5,
    edgeOffset: 2.2,
    edgeJitter: 2.6,
    baseY: 0,
  },
  crystal: {
    textures: [
      "/environments/prismatic-reach/textures/crystal-albedo.webp",
      "/environments/prismatic-reach/textures/crystal-normal.webp",
      "/environments/prismatic-reach/textures/crystal-roughness.webp",
      "/environments/prismatic-reach/textures/crystal-ao.webp",
    ],
    repeat: 2.1,
    roughness: 0.38,
    metalness: 0.16,
    ao: 0.62,
    emissive: "#183859",
    emissiveIntensity: 0.34,
    spacing: 5.2,
    edgeOffset: 1.1,
    edgeJitter: 1.7,
    baseY: 0.2,
  },
};
