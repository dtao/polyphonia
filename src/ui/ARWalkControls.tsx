import { useEffect, useState } from "react";
import { AR_WALK_START_EVENT, AR_WALK_STATUS_EVENT, AR_WALK_STOP_EVENT, ARWalkStatus, idleARWalkStatus } from "../arWalk";
import { CompositionMap } from "../map";
import { isTouchDevice } from "./TouchControls";

function isMobileTouchDevice(): boolean {
  if (!isTouchDevice()) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function ARWalkControls({ map }: { map: CompositionMap }) {
  const tiled = map.tiling.type === "square" || map.tiling.type === "hex";
  const available = tiled && isMobileTouchDevice();
  const [status, setStatus] = useState<ARWalkStatus>(idleARWalkStatus);

  useEffect(() => {
    const onStatus = (event: Event) => {
      setStatus((event as CustomEvent<ARWalkStatus>).detail);
    };
    window.addEventListener(AR_WALK_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(AR_WALK_STATUS_EVENT, onStatus);
  }, []);

  useEffect(() => {
    if (!available && status.state === "active") window.dispatchEvent(new Event(AR_WALK_STOP_EVENT));
  }, [available, status.state]);

  if (!available) return null;

  const active = status.state === "active";
  const label = active ? "AR Walk on" : "AR Walk";
  const detail =
    status.state === "checking"
      ? "checking AR"
      : status.state === "starting"
        ? "starting AR"
        : status.state === "active"
          ? `frames ${status.frames} · raw ${status.rawMeters.toFixed(2)}m · map ${status.mapMeters.toFixed(2)}m`
          : status.state === "unsupported"
            ? "AR not supported"
            : status.state === "error"
              ? "AR error"
              : `${map.tiling.type} map`;

  return (
    <div style={panel}>
      <button
        style={{ ...button, ...(active ? activeButton : null) }}
        onClick={() => window.dispatchEvent(new Event(active ? AR_WALK_STOP_EVENT : AR_WALK_START_EVENT))}
        title="Use Android WebXR AR pose tracking to move through this square/hex tiled composition"
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
  maxWidth: 240,
  color: "rgba(255,255,255,0.58)",
  whiteSpace: "nowrap",
};
