import type { CompositionMap } from "../map";
import { endpointPoint, pathLoopForMap, tiledMapTransforms } from "../map";
import { RADIAL_FADE_OUTER } from "./fade";

export const ENVIRONMENT_PREVIEW_LIMITS = {
  tileRange: 64,
  pathDepth: 64,
};

const ENVIRONMENT_GENERATION_BUFFER = 4;

// Preview transforms are admitted by their tile/loop anchor, while visibility
// is decided from each object's final world position. Generate far enough past
// the visible circle that even an object on the near edge of a newly admitted
// copy already exists outside the fade band.
export function environmentGenerationRadius(
  map: Pick<CompositionMap, "segments" | "tiling">,
  positions: ArrayLike<readonly [number, number]>,
): number {
  const sources = previewSources(map);
  let maxOffset = 0;
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    for (const source of sources) {
      maxOffset = Math.max(maxOffset, Math.hypot(position[0] - source[0], position[1] - source[1]));
    }
  }
  return RADIAL_FADE_OUTER + maxOffset + ENVIRONMENT_GENERATION_BUFFER;
}

export function environmentPreviewTransforms(
  map: Pick<CompositionMap, "segments" | "tiling" | "elevations">,
  viewer: [number, number],
  generationRadius: number,
) {
  if (map.tiling.type !== "path-loop") {
    return tiledMapTransforms(map, viewer, generationRadius, ENVIRONMENT_PREVIEW_LIMITS);
  }

  // Path-loop movement teleports by one whole loop at the seam. Keep a fixed
  // pool mounted on both sides so that wrap or viewer-state lag cannot create a
  // previously absent environment copy inside the visible circle.
  return tiledMapTransforms(map, viewer, Infinity, {
    pathDepth: environmentPathLoopDepth(map, generationRadius),
  });
}

export function environmentPathLoopDepth(
  map: Pick<CompositionMap, "segments" | "tiling">,
  generationRadius: number,
): number {
  const sources = previewSources(map);
  if (sources.length < 2) return 1;
  const span = Math.max(1, Math.hypot(sources[0][0] - sources[1][0], sources[0][1] - sources[1][1]));
  return Math.min(
    ENVIRONMENT_PREVIEW_LIMITS.pathDepth,
    Math.max(2, Math.ceil(generationRadius / span) + 2),
  );
}

function previewSources(map: Pick<CompositionMap, "segments" | "tiling">): Array<[number, number]> {
  if (map.tiling.type !== "path-loop") return [[0, 0]];
  const loop = pathLoopForMap(map);
  const start = loop?.start ? endpointPoint(map, loop.start) : null;
  const end = loop?.end ? endpointPoint(map, loop.end) : null;
  const sources = [start, end].filter((point): point is [number, number] => !!point);
  return sources.length ? sources : [[0, 0]];
}
