import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { autopilotCapture, useStore, viewState, touchMove, arWalk, geoWalk, loopWrap } from "../store";
import { sampleAutopilotRoute } from "../composition";
import { MapSupport, mapSupportAt, stepOnMap, surfaceHeightOnSupport, wrapLoopPosition } from "../map";
import { generatedGroundHeight } from "../worldgen/sampler";
import { EYE_HEIGHT } from "../spatialConstants";

const AR_HEADING_SMOOTHING = 0.45;
const GEO_HEADING_SMOOTHING = 0.5;

function turnToward(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * amount;
}

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
  const autopilotPlaying = useStore((s) => s.autopilotPlaying);
  const playback = useRef({ elapsed: 0 });

  // Restart the route clock whenever playback (re)starts.
  useEffect(() => {
    playback.current.elapsed = 0;
  }, [autopilotPlaying]);

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

  // Movement runs at priority -1 so the camera moves (and any loop wrap is
  // applied, with viewState updated) BEFORE every default-priority useFrame.
  // Camera followers registered earlier in the tree (SkyDome, the terrain
  // lattice offset, FogSync) would otherwise render one frame behind on a
  // loop-wrap teleport — a single-frame flicker. Every other useFrame in the
  // app uses the default priority, where execution order is mount order; keep
  // it that way so this stays the lone exception.
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
    let geoFacing: [number, number] | null = null;
    if (arWalk.active) {
      geoWalk.pendingX = 0;
      geoWalk.pendingZ = 0;
      camera.position.x = viewState.x;
      camera.position.z = viewState.z;
      camera.position.y = viewState.y + EYE_HEIGHT;
      if (Math.hypot(viewState.fx, viewState.fz) > 0.03) {
        const targetYaw = Math.atan2(-viewState.fx, -viewState.fz);
        look.current.targetYaw = turnToward(look.current.targetYaw, targetYaw, AR_HEADING_SMOOTHING);
        look.current.targetPitch = THREE.MathUtils.damp(look.current.targetPitch, 0, 10, dt);
      }
    } else if (geoWalk.active) {
      const dx = geoWalk.pendingX;
      const dz = geoWalk.pendingZ;
      geoWalk.pendingX = 0;
      geoWalk.pendingZ = 0;
      camera.position.x += dx;
      camera.position.z += dz;
      if (Math.hypot(dx, dz) > 0.01) {
        geoFacing = [dx, dz];
        const targetYaw = Math.atan2(-dx, -dz);
        look.current.targetYaw = turnToward(look.current.targetYaw, targetYaw, GEO_HEADING_SMOOTHING);
        look.current.targetPitch = THREE.MathUtils.damp(look.current.targetPitch, 0, 10, dt);
      }
    } else {
      // Combine keyboard (WASD) and touch-joystick input into one move vector so
      // both input methods drive the same clamped, loop-wrapped movement.
      let moveForward = touchMove.forward;
      let moveStrafe = touchMove.strafe;
      if (keys.current["KeyW"]) moveForward += 1;
      if (keys.current["KeyS"]) moveForward -= 1;
      if (keys.current["KeyD"]) moveStrafe += 1;
      if (keys.current["KeyA"]) moveStrafe -= 1;
      const route = autopilotPlaying ? useStore.getState().composition.autopilot : undefined;
      if (route) {
        // Auto-pilot: follow the recorded route, camera included. Any movement
        // input hands control back to the listener.
        if (moveForward || moveStrafe) {
          useStore.getState().stopAutopilotPlayback();
        } else {
          const p = playback.current;
          p.elapsed += dt;
          const at = sampleAutopilotRoute(route, p.elapsed);
          if (at.jump && Math.hypot(at.x - camera.position.x, at.z - camera.position.z) > 4) {
            // A recorded teleport (e.g. a loop wrap): snap, and hide tiled
            // previews for the frame like a live wrap does.
            loopWrap.generation++;
            support.current = null;
          }
          camera.position.x = at.x;
          camera.position.z = at.z;
          look.current.yaw = look.current.targetYaw = at.yaw;
          look.current.pitch = look.current.targetPitch = at.pitch;
          euler.current.set(look.current.pitch, look.current.yaw, 0, "YXZ");
          camera.quaternion.setFromEuler(euler.current);
          camera.getWorldDirection(forward.current);
          forward.current.y = 0;
          forward.current.normalize();
          if (p.elapsed >= route.duration) useStore.getState().stopAutopilotPlayback();
        }
      } else {
        if (moveForward) camera.position.addScaledVector(forward.current, speed * moveForward);
        if (moveStrafe) camera.position.addScaledVector(right.current, speed * moveStrafe);
      }
    }
    // During auto-pilot the recorded positions are already canonical (wraps
    // were applied while recording), so skip live wrap detection — a recorded
    // jump would otherwise read as a giant step.
    const autopiloting = autopilotPlaying && !!useStore.getState().composition.autopilot;
    const wrapped = autopiloting ? null : wrapLoopPosition(map, previous, [camera.position.x, camera.position.z]);
    if (wrapped) {
      // Signal the teleport so <Scene> can hide tiled previews for this frame:
      // they're built from React state that still reflects the pre-wrap camera.
      loopWrap.generation++;
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
    const step = wrapped || autopiloting
      ? { position: [camera.position.x, camera.position.z] as [number, number], support: (wrapped ? support.current : null) ?? mapSupportAt(map, [camera.position.x, camera.position.z], support.current) }
      : stepOnMap(map, previous, [camera.position.x, camera.position.z], support.current);
    support.current = step.support;
    camera.position.x = step.position[0];
    camera.position.z = step.position[1];
    // Follow the walkable surface: ride at a fixed eye height above the floor,
    // damped so ramps feel smooth rather than snapping the camera. At a loop
    // seam, snap instead — the canonical elevation resets there, but the lifted
    // preview copy you were walking toward dropped by the same amount, so the
    // instantaneous reset is invisible and the climb feels continuous.
    // On maps with no walkable bounds the listener roams the open plane; if a
    // generated terrain exists there, ride its hills instead of the flat 0
    // (sampler returns 0 when there is no generated environment). Bounded maps
    // are untouched: their terrain flattens to the walkable surfaces anyway.
    const ground =
      step.support.kind === "open"
        ? generatedGroundHeight(useStore.getState().composition, step.position[0], step.position[1])
        : surfaceHeightOnSupport(map, step.position, support.current);
    camera.position.y = wrapped ? ground + EYE_HEIGHT : THREE.MathUtils.damp(camera.position.y, ground + EYE_HEIGHT, 12, dt);

    // Record position + heading so edit mode (and new stems) stay anchored here.
    viewState.x = camera.position.x;
    viewState.y = ground;
    viewState.z = camera.position.z;
    const len = Math.hypot(forward.current.x, forward.current.z);
    const geoLen = geoFacing ? Math.hypot(geoFacing[0], geoFacing[1]) : 0;
    if (geoFacing && geoLen > 0.01) {
      viewState.fx = geoFacing[0] / geoLen;
      viewState.fz = geoFacing[1] / geoLen;
    } else if (len > 0 && !arWalk.active) {
      viewState.fx = forward.current.x / len;
      viewState.fz = forward.current.z / len;
    }

    // Auto-pilot recording: capture the explore camera ~10×/s. The clock only
    // advances while this frame loop runs, so time spent back in Edit mode
    // doesn't stretch the route.
    if (useStore.getState().autopilotRecording) {
      autopilotCapture.elapsed += dt;
      const last = autopilotCapture.samples[autopilotCapture.samples.length - 1];
      if (!last || autopilotCapture.elapsed - last.t >= 0.1) {
        autopilotCapture.samples.push({
          t: autopilotCapture.elapsed,
          x: camera.position.x,
          z: camera.position.z,
          yaw: look.current.yaw,
          pitch: look.current.pitch,
        });
      }
    }
  }, -1);

  // Before entering, the lock is armed on the entry button so its single click
  // both starts the experience and locks the pointer (no second click). After
  // entering, arm it on the canvas only — so clicking the 3D scene re-locks
  // (to look around after Esc), but clicking UI buttons does NOT grab the
  // pointer.
  return null;
}
