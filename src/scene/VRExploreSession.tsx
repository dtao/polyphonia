import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  VR_EXPLORE_START_EVENT,
  VR_EXPLORE_STATUS_EVENT,
  VR_EXPLORE_STOP_EVENT,
  VRExploreStatus,
  applyVRAudioSessionOverride,
  flatHeading,
  idleVRExploreStatus,
  renderTranslationFor,
  rotateFlat,
  worldYawFor,
} from "../vrExplore";
import { MapSupport, mapSupportAt, stepOnMap, surfaceHeightOnSupport, wrapLoopPosition } from "../map";
import { generatedGroundHeight } from "../worldgen/sampler";
import { arWalk, loopWrap, useStore, viewState, vrExplore } from "../store";

type XRInputSourceLike = {
  gamepad?: { axes: ReadonlyArray<number> } | null;
};
type XRSessionLike = EventTarget & {
  end?: () => Promise<void>;
  inputSources?: Iterable<XRInputSourceLike>;
};
type XRSystemLike = {
  requestSession: (mode: "immersive-vr", options?: { optionalFeatures?: string[] }) => Promise<XRSessionLike>;
};

// In immersive VR one world unit renders as one physical meter, so the desktop
// EYE_HEIGHT (3 units — the world is authored larger than life) would feel like
// standing on stilts. Anchor the virtual eye a natural standing height above
// the walkable surface instead; the world simply reads as grander than on
// desktop. Physical head movement passes through 1:1 (meters = units).
const VR_EYE_HEIGHT = 1.7;
// Glide pace while a pinch/trigger is held, in units (= meters) per second.
// Desktop walks at 7 units/s; a touch slower is easier on the stomach.
const GLIDE_SPEED = 6;
const STICK_DEADZONE = 0.15;
// Physical-step filtering, mirroring ARWalkSession: ignore sensor jitter and
// reject teleport-sized tracking glitches.
const MIN_MOVEMENT_METERS = 0.001;
const MAX_STEP_METERS = 2;
const POSITION_SMOOTHING = 0.65;

function xrSystem(): XRSystemLike | null {
  return ((navigator as Navigator & { xr?: XRSystemLike }).xr ?? null);
}

function dispatchStatus(status: VRExploreStatus): void {
  window.dispatchEvent(new CustomEvent(VR_EXPLORE_STATUS_EVENT, { detail: status }));
}

// Fully-immersive VR explore for WebXR headsets (Vision Pro, Quest, ...). The
// headset owns the real camera; this session rotates/offsets the world (via
// the vrExplore singleton consumed by Scene's world-transform group) so the
// listener drops in at the composition start facing the authored direction.
// Locomotion: pinch-and-hold (Vision Pro) or trigger-hold glides toward where
// you're looking; controller thumbsticks move relative to your gaze. All
// movement runs through the same wrap/clamp path as keyboard movement, then
// this component mirrors the resulting virtual pose onto the R3F camera so
// every camera consumer (ListenerSync, fades, fog, tiled previews) stays
// correct without XR-specific branches.
export function VRExploreSession() {
  const { gl, camera } = useThree();
  const map = useStore((s) => s.composition.map);
  const session = useRef<XRSessionLike | null>(null);
  const support = useRef<MapSupport | null>(null);
  const initialized = useRef(false);
  const worldYaw = useRef(0);
  const selecting = useRef(0);
  const origin = useRef(new THREE.Vector3());
  const smoothed = useRef(new THREE.Vector2());
  const previousSmoothed = useRef(new THREE.Vector2());
  const position = useRef(new THREE.Vector3());
  const quaternion = useRef(new THREE.Quaternion());
  const scale = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3(0, 0, -1));
  const up = useRef(new THREE.Vector3(0, 1, 0));

  useEffect(() => {
    const start = () => void startSession();
    const stop = () => void stopSession();
    window.addEventListener(VR_EXPLORE_START_EVENT, start);
    window.addEventListener(VR_EXPLORE_STOP_EVENT, stop);
    return () => {
      window.removeEventListener(VR_EXPLORE_START_EVENT, start);
      window.removeEventListener(VR_EXPLORE_STOP_EVENT, stop);
      void stopSession();
    };
  }, []);

  async function startSession(): Promise<void> {
    if (session.current || arWalk.active) return;
    const xr = xrSystem();
    if (!xr) {
      dispatchStatus({ state: "unsupported" });
      return;
    }
    try {
      dispatchStatus({ state: "starting" });
      applyVRAudioSessionOverride();
      // No await before requestSession: it must spend the click's user
      // activation (support was already checked by the UI that shows the
      // button).
      const nextSession = await xr.requestSession("immersive-vr");
      session.current = nextSession;
      resetTracking();
      nextSession.addEventListener("end", onSessionEnd);
      nextSession.addEventListener("selectstart", onSelectStart);
      nextSession.addEventListener("selectend", onSelectEnd);
      gl.xr.enabled = true;
      gl.xr.setReferenceSpaceType("local");
      await (gl.xr as unknown as { setSession: (session: XRSessionLike | null) => Promise<void> }).setSession(nextSession);
      vrExplore.active = true;
      dispatchStatus({ state: "active" });
    } catch (err) {
      console.error("Immersive VR failed", err);
      session.current = null;
      vrExplore.active = false;
      dispatchStatus({ state: "error" });
    }
  }

  async function stopSession(): Promise<void> {
    const current = session.current;
    if (current) {
      current.removeEventListener("end", onSessionEnd);
      await current.end?.().catch(() => undefined);
    }
    await (gl.xr as unknown as { setSession: (session: XRSessionLike | null) => Promise<void> }).setSession(null).catch(() => undefined);
    onSessionEnd();
  }

  function onSessionEnd(): void {
    if (session.current) {
      session.current.removeEventListener("selectstart", onSelectStart);
      session.current.removeEventListener("selectend", onSelectEnd);
    }
    session.current = null;
    vrExplore.active = false;
    vrExplore.renderX = 0;
    vrExplore.renderY = 0;
    vrExplore.renderZ = 0;
    vrExplore.renderYaw = 0;
    resetTracking();
    dispatchStatus(idleVRExploreStatus);
  }

  function onSelectStart(): void {
    selecting.current += 1;
  }

  function onSelectEnd(): void {
    selecting.current = Math.max(0, selecting.current - 1);
  }

  function resetTracking(): void {
    initialized.current = false;
    support.current = null;
    selecting.current = 0;
    worldYaw.current = 0;
  }

  // Priority -1, alongside <Player>: movement (and any loop wrap) must land
  // before every default-priority useFrame — see the ordering note in
  // Player.tsx. Mounted after <Player>, so this runs second within the slot
  // and owns the final camera pose for the frame while a session presents.
  useFrame((_, dt) => {
    if (!vrExplore.active || !gl.xr.isPresenting) return;

    const xrCamera = gl.xr.getCamera();
    xrCamera.matrixWorld.decompose(position.current, quaternion.current, scale.current);
    forward.current.set(0, 0, -1).applyQuaternion(quaternion.current);
    const flatLen = Math.hypot(forward.current.x, forward.current.z);

    if (!initialized.current) {
      if (flatLen < 0.05) return; // wait for a usable pose before anchoring
      origin.current.copy(position.current);
      smoothed.current.set(0, 0);
      previousSmoothed.current.set(0, 0);
      worldYaw.current = worldYawFor(
        flatHeading(viewState.fx, viewState.fz),
        flatHeading(forward.current.x / flatLen, forward.current.z / flatLen),
      );
      support.current = mapSupportAt(map, [viewState.x, viewState.z], null);
      initialized.current = true;
      applyPose();
      return;
    }

    // Physical head movement (meters = world units), smoothed and clamped to
    // the walkable map below so leaning/stepping can't pass through walls.
    previousSmoothed.current.copy(smoothed.current);
    smoothed.current.x += (position.current.x - origin.current.x - smoothed.current.x) * POSITION_SMOOTHING;
    smoothed.current.y += (position.current.z - origin.current.z - smoothed.current.y) * POSITION_SMOOTHING;
    let stepX = smoothed.current.x - previousSmoothed.current.x;
    let stepZ = smoothed.current.y - previousSmoothed.current.y;
    const rawDistance = Math.hypot(stepX, stepZ);
    if (rawDistance < MIN_MOVEMENT_METERS || rawDistance > MAX_STEP_METERS) {
      stepX = 0;
      stepZ = 0;
    }
    let [dx, dz] = rotateFlat(stepX, stepZ, worldYaw.current);

    // Gesture/controller locomotion, in virtual space relative to gaze.
    if (flatLen > 0.05) {
      const [gazeX, gazeZ] = rotateFlat(forward.current.x / flatLen, forward.current.z / flatLen, worldYaw.current);
      let moveForward = selecting.current > 0 ? 1 : 0;
      let moveStrafe = 0;
      const sources = session.current?.inputSources;
      if (sources) {
        for (const source of sources) {
          const axes = source.gamepad?.axes;
          if (!axes) continue;
          // xr-standard mapping puts the thumbstick at [2,3]; fall back to
          // [0,1] for two-axis gamepads.
          const x = axes.length >= 4 ? axes[2] : axes[0] ?? 0;
          const y = axes.length >= 4 ? axes[3] : axes[1] ?? 0;
          if (Math.abs(y) > STICK_DEADZONE) moveForward += -y;
          if (Math.abs(x) > STICK_DEADZONE) moveStrafe += x;
        }
      }
      moveForward = THREE.MathUtils.clamp(moveForward, -1, 1);
      moveStrafe = THREE.MathUtils.clamp(moveStrafe, -1, 1);
      if (moveForward || moveStrafe) {
        // Right of the gaze direction = gaze heading + 90° (see Player).
        const [rightX, rightZ] = rotateFlat(gazeX, gazeZ, Math.PI / 2);
        dx += (gazeX * moveForward + rightX * moveStrafe) * GLIDE_SPEED * dt;
        dz += (gazeZ * moveForward + rightZ * moveStrafe) * GLIDE_SPEED * dt;
      }
    }

    // Same wrap + clamp path as keyboard movement.
    const previousPoint: [number, number] = [viewState.x, viewState.z];
    const attempted: [number, number] = [viewState.x + dx, viewState.z + dz];
    const wrapped = wrapLoopPosition(map, previousPoint, attempted);
    let stepPosition: [number, number];
    if (wrapped) {
      loopWrap.generation++;
      // The corridor's far end has a different heading: rotate the WORLD by
      // the wrap's yaw delta (the headset can't rotate the user).
      worldYaw.current += wrapped.yawDelta;
      support.current = mapSupportAt(map, wrapped.position, null);
      stepPosition = wrapped.position;
    } else {
      const step = stepOnMap(map, previousPoint, attempted, support.current ?? mapSupportAt(map, previousPoint, null));
      support.current = step.support;
      stepPosition = step.position;
    }
    const ground =
      support.current?.kind === "open"
        ? generatedGroundHeight(useStore.getState().composition, stepPosition[0], stepPosition[1])
        : surfaceHeightOnSupport(map, stepPosition, support.current);
    viewState.x = stepPosition[0];
    viewState.y = ground;
    viewState.z = stepPosition[1];
    if (flatLen > 0.05) {
      const [fx, fz] = rotateFlat(forward.current.x / flatLen, forward.current.z / flatLen, worldYaw.current);
      viewState.fx = fx;
      viewState.fz = fz;
    }

    applyPose();
  }, -1);

  // Publish the world-group transform and mirror the virtual pose onto the
  // R3F camera. During XR presentation three overwrites the camera with the
  // physical pose at render time, but every useFrame consumer this frame
  // (ListenerSync — which feeds the audio engine — FogSync, fade drivers,
  // Scene's viewer sampler) reads the values set here.
  function applyPose(): void {
    const eyeY = viewState.y + VR_EYE_HEIGHT;
    const [tx, ty, tz] = renderTranslationFor(
      viewState.x,
      eyeY,
      viewState.z,
      origin.current.x + smoothed.current.x,
      origin.current.y,
      origin.current.z + smoothed.current.y,
      worldYaw.current,
    );
    vrExplore.renderX = tx;
    vrExplore.renderY = ty;
    vrExplore.renderZ = tz;
    vrExplore.renderYaw = worldYaw.current;

    // Virtual orientation = physical orientation with the heading shifted by
    // +worldYaw (a world-space rotation of -worldYaw about +Y — see
    // vrExplore.ts conventions).
    camera.position.set(viewState.x, eyeY, viewState.z);
    camera.quaternion
      .setFromAxisAngle(up.current.set(0, 1, 0), -worldYaw.current)
      .multiply(quaternion.current);
  }

  return null;
}
