import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";

// Explore mode: WASD movement on the ground plane + pointer-lock mouse look.
// (The AudioListener is driven separately by <ListenerSync>, which works in
// both explore and edit mode.)
export function Player() {
  const { camera } = useThree();
  const entered = useStore((s) => s.entered);
  const keys = useRef<Record<string, boolean>>({});
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0);

  // Face forward (horizontal) on load instead of inheriting R3F's default
  // "look at the origin" — which, since we spawn above the origin, points
  // the camera straight down. PointerLockControls only changes orientation
  // on mouse movement, so this initial heading sticks until you look around.
  useEffect(() => {
    camera.position.set(0, 1.7, 0);
    camera.lookAt(0, 1.7, -1);
  }, [camera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Ignore keys while typing in a form field (e.g. the entry screen).
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      keys.current[e.code] = true;
    };
    const upFn = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", upFn);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", upFn);
    };
  }, []);

  useFrame((_, dt) => {
    if (!entered) return; // no movement until the experience has started
    const speed = 7 * dt;
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, up).normalize();

    if (keys.current["KeyW"]) camera.position.addScaledVector(forward.current, speed);
    if (keys.current["KeyS"]) camera.position.addScaledVector(forward.current, -speed);
    if (keys.current["KeyD"]) camera.position.addScaledVector(right.current, speed);
    if (keys.current["KeyA"]) camera.position.addScaledVector(right.current, -speed);
    camera.position.y = 1.7; // keep eye height fixed
  });

  // Before entering, the lock is armed on the entry button so its single click
  // both starts the experience and locks the pointer (no second click). After
  // entering, fall back to the default (click anywhere) to re-lock after Esc.
  return <PointerLockControls selector={entered ? undefined : "#enter-btn"} />;
}
