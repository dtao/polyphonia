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
- [ ] **8. New / empty composition** — create a composition from scratch with title, artist, and BPM; add tracks to it; empty-state UX.
- [ ] **9. Loop-point cleanup** — set `loopStart` / `loopEnd` on sources to trim MP3 encoder padding so imported stems loop seamlessly.

## Milestone 3 — Persistence (local-first)

- [ ] **10. Save / load locally** — serialize to versioned JSON; autosave to `localStorage`; restore on launch.
- [ ] **11. Export / import** — download a composition (+ its stems) as a bundle and re-import it.
- [ ] **12. Composition library** — create, duplicate, rename, delete, and switch between compositions.

## Milestone 4 — Backend & shareable URLs

- [ ] **13. Backend + storage** — stems to object storage (S3 / Cloudflare R2 + CDN), manifests to a database; replace in-memory stems with an upload flow.
- [ ] **14. Stable share URLs** — `/c/:id` loads any composition (read-only).
- [ ] **15. Accounts & ownership** — light auth so people edit only their own work and links are safe to share.
- [ ] **16. Public gallery** — browse and open compositions others have shared.

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

**Cross-cutting** (interleave opportunistically): mobile / touch controls, undo / redo, loading & error states.
