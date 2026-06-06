import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { EnvironmentSettings } from "../environment";
import { environmentPackAsset, environmentPackById, resolvedEnvironmentQuality } from "../environmentPacks";
import type { EnvironmentPackDefinition } from "../environmentPacks";
import type { CompositionMap } from "../map";
import { tiledMapTransforms } from "../map";
import { arWalk, viewState } from "../store";
import { DetailMapDressing } from "./DetailMapDressing";
import { environmentInstanceBatches } from "./environmentInstances";

const AUTHORED_SCENE_TILE_RADIUS = 130;

export function AuthoredEnvironmentScene({
  environment,
  map,
  editMode,
}: {
  environment: EnvironmentSettings;
  map: CompositionMap;
  editMode: boolean;
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
          extendLoader={extendLoader}
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
  extendLoader,
}: {
  url: string;
  map: CompositionMap;
  editMode: boolean;
  quality: "low" | "high";
  pack: EnvironmentPackDefinition;
  extendLoader: (loader: any) => void;
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
        return geometry ? [{ landmark, geometry }] : [];
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
        />
      )}
      <PackLighting preset={pack.lighting} enabled={!editMode} quality={quality} />
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
  const previews = useMemo(
    () => (tiled ? tiledMapTransforms(map, viewer, AUTHORED_SCENE_TILE_RADIUS) : []),
    [map, tiled, viewer],
  );
  const batches = useMemo(() => environmentInstanceBatches(scene, map, previews), [map, previews, scene]);
  const meshes = useMemo(
    () =>
      batches.map((batch) => {
        const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
        batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        return mesh;
      }),
    [batches],
  );
  useEffect(() => () => meshes.forEach((mesh) => mesh.dispose()), [meshes]);

  return (
    <group>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  );
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
