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

- [x] **M5.1 Environment model** — add composition-level environment metadata (`environment.type`, palette/material preset, ambience intensity, optional tiling settings) with persistence/export/publish compatibility and safe defaults for older compositions.
- [x] **M5.2 Visual environment presets** — replace the bare abstract grid with selectable preset spaces (e.g. studio void, cavern, forest clearing, crystalline hall) while preserving edit readability, marker selection, and performance.
- [x] **M5.3 Environment picker** — add an Edit-mode environment panel so composers can choose a preset and tune visual intensity without touching stem placement or audio settings.
- [x] **M5.4 Map model and presets** — add composition-level walkable maps with Open, Line, and Y presets, visible lighted ground paths, closed route ends, and Explore-mode movement constraints.
- [x] **M5.5 Composition start point** — each composition stores a start position + facing direction; Edit mode can set or jump to it, and Explore entry begins there.
- [ ] **M5.6 Map shape editor** — replace preset-only maps with editable route geometry: add/move/delete endpoints, branches, widths, and closed boundaries directly in Edit mode.
- [ ] **M5.7 Map-aware stem tools** — snap stems to paths, show distance along branches, warn when stems are outside the walkable area, and provide quick distribute-along-path helpers.
- [ ] **M5.8 Material-aware ambience** — map environment material presets to broad acoustic character (dry/soft → low reflections, stone/glass → brighter/longer reflections) using a conservative global reverb/filter path that can be bypassed.
- [x] **M5.9 Occlusion and obstruction pass** — introduce geometry-aware sound shaping between listener and stems (line-of-sight checks against environment/map obstacles; blocked sounds get softer/darker without breaking timing, with room/tunnel/wall thickness affecting dampening strength).
- [x] **M5.10 Looping space model** — support composition-level spatial tiling (`none`, square, hex, path-loop`) with tile size/origin and compatible map topology so a stem layout can repeat infinitely like the audio loop.
- [x] **M5.11 Tiled map rendering and audio instances** — render nearby visual tiles/map copies and create/cull nearby virtual stem instances around the listener, bounded by adaptive distance/performance limits so infinite space stays cheap.
- [ ] **M5.12 Tiling editor aids** — show tile boundaries, mirrored/ghost map copies, and edge-continuity hints in Edit mode so composers can intentionally make square/hex/path layouts that tile cleanly.
- [ ] **M5.13 Publish/viewer compatibility for maps and environments** — ensure `/c/:id`, `/gallery`, artist pages, export/import, and older manifests all handle environment, map, start, and tiling metadata gracefully.
- [ ] **M5.14 Open-world stitching prototype** — explore streaming/culling multiple artists' spaces into neighborhoods once single-composition maps and tiling work.
- [x] **M5.15 Elevation (the vertical dimension)** — stems drag freely in 3D (gizmo Y unlocked) and branch points carry a height (`map.elevations`), so segments become ramps. The explore player auto-follows the walkable surface, attached rooms inherit their branch point's height, and spatial audio is 3D for free (listener + panners already honor Y).
- [x] **M5.16a AR/Geo movement experiments** — square/hex tiled maps expose optional listener modes: AR Walk lets Three own an Android WebXR AR session for room-scale pose tracking, while Geo Drive watches GPS movement for car-scale exploration. Both feed existing map wrapping/clamping/audio updates.
- [x] **M5.16b Multi-entrance rooms** - support rooms connecting to multiple path segments - or other rooms from arbitrary points in the wall.
- [x] **M5.17 Tunnels** - introduce a new type of path segment: an enclosed tunnel (with sound occlusion).
- [x] **M5.18 Platforms** - large areas of various shapes (rectangle, hex, circle) - like rooms, they can be connected to path segments; but they have no walls or ceilings.
- [x] **M5.19 Doors** - entrances can have doors that slide open - can be openable from one side, or from both sides.
- [x] **M5.20 Standalone walls** - allow composers to create walls in arbitary locations (not necessarily connected to a path segment) to introduce intentional occlusion as part of a composition.

## Milestone 6 — Authored high-fidelity environments

- [x] **M6.1 Environment asset pipeline** — support GLB/GLTF scene kits with compressed geometry/textures, preloading, attribution metadata, and safe fallbacks when assets fail.
- [x] **M6.2 PBR material pipeline** — load authored albedo/normal/roughness/metalness/AO/emissive maps so rock, foliage, crystal, water, and architectural surfaces read as real materials.
- [x] **M6.3 Hero environment prototype** — build one hand-composed AAA-style cavern scene with modular assets, authored lighting, landmarks, and an edit-friendly visibility mode.
- [x] **M6.4 Postprocessing pass** — add a restrained configurable stack for bloom, ambient occlusion, tone mapping, color grading, vignette, and depth fog.
- [x] **M6.5 Runtime optimization pass** — introduce instancing/LOD/culling/texture budgets so high-detail environments stay responsive in the browser.
- [x] **M6.6 Environment authoring workflow** — document how new environment packs are produced, reviewed, optimized, licensed, and wired into composition metadata.

## Polish & fixes

- [ ] **Stem timing offset** — let each stem shift earlier or later by musical intervals such as 1/16, 1/8, 1/4, and 1/2 notes, while keeping all stems synchronized to the shared audio clock and saved in the composition manifest.
- [ ] **Stem direction** — similar to real-world speakers, it should be possible for stems to be unidirectional (current behavior) or to be "pointed" in a direction, with the ability for the user to configure the width and dispersion of the sound.
- [ ] Extending one segment into another should "connect" them (unified bridge point).
