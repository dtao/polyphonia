import type { EnvironmentLandmarkPlacement } from "../environment";
import type { CompositionMap, LoopPreviewTransform } from "../map";
import {
  loopPreviewElevationOffset,
  transformLoopPoint,
} from "../map";

export function placedLandmarkPreviewPose(
  map: Pick<CompositionMap, "elevations" | "tiling">,
  preview: LoopPreviewTransform,
  placement: EnvironmentLandmarkPlacement,
): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const [x, z] = transformLoopPoint(preview, [
    placement.position[0],
    placement.position[2],
  ]);
  return {
    position: [
      x,
      placement.position[1] + loopPreviewElevationOffset(map, preview),
      z,
    ],
    rotation: [
      placement.rotation[0],
      placement.rotation[1] + preview.rotation,
      placement.rotation[2],
    ],
  };
}
