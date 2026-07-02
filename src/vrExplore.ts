export const VR_EXPLORE_START_EVENT = "polyphonia:vr-explore-start";
export const VR_EXPLORE_STOP_EVENT = "polyphonia:vr-explore-stop";
export const VR_EXPLORE_STATUS_EVENT = "polyphonia:vr-explore-status";

export type VRExploreStatus = {
  state: "idle" | "starting" | "active" | "unsupported" | "error";
};

export const idleVRExploreStatus: VRExploreStatus = { state: "idle" };

// Is a fully-immersive VR session available (Vision Pro Safari, Quest browser,
// desktop with a headset)? Resolves false anywhere WebXR or immersive-vr is
// missing rather than rejecting.
export function vrExploreSupported(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }).xr;
  if (!xr?.isSessionSupported) return Promise.resolve(false);
  return xr.isSessionSupported("immersive-vr").catch(() => false);
}

// Diagnostic for visionOS window-anchored audio: Safari spatializes a tab's
// audio output as a source at the window's position in the room, which in an
// immersive session leaves the whole mix sounding pinned where the window was.
// WebKit's AudioSession API can switch the output route/category, which may
// bypass that spatialization. Opt in from the URL on-device, e.g.
// ?vrAudioSession=play-and-record (also try "playback" / "ambient").
// Deliberately readable in production builds — this is tested on a headset
// against deployed builds, where dev-only flags are unreachable.
export function applyVRAudioSessionOverride(): void {
  if (typeof window === "undefined") return;
  const type = new URLSearchParams(window.location.search).get("vrAudioSession");
  if (!type) return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) {
    console.warn("vrAudioSession: navigator.audioSession unavailable");
    return;
  }
  try {
    session.type = type;
    console.log(`vrAudioSession: set audio session type to "${type}"`);
  } catch (err) {
    console.warn(`vrAudioSession: failed to set type "${type}"`, err);
  }
}

// --- Heading math shared by <VRExploreSession> ---------------------------------
//
// Conventions (locked down by vrExplore.test.ts):
// - A "heading" is atan2(z, x) of a flat XZ direction vector.
// - `rotateFlat(v, a)` ADDS `a` to a vector's heading.
// - A three.js group with rotation.y = yaw renders a child vector with its
//   heading REDUCED by yaw. So with worldYaw = virtualHeading - physicalHeading:
//   physical directions map to virtual ones via rotateFlat(+worldYaw), and the
//   world group rotated by renderYaw = worldYaw shows virtual directions along
//   the matching physical ones.

export function flatHeading(x: number, z: number): number {
  return Math.atan2(z, x);
}

// The world-group yaw that makes the virtual facing direction appear along the
// user's physical facing direction.
export function worldYawFor(virtualHeading: number, physicalHeading: number): number {
  return virtualHeading - physicalHeading;
}

// Rotate a flat XZ vector's heading by +angle (length preserved).
export function rotateFlat(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - z * s, x * s + z * c];
}

// Translation for the world group (position, with rotation.y = yaw) such that
// the virtual eye point renders exactly at the physical anchor point:
// anchor = R_y(yaw) * eye + translation.
export function renderTranslationFor(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  anchorX: number,
  anchorY: number,
  anchorZ: number,
  yaw: number,
): [number, number, number] {
  // R_y(yaw) reduces headings by yaw, i.e. rotateFlat by -yaw.
  const [rx, rz] = rotateFlat(eyeX, eyeZ, -yaw);
  return [anchorX - rx, anchorY - eyeY, anchorZ - rz];
}
