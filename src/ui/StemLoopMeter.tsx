import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { TrackDef } from "../composition";

const BINS = 480;
const HEIGHT = 64;

// M7.5 — waveform meter for the selected stem with draggable in/out handles
// defining a per-stem sub-loop. Trim by default (region plays once, then
// silence); the Repeat toggle tiles the region to fill the composition loop.
export function StemLoopMeter({ track }: { track: TrackDef }) {
  const engine = useStore((s) => s.engine);
  const bpm = useStore((s) => s.composition.bpm);
  const bars = useStore((s) => s.composition.bars);
  const trackPeaks = useStore((s) => s.trackPeaks);
  const setTrackLoop = useStore((s) => s.setTrackLoop);
  const loopProgress = useStore((s) => s.loopProgress);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ peaks: Float32Array; duration: number } | null>(null);
  const [playFrac, setPlayFrac] = useState<number | null>(null);

  // (Re)load the waveform when the selected stem or engine changes.
  useEffect(() => {
    setData(trackPeaks(track.id, BINS));
  }, [track.id, engine, trackPeaks]);

  // Draw the waveform once we have peaks.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    canvas.width = data.peaks.length;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = track.color;
    const mid = HEIGHT / 2;
    for (let i = 0; i < data.peaks.length; i++) {
      const h = Math.max(1, data.peaks[i] * (HEIGHT - 2));
      ctx.fillRect(i, mid - h / 2, 1, h);
    }
  }, [data, track.color]);

  const duration = data?.duration ?? 0;
  const beatLength = bpm > 0 ? 60 / bpm : 0.5;
  const musicalLength = bars ? bars * 4 * beatLength : duration;
  const inSec = clamp(track.loopStart ?? 0, 0, duration);
  const outSec = clamp(track.loopEnd ?? Math.min(duration, inSec + musicalLength), inSec, duration);
  const regionLen = Math.max(0.0001, outSec - inSec);
  const repeat = track.loopRepeat ?? false;
  const custom = track.loopStart != null || track.loopEnd != null;

  // Live playhead, mapped from the composition loop position back into source
  // time for this stem.
  useEffect(() => {
    if (!duration) return;
    let frame = 0;
    const tick = () => {
      const p = loopProgress();
      if (p && p.duration > 0) {
        const pos = p.position % p.duration;
        let src: number | null;
        if (repeat) src = inSec + (pos % regionLen);
        else src = pos < regionLen ? inSec + pos : null;
        setPlayFrac(src == null ? null : src / duration);
      } else {
        setPlayFrac(null);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [loopProgress, duration, inSec, regionLen, repeat]);

  if (!data || duration <= 0) {
    return <div style={unavailable}>Waveform appears once audio is playing.</div>;
  }

  const beats = Math.min(256, Math.max(1, Math.round(duration / beatLength)));

  const secFromPointer = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  const startDrag = (handle: "in" | "out") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const sec = secFromPointer(ev.clientX);
      if (handle === "in") setTrackLoop(track.id, { loopStart: Math.min(sec, outSec - 0.01) });
      else setTrackLoop(track.id, { loopEnd: Math.max(sec, inSec + 0.01) });
    };
    const onUp = (ev: PointerEvent) => {
      try {
        (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer already released */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={headRow}>
        <span>Stem loop</span>
        <span>{formatTime(regionLen)} region</span>
      </div>
      <div ref={trackRef} style={meterTrack}>
        <canvas ref={canvasRef} style={canvasStyle} />
        {/* Dimmed area outside the loop region. */}
        <div style={{ ...mask, left: 0, width: `${(inSec / duration) * 100}%` }} />
        <div style={{ ...mask, right: 0, width: `${((duration - outSec) / duration) * 100}%` }} />
        {/* Beat / bar markers. */}
        {Array.from({ length: beats + 1 }, (_, i) => {
          const t = i * beatLength;
          if (t > duration) return null;
          const isBar = i % 4 === 0;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: isBar ? 0 : "35%",
                bottom: 0,
                left: `${(t / duration) * 100}%`,
                width: 1,
                background: isBar ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)",
              }}
            />
          );
        })}
        {playFrac != null && <div style={{ ...playhead, left: `${playFrac * 100}%` }} />}
        <Handle side="in" left={`${(inSec / duration) * 100}%`} onPointerDown={startDrag("in")} />
        <Handle side="out" left={`${(outSec / duration) * 100}%`} onPointerDown={startDrag("out")} />
      </div>
      <div style={controlRow}>
        <label style={toggle}>
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setTrackLoop(track.id, { loopRepeat: e.target.checked })}
          />
          Repeat to fill loop
        </label>
        {custom && (
          <button
            style={resetBtn}
            onClick={() => setTrackLoop(track.id, { loopStart: null, loopEnd: null })}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function Handle({ side, left, onPointerDown }: { side: "in" | "out"; left: string; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      title={side === "in" ? "Loop start" : "Loop end"}
      style={{
        position: "absolute",
        top: -3,
        bottom: -3,
        left,
        width: 10,
        transform: "translateX(-5px)",
        cursor: "ew-resize",
        display: "flex",
        justifyContent: "center",
        touchAction: "none",
      }}
    >
      <div style={{ width: 2, background: "white", boxShadow: "0 0 4px rgba(0,0,0,0.6)" }} />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

const headRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  opacity: 0.75,
  marginBottom: 4,
};

const meterTrack: React.CSSProperties = {
  position: "relative",
  height: HEIGHT,
  borderRadius: 6,
  overflow: "hidden",
  background: "rgba(0,0,0,0.3)",
  border: "1px solid rgba(255,255,255,0.12)",
  touchAction: "none",
};

const canvasStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const mask: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  background: "rgba(8,10,20,0.62)",
};

const playhead: React.CSSProperties = {
  position: "absolute",
  top: -1,
  bottom: -1,
  width: 2,
  transform: "translateX(-1px)",
  background: "white",
  boxShadow: "0 0 8px rgba(255,255,255,0.9)",
  pointerEvents: "none",
};

const controlRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginTop: 6,
};

const toggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  opacity: 0.85,
};

const resetBtn: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.8)",
  cursor: "pointer",
  fontSize: 11,
};

const unavailable: React.CSSProperties = {
  marginBottom: 10,
  padding: "10px 8px",
  borderRadius: 6,
  background: "rgba(0,0,0,0.25)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.5)",
  fontSize: 11,
  textAlign: "center",
};
