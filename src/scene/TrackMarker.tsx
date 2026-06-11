import { MutableRefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import { Billboard, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { StemShape, TrackDef } from "../composition";
import { isPointInsideMap, surfaceHeightAt } from "../map";
import { markerAnimateFns, markerObjects, useStore } from "../store";
import { UNDERFLOOR_HEIGHT } from "./mapHeights";
import { radialFade } from "./fade";
import { debugFlag } from "../debug";
import { unregisterMarkerDebug, updateMarkerDebug } from "./markerDebug";
import { useShallow } from "zustand/react/shallow";

// A stem marker: the 3D presence of an audio stem in the scene.
// TrackMarker owns interaction (click-to-select, gizmo registration) and
// structural overlays (falloff map, directivity guide, selection ring, label).
// All visual rendering — geometry, glow, point light — lives entirely within
// each shape component (OrbVisual, PillarVisual, WallVisual, RiverVisual).
export function TrackMarker({
  track,
  preview = false,
  fade = 1,
  debugId,
  debugPosition,
}: {
  track: TrackDef;
  preview?: boolean;
  fade?: number;
  debugId?: string;
  debugPosition?: [number, number];
}) {
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => !preview && s.selectedId === track.id);
  const floorY = useStore(
    useShallow((s) => {
      const [px, , pz] = track.position;
      const m = s.composition.map;
      const inside = !m.segments.length || isPointInsideMap(m, [px, pz]);
      return inside ? surfaceHeightAt(m, [px, pz]) : UNDERFLOOR_HEIGHT;
    }),
  );
  const ring = useRef<THREE.Mesh>(null);
  const smoothedLevel = useRef(0);
  const [x, stemY, z] = track.position;
  const markerDebugId = debugId ?? `base:${track.id}`;
  const markerDebugPosition: [number, number] = debugPosition ?? [x, z];

  useEffect(() => () => unregisterMarkerDebug(markerDebugId), [markerDebugId]);

  // Keep latest per-render values accessible from the animation callback without
  // stale closures. The callback is registered once per markerDebugId; liveRef
  // ensures it always sees current props/state.
  const liveRef = useRef({ fade, markerDebugId, markerDebugPosition, trackId: track.id });
  useLayoutEffect(() => {
    liveRef.current = { fade, markerDebugId, markerDebugPosition, trackId: track.id };
  });

  // animateRef holds the per-frame work driven by StemAnimationDriver: update
  // smoothedLevel (used by the shape visual) and push debug data.
  const animateRef = useRef<((dt: number, elapsed: number, levels: Map<string, number>, camX: number, camZ: number) => void) | null>(null);
  animateRef.current = (dt, _elapsed, levels, camX, camZ) => {
    const { fade: currentFade, markerDebugId: mdi, markerDebugPosition: mdp, trackId } = liveRef.current;
    const level = levels.get(trackId) ?? 0;
    smoothedLevel.current = THREE.MathUtils.damp(smoothedLevel.current, level, 14, dt);
    const listenerDist = Math.hypot(camX - mdp[0], camZ - mdp[1]);
    updateMarkerDebug({
      id: mdi,
      trackId,
      kind: preview ? "preview" : "base",
      fade: currentFade,
      targetFade: currentFade,
      distance: listenerDist,
      updatedAt: performance.now(),
    });
  };

  // Stable wrapper registered once per markerDebugId — survives re-renders
  // without churn in the global registry.
  useEffect(() => {
    const key = markerDebugId;
    markerAnimateFns.set(key, (dt, elapsed, levels, camX, camZ) => {
      animateRef.current?.(dt, elapsed, levels, camX, camZ);
    });
    return () => { markerAnimateFns.delete(key); };
  }, [markerDebugId]);

  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 1.5;
  });

  // Selection only happens in edit mode; in explore the click locks the pointer.
  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (preview || useStore.getState().mode !== "edit") return;
    e.stopPropagation();
    useStore.getState().select(track.id);
  }

  function setCursor(c: string) {
    if (!preview && useStore.getState().mode === "edit") document.body.style.cursor = c;
  }

  // Register/unregister this marker's object for the move-gizmo to target.
  const registerGroup = useCallback(
    (g: THREE.Group | null) => {
      if (preview) return;
      if (g) markerObjects.set(track.id, g);
      else markerObjects.delete(track.id);
    },
    [preview, track.id],
  );

  const showPointLight = !preview && !debugFlag("debugNoPointLights");

  return (
    <group
      ref={registerGroup}
      position={[x, stemY, z]}
      onClick={handleClick}
      onPointerOver={() => setCursor("pointer")}
      onPointerOut={() => setCursor("auto")}
    >
      {mode === "edit" && selected && (
        // Near/Far rings and the directivity guide ride at the stem's elevation
        // so they stay visible where those properties are actually adjusted.
        <group position={[0, 0, 0]}>
          <FalloffMap track={track} />
          {track.directivity && <DirectivityGuide track={track} />}
        </group>
      )}
      <StemShapeVisual
        track={track}
        smoothedLevel={smoothedLevel}
        preview={preview}
        fade={fade}
        showPointLight={showPointLight}
        floorY={floorY}
        mode={mode}
        selected={selected}
      />
      {selected && (
        <mesh ref={ring} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.045, 10, 56]} />
          <meshBasicMaterial color="white" toneMapped={false} />
        </mesh>
      )}
      {mode === "edit" && (
        <Billboard position={[0, 1.5, 0]}>
          <Text fontSize={0.5} color="white" anchorX="center">
            {track.name}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

// Dispatches to the appropriate shape visual. Every shape — including the orb —
// is a first-class peer here; there is no implicit default.
function StemShapeVisual({
  track,
  smoothedLevel,
  preview,
  fade,
  showPointLight,
  floorY,
  mode,
  selected,
}: {
  track: TrackDef;
  smoothedLevel: MutableRefObject<number>;
  preview: boolean;
  fade: number;
  showPointLight: boolean;
  floorY: number;
  mode: string;
  selected: boolean;
}) {
  const shape = track.stemShape;
  const kind = shape?.kind ?? "orb";

  if (kind === "orb") {
    return (
      <OrbVisual
        track={track}
        smoothedLevel={smoothedLevel}
        preview={preview}
        fade={fade}
        showPointLight={showPointLight}
        floorY={floorY}
        mode={mode}
        selected={selected}
      />
    );
  }
  if (kind === "pillar") {
    return <PillarVisual track={track} smoothedLevel={smoothedLevel} showPointLight={showPointLight} mode={mode} />;
  }
  if (kind === "wall" && shape?.kind === "wall") {
    return <WallVisual track={track} shape={shape} smoothedLevel={smoothedLevel} showPointLight={showPointLight} mode={mode} />;
  }
  if (kind === "river" && shape?.kind === "river") {
    return <RiverVisual track={track} shape={shape} smoothedLevel={smoothedLevel} showPointLight={showPointLight} mode={mode} />;
  }
  return null;
}

// The omnidirectional stem shape: a glowing orb that pulses with its audio
// level, acting as a visual anchor for the sound coming from that direction.
function OrbVisual({
  track,
  smoothedLevel,
  preview,
  fade,
  showPointLight,
  floorY,
  mode,
  selected,
}: {
  track: TrackDef;
  smoothedLevel: MutableRefObject<number>;
  preview: boolean;
  fade: number;
  showPointLight: boolean;
  floorY: number;
  mode: string;
  selected: boolean;
}) {
  const core = useRef<THREE.Mesh>(null);
  const aura = useRef<THREE.Mesh>(null);
  const outerAura = useRef<THREE.Mesh>(null);
  const footprint = useRef<THREE.Mesh>(null);
  const flare = useRef<THREE.ShaderMaterial>(null);
  const rays = useRef<THREE.ShaderMaterial>(null);
  const starburst = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const visibleFade = useRef(preview ? 0 : fade);

  const volume = track.volume ?? 1;
  const orbRadius = 0.42 + volume * 0.32;
  const seed = useMemo(() => trackSeed(track.id), [track.id]);
  const [x, stemY, z] = track.position;
  const footprintHeight = floorY - stemY + 0.08;
  const showFlare = !debugFlag("debugNoFlare");
  const showStarRays = !debugFlag("debugNoStarRays");

  // Stale-closure avoidance for the useFrame callback, same pattern as
  // TrackMarker's animateRef.
  const liveRef = useRef({ fade, mode, selected, volume, seed, x, z });
  useLayoutEffect(() => {
    liveRef.current = { fade, mode, selected, volume, seed, x, z };
  });

  useFrame(({ camera, clock }, dt) => {
    const { fade: currentFade, mode: currentMode, selected: isSelected, volume: vol, seed: s, x: px, z: pz } = liveRef.current;
    const pulse = smoothedLevel.current;
    const elapsed = clock.elapsedTime;
    const breath = 1 + Math.sin(elapsed * 0.9 + s + px * 0.2 + pz * 0.13) * 0.035;

    visibleFade.current = preview
      ? THREE.MathUtils.damp(visibleFade.current, currentFade, currentFade > visibleFade.current ? 3.8 : 8, dt)
      : currentFade;
    const renderedFade = visibleFade.current;
    // Additive glare layers read as bright even at low opacity, so square the
    // fade so they're genuinely invisible at the bottom of the fade-in.
    const opticalFade = renderedFade * renderedFade;

    if (core.current) {
      core.current.scale.setScalar(breath + pulse * 0.85);
      const material = core.current.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = renderedFade;
    }
    if (footprint.current) {
      const material = footprint.current.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.28 * renderedFade;
    }
    if (aura.current) {
      aura.current.scale.setScalar(1.35 + pulse * 1.45);
      const material = aura.current.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = (0.22 + pulse * 0.3) * opticalFade;
    }
    if (outerAura.current) {
      outerAura.current.scale.setScalar(2.1 + pulse * 2.2);
      const material = outerAura.current.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = (0.08 + pulse * 0.18) * opticalFade;
    }
    if (flare.current) {
      flare.current.uniforms.opacity.value = (0.5 + pulse * 0.45) * opticalFade;
      flare.current.uniforms.radius.value = 0.42 + pulse * 0.18;
    }
    if (rays.current) {
      rays.current.uniforms.opacity.value = (0.38 + pulse * 0.52) * opticalFade;
      rays.current.uniforms.radius.value = 0.22 + pulse * 0.1;
    }
    if (starburst.current) {
      starburst.current.rotation.z =
        s +
        Math.sin(elapsed * 0.075 + s * 1.7) * 0.85 +
        Math.sin(elapsed * 0.031 + s * 4.1) * 0.55;
    }
    if (glow.current) {
      // Cull the point light by the radial fade: drop it from the renderer's
      // active light set once the stem is beyond the fade band. At that range a
      // light with reach ~18 only illuminates geometry that is itself faded to
      // the void, so the cull is visually free — but it removes that light's
      // per-fragment cost. Intensity is faded to ~0 before `visible` flips, so
      // the cull never pops. Editing keeps every light so the author sees the
      // whole scene.
      const listenerDist = Math.hypot(camera.position.x - px, camera.position.z - pz);
      const lightFade = currentMode === "edit" ? 1 : radialFade(listenerDist);
      glow.current.visible = lightFade > 0.002;
      if (glow.current.visible) {
        glow.current.intensity = ((isSelected ? 8 : 4.8) + vol * 3.2 + pulse * 44) * renderedFade * lightFade;
        glow.current.distance = 12 + vol * 8 + pulse * 16;
      }
    }
  });

  return (
    <>
      <mesh ref={footprint} position={[0, footprintHeight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[orbRadius * 0.95, orbRadius * 1.55, 48]} />
        <meshBasicMaterial color={track.color} transparent opacity={0.28} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={aura} position={[0, 0, 0]}>
        <sphereGeometry args={[orbRadius, 24, 16]} />
        <meshBasicMaterial color={track.color} transparent opacity={0.18} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={outerAura} position={[0, 0, 0]}>
        <sphereGeometry args={[orbRadius, 24, 16]} />
        <meshBasicMaterial color={track.color} transparent opacity={0.1} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <Billboard position={[0, 0, 0]}>
        {showFlare && (
          <mesh scale={[orbRadius * 5.6, orbRadius * 5.6, 1]}>
            <circleGeometry args={[0.5, 64]} />
            <shaderMaterial
              ref={flare}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              uniforms={{
                color: { value: new THREE.Color(track.color) },
                opacity: { value: 0.5 },
                radius: { value: 0.42 },
              }}
              vertexShader={flareVertexShader}
              fragmentShader={flareFragmentShader}
            />
          </mesh>
        )}
        {showStarRays && (
          <mesh ref={starburst} scale={[orbRadius * 10.8, orbRadius * 10.8, 1]} rotation={[0, 0, seed]}>
            <circleGeometry args={[0.5, 64]} />
            <shaderMaterial
              ref={rays}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              uniforms={{
                color: { value: new THREE.Color(track.color) },
                opacity: { value: 0.38 },
                radius: { value: 0.22 },
              }}
              vertexShader={flareVertexShader}
              fragmentShader={starRayFragmentShader}
            />
          </mesh>
        )}
      </Billboard>
      <mesh ref={core} position={[0, 0, 0]}>
        <sphereGeometry args={[orbRadius * 0.62, 32, 20]} />
        <meshBasicMaterial color="white" transparent={preview || fade < 0.999} opacity={preview ? 0 : fade} toneMapped={false} depthWrite={!preview && fade >= 0.999} />
      </mesh>
      {showPointLight && <pointLight ref={glow} position={[0, 0, 0]} color={track.color} intensity={6} distance={18} />}
    </>
  );
}

const PILLAR_HEIGHT = 60;
const PILLAR_RADIUS = 0.18;
const PILLAR_GLOW_RADIUS = PILLAR_RADIUS * 4.5;

// A luminous column: thin bright shaft with a soft ambient glow that expands
// radially on beats.
function PillarVisual({
  track,
  smoothedLevel,
  showPointLight,
  mode,
}: {
  track: TrackDef;
  smoothedLevel: MutableRefObject<number>;
  showPointLight: boolean;
  mode: string;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const color = useMemo(() => new THREE.Color(track.color), [track.color]);
  const volume = track.volume ?? 1;

  useFrame(({ camera }) => {
    const [x, , z] = track.position;
    const dist = Math.hypot(camera.position.x - x, camera.position.z - z);
    const fade = radialFade(dist);
    const visible = fade > 0.002;
    const pulse = smoothedLevel.current;
    const fadeSq = fade * fade;

    if (coreRef.current) {
      coreRef.current.visible = visible;
      if (visible) (coreRef.current.material as THREE.MeshBasicMaterial).opacity = (0.55 + pulse * 0.45) * fadeSq;
    }
    if (glowRef.current) {
      glowRef.current.visible = visible;
      if (visible) {
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = (0.07 + pulse * 0.22) * fadeSq;
        const s = 1 + pulse * 0.55;
        glowRef.current.scale.set(s, 1, s);
      }
    }
    if (lightRef.current) {
      const lightFade = mode === "edit" ? 1 : fade;
      lightRef.current.visible = lightFade > 0.002;
      if (lightRef.current.visible) {
        lightRef.current.intensity = (1.5 + volume * 1.2 + pulse * 12) * lightFade;
        lightRef.current.distance = 7 + volume * 3 + pulse * 7;
      }
    }
  });

  return (
    <>
      <mesh ref={glowRef} position={[0, 0, 0]}>
        <cylinderGeometry args={[PILLAR_GLOW_RADIUS, PILLAR_GLOW_RADIUS, PILLAR_HEIGHT, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.07} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={coreRef} position={[0, 0, 0]}>
        <cylinderGeometry args={[PILLAR_RADIUS, PILLAR_RADIUS, PILLAR_HEIGHT, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {showPointLight && <pointLight ref={lightRef} position={[0, 0, 0]} color={track.color} intensity={2} distance={10} />}
    </>
  );
}

const WALL_HEIGHT = 7;

// A luminous panel: both faces pulse with the music, the bright face more
// dramatically than the dim back face.
function WallVisual({
  track,
  shape,
  smoothedLevel,
  showPointLight,
  mode,
}: {
  track: TrackDef;
  shape: Extract<StemShape, { kind: "wall" }>;
  smoothedLevel: MutableRefObject<number>;
  showPointLight: boolean;
  mode: string;
}) {
  const frontRef = useRef<THREE.Mesh>(null);
  const backRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const color = useMemo(() => new THREE.Color(track.color), [track.color]);
  const volume = track.volume ?? 1;

  // Rotate the panel so that +Z of the mesh faces the wall's `facing` direction.
  const rotation = useMemo(() => {
    const [fx, fz] = shape.facing;
    return new THREE.Euler(0, Math.atan2(fx, fz), 0);
  }, [shape.facing]);

  useFrame(({ camera }) => {
    const [x, , z] = track.position;
    const dist = Math.hypot(camera.position.x - x, camera.position.z - z);
    const fade = radialFade(dist);
    const visible = fade > 0.002;
    const pulse = smoothedLevel.current;
    const fadeSq = fade * fade;

    if (frontRef.current) {
      frontRef.current.visible = visible;
      if (visible) (frontRef.current.material as THREE.MeshBasicMaterial).opacity = (0.38 + pulse * 0.42) * fadeSq;
    }
    if (backRef.current) {
      backRef.current.visible = visible;
      if (visible) (backRef.current.material as THREE.MeshBasicMaterial).opacity = (0.1 + pulse * 0.15) * fadeSq;
    }
    if (lightRef.current) {
      const lightFade = mode === "edit" ? 1 : fade;
      lightRef.current.visible = lightFade > 0.002;
      if (lightRef.current.visible) {
        lightRef.current.intensity = (1.5 + volume * 1.2 + pulse * 12) * lightFade;
        lightRef.current.distance = 7 + volume * 3 + pulse * 7;
      }
    }
  });

  return (
    <group rotation={rotation}>
      {/* front face — bright, pulses with music */}
      <mesh ref={frontRef} position={[0, 0, 0.08]}>
        <planeGeometry args={[shape.width, WALL_HEIGHT]} />
        <meshBasicMaterial color={color} transparent opacity={0.38} side={THREE.FrontSide} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* back face — dim */}
      <mesh ref={backRef} position={[0, 0, -0.08]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[shape.width, WALL_HEIGHT]} />
        <meshBasicMaterial color={color} transparent opacity={0.1} side={THREE.FrontSide} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {showPointLight && <pointLight ref={lightRef} position={[0, 0, 0]} color={track.color} intensity={2} distance={10} />}
    </group>
  );
}

const RIVER_RADIUS = 0.22;
const RIVER_SEGMENTS = 6;
const RIVER_GLOW_RADIUS = RIVER_RADIUS * 4;

// A luminous tube: thin bright core with a soft glow tube that expands on beats.
function RiverVisual({
  track,
  shape,
  smoothedLevel,
  showPointLight,
  mode,
}: {
  track: TrackDef;
  shape: Extract<StemShape, { kind: "river" }>;
  smoothedLevel: MutableRefObject<number>;
  showPointLight: boolean;
  mode: string;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const color = useMemo(() => new THREE.Color(track.color), [track.color]);
  const volume = track.volume ?? 1;

  // The group sits at track.position; express the end in local space.
  const [x, stemY, z] = track.position;
  const localEnd = useMemo(
    () => new THREE.Vector3(shape.end[0] - x, shape.end[1] - stemY, shape.end[2] - z),
    [shape.end, x, stemY, z],
  );
  const midpoint = useMemo(() => localEnd.clone().multiplyScalar(0.5), [localEnd]);
  const length = useMemo(() => localEnd.length(), [localEnd]);
  const rotation = useMemo(() => {
    // Align cylinder Y-axis with the river direction.
    const dir = localEnd.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return new THREE.Euler().setFromQuaternion(quaternion);
  }, [localEnd]);

  useFrame(({ camera }) => {
    const midX = x + midpoint.x, midZ = z + midpoint.z;
    const dist = Math.hypot(camera.position.x - midX, camera.position.z - midZ);
    const fade = radialFade(dist);
    const visible = fade > 0.002;
    const pulse = smoothedLevel.current;
    const fadeSq = fade * fade;

    if (coreRef.current) {
      coreRef.current.visible = visible;
      if (visible) (coreRef.current.material as THREE.MeshBasicMaterial).opacity = (0.5 + pulse * 0.45) * fadeSq;
    }
    if (glowRef.current) {
      glowRef.current.visible = visible;
      if (visible) {
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = (0.07 + pulse * 0.2) * fadeSq;
        const s = 1 + pulse * 0.55;
        glowRef.current.scale.set(s, 1, s);
      }
    }
    if (lightRef.current) {
      const lightFade = mode === "edit" ? 1 : fade;
      lightRef.current.visible = lightFade > 0.002;
      if (lightRef.current.visible) {
        lightRef.current.intensity = (1.5 + volume * 1.2 + pulse * 12) * lightFade;
        lightRef.current.distance = 7 + volume * 3 + pulse * 7;
      }
    }
  });

  return (
    <group position={midpoint} rotation={rotation}>
      <mesh ref={glowRef}>
        <cylinderGeometry args={[RIVER_GLOW_RADIUS, RIVER_GLOW_RADIUS, length, RIVER_SEGMENTS]} />
        <meshBasicMaterial color={color} transparent opacity={0.07} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={coreRef}>
        <cylinderGeometry args={[RIVER_RADIUS, RIVER_RADIUS, length, RIVER_SEGMENTS]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {showPointLight && <pointLight ref={lightRef} position={[0, 0, 0]} color={track.color} intensity={2} distance={10} />}
    </group>
  );
}

function DirectivityGuide({ track }: { track: TrackDef }) {
  const directivity = track.directivity;
  if (!directivity) return null;
  const outerAngle = Math.min(360, directivity.width + directivity.dispersion);
  const halfAngle = outerAngle * Math.PI / 360;
  const [x, z] = directivity.direction;
  const rotate = (angle: number): [number, number] => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [x * c + z * s, -x * s + z * c];
  };
  const left = rotate(-halfAngle);
  const right = rotate(halfAngle);
  const length = Math.min(track.maxDistance ?? 40, 8);
  const y = 0.14;
  return (
    <group>
      <Line points={[[0, y, 0], [x * length, y, z * length]]} color={track.color} lineWidth={2.4} transparent opacity={0.95} />
      {outerAngle < 359 && (
        <>
          <Line points={[[0, y, 0], [left[0] * length, y, left[1] * length]]} color={track.color} lineWidth={1.4} transparent opacity={0.58} />
          <Line points={[[0, y, 0], [right[0] * length, y, right[1] * length]]} color={track.color} lineWidth={1.4} transparent opacity={0.58} />
        </>
      )}
    </group>
  );
}

function trackSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash / 0xffffffff) * Math.PI * 2;
}

function FalloffMap({ track }: { track: TrackDef }) {
  const near = track.refDistance ?? 4;
  const far = Math.max(track.maxDistance ?? 40, near + 1);
  const rolloff = track.rolloff ?? 1;

  function clearSelection(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    useStore.getState().select(null);
  }

  return (
    <group
      position={[0, 0.035, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={clearSelection}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "auto";
      }}
    >
      <mesh>
        <ringGeometry args={[near, far, 96, 12]} />
        <shaderMaterial
          key={`${near}-${far}-${rolloff}`}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            nearRadius: { value: near },
            farRadius: { value: far },
            rolloff: { value: rolloff },
            nearColor: { value: new THREE.Color("#62f0c8") },
            farColor: { value: new THREE.Color("#ff7a6b") },
          }}
          vertexShader={falloffVertexShader}
          fragmentShader={falloffFragmentShader}
        />
      </mesh>
      <mesh>
        <torusGeometry args={[near, 0.04, 8, 128]} />
        <meshBasicMaterial color="#62f0c8" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[far, 0.04, 8, 160]} />
        <meshBasicMaterial color="#ff7a6b" transparent opacity={0.75} toneMapped={false} />
      </mesh>
    </group>
  );
}

const falloffVertexShader = `
  varying vec2 vPos;

  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flareVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flareFragmentShader = `
  uniform vec3 color;
  uniform float opacity;
  uniform float radius;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - vec2(0.5);
    float d = length(p);
    float core = 1.0 - smoothstep(0.0, radius, d);
    float haze = exp(-d * 5.6);
    if (d >= 0.5) discard;
    float edge = 1.0 - smoothstep(0.4, 0.5, d);
    float alpha = (core * 0.85 + haze * 0.38) * opacity * edge;
    if (alpha < 0.001) discard;
    vec3 hot = mix(color, vec3(1.0), core * 0.72);
    gl_FragColor = vec4(hot, alpha);
  }
`;

const starRayFragmentShader = `
  uniform vec3 color;
  uniform float opacity;
  uniform float radius;
  varying vec2 vUv;

  float ray(vec2 p, vec2 dir, float width, float length, float strength) {
    float along = dot(p, dir);
    float across = abs(dot(p, vec2(-dir.y, dir.x)));
    float body = exp(-across * width) * (1.0 - smoothstep(0.02, length, along));
    return body * step(0.0, along) * strength;
  }

  void main() {
    vec2 p = vUv - vec2(0.5);
    float d = length(p);
    float rays = 0.0;
    rays += ray(p, normalize(vec2( 1.00,  0.06)), 52.0, 0.52, 1.00);
    rays += ray(p, normalize(vec2(-1.00, -0.14)), 42.0, 0.38, 0.58);
    rays += ray(p, normalize(vec2( 0.10,  1.00)), 48.0, 0.46, 0.82);
    rays += ray(p, normalize(vec2(-0.16, -1.00)), 58.0, 0.30, 0.46);
    rays += ray(p, normalize(vec2( 0.72,  0.70)), 66.0, 0.34, 0.54);
    rays += ray(p, normalize(vec2(-0.62, -0.78)), 54.0, 0.44, 0.72);
    rays += ray(p, normalize(vec2(-0.74,  0.66)), 70.0, 0.28, 0.38);
    rays += ray(p, normalize(vec2( 0.58, -0.82)), 46.0, 0.40, 0.62);
    float center = 1.0 - smoothstep(0.0, radius, d);
    if (d >= 0.5) discard;
    float edge = 1.0 - smoothstep(0.42, 0.5, d);
    float alpha = (rays + center * 0.5) * edge * opacity;
    if (alpha < 0.001) discard;
    vec3 hot = mix(color, vec3(1.0), center * 0.85);
    gl_FragColor = vec4(hot, alpha);
  }
`;

const falloffFragmentShader = `
  uniform float nearRadius;
  uniform float farRadius;
  uniform float rolloff;
  uniform vec3 nearColor;
  uniform vec3 farColor;
  varying vec2 vPos;

  void main() {
    float distanceFromStem = length(vPos);
    float t = clamp((distanceFromStem - nearRadius) / max(farRadius - nearRadius, 0.001), 0.0, 1.0);
    float shaped = 1.0 - exp(-t * max(rolloff, 0.001) * 2.5);
    vec3 color = mix(nearColor, farColor, shaped);
    float edgeFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.92, 1.0, t));
    float opacity = mix(0.18, 0.42, shaped) * edgeFade;
    gl_FragColor = vec4(color, opacity);
  }
`;
