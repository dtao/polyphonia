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

  function setTunnel(tunnel: boolean) {
    setMap({
      preset: "custom",
      segments: map.segments.map((s) => (s.id === segmentId ? { ...s, kind: tunnel ? "tunnel" : "path" } : s)),
    });
  }

  const isTunnel = segment.kind === "tunnel";

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
      <div style={kindGrid}>
        <button style={{ ...kindBtn, ...(!isTunnel ? kindActive : null) }} onClick={() => setTunnel(false)} title="Open walkable strip">
          Open path
        </button>
        <button style={{ ...kindBtn, ...(isTunnel ? kindActive : null) }} onClick={() => setTunnel(true)} title="Enclosed corridor that occludes outside sound">
          Tunnel
        </button>
      </div>
      <div style={hint}>{isTunnel ? "Enclosed: walls + ceiling muffle sound passing in or out the sides." : "Click a path point to edit branches from this segment."}</div>
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

const kindGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  marginTop: 12,
};

const kindBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 13,
};

const kindActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
};

const hint: React.CSSProperties = { marginTop: 10, fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.55)" };
