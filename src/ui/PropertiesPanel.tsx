import { useStore } from "../store";

// Edit-mode inspector for the selected track. Every control applies live —
// volume and falloff flow straight to the audio engine as you drag.
export function PropertiesPanel() {
  const mode = useStore((s) => s.mode);
  const track = useStore((s) => s.composition.tracks.find((t) => t.id === s.selectedId));
  const { renameTrack, setTrackColor, setTrackVolume, setTrackFalloff, deleteTrack } = useStore.getState();

  if (mode !== "edit" || !track) return null;

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <input
          type="color"
          value={track.color}
          onChange={(e) => setTrackColor(track.id, e.target.value)}
          style={{ width: 28, height: 28, border: "none", background: "none", padding: 0, cursor: "pointer" }}
        />
        <input
          value={track.name}
          onChange={(e) => renameTrack(track.id, e.target.value)}
          style={nameInput}
        />
      </div>

      <Slider
        label="Volume"
        value={track.volume ?? 1}
        min={0}
        max={1.5}
        step={0.01}
        onChange={(v) => setTrackVolume(track.id, v)}
      />
      <Slider
        label="Near (full)"
        value={track.refDistance ?? 4}
        min={1}
        max={20}
        step={0.5}
        onChange={(v) => setTrackFalloff(track.id, { refDistance: v })}
      />
      <Slider
        label="Far (silent)"
        value={track.maxDistance ?? 40}
        min={10}
        max={80}
        step={1}
        onChange={(v) => setTrackFalloff(track.id, { maxDistance: v })}
      />
      <Slider
        label="Rolloff"
        value={track.rolloff ?? 1}
        min={0.1}
        max={3}
        step={0.1}
        onChange={(v) => setTrackFalloff(track.id, { rolloff: v })}
      />

      <button style={deleteBtn} onClick={() => deleteTrack(track.id)}>
        Delete track
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.75, marginBottom: 2 }}>
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
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

const nameInput: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "white",
  padding: "6px 8px",
  fontSize: 15,
};

const deleteBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "8px",
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
  fontSize: 13,
};
