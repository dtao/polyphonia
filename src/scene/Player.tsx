import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore, viewState } from "../store";

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

  // Drop in at the shared ground position and facing direction (both preserved
  // across mode switches), at eye height and horizontal.
  useEffect(() => {
    camera.position.set(viewState.x, 1.7, viewState.z);
    camera.lookAt(viewState.x + viewState.fx, 1.7, viewState.z + viewState.fz);
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

    // Record position + heading so edit mode (and new stems) stay anchored here.
    viewState.x = camera.position.x;
    viewState.z = camera.position.z;
    const len = Math.hypot(forward.current.x, forward.current.z);
    if (len > 0) {
      viewState.fx = forward.current.x / len;
      viewState.fz = forward.current.z / len;
    }
  });

  // Before entering, the lock is armed on the entry button so its single click
  // both starts the experience and locks the pointer (no second click). After
  // entering, arm it on the canvas only — so clicking the 3D scene re-locks
  // (to look around after Esc), but clicking UI buttons does NOT grab the
  // pointer.
  return <PointerLockControls selector={entered ? "canvas" : "#enter-btn"} />;
}
