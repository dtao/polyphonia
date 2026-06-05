import type React from "react";
import type { AudioLoadingState } from "../store";

export function AudioLoadingOverlay({ loading }: { loading: AudioLoadingState }) {
  if (loading.status === "idle") return null;

  const isLoading = loading.status === "loading";
  const total = isLoading ? loading.total : 0;
  const loaded = isLoading ? loading.loaded : 0;
  const percent = isLoading && total > 0 ? Math.min(100, Math.max(6, (loaded / total) * 100)) : 100;
  const detail = isLoading ? loadingDetail(loading) : loading.message;

  return (
    <div style={scrim} role="status" aria-live="polite">
      <div style={panel}>
        <div style={eyebrow}>{isLoading ? "Loading music" : "Audio failed"}</div>
        <div style={title}>{isLoading ? `${Math.round(percent)}%` : "Couldn't start playback"}</div>
        <div style={meter} aria-hidden="true">
          <div style={{ ...meterFill, width: `${percent}%` }} />
        </div>
        <div style={detailText}>{detail}</div>
      </div>
    </div>
  );
}

function loadingDetail(loading: Extract<AudioLoadingState, { status: "loading" }>): string {
  if (!loading.total) return "Preparing the audio engine...";
  const name = loading.trackName ? ` "${loading.trackName}"` : "";
  if (loading.phase === "fetching") return `Downloading${name} (${loading.loaded + 1} of ${loading.total})`;
  if (loading.phase === "decoding") return `Decoding${name} (${loading.loaded + 1} of ${loading.total})`;
  return `Preparing stems (${loading.loaded} of ${loading.total})`;
}

const scrim: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  color: "white",
  fontFamily: "system-ui, sans-serif",
  background: "rgba(8,10,14,0.44)",
  backdropFilter: "grayscale(1) saturate(0.28) brightness(0.55)",
  WebkitBackdropFilter: "grayscale(1) saturate(0.28) brightness(0.55)",
  pointerEvents: "auto",
};

const panel: React.CSSProperties = {
  width: "min(360px, calc(100vw - 48px))",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "18px 20px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(10,12,18,0.72)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};

const eyebrow: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0,
  color: "rgba(255,255,255,0.58)",
};

const title: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1,
};

const meter: React.CSSProperties = {
  height: 8,
  overflow: "hidden",
  borderRadius: 999,
  background: "rgba(255,255,255,0.16)",
};

const meterFill: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #56e0c0, #ffd166, #5b8cff)",
  transition: "width 180ms ease",
};

const detailText: React.CSSProperties = {
  minHeight: 18,
  fontSize: 13,
  color: "rgba(255,255,255,0.72)",
};
