import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { shortcutKeys } from "../shortcuts";

const TRACK_COLORS = ["#5b8cff", "#ff7a6b", "#ffd166", "#b96bff", "#56e0c0", "#f78fb3", "#7ee081", "#ffa057"];

// Edit-mode inspector for the selected track. Every control applies live —
// volume and falloff flow straight to the audio engine as you drag.
export function PropertiesPanel() {
  const mode = useStore((s) => s.mode);
  const track = useStore((s) => s.composition.tracks.find((t) => t.id === s.selectedId));
  const { renameTrack, setTrackColor, setTrackVolume, setTrackMinVolume, setTrackFalloff, deleteTrack, duplicateTrack } = useStore.getState();

  if (mode !== "edit" || !track) return null;

  const near = track.refDistance ?? 4;
  const far = Math.max(track.maxDistance ?? 40, near + 1);
  const maxVolume = track.volume ?? 1;
  const minVolume = Math.min(track.minVolume ?? 0, maxVolume);

  return (
    <div style={panel} data-stem-panel>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <TrackColorChooser
          value={track.color}
          onChange={(color) => setTrackColor(track.id, color)}
        />
        <input
          value={track.name}
          onChange={(e) => renameTrack(track.id, e.target.value)}
          style={nameInput}
        />
      </div>

      <Slider
        label="Max volume"
        help="Loudness while you are inside the Near radius."
        value={maxVolume}
        min={0}
        max={1.5}
        step={0.01}
        onChange={(v) => {
          setTrackVolume(track.id, v);
          if (minVolume > v) setTrackMinVolume(track.id, v);
        }}
      />
      <Slider
        label="Min volume"
        help="Loudness once you reach the Far radius; 0 makes the stem silent outside it."
        value={minVolume}
        min={0}
        max={maxVolume}
        step={0.01}
        onChange={(v) => setTrackMinVolume(track.id, v)}
      />
      <Slider
        label="Near (full)"
        help="Within this distance, the stem stays at full spatial volume."
        value={near}
        min={1}
        max={Math.max(1, far - 1)}
        step={0.5}
        onChange={(v) => setTrackFalloff(track.id, { refDistance: v, maxDistance: far <= v ? v + 1 : far })}
      />
      <Slider
        label="Far (min)"
        help="At and beyond this distance, the stem plays at Min volume."
        value={far}
        min={near + 1}
        max={80}
        step={1}
        onChange={(v) => setTrackFalloff(track.id, { maxDistance: v })}
      />
      <Slider
        label="Rolloff"
        help="How quickly the stem fades as you move away; higher is steeper."
        value={track.rolloff ?? 1}
        min={0.1}
        max={3}
        step={0.1}
        onChange={(v) => setTrackFalloff(track.id, { rolloff: v })}
      />

      <div style={actionRow}>
        <button
          style={duplicateBtn}
          onClick={() => duplicateTrack(track.id).catch((err) => console.error("Failed to duplicate track", err))}
          title={`Duplicate track (${shortcutKeys("clone")})`}
        >
          Duplicate
        </button>
        <button style={deleteBtn} onClick={() => deleteTrack(track.id)} title="Delete track (Delete)">
          Delete
        </button>
      </div>
    </div>
  );
}

function TrackColorChooser({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} style={colorChooser}>
      <button
        type="button"
        aria-label="Choose track color"
        aria-expanded={open}
        style={{ ...colorButton, background: value }}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <div style={colorPopover}>
          <div style={colorGrid}>
            {TRACK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Set color ${color}`}
                style={{
                  ...colorSwatch,
                  background: color,
                  outline: color.toLowerCase() === value.toLowerCase() ? "2px solid white" : "none",
                }}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <label style={customColorLabel}>
            Custom
            <input
              type="color"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              style={customColorInput}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  help,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  help: string;
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
      <div style={helpText}>{help}</div>
    </label>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 16,
  width: 240,
  boxSizing: "border-box",
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
  minWidth: 0,
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "white",
  padding: "6px 8px",
  fontSize: 15,
};

const colorChooser: React.CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
};

const colorButton: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  borderRadius: 7,
  border: "2px solid rgba(255,255,255,0.72)",
  boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
  cursor: "pointer",
};

const colorPopover: React.CSSProperties = {
  position: "absolute",
  bottom: 36,
  left: 0,
  zIndex: 20,
  width: 152,
  padding: 10,
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "#151a29",
  boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
};

const colorGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 26px)",
  gap: 8,
};

const colorSwatch: React.CSSProperties = {
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.35)",
  outlineOffset: 2,
  cursor: "pointer",
};

const customColorLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 10,
  fontSize: 11,
  color: "rgba(255,255,255,0.68)",
};

const customColorInput: React.CSSProperties = {
  width: 50,
  height: 24,
  padding: 0,
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 5,
  background: "transparent",
  cursor: "pointer",
};

const actionRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  marginTop: 6,
};

const duplicateBtn: React.CSSProperties = {
  padding: "8px",
  borderRadius: 6,
  border: "1px solid rgba(91,140,255,0.38)",
  background: "rgba(91,140,255,0.14)",
  color: "#bcd0ff",
  cursor: "pointer",
  fontSize: 13,
};

const deleteBtn: React.CSSProperties = {
  padding: "8px",
  borderRadius: 6,
  border: "1px solid rgba(255,122,107,0.4)",
  background: "rgba(255,122,107,0.15)",
  color: "#ff9b8f",
  cursor: "pointer",
  fontSize: 13,
};

const helpText: React.CSSProperties = {
  marginTop: 2,
  color: "rgba(255,255,255,0.52)",
  fontSize: 11,
  lineHeight: 1.35,
};
