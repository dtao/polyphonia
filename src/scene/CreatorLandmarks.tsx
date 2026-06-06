import { TransformControls, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { CreatorLandmarkAsset } from "../creatorAssets";
import type { EnvironmentLandmarkPlacement } from "../environment";
import type { CompositionMap } from "../map";
import { useStore } from "../store";
import { PlacedLandmarkPreviews } from "./PlacedLandmarkPreviews";

export function CreatorLandmarks({
  assets,
  placements,
  map,
  editMode,
}: {
  assets: CreatorLandmarkAsset[];
  placements: EnvironmentLandmarkPlacement[];
  map: CompositionMap;
  editMode: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const ktx2Loader = useMemo(
    () => new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl),
    [gl],
  );
  const extendLoader = useCallback((loader: any) => loader.setKTX2Loader(ktx2Loader), [ktx2Loader]);
  useEffect(
    () => () => {
      ktx2Loader.dispose();
    },
    [ktx2Loader],
  );
  const catalog = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  return (
    <group>
      {placements.map((placement) => {
        const asset = catalog.get(placement.assetId);
        if (!asset) return null;
        return (
          <Suspense key={placement.id} fallback={null}>
            <CreatorLandmark
              asset={asset}
              placement={placement}
              editMode={editMode}
              extendLoader={extendLoader}
            />
          </Suspense>
        );
      })}
      <PlacedLandmarkPreviews
        map={map}
        placements={placements.filter((placement) => catalog.has(placement.assetId))}
        editMode={editMode}
      >
        {(placement, position, rotation, key) => {
          const asset = catalog.get(placement.assetId);
          if (!asset) return null;
          return (
            <Suspense key={key} fallback={null}>
              <CreatorLandmark
                asset={asset}
                placement={{ ...placement, position, rotation }}
                editMode={false}
                extendLoader={extendLoader}
              />
            </Suspense>
          );
        }}
      </PlacedLandmarkPreviews>
    </group>
  );
}

function CreatorLandmark({
  asset,
  placement,
  editMode,
  extendLoader,
}: {
  asset: CreatorLandmarkAsset;
  placement: EnvironmentLandmarkPlacement;
  editMode: boolean;
  extendLoader: (loader: any) => void;
}) {
  useGLTF.preload(asset.model, "/draco-gltf/", true, extendLoader);
  const gltf = useGLTF(asset.model, "/draco-gltf/", true, extendLoader);
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
