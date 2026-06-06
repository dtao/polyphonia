import { useGLTF } from "@react-three/drei";
import { Component, Suspense, useMemo } from "react";
import type { ErrorInfo, ReactNode } from "react";
import * as THREE from "three";
import type { EnvironmentSettings } from "../environment";
import { environmentPackAsset, environmentPackById } from "../environmentPacks";

export function AuthoredEnvironmentScene({ environment }: { environment: EnvironmentSettings }) {
  const pack = environmentPackById(environment.pack?.id);
  const asset = pack ? environmentPackAsset(pack, environment.pack?.quality ?? "auto") : undefined;
  if (!pack || !asset) return null;

  useGLTF.preload(asset.url);

  return (
    <AssetErrorBoundary key={`${pack.id}:${asset.url}`}>
      <Suspense fallback={null}>
        <EnvironmentAsset url={asset.url} />
      </Suspense>
    </AssetErrorBoundary>
  );
}

function EnvironmentAsset({ url }: { url: string }) {
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

  return <primitive object={scene} />;
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
