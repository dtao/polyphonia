# Buried tunnel interior / entrance not clear (P31 follow-up)

## Symptom

A tunnel set to low elevation between two open path segments shows terrain
inside it. Walking toward the tunnel, you must pass *through* a mound of terrain
to enter. The interior of a tunnel must always be clear, like a path.

## Root cause (understood)

The terrain is a single-valued heightfield. P31 tried to make buried tunnels
"pass under" the terrain by *not* carving the terrain down to the floor (so the
hillside stays overhead). The first attempts left the free noise to run through
the corridor, and a weighted lift ramped the surface from floor up to the
ceiling across the ~10-unit mouth transition — both put terrain into the
corridor band `[floor, ceiling]`.

Numeric probe of a 3-segment map (open → tunnel@−10 → open, forest seed 7):
terrain dipped to −8…−10 across the first ~10 units inside each mouth, i.e. a
long ramp of ground filling the entrance.

## Fixes applied (this round)

`clearanceAt` is now a **hard floor** applied AFTER the flatten lerp: over a
buried tunnel/room footprint the terrain is forced to at least the ceiling
height, overriding any adjacent open path's downward pin. Two refinements:

1. **Rectangle, not capsule** footprint (t∈[0,1]) so the lift stops exactly at
   the mouth plane and does not bleed a `halfWidth` cap onto the connected open
   approach.
2. **Lateral over-reach of one grid cell** past the side walls. A tunnel (width
   4) is narrower than two terrain cells (~2.5 each), so lifting only the
   centerline vertex left z=±1 interpolating down to −4.4 (into the corridor).
   Reaching one cell past the wall — where the wall geometry hides it — keeps
   the whole cross-section between lifted vertices.

Result (probed): the corridor interior is now clear along its full length AND
width (terrain ≥ ceiling everywhere inside, hidden above the tunnel's own roof
in explore mode). Regression test:
`worldgen.test.ts` "keeps a buried tunnel's interior clear where the noise dips".

## Remaining limitation (the mouth lip)

At each mouth the terrain must transition from "above the ceiling" (buried
corridor) to "at the floor" (open descending approach) within the single grid
cell straddling the mouth plane. That cell's interpolated surface pokes either:

- just OUTSIDE the mouth, above the descending approach path (current behavior:
  a ~1-cell lip up to several units tall right at the threshold), or
- just INSIDE the corridor if the junction vertex is left carved.

A single-valued heightfield cannot represent the overhang/portal of a hill
sitting directly on top of a corridor that opens to a same-level trench, so
*some* one-cell artifact at the mouth is unavoidable without a different
representation (e.g. punching the terrain mesh around the portal, or a separate
portal mesh). The interior bug is fixed; the mouth lip is the open question.

## Resolution (final): cut a hole in the terrain mesh

Every height-field approach (carve, lift, hard-floor, portal cutting) failed
because a single-valued heightfield cannot be both a hill above a corridor and
clear inside it — the surface always crossed the corridor somewhere. The fix is
to stop trying to express the hole as a height and instead **discard the terrain
where it would be inside the structure**:

- Tunnels/rooms no longer carve OR lift the terrain — it keeps its natural
  height, so a hillside sits overhead (`flattenSources` emits a `clear*` source
  only to keep scatter off them; `flattenAt` ignores it).
- `terrainClipVolumes(map)` returns each tunnel corridor (strip) and room
  chamber (oriented box) with its ceiling height.
- The terrain material (`GeneratedWorld` `useTerrainClip`) injects a fragment
  `discard`: any terrain fragment inside a footprint AND below that ceiling is
  not drawn. Terrain above the ceiling (the hill) stays. The test uses the
  vertex's canonical map coordinate, so one base volume covers every tiled/loop
  copy. Volumes are padded slightly past the walls and ceiling so no rim
  survives.

Verified in-browser (dev-shimmed session, low tunnel between two open paths):
the corridor interior is clear end to end, and standing on the descending
approach the mouth is a clean portal — no terrain to walk through. Shader
compiles with no errors. Unit tests cover: terrain stays natural over
tunnels/rooms (no carve), `terrainClipVolumes` footprints/ceilings, and scatter
still kept off the footprints.

**Sloped tunnels:** a tunnel's ceiling tracks its floor, so the strip volume
carries `ceilingA`/`ceilingB` (one per end) and the shader clips against the
ceiling *interpolated* along the strip. Using a single `max` ceiling cut the
terrain far above the deep end — a tunnel diving 0 → −12 left a long open gash
in the hillside above it. With the interpolated ceiling the cut hugs the
corridor: the shallow mouth opens to the surface and the terrain closes over
the dive. Verified in-browser; unit test asserts ceilingA − ceilingB tracks the
slope.

## Superseded attempt: hill + portal cutting

The user chose to keep the hill but carve an open cutting at each mouth. The
lift (`clearStrip`) is now **inset** from each tunnel end by `PORTAL_CUTTING`
(7 units): the hill is forced over the deep middle, but stops short of the
mouth so it never overrides the descending approach path's own carve at the
junction. The approach already trenches down to the floor at the entrance, so
the mouth is a clear open cutting — entering no longer means walking through a
lifted lip.

Probed result (open → tunnel@−10 → open): approach and entrance carved clear to
the floor (no lump); the hill rises back to its natural height over the middle
(not flattened to the ceiling — an earlier attempt that carved explicit lead-in
strips dragged the middle down via their blend and was dropped); the corridor
is clear across its full width (`clearanceAt` reaches one terrain cell past the
side walls so narrow corridors survive the grid resolution).

Residual (accepted): a single terrain cell ~`PORTAL_CUTTING` units *inside* each
mouth, where the cutting transitions up to the hill. A single-valued heightfield
cannot represent the overhang of a hill over a clear corridor without one such
transition cell; it is now framed under the tunnel roof rather than standing as
a wall across the entrance. Regression test: `worldgen.test.ts` "buries a tunnel
under a hill but carves an open cutting at the mouth".
