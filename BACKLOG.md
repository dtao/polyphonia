# Backlog

This file tracks the build, grouped into milestones. Item ids use
`M<milestone>.<item>` so future milestones can change without renumbering
earlier work. Within each milestone, items are ordered so each depends only on
earlier ones.

## Milestone 1 — Editable in memory ✅

- [x] **M1.1 Mutable audio engine** — live setters for volume / position / falloff; tracks keyed by a stable id.
- [x] **M1.2 Composition store** — Zustand single source of truth; the scene and engine render from it.
- [x] **M1.3 Mode toggle: Explore ↔ Edit** — first-person walk vs. an orbit/edit camera.
- [x] **M1.4 Select a track** — click a pillar to select it (ring highlight).
- [x] **M1.5 Move tracks** — drag a gizmo on the ground plane; the mix updates live.
- [x] **M1.6 Properties panel** — rename, recolor, volume, falloff, delete.

## Milestone 2 — Build a composition from scratch

- [x] **M2.1 Add stems (upload)** — file picker + drag-and-drop; decoded and inserted in sync with the running loop.
- [x] **M2.2 New / empty composition** — start screen "new composition" form (title, BPM, and local-only artist fallback) drops into edit mode on an empty composition; empty-state hint prompts adding the first stem.
- [x] **M2.3 Loop-point cleanup** — trim MP3 encoder padding by looping `[offset, offset + musical-length]` per source (offset = shared leading silence), so imported stems loop seamlessly.

## Milestone 3 — Persistence (local-first)

- [x] **M3.1 Save / load locally** — versioned JSON manifest in `localStorage` + uploaded stem audio in IndexedDB; autosaves on change, restores on launch.
- [x] **M3.2 Export / import** — download a composition with all stem audio embedded as a single portable `.polyphonia.json`; re-import to load it (stems restored to IndexedDB).
- [x] **M3.3 Composition library** — start-screen chooser to switch, create, duplicate, rename, and delete compositions; persisted as a library (schema v2, migrates the old single slot, seeds the Journey demo).

## Milestone 4 — Backend & shareable URLs

- [x] **M4.1 Backend + storage** — Supabase: uploaded stems → public Storage bucket, manifest → Postgres row; signed-in publish (no custom server, gated by RLS).
- [x] **M4.2 Stable share URLs** — `/c/:id` loads a published composition read-only (React Router + read-only viewer).
- [x] **M4.3 Accounts & ownership** — email magic-link sign-in (Supabase Auth); publishing requires sign-in and ties the composition to the user (`owner` + RLS); "Your published links" manager to copy/unpublish. Editing/playing stays accountless.
- [x] **M4.4 Public gallery** — `/gallery` grid of the 50 most recently published compositions (denormalized `title`/`artist` columns, populated at publish); cards open the read-only `/c/:id` viewer. _Future: an `unlisted` opt-out flag and popularity ranking (visits/shares/votes); search/sort; moderation/report flow._
- [x] **M4.5 Artist pages** — `/artist/:slug` lists the published compositions for that unique artist slug; artist names link there from both the gallery and shared composition viewer, and publishing prevents duplicate titles per artist.
- [x] **M4.6 Supabase migrations** — schema setup lives in `supabase/migrations`: initial sharing plus artist identity/title-uniqueness migration.
- [x] **M4.7 Account artist identity** — signed-in accounts load/create a primary artist profile; new compositions and publishing use it automatically instead of treating artist as per-composition metadata.
- [x] **M4.8 Loop seam controls** — Edit mode includes a Loop panel to audition the seam, trim start/end, tune crossfade, and disable looping for long-form compositions.

## Milestone 5 — Immersive environments

- [x] **M5.1 Environment model** — add composition-level visual metadata with persistence/export/publish compatibility and safe defaults for older compositions; later simplified to an optional authored detail-pack selection.
- [x] **M5.2 Visual environment foundation** — provide a neutral base space that preserves edit readability, marker selection, and performance beneath optional authored detail packs.
- [x] **M5.3 Detail pack picker** — add an Edit-mode panel so composers can choose an optional authored visual pack and quality tier without touching stem placement or audio settings.
- [x] **M5.4 Map model and presets** — add composition-level walkable maps with Open, Line, and Y presets, visible lighted ground paths, closed route ends, and Explore-mode movement constraints.
- [x] **M5.5 Composition start point** — each composition stores a start position + facing direction; Edit mode can set or jump to it, and Explore entry begins there.
- [x] **M5.6 Map shape editor** — replace preset-only maps with editable route geometry: add/move/delete endpoints, branches, widths, and closed boundaries directly in Edit mode.
- [ ] **M5.7 Map-aware stem tools** — snap stems to paths, show distance along branches, warn when stems are outside the walkable area, and provide quick distribute-along-path helpers.
- [ ] **M5.8 World-aware ambience** — let the generated biome and assigned surface materials suggest broad acoustic character (meadow/soft → dry, low reflections; cavern/stone/crystal → brighter, longer reflections) using a conservative global reverb/filter path that can be bypassed. (Re-scoped from detail packs, which were retired in favor of generated worlds + imported materials.)
- [x] **M5.9 Occlusion and obstruction pass** — introduce geometry-aware sound shaping between listener and stems (line-of-sight checks against environment/map obstacles; blocked sounds get softer/darker without breaking timing, with room/tunnel/wall thickness affecting dampening strength).
- [x] **M5.10 Looping space model** — support composition-level spatial tiling (`none`, square, hex, path-loop`) with tile size/origin and compatible map topology so a stem layout can repeat infinitely like the audio loop.
- [x] **M5.11 Tiled map rendering and audio instances** — render nearby visual tiles/map copies and create/cull nearby virtual stem instances around the listener, bounded by adaptive distance/performance limits so infinite space stays cheap.
- [ ] **M5.12 Tiling editor aids** — show tile boundaries, mirrored/ghost map copies, and edge-continuity hints in Edit mode so composers can intentionally make square/hex/path layouts that tile cleanly.
- [x] **M5.13 Publish/viewer compatibility for maps and environments** — ensure `/c/:id`, `/gallery`, artist pages, export/import, and older manifests all handle environment, map, start, and tiling metadata gracefully.
- [ ] **M5.14 Open-world stitching prototype** — explore streaming/culling multiple artists' spaces into neighborhoods once single-composition maps and tiling work.
- [x] **M5.15 Elevation (the vertical dimension)** — stems drag freely in 3D (gizmo Y unlocked) and branch points carry a height (`map.elevations`), so segments become ramps. The explore player auto-follows the walkable surface, attached rooms inherit their branch point's height, and spatial audio is 3D for free (listener + panners already honor Y).
- [x] **M5.16a AR/Geo movement experiments** — square/hex tiled maps expose optional listener modes: AR Walk lets Three own an Android WebXR AR session for room-scale pose tracking, while Geo Drive watches GPS movement for car-scale exploration. Both feed existing map wrapping/clamping/audio updates.
- [x] **M5.16b Multi-entrance rooms** - support rooms connecting to multiple path segments - or other rooms from arbitrary points in the wall.
- [x] **M5.17 Tunnels** - introduce a new type of path segment: an enclosed tunnel (with sound occlusion).
- [x] **M5.18 Platforms** - large areas of various shapes (rectangle, hex, circle) - like rooms, they can be connected to path segments; but they have no walls or ceilings.
- [x] **M5.19 Doors** - entrances can have doors that slide open - can be openable from one side, or from both sides.
- [x] **M5.20 Standalone walls** - allow composers to create walls in arbitary locations (not necessarily connected to a path segment) to introduce intentional occlusion as part of a composition.
- [ ] **M5.21 Generated-world objects from imported assets** — bring scattered objects back to generated worlds using high-quality imported GLB assets (per-biome palettes/weights). The constraint-aware scatter engine, locks, and preservation modes are already built and dormant in `src/worldgen/scatter.ts`; this item is the asset sourcing, per-biome configuration UI, and re-enabling rendering through the faded-instance pipeline.

## Milestone 6 — Authored high-fidelity environments

- [x] **M6.1 Environment asset pipeline** — support GLB/GLTF scene kits with compressed geometry/textures, preloading, attribution metadata, and safe fallbacks when assets fail.
- [x] **M6.2 PBR material pipeline** — load authored albedo/normal/roughness/metalness/AO/emissive maps so rock, foliage, crystal, water, and architectural surfaces read as real materials.
- [x] **M6.3 Hero environment prototype** — build one hand-composed AAA-style cavern scene with modular assets, authored lighting, landmarks, and an edit-friendly visibility mode.
- [x] **M6.4 Postprocessing pass** — add a restrained configurable stack for bloom, ambient occlusion, tone mapping, color grading, vignette, and depth fog.
- [x] **M6.5 Runtime optimization pass** — introduce instancing/LOD/culling/texture budgets so high-detail environments stay responsive in the browser.
- [x] **M6.6 Environment authoring workflow** — support both reviewed environment packs and independently imported licensed PBR materials/GLB landmarks, with validation, reusable local records, composition assignment, portable exports, cloud delivery, and authoring documentation.

## Milestone 7 — Advanced composition features

- [x] **M7.1 Stem timing offset** — let each stem shift earlier or later by musical intervals such as 1/16, 1/8, 1/4, and 1/2 notes, while keeping all stems synchronized to the shared audio clock and saved in the composition manifest.
- [x] **M7.2 Variable stem durations** - it should be possible for some stems to be 4 bars while other stems are 8 bars in length. In this case the 4-bar stems should automatically loop at 2x the interval of the 8-bar stems.
- [x] **M7.3 Stem tails** - if a stem is a bit longer than a whole number multiple of the BPM - for example, slightly longer than 8 bars - it should be looped before the audio ends (but still allowing the remainder to be played), allowing reverb tails to be heard across loop seams.
- [x] **M7.4 Audio playback visualization** - in Edit mode, there should be a visual bar near the bottom of the screen showing the full length of the loop (with beat markers based on BPM) including an indicator of the current position as the audio plays.
- [x] **M7.5 Stem playback visualization** - in Edit mode, click on stem to reveal a visual meter of the track, similar to the visual bar for the overall composition loop (from M7.4) but for this specific stem - allowing user to indicate where stem sub-loop should begin and end.
- [x] **M7.6 Auto-pilot mode** - it should be possible to define a route through a map such that the listener can hit "Play" and the experience will automatically follow the route - including camera movements. Easiest way to do this from authoring perspective is to allow a "Record" buttin in Edit mode which will track the author's movements and camera.
- [x] **M7.7 Variable fade radii** - I want to be able to set multiple points on a map where the visible radius differs between those points; i.e. I might start out with a very wide radius, but then further along the path there is a point with a much smaller radius creating a more claustrophobic effect.
- [x] **M7.8 Teleport points** - in Edit mode, let me drop up to 10 pins such that simply hitting a number key (0 through 9) will take me straight to that spot.

## Polish & fixes

- [x] **P2 Stem direction** — similar to real-world speakers, it should be possible for stems to be unidirectional (current behavior) or to be "pointed" in a direction, with the ability for the user to configure the width and dispersion of the sound.
- [x] P3 Extending one segment into another should "connect" them (unified bridge point).
- [x] P4 Environmental objects (e.g. trees, stones) should never appear directly in the middle portion of a path segment.
- [x] P5 Map copies directly adjacent to the one the player is standing on should include detailed textures (so that as you approach the loop boundary they don't look dull and suddenly detailed once you cross the boundary.)
- [x] P6 Stem orbs in maps with detail packs enabled have strange square-shaped light halos with clearly visible straight boundaries.
- [x] P7 Floor textures of path segments, rooms, and platforms should all match for maps with detail packs.
- [x] P8 Floor texture goes away after changing detail pack for the first time and doesn't come back until browser refresh.
- [x] P9 Geo Drive mode should only be available on mobile, on tiled maps.
- [x] P10 Environmental objects (trees, crystals, etc.) should repeat on tiled maps just as stem orbs do.
- [x] P11 Floor textures have a visible gap at joints - where path segments connect at an angle.
- [x] P12 Environmental objects (trees, crystals, etc.) should fade in from the distance as you approach rather than abruptly appear - same as stem orbs.
- [x] P13 Environmental (trees, etc.) show visible flicker as player crosses the loop boundary on path-loop maps.
- [x] P14 Creating any new object (incl. landmark, wall) should set its location based on where the camera is looking in Edit mode. (Use same logic for stems, which are already created where the camera is pointed.)
- [x] P15 Cloning any object should create a copy at the same elevation.
- [x] P16 Placed landmarks should not disappear when changing detail packs in Edit mode.
- [x] P17 Default room/wall/tunnel height should be above eye height - maybe 1.5x (it would probably be best to actually make these values explicitly related so future adjustments to eye height will update the other values).
- [x] P18 Walls should have standard movement control (same control used to move stems) allowing users to drag along 3 dimensions.
- [x] P19 Crossing loop boundary can make landmark objects suddenly appear/disappear.
- [x] P20 Color chooser should dismiss (like other UI elements) when user clicks away.
- [x] P21 There should be no landmark objects when creating a new composition.
- [x] P22 Publishing (and updating) should have a progress bar, just like loading.
- [x] P23 Loop bar should allow setting number of *beats*, not bars (e.g. supporting non-standard time signatures).
- [x] P24 Rings visualizing Near and Far properties only appear at 0 elevation - should be aligned with elevation of stems (so they're visible where these attributes are being adjusted).
- [x] P25 Adding stem should always locate stem where camera is looking - including elevation. Currently it can place the stem on a different surface e.g. if there is a path "above" the camera at a higher elevation.
- [x] P26 Adding room to another room should always match elevation. Currently when adding a room to another room, it is possible the new room will appear at a different elevation.
- [ ] P27 Supabase cleanup migration: drop the orphaned `detail_packs` table (and its RLS policies) left behind by the retired detail-pack system. The `environment-assets` bucket stays — creator assets still publish there.
- [ ] P28 Large authored visible radii vs. generated regions: the bounded-map region derivation accounts for `map.visibleRadius`, but extreme combinations (huge maps near the 560-unit region cap with a large radius) fall back to the rim fade. If composers hit this, expose region size or raise the resolution cap.
- [x] P29 Independent radii for horizontal vs. vertical visibility - allow "distance you can see" to be adjustable separately for Z axis vs. XY plane so player might be able to see "up/down" more or less far than they can see 360 degrees around them.
- [x] P30 Make the plane at 0 elevation (as a surface that reflects light) removable, adjustable, cloneable - the visual effect is cool but it can interfere with maps that go to negative elevation. Make it something composers can play with: I might want the same effect of a "translucent floor" at higher or lower elevations.
- [x] P31 Tunnels should go *through* the terrain if possible - the current rules are that if you create a path that goes down below the terrain, the world generation engine automatically moves the terrain down so you are always walking about it. Tunnels and rooms should be an exception: you can make a tunnel that goes "underground" and have underground rooms as well.
- [x] P32 Sliver of terrain is still visible over path on a map that goes fairly deep below 0 elevation (this happens to be around -35).
- [x] P33 Setting texture for walls and ceiling doesn't seem to affect tunnels or rooms.
- [x] P34 Standalone walls with textures flicker due to z-fighting.
- [ ] P35 There should be some warning if you try to set a loop bound in a way that will cause the map to infinitely collide with itself.
- [x] P36 In Edit mode, it should be possible to select objects "through" the ceiling of a room (i.e. clicking on a stem orb should select the stem orb, not the room). This is important since the default perspective in Edit mode is elevated, so the user is typically positioned above the room.
- [ ] P37 Rivers should work like paths (multiple branch points, arbitrary length) but fixed to walkable surfaces incl. elevation
- [x] P38 Pillars should extend vertically forever
- [ ] P39 Allow stems to move - define paths, either loops or out-and-back
- [ ] P40 Customize shape somehow based on audio waveform (like a unique signature - every customized shape should be different in a deterministic way)
- [ ] P41 Stalactite/stalagmite shapes - come up from the base, or down from above, pulsing (length changing) with the music
- [x] P42 Get rid of location rings (except in Edit mode)
- [ ] P43 Fix timing issue with adding stems to composition with many stems (loop seems off, need to refresh to fix)
- [x] P44 When editing start/end of track, control should snap to whole number of beats (not just for offset, but for full clip as well)
- [x] P45 Loop bar should probably have a fill-width editor to make it much easier to make precise adjustments
- [x] P46 Ability to pause/unpause music
