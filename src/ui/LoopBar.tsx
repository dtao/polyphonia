import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

// M7.4 — a persistent edit-mode strip along the bottom of the screen showing
// the whole composition loop with BPM beat markers and a live playhead. The
// Loop panel (seam/tail controls) remains a separate surface above it.
export function LoopBar() {
  const mode = useStore((s) => s.mode);
  const bpm = useStore((s) => s.composition.bpm);
  const beats = useStore((s) => s.composition.beats);
  const beatsPerBar = useStore((s) => s.composition.beatsPerBar ?? 4);
  const loopEnabled = useStore((s) => s.composition.loopEnabled ?? true);
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

  const beatLength = bpm > 0 ? 60 / bpm : 0.5;
  const musicalLength = beats ? beats * beatLength : 0;
  const duration = progress?.duration ?? musicalLength;
  if (duration <= 0) return null;

  const beatCount = Math.max(1, Math.round(duration / beatLength));
  const playFrac = progress ? Math.min(1, Math.max(0, progress.position / duration)) : 0;
  const currentBeat = Math.min(beatCount, Math.floor((progress?.position ?? 0) / beatLength) + 1);

  return (
    <div style={wrap} data-loop-bar>
      <div style={meta}>
        <span>{beats ? `${beats} beats` : "loop"} · {Math.round(bpm)} BPM</span>
        <span>
          {progress?.mode === "audition" ? "seam · " : ""}
          beat {currentBeat}/{beatCount}
        </span>
      </div>
      <div style={{ ...track, opacity: loopEnabled ? 1 : 0.4 }}>
        {Array.from({ length: beatCount + 1 }, (_, i) => {
          const isBar = i % beatsPerBar === 0;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: isBar ? 0 : "30%",
                bottom: 0,
                left: `${(i / beatCount) * 100}%`,
                width: 1,
                transform: "translateX(-0.5px)",
                background: isBar ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.18)",
              }}
            />
          );
        })}
        <div style={{ ...playhead, left: `${playFrac * 100}%` }} />
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 8,
  transform: "translateX(-50%)",
  zIndex: 6,
  width: "min(560px, 64vw)",
  boxSizing: "border-box",
  padding: "6px 10px 8px",
  borderRadius: 10,
  background: "rgba(12,15,28,0.74)",
  border: "1px solid rgba(255,255,255,0.1)",
  backdropFilter: "blur(8px)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
  pointerEvents: "none",
};

const meta: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 10,
  color: "rgba(255,255,255,0.6)",
  marginBottom: 4,
};

const track: React.CSSProperties = {
  position: "relative",
  height: 18,
  borderRadius: 5,
  overflow: "hidden",
  background: "linear-gradient(90deg, rgba(98,240,200,0.25), rgba(91,140,255,0.3))",
  border: "1px solid rgba(255,255,255,0.12)",
};

const playhead: React.CSSProperties = {
  position: "absolute",
  top: -1,
  bottom: -1,
  width: 2,
  transform: "translateX(-1px)",
  background: "white",
  boxShadow: "0 0 8px rgba(255,255,255,0.9)",
};
