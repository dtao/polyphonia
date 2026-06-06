import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type {
  EnvironmentPackDefinition,
  EnvironmentPackLandmark,
  EnvironmentPackMaterial,
} from "../environmentPacks";
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
import { arWalk, loopPreviewGroups, viewState } from "../store";
import { pathJointPatches } from "./MapScene";
import { radialFade, RADIAL_FADE_OUTER } from "./fade";

interface DetailPlacement {
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
}

interface PackMaterials {
  floor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
}

export interface SurfaceMaterialDefinitions {
  floor: EnvironmentPackMaterial;
  wall?: EnvironmentPackMaterial;
  ceiling?: EnvironmentPackMaterial;
}

const packTextureCache = new Map<string, THREE.Texture[]>();

// How far out (in world units) adjacent loop copies receive the textured floor
// shells. Kept near the full-opacity band of the reactive floor copies (which
// fade ~85–180); beyond it the copies are already fading, so the plainer
// reactive-only floor reads fine and we save the extra (per-mesh) draw calls.
const DETAIL_FLOOR_TILE_RADIUS = 92;
// Instanced environmental objects (rocks/trees/crystals) are cheap, so they
// repeat across the wider visible field — like the stem orbs do — out to the
// cull distance instead of stopping at the textured-floor band. Far instances
// fall back to low-detail geometry (see DetailInstances) and are culled past the
// shared radial-fade outer radius, by which point they have already faded to
// nothing. Rather than pop in at the cull radius, instances scale up over the
// radial-fade band as you approach — the equivalent of the stem orbs' distance
// fade for solid geometry, which shares one material and so can't fade opacity
// per instance.
const DETAIL_OBJECT_CULL = RADIAL_FADE_OUTER;

export function DetailMapDressing({
  map,
  detailLandmarks,
  pack,
  editMode,
  quality,
  surfaceMaterials,
}: {
  map: CompositionMap;
  detailLandmarks: Array<{
    landmark: EnvironmentPackLandmark;
    geometry: THREE.BufferGeometry;
  }>;
  pack: EnvironmentPackDefinition;
  editMode: boolean;
  quality: "low" | "high";
  surfaceMaterials?: SurfaceMaterialDefinitions;
}) {
  const materials = useSurfaceMaterials(pack.id, surfaceMaterials ?? pack.materials, editMode);
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
  // Floor shells cover a near band; objects repeat further out (a superset).
  const floorPreviews = useMemo(
    () => (tiled ? tiledMapTransforms(map, viewer, DETAIL_FLOOR_TILE_RADIUS) : []),
    [tiled, map, viewer],
  );
  const objectPreviews = useMemo(
    () => (tiled ? tiledMapTransforms(map, viewer, DETAIL_OBJECT_CULL) : []),
    [tiled, map, viewer],
  );

  // The preview group's floor shells and object copies are positioned from the
  // `viewer` React state, which lags the camera by a frame. On a path-loop wrap
  // the camera teleports while these still hold the pre-wrap layout, flashing
  // copies in the wrong place (P13). Registering the group lets <Scene>'s
  // after-<Player> guard blank it for the teleport frame; the base copy below
  // stays visible because it sits at fixed world positions and never desyncs.
  const previewGroup = useRef<THREE.Group | null>(null);
  const registerPreviewGroup = useCallback((group: THREE.Group | null) => {
    if (previewGroup.current) loopPreviewGroups.delete(previewGroup.current);
    previewGroup.current = group;
    if (group) loopPreviewGroups.add(group);
  }, []);

  return (
    <group>
      <MapShell map={map} materials={materials} />
      {detailLandmarks.map(({ landmark, geometry }) => (
        <LandmarkInstances
          key={landmark.id}
          variant="base"
          geometry={geometry}
          material={materials.floor}
          map={map}
          objectPreviews={objectPreviews}
          quality={quality}
          landmark={landmark}
        />
      ))}
      <group ref={registerPreviewGroup}>
        {floorPreviews.map((preview) => (
          <group
            key={preview.id}
            position={[preview.anchor[0], loopPreviewElevationOffset(map, preview), preview.anchor[1]]}
            rotation={[0, preview.rotation, 0]}
          >
            <group position={[-preview.source[0], 0, -preview.source[1]]}>
              <MapShell map={map} materials={materials} />
            </group>
          </group>
        ))}
        {detailLandmarks.map(({ landmark, geometry }) => (
          <LandmarkInstances
            key={landmark.id}
            variant="preview"
            geometry={geometry}
            material={materials.floor}
            map={map}
            objectPreviews={objectPreviews}
            quality={quality}
            landmark={landmark}
          />
        ))}
      </group>
    </group>
  );
}

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

// `base` renders the single authoring tile's objects; `preview` renders only the
// loop-copy objects. They're split so the preview copies — which lag the camera
// by a frame and so flicker on a loop wrap — can live in a group that <Scene>
// blanks for the teleport frame, while the base copies stay put (see P13).
function LandmarkInstances({
  geometry,
  material,
  map,
  objectPreviews,
  quality,
  landmark,
  variant,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  map: CompositionMap;
  objectPreviews: ReturnType<typeof tiledMapTransforms>;
  quality: "low" | "high";
  landmark: EnvironmentPackLandmark;
  variant: "base" | "preview";
}) {
  const placements = useMemo(() => detailPlacements(map, quality, landmark), [landmark, map, quality]);
  const transforms = useMemo(() => {
    if (variant === "base") {
      return placements.map((placement) => transform(placement.position, placement.scale, placement.rotationY));
    }
    const matrices: THREE.Matrix4[] = [];
    for (const preview of objectPreviews) {
      const lift = loopPreviewElevationOffset(map, preview);
      for (const placement of placements) {
        const [tx, tz] = transformLoopPoint(preview, [placement.position[0], placement.position[2]]);
        matrices.push(
          transform(
            [tx, placement.position[1] + lift, tz],
            placement.scale,
            placement.rotationY + preview.rotation,
          ),
        );
      }
    }
    return matrices;
  }, [map, objectPreviews, placements, variant]);
  if (!transforms.length) return null;
  return (
    <DetailInstances
      geometry={geometry}
      material={material}
      transforms={transforms}
      quality={quality}
      landmark={landmark}
    />
  );
}

// The static textured shells (floor slabs, walls) for one copy of the map.
function MapShell({ map, materials }: { map: CompositionMap; materials: PackMaterials }) {
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
            position={[(wall.start[0] + wall.end[0]) / 2, wall.height / 2, (wall.start[1] + wall.end[1]) / 2]}
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
// The per-segment slabs stop square at each end, so without these the pack
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
    // single-sided pack floor material (the reactive floor gets away with the
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
  materials: PackMaterials;
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
  // = 0.05) so the pack texture wins the depth test instead of being buried under
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
  // 0.06) so the pack texture shows instead of the plain reactive floor, matching
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

function DetailInstances({
  geometry,
  material,
  transforms,
  quality,
  landmark,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  transforms: THREE.Matrix4[];
  quality: "low" | "high";
  landmark: EnvironmentPackLandmark;
}) {
  const camera = useThree((state) => state.camera);
  const lowGeometry = useMemo(() => lowDetailGeometry(landmark.fallback), [landmark.fallback]);
  // Instance buffers can't grow after allocation, so a recreated InstancedMesh
  // starts empty and would flicker until the next refill. On a tiled map
  // `transforms.length` wobbles every step as preview copies cross the cull
  // radius; keying allocation directly on it churned buffers (GC hitches) and
  // produced visible gaps. Instead grow capacity monotonically in blocks so
  // routine churn reuses the same buffers and reallocation is rare.
  const capacityRef = useRef(0);
  const capacity = useMemo(() => {
    if (transforms.length > capacityRef.current) {
      capacityRef.current = Math.ceil((transforms.length * 1.25) / 64) * 64;
    }
    return capacityRef.current;
  }, [transforms.length]);
  const nearMesh = useMemo(() => emptyInstancedMesh(geometry, material, capacity), [geometry, material, capacity]);
  const farMesh = useMemo(() => emptyInstancedMesh(lowGeometry, material, capacity), [lowGeometry, material, capacity]);
  const lastUpdate = useRef(-Infinity);
  const position = useMemo(() => new THREE.Vector3(), []);
  const fadeMatrix = useMemo(() => new THREE.Matrix4(), []);
  const fadeScale = useMemo(() => new THREE.Vector3(), []);

  const refill = useCallback(() => {
    let nearCount = 0;
    let farCount = 0;
    for (const matrix of transforms) {
      position.setFromMatrixPosition(matrix);
      const distance = position.distanceTo(camera.position);
      if (distance > DETAIL_OBJECT_CULL) continue;
      // Grow the instance in from a point as it nears the cull radius instead of
      // popping at full size (P12). Uniform scale is the per-instance lever we
      // have on a shared material; the band is far enough that the symmetric
      // shrink reads as a gentle fade.
      const fade = radialFade(distance);
      if (fade <= 0.002) continue;
      const placed = fade < 0.999 ? fadeMatrix.copy(matrix).scale(fadeScale.setScalar(fade)) : matrix;
      if (quality === "high" && distance < 42) nearMesh.setMatrixAt(nearCount++, placed);
      else farMesh.setMatrixAt(farCount++, placed);
    }
    nearMesh.count = nearCount;
    farMesh.count = farCount;
    nearMesh.instanceMatrix.needsUpdate = true;
    farMesh.instanceMatrix.needsUpdate = true;
    nearMesh.computeBoundingSphere();
    farMesh.computeBoundingSphere();
  }, [camera, fadeMatrix, fadeScale, farMesh, nearMesh, position, quality, transforms]);

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

  // Fill synchronously whenever the meshes or placements change so a freshly
  // allocated mesh is never displayed empty. The throttled per-frame pass below
  // only refreshes the near/far LOD split as the camera moves.
  useLayoutEffect(() => {
    refill();
  }, [refill]);

  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastUpdate.current < 0.25) return;
    lastUpdate.current = clock.elapsedTime;
    refill();
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

function useSurfaceMaterials(
  cacheId: string,
  source: SurfaceMaterialDefinitions,
  editMode: boolean,
): PackMaterials {
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
    const cached = packTextureCache.get(cacheKey);
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
    packTextureCache.set(cacheKey, created);
    return created;
  }, [cacheId, definitions, loaded, urls]);
  const textureByUrl = useMemo(
    () => new Map(urls.map((url, index) => [url, textures[index]])),
    [textures, urls],
  );
  const materials = useMemo(
    () => ({
      floor: createPackMaterial(definitions.floor, textureByUrl, editMode),
      wall: createPackMaterial(definitions.wall, textureByUrl, editMode),
      ceiling: createPackMaterial(definitions.ceiling, textureByUrl, editMode),
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

function materialTextureUrls(material: EnvironmentPackMaterial): string[] {
  return [
    material.albedo,
    material.normal,
    material.roughnessMap,
    material.metalnessMap,
    material.ao,
    material.emissiveMap,
  ].filter((url): url is string => !!url);
}

function createPackMaterial(
  definition: EnvironmentPackMaterial,
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

function detailPlacements(
  map: CompositionMap,
  quality: "low" | "high",
  landmark: EnvironmentPackLandmark,
): DetailPlacement[] {
  const config = landmark.autoPlacement;
  if (!config) return [];
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
        placements.push({
          position: [px, y + config.baseY, pz],
          scale: detailScale(config, seed),
          rotationY: seeded(seed, 5) * Math.PI,
        });
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
      placements.push({
        position: [px, y, pz],
        scale: detailScale(config, hash(`${room.id}:${index}`)),
        rotationY: angle,
      });
    }
  }

  return placements;
}

function lowDetailGeometry(fallback: EnvironmentPackLandmark["fallback"]): THREE.BufferGeometry {
  if (fallback === "tree") return new THREE.ConeGeometry(0.8, 4, 7);
  if (fallback === "crystal") return new THREE.OctahedronGeometry(1, 0);
  return new THREE.DodecahedronGeometry(1, 0);
}

function detailScale(
  config: NonNullable<EnvironmentPackLandmark["autoPlacement"]>,
  seed: number,
): [number, number, number] {
  return config.scaleMin.map((minimum, index) =>
    THREE.MathUtils.lerp(minimum, config.scaleMax[index], seeded(seed, index + 2)),
  ) as [number, number, number];
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
