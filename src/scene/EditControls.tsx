import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore, viewState } from "../store";
import { surfaceHeightAt } from "../map";

// Edit-mode camera: drag to orbit, scroll to zoom, WASD to glide across
// the plane, and Q/E to lower/raise your elevation. Moving the camera moves the
// audio listener, so you can reposition a track and go hear it from elsewhere.
export function EditControls() {
  const { camera } = useThree();
  const start = useStore((s) => s.composition.map.start);
  const map = useStore((s) => s.composition.map);
  const controls = useRef<any>(null);
  const keys = useRef<Record<string, boolean>>({});
  const fwd = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0);

  // Rise to an overhead vantage while preserving both position and heading: the
  // orbit pivot stays at the spot you were standing on, and the camera lifts up
  // and *back along your facing direction* — so it feels like floating up and
  // tilting your head down, still pointing the same compass direction.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const back = 18; // how far behind the anchor, along -facing
    const height = 14;
    const groundY = viewState.y; // anchor's surface height (0 on flat maps)
    c.target.set(viewState.x, groundY + 1.5, viewState.z);
    camera.position.set(viewState.x - viewState.fx * back, groundY + height, viewState.z - viewState.fz * back);
    c.update();
  }, [camera, start.position, start.direction]);

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
    if (fwd.current.lengthSq() > 0.0001) {
      fwd.current.normalize();
    } else {
      fwd.current.set(viewState.fx, 0, viewState.fz).normalize();
    }
    right.current.crossVectors(fwd.current, up).normalize();

    move.current.set(0, 0, 0);
    if (keys.current["KeyW"]) move.current.addScaledVector(fwd.current, speed);
    if (keys.current["KeyS"]) move.current.addScaledVector(fwd.current, -speed);
    if (keys.current["KeyD"]) move.current.addScaledVector(right.current, speed);
    if (keys.current["KeyA"]) move.current.addScaledVector(right.current, -speed);
    if (keys.current["KeyE"]) move.current.y += speed;
    if (keys.current["KeyQ"]) move.current.y -= speed;

    // Shift the camera and its orbit pivot together = panning through 3D space.
    if (move.current.lengthSq() > 0) {
      camera.position.add(move.current);
      c.target.add(move.current);
    }

    // Keep the shared anchor at the orbit pivot (screen center) and the heading
    // at the camera's facing, so explore mode and new stems stay aligned with
    // where you're looking — including after orbiting to a new direction.
    viewState.x = c.target.x;
    viewState.z = c.target.z;
    viewState.y = surfaceHeightAt(map, [c.target.x, c.target.z]);
    const len = Math.hypot(fwd.current.x, fwd.current.z);
    if (len > 0) {
      viewState.fx = fwd.current.x / len;
      viewState.fz = fwd.current.z / len;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      enablePan
      maxPolarAngle={Math.PI / 2.05} // don't dip below the floor
      minDistance={3}
      maxDistance={120}
    />
  );
}
