import { useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Scene } from "./scene/Scene";
import { PropertiesPanel } from "./ui/PropertiesPanel";
import { AddStem } from "./ui/AddStem";
import { EntryScreen } from "./ui/EntryScreen";
import { PublishControl } from "./ui/PublishControl";
import { LoopPanel } from "./ui/LoopPanel";
import { EnvironmentPanel } from "./ui/EnvironmentPanel";
import { MapPanel } from "./ui/MapPanel";
import { useStore } from "./store";
import { exportComposition } from "./persistence";

type EditPanel = "environment" | "map" | "loop" | null;

export default function App() {
  const engine = useStore((s) => s.engine);
  const setEngine = useStore((s) => s.setEngine);
  const entered = useStore((s) => s.entered);
  const comp = useStore((s) => s.composition);
  const mode = useStore((s) => s.mode);
  const select = useStore((s) => s.select);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const [openEditPanel, setOpenEditPanel] = useState<EditPanel>(null);

  // Load the saved composition library + auth session on launch.
  useEffect(() => {
    useStore.getState().initLibrary();
    useStore.getState().initAuth();
  }, []);

  // Track pointer-lock so we can hide the UI chrome during camera control and
  // reveal it again when the cursor is free (after Esc, or in edit mode).
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  // Toggle mode, releasing the pointer lock synchronously when entering edit
  // (drei's PointerLockControls doesn't reliably exit the lock on unmount).
  const handleToggleMode = useCallback(() => {
    if (useStore.getState().mode === "explore") document.exitPointerLock?.();
    useStore.getState().toggleMode();
  }, []);

  // The entry click does two gesture-gated things at once: drei's
  // PointerLockControls (armed on this button) locks the pointer, and here we
  // boot the audio engine. We leave the entry screen immediately and load audio
  // in the background so mouse-look is live right away.
  function enter() {
    if (useStore.getState().engine || useStore.getState().entered) return;
    useStore.getState().resetViewToMapStart();
    useStore.getState().setEntered(true);
    useStore.getState().startAudio();
  }

  // Create a fresh empty composition and drop straight into edit mode so the
  // user can start adding stems (no pointer lock needed — edit keeps the cursor).
  function createAndEnter(meta: { title: string; artist?: string; bpm: number }) {
    useStore.getState().newComposition(meta);
    useStore.getState().resetViewToMapStart();
    useStore.getState().setMode("edit");
    useStore.getState().setEntered(true);
    useStore.getState().startAudio();
  }

  // Stop the experience and return to the entry screen. Edits to the
  // composition are kept in the store, so re-entering resumes where you left off.
  function exit() {
    useStore.getState().engine?.dispose();
    document.exitPointerLock?.();
    document.body.style.cursor = "auto";
    useStore.getState().setMode("explore");
    useStore.getState().select(null);
    useStore.getState().setEntered(false);
    setEngine(null);
  }

  // Tab toggles Explore/Edit. Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z handle edit
  // history when focus is not inside a native text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useStore.getState().mode === "edit") {
        if (openEditPanel) {
          e.preventDefault();
          setOpenEditPanel(null);
          return;
        }
        if (useStore.getState().selectedId) {
          e.preventDefault();
          useStore.getState().select(null);
          return;
        }
      }
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && e.key.toLowerCase() === "z" && useStore.getState().entered) {
        e.preventDefault();
        if (e.shiftKey) void useStore.getState().redo();
        else void useStore.getState().undo();
        return;
      }
      if (modifier && e.key.toLowerCase() === "y" && useStore.getState().entered) {
        e.preventDefault();
        void useStore.getState().redo();
        return;
      }
      if (e.code === "Tab" && useStore.getState().engine) {
        e.preventDefault();
        handleToggleMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleToggleMode, openEditPanel]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (useStore.getState().mode !== "edit") return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      if (openEditPanel && !target.closest("[data-edit-drawer]")) setOpenEditPanel(null);

      // Canvas clicks are handled by R3F: empty space clears via onPointerMissed,
      // while clicking the selected marker keeps the inspector open.
      if (target instanceof HTMLCanvasElement) return;
      if (!target.closest("[data-stem-panel]")) useStore.getState().select(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [openEditPanel]);

  // Release the pointer lock when entering edit mode; reset cursor.
  useEffect(() => {
    if (mode === "edit") {
      document.exitPointerLock?.();
    } else {
      document.body.style.cursor = "auto";
      setOpenEditPanel(null);
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

      {!entered && (
        <EntryScreen
          onEnter={enter}
          onCreate={createAndEnter}
          onExport={() => exportComposition(useStore.getState().composition)}
          onImport={(file) => useStore.getState().importComposition(file)}
        />
      )}

      {entered && (
        <>
          <div style={hud}>
            <strong>{comp.title}</strong> — {comp.artist}
            <span style={{ opacity: 0.6 }}>
              {" "}
              · {mode === "explore" ? "WASD + mouse to move · click to look · Esc for cursor" : "WASD to move · drag to orbit · click a track"}
            </span>
          </div>

          {/* UI chrome only when the cursor is free (Esc'd out, or in edit mode). */}
          {!locked && (
            <>
              <div style={toolbar}>
                <button style={exitBtn} onClick={exit} title="Stop and return to the start screen">
                  ⏏ Exit
                </button>
                {mode === "edit" && (
                  <div style={historyGroup}>
                    <button
                      style={{ ...historyBtn, ...(canUndo ? null : disabledBtn) }}
                      onClick={() => void useStore.getState().undo()}
                      disabled={!canUndo}
                      title="Undo"
                    >
                      ↶
                    </button>
                    <button
                      style={{ ...historyBtn, ...(canRedo ? null : disabledBtn) }}
                      onClick={() => void useStore.getState().redo()}
                      disabled={!canRedo}
                      title="Redo"
                    >
                      ↷
                    </button>
                  </div>
                )}
                <button style={modeBtn} onClick={handleToggleMode} title="Toggle with Tab">
                  {mode === "explore" ? "✎ Edit" : "✦ Explore"}
                </button>
              </div>
              {mode === "edit" && <AddStem />}
              {mode === "edit" && (
                <>
                  <EnvironmentPanel
                    open={openEditPanel === "environment"}
                    onOpen={() => setOpenEditPanel("environment")}
                    onClose={() => setOpenEditPanel(null)}
                  />
                  <MapPanel
                    open={openEditPanel === "map"}
                    onOpen={() => setOpenEditPanel("map")}
                    onClose={() => setOpenEditPanel(null)}
                  />
                  <LoopPanel
                    open={openEditPanel === "loop"}
                    onOpen={() => setOpenEditPanel("loop")}
                    onClose={() => setOpenEditPanel(null)}
                  />
                </>
              )}
              <PublishControl />
            </>
          )}

          <PropertiesPanel />

          {/* Empty composition: prompt the user to add their first stem. */}
          {comp.tracks.length === 0 && !locked && (
            <div style={emptyHint}>
              <strong>{comp.title}</strong> is empty.
              <br />
              {mode === "edit"
                ? "Drop audio files anywhere, or click ＋ Add stem to begin."
                : "Switch to Edit to add stems."}
            </div>
          )}
        </>
      )}
    </>
  );
}

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

const historyGroup: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 4,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
};

const historyBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.88)",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
};

const disabledBtn: React.CSSProperties = {
  opacity: 0.35,
  cursor: "default",
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

const emptyHint: React.CSSProperties = {
  position: "absolute",
  top: "42%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  textAlign: "center",
  color: "rgba(255,255,255,0.8)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 16,
  lineHeight: 1.6,
  pointerEvents: "none",
};
