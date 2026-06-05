import { useEffect, useRef, useState } from "react";
import { CompositionMap } from "../map";
import { geoWalk, viewState } from "../store";
import { isTouchDevice } from "./TouchControls";

type GeoStatus = "idle" | "starting" | "active" | "unsupported" | "error";

const METERS_PER_DEGREE_LAT = 111_320;
const MIN_MOVEMENT_METERS = 0.35;
const FIRST_HEADING_METERS = 1.2;
const MAX_STEP_METERS = 18;
const POSITION_SMOOTHING = 0.28;
const DEFAULT_SCALE = 1;

function isMobileTouchDevice(): boolean {
  if (!isTouchDevice()) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function GeoWalkControls({ map }: { map: CompositionMap }) {
  const tiled = map.tiling.type !== "none";
  const mobile = isMobileTouchDevice();
  const available = mobile && tiled;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const origin = useRef<{ lat: number; lon: number; cosLat: number } | null>(null);
  const smoothed = useRef<[number, number] | null>(null);
  const rotation = useRef<number | null>(null);
  const scale = useRef(DEFAULT_SCALE);

  useEffect(() => {
    if (!available && enabled) setEnabled(false);
  }, [available, enabled]);

  useEffect(() => {
    geoWalk.active = enabled && available;
    if (!enabled || !available) {
      stopWatch();
      resetWalk();
      if (!available) setStatus("idle");
      return;
    }

    if (!("geolocation" in navigator)) {
      geoWalk.active = false;
      setStatus("unsupported");
      return;
    }

    setStatus("starting");
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 750,
      timeout: 12_000,
    });

    return () => {
      stopWatch();
      resetWalk();
    };
  }, [available, enabled]);

  function stopWatch(): void {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }

  function resetWalk(): void {
    geoWalk.active = false;
    geoWalk.pendingX = 0;
    geoWalk.pendingZ = 0;
    origin.current = null;
    smoothed.current = null;
    rotation.current = null;
    setAccuracy(null);
  }

  function onPosition(position: GeolocationPosition): void {
    const { latitude, longitude, accuracy: nextAccuracy } = position.coords;
    setAccuracy(nextAccuracy);
    setStatus("active");

    if (!origin.current) {
      origin.current = { lat: latitude, lon: longitude, cosLat: Math.cos((latitude * Math.PI) / 180) };
      smoothed.current = [0, 0];
      return;
    }

    const base = origin.current;
    const east = (longitude - base.lon) * METERS_PER_DEGREE_LAT * base.cosLat;
    const north = (latitude - base.lat) * METERS_PER_DEGREE_LAT;
    const previous = smoothed.current ?? [east, north];
    const next: [number, number] = [
      previous[0] + (east - previous[0]) * POSITION_SMOOTHING,
      previous[1] + (north - previous[1]) * POSITION_SMOOTHING,
    ];
    smoothed.current = next;

    const realDx = next[0] - previous[0];
    const realDz = -1 * (next[1] - previous[1]);
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
    geoWalk.pendingX += (realDx * c - realDz * s) * scale.current;
    geoWalk.pendingZ += (realDx * s + realDz * c) * scale.current;
  }

  function onError(err: GeolocationPositionError): void {
    console.error("Geo Walk failed", err);
    stopWatch();
    geoWalk.active = false;
    geoWalk.pendingX = 0;
    geoWalk.pendingZ = 0;
    origin.current = null;
    smoothed.current = null;
    rotation.current = null;
    setStatus("error");
  }

  if (!available) return null;

  const active = enabled && status !== "error" && status !== "unsupported";
  const label = active ? "Geo Walk on" : "Geo Walk";
  const detail =
    status === "starting"
      ? "waiting for GPS"
      : status === "active"
        ? accuracy !== null
          ? `accuracy ${Math.round(accuracy)}m`
          : "GPS active"
        : status === "unsupported"
          ? "not supported"
          : status === "error"
            ? "permission or GPS error"
            : `${map.tiling.type} map`;

  return (
    <div style={panel}>
      <button
        style={{ ...button, ...(active ? activeButton : null) }}
        onClick={() => {
          if (enabled) setStatus("idle");
          setEnabled((value) => !value);
        }}
        title="Use device geolocation to move through this tiled composition"
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
