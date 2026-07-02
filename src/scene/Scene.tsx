import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { arWalk, loopPreviewGroups, loopWrap, markerAnimateFns, useStore, viewState, vrExplore } from "../store";
import { TrackMarker } from "./TrackMarker";
import { Player } from "./Player";
import { EditControls } from "./EditControls";
import { TrackGizmo } from "./TrackGizmo";
import { StemShapeHandles } from "./StemShapeHandles";
import { ListenerSync } from "./ListenerSync";
import { LightDirector } from "./LightDirector";
import { EnvironmentScene, environmentBackground } from "./EnvironmentScene";
import { MapScene } from "./MapScene";
import { DebugSampler } from "./DebugSampler";
import { ARWalkSession } from "./ARWalkSession";
import { VRExploreSession } from "./VRExploreSession";
import { CompositionMap, LoopPreviewTransform, fadeRadiiAt, loopPreviewElevationOffset, tiledMapTransforms, transformLoopPoint } from "../map";
import { TrackDef } from "../composition";
import { AudioEngine } from "../audio/AudioEngine";
import { debugEnabled, debugFlag } from "../debug";
import { effectiveFadeInner, effectiveFadeOuter, isFadeRadiusOverridden, radialFade, setCompositionFadeRadii, setCompositionVerticalFadeRadii, subscribeDebugFade, verticalFadeAtY } from "./fade";

const VIEWER_SAMPLE_DISTANCE = 0.75;
const TILE_PREVIEW_RADIUS = 180;
const PREVIEW_FADE_EPSILON = 0.003;
// Per-object visibility (base + preview stems, echo lights) uses the shared
// radial fade — see fade.ts and AGENTS.md "Radial fade". The map-copy fade below
// is deliberately separate: it fades a whole tiled/looped map copy by its anchor
// distance to hide the tiling seam, so it stays coupled to TILE_PREVIEW_RADIUS
// rather than the per-object gradient. Path-loop copies chain to fill the
// corridor (see tiledMapTransforms), so the floor stays solid through the
// near/medium distance and only fades out near the preview radius — a gentle
// far-horizon fade rather than a whole copy blinking in as the viewer crosses
// the seam.
const MAP_COPY_FADE_START = 85;
const MAP_COPY_FADE_END = 178;

export function Scene() {
  const tracks = useStore((s) => s.composition.tracks);
  const environment = useStore((s) => s.composition.environment);
  const map = useStore((s) => s.composition.map);
  const mode = useStore((s) => s.mode);
  const camera = useThree((s) => s.camera);
  const [viewer, setViewer] = useState<[number, number]>([0, 0]);
  const previewGroup = useRef<THREE.Group>(null);
  useFrame(() => {
    const next: [number, number] = arWalk.active || vrExplore.active ? [viewState.x, viewState.z] : [camera.position.x, camera.position.z];
    setViewer((current) => (Math.hypot(current[0] - next[0], current[1] - next[1]) > VIEWER_SAMPLE_DISTANCE ? next : current));
  });
  // Dragging the debug radius slider doesn't move the viewer, so without this
  // the memo below (base-marker fades) wouldn't recompute while standing still.
  const [, bumpFadeVersion] = useState(0);
  useEffect(() => subscribeDebugFade(() => bumpFadeVersion((v) => v + 1)), []);
  // Feed the active composition's authored radius into the shared fade module so
  // every radial-fade consumer (orbs, instances, fog, shaders) picks it up.
  // Clearing it on unmount returns to the engine defaults.
  const visibleRadius = map.visibleRadius;
  const hasFadePoints = !!map.fadePoints?.length;
  useEffect(() => {
    // With fade points authored, <FadeRadiusDriver> owns the band per frame.
    if (hasFadePoints) return;
    setCompositionFadeRadii(visibleRadius?.inner ?? null, visibleRadius?.outer ?? null);
    return () => setCompositionFadeRadii(null, null);
  }, [visibleRadius?.inner, visibleRadius?.outer, hasFadePoints]);
  const visibleRadiusVertical = map.visibleRadiusVertical;
  useEffect(() => {
    setCompositionVerticalFadeRadii(visibleRadiusVertical?.inner ?? null, visibleRadiusVertical?.outer ?? null);
    return () => setCompositionVerticalFadeRadii(null, null);
  }, [visibleRadiusVertical?.inner, visibleRadiusVertical?.outer]);
  const loopPreviewsEnabled = !debugFlag("debugNoLoopPreview");
  const tileLights = loopPreviewsEnabled ? tileLightTracks(map, tracks, viewer) : tracks;
  // On tiled/looped maps the canonical "base" stems are just one copy of the
  // repeated space, so in explore mode they distance-fade like preview copies
  // instead of sitting at full opacity on the horizon. Edit mode and untiled
  // maps keep base stems fully visible — UNLESS the debug radius slider is in
  // use, in which case base orbs fade too so the radius applies to everything.
  const fadeBaseMarkers =
    mode === "explore" && loopPreviewsEnabled && (map.tiling.type !== "none" || isFadeRadiusOverridden());
  return (
    <>
      {hasFadePoints && <FadeRadiusDriver map={map} />}
      <ARWorldTransform>
        <EnvironmentScene environment={environment} map={map} editMode={mode === "edit"} />
        {mode === "explore" && loopPreviewsEnabled && <TiledMapPreview viewer={viewer} groupRef={previewGroup} />}
        <TileBoundaryOverlay map={map} viewer={viewer} editMode={mode === "edit"} />
        <MapScene map={map} tracks={tracks} lightTracks={mode === "explore" ? tileLights : tracks} editMode={mode === "edit"} />
        {/* All stem point lights live in one budgeted pool — see lightBudget.ts. */}
        <LightDirector />

        {tracks.map((t) => {
          const fade = fadeBaseMarkers ? baseTrackVisibility(t, viewer) : 1;
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
          <StemShapeHandles />
        </>
      )}
      {/* Mounted after <Player> so its frame callback runs after the wrap is
          recorded; hides the preview group on the teleport frame. */}
      {mode === "explore" && loopPreviewsEnabled && <LoopWrapBlipGuard groupRef={previewGroup} />}
      <StemAnimationDriver />
      <ListenerSync />
      <ARWalkSession />
      <VRExploreSession />
      <ARBackdrop />
      <DebugSampler />
      {debugEnabled() && <FadeRadiusDebug />}
    </>
  );
}

// Single frame-loop driver for all TrackMarker animations. Replaces N per-marker
// useFrame hooks: reads all AnalyserNodes once, then fans out to each marker's
// registered callback. This keeps audio-thread cross-thread reads constant
// regardless of how many stems are on screen.
const EMPTY_LEVELS: Map<string, number> = new Map();
function StemAnimationDriver() {
  const engineRef = useRef<AudioEngine | null>(null);
  const engine = useStore((s) => s.engine);
  useEffect(() => { engineRef.current = engine; }, [engine]);
  useFrame(({ clock, camera }, dt) => {
    if (markerAnimateFns.size === 0) return;
    const levels = engineRef.current ? engineRef.current.getLevels() : EMPTY_LEVELS;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const elapsed = clock.elapsedTime;
    for (const animate of markerAnimateFns.values()) animate(dt, elapsed, levels, camX, camZ);
  });
  return null;
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
        color={environmentBackground(environment)}
        side={THREE.BackSide}
        depthTest={false}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// Two ground-plane rings showing the inner/outer radial fade radii.
// Only mounted in debug mode (?debug=1). Follows the camera each frame so the
// circles stay centred on the viewer as you walk.
function FadeRadiusDebug() {
  const camera = useThree((s) => s.camera);
  const innerRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const [radii, setRadii] = useState(() => ({ inner: effectiveFadeInner(), outer: effectiveFadeOuter() }));

  useEffect(() => subscribeDebugFade(() => {
    setRadii({ inner: effectiveFadeInner(), outer: effectiveFadeOuter() });
  }), []);

  useFrame(() => {
    const x = camera.position.x;
    const z = camera.position.z;
    if (innerRef.current) innerRef.current.position.set(x, 0.05, z);
    if (outerRef.current) outerRef.current.position.set(x, 0.05, z);
  });

  return (
    <>
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <ringGeometry args={[radii.inner - 0.3, radii.inner + 0.3, 96]} />
        <meshBasicMaterial color="#00ffaa" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={outerRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <ringGeometry args={[radii.outer - 0.3, radii.outer + 0.3, 128]} />
        <meshBasicMaterial color="#ff6600" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

function ARWorldTransform({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // AR Walk and immersive VR both let the headset own the real camera and
    // move the world instead; their sessions publish the same render offsets.
    const walk = arWalk.active ? arWalk : vrExplore.active ? vrExplore : null;
    if (walk) {
      g.position.set(walk.renderX, walk.renderY, walk.renderZ);
      g.rotation.set(0, walk.renderYaw, 0);
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
        const mapFade = previewMapVisibility(preview, viewer);
        const markerFades = tracks
          .map((track) => {
            const position = transformLoopPoint(preview, [track.position[0], track.position[2]]);
            return { track, position, fade: previewTrackVisibility(preview, track, viewer) };
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
    // Also blank any preview groups registered from below <EnvironmentScene>
    // (e.g. <SurfaceMapDressing>'s loop floor shells and environmental objects),
    // which can't host their own after-wrap guard because they mount before
    // <Player>. This component mounts after <Player>, so the generation bump is
    // already recorded when this runs.
    const wrapped = loopWrap.generation !== seen.current;
    seen.current = loopWrap.generation;
    const group = groupRef.current;
    if (group) group.visible = !wrapped;
    for (const previewGroup of loopPreviewGroups) previewGroup.visible = !wrapped;
  });
  return null;
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
        if (previewTrackVisibility(preview, track, viewer) <= PREVIEW_FADE_EPSILON) return [];
        const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
        return [{ ...track, position: [x, track.position[1] + loopPreviewElevationOffset(map, preview), z] as [number, number, number] }];
      }),
  ]);
}

// Per-frame owner of the visible-radius band when the map has authored fade
// points (M7.7): blends the points' bands at the listener position and feeds
// the shared fade module, which every consumer (orbs, fog, shaders, lights)
// already reads. Values are quantized to whole units so the fade listener set
// only fires while actually crossing a gradient, not every frame.
function FadeRadiusDriver({ map }: { map: CompositionMap }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => () => setCompositionFadeRadii(null, null), []);
  useFrame(() => {
    const at: [number, number] = arWalk.active || vrExplore.active ? [viewState.x, viewState.z] : [camera.position.x, camera.position.z];
    const radii = fadeRadiiAt(map, at);
    if (!radii) return;
    setCompositionFadeRadii(Math.round(radii.inner), Math.round(radii.outer));
  });
  return null;
}

// Structural fade for a whole tiled/looped map copy (see MAP_COPY_FADE_*); not
// the per-object radial fade.
function previewMapVisibility(preview: { anchor: [number, number] }, viewer: [number, number]): number {
  const distance = Math.hypot(viewer[0] - preview.anchor[0], viewer[1] - preview.anchor[1]);
  return radialFade(distance, MAP_COPY_FADE_START, MAP_COPY_FADE_END);
}

function baseTrackVisibility(track: TrackDef, viewer: [number, number]): number {
  return radialFade(Math.hypot(viewer[0] - track.position[0], viewer[1] - track.position[2])) * verticalFadeAtY(track.position[1]);
}

function previewTrackVisibility(preview: LoopPreviewTransform, track: TrackDef, viewer: [number, number]): number {
  const [x, z] = transformLoopPoint(preview, [track.position[0], track.position[2]]);
  return radialFade(Math.hypot(viewer[0] - x, viewer[1] - z)) * verticalFadeAtY(track.position[1] + (preview.elevationOffset ?? 0));
}
