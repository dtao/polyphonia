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
- [x] **8. New / empty composition** — start screen "new composition" form (title, artist, BPM) drops into edit mode on an empty composition; empty-state hint prompts adding the first stem.
- [x] **9. Loop-point cleanup** — trim MP3 encoder padding by looping `[offset, offset + musical-length]` per source (offset = shared leading silence), so imported stems loop seamlessly.

## Milestone 3 — Persistence (local-first)

- [x] **10. Save / load locally** — versioned JSON manifest in `localStorage` + uploaded stem audio in IndexedDB; autosaves on change, restores on launch.
- [x] **11. Export / import** — download a composition with all stem audio embedded as a single portable `.polyphonia.json`; re-import to load it (stems restored to IndexedDB).
- [x] **12. Composition library** — start-screen chooser to switch, create, duplicate, rename, and delete compositions; persisted as a library (schema v2, migrates the old single slot, seeds the Journey demo).

## Milestone 4 — Backend & shareable URLs

- [x] **13. Backend + storage** — Supabase: uploaded stems → public Storage bucket, manifest → Postgres row; anonymous publish (no custom server, gated by RLS).
- [x] **14. Stable share URLs** — `/c/:id` loads a published composition read-only (React Router + read-only viewer).
- [x] **15. Accounts & ownership** — email magic-link sign-in (Supabase Auth); publishing requires sign-in and ties the composition to the user (`owner` + RLS); "Your published links" manager to copy/unpublish. Editing/playing stays accountless.
- [x] **16. Public gallery** — `/gallery` grid of the 50 most recently published compositions (denormalized `title`/`artist` columns, populated at publish); cards open the read-only `/c/:id` viewer. _Future: an `unlisted` opt-out flag and popularity ranking (visits/shares/votes); search/sort; moderation/report flow._
- [x] **17. Artist pages** — `/artist/:slug` lists the published compositions for that unique artist slug; artist names link there from both the gallery and shared composition viewer, and publishing prevents duplicate titles per artist.
- [x] **18. Supabase migrations** — schema setup lives in `supabase/migrations`: initial sharing plus artist identity/title-uniqueness migration.

## Later — Immersive environments (north star)

- [ ] Replace the abstract space with visually rich environments (caverns, forests, alien worlds).
- [ ] Let the environment's geometry/material shape the sound (reverb, occlusion, distance coloring).
- [ ] Open-world stitching: stream / cull neighborhoods as you traverse between artists' spaces.

## Polish & fixes (done along the way)

- [x] Smooth movement (capped pixel ratio); spawn facing forward.
- [x] Single-click entry that locks the pointer immediately; stray clicks inert on the start screen.
- [x] Exit back to the start screen (audio teardown), with edits preserved for re-entry.
- [x] Hide UI chrome during camera control; "Add stem" only in edit mode.
- [x] Billboard track labels so they stay readable from any angle.
- [x] Preserve position across Explore/Edit (altitude shifts, location doesn't); new stems spawn at the view center.
- [ ] **Choppy mouse-look** — camera *rotation* (mouse-look) in explore mode often feels choppy, while *walking* (WASD translation) stays smooth. Investigate why rotation specifically stutters.
- [x] **Mode cleanup on Exit** — after exiting to the start screen, the mouse still controls the camera. More generally, be consistent about which "mode" we're in and when clicks / mouse movement should take effect.
- [ ] **Turn in Edit mode** — you can move (pan) in edit mode but not turn/rotate the view. Add the ability to turn while keeping the elevated perspective.

**Cross-cutting** (interleave opportunistically): mobile / touch controls, undo / redo, loading & error states.
