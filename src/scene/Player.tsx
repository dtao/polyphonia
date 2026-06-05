import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore, viewState, touchMove } from "../store";
import { MapSupport, mapSupportAt, stepOnMap, surfaceHeightOnSupport, wrapLoopPosition } from "../map";

const EYE_HEIGHT = 1.7;

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
  const support = useRef<MapSupport | null>(null);

  // Drop in at the shared ground position and facing direction (both preserved
  // across mode switches), at eye height and horizontal.
  useLayoutEffect(() => {
    if (!entered) return;
    const eye = viewState.y + EYE_HEIGHT;
    camera.position.set(viewState.x, eye, viewState.z);
    camera.lookAt(viewState.x + viewState.fx, eye, viewState.z + viewState.fz);
    euler.current.setFromQuaternion(camera.quaternion, "YXZ");
    look.current.pitch = euler.current.x;
    look.current.yaw = euler.current.y;
    look.current.targetPitch = euler.current.x;
    look.current.targetYaw = euler.current.y;
    support.current = mapSupportAt(map, [viewState.x, viewState.z], support.current);
  }, [camera, entered, map]);

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

  // Touch look: drag anywhere on the canvas to turn the camera. Mobile browsers
  // don't support pointer lock, so this drives the same target yaw/pitch the
  // mouse path does, independent of the lock state. The movement joystick lives
  // in its own DOM overlay above the canvas, so its touches never reach here.
  useEffect(() => {
    if (!entered) return;
    const canvas = gl.domElement;
    const sensitivity = 0.004;
    let lookTouch: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (lookTouch !== null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      lookTouch = t.identifier;
      lastX = t.clientX;
      lastY = t.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (lookTouch === null) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== lookTouch) continue;
        look.current.targetYaw -= (t.clientX - lastX) * sensitivity;
        look.current.targetPitch -= (t.clientY - lastY) * sensitivity;
        look.current.targetPitch = THREE.MathUtils.clamp(look.current.targetPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
        lastX = t.clientX;
        lastY = t.clientY;
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === lookTouch) lookTouch = null;
      }
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
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

    const previous: [number, number] = [camera.position.x, camera.position.z];
    // Combine keyboard (WASD) and touch-joystick input into one move vector so
    // both input methods drive the same clamped, loop-wrapped movement.
    let moveForward = touchMove.forward;
    let moveStrafe = touchMove.strafe;
    if (keys.current["KeyW"]) moveForward += 1;
    if (keys.current["KeyS"]) moveForward -= 1;
    if (keys.current["KeyD"]) moveStrafe += 1;
    if (keys.current["KeyA"]) moveStrafe -= 1;
    if (moveForward) camera.position.addScaledVector(forward.current, speed * moveForward);
    if (moveStrafe) camera.position.addScaledVector(right.current, speed * moveStrafe);
    const wrapped = wrapLoopPosition(map, previous, [camera.position.x, camera.position.z]);
    if (wrapped) {
      camera.position.x = wrapped.position[0];
      camera.position.z = wrapped.position[1];
      support.current = mapSupportAt(map, wrapped.position, null);
      look.current.yaw += wrapped.yawDelta;
      look.current.targetYaw += wrapped.yawDelta;
      euler.current.set(look.current.pitch, look.current.yaw, 0, "YXZ");
      camera.quaternion.setFromEuler(euler.current);
      camera.getWorldDirection(forward.current);
      forward.current.y = 0;
      forward.current.normalize();
    }
    const step = wrapped
      ? { position: [camera.position.x, camera.position.z] as [number, number], support: support.current ?? mapSupportAt(map, [camera.position.x, camera.position.z], null) }
      : stepOnMap(map, previous, [camera.position.x, camera.position.z], support.current);
    support.current = step.support;
    camera.position.x = step.position[0];
    camera.position.z = step.position[1];
    // Follow the walkable surface: ride at a fixed eye height above the floor,
    // damped so ramps feel smooth rather than snapping the camera. At a loop
    // seam, snap instead — the canonical elevation resets there, but the lifted
    // preview copy you were walking toward dropped by the same amount, so the
    // instantaneous reset is invisible and the climb feels continuous.
    const ground = surfaceHeightOnSupport(map, step.position, support.current);
    camera.position.y = wrapped ? ground + EYE_HEIGHT : THREE.MathUtils.damp(camera.position.y, ground + EYE_HEIGHT, 12, dt);

    // Record position + heading so edit mode (and new stems) stay anchored here.
    viewState.x = camera.position.x;
    viewState.y = ground;
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
