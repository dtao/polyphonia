# Platform snap at wrong elevation

## Symptom

When a path endpoint is dragged over a platform's XZ footprint,
`normalizeMap` infers a connection to that platform and repositions the
endpoint at the platform's canonical attachment point — even when the
endpoint is at a substantially different elevation. This causes two
user-visible problems:

1. The branch point jumps to the platform's XZ location mid-drag.
2. Camera controls lock (click-drag stops working) until the user exits
   and re-enters Edit mode. Root cause: the snap changes
   `selectedMapPointKey` mid-drag, which unmounts `TransformControls`
   without re-enabling `OrbitControls`.

## Reproduction

Drag a free path endpoint over a platform that sits at a meaningfully
different elevation (e.g. endpoint near y=0, platform at y=5). The
endpoint should stay where dragged but instead jumps to the platform.
Exact map/environment/device details unknown — not yet confirmed whether
it is deterministically reproducible from a specific composition or
ambient in normal editing.

## Attempted fix (commit 2ed5fe38, 2026-06-08)

**Diagnosis at the time:**

1. `inferEndpointConnection` called `platformContains` (XZ-only) with no
   elevation guard, so any endpoint inside a platform's footprint got
   connected regardless of height.

2. `normalizeMap` called `inferSegmentEndpointConnections` *before*
   attaching elevations to the map, so any elevation comparison inside
   `inferEndpointConnection` always saw 0 and was a no-op.

**Changes made:**

- Added a preliminary `normalizeElevations` pass before calling
  `inferSegmentEndpointConnections`, so elevation data is available
  during connection inference (`src/map.ts:199`).
- Added an elevation guard in `inferEndpointConnection`: skip platforms
  whose elevation differs from the endpoint's elevation by more than 1.5
  units (`src/map.ts:338`).

**Outcome:** The fix appeared to work in initial testing but the bug
was observed again after the merge into `main`. Checking out 2ed5fe3
directly also still shows the bug, so the regression is not from a
later commit.

**Collateral damage:** The fix also added an elevation guard to
`connectMapPoint` using the same 1.25-unit threshold. That guard was
too tight and broke the "connects a moved endpoint into the middle of
another segment" test, so it was reverted in commit 36aed6e. See the
"Path snap at different elevation" section below.

## What the fix gets right

The logic in `inferEndpointConnection` is sound in the general case:
- The preliminary elevations are computed from `value?.elevations` against
  the pre-alignment segments, so the dragged endpoint's elevation entry
  should be present when the map is passed to `inferSegmentEndpointConnections`.
- `segmentEndElevation` returns the stored elevation or 0 as default —
  matching `moveMapPoint`'s behavior of deleting the key when elevation is 0.

## New evidence (2026-06-08)

**Clue 1 — delete/recreate fixes it.** Deleting the offending branch
point and recreating it stopped the snap. This strongly confirms
**hypothesis 2** below: the segment already has a stored
`connections.[end]` pointing to the platform from a prior normalization.
`validConnection` validates it cheaply ("platform still exists?") and
returns it, bypassing `inferEndpointConnection` and thus the elevation
guard entirely. Recreating the point produces a fresh segment with no
stored connection, so the guard applies from the first drag.

**Clue 2 — same class of bug affects path-to-path snapping.** A branch
point dragged near another path *segment* at a different elevation also
snaps incorrectly. This is handled by `connectMapPoint` in the store,
not by `inferEndpointConnection`. The elevation guard that was added to
`connectMapPoint` in 2ed5fe3 was reverted in 36aed6e (it used the XZ
snap distance of 1.25 as the elevation threshold, which was too strict).
Whether path-to-path snapping should be elevation-aware at all (or just
use a much larger threshold) is an open question — see
"Path snap at different elevation" below.

## Hypotheses for why it can still fail

### 1. Platform elevation resolves to 0 even when the platform is "high"

`platformElevation` (`src/map.ts:828`) reads the platform's elevation
from its **attachment point** when `platform.attachment` is set. If that
attachment point is a segment endpoint whose elevation entry is missing
from `preliminaryElevations` (e.g. it was never explicitly set, or the
key changed due to alignment), `platformElevation` returns 0. If the
dragged endpoint is also at 0 by default, `|0 − 0| ≤ 1.5` and the guard
passes — snap still fires.

Discriminating check: add a temporary `console.log` in
`inferEndpointConnection` logging `endpointElevation` and
`platformElevation(map, platform)` just before the guard check. If both
read 0 when the snap occurs, this is the cause.

### 2. `validConnection` bypasses the elevation guard on repeat normalizations

`inferSegmentEndpointConnections` calls `validConnection` first
(`src/map.ts:298`):

```ts
return validConnection(map, segment.connections?.[end]) ?? inferEndpointConnection(map, segment, end);
```

If a connection was stored in `segment.connections` from a *previous*
`normalizeMap` call (e.g. a legitimate snap that was then undone or
superseded), `validConnection` returns it without any elevation check
— it only verifies the platform still exists in the map. So once a
platform connection is written onto a segment, it persists through any
subsequent normalization that doesn't explicitly clear it.

Discriminating check: inspect whether `segment.connections?.[end]` is
already set when the bad snap fires.

### 3. `moveMapPoint` elevation key is 0 so it's deleted, defeating the guard

In `moveMapPoint` (`src/store.ts:954`):

```ts
if (connected.elevation === 0) delete elevations[nextKey];
```

If the user drags at exactly y=0, the elevation key is omitted from the
map passed to `normalizeMap`. The preliminary elevations therefore also
omit it, so `segmentEndElevation` returns 0. If the platform is at y=0
(or its attachment point elevation is missing → defaults to 0), the
guard again sees `|0 − 0| ≤ 1.5` and passes.

This is correct behavior at y=0 (they *are* at the same height) but
breaks down if `platformElevation` is also returning 0 spuriously.

### 4. Alignment rekeys endpoints before elevation lookup

`alignConnectedSegmentEndpoints` can move segment endpoints to new XZ
coordinates (when snapping to attached rooms/platforms). If a segment
endpoint moves during alignment, its old elevation key may no longer
match its new position. The preliminary elevations are computed against
**pre-alignment** segment XZ, but `inferEndpointConnection` sees the
post-`alignAttachedRooms` XZ (since alignment is nested inside the
same call chain). Whether this matters depends on whether
`alignAttachedRooms` runs before or after `inferSegmentEndpointConnections`
— currently the order is `alignAttachedRooms → inferSegmentEndpointConnections
→ alignConnectedSegmentEndpoints`, so rooms are aligned first.

## Next discriminating checks for platform bug

The delete/recreate clue makes hypothesis 2 the most likely primary
cause for saved compositions. To confirm before implementing a fix:

1. **Inspect stored connections**: Load the saved composition that
   reproduces the bug. Open `window.polyStore.getState().composition.map`
   in the browser console. Find the offending segment and check
   `segment.connections.start` or `segment.connections.end` — if it
   already shows `{kind: "platform", platformId: "..."}`, hypothesis 2
   is confirmed.

2. **If hypothesis 2 is confirmed**, the fix is to add an elevation check
   inside `validConnection` (or at the call site in
   `inferSegmentEndpointConnections`) when validating existing platform
   connections — same guard as `inferEndpointConnection`. The stored
   connection should be cleared if elevation has diverged beyond the
   threshold, forcing re-inference.

3. **If connections are NOT pre-set**, add a `console.log` to
   `inferEndpointConnection` emitting `endpointElevation` and
   `platformElevation` when a snap fires, to diagnose hypotheses 1/3.

## Path snap at different elevation

A related but separate bug: dragging a branch point near a path segment
at a different elevation causes an unwanted snap. This goes through
`connectMapPoint` (`src/store.ts:342`) which finds the nearest segment
endpoint within `MAP_POINT_CONNECT_DISTANCE` (1.25 XZ units). There
is currently no elevation guard there (the one added in 2ed5fe3 was
reverted in 36aed6e because it used 1.25 as the elevation threshold,
which was too strict — the test snaps elevation 9 to a segment at
elevation 4).

Open question: should `connectMapPoint` refuse to snap when the
elevation difference is large (e.g. > some generous threshold like 3–5
units)? Or is path-to-path snapping inherently a 2D operation and the
elevation is intentionally adopted from the target segment? The snapped
elevation does get set to the segment's interpolated elevation, so the
user would see the branch point jump vertically as well as horizontally.

Needs: a repro case with exact elevations involved, to size the
threshold correctly without re-breaking the test case.

## Related code

- `src/map.ts:326` — `inferEndpointConnection` (elevation guard lives here)
- `src/map.ts:199` — preliminary elevations in `normalizeMap`
- `src/map.ts:298` — `validConnection` bypass in `inferSegmentEndpointConnections`
- `src/map.ts:828` — `platformElevation`
- `src/map.ts:860` — `segmentEndElevation`
- `src/store.ts:342` — `connectMapPoint` (path-to-path snap, no elevation guard)
- `src/store.ts:954` — `moveMapPoint` action (elevation key deletion)
