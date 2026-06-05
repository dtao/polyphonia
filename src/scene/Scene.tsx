import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";
import { EditControls } from "./EditControls";
import { TrackGizmo } from "./TrackGizmo";
import { ListenerSync } from "./ListenerSync";
import { EnvironmentScene } from "./EnvironmentScene";
import { MapScene } from "./MapScene";
import { DebugSampler } from "./DebugSampler";
import { CompositionMap, LoopPreviewTransform, mapPointKey, pointElevation, tiledMapTransforms, transformLoopPoint } from "../map";
import { TrackDef } from "../composition";
import { debugFlag } from "../debug";

const VIEWER_SAMPLE_DISTANCE = 0.75;
const TILE_PREVIEW_RADIUS = 180;
const PREVIEW_FADE_EPSILON = 0.003;
const PATH_LOOP_MAP_FADE_START = 18;
const PATH_LOOP_MAP_FADE_END = 58;
const PATH_LOOP_STEM_FADE_START = 72;
const PATH_LOOP_STEM_FADE_END = 180;
const TILE_MAP_FADE_START = 85;
const TILE_MAP_FADE_END = 180;
const TILE_STEM_FADE_START = 95;
const TILE_STEM_FADE_END = 200;

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const environment = useStore((s) => s.composition.environment);
  const map = useStore((s) => s.composition.map);
  const mode = useStore((s) => s.mode);
  const camera = useThree((s) => s.camera);
  const [viewer, setViewer] = useState<[number, number]>([0, 0]);
  useFrame(() => {
    const next: [number, number] = [camera.position.x, camera.position.z];
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > VIEWER_SAMPLE_DISTANCE ? next : current));
  });
  const loopPreviewsEnabled = !debugFlag("debugNoLoopPreview");
  const tileLights = loopPreviewsEnabled ? tileLightTracks(map, tracks, viewer) : tracks;
  // On tiled/looped maps the canonical "base" stems are just one copy of the
  // repeated space, so in explore mode they distance-fade like preview copies
  // instead of sitting at full opacity on the horizon. Edit mode and untiled
  // maps keep base stems fully visible.
  const fadeBaseMarkers = mode === "explore" && loopPreviewsEnabled && map.tiling.type !== "none";

  return (
    <>
      <EnvironmentScene environment={environment} editMode={mode === "edit"} />
      {mode === "explore" && loopPreviewsEnabled && <TiledMapPreview viewer={viewer} />}
      <TileBoundaryOverlay map={map} viewer={viewer} editMode={mode === "edit"} />
      <MapScene map={map} tracks={tracks} lightTracks={mode === "explore" ? tileLights : tracks} editMode={mode === "edit"} />

      {tracks.map((t) => {
        const fade = fadeBaseMarkers ? baseTrackVisibility(map, t, viewer) : 1;
        if (fade <= PREVIEW_FADE_EPSILON) return null;
        return (
          <TrackMarker key={t.id} track={t} fade={fade} debugId={`base:${t.id}`} debugPosition={[t.position[0], t.position[2]]} />
        );
      })}

      {/* Player is mounted even on the entry screen so the enter button's click
          can lock the pointer immediately; its lock selector keeps stray clicks
          from grabbing control before then. Edit mode is unreachable until the
          user has entered, so its controls only appear afterward. */}
      {mode === "explore" ? (
        <Player />
      ) : (
        <>
          <EditControls />
          <TrackGizmo />
        </>
      )}
      <ListenerSync />
      <DebugSampler />
    </>
  );
}

function TileBoundaryOverlay({ map, viewer, editMode }: { map: CompositionMap; viewer: [number, number]; editMode: boolean }) {
  const geometry = useMemo(() => tileBoundaryGeometry(map, viewer), [map.tiling.origin, map.tiling.tileSize, map.tiling.type, viewer]);
  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry} position={[0, 0.115, 0]} renderOrder={3}>
      <lineBasicMaterial color="#8fffe8" transparent opacity={editMode ? 0.3 : 0.14} toneMapped={false} depthWrite={false} />
    </lineSegments>
  );
}

function TiledMapPreview({ viewer }: { viewer: [number, number] }) {
  const tracks = useStore((s) => s.composition.tracks);
  const map = useStore((s) => s.composition.map);
  const previews = debugFlag("debugNoLoopPreview") ? [] : tiledMapTransforms(map, viewer, TILE_PREVIEW_RADIUS);
  const tileLights = debugFlag("debugNoLoopPreview") ? tracks : tileLightTracks(map, tracks, viewer);

  return (
    <>
      {previews.map((preview) => {
        const mapFade = previewMapVisibility(map, preview, viewer);
        const markerFades = tracks
          .map((track) => {
            const position = transformLoopPoint(preview, [track.position[0], track.position[2]]);
            return { track, position, fade: previewTrackVisibility(map, preview, track, viewer) };
          })
          .filter(({ fade }) => fade > PREVIEW_FADE_EPSILON);
        const strongestMarkerFade = markerFades.reduce((max, marker) => Math.max(max, marker.fade), 0);
        const previewFade = Math.max(mapFade, strongestMarkerFade * 0.7);
        if (previewFade <= PREVIEW_FADE_EPSILON) return null;
        // Lift the copy so its near (source) endpoint meets the anchor endpoint's
        // height: the path appears to keep climbing/descending past the seam. The
        // camera snaps by the matching amount at the wrap (see Player), so the
        // reset is invisible — an endless ascent/descent. Only path-loop endpoints
        // carry elevation; square/hex tiling stays flat.
        const elevationOffset = previewElevationOffset(map, preview);
        return (
          <group key={preview.id} position={[preview.anchor[0], elevationOffset, preview.anchor[1]]} rotation={[0, preview.rotation, 0]}>
            <group position={[-preview.source[0], 0, -preview.source[1]]}>
              <MapScene map={map} tracks={tracks} lightTracks={tileLights} editMode={false} previewFade={previewFade} />
              {markerFades.map(({ track, fade, position }) => (
                <TrackMarker key={`${preview.id}-${track.id}`} track={track} preview fade={fade} debugId={`${preview.id}:${track.id}`} debugPosition={position} />
              ))}
            </group>
          </group>
        );
      })}
    </>
  );
}

function tileBoundaryGeometry(map: CompositionMap, viewer: [number, number]): THREE.BufferGeometry | null {
  if (map.tiling.type === "square") return squareTileBoundaryGeometry(map.tiling, viewer);
  if (map.tiling.type === "hex") return hexTileBoundaryGeometry(map.tiling, viewer);
  return null;
}

function squareTileBoundaryGeometry(tiling: CompositionMap["tiling"], viewer: [number, number]): THREE.BufferGeometry | null {
  const size = Math.max(1, tiling.tileSize);
  const [ox, oz] = tiling.origin;
  const cx = Math.round((viewer[0] - ox) / size);
  const cz = Math.round((viewer[1] - oz) / size);
  const range = Math.max(2, Math.ceil(150 / size));
  const edges = new TileEdges();

  for (let ix = cx - range; ix <= cx + range; ix++) {
    for (let iz = cz - range; iz <= cz + range; iz++) {
      const x = ox + ix * size;
      const z = oz + iz * size;
      const h = size / 2;
      edges.add([x - h, z - h], [x + h, z - h]);
      edges.add([x + h, z - h], [x + h, z + h]);
      edges.add([x + h, z + h], [x - h, z + h]);
      edges.add([x - h, z + h], [x - h, z - h]);
    }
  }

  return edges.geometry();
}

function hexTileBoundaryGeometry(tiling: CompositionMap["tiling"], viewer: [number, number]): THREE.BufferGeometry | null {
  const size = Math.max(1, tiling.tileSize);
  const [ox, oz] = tiling.origin;
  const stepX = size;
  const stepZ = (Math.sqrt(3) / 2) * size;
  const approxR = Math.round((viewer[1] - oz) / stepZ);
  const approxQ = Math.round((viewer[0] - ox) / stepX - approxR * 0.5);
  const range = Math.max(2, Math.ceil(150 / size));
  const radius = size / Math.sqrt(3);
  const edges = new TileEdges();

  for (let q = approxQ - range; q <= approxQ + range; q++) {
    for (let r = approxR - range; r <= approxR + range; r++) {
      const x = ox + (q + r * 0.5) * stepX;
      const z = oz + r * stepZ;
      const points = Array.from({ length: 6 }, (_, i): [number, number] => {
        const angle = Math.PI / 6 + i * (Math.PI / 3);
        return [x + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
      });
      for (let i = 0; i < points.length; i++) edges.add(points[i], points[(i + 1) % points.length]);
    }
  }

  return edges.geometry();
}

class TileEdges {
  private edges = new Map<string, [[number, number], [number, number]]>();

  add(a: [number, number], b: [number, number]): void {
    const key = edgeKey(a, b);
    if (!this.edges.has(key)) this.edges.set(key, [a, b]);
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.edges.size) return null;
    const vertices: number[] = [];
    for (const [a, b] of this.edges.values()) {
      vertices.push(a[0], 0, a[1], b[0], 0, b[1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
  }
}

function edgeKey(a: [number, number], b: [number, number]): string {
  const ak = pointBoundaryKey(a);
  const bk = pointBoundaryKey(b);
  return ak < bk ? `${ak}:${bk}` : `${bk}:${ak}`;
}

function pointBoundaryKey([x, z]: [number, number]): string {
  return `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
}

function tileLightTracks(map: CompositionMap, tracks: TrackDef[], viewer: [number, number]): TrackDef[] {
  if (debugFlag("debugNoLoopLights")) return tracks;
  const previews = tiledMapTransforms(map, viewer, TILE_PREVIEW_RADIUS);
  if (!previews.length) return tracks;
  return tracks.flatMap((track) => [
    track,
    ...previews.flatMap((preview) => {
        if (previewTrackVisibility(map, preview, track, viewer) <= PREVIEW_FADE_EPSILON) return [];
        const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        return [{ ...track, position: [x, track.position[1], z] as [number, number, number] }];
      }),
  ]);
}

// How far to raise/lower a loop preview copy so its source endpoint aligns with
// the anchor endpoint it sits against. Non-loop tilings (square/hex) stay flat.
function previewElevationOffset(map: CompositionMap, preview: LoopPreviewTransform): number {
  if (map.tiling.type !== "path-loop") return 0;
  return pointElevation(map, mapPointKey(preview.anchor)) - pointElevation(map, mapPointKey(preview.source));
}

function previewMapVisibility(map: CompositionMap, preview: { anchor: [number, number] }, viewer: [number, number]): number {
  const distance = Math.hypot(viewer[0] - preview.anchor[0], viewer[1] - preview.anchor[1]);
  const start = map.tiling.type === "path-loop" ? PATH_LOOP_MAP_FADE_START : TILE_MAP_FADE_START;
  const end = map.tiling.type === "path-loop" ? PATH_LOOP_MAP_FADE_END : TILE_MAP_FADE_END;
  return distanceVisibility(distance, start, end);
}

function baseTrackVisibility(map: CompositionMap, track: TrackDef, viewer: [number, number]): number {
  const distance = Math.hypot(viewer[0] - track.position[0], viewer[1] - track.position[2]);
  const start = map.tiling.type === "path-loop" ? PATH_LOOP_STEM_FADE_START : TILE_STEM_FADE_START;
  const end = map.tiling.type === "path-loop" ? PATH_LOOP_STEM_FADE_END : TILE_STEM_FADE_END;
  return distanceVisibility(distance, start, end);
}

function previewTrackVisibility(map: CompositionMap, preview: LoopPreviewTransform, track: TrackDef, viewer: [number, number]): number {
  const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
  const distance = Math.hypot(viewer[0] - x, viewer[1] - z);
  const start = map.tiling.type === "path-loop" ? PATH_LOOP_STEM_FADE_START : TILE_STEM_FADE_START;
  const end = map.tiling.type === "path-loop" ? PATH_LOOP_STEM_FADE_END : TILE_STEM_FADE_END;
  return distanceVisibility(distance, start, end);
}

function distanceVisibility(distance: number, start: number, end: number): number {
  return 1 - THREE.MathUtils.smoothstep(distance, start, end);
}
