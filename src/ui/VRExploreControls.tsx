import { useEffect, useState } from "react";
import {
  VR_EXPLORE_START_EVENT,
  VR_EXPLORE_STATUS_EVENT,
  VRExploreStatus,
  idleVRExploreStatus,
  vrExploreSupported,
} from "../vrExplore";

// Does this device offer immersive VR (Vision Pro Safari, Quest browser, a
// desktop with a headset)? Resolves once on mount.
export function useVRExploreSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let cancelled = false;
    vrExploreSupported().then((s) => {
      if (!cancelled && s) setSupported(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return supported;
}

export function useVRExploreStatus(): VRExploreStatus {
  const [status, setStatus] = useState<VRExploreStatus>(idleVRExploreStatus);
  useEffect(() => {
    const onStatus = (event: Event) => setStatus((event as CustomEvent<VRExploreStatus>).detail);
    window.addEventListener(VR_EXPLORE_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(VR_EXPLORE_STATUS_EVENT, onStatus);
  }, []);
  return status;
}

export function startVRExplore(): void {
  window.dispatchEvent(new Event(VR_EXPLORE_START_EVENT));
}

// Post-enter re-entry button for the viewer: after leaving an immersive
// session (Digital Crown / system gesture) the flat view continues in place,
// and this button goes back in. Renders nothing on devices without VR.
// (While a session presents, the DOM isn't visible, so no exit button here —
// the headset's system gesture is the exit.)
export function VRExploreControls() {
  const supported = useVRExploreSupported();
  const status = useVRExploreStatus();
  if (!supported || status.state === "active") return null;

  const label = status.state === "starting" ? "Starting…" : status.state === "error" ? "Immersive (retry)" : "Immersive";
  return (
    <div style={panel}>
      <button
        style={button}
        onClick={startVRExplore}
        title="Re-enter fully immersive VR (WebXR)"
        disabled={status.state === "starting"}
      >
        ◎ {label}
      </button>
    </div>
  );
}

// Sits above ARWalkControls' slot (right: 14, bottom: 14) so the two never
// overlap when a device offers both.
const panel: React.CSSProperties = {
  position: "absolute",
  right: 14,
  bottom: 62,
  zIndex: 12,
  pointerEvents: "auto",
};

const button: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "system-ui, sans-serif",
};
