# Tiled Orb Pop-In Investigation

Date: 2026-06-03 (updated 2026-06-04)

## Status (2026-06-04)

- **Tiled (square/hex) maps: FIXED** and committed in `3633f30 Fix horizon
  orb pop-in on tiled and looped maps`.
- **Path-loop maps: STILL BROKEN.** Multiple targeted attempts (see
  "Update 2026-06-04" at the end) did not resolve it. Each attempt was based
  on a hypothesis that appears *correct* but turned out to be *insufficient* —
  fixing it exposed or preserved a different facet of the same pop. The
  remaining path-loop work is left as uncommitted changes in the working tree
  (see that section) pending a different approach.

The full chronological investigation follows; jump to the end for the latest.

## Summary

When exploring compositions that use tiled/looped map modes, some distant stem
orbs visibly pop into existence instead of fading in smoothly. This is most
noticeable on `map.tiling.type === "path-loop"` when the player crosses the loop
boundary, but it is not unique to path-loop maps. The user also sees the issue
on square/hex tiled maps, just less prominently.

The intended behavior is that loop-preview stems should fade smoothly from
invisible to visible, so the player never sees a new orb, halo, glare, or ray
effect appear abruptly on the horizon.

This document records the investigation so far: what changed, what the debug
data shows, what hypotheses were tested, and what remains unexplained.

## User-Visible Reproduction

1. Open a composition with a tiled or path-loop map.
2. Use a composition with many stems; the reported path-loop case has 23 tracks.
3. For path-loop maps, walk across the path-loop boundary.
4. For square/hex tiled maps, move through the tile field and watch the horizon.

Expected: distant repeated stems are already present at very low opacity and
fade in smoothly.

Actual: some distant orbs/glare appear suddenly near the horizon. On path-loop
maps, this is especially visible right as the loop boundary is crossed.

## Relevant Files

- `src/scene/Scene.tsx`
  - Builds base track markers.
  - Builds tiled/path-loop preview map copies.
  - Computes distance fades for preview markers.
- `src/scene/TrackMarker.tsx`
  - Renders the orb, halo, glare plane, star rays, footprint ring, and point
    light for a stem.
  - Smooths visual fade for preview markers.
- `src/map.ts`
  - Provides `tiledMapTransforms`, `transformLoopPoint`, and
    `wrapLoopPosition`.
- `src/scene/Player.tsx`
  - Moves the player and calls `wrapLoopPosition`.
- `src/audio/AudioEngine.ts`
  - Builds audible base and virtual instances.
- `src/debug.ts`, `src/scene/DebugSampler.tsx`, `src/ui/DebugPanel.tsx`
  - Debug export and debug overlay.

## Committed Background

Recent commits introduced fog/preview fading for tiled and looped maps:

- `add97d1 Constrain tiled preview fading`
- `476d00f Smooth preview stem fade-ins`

Those changes made preview stems fade based on the transformed world-space
position of each virtual marker rather than only on the preview map tile
anchor. They also added temporal fade-in inside `TrackMarker`, so newly mounted
preview markers begin at opacity 0 and damp toward their target fade.

This improved the problem, especially for square/hex tiled maps, but did not
fully eliminate popping. Path-loop maps still provide the most obvious
reproduction because the boundary wrap can make the visual instance set change
abruptly.

## Important Update

The issue is not unique to path-loop maps. The user also sees orbs pop into
existence on tiled maps. This means the path-loop boundary is likely an
amplifier rather than the root cause.

That broadens the likely root cause from "the path-loop wrap is broken" to
"visual instances can mount or become perceptible before they have had a truly
invisible fade-in period." Path-loop maps may still add extra discontinuity
because the camera position jumps and preview ids can change at the boundary.

## Strong New Theory: Shared Track Level May Over-Brighten Far Copies

The user suggested that the far-away orb may be a copy of a much closer orb,
and that the far copy's appearance may be based on distance to the closer
original rather than distance to the far-away copy.

This is plausible and fits the code:

- `TrackMarker` calls `engine.level(track.id)`.
- `AudioEngine.level(id)` reads from the track's shared analyser.
- That analyser is upstream of per-instance distance/occlusion/panner nodes.
- Therefore `engine.level(track.id)` is a per-track source amplitude, not a
  per-visual-instance or per-audible-instance level.
- Every visual copy of the same stem shares that same pulse value.

The copy-specific distance fade is still passed into `TrackMarker` as `fade`,
but pulse brightness and size are driven by the shared level:

- core scale: `breath + pulse * 0.85`
- aura scale/opacity: `pulse`
- outer aura scale/opacity: `pulse`
- flare opacity/radius: `pulse`
- star-ray opacity/radius: `pulse`
- point light intensity/distance for base markers: `pulse`

This means a distant copy can be at low fade while still receiving the strong
audio pulse of the nearby/original stem. Because the marker uses additive
blending and `Math.sqrt(renderedFade)` for `opticalFade`, a numerically low
fade can still be visually bright when the shared pulse is high.

The same pattern exists in `MapScene` lighting materials:

- `PathMaterial` uses `engine.level(track.id)` for each light track.
- `ReflectiveUnderfloorMaterial` also uses `engine.level(track.id)`.

Those shaders receive transformed/copied track positions, but their pulsing
intensity is still keyed to the shared track id rather than the listener's
distance to that specific visual copy.

Attempted fix:

- `TrackMarker` still reads the shared track level, but now attenuates the
  visual pulse by that marker's rendered fade before applying it to orb scale,
  aura, flare, rays, and point light.
- `Scene.tsx` tags temporary tiled light-track copies with `visualFade`.
- `MapScene` multiplies path/underfloor light levels by `track.visualFade`, so
  copied floor glow no longer receives the full pulse of a nearby/original stem.
- `visualFade` is scene-local and is not added to the persisted composition
  model.

Result:

- `npm run build` passes.
- Manual runtime verification failed: the user still sees orbs popping into
  existence after this change.

Conclusion:

- Shared per-track pulse over-brightening may still be a contributing factor,
  but it is not sufficient to explain or fix the pop-in.
- The next investigation should prioritize exact mount/unmount diagnostics and
  visual instance identity, especially whether a marker is first mounted while
  already within a perceptible visibility range.

## Debug Data Provided

The user exported:

`/Users/dtao/Downloads/polyphonia-debug-2026-06-03T20-06-56-945Z.json`

The export contains 23 samples. The key transition occurs around 3009 ms into
the captured window:

- Before wrap:
  - position: approximately `[67.6, 1.7, -71.0]`
  - visual markers mounted: `50`
  - visual markers visible: `49`
  - base visible: `23`
  - preview visible: `26`
  - audio instances: `37` total, `16` base, `21` virtual
- Immediately after wrap:
  - position jumps to approximately `[-18.9, 1.7, 30.3]`
  - visual markers mounted: `58`
  - visual markers visible: `38`
  - base visible: `3`
  - preview visible: `35`
  - loop handoff active: `true`
  - handoff fade: approximately `0.02`
- A few frames later:
  - visual markers mounted: `58`
  - visual markers visible: `58`
  - base visible: `23`
  - preview visible: `35`
  - loop handoff still active

The farthest visible markers in the debug sample are previews at low opacity,
around 0.02-0.13 fade and 150-170 units away. Before some later fixes, the
debug export also showed base markers around 150 units away at fade 1.0.

## Hypotheses Tested

### 1. Preview markers mount abruptly at full opacity

Hypothesis: When `tiledMapTransforms` adds a new preview copy, the corresponding
`TrackMarker` mounts already visible.

Attempted fix:

- In `TrackMarker`, preview markers initialize `visibleFade` to 0.
- Each frame damps `visibleFade` toward the target `fade`.
- If the target fade decreases, the visible fade snaps down immediately.

Result:

- Improved the behavior but did not eliminate popping.
- Debug shows preview markers often have low fade values at horizon distances,
  which suggests many preview markers are fading correctly.

Remaining concern:

- A marker can still appear perceptually abrupt even with a low numerical fade
  because the orb uses additive blending, a bright white core, glare planes, and
  star rays. A fade of `0.03` can still read as visible on a black background,
  especially when the white core or flare is involved.

### 2. Preview fade was based on tile anchor instead of stem position

Hypothesis: A preview map copy can be far away by anchor, but an individual stem
within that copy can be much closer or farther. If the whole copy uses one fade,
some stems can appear suddenly.

Attempted fix:

- In `Scene.tsx`, compute each preview marker's transformed world-space
  position with `transformLoopPoint`.
- Compute `previewTrackVisibility` per marker based on distance from the
  viewer to that transformed position.
- Filter out preview markers below `PREVIEW_FADE_EPSILON`.
- Pass the transformed debug position into marker debug instrumentation.

Result:

- Helped, especially on tiled maps.
- Did not eliminate the path-loop boundary pop.

### 3. Base markers are privileged and stay fully visible

Hypothesis: On tiled and path-loop maps, the original/base markers are just one
copy of the repeated space, but the render path treats them specially. They were
always rendered at full opacity, even when far away. As the player moves through
repeated space, some base markers can suddenly become part of the visible
horizon set.

Evidence:

- Debug export showed fully visible base markers at about 150 units away:
  - `base:c8f094ef-...`, fade `1`, distance `152.4`
  - `base:61e46a35-...`, fade `1`, distance `150.4`

Attempted fix:

- Added `baseTrackVisibility` in `Scene.tsx`.
- In Explore mode, base markers now use the same distance fade as preview
  markers when map tiling is not `none`, including square/hex tiled maps.
- Base markers below `PREVIEW_FADE_EPSILON` are not mounted in Explore mode.
- Edit mode still renders canonical base stems normally.

Result:

- Build passes.
- User reports the visible pop is still present.

Remaining concern:

- This may have addressed one real issue but not the only issue.
- It also may not address markers that become visible because their transformed
  preview identity changes, even if both old and new instances are individually
  distance faded.

### 4. A wrap handoff fade can hide horizon markers during coordinate reset

Hypothesis: At the exact frame of `wrapLoopPosition`, the camera position jumps
from one end of the path to the other. Visual instances may recalculate around
the new position before the old horizon has faded out. A short global handoff
fade for path-loop base markers might hide this discontinuity.

Attempted fix:

- Added `src/scene/loopHandoff.ts`.
- `Player` calls `markLoopWrapHandoff()` when `wrapLoopPosition` returns a
  wrapped position.
- `TrackMarker` reads `loopWrapHandoffFade()`.
- During a handoff, non-preview path-loop markers farther from the camera are
  faded down and then ramped back up over 1.8 seconds.

Result:

- Did not eliminate the user-visible pop.
- Debug shows the handoff is active after the wrap and that many markers are
  fading, but the artifact is still visible.

Remaining concern:

- The pop may be happening on preview markers, not base markers.
- The pop may happen during the same render frame as the wrap before handoff
  state is applied.
- React Three Fiber `useFrame` priority ordering needs careful confirmation.
  The experiment changed `Player` to priority `-100` and `TrackMarker` to
  `-200`, intending player wrapping to run before marker fade updates. If the
  actual ordering assumption is wrong, a stale-camera frame could remain.

### 5. Audio and visual instance counts may diverge

Hypothesis: The audio engine and scene may use different criteria for virtual
instances. A stem may become audible or be included in `lightTracks` before the
corresponding visual marker has a smooth visual history.

Added diagnostics:

- `AudioEngine.debugSnapshot()` now includes:
  - total instance count
  - base instance count
  - virtual instance count
  - tracks with instances
  - tracks with virtual instances
  - max instances per track
- Debug panel shows audible instance counts alongside visual marker counts.

Current evidence:

- In the debug export, audio instances changed from 36/37 before wrap to 37
  after wrap.
- Visual mounted markers jumped from 50 to 58 at the wrap.
- The user now reports a similar, subtler pop on square/hex tiled maps, so the
  issue is not limited to path-loop audio/visual instance churn.

Unanswered:

- It is not yet clear whether the exact popped visual corresponds to an audio
  virtual instance, a visual-only preview marker, a base marker, or a light-only
  track in `MapScene`.

## Things We Cannot Yet Explain

1. The debug export says many horizon preview markers have low fades, but the
   user still sees obvious popping. This may mean low opacity is still too
   visually strong for additive glare/rays, or that the popped object is not
   represented by the marker debug data.
2. The path-loop boundary case is worse than square/hex tiled maps, but not
   unique. The path-loop transform may be replacing a visible set of instances
   with a different set at the wrap, while tiled maps may still mount distant
   instances too close to the perceptual visibility threshold.
3. The pop is reported as the orb/glare itself, not only path/floor lighting.
   That points to `TrackMarker`, but the path lighting uses `lightTracks` and
   may also create a visual cue that makes the orb appear more abrupt.
4. The composition has 23 tracks. More tracks increase the probability that at
   least one instance crosses whatever mount/fade threshold at the boundary.
5. The exact user-observed frame is not matched to a specific marker id. We have
   aggregate debug data but not a per-marker "newly mounted and visible" event
   log.

## Current Experimental / Uncommitted Changes

At the time of this note, the working tree contains uncommitted diagnostics and
attempted fixes in:

- `src/audio/AudioEngine.ts`
- `src/debug.ts`
- `src/scene/DebugSampler.tsx`
- `src/scene/Player.tsx`
- `src/scene/Scene.tsx`
- `src/scene/TrackMarker.tsx`
- `src/ui/DebugPanel.tsx`
- `src/scene/loopHandoff.ts`
- `src/scene/markerDebug.ts`

`npm run build` passes with these changes.

These changes should be treated as investigative, not necessarily final design.

## Remaining Explanations Worth Checking

### A. Add per-marker mount events

Current debug snapshots show marker counts and farthest visible markers, but not
the exact moment a marker is first mounted.

Add an event log for:

- marker id
- track id
- base vs preview
- transformed position
- distance at mount
- initial target fade
- first rendered fade
- whether the marker was above a perceptual threshold

This would answer: "Which exact marker popped?"

### B. Track opacity for each visual layer separately

`TrackMarker` has multiple visible layers:

- white core sphere
- colored aura sphere
- outer aura sphere
- glare plane
- star-ray plane
- footprint ring
- point light

The debug panel currently reports one marker fade. A marker with fade `0.03`
may still have a star ray or white core that reads as a hard pop.

Test by temporarily disabling layers one by one:

- `core`
- `flare`
- `rays`
- `aura`
- `outerAura`
- `pointLight`

If the pop disappears when `flare` or `rays` are disabled, the fade curve should
probably be more aggressive for additive glare than for the orb body.

### C. Use a perceptual fade curve for additive light

Current code often uses `Math.sqrt(renderedFade)` for optical fade. This makes
low fade values brighter, which is good for keeping distant previews visible,
but bad if the goal is to hide mount transitions.

Try separate curves:

- core opacity: `fade`
- aura opacity: `fade * fade`
- glare/rays opacity: `fade * fade` or `smoothstep(fade, 0.15, 1)`
- point light intensity: `fade * fade`

This may make mathematical fade-in match perception better.

### D. Keep preview instances mounted earlier but fully invisible

If an instance first mounts at a distance where target fade is already
perceptible, it can still pop. The render radius and fade end need a buffer:

- mount radius should be greater than fade end
- target fade at mount should be exactly 0 or visually indistinguishable
- no additive layer should render until fade passes a threshold

All tiled map types need enough mount radius beyond the fade end. Path-loop maps
may need an even larger preview radius because the wrap can move the camera a
long distance in one frame.

### E. Unify base and preview visual instance selection

The current scene renders:

1. base markers from `tracks`
2. preview markers from `tiledMapTransforms`

This split may be the root cause. For looped/tiled maps, "base" is not special
from the player's perspective. A more robust approach would build one list of
visual stem instances:

- include base transform and all preview transforms
- transform every stem into world space
- compute distance/fade for every instance
- sort or dedupe by track id and wrapped coordinate
- render all instances through the same code path

This would avoid separate behavior for base markers and previews.

### F. Preserve visual identity across wrap

React keys currently encode preview id and track id. If crossing the boundary
changes preview ids from `start:*` to `end:*`, React unmounts one marker and
mounts another even if visually it represents the same physical repeated stem.

A more robust path-loop renderer may need stable keys based on a continuous
loop coordinate or virtual instance index, not on start/end transform ids that
change across the boundary.

This is a strong candidate because the pop happens specifically at wrap time.

### G. Confirm R3F frame ordering

The attempted handoff assumes `Player` updates camera/wrap before
`TrackMarker` computes fades. Confirm the actual `useFrame` priority ordering
in React Three Fiber:

- Does priority `-100` run before or after default priority `0`?
- Does priority `-200` run before or after `-100`?

If marker updates run before player wrapping, one frame may compute fade from
the pre-wrap camera and then render post-wrap geometry/camera.

### H. Instrument camera wrap as a render event

The debug sampler runs at intervals, not every frame. Add a one-frame debug log
inside the exact wrap frame that records:

- previous camera position
- wrapped camera position
- viewer state used by `Scene`
- number of preview transforms before/after
- markers mounted/unmounted this frame

This would catch a single-frame pop that the interval sampler may miss.

### I. Check `viewer` state lag in `Scene`

`Scene` samples the camera into React state only when the camera moves more than
`VIEWER_SAMPLE_DISTANCE`. It updates via `setViewer` inside `useFrame`.

Potential issue:

- On wrap, the camera jumps immediately.
- `viewer` state may update one React render later.
- Preview transforms and fades may be computed from stale viewer state while
  the camera has already rendered at the wrapped position.

This could cause a one-frame mismatch between camera position and preview
marker selection/fade. Consider storing viewer in a ref, forcing synchronous
update on wrap, or deriving preview transforms from `viewState`/camera without
React state lag.

## Suggested Next Step

The next highest-value diagnostic is to log marker mount events and unmount
events with distance and initial fade, then reproduce the boundary crossing.
That should identify whether the popped object is:

- a newly mounted preview marker,
- a base marker becoming visible,
- a glare/ray layer whose fade curve is too bright,
- a light/path effect rather than the marker mesh, or
- a stale-viewer/render-order mismatch.

If the diagnostic confirms that markers mount at a perceptible fade on any tiled
map, the likely fix is to increase the invisible buffer and make additive glare
layers use a more conservative fade curve. If it confirms that preview ids
change across the path-loop boundary, the likely architectural fix is to replace
the split base/preview rendering with a single unified visual instance list and
stable virtual-instance keys.

---

## Update 2026-06-04

This session landed a real fix for tiled maps and a sequence of path-loop
attempts that all failed. Recording both, because the failures are instructive:
the diagnoses were essentially right and *still* didn't fix path-loop.

### What was committed and works (tiled/square/hex)

Commit `3633f30`. Three changes, all no-ops at full visibility (so untiled
compositions render identically):

1. **Base markers distance-fade in explore mode on tiled/looped maps**
   (`Scene.tsx`). The canonical "base" tile was being rendered at full opacity
   with no distance fade — confirmed by the debug export showing
   `base … fade 1 distance 152.4`. The origin tile is not special on a tiled
   map, so base markers now fade with the same per-stem curve as previews
   (`baseTrackVisibility`) and unmount below `PREVIEW_FADE_EPSILON`. Edit mode
   and untiled maps keep base stems fully visible.
2. **Additive glare uses a steeper fade curve** (`TrackMarker.tsx`). The
   optical fade for the additive aura/flare/ray layers went from
   `Math.sqrt(renderedFade)` (which *brightens* low fades — `0.02 -> 0.14`) to
   `renderedFade * renderedFade` (which darkens them — `0.02 -> 0.0004`). The
   solid white core still fades linearly. This is what made the smooth fade-in
   actually *look* smooth instead of snapping on at ~0.1.
3. **Point-light intensity is attenuated by fade** (`TrackMarker.tsx`), so a
   faded-but-still-mounted orb no longer emits a full-intensity light.

The maintainer confirmed tiled maps look correct after this commit.

### Why the tiled fix is not enough for path-loop

Path-loop is fundamentally different from square/hex in one way: **crossing the
seam teleports the camera a full loop length in a single frame.** Tiled maps
never teleport, so a one-frame staleness in the sampled viewer is invisible. On
path-loop it is a whole loop, which is exactly when fades/positions are most
discontinuous.

A key thing that was *verified*, not just assumed: **the seam is geometrically
seamless.** `wrapLoopPosition` -> `wrapFromEndpoint` (`map.ts`) computes the
wrapped position as `inverseTransformLoopPoint(T, attempted)` where `T` is the
exact same transform used by the "end" loop preview (`loopPreviewTransform`,
same anchor/source/rotation). Because `T` is a rigid motion, distances are
preserved across the wrap: an orb you are walking toward (rendered as a preview
copy beyond END) and its base copy near START sit at the *same apparent screen
position and the same distance* on either side of the seam, with the yaw delta
compensating heading. So the correct behavior is a pure identity swap (preview
copy hands off to base copy at the same spot/brightness). The pop is therefore
**not** a distance-math error; it is a timing/identity/coverage problem around
that swap.

### Path-loop attempts this session (all insufficient)

These are the changes currently sitting **uncommitted** in the working tree
(`Scene.tsx`, `TrackMarker.tsx`). They did not fix path-loop and may be reverted.

**Attempt P1 — live per-marker fade from the camera (kill viewer lag).**
Diagnosis: `Scene` samples the camera into React state (`viewer`) inside a
`useFrame` that is subscribed *before* `Player`'s, and React state only applies
on the next render, so `viewer` trails the camera by one frame. For walking
that is invisible; at the wrap it is a full loop, so on the wrap frame every
marker's mount/fade is computed for the pre-wrap position while the camera is
already post-wrap. Fix attempted: give `TrackMarker` optional `fadeWorld` +
`fadeRange` props and have it compute its own distance fade each frame from the
live `camera`, instead of trusting the lagged `fade` prop. Result: did not fix
it; the user reported the *original* pop came back (distant orbs popping into
existence on crossing).

**Attempt P2 — keep the path-loop marker set fully mounted.** Diagnosis:
mount/unmount churn at the seam. For path-loop the transform set is already
constant (`loopAdjacentTransforms` ignores the viewer), so all base + both
preview copies are now mounted unconditionally and rely on P1's self-fade.
Result: no churn, but still popped.

**Attempt P3 — snap instead of damp on teleport.** Diagnosis (this one felt
strongest): with P1/P2 in place the seam swap is an identity swap that only
looks continuous if each copy's fade is *instantaneous*. The fade-in damping
(good for walking) makes the newly-near copy ramp up over ~0.5 s instead of
inheriting its sibling's brightness, which reads as a pop-in. Fix attempted:
`TrackMarker` tracks its previous-frame fade *target* and, if the target jumps
by > 0.15 in one frame (a teleport, vs ~0.003/frame for walking), snaps
`visibleFade` to it instead of damping. (Comparing consecutive *targets*, not
target-vs-current, because damping deliberately makes the current value lag the
target.) Result: still not fixed.

### Why P1–P3 were probably right but insufficient — open theories

All three diagnoses look individually correct, yet the pop persists. Leading
explanations for the residue, roughly in priority order:

1. **Preview coverage is only +/-1 loop, but the fade radius spans more than one
   loop.** `loopAdjacentTransforms` renders the base tile plus exactly one loop
   ahead (end preview) and one loop behind (start preview). The path-loop stem
   fade runs from `PATH_LOOP_STEM_FADE_START = 72` to
   `PATH_LOOP_STEM_FADE_END = 180`. The default map's loop length is ~81 units
   (`map.ts` start `[0,40.5]` -> end `[0,-40.5]`). So the visible horizon
   (up to 180) can reach ~2.2 loops, but only +/-1 loop of copies exist. Orbs
   roughly 2 loops out (~160-180 units) have **no copy to render**, then gain
   one the instant you cross the seam (they fall within +/-1 loop of the new
   position). That is a structural coverage gap that is independent of fade
   timing or damping — no amount of self-fade/snap can fade in an instance that
   was never mounted. This is the most likely remaining root cause and was not
   addressed by P1-P3. Likely fix: render enough loop copies to cover the full
   fade radius, i.e. `ceil(PATH_LOOP_STEM_FADE_END / loopLength)` loops in each
   direction, not just one.
2. **One-frame ordering lag at the wrap.** Even with P1, `TrackMarker`'s
   `useFrame` is subscribed before `Player`'s (markers render before `<Player>`
   in `Scene`), so on the exact wrap frame the markers compute fade from the
   pre-wrap camera while the frame renders at the post-wrap camera; P3 corrects
   it the next frame. This is at most a 1-frame flash, so it is unlikely to be
   the whole story, but it should be eliminated by guaranteeing the wrap runs
   before the marker fade pass (e.g. move the wrap into a pass that precedes
   marker `useFrame`s, or drive marker fades from a value updated post-wrap).
3. **Floor/path lighting still keyed to the lagged viewer.** `MapScene`
   `previewFade` and `tileLightTracks` are still computed from the React
   `viewer` sample in `Scene` render, not the live camera. The reported pop is
   the orb/glare, but the floor glow under it could amplify or accompany the
   effect at the seam.
4. **Snap threshold / heuristic.** The 0.15 target-jump heuristic in P3 may miss
   dimmer handoffs (small brightness orbs whose target jumps < 0.15) or fire
   imperfectly; an explicit wrap signal (a timestamp set by `Player` on wrap,
   read by markers) would be more reliable than inferring the teleport from the
   fade delta.

### Recommended next approach

Stop treating base vs preview as separate and stop relying on the sampled
`viewer` for path-loop. Concretely:

- **Cover the full fade radius with loop copies** (theory 1 above). This is
  probably the missing piece: until every orb within `PATH_LOOP_STEM_FADE_END`
  has a mounted copy on *both* sides of the seam, crossing will always reveal a
  previously-absent instance.
- **Unify into one virtual-instance list with stable keys** keyed by a
  continuous loop coordinate / instance index (hypotheses E and F), transformed
  to world space and faded live from the camera, so identity is preserved
  across the wrap and there is no base/preview split.
- **Guarantee the wrap is applied before fades are computed** (theory 2) to
  remove the residual one-frame lag.
- Consider an **explicit wrap event** rather than the fade-delta heuristic
  (theory 4).

### Working-tree state at pause

`npm run build` passes. Committed: tiled fix `3633f30`. Uncommitted: the P1-P3
path-loop attempts in `src/scene/Scene.tsx` and `src/scene/TrackMarker.tsx`,
which do **not** fix path-loop and can be reverted if starting the next attempt
from the clean tiled-fixed baseline is preferable.
