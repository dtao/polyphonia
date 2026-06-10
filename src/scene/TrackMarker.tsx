import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ThreeEvent } from "@react-three/fiber";
import { Billboard, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { isPointInsideMap, surfaceHeightAt } from "../map";
import { markerAnimateFns, markerObjects, useStore } from "../store";
import { UNDERFLOOR_HEIGHT } from "./mapHeights";
import { radialFade } from "./fade";
import { debugFlag } from "../debug";
import { unregisterMarkerDebug, updateMarkerDebug } from "./markerDebug";
import { useShallow } from "zustand/react/shallow";

// A glowing orb that marks where a stem lives in space and pulses with its
// audio level — a visual anchor for the sound you hear from that direction.
// In edit mode it can be clicked to select; the selected track wears a ring.
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
  // Narrow map subscription: only re-render when the two derived values that
  // actually depend on this stem's position change, not on every map edit.
  const { onWalkablePath, floorY } = useStore(
    useShallow((s) => {
      const [px, , pz] = track.position;
      const m = s.composition.map;
      const inside = !m.segments.length || isPointInsideMap(m, [px, pz]);
      return {
        onWalkablePath: inside,
        floorY: inside ? surfaceHeightAt(m, [px, pz]) : UNDERFLOOR_HEIGHT,
      };
    }),
  );
  const core = useRef<THREE.Mesh>(null);
  const aura = useRef<THREE.Mesh>(null);
  const outerAura = useRef<THREE.Mesh>(null);
  const footprint = useRef<THREE.Mesh>(null);
  const flare = useRef<THREE.ShaderMaterial>(null);
  const rays = useRef<THREE.ShaderMaterial>(null);
  const starburst = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const ring = useRef<THREE.Mesh>(null);
  const smoothedLevel = useRef(0);
  const visibleFade = useRef(preview ? 0 : fade);
  const seed = useMemo(() => trackSeed(track.id), [track.id]);
  const [x, stemY, z] = track.position;
  // The group rides at the stem's elevation (so the move gizmo's Y handle edits
  // it). The footprint ring stays on the floor below, so its local offset is the
  // gap down from the orb to the walkable surface (or the void for off-path).
  const footprintHeight = floorY - stemY + 0.08;
  const volume = track.volume ?? 1;
  const orbRadius = 0.42 + volume * 0.32;
  const showPointLight = !preview && !debugFlag("debugNoPointLights");
  const showFlare = !debugFlag("debugNoFlare");
  const showStarRays = !debugFlag("debugNoStarRays");
  const markerDebugId = debugId ?? `base:${track.id}`;
  const markerDebugPosition = debugPosition ?? [x, z];

  useEffect(() => () => unregisterMarkerDebug(markerDebugId), [markerDebugId]);

  // Keep latest per-render values accessible from the animation callback without
  // stale closures. The callback is registered once per markerDebugId; liveRef
  // ensures it always sees current props/state.
  const liveRef = useRef({ fade, mode, selected, volume, seed, x, z, markerDebugId, markerDebugPosition });
  useLayoutEffect(() => {
    liveRef.current = { fade, mode, selected, volume, seed, x, z, markerDebugId, markerDebugPosition };
  });

  // animateRef holds the actual per-frame work. Reassigned each render so it
  // always captures current refs — the stable wrapper below calls it indirectly.
  const animateRef = useRef<((dt: number, elapsed: number, levels: Map<string, number>, camX: number, camZ: number) => void) | null>(null);
  animateRef.current = (dt, elapsed, levels, camX, camZ) => {
    const { fade: currentFade, mode: currentMode, selected: isSelected, volume: vol, seed: s, x: px, z: pz, markerDebugId: mdi, markerDebugPosition: mdp } = liveRef.current;
    const level = levels.get(track.id) ?? 0;
    smoothedLevel.current = THREE.MathUtils.damp(smoothedLevel.current, level, 14, dt);
    visibleFade.current = preview
      ? THREE.MathUtils.damp(visibleFade.current, currentFade, currentFade > visibleFade.current ? 3.8 : 8, dt)
      : currentFade;
    const pulse = smoothedLevel.current;
    const breath = 1 + Math.sin(elapsed * 0.9 + s + px * 0.2 + pz * 0.13) * 0.035;
    const renderedFade = visibleFade.current;
    // Additive glare layers (aura, flare, rays) read as bright even at low
    // opacity on the black void, so a linear/sqrt fade makes them appear to
    // pop in well before the orb is "really" visible. Square the fade so the
    // bottom of the fade-in is genuinely invisible; the solid white core stays
    // on the linear fade below.
    const opticalFade = renderedFade * renderedFade;
    const listenerDist = Math.hypot(camX - mdp[0], camZ - mdp[1]);
    updateMarkerDebug({
      id: mdi,
      trackId: track.id,
      kind: preview ? "preview" : "base",
      fade: renderedFade,
      targetFade: currentFade,
      distance: listenerDist,
      updatedAt: performance.now(),
    });
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
      // per-fragment cost. This is what keeps a 50-stem map from shading 50
      // lights on every lit pixel (the tunnel-walls slowdown); only stems near
      // the listener stay lit. Editing keeps every light so the author sees the
      // whole scene. Intensity is faded to ~0 before `visible` flips, so the
      // cull never pops. Fewer stems within the radius ⇒ fewer active lights ⇒
      // cheaper, which is why shrinking the fade radius lowers the cost.
      const lightFade = currentMode === "edit" ? 1 : radialFade(listenerDist);
      glow.current.visible = lightFade > 0.002;
      if (glow.current.visible) {
        glow.current.intensity = ((isSelected ? 8 : 4.8) + vol * 3.2 + pulse * 44) * renderedFade * lightFade;
        glow.current.distance = 12 + vol * 8 + pulse * 16;
      }
    }
    if (ring.current) ring.current.rotation.z += dt * 1.5;
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

  return (
    <group
      ref={registerGroup}
      position={[x, stemY, z]}
      onClick={handleClick}
      onPointerOver={() => setCursor("pointer")}
      onPointerOut={() => setCursor("auto")}
    >
      {mode === "edit" && selected && (
        // Near/Far rings and the directivity guide ride at the orb's elevation
        // (offset 0 from this group, which already sits at stemY) so they stay
        // visible where those properties are actually adjusted — not stranded on
        // the floor below an elevated stem.
        <group position={[0, 0, 0]}>
          <FalloffMap track={track} />
          {track.directivity && <DirectivityGuide track={track} />}
        </group>
      )}
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
      {/* selection ring */}
      {selected && (
        <mesh ref={ring} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.045, 10, 56]} />
          <meshBasicMaterial color="white" toneMapped={false} />
        </mesh>
      )}
      {showPointLight && <pointLight ref={glow} position={[0, 0, 0]} color={track.color} intensity={6} distance={18} />}
      {mode === "edit" && (
        <Billboard position={[0, orbRadius + 0.75, 0]}>
          <Text fontSize={0.5} color="white" anchorX="center">
            {track.name}
          </Text>
        </Billboard>
      )}
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
