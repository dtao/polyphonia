import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { AudioEngine } from "../audio/AudioEngine";

// A glowing pillar that marks where a stem lives in space and pulses with its
// audio level — a visual anchor for the sound you hear from that direction.
export function TrackMarker({ track, engine }: { track: TrackDef; engine: AudioEngine | null }) {
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const [x, y, z] = track.position;

  useFrame(() => {
    const level = engine?.level(track.name) ?? 0;
    const s = 1 + level * 1.4;
    if (core.current) core.current.scale.setScalar(s);
    if (glow.current) glow.current.intensity = 4 + level * 30;
  });

  return (
    <group position={[x, 0, z]}>
      {/* base column */}
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.25, 0.4, 3, 24]} />
        <meshStandardMaterial color={track.color} emissive={track.color} emissiveIntensity={0.6} />
      </mesh>
      {/* pulsing orb */}
      <mesh ref={core} position={[0, y + 1.6, 0]}>
        <icosahedronGeometry args={[0.5, 2]} />
        <meshStandardMaterial color={track.color} emissive={track.color} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <pointLight ref={glow} position={[0, y + 1.6, 0]} color={track.color} intensity={6} distance={18} />
      <Text position={[0, y + 2.8, 0]} fontSize={0.5} color="white" anchorX="center">
        {track.name}
      </Text>
    </group>
  );
}
