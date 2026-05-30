import { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Scene } from "./scene/Scene";
import { AudioEngine } from "./audio/AudioEngine";
import { defaultComposition } from "./composition";

export default function App() {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [entering, setEntering] = useState(false);
  const engineRef = useRef<AudioEngine | null>(null);
  const comp = defaultComposition;

  // Browsers block audio until a user gesture — so we boot the engine on click.
  async function enter() {
    if (engineRef.current) return;
    setEntering(true);
    const e = new AudioEngine();
    await e.ctx.resume();
    await e.load(comp);
    e.start();
    engineRef.current = e;
    setEngine(e);
    setEntering(false);
  }

  return (
    <>
      <Canvas camera={{ position: [0, 1.7, 0], fov: 70, near: 0.1, far: 200 }}>
        <Scene comp={comp} engine={engine} />
      </Canvas>

      {!engine && (
        <div style={overlay}>
          <h1 style={{ fontSize: 44, margin: 0, letterSpacing: 2 }}>POLYPHONIA</h1>
          <p style={{ opacity: 0.7, maxWidth: 440, textAlign: "center", lineHeight: 1.5 }}>
            {comp.title} — walk between the four instruments and hear the mix shift around you.
          </p>
          <button style={button} onClick={enter} disabled={entering}>
            {entering ? "Loading…" : "Click to enter"}
          </button>
          <p style={{ opacity: 0.45, fontSize: 13, marginTop: 24 }}>
            WASD to move · mouse to look · Esc to release cursor
          </p>
        </div>
      )}

      {engine && (
        <div style={hud}>
          <strong>{comp.title}</strong> — {comp.artist} · WASD + mouse
        </div>
      )}
    </>
  );
}

const overlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  color: "white",
  fontFamily: "system-ui, sans-serif",
  background: "radial-gradient(circle at center, rgba(20,24,48,0.85), rgba(5,6,10,0.97))",
};

const button: React.CSSProperties = {
  padding: "14px 36px",
  fontSize: 17,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(91,140,255,0.18)",
  color: "white",
  cursor: "pointer",
};

const hud: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  color: "rgba(255,255,255,0.8)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  pointerEvents: "none",
};
