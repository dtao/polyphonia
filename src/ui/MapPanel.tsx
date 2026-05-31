import { useState } from "react";
import { MAP_PRESETS, MapPreset } from "../map";
import { useStore, viewState } from "../store";

const LABELS: Record<MapPreset, string> = {
  open: "Open",
  line: "Line",
  y: "Y",
  custom: "Custom",
};

export function MapPanel() {
  const map = useStore((s) => s.composition.map);
  const selectedMapPointKey = useStore((s) => s.selectedMapPointKey);
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const resetViewToMapStart = useStore((s) => s.resetViewToMapStart);
  const [expanded, setExpanded] = useState(false);
  const selectedPoint = selectedMapPointKey ? findPoint(map, selectedMapPointKey) : null;
  const averageWidth = map.segments.length ? map.segments.reduce((sum, s) => sum + s.width, 0) / map.segments.length : 7.5;

  function setPreset(preset: Exclude<MapPreset, "custom">) {
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
    resetViewToMapStart();
  }

  function addBranch() {
    if (!selectedPoint) return;
    const length = 18;
    const directionLength = Math.hypot(viewState.fx, viewState.fz) || 1;
    const end: [number, number] = [
      selectedPoint[0] + (viewState.fx / directionLength) * length,
      selectedPoint[1] + (viewState.fz / directionLength) * length,
    ];
    setMap({
      preset: "custom",
      segments: [
        ...map.segments,
        {
          id: `branch-${Date.now().toString(36)}`,
          start: selectedPoint,
          end,
          width: averageWidth,
        },
      ],
    });
    selectMapPoint(pointKey(end));
  }

  function deletePoint() {
    if (!selectedMapPointKey) return;
    setMap({
      preset: "custom",
      segments: map.segments.filter((segment) => pointKey(segment.start) !== selectedMapPointKey && pointKey(segment.end) !== selectedMapPointKey),
    });
    selectMapPoint(null);
  }

  function setWidth(width: number) {
    setMap({
      preset: "custom",
      segments: map.segments.map((segment) => ({ ...segment, width })),
    });
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
        {(Object.keys(MAP_PRESETS) as Array<Exclude<MapPreset, "custom">>).map((preset) => {
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
      <div style={editorGroup}>
        <div style={editorHead}>
          {selectedPoint
            ? `Point ${selectedPoint[0].toFixed(1)}, ${selectedPoint[1].toFixed(1)}`
            : "Select a map handle"}
        </div>
        <div style={actionRow}>
          <button style={{ ...actionBtn, opacity: selectedPoint ? 1 : 0.45 }} onClick={addBranch} disabled={!selectedPoint}>
            Add branch
          </button>
          <button style={{ ...dangerBtn, opacity: selectedPoint ? 1 : 0.45 }} onClick={deletePoint} disabled={!selectedPoint}>
            Delete point
          </button>
        </div>
        <label style={widthLabel}>
          <div style={sliderHead}>
            <span>Width</span>
            <span>{averageWidth.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={3}
            max={18}
            step={0.5}
            value={averageWidth}
            onChange={(e) => setWidth(parseFloat(e.target.value))}
            disabled={!map.segments.length}
            style={{ width: "100%", accentColor: "#5b8cff", cursor: map.segments.length ? "pointer" : "not-allowed" }}
          />
        </label>
      </div>
      <div style={meta}>{map.segments.length ? "Walkable corridors with boundary walls" : "Unbounded empty space"}</div>
    </div>
  );
}

function findPoint(map: { segments: Array<{ start: [number, number]; end: [number, number] }> }, key: string): [number, number] | null {
  for (const segment of map.segments) {
    if (pointKey(segment.start) === key) return segment.start;
    if (pointKey(segment.end) === key) return segment.end;
  }
  return null;
}

function pointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
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

const dangerBtn: React.CSSProperties = {
  ...actionBtn,
  border: "1px solid rgba(255,122,107,0.35)",
  background: "rgba(255,122,107,0.12)",
};

const editorGroup: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const editorHead: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.7)",
};

const widthLabel: React.CSSProperties = {
  display: "block",
  marginTop: 10,
};

const sliderHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  color: "rgba(255,255,255,0.7)",
};

const meta: React.CSSProperties = {
  marginTop: 8,
  color: "rgba(255,255,255,0.55)",
  fontSize: 11,
};
