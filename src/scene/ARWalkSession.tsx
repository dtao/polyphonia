import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { AR_WALK_START_EVENT, AR_WALK_STATUS_EVENT, AR_WALK_STOP_EVENT, ARWalkStatus, idleARWalkStatus } from "../arWalk";
import { CompositionMap, MapSupport, mapSupportAt, stepOnMap, surfaceHeightOnSupport } from "../map";
import { arWalk, useStore, viewState } from "../store";

type XRSystemLike = {
  isSessionSupported?: (mode: "immersive-ar") => Promise<boolean>;
  requestSession: (mode: "immersive-ar", options?: { optionalFeatures?: string[]; domOverlay?: { root: Element } }) => Promise<EventTarget>;
};

const EYE_HEIGHT = 1.7;
const MIN_MOVEMENT_METERS = 0.001;
const MAX_STEP_METERS = 2;
const POSITION_SMOOTHING = 0.65;
const METRICS_INTERVAL_MS = 200;

function xrSystem(): XRSystemLike | null {
  return ((navigator as Navigator & { xr?: XRSystemLike }).xr ?? null);
}

function dispatchStatus(status: ARWalkStatus): void {
  window.dispatchEvent(new CustomEvent(AR_WALK_STATUS_EVENT, { detail: status }));
}

export function ARWalkSession() {
  const { gl, camera } = useThree();
  const map = useStore((s) => s.composition.map);
  const engine = useStore((s) => s.engine);
  const session = useRef<EventTarget | null>(null);
  const support = useRef<MapSupport | null>(null);
  const origin = useRef(new THREE.Vector3());
  const smoothed = useRef(new THREE.Vector3());
  const previous = useRef(new THREE.Vector3());
  const position = useRef(new THREE.Vector3());
  const quaternion = useRef(new THREE.Quaternion());
  const scale = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3(0, 0, -1));
  const listenerPosition = useRef(new THREE.Vector3());
  const listenerForward = useRef(new THREE.Vector3(0, 0, -1));
  const listenerUp = useRef(new THREE.Vector3(0, 1, 0));
  const initialized = useRef(false);
  const headingOffset = useRef<number | null>(null);
  const frames = useRef(0);
  const rawMeters = useRef(0);
  const mapMeters = useRef(0);
  const lastMetricsAt = useRef(0);
  const previousClearAlpha = useRef(1);

  useEffect(() => {
    const start = () => void startSession();
    const stop = () => void stopSession();
    window.addEventListener(AR_WALK_START_EVENT, start);
    window.addEventListener(AR_WALK_STOP_EVENT, stop);
    return () => {
      window.removeEventListener(AR_WALK_START_EVENT, start);
      window.removeEventListener(AR_WALK_STOP_EVENT, stop);
      void stopSession();
    };
  }, []);

  async function startSession(): Promise<void> {
    if (session.current) return;
    const xr = xrSystem();
    if (!xr) {
      dispatchStatus({ ...idleARWalkStatus, state: "unsupported" });
      return;
    }

    dispatchStatus({ ...idleARWalkStatus, state: "checking" });
    const supported = xr.isSessionSupported ? await xr.isSessionSupported("immersive-ar").catch(() => false) : true;
    if (!supported) {
      dispatchStatus({ ...idleARWalkStatus, state: "unsupported" });
      return;
    }

    try {
      dispatchStatus({ ...idleARWalkStatus, state: "starting" });
      const nextSession = await xr.requestSession("immersive-ar", {
        optionalFeatures: ["local-floor"],
      });
      session.current = nextSession;
      resetTracking();
      nextSession.addEventListener("end", onSessionEnd);
      gl.xr.enabled = true;
      gl.xr.setReferenceSpaceType("local");
      previousClearAlpha.current = gl.getClearAlpha();
      gl.setClearAlpha(1);
      await (gl.xr as unknown as { setSession: (session: EventTarget | null) => Promise<void> }).setSession(nextSession);
      arWalk.active = true;
      publishStatus(true);
    } catch (err) {
      console.error("AR Walk failed", err);
      session.current = null;
      arWalk.active = false;
      dispatchStatus({ ...idleARWalkStatus, state: "error" });
    }
  }

  async function stopSession(): Promise<void> {
    const current = session.current as (EventTarget & { end?: () => Promise<void> }) | null;
    if (current) {
      current.removeEventListener("end", onSessionEnd);
      await current.end?.().catch(() => undefined);
    }
    await (gl.xr as unknown as { setSession: (session: null) => Promise<void> }).setSession(null).catch(() => undefined);
    onSessionEnd();
  }

  function onSessionEnd(): void {
    session.current = null;
    arWalk.active = false;
    gl.setClearAlpha(previousClearAlpha.current);
    arWalk.renderX = 0;
    arWalk.renderY = 0;
    arWalk.renderZ = 0;
    arWalk.renderYaw = 0;
    resetTracking();
    dispatchStatus(idleARWalkStatus);
  }

  function resetTracking(): void {
    initialized.current = false;
    headingOffset.current = null;
    support.current = null;
    frames.current = 0;
    rawMeters.current = 0;
    mapMeters.current = 0;
    lastMetricsAt.current = 0;
  }

  useFrame(() => {
    if (!arWalk.active || !gl.xr.isPresenting) return;
    frames.current += 1;

    const xrCamera = gl.xr.getCamera();
    xrCamera.matrixWorld.decompose(position.current, quaternion.current, scale.current);
    updateRenderTransform();
    forward.current.set(0, 0, -1).applyQuaternion(quaternion.current);
    forward.current.y = 0;
    if (forward.current.lengthSq() > 0.0001) forward.current.normalize();

    if (!initialized.current) {
      origin.current.copy(position.current);
      smoothed.current.set(0, 0, 0);
      previous.current.set(0, 0, 0);
      initialized.current = true;
      publishStatus();
      return;
    }

    const localX = position.current.x - origin.current.x;
    const localZ = position.current.z - origin.current.z;
    previous.current.copy(smoothed.current);
    smoothed.current.x += (localX - smoothed.current.x) * POSITION_SMOOTHING;
    smoothed.current.z += (localZ - smoothed.current.z) * POSITION_SMOOTHING;
    const dx = smoothed.current.x - previous.current.x;
    const dz = smoothed.current.z - previous.current.z;
    const rawDistance = Math.hypot(dx, dz);
    if (rawDistance >= MIN_MOVEMENT_METERS && rawDistance <= MAX_STEP_METERS) {
      rawMeters.current += rawDistance;
      applyMovement(dx, dz);
    }
    applyHeading();
    publishStatus();
  });

  function arHeading(): number {
    return Math.atan2(forward.current.z, forward.current.x);
  }

  function applyHeading(): void {
    if (forward.current.lengthSq() <= 0.0001) return;
    if (headingOffset.current === null) {
      headingOffset.current = Math.atan2(viewState.fz, viewState.fx) - arHeading();
    }
    const heading = arHeading() + headingOffset.current;
    viewState.fx = Math.cos(heading);
    viewState.fz = Math.sin(heading);
    arWalk.renderYaw = 0;
    updateListener(map);
  }

  function updateRenderTransform(): void {
    arWalk.renderX = position.current.x - viewState.x;
    arWalk.renderY = position.current.y - (viewState.y + EYE_HEIGHT);
    arWalk.renderZ = position.current.z - viewState.z;
  }

  function applyMovement(dx: number, dz: number): void {
    if (headingOffset.current === null) applyHeading();
    const angle = headingOffset.current ?? 0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const worldDx = dx * c - dz * s;
    const worldDz = dx * s + dz * c;
    const previousPoint: [number, number] = [viewState.x, viewState.z];
    const attempted: [number, number] = [viewState.x + worldDx, viewState.z + worldDz];
    const step = stepOnMap(map, previousPoint, attempted, support.current ?? mapSupportAt(map, previousPoint, null));
    support.current = step.support;
    const ground = surfaceHeightOnSupport(map, step.position, support.current);
    const appliedDx = step.position[0] - viewState.x;
    const appliedDz = step.position[1] - viewState.z;
    mapMeters.current += Math.hypot(appliedDx, appliedDz);
    viewState.x = step.position[0];
    viewState.y = ground;
    viewState.z = step.position[1];
    updateRenderTransform();
    updateListener(map);
  }

  function updateListener(currentMap: CompositionMap): void {
    if (!engine) return;
    listenerPosition.current.set(viewState.x, viewState.y + EYE_HEIGHT, viewState.z);
    listenerForward.current.set(viewState.fx, 0, viewState.fz);
    engine.updateListener(listenerPosition.current, listenerForward.current, listenerUp.current, currentMap);
  }

  function publishStatus(force = false): void {
    const now = performance.now();
    if (!force && now - lastMetricsAt.current < METRICS_INTERVAL_MS) return;
    lastMetricsAt.current = now;
    dispatchStatus({
      state: "active",
      frames: frames.current,
      rawMeters: rawMeters.current,
      mapMeters: mapMeters.current,
    });
  }

  return null;
}
