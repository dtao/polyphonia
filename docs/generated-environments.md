# Generated Environments

Procedural visual landscapes (a sculptable terrain heightfield, gradient sky,
and mood lighting) that composers generate and selectively regenerate around
their stems and paths. Read this before touching `src/worldgen/`,
`src/scene/GeneratedWorld.tsx`, the `generated` branch of
`EnvironmentSettings`, or the World panel.

> **Object scatter is retired from the product** (the primitive tree/rock
> archetypes weren't worth keeping): generation is terrain-only, nothing
> renders `generated.objects`, and there is no placement UI. The scatter
> engine (`scatter.ts`, `objects.ts`) and its preservation semantics stay in
> the codebase, tested and dormant, as the foundation for a future
> imported-asset object system. Vestigial objects in older manifests are
> preserved by normalization but not shown.

## Data model (`src/environment.ts`)

`composition.environment.generated: GeneratedEnvironment`:

- `biome`, `seed`, `params` — everything re-derivable is *not* stored. The base
  terrain is recomputed from `seed` + `params` by a deterministic, hash-based
  value noise (`src/worldgen/noise.ts` — no `Math.sin`/`Math.random`, so a
  published world renders identically in every browser).
- `center`, `size` — the square region; `center` is the map start at
  generation time and stays fixed afterward.
- `objects: WorldObjectPlacement[]` — baked scatter placements (vestigial:
  see the retirement note above; normalized and preserved, never rendered).
  `position[1]` is an offset above the terrain, not an absolute height.
  Objects carry provenance: `userPlaced`, `edit: "minor" | "major"`.
- `edits: GeneratedEdit[]` — ordered terrain ops: brush strokes
  (`raise`/`lower`/`smooth`) and regional `reseed`s. The final heightfield is
  base noise → constraint flattening → edits, applied in order.
- `locks: Record<objectId, boolean>` — objects pinned against regeneration.
- `constraints: { stems, paths, buffer }` — the clear-zone toggles.

`normalizeGenerated` is the compatibility boundary; older manifests without
`generated` simply omit the field. Export/import, library persistence, and
cloud publish all spread the whole composition, so the config rides along, and
`compositionRevision` already hashes `environment` wholesale.

## Constraint awareness

`flattenSources` (`src/worldgen/terrain.ts`) collects protected geometry:
walkable segments/rooms/platforms (including tiled copies), stem positions,
and always the map start. Inside each zone (+ `buffer`) the terrain pins to
the **lower envelope** of all sources' surface heights (each rising at
`FLATTEN_TARGET_SLOPE` outside its own clearance), seated `FLATTEN_DROP`
below — not simply the nearest source's height. The envelope is ≤ every
nearby walkable surface and is concave inside the corridor, so grid-cell
interpolation can never cut a chord above the path at elevation kinks (the
bottom of a ramp) or under a stem disc sitting on a slope. The target is
additionally capped at the nearest source's own height: the distance
penalty only arbitrates between sources and must never anchor the blend
band *above* the local path (that produced collar ridges spilling onto
rising corridors). Outside the zone
it blends to free noise over a fixed band; the scatterer rejects placements
inside the same zones. Because the mask is recomputed from the **live** map
and stems, moving a stem or path keeps its clearance without regenerating.
Brush edits are scaled by the same mask so a stroke across a path leaves the
walkable strip untouched.

## Determinism and editing

- The runtime heightfield is memoized in `src/worldgen/sampler.ts`. Appended
  brush ops apply incrementally to the cached grid (no full rebuild per
  stroke); stem-drag mask changes rebuild at most every ~300 ms.
- A brush stroke emits several small ops coalesced into one undo entry
  (`withHistory` key `world:terrain`); `finishTerrainStroke` classifies the
  whole stroke major/minor by cumulative impact.
- (Dormant) scatter is a jittered grid hashed per cell from the seed: same
  seed → same placements, and it rejects the live clear zones
  (`objectBlockedByClearZone` mirrors the same margin for display-time
  suppression when objects return).

## Regeneration preservation modes (`src/worldgen/regen.ts`)

| Mode | Terrain sculpting kept |
|---|---|
| `overwrite` | none |
| `keep-constraints` | none (constraint toggles forced on) |
| `keep-major` | major strokes only |
| `keep-all` | all strokes |
| regional (`regenerateRegion`) | drops strokes centered in the circle, appends a `reseed` |

All modes re-roll the base seed except regional, which keeps it and blends a
fresh region seed. The same modes also govern vestigial objects (locked /
user-placed / edited ones survive) so older manifests behave predictably.

## Rendering (`src/scene/GeneratedWorld.tsx`)

- Terrain is one opaque vertex-colored mesh → the scene fog fades it at the
  shared radial band for free.
- The biome mood adds lights and a camera-following gradient sky dome
  (`skyGradient.ts`): with one authored sky color both shades derive from it
  (lighter horizon, darker zenith); an optional second color (`skyColor2`)
  makes the gradient run exactly horizon → zenith. The horizon shade is the
  canonical background: `environmentBackground` feeds it to the fog, scene
  background, and AR backdrop, which must all stay identical so fog-faded
  geometry dissolves into the dome at eye level.
- Movement: the world is visual-only on bounded maps (terrain flattens to the
  walkable surfaces anyway). On maps with **no walkable bounds**, `Player`
  rides `generatedGroundHeight` so hills are actually walkable.

## Path-loop maps (`src/worldgen/loop.ts`)

On path-loop tiling the world repeats across the seam so the wrap teleport is
invisible: a hill sculpted next to the start loop point is visible ahead as
you approach the end loop point.

- The terrain *field* is made loop-invariant (`applyLoopToField`): each sample
  is canonicalized into the fundamental cell and, in a `LOOP_BLEND_BAND`
  before the end seam, blended toward the transported start-side values plus
  the loop's vertical lift. Invariance is exact at the seam and approximate
  off-corridor (masked by the same distance fade that hides the structural
  map-copy seam). No terrain mesh copies are rendered — overlapping opaque
  heightfields would z-fight.
- The zone before the end seam *displays* the transported start-side world,
  so composer edits (brush centers) are remapped to their fundamental-domain
  spot via `loopEditPoint` — the transport shows them under the cursor.
- `shade`/`patch` on the display field keep terrain coloring (height ramp and
  patch noise) consistent across the seam despite the lift.

Square/hex tiling is not loop-aware yet; generated worlds there stay a single
region as before.

## UI

The World panel (top-left stack, `src/ui/WorldPanel.tsx`) is the single
visual-world surface:

- Terrain & sky: biome, generate, relief/feature-size/mood sliders, sky
  gradient colors, ground palette, constraint toggles + zone visualization,
  sculpt brushes, regeneration modes, regional regenerate.
- Materials: imported PBR materials assigned to the generated terrain
  (`surfaces.ground` — world-space tiling, multiplied with a whitened height
  palette so the biome tint reads through; `TerrainGroundMaterial` in
  GeneratedWorld.tsx) and to map floor/wall/ceiling (rendered by
  `src/scene/SurfaceDressing.tsx`), with import.
- Objects: imported GLB landmarks (creator assets) placed at the viewer and
  moved with the gizmo; inspector in `src/ui/LandmarkPanel.tsx`.

## Tuning constants worth knowing

- Major/minor stroke thresholds live in regen.ts (`MAJOR_TERRAIN_IMPACT`).
- `FLATTEN_BLEND` / `RIM_BLEND` (terrain.ts) shape how terrain meets paths and
  the region edge.
- `FLATTEN_DROP` (terrain.ts): flattened terrain seats this far below the
  walkable surface it pins to. The map's floors are planes at exactly their
  elevation, so terrain pinned to the same height would z-fight them.
- `FLATTEN_TARGET_SLOPE` (terrain.ts): rise rate of each source's candidate
  in the lower-envelope flatten target; must exceed the steepest realistic
  path slope so ramps regain their height once clear of lower neighbors.
- The flatten-target grid is ERODED (3×3 min) before use: the target field
  has convex creases, so raw per-vertex sampling let interpolated chords bow
  above the path between vertices (see
  docs/investigations/terrain-blobs-on-paths.md). Keep the erosion if you
  touch the field pipeline.
