# Environment Object Pop-In Investigation

Date: 2026-06-06

## Status

Resolved and manually verified on June 6, 2026. Environmental objects retain
their authored size, fade at the radial horizon, and transition between proxy
and authored geometry without visible pop-in on path-loop maps.

## Symptom

Verdant Grove trees and Prismatic Reach crystal formations do not enter the
visible field as a smooth opacity fade.

- Square and hex tiled maps now avoid the original hard lifecycle pop, but
  objects visibly grow from miniature to full size.
- Path-loop maps still create trees and crystals abruptly a short distance in
  front of the listener while walking.

## Reproduction Conditions

1. Select Verdant Grove or Prismatic Reach.
2. Explore a square or hex tiled map and approach distant environment objects.
3. Repeat on a path-loop map, walking toward and across the loop endpoint.

Expected: objects retain their authored size and fade from transparent to
opaque across the shared radial fade band.

Actual: tiled objects scale up; path-loop objects can still appear abruptly.

## Attempts And Evidence

### `91a5497` and `0007731`

Procedural instances used uniform scale as the per-instance fade mechanism,
then standardized that scale against `radialFade`. This explains the reported
growth exactly: the instance matrix is multiplied by the fade value.

### `ca60d89`

Preview generation was extended beyond `RADIAL_FADE_OUTER` by the maximum
object offset inside a tile or loop copy. This fixed square/hex lifecycle
coverage, but path-loop transforms remain viewer-gated and can replace their
copy set as the listener walks or teleports across the seam.

The earlier `tiled-orb-pop-in.md` investigation independently found that
path-loop rendering needs a stable pool covering multiple loop depths. A fade
cannot hide an object whose repeated copy does not exist yet.

## Current Hypotheses

1. The growth is not a perception issue; it is the implemented matrix-scale
   fade and must be replaced with real per-instance alpha.
2. Path-loop environment copies should not be admitted by sampled viewer
   distance. A fixed pool on both sides of the loop, sized from loop span and
   fade coverage, should remain mounted while world-space instance culling does
   the performance work.
3. The one-frame preview guard may still hide path-loop copies on the wrap
   frame, but a stable pool should make the following frame an identity handoff
   rather than reveal a newly generated object.

## Next Discriminating Checks

- Confirm trees/crystals keep constant silhouette size throughout the fade.
- Walk a path loop continuously without crossing the seam and watch for new
  objects appearing nearby.
- Cross both loop directions repeatedly and watch the same object group through
  the handoff.
- Compare Verdant Grove and Prismatic Reach on high and low quality.

## Implementation Under Test

- Replaced matrix scaling with an `instanceFade` shader attribute and
  alpha-hashed material clones, preserving every authored instance transform.
- Path-loop environment previews now use a fixed multi-depth pool derived from
  loop span and generation radius instead of sampled viewer admission.
- Instance fade/cull lists refresh at 30 Hz and immediately after the explicit
  loop-wrap generation signal, replacing the previous 250 ms stale window.

Automated tests verify transforms, coverage, and material configuration. The
constant-size alpha fade and path-loop seam handoff were manually verified.

## Result After `610f0ab`

Manual verification confirmed that square/hex behavior improved, but path-loop
trees and crystals still appear abruptly. The stable transform pool and alpha
fade were therefore insufficient.

A remaining hard discontinuity is the detail LOD split: high-quality
environment objects switch from proxy geometry to authored geometry at exactly
42 units. New diagnostics record near/far/hidden states and transitions under
`debugEnvironmentInstances=1`. The comparison flag
`debugEnvironmentNoLod=1` forces authored geometry throughout the visible
radius to determine whether that geometry swap is perceived as pop-in.

## Diagnosis Confirmed

The exported run from June 6 confirmed that the remaining pop was the hard LOD
boundary:

- 74 `far -> near` transitions occurred at 41.18–42.00 units.
- 74 `near -> far` transitions occurred at 42.01–42.28 units.
- Every sampled transition had radial fade `1.0`, so the geometry changed while
  fully visible.
- With `debugEnvironmentNoLod=1`, manual testing showed more initial authored
  objects and no observed pop-in.

The implementation now overlaps proxy and authored geometry across a 34–50
unit band, alpha-fading one out while the other fades in instead of replacing
the mesh at one distance.

## Resolution

Manual retesting of the same path-loop route confirmed that the LOD crossfade
eliminated the remaining pop-in. The environment-instance debug snapshot and
the `debugEnvironmentNoLod=1` comparison flag remain available for future pack
or geometry regressions.
