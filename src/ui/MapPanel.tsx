import { useState } from "react";
import { clampToMap, CompositionMap, isPointInsideMap, MAP_PRESETS, MapPreset, WalkableSegment } from "../map";
import { useStore } from "../store";

const LABELS: Record<MapPreset, string> = {
  open: "Open",
  line: "Line",
  y: "Y",
  custom: "Custom",
};

export function MapPanel() {
  const map = useStore((s) => s.composition.map);
  const tracks = useStore((s) => s.composition.tracks);
  const selectedMapPointKey = useStore((s) => s.selectedMapPointKey);
  const selectedMapSegmentId = useStore((s) => s.selectedMapSegmentId);
  const branchStartPointKey = useStore((s) => s.branchStartPointKey);
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const setBranchStartPoint = useStore((s) => s.setBranchStartPoint);
  const setTrackPosition = useStore((s) => s.setTrackPosition);
  const resetViewToMapStart = useStore((s) => s.resetViewToMapStart);
  const startGizmoMode = useStore((s) => s.startGizmoMode);
  const setStartGizmoMode = useStore((s) => s.setStartGizmoMode);
  const [expanded, setExpanded] = useState(false);
  const selectedPoint = selectedMapPointKey ? findPoint(map, selectedMapPointKey) : null;
  const selectedSegment = selectedMapSegmentId ? map.segments.find((segment) => segment.id === selectedMapSegmentId) ?? null : null;
  const averageWidth = map.segments.length ? map.segments.reduce((sum, s) => sum + s.width, 0) / map.segments.length : 7.5;
  const widthValue = selectedSegment?.width ?? averageWidth;
  const warnings = validateMap(map, tracks);
  const outsideTrackCount = countTracksOutsideMap(map, tracks);

  function setPreset(preset: Exclude<MapPreset, "custom">) {
    const next = MAP_PRESETS[preset];
    setMap({ ...next, start: map.start });
  }

  function goToStart() {
    resetViewToMapStart();
  }

  function toggleBranchPlacement() {
    if (!selectedMapPointKey) return;
    setBranchStartPoint(branchStartPointKey === selectedMapPointKey ? null : selectedMapPointKey);
  }

  function deletePoint() {
    if (!selectedMapPointKey) return;
    setMap({
      preset: "custom",
      segments: map.segments.filter((segment) => pointKey(segment.start) !== selectedMapPointKey && pointKey(segment.end) !== selectedMapPointKey),
    });
    selectMapPoint(null);
    setBranchStartPoint(null);
  }

  function setWidth(width: number) {
    if (selectedSegment) {
      setMap({
        preset: "custom",
        segments: map.segments.map((segment) => (segment.id === selectedSegment.id ? { ...segment, width } : segment)),
      });
      return;
    }
    setMap({
      preset: "custom",
      segments: map.segments.map((segment) => ({ ...segment, width })),
    });
  }

  function snapStemsToMap() {
    for (const track of tracks) {
      const [x, y, z] = track.position;
      const [nx, nz] = clampToMap(map, [x, z]);
      if (Math.hypot(nx - x, nz - z) > 0.001) setTrackPosition(track.id, [nx, y, nz]);
    }
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
        <button
          style={{ ...presetBtn, ...(startGizmoMode === "translate" ? presetActive : null) }}
          onClick={() => setStartGizmoMode("translate")}
        >
          Move start
        </button>
        <button
          style={{ ...presetBtn, ...(startGizmoMode === "rotate" ? presetActive : null) }}
          onClick={() => setStartGizmoMode("rotate")}
        >
          Rotate start
        </button>
      </div>
      <div style={actionRow}>
        <button style={{ ...actionBtn, gridColumn: "1 / -1" }} onClick={goToStart}>
          Go to start
        </button>
      </div>
      <div style={hint}>
        Click the <strong>disc</strong> to move the start position; click the <strong>arrow</strong> to rotate the facing direction. Then drag the gizmo.
      </div>
      <div style={editorGroup}>
        <div style={editorHead}>
          {selectedPoint
            ? `Point ${selectedPoint[0].toFixed(1)}, ${selectedPoint[1].toFixed(1)}`
            : selectedSegment
              ? `Segment ${selectedSegment.id}`
              : "Select a corridor or handle"}
        </div>
        <div style={actionRow}>
          <button style={{ ...actionBtn, opacity: selectedPoint ? 1 : 0.45 }} onClick={toggleBranchPlacement} disabled={!selectedPoint}>
            {branchStartPointKey ? "Cancel branch" : "Place branch"}
          </button>
          <button style={{ ...dangerBtn, opacity: selectedPoint ? 1 : 0.45 }} onClick={deletePoint} disabled={!selectedPoint}>
            Delete point
          </button>
        </div>
        <label style={widthLabel}>
          <div style={sliderHead}>
            <span>{selectedSegment ? "Segment width" : "All widths"}</span>
            <span>{widthValue.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={3}
            max={18}
            step={0.5}
            value={widthValue}
            onChange={(e) => setWidth(parseFloat(e.target.value))}
            disabled={!map.segments.length}
            style={{ width: "100%", accentColor: "#5b8cff", cursor: map.segments.length ? "pointer" : "not-allowed" }}
          />
        </label>
        <button
          style={{ ...actionBtn, width: "100%", marginTop: 10, opacity: outsideTrackCount ? 1 : 0.45 }}
          onClick={snapStemsToMap}
          disabled={!outsideTrackCount}
        >
          Snap stems to map
        </button>
      </div>
      {branchStartPointKey && <div style={hint}>Click the floor to place the new branch endpoint.</div>}
      {warnings.length > 0 && (
        <div style={warningsBox}>
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
      <div style={meta}>{map.segments.length ? "Lighted walkable path" : "Unbounded empty space"}</div>
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

function validateMap(map: CompositionMap, tracks: Array<{ position: [number, number, number] }>): string[] {
  const warnings: string[] = [];
  if (map.preset !== "open" && map.segments.length === 0) warnings.push("This map has no walkable corridors.");
  const components = countConnectedComponents(map.segments);
  if (components > 1) warnings.push("This map has disconnected corridors.");
  const outside = countTracksOutsideMap(map, tracks);
  if (outside > 0) warnings.push(`${outside} stem${outside === 1 ? "" : "s"} outside the walkable area.`);
  return warnings;
}

function countTracksOutsideMap(map: CompositionMap, tracks: Array<{ position: [number, number, number] }>): number {
  if (!map.segments.length) return 0;
  return tracks.filter((track) => !isPointInsideMap(map, [track.position[0], track.position[2]])).length;
}

function countConnectedComponents(segments: WalkableSegment[]): number {
  if (!segments.length) return 0;
  const adjacency = new Map<string, Set<string>>();
  for (const segment of segments) {
    const start = pointKey(segment.start);
    const end = pointKey(segment.end);
    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start)?.add(end);
    adjacency.get(end)?.add(start);
  }
  let count = 0;
  const visited = new Set<string>();
  for (const key of adjacency.keys()) {
    if (visited.has(key)) continue;
    count += 1;
    const stack = [key];
    visited.add(key);
    while (stack.length) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
  }
  return count;
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

const hint: React.CSSProperties = {
  marginTop: 9,
  color: "rgba(143,255,232,0.82)",
  fontSize: 11,
  lineHeight: 1.35,
};

const warningsBox: React.CSSProperties = {
  display: "grid",
  gap: 4,
  marginTop: 10,
  padding: "8px 9px",
  borderRadius: 7,
  border: "1px solid rgba(255,209,102,0.28)",
  background: "rgba(255,209,102,0.1)",
  color: "rgba(255,232,173,0.9)",
  fontSize: 11,
  lineHeight: 1.35,
};
