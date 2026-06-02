import { useStore } from "../store";

// Bottom-left inspector shown when a corridor segment is selected in edit mode.
export function MapSegmentPanel() {
  const mode = useStore((s) => s.mode);
  const map = useStore((s) => s.composition.map);
  const selectedMapSegmentId = useStore((s) => s.selectedMapSegmentId);
  const setMap = useStore((s) => s.setMap);
  const segment = selectedMapSegmentId ? map.segments.find((s) => s.id === selectedMapSegmentId) ?? null : null;

  if (mode !== "edit" || !segment) return null;

  const segmentId = segment.id;

  function setWidth(width: number) {
    setMap({
      preset: "custom",
      segments: map.segments.map((s) => (s.id === segmentId ? { ...s, width } : s)),
    });
  }

  return (
    <div style={panel} data-inspector>
      <div style={title}>Path segment</div>
      <label style={slider}>
        <div style={sliderHead}>
          <span>Width</span>
          <span>{segment.width.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={3}
          max={18}
          step={0.5}
          value={segment.width}
          onChange={(e) => setWidth(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
        />
      </label>
      <div style={hint}>Click a path point to edit branches from this segment.</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 16,
  width: 240,
  padding: 16,
  borderRadius: 12,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
};

const title: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };

const slider: React.CSSProperties = { display: "block" };

const sliderHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  opacity: 0.75,
  marginBottom: 2,
};

const hint: React.CSSProperties = { marginTop: 10, fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.55)" };
