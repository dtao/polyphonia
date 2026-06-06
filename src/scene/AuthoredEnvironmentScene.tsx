import { useGLTF } from "@react-three/drei";
import { Component, Suspense, useMemo } from "react";
import type { ErrorInfo, ReactNode } from "react";
import * as THREE from "three";
import type { EnvironmentSettings } from "../environment";
import { environmentPackAsset, environmentPackById } from "../environmentPacks";
import type { CompositionMap } from "../map";
import { CavernMapDressing } from "./CavernMapDressing";

export function AuthoredEnvironmentScene({
  environment,
  map,
  editMode,
}: {
  environment: EnvironmentSettings;
  map: CompositionMap;
  editMode: boolean;
}) {
  const pack = environmentPackById(environment.pack?.id);
  const asset = pack ? environmentPackAsset(pack, environment.pack?.quality ?? "auto") : undefined;
  if (!pack || !asset) return null;

  useGLTF.preload(asset.url);

  return (
    <AssetErrorBoundary key={`${pack.id}:${asset.url}`}>
      <Suspense fallback={null}>
        <EnvironmentAsset url={asset.url} map={map} editMode={editMode} />
      </Suspense>
    </AssetErrorBoundary>
  );
}

function EnvironmentAsset({ url, map, editMode }: { url: string; map: CompositionMap; editMode: boolean }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [gltf.scene]);

  const rockGeometry = useMemo(() => {
    let geometry: THREE.BufferGeometry | undefined;
    gltf.scene.traverse((object) => {
      if (!geometry && object instanceof THREE.Mesh && object.name.startsWith("WallRock_")) geometry = object.geometry;
    });
    return geometry;
  }, [gltf.scene]);
  const hasMapGeometry = map.segments.length > 0 || map.rooms.length > 0 || map.platforms.length > 0 || map.walls.length > 0;

  return (
    <>
      {!hasMapGeometry && <primitive object={scene} />}
      {rockGeometry && <CavernMapDressing map={map} rockGeometry={rockGeometry} editMode={editMode} />}
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
