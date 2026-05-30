import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// Edit-mode camera: drag to orbit, scroll to zoom, and WASD to glide across
// the plane (panning the orbit pivot with you). Moving the camera moves the
// audio listener, so you can reposition a track and go hear it from elsewhere.
export function EditControls() {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const keys = useRef<Record<string, boolean>>({});
  const fwd = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0);

  // Start from an overview vantage when entering edit mode.
  useEffect(() => {
    camera.position.set(0, 14, 22);
  }, [camera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Don't capture typing in the properties panel.
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
    const c = controls.current;
    if (!c) return;
    const speed = 14 * dt;

    // Ground-plane forward/right from the camera heading.
    camera.getWorldDirection(fwd.current);
    fwd.current.y = 0;
    fwd.current.normalize();
    right.current.crossVectors(fwd.current, up).normalize();

    move.current.set(0, 0, 0);
    if (keys.current["KeyW"]) move.current.addScaledVector(fwd.current, speed);
    if (keys.current["KeyS"]) move.current.addScaledVector(fwd.current, -speed);
    if (keys.current["KeyD"]) move.current.addScaledVector(right.current, speed);
    if (keys.current["KeyA"]) move.current.addScaledVector(right.current, -speed);

    // Shift the camera and its orbit pivot together = panning across the plane.
    if (move.current.lengthSq() > 0) {
      camera.position.add(move.current);
      c.target.add(move.current);
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 1.5, 0]}
      enableDamping
      enablePan
      maxPolarAngle={Math.PI / 2.05} // don't dip below the floor
      minDistance={3}
      maxDistance={120}
    />
  );
}
