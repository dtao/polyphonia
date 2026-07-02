# visionOS immersive audio anchored to the Safari window

## Symptom

In the viewer's immersive VR mode on Apple Vision Pro, the spatial mix does
not follow head rotation: physically turning around leaves the sound
apparently coming from where the Safari window sat before entering the
session (e.g. a stem visually in front sounds like it is behind).

Reported 2026-07-01 on the published "Polyphonia" composition. Flat-window
playback and immersive visuals/locomotion (gaze-steered glide) behave
correctly.

## Evidence so far

- The engine's listener pipeline is exercised and correct in the session:
  gaze-steered glide uses the same per-frame headset quaternion that feeds
  `engine.updateListener` (via the camera mirror in `VRExploreSession` +
  `ListenerSync`), and locomotion works. If orientation were stale, glide
  direction would be frozen too.
- `AudioEngine.updateListener` change detection covers forward-vector changes
  and has a modern-AudioParam path plus a `setOrientation` fallback; the same
  code localizes correctly on desktop.
- visionOS is known to spatialize an app/tab's audio output as a positioned
  source at its window (see moonlight-ios issue #659 for the native
  equivalent). If Safari keeps that anchor during an immersive-vr session,
  the entire Web Audio output — with our HRTF cues baked into the stereo
  stream — is re-localized to the hidden window's room position, which
  matches the symptom exactly.

## Current hypotheses

1. **(Likely) Platform behavior:** visionOS Safari keeps the tab's audio
   spatialized at the window anchor during immersive WebXR sessions rather
   than switching to head-locked output. Not controllable via WebXR; would
   need an Apple fix (Feedback Assistant / bugs.webkit.org) or an
   AudioSession-level escape hatch.
2. **(Unlikely, not yet excluded) Engine orientation stalls on visionOS
   only** — e.g. WebKit ignoring `AudioListener` forward AudioParams in
   immersive sessions. Discriminated by the flat-window test below.

## Debug option

`?vrAudioSession=<type>` (production-readable) sets WebKit's
`navigator.audioSession.type` right before the immersive session is
requested (`applyVRAudioSessionOverride` in `src/vrExplore.ts`). WebRTC apps
use the `play-and-record` route on iOS to escape system audio processing;
worth trying `play-and-record`, `playback`, and `ambient` on-device.

## Next discriminating checks (on Vision Pro)

1. **Flat-window control:** in the shared space (not immersive), drag-look a
   full turn next to a stem. If left/right panning tracks the virtual turn,
   the engine localizes correctly on visionOS → points to hypothesis 1.
2. **AirPods spatialization toggle:** with AirPods, set Control Center →
   Spatialize Audio to **Off**, re-enter immersive. If directions become
   correct (follow the head), the system spatialization layer is confirmed
   as the culprit.
3. **AudioSession override:** open the share URL with
   `?vrAudioSession=play-and-record` (then `playback`, `ambient`), re-enter
   immersive, and check whether the window anchor disappears.
4. Note the visionOS version; retest after OS updates (visionOS 27 was
   announced at WWDC 2026 with substantial spatial-web changes).

## Status

Open — awaiting on-device results for the checks above.
