import { useCallback, useRef } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { markerObjects, useStore } from "../store";

// A glowing orb that marks where a stem lives in space and pulses with its
// audio level — a visual anchor for the sound you hear from that direction.
// In edit mode it can be clicked to select; the selected track wears a ring.
export function TrackMarker({ track }: { track: TrackDef }) {
  const engine = useStore((s) => s.engine);
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selectedId === track.id);
  const core = useRef<THREE.Mesh>(null);
  const aura = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const ring = useRef<THREE.Mesh>(null);
  const smoothedLevel = useRef(0);
  const [x, , z] = track.position;
  const volume = track.volume ?? 1;
  const orbRadius = 0.42 + volume * 0.32;
  const markerTop = 1.1 + orbRadius * 0.9;

  useFrame((_, dt) => {
    const level = engine?.level(track.id) ?? 0;
    smoothedLevel.current = THREE.MathUtils.damp(smoothedLevel.current, level, 14, dt);
    const pulse = smoothedLevel.current;
    const breath = 1 + Math.sin(performance.now() * 0.003 + x * 0.2 + z * 0.13) * 0.035;
    if (core.current) core.current.scale.setScalar(breath + pulse * 0.85);
    if (aura.current) {
      aura.current.scale.setScalar(1.35 + pulse * 1.45);
      const material = aura.current.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.16 + pulse * 0.26;
    }
    if (glow.current) {
      glow.current.intensity = (selected ? 8 : 4.8) + volume * 3.2 + pulse * 34;
      glow.current.distance = 12 + volume * 8 + pulse * 12;
    }
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
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[orbRadius * 0.95, orbRadius * 1.55, 48]} />
        <meshBasicMaterial color={track.color} transparent opacity={0.28} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={aura} position={[0, markerTop, 0]}>
        <sphereGeometry args={[orbRadius, 24, 16]} />
        <meshBasicMaterial color={track.color} transparent opacity={0.18} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={core} position={[0, markerTop, 0]}>
        <sphereGeometry args={[orbRadius, 32, 20]} />
        <meshStandardMaterial
          color={track.color}
          emissive={track.color}
          emissiveIntensity={selected ? 3.2 : 2.1}
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
          even when you walk behind the marker. */}
      <Billboard position={[0, markerTop + orbRadius + 0.75, 0]}>
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
