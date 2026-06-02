import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore, viewState } from "../store";
import { clampToMap } from "../map";

// Explore mode: WASD movement on the ground plane + pointer-lock mouse look.
// (The AudioListener is driven separately by <ListenerSync>, which works in
// both explore and edit mode.)
export function Player() {
  const { camera, gl } = useThree();
  const entered = useStore((s) => s.entered);
  const map = useStore((s) => s.composition.map);
  const keys = useRef<Record<string, boolean>>({});
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0);
  const look = useRef({ yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, locked: false });
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));

  // Drop in at the shared ground position and facing direction (both preserved
  // across mode switches), at eye height and horizontal.
  useLayoutEffect(() => {
    if (!entered) return;
    camera.position.set(viewState.x, 1.7, viewState.z);
    camera.lookAt(viewState.x + viewState.fx, 1.7, viewState.z + viewState.fz);
    euler.current.setFromQuaternion(camera.quaternion, "YXZ");
    look.current.pitch = euler.current.x;
    look.current.yaw = euler.current.y;
    look.current.targetPitch = euler.current.x;
    look.current.targetYaw = euler.current.y;
  }, [camera, entered]);

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

  useEffect(() => {
    const canvas = gl.domElement;

    const lock = () => {
      const requestLock = canvas.requestPointerLock as ((options?: { unadjustedMovement?: boolean }) => Promise<void> | void) | undefined;
      if (!requestLock) return;

      try {
        const result = requestLock.call(canvas, { unadjustedMovement: true });
        if (result && typeof result.catch === "function") {
          result.catch(() => canvas.requestPointerLock());
        }
      } catch {
        canvas.requestPointerLock();
      }
    };

    const onLockChange = () => {
      look.current.locked = document.pointerLockElement === canvas;
      if (look.current.locked) {
        look.current.targetYaw = look.current.yaw;
        look.current.targetPitch = look.current.pitch;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!look.current.locked) return;
      const sensitivity = 0.002;
      look.current.targetYaw -= (e.movementX || 0) * sensitivity;
      look.current.targetPitch -= (e.movementY || 0) * sensitivity;
      look.current.targetPitch = THREE.MathUtils.clamp(look.current.targetPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    };

    const elements = entered ? [canvas] : Array.from(document.querySelectorAll("#enter-btn"));
    elements.forEach((el) => el.addEventListener("click", lock));
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    onLockChange();

    return () => {
      elements.forEach((el) => el.removeEventListener("click", lock));
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [entered, gl.domElement]);

  useFrame((_, dt) => {
    if (!entered) return; // no movement until the experience has started
    const lookSmoothing = 34;
    look.current.yaw = THREE.MathUtils.damp(look.current.yaw, look.current.targetYaw, lookSmoothing, dt);
    look.current.pitch = THREE.MathUtils.damp(look.current.pitch, look.current.targetPitch, lookSmoothing, dt);
    euler.current.set(look.current.pitch, look.current.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler.current);

    const speed = 7 * dt;
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, up).normalize();

    if (keys.current["KeyW"]) camera.position.addScaledVector(forward.current, speed);
    if (keys.current["KeyS"]) camera.position.addScaledVector(forward.current, -speed);
    if (keys.current["KeyD"]) camera.position.addScaledVector(right.current, speed);
    if (keys.current["KeyA"]) camera.position.addScaledVector(right.current, -speed);
    const [x, z] = clampToMap(map, [camera.position.x, camera.position.z]);
    camera.position.x = x;
    camera.position.z = z;
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
  return null;
}
