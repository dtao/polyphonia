import { TransformControls, useGLTF } from "@react-three/drei";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { EnvironmentSettings } from "../environment";
import type { EnvironmentLandmarkPlacement } from "../environment";
import { environmentPackAsset, environmentPackById, resolvedEnvironmentQuality } from "../environmentPacks";
import type { EnvironmentPackDefinition } from "../environmentPacks";
import type { SurfaceMaterialDefinitions } from "./DetailMapDressing";
import type { CompositionMap } from "../map";
import { tiledMapTransforms } from "../map";
import { arWalk, useStore, viewState } from "../store";
import { DetailMapDressing } from "./DetailMapDressing";
import { environmentInstanceBatches } from "./environmentInstances";
import { radialFade, RADIAL_FADE_OUTER } from "./fade";
import { environmentGenerationRadius, ENVIRONMENT_PREVIEW_LIMITS } from "./environmentVisibility";

export function AuthoredEnvironmentScene({
  environment,
  map,
  editMode,
  surfaceMaterials,
}: {
  environment: EnvironmentSettings;
  map: CompositionMap;
  editMode: boolean;
  surfaceMaterials?: SurfaceMaterialDefinitions;
}) {
  const gl = useThree((state) => state.gl);
  const ktx2Loader = useMemo(
    () => new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl),
    [gl],
  );
  const extendLoader = useCallback((loader: any) => loader.setKTX2Loader(ktx2Loader), [ktx2Loader]);
  const pack = environmentPackById(environment.pack?.id);
  const quality = resolvedEnvironmentQuality(environment.pack?.quality ?? "auto");
  const asset = pack ? environmentPackAsset(pack, quality) : undefined;
  useEffect(
    () => () => {
      ktx2Loader.dispose();
    },
    [ktx2Loader],
  );
  if (!pack || !asset) return null;

  useGLTF.preload(asset.url, "/draco-gltf/", true, extendLoader);

  return (
    <AssetErrorBoundary key={`${pack.id}:${asset.url}`}>
      <Suspense fallback={null}>
        <EnvironmentAsset
          url={asset.url}
          map={map}
          editMode={editMode}
          quality={quality}
          pack={pack}
          placements={environment.landmarks ?? []}
          extendLoader={extendLoader}
          surfaceMaterials={surfaceMaterials}
        />
      </Suspense>
    </AssetErrorBoundary>
  );
}

function EnvironmentAsset({
  url,
  map,
  editMode,
  quality,
  pack,
  placements,
  extendLoader,
  surfaceMaterials,
}: {
  url: string;
  map: CompositionMap;
  editMode: boolean;
  quality: "low" | "high";
  pack: EnvironmentPackDefinition;
  placements: EnvironmentLandmarkPlacement[];
  extendLoader: (loader: any) => void;
  surfaceMaterials?: SurfaceMaterialDefinitions;
}) {
  const gltf = useGLTF(url, "/draco-gltf/", true, extendLoader);
  useEffect(() => validateAssetBudget(gltf.scene, pack), [gltf.scene, pack]);
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [gltf.scene]);

  const landmarkGeometries = useMemo(
    () =>
      pack.landmarks.flatMap((landmark) => {
        let geometry: THREE.BufferGeometry | undefined;
        gltf.scene.traverse((object) => {
          if (!geometry && object instanceof THREE.Mesh && object.name.startsWith(landmark.nodePrefix)) {
            geometry = object.geometry;
          }
        });
        return geometry
          ? [{
              landmark,
              geometry,
              material: findLandmarkMaterial(gltf.scene, landmark.nodePrefix),
            }]
          : [];
      }),
    [gltf.scene, pack.landmarks],
  );
  const hasMapGeometry = map.segments.length > 0 || map.rooms.length > 0 || map.platforms.length > 0 || map.walls.length > 0;

  return (
    <>
      {!hasMapGeometry && <AuthoredSceneInstances scene={scene} map={map} editMode={editMode} />}
      {landmarkGeometries.length > 0 && (
        <DetailMapDressing
          map={map}
          detailLandmarks={landmarkGeometries}
          pack={pack}
          editMode={editMode}
          quality={quality}
          surfaceMaterials={surfaceMaterials}
        />
      )}
      <PlacedLandmarks
        landmarks={landmarkGeometries}
        placements={placements}
        editMode={editMode}
      />
      <PackLighting preset={pack.lighting} enabled={!editMode} quality={quality} />
    </>
  );
}

function findLandmarkMaterial(
  scene: THREE.Object3D,
  nodePrefix: string,
): THREE.Material | THREE.Material[] | undefined {
  let material: THREE.Material | THREE.Material[] | undefined;
  scene.traverse((object) => {
    if (!material && object instanceof THREE.Mesh && object.name.startsWith(nodePrefix)) {
      material = object.material;
    }
  });
  return material;
}

function PlacedLandmarks({
  landmarks,
  placements,
  editMode,
}: {
  landmarks: Array<{
    landmark: EnvironmentPackDefinition["landmarks"][number];
    geometry: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  }>;
  placements: EnvironmentLandmarkPlacement[];
  editMode: boolean;
}) {
  const catalog = useMemo(
    () => new Map(landmarks.map((entry) => [entry.landmark.id, entry])),
    [landmarks],
  );
  return (
    <group>
      {placements.map((placement) => {
        const entry = catalog.get(placement.assetId);
        if (!entry) return null;
        return (
          <PlacedLandmark
            key={placement.id}
            placement={placement}
            geometry={entry.geometry}
            material={entry.material}
            editMode={editMode}
          />
        );
      })}
    </group>
  );
}

function PlacedLandmark({
  placement,
  geometry,
  material,
  editMode,
}: {
  placement: EnvironmentLandmarkPlacement;
  geometry: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  editMode: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const selected = useStore((state) => state.selectedLandmarkId === placement.id);
  const selectLandmark = useStore((state) => state.selectLandmark);
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!editMode) return;
    event.stopPropagation();
    selectLandmark(placement.id);
  };
  const updateFromObject = () => {
    const object = mesh.current;
    if (!object) return;
    useStore.getState().updateLandmark(placement.id, {
      position: [object.position.x, object.position.y, object.position.z],
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    });
  };
  return (
    <>
      <mesh
        ref={mesh}
        geometry={geometry}
        material={material}
        position={placement.position}
        rotation={placement.rotation}
        scale={placement.scale}
        castShadow
        receiveShadow
        onClick={handleClick}
      />
      {editMode && selected && mesh.current && (
        <TransformControls
          object={mesh.current}
          mode="translate"
          size={0.85}
          onObjectChange={updateFromObject}
        />
      )}
    </>
  );
}

function AuthoredSceneInstances({
  scene,
  map,
  editMode,
}: {
  scene: THREE.Object3D;
  map: CompositionMap;
  editMode: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const tiled = !editMode && map.tiling.type !== "none";
  const [viewer, setViewer] = useState<[number, number]>([0, 0]);
  useFrame(() => {
    if (!tiled) return;
    const next: [number, number] = arWalk.active ? [viewState.x, viewState.z] : [camera.position.x, camera.position.z];
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > 1.5 ? next : current));
  });
  const scenePositions = useMemo(() => {
    scene.updateMatrixWorld(true);
    const positions: Array<[number, number]> = [];
    const position = new THREE.Vector3();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      position.setFromMatrixPosition(object.matrixWorld);
      if (position.y >= -500) positions.push([position.x, position.z]);
    });
    return positions;
  }, [scene]);
  const generationRadius = useMemo(
    () => environmentGenerationRadius(map, scenePositions),
    [map, scenePositions],
  );
  const previews = useMemo(
    () =>
      tiled
        ? tiledMapTransforms(map, viewer, generationRadius, ENVIRONMENT_PREVIEW_LIMITS)
        : [],
    [generationRadius, map, tiled, viewer],
  );
  const batches = useMemo(() => environmentInstanceBatches(scene, map, previews), [map, previews, scene]);

  return (
    <group>
      {batches.map((batch, index) => (
        <AuthoredInstanceBatch
          key={`${batch.geometry.uuid}:${index}`}
          geometry={batch.geometry}
          material={batch.material}
          matrices={batch.matrices}
        />
      ))}
    </group>
  );
}

function AuthoredInstanceBatch({
  geometry,
  material,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrices: THREE.Matrix4[];
}) {
  const camera = useThree((state) => state.camera);
  const mesh = useMemo(
    () => new THREE.InstancedMesh(geometry, material, matrices.length),
    [geometry, material, matrices.length],
  );
  const position = useMemo(() => new THREE.Vector3(), []);
  const fadeMatrix = useMemo(() => new THREE.Matrix4(), []);
  const fadeScale = useMemo(() => new THREE.Vector3(), []);
  const lastUpdate = useRef(-Infinity);

  const refill = useCallback(() => {
    let count = 0;
    for (const matrix of matrices) {
      position.setFromMatrixPosition(matrix);
      const distance = position.distanceTo(camera.position);
      if (distance > RADIAL_FADE_OUTER) continue;
      const fade = radialFade(distance);
      if (fade <= 0.002) continue;
      const placed = fade < 0.999 ? fadeMatrix.copy(matrix).scale(fadeScale.setScalar(fade)) : matrix;
      mesh.setMatrixAt(count++, placed);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [camera, fadeMatrix, fadeScale, matrices, mesh, position]);

  useEffect(() => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return () => mesh.dispose();
  }, [mesh]);
  useLayoutEffect(() => {
    refill();
  }, [refill]);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastUpdate.current < 0.25) return;
    lastUpdate.current = clock.elapsedTime;
    refill();
  });

  return <primitive object={mesh} />;
}

function validateAssetBudget(scene: THREE.Object3D, pack: EnvironmentPackDefinition): void {
  let triangles = 0;
  let drawCalls = 0;
  let largestTexture = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    drawCalls += Array.isArray(object.material) ? object.material.length : 1;
    const geometry = object.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        const image = value.image as { width?: number; height?: number } | undefined;
        largestTexture = Math.max(largestTexture, image?.width ?? 0, image?.height ?? 0);
      }
    }
  });
  const exceeded = [
    triangles > pack.budgets.maxTriangles ? `${Math.round(triangles).toLocaleString()} triangles` : null,
    drawCalls > pack.budgets.maxDrawCalls ? `${drawCalls} draw calls` : null,
    largestTexture > pack.budgets.maxTextureSize ? `${largestTexture}px texture` : null,
  ].filter(Boolean);
  if (exceeded.length) {
    console.warn(`Environment pack "${pack.id}" exceeds its registry budget: ${exceeded.join(", ")}.`);
  }
}

function PackLighting({
  preset,
  enabled,
  quality,
}: {
  preset: EnvironmentPackDefinition["lighting"];
  enabled: boolean;
  quality: "low" | "high";
}) {
  if (!enabled) return null;
  if (preset === "forest") {
    return (
      <>
        <hemisphereLight args={["#d8efc0", "#172015", quality === "high" ? 1.35 : 0.9]} />
        <directionalLight
          position={[-8, 18, 6]}
          color="#d8f0bc"
          intensity={quality === "high" ? 3.2 : 2.1}
          castShadow={quality === "high"}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <pointLight position={[9, 3, -10]} color="#95c86e" intensity={0.8} distance={34} />
      </>
    );
  }
  if (preset === "crystal") {
    return (
      <>
        <ambientLight color="#7694bd" intensity={quality === "high" ? 1.05 : 0.72} />
        <spotLight
          position={[0, 15, 4]}
          color="#a7d9ff"
          intensity={quality === "high" ? 5.2 : 3.1}
          angle={0.78}
          penumbra={0.82}
          distance={80}
          castShadow={quality === "high"}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <pointLight position={[-12, 3, -8]} color="#8c66ff" intensity={1.8} distance={32} />
        <pointLight position={[13, 2.5, 12]} color="#4fe6dd" intensity={1.5} distance={34} />
      </>
    );
  }
  return (
    <>
      <spotLight
        position={[2, 14, 8]}
        color="#b8d8e8"
        intensity={quality === "high" ? 3.2 : 2.2}
        angle={0.72}
        penumbra={0.8}
        distance={70}
        castShadow={quality === "high"}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0002}
      />
      <pointLight position={[-12, 3, -8]} color="#ff9b55" intensity={1.5} distance={26} />
      <pointLight position={[13, 2.5, 12]} color="#4ab4c8" intensity={1.25} distance={30} />
    </>
  );
}

class AssetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Authored environment asset failed to load; using procedural fallback.", error, info);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
