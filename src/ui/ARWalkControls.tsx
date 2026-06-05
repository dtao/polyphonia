import { useEffect, useRef, useState } from "react";
import { CompositionMap } from "../map";
import { arWalk, viewState } from "../store";
import { isTouchDevice } from "./TouchControls";

type ARStatus = "idle" | "checking" | "starting" | "active" | "unsupported" | "error";

type XRSessionMode = "immersive-ar";
type XRReferenceSpaceType = "local-floor" | "local" | "unbounded";
type XRFrameRequestCallback = (time: number, frame: XRFrameLike) => void;

interface XRSystemLike {
  isSessionSupported?: (mode: XRSessionMode) => Promise<boolean>;
  requestSession: (mode: XRSessionMode, options?: XRSessionInitLike) => Promise<XRSessionLike>;
}

interface XRSessionInitLike {
  optionalFeatures?: string[];
  requiredFeatures?: string[];
  domOverlay?: { root: Element };
}

interface XRSessionLike extends EventTarget {
  end: () => Promise<void>;
  requestAnimationFrame: (callback: XRFrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  requestReferenceSpace: (type: XRReferenceSpaceType) => Promise<XRReferenceSpaceLike>;
}

interface XRFrameLike {
  getViewerPose: (space: XRReferenceSpaceLike) => XRViewerPoseLike | null;
  session: XRSessionLike;
}

type XRReferenceSpaceLike = object;

interface XRViewerPoseLike {
  transform: {
    position: { x: number; y: number; z: number };
  };
}

const MIN_MOVEMENT_METERS = 0.025;
const FIRST_HEADING_METERS = 0.25;
const MAX_STEP_METERS = 2;
const POSITION_SMOOTHING = 0.42;
const DEFAULT_SCALE = 1;

function xrSystem(): XRSystemLike | null {
  const xr = (navigator as Navigator & { xr?: XRSystemLike }).xr;
  return xr ?? null;
}

function isMobileTouchDevice(): boolean {
  if (!isTouchDevice()) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function ARWalkControls({ map }: { map: CompositionMap }) {
  const tiled = map.tiling.type === "square" || map.tiling.type === "hex";
  const mobile = isMobileTouchDevice();
  const available = mobile && tiled;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<ARStatus>("idle");
  const session = useRef<XRSessionLike | null>(null);
  const referenceSpace = useRef<XRReferenceSpaceLike | null>(null);
  const frameHandle = useRef<number | null>(null);
  const origin = useRef<[number, number] | null>(null);
  const smoothed = useRef<[number, number] | null>(null);
  const rotation = useRef<number | null>(null);
  const scale = useRef(DEFAULT_SCALE);
  const mounted = useRef(true);

  useEffect(() => {
    if (!available && enabled) void stopSession();
  }, [available, enabled]);

  useEffect(() => () => {
    mounted.current = false;
    void stopSession(false);
  }, []);

  useEffect(() => {
    arWalk.active = enabled && status === "active" && available;
    if (!enabled || !available) resetWalk();
    return () => {
      if (!enabled) resetWalk();
    };
  }, [available, enabled, status]);

  async function startSession(): Promise<void> {
    if (!available || enabled) return;
    const xr = xrSystem();
    if (!xr) {
      setStatus("unsupported");
      return;
    }

    setStatus("checking");
    const supported = xr.isSessionSupported ? await xr.isSessionSupported("immersive-ar").catch(() => false) : true;
    if (!supported) {
      setStatus("unsupported");
      return;
    }

    try {
      setStatus("starting");
      const nextSession = await xr.requestSession("immersive-ar", {
        optionalFeatures: ["local-floor", "unbounded", "dom-overlay"],
        domOverlay: { root: document.body },
      });
      session.current = nextSession;
      nextSession.addEventListener("end", onSessionEndEvent);
      referenceSpace.current = await requestBestReferenceSpace(nextSession);
      setEnabled(true);
      setStatus("active");
      frameHandle.current = nextSession.requestAnimationFrame(onFrame);
    } catch (err) {
      console.error("AR Walk failed", err);
      await stopSession();
      setStatus("error");
    }
  }

  async function requestBestReferenceSpace(nextSession: XRSessionLike): Promise<XRReferenceSpaceLike> {
    try {
      return await nextSession.requestReferenceSpace("local-floor");
    } catch {
      try {
        return await nextSession.requestReferenceSpace("unbounded");
      } catch {
        return nextSession.requestReferenceSpace("local");
      }
    }
  }

  function onFrame(_: number, frame: XRFrameLike): void {
    const space = referenceSpace.current;
    const currentSession = session.current;
    if (!space || !currentSession) return;

    const pose = frame.getViewerPose(space);
    if (pose) updatePose(pose.transform.position.x, pose.transform.position.z);
    frameHandle.current = frame.session.requestAnimationFrame(onFrame);
  }

  function updatePose(rawX: number, rawZ: number): void {
    if (!origin.current) {
      origin.current = [rawX, rawZ];
      smoothed.current = [0, 0];
      return;
    }

    const nextLocal: [number, number] = [rawX - origin.current[0], rawZ - origin.current[1]];
    const previous = smoothed.current ?? nextLocal;
    const next: [number, number] = [
      previous[0] + (nextLocal[0] - previous[0]) * POSITION_SMOOTHING,
      previous[1] + (nextLocal[1] - previous[1]) * POSITION_SMOOTHING,
    ];
    smoothed.current = next;

    const realDx = next[0] - previous[0];
    const realDz = next[1] - previous[1];
    const distance = Math.hypot(realDx, realDz);
    if (distance < MIN_MOVEMENT_METERS || distance > MAX_STEP_METERS) return;

    if (rotation.current === null && distance >= FIRST_HEADING_METERS) {
      const worldAngle = Math.atan2(viewState.fz, viewState.fx);
      const realAngle = Math.atan2(realDz, realDx);
      rotation.current = worldAngle - realAngle;
    }

    const angle = rotation.current ?? 0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    arWalk.pendingX += (realDx * c - realDz * s) * scale.current;
    arWalk.pendingZ += (realDx * s + realDz * c) * scale.current;
  }

  async function stopSession(updateState = true): Promise<void> {
    const currentSession = session.current;
    if (currentSession && frameHandle.current !== null) currentSession.cancelAnimationFrame?.(frameHandle.current);
    frameHandle.current = null;
    if (currentSession) {
      currentSession.removeEventListener("end", onSessionEndEvent);
      await currentSession.end().catch(() => undefined);
    }
    onSessionEnd(updateState);
  }

  function onSessionEndEvent(): void {
    onSessionEnd(true);
  }

  function onSessionEnd(updateState = true): void {
    session.current = null;
    referenceSpace.current = null;
    if (updateState && mounted.current) {
      setEnabled(false);
      setStatus("idle");
    }
    resetWalk();
  }

  function resetWalk(): void {
    arWalk.active = false;
    arWalk.pendingX = 0;
    arWalk.pendingZ = 0;
    origin.current = null;
    smoothed.current = null;
    rotation.current = null;
  }

  if (!available) return null;

  const active = enabled && status === "active";
  const label = active ? "AR Walk on" : "AR Walk";
  const detail =
    status === "checking"
      ? "checking AR"
      : status === "starting"
        ? "starting AR"
        : status === "active"
          ? "tracking pose"
          : status === "unsupported"
            ? "AR not supported"
            : status === "error"
              ? "AR permission error"
              : `${map.tiling.type} map`;

  return (
    <div style={panel}>
      <button
        style={{ ...button, ...(active ? activeButton : null) }}
        onClick={() => {
          if (active || enabled) void stopSession();
          else void startSession();
        }}
        title="Use mobile AR pose tracking to move through this square/hex tiled composition"
      >
        {label}
      </button>
      <span style={detailStyle}>{detail}</span>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  right: 14,
  bottom: 14,
  zIndex: 12,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(8,10,18,0.62)",
  color: "rgba(255,255,255,0.86)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 12,
  pointerEvents: "auto",
};

const button: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  cursor: "pointer",
  fontSize: 13,
};

const activeButton: React.CSSProperties = {
  borderColor: "rgba(86,224,192,0.55)",
  background: "rgba(86,224,192,0.2)",
};

const detailStyle: React.CSSProperties = {
  maxWidth: 120,
  color: "rgba(255,255,255,0.58)",
  whiteSpace: "nowrap",
};
