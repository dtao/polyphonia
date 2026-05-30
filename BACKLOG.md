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
- [ ] **24. Material-aware ambience** — map environment material presets to broad acoustic character (dry/soft → low reflections, stone/glass → brighter/longer reflections) using a conservative global reverb/filter path that can be bypassed.
- [ ] **25. Occlusion and obstruction pass** — introduce simple geometry-aware sound shaping between listener and stems (line-of-sight checks against environment obstacles; blocked sounds get softer/darker without breaking timing).
- [ ] **26. Looping space model** — support composition-level spatial tiling (`none`, square, hex) with tile size/origin so a stem layout can repeat infinitely like the audio loop.
- [ ] **27. Tiled rendering and audio instances** — render nearby visual tiles and create/cull nearby virtual stem instances around the listener, bounded by distance/performance limits so infinite space stays cheap.
- [ ] **28. Tiling editor aids** — show tile boundaries, mirrored/ghost copies, and edge-continuity hints in Edit mode so composers can intentionally make square/hex layouts that tile cleanly.
- [ ] **29. Publish/viewer compatibility for environments** — ensure `/c/:id`, `/gallery`, artist pages, export/import, and older manifests all handle environment and tiling metadata gracefully.
- [ ] **30. Open-world stitching prototype** — explore streaming/culling multiple artists' spaces into neighborhoods once single-composition tiling works.

## Polish & fixes (done along the way)

- [x] Smooth movement (capped pixel ratio); spawn facing forward.
- [x] Single-click entry that locks the pointer immediately; stray clicks inert on the start screen.
- [x] Exit back to the start screen (audio teardown), with edits preserved for re-entry.
- [x] Hide UI chrome during camera control; "Add stem" only in edit mode.
- [x] Billboard track labels so they stay readable from any angle.
- [x] Preserve position across Explore/Edit (altitude shifts, location doesn't); new stems spawn at the view center.
- [x] First high-fidelity environment pass: cavern uses richer procedural geometry, torch/fog/water atmosphere, and a readable first-person opening view.
- [ ] **Choppy mouse-look** — camera *rotation* (mouse-look) in explore mode often feels choppy, while *walking* (WASD translation) stays smooth. Investigate why rotation specifically stutters.
- [x] **Mode cleanup on Exit** — after exiting to the start screen, the mouse still controls the camera. More generally, be consistent about which "mode" we're in and when clicks / mouse movement should take effect.
- [ ] **Turn in Edit mode** — you can move (pan) in edit mode but not turn/rotate the view. Add the ability to turn while keeping the elevated perspective.

**Cross-cutting** (interleave opportunistically): mobile / touch controls, undo / redo, loading & error states.
