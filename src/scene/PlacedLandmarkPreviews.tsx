import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import type { EnvironmentLandmarkPlacement } from "../environment";
import type { CompositionMap } from "../map";
import { arWalk, loopPreviewGroups, viewState } from "../store";
import {
  environmentGenerationRadius,
  environmentPreviewTransforms,
} from "./environmentVisibility";
import { placedLandmarkPreviewPose } from "./placedLandmarkPreviewPose";

export function PlacedLandmarkPreviews({
  map,
  placements,
  editMode,
  children,
}: {
  map: CompositionMap;
  placements: EnvironmentLandmarkPlacement[];
  editMode: boolean;
  children: (
    placement: EnvironmentLandmarkPlacement,
    position: [number, number, number],
    rotation: [number, number, number],
    key: string,
  ) => ReactNode;
}) {
  const camera = useThree((state) => state.camera);
  const tiled = !editMode && map.tiling.type !== "none";
  const [viewer, setViewer] = useState<[number, number]>([
    viewState.x,
    viewState.z,
  ]);
  useFrame(() => {
    if (!tiled) return;
    const next: [number, number] = arWalk.active
      ? [viewState.x, viewState.z]
      : [camera.position.x, camera.position.z];
    setViewer((current) =>
      Math.hypot(current[0] - next[0], current[1] - next[1]) > 1.5
        ? next
        : current,
    );
  });
  const generationRadius = useMemo(
    () =>
      environmentGenerationRadius(
        map,
        placements.map((placement) => [placement.position[0], placement.position[2]]),
      ),
    [map, placements],
  );
  const previews = useMemo(
    () =>
      tiled
        ? environmentPreviewTransforms(map, viewer, generationRadius)
        : [],
    [generationRadius, map, tiled, viewer],
  );
  const previewGroup = useRef<THREE.Group | null>(null);
  const registerPreviewGroup = useCallback((group: THREE.Group | null) => {
    if (previewGroup.current) loopPreviewGroups.delete(previewGroup.current);
    previewGroup.current = group;
    if (group) loopPreviewGroups.add(group);
  }, []);

  return (
    <group ref={registerPreviewGroup}>
      {previews.flatMap((preview) =>
        placements.map((placement) => {
          const pose = placedLandmarkPreviewPose(map, preview, placement);
          return children(
            placement,
            pose.position,
            pose.rotation,
            `${preview.id}:${placement.id}`,
          );
        }),
      )}
    </group>
  );
}
