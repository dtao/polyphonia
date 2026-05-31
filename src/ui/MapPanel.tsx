import { useState } from "react";
import { MAP_PRESETS, MapPreset } from "../map";
import { useStore, viewState } from "../store";

const LABELS: Record<MapPreset, string> = {
  open: "Open",
  line: "Line",
  y: "Y",
};

export function MapPanel() {
  const map = useStore((s) => s.composition.map);
  const setMap = useStore((s) => s.setMap);
  const [expanded, setExpanded] = useState(false);

  function setPreset(preset: MapPreset) {
    const next = MAP_PRESETS[preset];
    setMap({ ...next, start: map.start });
  }

  function setStartHere() {
    setMap({
      start: {
        position: [viewState.x, viewState.z],
        direction: [viewState.fx, viewState.fz],
      },
    });
  }

  function goToStart() {
    setMap({ start: map.start });
  }

  if (!expanded) {
    return (
      <button style={collapsed} onClick={() => setExpanded(true)} title="Edit walkable map">
        Map: {LABELS[map.preset]}
      </button>
    );
  }

  return (
    <div style={panel}>
      <div style={head}>
        <strong style={{ fontSize: 13 }}>Map</strong>
        <button style={closeBtn} onClick={() => setExpanded(false)} title="Collapse map controls">
          ×
        </button>
      </div>
      <div style={presetGrid}>
        {(Object.keys(MAP_PRESETS) as MapPreset[]).map((preset) => {
          const active = map.preset === preset;
          return (
            <button key={preset} style={{ ...presetBtn, ...(active ? presetActive : null) }} onClick={() => setPreset(preset)}>
              {LABELS[preset]}
            </button>
          );
        })}
      </div>
      <div style={actionRow}>
        <button style={actionBtn} onClick={setStartHere}>
          Set start here
        </button>
        <button style={actionBtn} onClick={goToStart}>
          Go to start
        </button>
      </div>
      <div style={meta}>{map.segments.length ? "Walkable corridors with boundary walls" : "Unbounded empty space"}</div>
    </div>
  );
}

const collapsed: React.CSSProperties = {
  position: "absolute",
  top: 128,
  left: 14,
  padding: "8px 14px",
  fontSize: 13,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(12,15,28,0.72)",
  color: "rgba(255,255,255,0.84)",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
  backdropFilter: "blur(8px)",
};

const panel: React.CSSProperties = {
  position: "absolute",
  top: 128,
  left: 14,
  width: 250,
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 10,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 10,
};

const closeBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.7)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
};

const presetGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 6,
};

const presetBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 13,
};

const presetActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
};

const actionRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  marginTop: 10,
};

const actionBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.84)",
  cursor: "pointer",
  fontSize: 12,
};

const meta: React.CSSProperties = {
  marginTop: 8,
  color: "rgba(255,255,255,0.55)",
  fontSize: 11,
};
