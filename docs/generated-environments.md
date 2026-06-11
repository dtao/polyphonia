# Generated Environments

Procedural visual worlds (terrain + scattered objects) that composers can
generate, sculpt, and selectively regenerate around their stems and paths.
Read this before touching `src/worldgen/`, `src/scene/GeneratedWorld.tsx`, the
`generated` branch of `EnvironmentSettings`, or the World panel.

## Data model (`src/environment.ts`)

`composition.environment.generated: GeneratedEnvironment`:

- `biome`, `seed`, `params` — everything re-derivable is *not* stored. The base
  terrain is recomputed from `seed` + `params` by a deterministic, hash-based
  value noise (`src/worldgen/noise.ts` — no `Math.sin`/`Math.random`, so a
  published world renders identically in every browser).
- `center`, `size` — the square region; `center` is the map start at
  generation time and stays fixed afterward.
- `objects: WorldObjectPlacement[]` — baked scatter placements, because they
  are individually editable. `position[1]` is an **offset above the terrain**,
  not an absolute height, so preserved objects re-seat when terrain re-rolls.
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
and always the map start. The terrain field is pinned to the walkable surface
height inside each zone (+ `buffer`) and blends to free noise over a fixed
band; the scatterer rejects placements inside the same zones. Because the mask
is recomputed from the **live** map and stems, moving a stem or path keeps its
clearance without regenerating. Brush edits are scaled by the same mask so a
stroke across a path leaves the walkable strip untouched.

## Determinism and editing

- Scatter is a jittered grid hashed per cell from the seed: same seed → same
  world, and a regional regenerate with a fresh seed only reshuffles its cells.
- The runtime heightfield is memoized in `src/worldgen/sampler.ts`. Appended
  brush ops apply incrementally to the cached grid (no full rebuild per
  stroke); stem-drag mask changes rebuild at most every ~300 ms.
- A brush stroke emits several small ops coalesced into one undo entry
  (`withHistory` key `world:terrain`); `finishTerrainStroke` classifies the
  whole stroke major/minor by cumulative impact. Gizmo drags likewise classify
  against the drag start at release (`markWorldObjectEdit`).

## Regeneration preservation modes (`src/worldgen/regen.ts`)

| Mode | Terrain edits | Objects kept |
|---|---|---|
| `overwrite` | wiped | none |
| `keep-constraints` | wiped | none (constraint toggles forced on) |
| `keep-major` | major only | locked, user-placed, major-edited |
| `keep-all` | all | locked, user-placed, any-edited |
| regional (`regenerateRegion`) | drops strokes centered in the circle, appends a `reseed` | everything outside + preserved inside |

All modes re-roll the base seed except regional, which keeps it and blends a
fresh region seed.

## Rendering (`src/scene/GeneratedWorld.tsx`)

- Terrain is one opaque vertex-colored mesh → the scene fog fades it at the
  shared radial band for free.
- Scatter objects are primitive-composed archetypes
  (`src/worldgen/objects.ts`) rendered through `createFadedInstancedMesh`, so
  per-instance visibility routes through `radialFade` per the AGENTS.md rule.
  Instance picking maps `event.instanceId` through the per-refill
  `visibleIds` array.
- The biome mood adds lights and overrides the fog/background color via
  `environmentBackground` (fog and background must stay identical).
- Movement: the world is visual-only on bounded maps (terrain flattens to the
  walkable surfaces anyway). On maps with **no walkable bounds**, `Player`
  rides `generatedGroundHeight` so hills are actually walkable.

## UI

- World panel (top-left stack, `src/ui/WorldPanel.tsx`): biome, generate,
  shape/mood sliders, constraint toggles + zone visualization, edit tools
  (brushes, place, remove), regeneration modes, regional regenerate.
- Selected-object inspector (bottom-left, `src/ui/WorldObjectPanel.tsx`):
  rotation/scale/height/tint, lock, duplicate, delete; gizmo moves it.

## Tuning constants worth knowing

- `MAX_WORLD_OBJECTS` (scatter.ts) caps manifest size and draw cost.
- Major/minor thresholds live in regen.ts (`MAJOR_TERRAIN_IMPACT`,
  `MAJOR_MOVE_DISTANCE`).
- `FLATTEN_BLEND` / `RIM_BLEND` (terrain.ts) shape how terrain meets paths and
  the region edge.
- `FLATTEN_DROP` (terrain.ts): flattened terrain seats this far below the
  walkable surface it pins to. The map's floors are planes at exactly their
  elevation, so terrain pinned to the same height would z-fight them.
