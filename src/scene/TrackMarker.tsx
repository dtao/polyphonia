import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { isPointInsideMap, surfaceHeightAt } from "../map";
import { markerObjects, useStore } from "../store";
import { UNDERFLOOR_HEIGHT } from "./mapHeights";
import { debugFlag } from "../debug";
import { unregisterMarkerDebug, updateMarkerDebug } from "./markerDebug";

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
  const engine = useStore((s) => s.engine);
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => !preview && s.selectedId === track.id);
  const map = useStore((s) => s.composition.map);
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
  const onWalkablePath = !map.segments.length || isPointInsideMap(map, [x, z]);
  // The group rides at the stem's elevation (so the move gizmo's Y handle edits
  // it). The footprint ring stays on the floor below, so its local offset is the
  // gap down from the orb to the walkable surface (or the void for off-path).
  const floorY = onWalkablePath ? surfaceHeightAt(map, [x, z]) : UNDERFLOOR_HEIGHT;
  const footprintHeight = floorY - stemY + 0.08;
  const volume = track.volume ?? 1;
  const orbRadius = 0.42 + volume * 0.32;
  const showPointLight = !preview && !debugFlag("debugNoPointLights");
  const showFlare = !debugFlag("debugNoFlare");
  const showStarRays = !debugFlag("debugNoStarRays");
  const markerDebugId = debugId ?? `base:${track.id}`;
  const markerDebugPosition = debugPosition ?? [x, z];

  useEffect(() => () => unregisterMarkerDebug(markerDebugId), [markerDebugId]);

  useFrame(({ clock, camera }, dt) => {
    const level = engine?.level(track.id) ?? 0;
    smoothedLevel.current = THREE.MathUtils.damp(smoothedLevel.current, level, 14, dt);
    visibleFade.current = preview ? THREE.MathUtils.damp(visibleFade.current, fade, fade > visibleFade.current ? 3.8 : 8, dt) : fade;
    const pulse = smoothedLevel.current;
    const t = clock.elapsedTime;
    const breath = 1 + Math.sin(t * 0.9 + seed + x * 0.2 + z * 0.13) * 0.035;
    const renderedFade = visibleFade.current;
    // Additive glare layers (aura, flare, rays) read as bright even at low
    // opacity on the black void, so a linear/sqrt fade makes them appear to
    // pop in well before the orb is "really" visible. Square the fade so the
    // bottom of the fade-in is genuinely invisible; the solid white core stays
    // on the linear fade below.
    const opticalFade = renderedFade * renderedFade;
    updateMarkerDebug({
      id: markerDebugId,
      trackId: track.id,
      kind: preview ? "preview" : "base",
      fade: renderedFade,
      targetFade: fade,
      distance: Math.hypot(camera.position.x - markerDebugPosition[0], camera.position.z - markerDebugPosition[1]),
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
        seed +
        Math.sin(t * 0.075 + seed * 1.7) * 0.85 +
        Math.sin(t * 0.031 + seed * 4.1) * 0.55;
    }
    if (glow.current) {
      glow.current.intensity = ((selected ? 8 : 4.8) + volume * 3.2 + pulse * 44) * renderedFade;
      glow.current.distance = 12 + volume * 8 + pulse * 16;
    }
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

  return (
    <group
      ref={registerGroup}
      position={[x, stemY, z]}
      onClick={handleClick}
      onPointerOver={() => setCursor("pointer")}
      onPointerOut={() => setCursor("auto")}
    >
      {mode === "edit" && selected && (
        <group position={[0, floorY - stemY, 0]}>
          <FalloffMap track={track} />
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
            <planeGeometry args={[1, 1]} />
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
            <planeGeometry args={[1, 1]} />
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
    float core = smoothstep(radius, 0.0, d);
    float haze = exp(-d * 5.6);
    // The haze never reaches zero, so without this it leaks all the way to the
    // billboard plane's square corners — invisible on the black void but a hard
    // square halo over a lit detail-pack floor. Fade to zero inside the plane's
    // inscribed circle (d = 0.5) so only a round glow survives.
    float edge = smoothstep(0.5, 0.4, d);
    float alpha = (core * 0.85 + haze * 0.38) * opacity * edge;
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
    float body = exp(-across * width) * smoothstep(length, 0.02, along);
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
    float center = smoothstep(radius, 0.0, d);
    // Vanish within the plane's inscribed circle (d = 0.5) so the rays/glow can't
    // paint the square plane edges over a lit detail-pack floor (see flare).
    float alpha = (rays + center * 0.5) * smoothstep(0.5, 0.02, d) * opacity;
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
