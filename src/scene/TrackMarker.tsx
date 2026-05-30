import { useCallback, useRef } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { markerObjects, useStore } from "../store";

// A glowing pillar that marks where a stem lives in space and pulses with its
// audio level — a visual anchor for the sound you hear from that direction.
// In edit mode it can be clicked to select; the selected track wears a ring.
export function TrackMarker({ track }: { track: TrackDef }) {
  const engine = useStore((s) => s.engine);
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selectedId === track.id);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [x, , z] = track.position;
  const volume = track.volume ?? 1;
  const pillarHeight = 1.1 + volume * 2.2;
  const pillarRadius = 0.18 + volume * 0.16;
  const markerTop = pillarHeight + 0.6;

  useFrame((_, dt) => {
    const level = engine?.level(track.id) ?? 0;
    const s = 1 + level * 1.4;
    if (core.current) core.current.scale.setScalar(s);
    if (glow.current) glow.current.intensity = (selected ? 8 : 4) + level * 30;
    if (ring.current) ring.current.rotation.z += dt * 1.5;
  });

  // Selection only happens in edit mode; in explore the click locks the pointer.
  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (useStore.getState().mode !== "edit") return;
    e.stopPropagation();
    useStore.getState().select(track.id);
  }

  function setCursor(c: string) {
    if (useStore.getState().mode === "edit") document.body.style.cursor = c;
  }

  // Register/unregister this marker's object for the move-gizmo to target.
  const registerGroup = useCallback(
    (g: THREE.Group | null) => {
      if (g) markerObjects.set(track.id, g);
      else markerObjects.delete(track.id);
    },
    [track.id],
  );

  return (
    <group
      ref={registerGroup}
      position={[x, 0, z]}
      onClick={handleClick}
      onPointerOver={() => setCursor("pointer")}
      onPointerOut={() => setCursor("auto")}
    >
      {mode === "edit" && selected && <FalloffMap track={track} />}
      {/* base column */}
      <mesh position={[0, pillarHeight / 2, 0]}>
        <cylinderGeometry args={[pillarRadius * 0.7, pillarRadius, pillarHeight, 24]} />
        <meshStandardMaterial color={track.color} emissive={track.color} emissiveIntensity={0.6} />
      </mesh>
      {/* pulsing orb */}
      <mesh ref={core} position={[0, markerTop, 0]}>
        <icosahedronGeometry args={[0.5, 2]} />
        <meshStandardMaterial
          color={track.color}
          emissive={track.color}
          emissiveIntensity={selected ? 2.6 : 1.6}
          toneMapped={false}
        />
      </mesh>
      {/* selection ring */}
      {selected && (
        <mesh ref={ring} position={[0, markerTop, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.045, 10, 56]} />
          <meshBasicMaterial color="white" toneMapped={false} />
        </mesh>
      )}
      <pointLight ref={glow} position={[0, markerTop, 0]} color={track.color} intensity={6} distance={18} />
      {/* Billboard keeps the label facing the camera so it's always readable,
          even when you walk behind the pillar. */}
      <Billboard position={[0, markerTop + 1.2, 0]}>
        <Text fontSize={0.5} color="white" anchorX="center">
          {track.name}
        </Text>
      </Billboard>
    </group>
  );
}

function FalloffMap({ track }: { track: TrackDef }) {
  const near = track.refDistance ?? 4;
  const far = Math.max(track.maxDistance ?? 40, near + 1);
  const rolloff = track.rolloff ?? 1;

  return (
    <group position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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
