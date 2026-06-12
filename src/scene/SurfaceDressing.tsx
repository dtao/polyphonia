import { useTexture } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SurfaceMaterialDefinition } from "../creatorAssets";
import type { CompositionMap, MapPlatform, MapRoom, WalkableSegment } from "../map";
import { mapPointKey, platformElevation, roomElevation } from "../map";
import { DEFAULT_ENCLOSURE_HEIGHT } from "../spatialConstants";
import { pathJointPatches } from "./MapScene";

// Textured shells over the map's walkable geometry, driven by imported
// creator materials assigned in the World panel (floor/wall/ceiling). Purely
// visual: the reactive map floor underneath stays authoritative for movement
// and acoustics. All meshes use standard opaque materials, so the scene fog
// fades them at the shared radial band without extra wiring.

interface ResolvedSurfaceMaterials {
  floor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
}

export interface SurfaceMaterialDefinitions {
  floor: SurfaceMaterialDefinition;
  wall?: SurfaceMaterialDefinition;
  ceiling?: SurfaceMaterialDefinition;
}

const surfaceTextureCache = new Map<string, THREE.Texture[]>();

export function SurfaceMapDressing({
  map,
  materials,
  editMode,
}: {
  map: CompositionMap;
  materials: SurfaceMaterialDefinitions;
  editMode: boolean;
}) {
  const resolved = useSurfaceMaterials("creator-surfaces", materials, editMode);
  return <MapShell map={map} materials={resolved} />;
}

// The static textured shells (floor slabs, walls) for one copy of the map.
function MapShell({ map, materials }: { map: CompositionMap; materials: ResolvedSurfaceMaterials }) {
  return (
    <group>
      {map.segments.length === 0 && map.rooms.length === 0 && map.platforms.length === 0 && (
        <FallbackFloor map={map} material={materials.floor} />
      )}
      {map.segments.map((segment) => (
        <SegmentShell key={segment.id} map={map} segment={segment} materials={materials} />
      ))}
      <JointPatches map={map} material={materials.floor} />
      {map.rooms.map((room) => (
        <RoomFloor key={room.id} map={map} room={room} material={materials.floor} />
      ))}
      {map.platforms.map((platform) => (
        <PlatformFloor key={platform.id} map={map} platform={platform} material={materials.floor} />
      ))}
      {map.walls.map((wall) => {
        const dx = wall.end[0] - wall.start[0];
        const dz = wall.end[1] - wall.start[1];
        const length = Math.hypot(dx, dz);
        return (
          <mesh
            key={wall.id}
            material={materials.wall}
            position={[(wall.start[0] + wall.end[0]) / 2, (wall.elevation ?? 0) + wall.height / 2, (wall.start[1] + wall.end[1]) / 2]}
            rotation={[0, Math.atan2(dx, dz), 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[wall.wallThickness ?? 0.3, wall.height, length]} />
          </mesh>
        );
      })}
    </group>
  );
}

// Flat textured caps over the wedge gaps where path segments meet at an angle.
// The per-segment slabs stop square at each end, so without these the surface
// texture is missing across angled joints and the plainer reactive floor shows
// through. Each patch sits at elevation + 0.05 — 0.02 proud of the segment slab
// tops (which sit at + 0.03, see SegmentShell) — so it both wins the depth test
// over the slabs (no coplanar z-fighting) and covers the slabs' overlapping
// rectangles at the joint, hiding the flicker they produced there.
function JointPatches({ map, material }: { map: CompositionMap; material: THREE.Material }) {
  const geometry = useMemo(() => jointPatchGeometry(map), [map]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

function jointPatchGeometry(map: CompositionMap): THREE.BufferGeometry | null {
  const patches = pathJointPatches(map);
  if (!patches.length) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const { polygon, y } of patches) {
    const base = positions.length / 3;
    // Map UVs across each patch's own bounding box (0..1), matching how the box
    // slab faces map the floor texture, so the tile density stays comparable.
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [px, pz] of polygon) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    for (const [px, pz] of polygon) {
      positions.push(px, y + 0.05, pz);
      uvs.push((px - minX) / spanX, (pz - minZ) / spanZ);
    }
    const triangles = THREE.ShapeUtils.triangulateShape(
      polygon.map(([px, pz]) => new THREE.Vector2(px, pz)),
      [],
    );
    // The convex hull is CCW in (x, z), which maps to a downward-facing normal in
    // 3D (Y up). Flip the winding so the patch faces up and renders with the
    // single-sided floor material (the reactive floor gets away with the
    // original winding only because PathMaterial is DoubleSide).
    for (const triangle of triangles) indices.push(base + triangle[0], base + triangle[2], base + triangle[1]);
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function FallbackFloor({ map, material }: { map: CompositionMap; material: THREE.MeshStandardMaterial }) {
  const [x, z] = map.tiling.origin;
  if (map.tiling.type === "square") {
    return (
      <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.13, z]} receiveShadow>
        <planeGeometry args={[map.tiling.tileSize, map.tiling.tileSize]} />
      </mesh>
    );
  }
  if (map.tiling.type === "hex") {
    // The hex centers use tileSize horizontally and sqrt(3)/2 * tileSize
    // vertically, so this is the matching pointy-hex circumradius. Exact cell
    // footprints meet only at their edges; the old 56-unit circles overlapped
    // neighboring copies on the same plane and flickered from z-fighting.
    const radius = map.tiling.tileSize / Math.sqrt(3);
    return (
      <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.13, z]} receiveShadow>
        <circleGeometry args={[radius, 6, Math.PI / 6]} />
      </mesh>
    );
  }
  return (
    <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, 0]} receiveShadow>
      <circleGeometry args={[56, 96]} />
    </mesh>
  );
}

function SegmentShell({
  map,
  segment,
  materials,
}: {
  map: CompositionMap;
  segment: WalkableSegment;
  materials: ResolvedSurfaceMaterials;
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
  const wallHeight = Math.max(map.wallHeight, DEFAULT_ENCLOSURE_HEIGHT);
  const tunnel = segment.kind === "tunnel";

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh material={materials.floor} rotation={[pitch, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[segment.width, 0.26, length]} />
      </mesh>
      {tunnel && (
        <>
          <mesh
            material={materials.wall}
            position={[-segment.width / 2, wallHeight / 2, 0]}
            rotation={[pitch, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.45, wallHeight, length]} />
          </mesh>
          <mesh
            material={materials.wall}
            position={[segment.width / 2, wallHeight / 2, 0]}
            rotation={[pitch, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.45, wallHeight, length]} />
          </mesh>
          <mesh
            material={materials.ceiling}
            position={[0, wallHeight, 0]}
            rotation={[pitch, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[segment.width + 0.8, 0.45, length]} />
          </mesh>
        </>
      )}
    </group>
  );
}

function RoomFloor({ map, room, material }: { map: CompositionMap; room: MapRoom; material: THREE.MeshStandardMaterial }) {
  // The slab is 0.26 thick; centering it at elevation - 0.05 puts its textured
  // top at elevation + 0.08 — just proud of the reactive room floor (ROOM_FLOOR_Y
  // = 0.05) so the texture wins the depth test instead of being buried under
  // it (which left rooms showing the plain reactive floor while paths showed
  // stone). Mirrors the segment slab's 0.03 lift above its own reactive floor.
  return (
    <mesh
      material={material}
      position={[room.center[0], roomElevation(map, room) - 0.05, room.center[1]]}
      rotation={[0, room.rotation, 0]}
      receiveShadow
    >
      <boxGeometry args={[room.width, 0.26, room.depth]} />
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
  // Centering the 0.26-thick slab at elevation - 0.04 lifts its textured top to
  // elevation + 0.09 — just above the reactive platform floor (PLATFORM_FLOOR_Y =
  // 0.06) so the texture shows instead of the plain reactive floor, matching
  // how segment and room slabs sit proud of their reactive floors.
  const y = platformElevation(map, platform) - 0.04;
  if (platform.shape === "rect") {
    return (
      <mesh
        material={material}
        position={[platform.center[0], y, platform.center[1]]}
        rotation={[0, platform.rotation, 0]}
        receiveShadow
      >
        <boxGeometry args={[platform.width, 0.26, platform.depth]} />
      </mesh>
    );
  }

  return (
    <mesh
      material={material}
      position={[platform.center[0], y, platform.center[1]]}
      rotation={[0, platform.rotation, 0]}
      receiveShadow
    >
      <cylinderGeometry args={[platform.width / 2, platform.width / 2, 0.26, platform.shape === "hex" ? 6 : 48]} />
    </mesh>
  );
}

function useSurfaceMaterials(
  cacheId: string,
  source: SurfaceMaterialDefinitions,
  editMode: boolean,
): ResolvedSurfaceMaterials {
  const definitions = useMemo(
    () => ({
      floor: source.floor,
      wall: source.wall ?? source.floor,
      ceiling: source.ceiling ?? source.wall ?? source.floor,
    }),
    [source],
  );
  const urls = useMemo(
    () => [...new Set(Object.values(definitions).flatMap(materialTextureUrls))],
    [definitions],
  );
  const loaded = useTexture(urls) as THREE.Texture[];
  const textures = useMemo(() => {
    const cacheKey = `${cacheId}:${urls.join("|")}`;
    const cached = surfaceTextureCache.get(cacheKey);
    if (cached) return cached;
    const created = loaded.map((source, index) => {
      const texture = source.clone();
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      if (urls[index] === definitions.floor.albedo ||
          urls[index] === definitions.wall.albedo ||
          urls[index] === definitions.ceiling.albedo) {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      texture.needsUpdate = true;
      return texture;
    });
    surfaceTextureCache.set(cacheKey, created);
    return created;
  }, [cacheId, definitions, loaded, urls]);
  const textureByUrl = useMemo(
    () => new Map(urls.map((url, index) => [url, textures[index]])),
    [textures, urls],
  );
  const materials = useMemo(
    () => ({
      floor: createSurfaceMaterial(definitions.floor, textureByUrl, editMode),
      wall: createSurfaceMaterial(definitions.wall, textureByUrl, editMode),
      ceiling: createSurfaceMaterial(definitions.ceiling, textureByUrl, editMode),
    }),
    [definitions, editMode, textureByUrl],
  );
  useEffect(
    () => () => {
      materials.floor.dispose();
      if (materials.wall !== materials.floor) materials.wall.dispose();
      if (materials.ceiling !== materials.floor && materials.ceiling !== materials.wall) materials.ceiling.dispose();
    },
    [materials],
  );
  return materials;
}

export function materialTextureUrls(material: SurfaceMaterialDefinition): string[] {
  return [
    material.albedo,
    material.normal,
    material.roughnessMap,
    material.metalnessMap,
    material.ao,
    material.emissiveMap,
  ].filter((url): url is string => !!url);
}

export function createSurfaceMaterial(
  definition: SurfaceMaterialDefinition,
  textures: Map<string, THREE.Texture>,
  editMode: boolean,
): THREE.MeshStandardMaterial {
  const texture = (url: string | undefined, repeat = true) => {
    const found = url ? textures.get(url) : undefined;
    if (found && repeat) found.repeat.set(definition.repeat, definition.repeat);
    return found;
  };
  const aoMap = texture(definition.ao);
  if (aoMap) aoMap.channel = 0;
  return new THREE.MeshStandardMaterial({
    map: texture(definition.albedo),
    normalMap: texture(definition.normal),
    normalScale: new THREE.Vector2(definition.normalScale ?? 0.7, definition.normalScale ?? 0.7),
    roughnessMap: texture(definition.roughnessMap),
    roughness: definition.roughness,
    metalnessMap: texture(definition.metalnessMap),
    metalness: definition.metalness,
    aoMap,
    aoMapIntensity: definition.aoIntensity ?? 1,
    emissiveMap: texture(definition.emissiveMap),
    emissive: definition.emissive ?? "#000000",
    emissiveIntensity: definition.emissiveIntensity ?? 0,
    transparent: editMode,
    opacity: editMode ? 0.58 : 1,
    depthWrite: !editMode,
  });
}
