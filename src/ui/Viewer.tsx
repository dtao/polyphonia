import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { Scene } from "../scene/Scene";
import { useStore } from "../store";
import { fetchPublishedComposition, isSharingConfigured } from "../cloud";
import { artistPath } from "./galleryStyles";

type Status = "loading" | "ready" | "notfound" | "error";

// Read-only viewer for a shared composition (/c/:id). Reuses the engine and
// explore controls; no editing, and nothing is persisted to the local library.
export function Viewer() {
  const { id } = useParams();
  const comp = useStore((s) => s.composition);
  const entered = useStore((s) => s.entered);
  const engine = useStore((s) => s.engine);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    // Reset any prior in-tab session and mark this as a read-only view.
    useStore.getState().engine?.dispose();
    useStore.setState({ engine: null, entered: false, selectedId: null, mode: "explore", viewer: true });

    if (!isSharingConfigured) {
      setStatus("error");
      return;
    }
    fetchPublishedComposition(id!)
      .then((c) => {
        if (cancelled) return;
        if (!c) return setStatus("notfound");
        useStore.setState({ composition: c });
        setStatus("ready");
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      useStore.getState().engine?.dispose();
      useStore.setState({ engine: null, entered: false, viewer: false });
    };
  }, [id]);

  function enter() {
    if (useStore.getState().engine) return;
    useStore.getState().setEntered(true);
    useStore.getState().startAudio();
  }

  return (
    <>
      <Canvas
        camera={{ position: [0, 1.7, 0], fov: 70, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Scene />
      </Canvas>

      {status === "ready" && !entered && (
        <div style={overlay}>
          <h1 style={{ fontSize: 36, margin: 0, letterSpacing: 1 }}>{comp.title}</h1>
          <Link to={artistPath(comp.artist)} style={artistLink}>
            {comp.artist}
          </Link>
          <button id="enter-btn" style={button} onClick={enter}>
            ▶ Enter
          </button>
          <p style={{ opacity: 0.45, fontSize: 13 }}>WASD to move · mouse to look · Esc to release cursor</p>
        </div>
      )}

      {status === "ready" && entered && engine && (
        <div style={hud}>
          <strong>{comp.title}</strong> —{" "}
          <Link to={artistPath(comp.artist)} style={hudArtistLink}>
            {comp.artist}
          </Link>{" "}
          · shared
          <Link style={makeLink} to="/">
            Make your own ↗
          </Link>
        </div>
      )}

      {status === "loading" && (
        <div style={overlay}>
          <p style={{ opacity: 0.7 }}>Loading…</p>
        </div>
      )}
      {(status === "notfound" || status === "error") && (
        <div style={overlay}>
          <h2 style={{ margin: 0 }}>{status === "notfound" ? "Composition not found" : "Couldn't load this composition"}</h2>
          <Link style={{ ...makeLink, marginLeft: 0 }} to="/">
            Go to Polyphonia
          </Link>
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
  gap: 14,
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

const makeLink: React.CSSProperties = {
  marginLeft: 10,
  color: "rgba(150,180,255,0.95)",
  pointerEvents: "auto",
};

const artistLink: React.CSSProperties = {
  color: "rgba(190,205,255,0.95)",
  margin: 0,
  textDecoration: "none",
};

const hudArtistLink: React.CSSProperties = {
  color: "rgba(190,205,255,0.95)",
  pointerEvents: "auto",
};
