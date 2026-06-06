import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { arWalk, loopWrap, useStore, viewState } from "../store";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";
import { EditControls } from "./EditControls";
import { TrackGizmo } from "./TrackGizmo";
import { ListenerSync } from "./ListenerSync";
import { EnvironmentScene, environmentBackgroundColor } from "./EnvironmentScene";
import { MapScene } from "./MapScene";
import { DebugSampler } from "./DebugSampler";
import { ARWalkSession } from "./ARWalkSession";
import { CompositionMap, LoopPreviewTransform, loopPreviewElevationOffset, tiledMapTransforms, transformLoopPoint } from "../map";
import { TrackDef } from "../composition";
import { debugFlag, debugValue } from "../debug";
import { EnvironmentEffects } from "./EnvironmentEffects";

const VIEWER_SAMPLE_DISTANCE = 0.75;
const TILE_PREVIEW_RADIUS = 180;
const PREVIEW_FADE_EPSILON = 0.003;
// Path-loop copies now chain to fill the corridor (see tiledMapTransforms), so
// the floor stays solid through the near/medium distance and only fades out near
// the preview radius — a gentle far-horizon fade rather than a whole copy
// blinking in the medium distance as the viewer crosses the seam.
const PATH_LOOP_MAP_FADE_START = 90;
const PATH_LOOP_MAP_FADE_END = 178;
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
  const previewGroup = useRef<THREE.Group>(null);
  useFrame(() => {
    const next: [number, number] = arWalk.active ? [viewState.x, viewState.z] : [camera.position.x, camera.position.z];
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > VIEWER_SAMPLE_DISTANCE ? next : current));
  });
  const loopPreviewsEnabled = !debugFlag("debugNoLoopPreview");
  const tileLights = loopPreviewsEnabled ? tileLightTracks(map, tracks, viewer) : tracks;
  // On tiled/looped maps the canonical "base" stems are just one copy of the
  // repeated space, so in explore mode they distance-fade like preview copies
  // instead of sitting at full opacity on the horizon. Edit mode and untiled
  // maps keep base stems fully visible.
  const fadeBaseMarkers = mode === "explore" && loopPreviewsEnabled && map.tiling.type !== "none";
  // Base stems carry their own point light, but preview copies don't (a light
  // per copy would thrash the renderer's light count). Instead, on tiled maps a
  // fixed pool of echo lights — one per track — follows each stem's nearest
  // visible copy so the room beyond a seam lights up as you approach it.
  const showEchoLights =
    mode === "explore" && loopPreviewsEnabled && map.tiling.type !== "none" && !debugFlag("debugNoPointLights") && !debugFlag("debugNoEchoLights");
  const forcedPack = debugValue("environmentPack");
  const forcedQuality = debugValue("environmentQuality");
  const renderedEnvironment = forcedPack
    ? {
        ...environment,
        pack: {
          id: forcedPack,
          quality: forcedQuality === "low" ? ("low" as const) : ("high" as const),
        },
      }
    : environment;

  return (
    <>
      <ARWorldTransform>
        <EnvironmentScene environment={renderedEnvironment} map={map} editMode={mode === "edit"} />
        {mode === "explore" && loopPreviewsEnabled && <TiledMapPreview viewer={viewer} groupRef={previewGroup} />}
        <TileBoundaryOverlay map={map} viewer={viewer} editMode={mode === "edit"} />
        <MapScene map={map} tracks={tracks} lightTracks={mode === "explore" ? tileLights : tracks} editMode={mode === "edit"} />
        {showEchoLights && <PreviewEchoLights map={map} tracks={tracks} />}

        {tracks.map((t) => {
          const fade = fadeBaseMarkers ? baseTrackVisibility(map, t, viewer) : 1;
          if (fade <= PREVIEW_FADE_EPSILON) return null;
          return (
            <TrackMarker key={t.id} track={t} fade={fade} debugId={`base:${t.id}`} debugPosition={[t.position[0], t.position[2]]} />
          );
        })}
      </ARWorldTransform>

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
      {/* Mounted after <Player> so its frame callback runs after the wrap is
          recorded; hides the preview group on the teleport frame. */}
      {mode === "explore" && loopPreviewsEnabled && <LoopWrapBlipGuard groupRef={previewGroup} />}
      <ListenerSync />
      <EnvironmentEffects environment={renderedEnvironment} editMode={mode === "edit"} />
      <ARWalkSession />
      <ARBackdrop />
      <DebugSampler />
    </>
  );
}

// In immersive-ar the WebXR compositor blends our render over the live camera
// feed: three forces a transparent clear for the alpha-blend environment blend
// mode (see WebGLBackground), so scene.background and setClearAlpha(1) can't
// hide the real world. To show only the Polyphonia environment we draw an
// opaque inverted sphere of the environment background color that rides with
// the camera, occluding the passthrough. depthTest/depthWrite are off so it
// always sits behind every other object regardless of distance (e.g. galaxy
// stars beyond its radius). It only renders while AR Walk is active; explore
// and edit modes keep using scene.background.
function ARBackdrop() {
  const environment = useStore((s) => s.composition.environment);
  const gl = useThree((s) => s.gl);
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const showing = arWalk.active && gl.xr.isPresenting;
    m.visible = showing;
    if (showing) m.position.setFromMatrixPosition(gl.xr.getCamera().matrixWorld);
  });

  return (
    <mesh ref={mesh} renderOrder={-1000} visible={false} frustumCulled={false}>
      <sphereGeometry args={[50, 32, 16]} />
      <meshBasicMaterial
        color={environmentBackgroundColor(environment.type)}
        side={THREE.BackSide}
        depthTest={false}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function ARWorldTransform({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    if (arWalk.active) {
      g.position.set(arWalk.renderX, arWalk.renderY, arWalk.renderZ);
      g.rotation.set(0, arWalk.renderYaw, 0);
    } else {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
    }
  });
  return <group ref={group}>{children}</group>;
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

function TiledMapPreview({ viewer, groupRef }: { viewer: [number, number]; groupRef: React.Ref<THREE.Group> }) {
  const tracks = useStore((s) => s.composition.tracks);
  const map = useStore((s) => s.composition.map);
  const previews = debugFlag("debugNoLoopPreview") ? [] : tiledMapTransforms(map, viewer, TILE_PREVIEW_RADIUS);
  const tileLights = debugFlag("debugNoLoopPreview") ? tracks : tileLightTracks(map, tracks, viewer);

  return (
    <group ref={groupRef}>
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
        const elevationOffset = loopPreviewElevationOffset(map, preview);
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
    </group>
  );
}

// On a path-loop wrap the camera teleports, but the previews above are built
// from the `viewer` React state, which still holds the pre-wrap position for one
// frame — long enough to flash a copy that should already be distant. This runs
// after <Player> (so the wrap is already recorded) and blanks the preview group
// for that single frame; the next frame re-renders with the corrected viewer.
function LoopWrapBlipGuard({ groupRef }: { groupRef: React.RefObject<THREE.Group> }) {
  const seen = useRef(loopWrap.generation);
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    if (loopWrap.generation !== seen.current) {
      seen.current = loopWrap.generation;
      group.visible = false;
    } else {
      group.visible = true;
    }
  });
  return null;
}

// A fixed pool of point lights — one per track — that follows each stem's
// nearest visible preview copy. Base stems light their surroundings via the
// point light on their <TrackMarker>; preview copies omit that light because a
// real light per copy would churn the renderer's light count (every change
// recompiles materials). Keeping the count fixed at one-per-track and just
// repositioning/dimming them each frame avoids that churn while still lighting
// the room beyond a seam consistently with how close that copy *looks*.
function PreviewEchoLights({ map, tracks }: { map: CompositionMap; tracks: TrackDef[] }) {
  const engine = useStore((s) => s.engine);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const levels = useRef<number[]>([]);
  const intensities = useRef<number[]>([]);

  useFrame(({ camera }, dt) => {
    const listener: [number, number] = arWalk.active ? [viewState.x, viewState.z] : [camera.position.x, camera.position.z];
    const previews = tiledMapTransforms(map, listener, TILE_PREVIEW_RADIUS);
    for (let i = 0; i < tracks.length; i++) {
      const light = lights.current[i];
      if (!light) continue;
      const track = tracks[i];

      // The stem's nearest copy, by perceived distance, plus its lifted height.
      let nearestSq = Infinity;
      let nearestPos: [number, number, number] | null = null;
      for (const preview of previews) {
        const [px, pz] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        const distSq = (listener[0] - px) ** 2 + (listener[1] - pz) ** 2;
        if (distSq < nearestSq) {
          nearestSq = distSq;
          nearestPos = [px, track.position[1] + loopPreviewElevationOffset(map, preview), pz];
        }
      }

      const fade = nearestPos ? stemDistanceVisibility(map, Math.sqrt(nearestSq)) : 0;
      const level = engine?.level(track.id) ?? 0;
      const pulse = (levels.current[i] = THREE.MathUtils.damp(levels.current[i] ?? 0, level, 14, dt));
      const volume = track.volume ?? 1;
      // Match the base orb's point light so a copy lights a room the same way the
      // real stem would (see TrackMarker's `glow`), scaled by perceived fade.
      const target = (4.8 + volume * 3.2 + pulse * 44) * fade;
      // Never toggle `visible`: that drops the light from the renderer's count
      // and forces a recompile. Damp intensity to ~0 to fade it out in place.
      light.intensity = intensities.current[i] = THREE.MathUtils.damp(intensities.current[i] ?? 0, target, 10, dt);
      light.distance = 12 + volume * 8 + pulse * 16;
      light.color.set(track.color);
      if (nearestPos) light.position.set(nearestPos[0], nearestPos[1], nearestPos[2]);
    }
  });

  return (
    <group>
      {tracks.map((track, i) => (
        <pointLight key={track.id} ref={(l) => (lights.current[i] = l)} color={track.color} intensity={0} distance={18} />
      ))}
    </group>
  );
}

function stemDistanceVisibility(map: CompositionMap, distance: number): number {
  const start = map.tiling.type === "path-loop" ? PATH_LOOP_STEM_FADE_START : TILE_STEM_FADE_START;
  const end = map.tiling.type === "path-loop" ? PATH_LOOP_STEM_FADE_END : TILE_STEM_FADE_END;
  return distanceVisibility(distance, start, end);
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
        return [{ ...track, position: [x, track.position[1] + loopPreviewElevationOffset(map, preview), z] as [number, number, number] }];
      }),
  ]);
}

function previewMapVisibility(map: CompositionMap, preview: { anchor: [number, number] }, viewer: [number, number]): number {
  const distance = Math.hypot(viewer[0] - preview.anchor[0], viewer[1] - preview.anchor[1]);
  const start = map.tiling.type === "path-loop" ? PATH_LOOP_MAP_FADE_START : TILE_MAP_FADE_START;
  const end = map.tiling.type === "path-loop" ? PATH_LOOP_MAP_FADE_END : TILE_MAP_FADE_END;
  return distanceVisibility(distance, start, end);
}

function baseTrackVisibility(map: CompositionMap, track: TrackDef, viewer: [number, number]): number {
  const distance = Math.hypot(viewer[0] - track.position[0], viewer[1] - track.position[2]);
  return stemDistanceVisibility(map, distance);
}

function previewTrackVisibility(map: CompositionMap, preview: LoopPreviewTransform, track: TrackDef, viewer: [number, number]): number {
  const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
  const distance = Math.hypot(viewer[0] - x, viewer[1] - z);
  return stemDistanceVisibility(map, distance);
}

function distanceVisibility(distance: number, start: number, end: number): number {
  return 1 - THREE.MathUtils.smoothstep(distance, start, end);
}
