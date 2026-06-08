import { useEffect, useState } from "react";
import { useStore } from "../store";

export function LoopPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const mode = useStore((s) => s.mode);
  const comp = useStore((s) => s.composition);
  const setLoopSettings = useStore((s) => s.setLoopSettings);
  const auditionLoopSeam = useStore((s) => s.auditionLoopSeam);
  const loopProgress = useStore((s) => s.loopProgress);
  const [progress, setProgress] = useState<ReturnType<typeof loopProgress>>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setProgress(loopProgress());
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [loopProgress]);

  if (mode !== "edit") return null;

  const enabled = comp.loopEnabled ?? true;
  const start = comp.loopStart ?? 0;
  const endTrim = comp.loopEndTrim ?? 0;
  const crossfade = comp.loopCrossfade ?? 0.035;
  const tail = comp.loopTail ?? false;
  const bars = comp.bars;
  const beatLength = 60 / comp.bpm;
  const loopDuration = bars ? bars * 4 * beatLength : null;

  if (!open) {
    return (
      <button style={collapsed} onClick={onOpen} title="Adjust loop seam" data-edit-drawer>
        Loop {enabled ? "on" : "off"}
      </button>
    );
  }

  return (
    <div style={panel} data-edit-drawer>
      <div style={head}>
        <label style={toggle}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setLoopSettings({ loopEnabled: e.target.checked })}
          />
          Loop
        </label>
        <button style={miniBtn} disabled={!enabled} onClick={auditionLoopSeam}>
          Audition seam
        </button>
        <button style={closeBtn} onClick={onClose} title="Collapse loop controls">
          ×
        </button>
      </div>

      <div style={{ opacity: enabled ? 1 : 0.45 }}>
        <div style={timeline}>
          <div style={tailWindow} />
          <div style={{ ...playhead, left: `${progress ? (progress.position / progress.duration) * 100 : 0}%` }} />
        </div>
        <div style={timeRow}>
          <span>{progress?.mode === "audition" ? "Auditioning seam" : "Loop position"}</span>
          <span>{formatTime(progress?.position ?? 0)} / {formatTime(progress?.duration ?? 0)}</span>
        </div>
      </div>

      <LoopSlider
        label="Start trim"
        value={start}
        min={0}
        max={1}
        step={0.005}
        disabled={!enabled}
        onChange={(v) => setLoopSettings({ loopStart: v })}
      />
      <LoopSlider
        label="End trim"
        value={endTrim}
        min={0}
        max={1}
        step={0.005}
        disabled={!enabled}
        onChange={(v) => setLoopSettings({ loopEndTrim: v })}
      />
      <LoopSlider
        label="Crossfade"
        value={crossfade}
        min={0}
        max={0.15}
        step={0.005}
        disabled={!enabled}
        onChange={(v) => setLoopSettings({ loopCrossfade: v })}
      />
      <label style={{ ...toggle, marginTop: 10, opacity: enabled ? 1 : 0.45 }}>
        <input
          type="checkbox"
          checked={tail}
          disabled={!enabled}
          onChange={(e) => setLoopSettings({ loopTail: e.target.checked })}
        />
        Ring out tails
      </label>

      <div style={{ marginTop: 10, opacity: enabled ? 1 : 0.45 }}>
        <div style={sliderHead}>
          <span>Loop duration</span>
          <span>{bars ? `${bars} bars` : "Auto"}</span>
        </div>
        {bars && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
          {loopDuration?.toFixed(2)}s / {(loopDuration! / 60).toFixed(2)}m
        </div>}
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="number"
            min={1}
            max={64}
            step={1}
            value={bars ?? ""}
            placeholder="Auto"
            disabled={!enabled}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
              setLoopSettings({ bars: val });
            }}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              fontSize: 13,
              cursor: !enabled ? "default" : "text",
            }}
          />
          {bars && (
            <button
              disabled={!enabled}
              onClick={() => setLoopSettings({ bars: undefined })}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)",
                fontSize: 12,
                cursor: !enabled ? "default" : "pointer",
                transition: "all 0.2s",
              }}
            >
              Auto
            </button>
          )}
        </div>
      </div>

      <div style={help}>
        Audition plays the loop boundary: tail into start. Ring out tails folds a
        stem's overrun past the loop length (up to ~2 bars) back onto the start,
        so reverb decays across the seam. Set loop duration to override the
        auto-detected length from the longest stem.
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

function LoopSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "block", opacity: disabled ? 0.45 : 1 }}>
      <div style={sliderHead}>
        <span>{label}</span>
        <span>{value.toFixed(3)}s</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#5b8cff", cursor: disabled ? "default" : "pointer" }}
      />
    </label>
  );
}

const panel: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 64,
  zIndex: 30,
  transform: "translateX(-50%)",
  width: 280,
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 10,
  background: "rgba(12,15,28,0.86)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
};

const collapsed: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 64,
  zIndex: 10,
  transform: "translateX(-50%)",
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(12,15,28,0.72)",
  color: "rgba(255,255,255,0.82)",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  backdropFilter: "blur(8px)",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 8,
};

const toggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 14,
};

const miniBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(91,140,255,0.2)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
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

const sliderHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  opacity: 0.75,
  marginTop: 6,
};

const timeline: React.CSSProperties = {
  position: "relative",
  height: 10,
  margin: "2px 0 4px",
  borderRadius: 999,
  overflow: "hidden",
  background: "linear-gradient(90deg, rgba(98,240,200,0.35), rgba(255,122,107,0.45))",
  border: "1px solid rgba(255,255,255,0.12)",
};

const tailWindow: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 0,
  bottom: 0,
  width: "12%",
  background: "rgba(255,255,255,0.16)",
};

const playhead: React.CSSProperties = {
  position: "absolute",
  top: -2,
  bottom: -2,
  width: 2,
  transform: "translateX(-1px)",
  background: "white",
  boxShadow: "0 0 8px rgba(255,255,255,0.8)",
};

const timeRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  color: "rgba(255,255,255,0.62)",
  fontSize: 11,
  marginBottom: 8,
};

const help: React.CSSProperties = {
  marginTop: 6,
  color: "rgba(255,255,255,0.52)",
  fontSize: 11,
  lineHeight: 1.35,
};
