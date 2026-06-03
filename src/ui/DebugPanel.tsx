import { useEffect, useState } from "react";
import { clearDebugSamples, debugEnabled, exportDebugSamples, latestDebugSample, DebugSample } from "../debug";

export function DebugPanel() {
  const [enabled] = useState(debugEnabled);
  const [sample, setSample] = useState<DebugSample | null>(() => latestDebugSample());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setSample(latestDebugSample()), 500);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const audio = sample?.audio as
    | null
    | undefined
    | {
        contextState: string;
        started: boolean;
        trackCount: number;
        activeRoom: null | { decay: number; reverbSend: number; impulseDuration: number };
      };

  return (
    <div style={panel} data-inspector>
      <div style={header}>
        <button style={miniBtn} onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Show debug info" : "Hide debug info"}>
          {collapsed ? "Debug" : "Debug"}
        </button>
        {!collapsed && (
          <>
            <button style={miniBtn} onClick={exportDebugSamples}>
              Export
            </button>
            <button
              style={miniBtn}
              onClick={() => {
                clearDebugSamples();
                setSample(null);
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>
      {!collapsed && (
        <div style={body}>
          <div>FPS {fmt(sample?.fps)} · {fmt(sample?.frameMs)}ms</div>
          <div>Memory {sample?.memory ? `${fmt(sample.memory.usedMB)} / ${fmt(sample.memory.totalMB)} MB` : "n/a"}</div>
          <div>Room {sample?.room ? `${sample.room.width}x${sample.room.depth}x${sample.room.height} (${Math.round(sample.room.volume)})` : "none"}</div>
          <div>Tracks {sample?.tracks.count ?? 0} · in room {sample?.tracks.inCurrentRoom ?? 0}</div>
          <div>Map seg {sample?.map.segments ?? 0} · rooms {sample?.map.rooms ?? 0} · loop copies {sample?.map.loopPreviews ?? 0}</div>
          <div>Render calls {sample?.render?.calls ?? 0} · tris {sample?.render ? Math.round(sample.render.triangles / 1000) : 0}k</div>
          <div>Scene meshes {sample?.render?.meshes ?? 0} · point lights {sample?.render?.visiblePointLights ?? 0}</div>
          <div>Audio {audio ? `${audio.contextState} · ${audio.trackCount} tracks` : "none"}</div>
          <div>Audio update {fmt(sample?.timings?.audioUpdateMs)}ms</div>
          <div>
            Reverb{" "}
            {audio?.activeRoom
              ? `${fmt(audio.activeRoom.decay)}s decay · ${fmt(audio.activeRoom.impulseDuration)}s IR · send ${fmt(audio.activeRoom.reverbSend)}`
              : "off"}
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "--";
}

const panel: React.CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 12,
  zIndex: 20,
  width: 270,
  padding: 10,
  borderRadius: 10,
  background: "rgba(4,6,12,0.78)",
  border: "1px solid rgba(255,255,255,0.16)",
  color: "rgba(255,255,255,0.86)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  pointerEvents: "auto",
};

const header: React.CSSProperties = { display: "flex", gap: 6, marginBottom: 8 };
const body: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.25 };
const miniBtn: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  borderRadius: 6,
  padding: "4px 7px",
  fontSize: 11,
  cursor: "pointer",
};
