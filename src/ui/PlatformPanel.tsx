import { PlatformShape, platformElevation } from "../map";
import { useStore } from "../store";
import { ElevationReadout } from "./ElevationReadout";

// Bottom-left inspector for the selected platform (open walkable area). Shown in
// edit mode when a platform is selected.
export function PlatformPanel() {
  const mode = useStore((s) => s.mode);
  const map = useStore((s) => s.composition.map);
  const platform = useStore((s) => s.composition.map.platforms.find((p) => p.id === s.selectedPlatformId));
  const { updatePlatform, deletePlatform } = useStore.getState();

  if (mode !== "edit" || !platform) return null;

  const isRect = platform.shape === "rect";
  const attached = !!platform.attachment;

  return (
    <div style={panel} data-inspector>
      <div style={title}>Platform</div>

      <ElevationReadout value={platformElevation(map, platform)} />

      <div style={shapeGrid}>
        {(["rect", "hex", "circle"] as PlatformShape[]).map((shape) => (
          <button key={shape} style={{ ...shapeBtn, ...(platform.shape === shape ? shapeActive : null) }} onClick={() => updatePlatform(platform.id, { shape })}>
            {shape === "rect" ? "Rectangle" : shape === "hex" ? "Hex" : "Circle"}
          </button>
        ))}
      </div>

      <Slider label={isRect ? "Width" : "Diameter"} value={platform.width} min={4} max={120} step={1} onChange={(v) => updatePlatform(platform.id, { width: v })} />
      {isRect && <Slider label="Depth" value={platform.depth} min={4} max={120} step={1} onChange={(v) => updatePlatform(platform.id, { depth: v })} />}
      {!attached && <Slider label="Elevation" value={platform.elevation} min={-100} max={100} step={0.5} onChange={(v) => updatePlatform(platform.id, { elevation: v })} />}
      {!attached && <Slider label="Rotation" value={(platform.rotation * 180) / Math.PI} min={-180} max={180} step={1} onChange={(v) => updatePlatform(platform.id, { rotation: (v * Math.PI) / 180 })} />}

      <button style={deleteBtn} onClick={() => deletePlatform(platform.id)} title="Delete selected platform (Delete)">
        Delete platform
      </button>
      <div style={hint}>{attached ? "Attached to a path point; move that point to move the platform." : "Connects to any path, room, or platform whose area it overlaps."}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <div style={sliderHead}>
        <span>{label}</span>
        <span>{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#5b8cff", cursor: "pointer" }}
      />
    </label>
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

const sliderHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  opacity: 0.75,
  marginBottom: 2,
};

const shapeGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 6,
  marginBottom: 10,
};

const shapeBtn: React.CSSProperties = {
  padding: "8px 6px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
  fontSize: 12,
};

const shapeActive: React.CSSProperties = {
  border: "1px solid rgba(91,140,255,0.75)",
  background: "rgba(91,140,255,0.24)",
  color: "white",
};

const deleteBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "8px",
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
  fontSize: 13,
};

const hint: React.CSSProperties = { marginTop: 10, fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.55)" };
