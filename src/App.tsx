import { useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Scene } from "./scene/Scene";
import { AudioEngine } from "./audio/AudioEngine";
import { PropertiesPanel } from "./ui/PropertiesPanel";
import { AddStem } from "./ui/AddStem";
import { useStore } from "./store";

export default function App() {
  const [entering, setEntering] = useState(false);
  const engine = useStore((s) => s.engine);
  const setEngine = useStore((s) => s.setEngine);
  const comp = useStore((s) => s.composition);
  const mode = useStore((s) => s.mode);
  const select = useStore((s) => s.select);

  // Toggle mode, releasing the pointer lock synchronously when entering edit
  // (drei's PointerLockControls doesn't reliably exit the lock on unmount).
  const handleToggleMode = useCallback(() => {
    if (useStore.getState().mode === "explore") document.exitPointerLock?.();
    useStore.getState().toggleMode();
  }, []);

  // Browsers block audio until a user gesture — so we boot the engine on click.
  async function enter() {
    if (useStore.getState().engine) return;
    setEntering(true);
    const e = new AudioEngine();
    await e.ctx.resume();
    await e.load(useStore.getState().composition);
    e.start();
    setEngine(e);
    setEntering(false);
  }

  // Stop the experience and return to the entry screen. Edits to the
  // composition are kept in the store, so re-entering resumes where you left off.
  function exit() {
    useStore.getState().engine?.dispose();
    document.exitPointerLock?.();
    document.body.style.cursor = "auto";
    useStore.getState().setMode("explore");
    useStore.getState().select(null);
    setEngine(null);
  }

  // Tab toggles Explore/Edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.code === "Tab" && useStore.getState().engine) {
        e.preventDefault();
        handleToggleMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleToggleMode]);

  // Release the pointer lock when entering edit mode; reset cursor.
  useEffect(() => {
    if (mode === "edit") {
      document.exitPointerLock?.();
    } else {
      document.body.style.cursor = "auto";
    }
  }, [mode]);

  // Guard against a stray lock in edit mode: the click that switches to edit
  // also makes PointerLockControls request a lock, which engages *after* we've
  // switched (requestPointerLock is async). Catch it the instant it engages and
  // release it, so editing always keeps a visible cursor.
  useEffect(() => {
    const onChange = () => {
      if (document.pointerLockElement && useStore.getState().mode === "edit") {
        document.exitPointerLock();
      }
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  return (
    <>
      <Canvas
        camera={{ position: [0, 1.7, 0], fov: 70, near: 0.1, far: 200 }}
        // Cap pixel ratio: full-window 3D at Retina 2x+ tanks the frame rate
        // and makes mouselook feel choppy. 1.5 is a sweet spot of crisp + fast.
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        // Clicking empty space in edit mode clears the selection.
        onPointerMissed={() => {
          if (useStore.getState().mode === "edit") select(null);
        }}
      >
        <Scene />
      </Canvas>

      {!engine && (
        <div style={overlay}>
          <h1 style={{ fontSize: 44, margin: 0, letterSpacing: 2 }}>POLYPHONIA</h1>
          <p style={{ opacity: 0.7, maxWidth: 440, textAlign: "center", lineHeight: 1.5 }}>
            {comp.title} — move between the instruments and hear the mix shift around you.
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
        <>
          <div style={hud}>
            <strong>{comp.title}</strong> — {comp.artist}
            <span style={{ opacity: 0.6 }}>
              {" "}
              · {mode === "explore" ? "WASD + mouse to move · Esc for cursor" : "WASD to move · drag to orbit · click a track"}
            </span>
          </div>

          <div style={toolbar}>
            <button style={exitBtn} onClick={exit} title="Stop and return to the start screen">
              ⏏ Exit
            </button>
            <button style={modeBtn} onClick={handleToggleMode} title="Toggle with Tab">
              {mode === "explore" ? "✎ Edit" : "✦ Explore"}
            </button>
          </div>

          <PropertiesPanel />
          <AddStem />
        </>
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

const toolbar: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  display: "flex",
  gap: 8,
  fontFamily: "system-ui, sans-serif",
};

const modeBtn: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 14,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(91,140,255,0.22)",
  color: "white",
  cursor: "pointer",
};

const exitBtn: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 14,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.85)",
  cursor: "pointer",
};
