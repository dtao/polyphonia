import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { TrackDef } from "../composition";

const BINS = 480;
const HEIGHT = 64;
// Timing-offset marker color — gold, to read as distinct from the white loop
// in/out handles and playhead.
const OFFSET_COLOR = "#ffcc44";

// M7.5 — waveform meter for the selected stem with draggable in/out handles
// defining a per-stem sub-loop. Trim by default (region plays once, then
// silence); the Repeat toggle tiles the region to fill the composition loop.
export function StemLoopMeter({ track }: { track: TrackDef }) {
  const engine = useStore((s) => s.engine);
  const bpm = useStore((s) => s.composition.bpm);
  const beats = useStore((s) => s.composition.beats);
  const beatsPerBar = useStore((s) => s.composition.beatsPerBar ?? 4);
  const trackPeaks = useStore((s) => s.trackPeaks);
  const setTrackLoop = useStore((s) => s.setTrackLoop);
  const setTrackOffset = useStore((s) => s.setTrackOffset);
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
  const musicalLength = beats ? beats * beatLength : duration;
  const inSec = clamp(track.loopStart ?? 0, 0, duration);
  const outSec = clamp(track.loopEnd ?? Math.min(duration, inSec + musicalLength), inSec, duration);
  const regionLen = Math.max(0.0001, outSec - inSec);
  const repeat = track.loopRepeat ?? false;
  const custom = track.loopStart != null || track.loopEnd != null;
  // Coarse (beat-snapped) timing offset, set by clicking the meter, drawn as a
  // distinct bar. The fine offset (slider) adds to it for the audio phase and
  // the playhead mapping, which subtracts the total from the loop position.
  const offsetBeatsCoarse = track.offsetBeats ?? 0;
  const offsetSec = (offsetBeatsCoarse + (track.offsetFineBeats ?? 0)) * beatLength;

  // Live playhead, mapped from the composition loop position back into source
  // time for this stem.
  useEffect(() => {
    if (!duration) return;
    let frame = 0;
    const tick = () => {
      const p = loopProgress();
      if (p && p.duration > 0) {
        const pos = (((p.position - offsetSec) % p.duration) + p.duration) % p.duration;
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
  }, [loopProgress, duration, inSec, regionLen, repeat, offsetSec]);

  if (!data || duration <= 0) {
    return <div style={unavailable}>Waveform appears once audio is playing.</div>;
  }

  const beatCount = Math.min(256, Math.max(1, Math.round(duration / beatLength)));

  const secFromPointer = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  // Snap a source-time position to the nearest whole beat, like the coarse
  // offset (P44). The clip in/out points line up with the beat grid just as the
  // offset does, so trims stay musically aligned.
  const snapToBeat = (sec: number): number =>
    clamp(Math.round(sec / beatLength) * beatLength, 0, duration);

  const startDrag = (handle: "in" | "out") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const sec = snapToBeat(secFromPointer(ev.clientX));
      // Keep at least a one-beat region between the handles.
      if (handle === "in")
        setTrackLoop(track.id, { loopStart: Math.max(0, Math.min(sec, outSec - beatLength)) });
      else
        setTrackLoop(track.id, { loopEnd: Math.min(duration, Math.max(sec, inSec + beatLength)) });
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

  // Press or drag anywhere on the meter (outside the in/out handles, which stop
  // propagation) to set the coarse timing offset, snapped to the nearest beat.
  const startOffsetDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const apply = (clientX: number) => {
      const snapped = clamp(Math.round(secFromPointer(clientX) / beatLength), 0, beatCount);
      setTrackOffset(track.id, { offsetBeats: snapped });
    };
    apply(e.clientX);
    const onMove = (ev: PointerEvent) => apply(ev.clientX);
    const onUp = (ev: PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer already released */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const totalOffsetBeats = offsetBeatsCoarse + (track.offsetFineBeats ?? 0);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={headRow}>
        <span>Stem loop</span>
        <span>
          {formatBeats(regionLen / beatLength)} beats
          {totalOffsetBeats !== 0 && (
            <span style={{ color: OFFSET_COLOR }}> · {totalOffsetBeats > 0 ? "+" : ""}{formatBeats(totalOffsetBeats)} beat offset</span>
          )}
        </span>
      </div>
      <div ref={trackRef} style={meterTrack} onPointerDown={startOffsetDrag}>
        <canvas ref={canvasRef} style={canvasStyle} />
        {/* Dimmed area outside the loop region. */}
        <div style={{ ...mask, left: 0, width: `${(inSec / duration) * 100}%` }} />
        <div style={{ ...mask, right: 0, width: `${((duration - outSec) / duration) * 100}%` }} />
        {/* Beat / bar markers. */}
        {Array.from({ length: beatCount + 1 }, (_, i) => {
          const t = i * beatLength;
          if (t > duration) return null;
          const isBar = i % beatsPerBar === 0;
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
        {/* Coarse timing-offset marker (distinct from the white in/out handles). */}
        <div style={{ ...offsetBar, left: `${((offsetBeatsCoarse * beatLength) / duration) * 100}%` }}>
          <div style={offsetFlag} />
        </div>
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

// Whole beats render cleanly; partial regions (from free handle drags) keep one
// decimal so the readout still reflects the dragged length.
function formatBeats(beats: number): string {
  const rounded = Math.round(beats * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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

const offsetBar: React.CSSProperties = {
  position: "absolute",
  top: -2,
  bottom: -2,
  width: 2,
  transform: "translateX(-1px)",
  background: OFFSET_COLOR,
  boxShadow: `0 0 6px ${OFFSET_COLOR}`,
  pointerEvents: "none",
};

const offsetFlag: React.CSSProperties = {
  position: "absolute",
  top: -1,
  left: "50%",
  transform: "translateX(-50%)",
  width: 0,
  height: 0,
  borderLeft: "4px solid transparent",
  borderRight: "4px solid transparent",
  borderTop: `5px solid ${OFFSET_COLOR}`,
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
