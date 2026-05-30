import { useRef } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { useStore } from "../store";

// A glowing pillar that marks where a stem lives in space and pulses with its
// audio level — a visual anchor for the sound you hear from that direction.
// In edit mode it can be clicked to select; the selected track wears a ring.
export function TrackMarker({ track }: { track: TrackDef }) {
  const engine = useStore((s) => s.engine);
  const selected = useStore((s) => s.selectedId === track.id);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [x, y, z] = track.position;

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

  return (
    <group
      position={[x, 0, z]}
      onClick={handleClick}
      onPointerOver={() => setCursor("pointer")}
      onPointerOut={() => setCursor("auto")}
    >
      {/* base column */}
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.25, 0.4, 3, 24]} />
        <meshStandardMaterial color={track.color} emissive={track.color} emissiveIntensity={0.6} />
      </mesh>
      {/* pulsing orb */}
      <mesh ref={core} position={[0, y + 1.6, 0]}>
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
        <mesh ref={ring} position={[0, y + 1.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.045, 10, 56]} />
          <meshBasicMaterial color="white" toneMapped={false} />
        </mesh>
      )}
      <pointLight ref={glow} position={[0, y + 1.6, 0]} color={track.color} intensity={6} distance={18} />
      <Text position={[0, y + 2.8, 0]} fontSize={0.5} color="white" anchorX="center">
        {track.name}
      </Text>
    </group>
  );
}
