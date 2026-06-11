import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { Scene } from "../scene/Scene";
import { moveViewToMapStart, useStore } from "../store";
import { fetchPublishedComposition, isSharingConfigured } from "../cloud";
import { ArtistAvatar, artistPath } from "./galleryStyles";
import { TouchControls, isTouchDevice } from "./TouchControls";
import { AudioLoadingOverlay } from "./AudioLoadingOverlay";
import { ARWalkControls } from "./ARWalkControls";
import { GeoWalkControls } from "./GeoWalkControls";
import { EnvironmentCredits } from "./EnvironmentCredits";
import { AudioEngine } from "../audio/AudioEngine";

type Status = "loading" | "ready" | "notfound" | "error";

// Read-only viewer for a shared composition (/c/:id). Reuses the engine and
// explore controls; no editing, and nothing is persisted to the local library.
export function Viewer() {
  const { id } = useParams();
  const comp = useStore((s) => s.composition);
  const entered = useStore((s) => s.entered);
  const engine = useStore((s) => s.engine);
  const audioLoading = useStore((s) => s.audioLoading);
  const user = useStore((s) => s.user);
  const [status, setStatus] = useState<Status>("loading");
  const [audioReady, setAudioReady] = useState(false);
  const preloadedEngineRef = useRef<AudioEngine | null>(null);
  const touch = isTouchDevice();

  useEffect(() => {
    let cancelled = false;
    let loadingEngine: AudioEngine | null = null;

    // Reset any prior in-tab session and mark this as a read-only view.
    useStore.getState().engine?.dispose();
    useStore.setState({ engine: null, audioLoading: { status: "idle" }, entered: false, selectedId: null, mode: "explore", viewer: true });
    setAudioReady(false);
    preloadedEngineRef.current = null;

    if (!isSharingConfigured) {
      setStatus("error");
      return;
    }
    fetchPublishedComposition(id!)
      .then(async (c) => {
        if (cancelled) return;
        if (!c) return setStatus("notfound");
        moveViewToMapStart(c.map);
        useStore.setState({ composition: c });
        setStatus("ready");

        // Begin preloading audio immediately — fetch + decode work without a
        // user gesture; only resume() + start() need one (deferred to enter()).
        const e = new AudioEngine();
        loadingEngine = e;
        const total = c.tracks.length;
        useStore.setState({ audioLoading: { status: "loading", loaded: 0, total, phase: "preparing" } });
        try {
          await e.load(c, (progress) => {
            if (!cancelled) useStore.setState({ audioLoading: { status: "loading", ...progress } });
          });
          if (cancelled) {
            e.dispose();
            return;
          }
          preloadedEngineRef.current = e;
          loadingEngine = null;
          useStore.setState({ audioLoading: { status: "idle" } });
          setAudioReady(true);
        } catch (err) {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : "Audio couldn't be loaded.";
            useStore.setState({ audioLoading: { status: "error", message } });
          } else {
            e.dispose();
          }
        }
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      loadingEngine?.dispose();
      preloadedEngineRef.current?.dispose();
      preloadedEngineRef.current = null;
      useStore.getState().engine?.dispose();
      useStore.setState({ engine: null, audioLoading: { status: "idle" }, entered: false, viewer: false });
    };
  }, [id]);

  function enter() {
    const preloaded = preloadedEngineRef.current;
    if (!preloaded || useStore.getState().engine) return;
    preloadedEngineRef.current = null;
    useStore.getState().resetViewToMapStart();
    preloaded.ctx.resume()
      .then(() => {
        preloaded.start();
        useStore.setState({ engine: preloaded });
        useStore.getState().setEntered(true);
      })
      .catch((e) => console.error("Failed to start audio", e));
  }

  const loadingPercent =
    audioLoading.status === "loading" && audioLoading.total > 0
      ? Math.min(100, Math.max(6, (audioLoading.loaded / audioLoading.total) * 100))
      : audioLoading.status === "loading"
      ? 6
      : 0;

  return (
    <>
      <Canvas
        shadows
        camera={{ position: [0, 1.7, 0], fov: 70, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <Scene />
      </Canvas>

      {status === "ready" && entered && touch && <TouchControls />}
      {status === "ready" && entered && <EnvironmentCredits />}
      {status === "ready" && entered && <ARWalkControls map={comp.map} />}
      {status === "ready" && entered && <GeoWalkControls map={comp.map} />}

      {status === "ready" && !entered && (
        <div style={overlay}>
          <h1 style={{ fontSize: 36, margin: 0, letterSpacing: 1 }}>{comp.title}</h1>
          {user ? (
            <Link to={artistPath(comp.artist, comp.artistSlug)} style={artistLink}>
              <ArtistAvatar artist={comp} size={24} />
              {comp.artist}
            </Link>
          ) : (
            <div style={artistLink}>
              <ArtistAvatar artist={comp} size={24} />
              {comp.artist}
            </div>
          )}
          {audioLoading.status === "loading" && (
            <div style={loadingBlock}>
              <div style={loadingLabel}>
                Loading music… {Math.round(loadingPercent)}%
              </div>
              <div style={meter}>
                <div style={{ ...meterFill, width: `${loadingPercent}%` }} />
              </div>
            </div>
          )}
          {audioLoading.status === "error" && (
            <div style={{ color: "#ff9b8f", fontSize: 13 }}>{audioLoading.message ?? "Audio couldn't be loaded."}</div>
          )}
          <button
            id="enter-btn"
            style={{ ...button, ...(audioReady ? null : buttonDisabled) }}
            onClick={enter}
            disabled={!audioReady}
          >
            ▶ Enter
          </button>
          <p style={{ opacity: 0.45, fontSize: 13 }}>
            {touch ? "Joystick to move · drag to look around" : "WASD to move · mouse to look · Esc to release cursor"}
          </p>
        </div>
      )}

      {/* Home link in the corner — pre-enter it floats above the overlay; post-enter
          it sits above the HUD text since the HUD is pointer-events:none */}
      {(status === "ready" || status === "loading") && (
        <Link to="/" style={entered ? homeLinkEntered : homeLink}>
          ← Polyphonia
        </Link>
      )}

      {status === "ready" && entered && engine && (
        <div style={hud}>
          <strong>{comp.title}</strong> —{" "}
          {user ? (
            <Link to={artistPath(comp.artist, comp.artistSlug)} style={hudArtistLink}>
              {comp.artist}
            </Link>
          ) : (
            comp.artist
          )}{" "}
          · shared
          {user && (
            <Link style={makeLink} to="/">
              Open editor
            </Link>
          )}
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
      {/* Only show the full-screen audio overlay post-enter (pre-enter progress is inline) */}
      {entered && <AudioLoadingOverlay loading={audioLoading} />}
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

const buttonDisabled: React.CSSProperties = {
  opacity: 0.4,
  cursor: "default",
};

const loadingBlock: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: 220,
};

const loadingLabel: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.58)",
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const meter: React.CSSProperties = {
  height: 6,
  overflow: "hidden",
  borderRadius: 999,
  background: "rgba(255,255,255,0.16)",
};

const meterFill: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #56e0c0, #ffd166, #5b8cff)",
  transition: "width 180ms ease",
};

const homeLink: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  color: "rgba(255,255,255,0.55)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  textDecoration: "none",
  zIndex: 10,
  pointerEvents: "auto",
};

// Same position when entered — sits just above the HUD (which is offset below it).
const homeLinkEntered: React.CSSProperties = {
  ...homeLink,
};

const hud: React.CSSProperties = {
  position: "absolute",
  top: 36,
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
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "rgba(190,205,255,0.95)",
  margin: 0,
  textDecoration: "none",
};

const hudArtistLink: React.CSSProperties = {
  color: "rgba(190,205,255,0.95)",
  pointerEvents: "auto",
};
