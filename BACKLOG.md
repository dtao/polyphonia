# Backlog

This file tracks the build, grouped into milestones. Items are ordered so each
depends only on earlier ones.

## Milestone 1 — Editable in memory ✅

- [x] **1. Mutable audio engine** — live setters for volume / position / falloff; tracks keyed by a stable id.
- [x] **2. Composition store** — Zustand single source of truth; the scene and engine render from it.
- [x] **3. Mode toggle: Explore ↔ Edit** — first-person walk vs. an orbit/edit camera.
- [x] **4. Select a track** — click a pillar to select it (ring highlight).
- [x] **5. Move tracks** — drag a gizmo on the ground plane; the mix updates live.
- [x] **6. Properties panel** — rename, recolor, volume, falloff, delete.

## Milestone 2 — Build a composition from scratch

- [x] **7. Add stems (upload)** — file picker + drag-and-drop; decoded and inserted in sync with the running loop.
- [x] **8. New / empty composition** — start screen "new composition" form (title, BPM, and local-only artist fallback) drops into edit mode on an empty composition; empty-state hint prompts adding the first stem.
- [x] **9. Loop-point cleanup** — trim MP3 encoder padding by looping `[offset, offset + musical-length]` per source (offset = shared leading silence), so imported stems loop seamlessly.

## Milestone 3 — Persistence (local-first)

- [x] **10. Save / load locally** — versioned JSON manifest in `localStorage` + uploaded stem audio in IndexedDB; autosaves on change, restores on launch.
- [x] **11. Export / import** — download a composition with all stem audio embedded as a single portable `.polyphonia.json`; re-import to load it (stems restored to IndexedDB).
- [x] **12. Composition library** — start-screen chooser to switch, create, duplicate, rename, and delete compositions; persisted as a library (schema v2, migrates the old single slot, seeds the Journey demo).

## Milestone 4 — Backend & shareable URLs

- [x] **13. Backend + storage** — Supabase: uploaded stems → public Storage bucket, manifest → Postgres row; signed-in publish (no custom server, gated by RLS).
- [x] **14. Stable share URLs** — `/c/:id` loads a published composition read-only (React Router + read-only viewer).
- [x] **15. Accounts & ownership** — email magic-link sign-in (Supabase Auth); publishing requires sign-in and ties the composition to the user (`owner` + RLS); "Your published links" manager to copy/unpublish. Editing/playing stays accountless.
- [x] **16. Public gallery** — `/gallery` grid of the 50 most recently published compositions (denormalized `title`/`artist` columns, populated at publish); cards open the read-only `/c/:id` viewer. _Future: an `unlisted` opt-out flag and popularity ranking (visits/shares/votes); search/sort; moderation/report flow._
- [x] **17. Artist pages** — `/artist/:slug` lists the published compositions for that unique artist slug; artist names link there from both the gallery and shared composition viewer, and publishing prevents duplicate titles per artist.
- [x] **18. Supabase migrations** — schema setup lives in `supabase/migrations`: initial sharing plus artist identity/title-uniqueness migration.
- [x] **19. Account artist identity** — signed-in accounts load/create a primary artist profile; new compositions and publishing use it automatically instead of treating artist as per-composition metadata.
- [x] **20. Loop seam controls** — Edit mode includes a Loop panel to audition the seam, trim start/end, tune crossfade, and disable looping for long-form compositions.

## Milestone 5 — Immersive environments

- [x] **21. Environment model** — add composition-level environment metadata (`environment.type`, palette/material preset, ambience intensity, optional tiling settings) with persistence/export/publish compatibility and safe defaults for older compositions.
- [x] **22. Visual environment presets** — replace the bare abstract grid with selectable preset spaces (e.g. studio void, cavern, forest clearing, crystalline hall) while preserving edit readability, marker selection, and performance.
- [x] **23. Environment picker** — add an Edit-mode environment panel so composers can choose a preset and tune visual intensity without touching stem placement or audio settings.
- [x] **24. Map model and presets** — add composition-level walkable maps with Open, Line, and Y presets, visible lighted ground paths, closed route ends, and Explore-mode movement constraints.
- [x] **25. Composition start point** — each composition stores a start position + facing direction; Edit mode can set or jump to it, and Explore entry begins there.
- [ ] **26. Map shape editor** — replace preset-only maps with editable route geometry: add/move/delete endpoints, branches, widths, and closed boundaries directly in Edit mode.
- [ ] **27. Map-aware stem tools** — snap stems to paths, show distance along branches, warn when stems are outside the walkable area, and provide quick distribute-along-path helpers.
- [ ] **28. Material-aware ambience** — map environment material presets to broad acoustic character (dry/soft → low reflections, stone/glass → brighter/longer reflections) using a conservative global reverb/filter path that can be bypassed.
- [x] **29. Occlusion and obstruction pass** — introduce simple geometry-aware sound shaping between listener and stems (line-of-sight checks against environment/map obstacles; blocked sounds get softer/darker without breaking timing).
- [x] **30. Looping space model** — support composition-level spatial tiling (`none`, square, hex, path-loop`) with tile size/origin and compatible map topology so a stem layout can repeat infinitely like the audio loop.
  - First path-loop slice: terminal route points can be marked as loop start/end, and Explore wraps between them while preserving corridor-relative heading.
  - Continuity preview slice: when the listener nears a loop endpoint, render the destination map/tracks as an adjacent transformed copy before the coordinate wrap happens.
  - Formal tiling slice: map manifests now store `none`/`path-loop`/`square`/`hex` tiling metadata, Map panel controls and validation edit that model, and persistence/export/import/publish paths normalize older manifests safely.
- [x] **31. Tiled map rendering and audio instances** — render nearby visual tiles/map copies and create/cull nearby virtual stem instances around the listener, bounded by distance/performance limits so infinite space stays cheap.
  - First audio slice: virtual square/hex/path-loop tile copies now drive stem spatialization by choosing the nearest audible copy around the listener.
  - Virtual instance slice: each stem can feed up to four nearby tiled panners, with quiet fade-out/culling as copies leave range.
- [ ] **32. Tiling editor aids** — show tile boundaries, mirrored/ghost map copies, and edge-continuity hints in Edit mode so composers can intentionally make square/hex/path layouts that tile cleanly.
  - First boundary slice: square/hex tile outlines render subtly around the viewer in both Edit and Explore modes.
- [ ] **33. Publish/viewer compatibility for maps and environments** — ensure `/c/:id`, `/gallery`, artist pages, export/import, and older manifests all handle environment, map, start, and tiling metadata gracefully.
- [ ] **34. Open-world stitching prototype** — explore streaming/culling multiple artists' spaces into neighborhoods once single-composition maps and tiling work.

## Milestone 6 — Authored high-fidelity environments

- [ ] **35. Environment asset pipeline** — support GLB/GLTF scene kits with compressed geometry/textures, preloading, attribution metadata, and safe fallbacks when assets fail.
- [ ] **36. PBR material pipeline** — load authored albedo/normal/roughness/metalness/AO/emissive maps so rock, foliage, crystal, water, and architectural surfaces read as real materials.
- [ ] **37. Hero environment prototype** — build one hand-composed AAA-style cavern scene with modular assets, authored lighting, landmarks, and an edit-friendly visibility mode.
- [ ] **38. Postprocessing pass** — add a restrained configurable stack for bloom, ambient occlusion, tone mapping, color grading, vignette, and depth fog.
- [ ] **39. Runtime optimization pass** — introduce instancing/LOD/culling/texture budgets so high-detail environments stay responsive in the browser.
- [ ] **40. Environment authoring workflow** — document how new environment packs are produced, reviewed, optimized, licensed, and wired into composition metadata.

## Polish & fixes (done along the way)

- [x] Smooth movement (capped pixel ratio); spawn facing forward.
- [x] Single-click entry that locks the pointer immediately; stray clicks inert on the start screen.
- [x] Exit back to the start screen (audio teardown), with edits preserved for re-entry.
- [x] Hide UI chrome during camera control; "Add stem" only in edit mode.
- [x] Billboard track labels so they stay readable from any angle.
- [x] Preserve position across Explore/Edit (altitude shifts, location doesn't); new stems spawn at the view center.
- [x] First high-fidelity environment pass: cavern uses richer procedural geometry, torch/fog/water atmosphere, and a readable first-person opening view.
- [x] Home library scales to larger collections with a responsive composition grid, search, and sorting controls.
- [x] **Choppy mouse-look** — replaced event-immediate pointer-lock rotation with frame-smoothed look targets, with raw pointer movement requested when available.
- [x] **Mode cleanup on Exit** — after exiting to the start screen, the mouse still controls the camera. More generally, be consistent about which "mode" we're in and when clicks / mouse movement should take effect.
- [ ] **Turn in Edit mode** — you can move (pan) in edit mode but not turn/rotate the view. Add the ability to turn while keeping the elevated perspective.
- [x] **Duplicate stems** — allow composers to duplicate an existing stem, preserving audio, color, volume, falloff, and spatial settings while giving the copy a new id/name and an editable position.
- [x] **Undo / redo** — support reversing and reapplying the most recent editing action, with clear behavior for stem add/delete/move, property changes, environment edits, loop edits, and composition metadata changes.
- [x] **BPM-aligned loop buffers** — pad/trim uploaded stems to a shared BPM-derived loop duration so all stems restart together on every loop.
- [ ] **Stem timing offset** — let each stem shift earlier or later by musical intervals such as 1/16, 1/8, 1/4, and 1/2 notes, while keeping all stems synchronized to the shared audio clock and saved in the composition manifest.
- [ ] **Stem direction** — similar to real-world speakers, it should be possible for stems to be unidirectional (current behavior) or to be "pointed" in a direction, with the ability for the user to configure the width and dispersion of the sound.
- [x] Paths have "gaps" at bridge points where floor isn't filled in.
- [x] Stem names should not be visible in Explore mode (only in Edit mode).
- [x] Lights stop pulsing (until browser refresh) after switching to Edit mode.
- [x] Locations of light points do not update (until browser refresh) after moving stems in Edit mode.
- [ ] Extending one segment into another should "connect" them (unified bridge point).
- [x] Add keyboard shortcuts for common actions: add/delete stem, duplicate stem, add/delete bridge point
- [x] Too difficult to select branch point that's already connected to 2 segments: often one of the segments gets selected instead.
- [x] Rooms attach to terminal branch points instead of acting as independently movable path objects.
- [x] Room interiors add size-based reverb while preserving stem sync.
- [x] Map button and panel are always over Environment panel - only one should be open at a time.
- [x] Vertical margin is inconsistent between "Add stem", "Environment", and "Map" buttons.

**Cross-cutting** (interleave opportunistically): mobile / touch controls, loading & error states.
