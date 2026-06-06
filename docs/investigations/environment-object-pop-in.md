# Environment Object Pop-In Investigation

Date: 2026-06-06

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

Automated tests can verify transforms, coverage, and material configuration;
the visual quality and seam handoff remain pending manual verification.
