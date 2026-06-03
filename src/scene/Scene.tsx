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
import { CompositionMap, tiledMapTransforms, transformLoopPoint } from "../map";
import { TrackDef } from "../composition";
import { debugFlag } from "../debug";

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const environment = useStore((s) => s.composition.environment);
  const map = useStore((s) => s.composition.map);
  const mode = useStore((s) => s.mode);
  const camera = useThree((s) => s.camera);
  const [viewer, setViewer] = useState<[number, number]>([0, 0]);
  useFrame(() => {
    const next: [number, number] = [camera.position.x, camera.position.z];
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > 8 ? next : current));
  });
  const loopPreviewsEnabled = !debugFlag("debugNoLoopPreview");
  const tileLights = loopPreviewsEnabled ? tileLightTracks(map, tracks, viewer) : tracks;

  return (
    <>
      <EnvironmentScene environment={environment} editMode={mode === "edit"} />
      {mode === "explore" && loopPreviewsEnabled && <TiledMapPreview viewer={viewer} />}
      <TileBoundaryOverlay map={map} viewer={viewer} editMode={mode === "edit"} />
      <MapScene map={map} tracks={tracks} lightTracks={mode === "explore" ? tileLights : tracks} editMode={mode === "edit"} />

      {tracks.map((t) => (
        <TrackMarker key={t.id} track={t} />
      ))}

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
  const previews = debugFlag("debugNoLoopPreview") ? [] : tiledMapTransforms(map, viewer);
  const tileLights = debugFlag("debugNoLoopPreview") ? tracks : tileLightTracks(map, tracks, viewer);

  return (
    <>
      {previews.map((preview) => {
        return (
          <group key={preview.id} position={[preview.anchor[0], 0, preview.anchor[1]]} rotation={[0, preview.rotation, 0]}>
            <group position={[-preview.source[0], 0, -preview.source[1]]}>
              <MapScene map={map} tracks={tracks} lightTracks={tileLights} editMode={false} />
              {tracks.map((track) => (
                <TrackMarker key={`${preview.id}-${track.id}`} track={track} preview />
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
  const approxQ = Math.round((viewer[0] - ox) / stepX);
  const approxR = Math.round((viewer[1] - oz) / stepZ);
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
  const previews = tiledMapTransforms(map, viewer);
  if (!previews.length) return tracks;
  return tracks.flatMap((track) => [
    track,
    ...previews.map((preview) => {
        const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        return { ...track, position: [x, track.position[1], z] as [number, number, number] };
      }),
  ]);
}
