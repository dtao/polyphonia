import { useEffect, useRef, useState } from "react";
import { CompositionMap } from "../map";
import { geoWalk, viewState } from "../store";

type GeoStatus = "idle" | "starting" | "active" | "unsupported" | "error";

const METERS_PER_DEGREE_LAT = 111_320;
const FEET_PER_UNIT = 100;
const METERS_PER_UNIT = FEET_PER_UNIT * 0.3048;
const UNITS_PER_METER = 1 / METERS_PER_UNIT;
const MIN_MOVEMENT_METERS = 1.5;
const FIRST_HEADING_METERS = 5;
const MAX_STEP_METERS = 160;
const POSITION_SMOOTHING = 0.35;

export function GeoWalkControls({ map }: { map: CompositionMap }) {
  const tiled = map.tiling.type === "square" || map.tiling.type === "hex";
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const origin = useRef<{ lat: number; lon: number; cosLat: number } | null>(null);
  const smoothed = useRef<[number, number] | null>(null);
  const rotation = useRef<number | null>(null);

  useEffect(() => {
    if (!tiled && enabled) setEnabled(false);
  }, [enabled, tiled]);

  useEffect(() => {
    geoWalk.active = enabled && tiled;
    if (!enabled || !tiled) {
      stopWatch();
      resetWalk();
      if (!tiled) setStatus("idle");
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
      maximumAge: 500,
      timeout: 15_000,
    });

    return () => {
      stopWatch();
      resetWalk();
    };
  }, [enabled, tiled]);

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
    setSpeed(null);
  }

  function onPosition(position: GeolocationPosition): void {
    const { latitude, longitude, accuracy: nextAccuracy, speed: metersPerSecond } = position.coords;
    setAccuracy(nextAccuracy);
    setSpeed(typeof metersPerSecond === "number" && Number.isFinite(metersPerSecond) ? metersPerSecond : null);
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
    geoWalk.pendingX += (realDx * c - realDz * s) * UNITS_PER_METER;
    geoWalk.pendingZ += (realDx * s + realDz * c) * UNITS_PER_METER;
  }

  function onError(err: GeolocationPositionError): void {
    console.error("Geo Walk failed", err);
    stopWatch();
    resetWalk();
    setStatus("error");
  }

  if (!tiled) return null;

  const active = enabled && status !== "error" && status !== "unsupported";
  const label = active ? "Geo Drive on" : "Geo Drive";
  const detail =
    status === "starting"
      ? "waiting for GPS"
      : status === "active"
        ? geoDetail(accuracy, speed)
        : status === "unsupported"
          ? "GPS not supported"
          : status === "error"
            ? "permission or GPS error"
            : "100 ft = 1 unit";

  return (
    <div style={panel}>
      <button
        style={{ ...button, ...(active ? activeButton : null) }}
        onClick={() => {
          if (enabled) setStatus("idle");
          setEnabled((value) => !value);
        }}
        title="Use device geolocation to move through this tiled composition while driving"
      >
        {label}
      </button>
      <span style={detailStyle}>{detail}</span>
    </div>
  );
}

function geoDetail(accuracy: number | null, speed: number | null): string {
  const bits: string[] = [];
  if (accuracy !== null) bits.push(`±${Math.round(accuracy)}m`);
  if (speed !== null) bits.push(`${Math.round(speed * 2.23694)}mph`);
  return bits.length ? bits.join(" · ") : "GPS active";
}

const panel: React.CSSProperties = {
  position: "absolute",
  right: 14,
  bottom: 62,
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
  maxWidth: 180,
  color: "rgba(255,255,255,0.58)",
  whiteSpace: "nowrap",
};
