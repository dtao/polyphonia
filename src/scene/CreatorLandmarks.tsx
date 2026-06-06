import { TransformControls, useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CreatorLandmarkAsset } from "../creatorAssets";
import type { EnvironmentLandmarkPlacement } from "../environment";
import { useStore } from "../store";

export function CreatorLandmarks({
  assets,
  placements,
  editMode,
}: {
  assets: CreatorLandmarkAsset[];
  placements: EnvironmentLandmarkPlacement[];
  editMode: boolean;
}) {
  const catalog = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  return (
    <group>
      {placements.map((placement) => {
        const asset = catalog.get(placement.assetId);
        if (!asset) return null;
        return (
          <Suspense key={placement.id} fallback={null}>
            <CreatorLandmark asset={asset} placement={placement} editMode={editMode} />
          </Suspense>
        );
      })}
    </group>
  );
}

function CreatorLandmark({
  asset,
  placement,
  editMode,
}: {
  asset: CreatorLandmarkAsset;
  placement: EnvironmentLandmarkPlacement;
  editMode: boolean;
}) {
  const gltf = useGLTF(asset.model);
  const object = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    clone.position.set(-asset.anchor[0], -asset.anchor[1], -asset.anchor[2]);
    return clone;
  }, [asset.anchor, gltf.scene]);
  const group = useRef<THREE.Group>(null);
  const selected = useStore((state) => state.selectedLandmarkId === placement.id);
  const selectLandmark = useStore((state) => state.selectLandmark);
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!editMode) return;
    event.stopPropagation();
    selectLandmark(placement.id);
  };
  const updateFromObject = () => {
    const target = group.current;
    if (!target) return;
    useStore.getState().updateLandmark(placement.id, {
      position: [target.position.x, target.position.y, target.position.z],
      rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
      scale: [target.scale.x, target.scale.y, target.scale.z],
    });
  };
  return (
    <>
      <group
        ref={group}
        position={placement.position}
        rotation={placement.rotation}
        scale={placement.scale}
        onClick={handleClick}
      >
        <primitive object={object} />
      </group>
      {editMode && selected && group.current && (
        <TransformControls
          object={group.current}
          mode="translate"
          size={0.85}
          onObjectChange={updateFromObject}
        />
      )}
    </>
  );
}
