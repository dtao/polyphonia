import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";

// Feeds the active camera's position/orientation to the AudioEngine every
// frame — so the spatial mix tracks the viewpoint in BOTH explore and edit
// mode. Mounted once, regardless of which camera controls are active.
export function ListenerSync() {
  const engine = useStore((s) => s.engine);
  const map = useStore((s) => s.composition.map);
  const { camera } = useThree();
  const dir = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!engine) return;
    camera.getWorldDirection(dir.current);
    engine.updateListener(camera.position, dir.current, camera.up, map);
  });

  return null;
}
