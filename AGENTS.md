# AGENTS.md

Orientation for coding agents working on Polyphonia. Read this, then
[README.md](README.md) (product/features) and [BACKLOG.md](BACKLOG.md) (roadmap +
what's done). Keep both updated as you work.

## What this is

A browser app to **explore, build, and share** spatial music: stems (instrument
tracks) are placed in 3D; as you move, the Web Audio mix shifts around you.
Local-first (works fully offline); cloud sharing is opt-in via Supabase.

Stack: Vite · React 18 · TypeScript · React Three Fiber (+ drei, three) ·
Zustand · Web Audio API · Supabase · React Router.

## Commands

```bash
npm run dev       # local dev server (Vite)
npm run build     # tsc --noEmit equivalent + vite build  — RUN THIS to verify
npx tsc --noEmit  # type-check only
```

**There is no automated test suite.** Verify changes with `npm run build` (it
type-checks via `tsc`) and by reasoning through behavior. The maintainer prefers
to **test runtime behavior manually** — when you finish a change, hand off a
short "to test" checklist rather than assuming you can drive the browser. Don't
add a test framework unless asked.

## Architecture & key files

- **The seam:** a *composition* is plain data (`src/composition.ts`) — tracks =
  stems + 3D position + properties, plus environment, map, start-position, and
  tiling metadata. The engine/scene render any manifest. This is why "one demo"
  scales to "a platform."
- **State hub:** `src/store.ts` — a Zustand store is the single source of truth
  (current `composition`, `library`, `mode`, `selectedId`, `engine`, `user`,
  `accountArtist`, `entered`, `viewer`, map/room/start selections, undo/redo
  stacks). The scene renders from it; edits flow back into it and out to the
  engine. Also holds two **non-reactive module
  singletons** to avoid per-frame re-renders: `markerObjects` (id → 3D object,
  for the move gizmo) and `viewState` (`{x,z,fx,fz}` shared camera
  position+heading across modes).
- **Audio:** `src/audio/AudioEngine.ts` — owns ONE `AudioContext`. All stems are
  scheduled off the same clock and started together so they never drift; each
  feeds one or more HRTF `PannerNode` instances while the camera drives the
  `AudioListener`. It also applies room reverb, room-wall occlusion, and
  square/hex/path-loop virtual audio instances. See gotchas below.
  `src/audio/synth.ts` is a procedural placeholder generator (fallback; the live
  demo uses real files in `public/stems`).
- **Scene (R3F):** `src/scene/` — `Scene` (composes it), `EnvironmentScene`
  (procedural void/studio/cavern/forest/crystal/galaxy presets), `MapScene`
  (walkable paths, endpoints, rooms, start marker, tile boundaries/previews),
  `Player` (explore: WASD + pointer-lock look, map clamping and path-loop
  wrapping), `EditControls` (orbit/pan/turn camera), `TrackGizmo`
  (drag-to-move selected track or map start), `TrackMarker` (pillar + billboard
  label; selected edit-mode marker also shows Near/Far rings, rolloff gradient,
  and volume-scaled pillar), `ListenerSync` (drives the AudioListener in both
  modes), `DebugSampler` (dev performance/audio/map samples).
- **UI (DOM overlays):** `src/ui/` — `EntryScreen` (start screen: library
  chooser, new/export/import, sign-in, gallery link), `PropertiesPanel`,
  `AddStem`, `EnvironmentPanel` (preset + ambience picker), `LoopPanel`
  (composition loop on/off, seam audition, trim, crossfade), `MapPanel`,
  `MapPointPanel`, `MapSegmentPanel`, `RoomPanel`, `DebugPanel`,
  `PublishControl`, `Account` (auth + account artist), `Viewer` (read-only
  `/c/:id`), `Gallery` (`/gallery`), `ArtistPage` (`/artist/:slug`).
- **Persistence (local-first):** `src/persistence.ts` — composition manifests in
  `localStorage` (a *library*, schema v2, with migration from the old single
  slot); uploaded stem audio in **IndexedDB** (localStorage can't hold audio).
  Also export/import of a self-contained `.polyphonia.json`.
- **Cloud:** `src/cloud.ts` — Supabase auth (email magic link), account artist
  load/create, publish (uploads stems to Storage, manifest to Postgres), fetch,
  unpublish, gallery list, artist page list. No custom server — RLS does the
  gating. DB schema lives in `supabase/migrations`.
- **Environments and maps:** `src/environment.ts` defines visual/acoustic
  ambience presets. `src/map.ts` defines walkable paths, attached rooms, start
  position/facing, and tiling (`none`, `path-loop`, `square`, `hex`). Older
  manifests are normalized through `normalizeComposition`, `normalizeEnvironment`,
  and `normalizeMap` so missing fields get safe defaults.
- **Routing:** `src/main.tsx` — `/` editor (`App`), `/c/:id` viewer, `/gallery`,
  `/artist/:slug`. StrictMode is intentionally OFF (see gotchas).

## Conventions

- TypeScript throughout; functional components; inline `React.CSSProperties`
  style objects (no CSS framework).
- Commit messages should follow the house style in recent history (e.g.
  `9d23d5b`): imperative subject line, one concise explanatory paragraph, then
  focused bullets for user-visible behavior, key implementation points, and
  fixes/edge cases when useful. Adhere to an 80-character line limit (wrapping
  is okay). Include "Co-Authored-By" line specifying model (e.g. Opus 4.8,
  GPT 5.5).
- Keep the runtime composition model clean: persistence/cloud do their own
  (de)serialization (e.g. `{kind:"stored"}` markers, `publishedId`, `hash`) —
  don't leak storage concerns into the engine/scene.
- Artist display names are not identity. Cloud identity is `artistId` +
  `artistSlug`; URLs use `/artist/:slug`, while compositions keep denormalized
  artist fields for gallery/viewer rendering. Signed-in accounts use the first
  owned artist as `accountArtist`; new compositions and publishing should prefer
  that identity over a per-composition artist string.
- New track ids / composition ids come from `src/id.ts` (`newId`).
- Edits that affect audio go through store actions that also call the engine's
  live setters (`setVolume`/`setPosition`/`setFalloff`) — never restart playback
  to apply an edit.
- Composition edits that should be reversible go through store actions with
  history (`withHistory`/`undo`/`redo`). Keep map, room, environment, loop,
  metadata, and stem edits in that path unless there is a deliberate reason not
  to.

### Commit message mechanics

When creating commits, do not use one `git commit -m` flag per bullet. Git
inserts a blank line between each `-m` paragraph, which makes bullet lists
double-spaced.

Prefer composing the full message as a temporary file and committing with:

```bash
git commit -F /tmp/polyphonia-commit-msg.txt
```

## Gotchas (hard-won — read before touching these areas)

- **Audio sync:** never start stems independently. Use the engine's
  start/`addLiveTrack` paths, which schedule off the shared clock. `addLiveTrack`
  phase-aligns a new stem to the running loop. Loop points are trimmed to the
  musical length (`bars`) and copied into prepared loop buffers with a tiny
  end→start crossfade to hide **MP3 encoder padding** — see
  `prepareLoopBuffer`/`leadingSilence`. Composition-level loop controls
  (`loopEnabled`, `loopStart`, `loopEndTrim`, `loopCrossfade`) live on the
  manifest; keep them applied through `AudioEngine.updateLoopSettings` so live
  playback and saved data stay aligned.
- **Map-aware audio:** listener updates pass the current `CompositionMap` into
  the engine. Room-wall obstruction, room reverb, and virtual tiled stem
  instances depend on that map, so keep map normalization and audio listener
  updates in sync when changing path/room/tiling behavior.
- **Map movement:** Explore movement is clamped to the walkable map and
  path-loop tiling can wrap the listener between terminal endpoints while
  preserving corridor-relative heading. Composition start position/facing lives
  under `composition.map.start`; use `moveViewToMapStart` when entering or
  switching compositions.
- **Pointer lock:** drei `PointerLockControls` locks on click of its `selector`
  element. We scope it to `"canvas"` after entry (so clicking UI buttons doesn't
  grab the pointer) and to `"#enter-btn"` before entry (so the entry click both
  starts audio and locks in one gesture). Changing this is fiddly — test the
  entry, Exit, and button clicks.
- **StrictMode is OFF** (`main.tsx`): its dev double-mount duplicates
  pointer-lock listeners and rebuilds the AudioContext. Don't re-enable it.
- **Canvas `dpr` capped to `[1,1.5]`** for frame rate on Retina. Don't remove.
- **Uploaded stems are `blob:` object URLs** (from IndexedDB). They aren't
  serializable and must be revoked on delete (`revokeBlobUrls`). Persistence
  swaps them to `{kind:"stored"}` + IndexedDB; cloud swaps them to public CDN
  URLs.
- **Dev-only debug tools:** `window.polyStore` exposes the store in dev builds.
  `?debug=1` enables the debug overlay/log, with flags such as
  `debugNoPointLights=1`, `debugNoLoopPreview=1`, and `debugNoLoopLights=1`.

## Sharing / Supabase (the #1 source of confusing errors)

Sharing needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `.env.local`
(see `.env.example`). **Vite inlines `VITE_*` at build time**, so set them in the
host dashboard for deployed builds. Magic-link sign-in requires the app origin
to be in Supabase Auth → URL Configuration → Redirect URLs.

Backend = a public Storage bucket `stems` + `artists` and `compositions` tables.
The source of truth for setup is `supabase/migrations`:
- `202605300001_initial_sharing.sql` creates `stems`, `compositions`, and the
  initial sharing/storage policies.
- `202605300002_add_artist_identities.sql` creates `artists`, backfills
  `artist_id`/`artist_slug`, adds `title_key`, and enforces unique composition
  titles per artist.

Title/artist metadata lives in both the manifest (canonical for the viewer) and
denormalized columns (for gallery/artist pages). The publish id is an opaque
UUID, not the title.

**"new row violates row-level security policy"** almost always means a missing
RLS policy, not a code bug. Required policies:
- `artists`: public `select`; `insert`/`update` for the authenticated owner
  (`owner = auth.uid()`).
- `compositions`: public `select`; `insert`/`update`/`delete` for the
  `authenticated` owner (`owner = auth.uid()`).
- `storage.objects` (bucket `stems`): public `select`; `insert`/`update`/`delete`
  for `authenticated` (update is needed because re-publish overwrites stems via
  `upsert`). Full SQL is in `supabase/migrations`.
- Creating `storage.objects` policies via the SQL editor can fail with "must be
  owner of table objects" — use the Storage → Policies dashboard UI instead.

Publish reuses a stable `publishedId` (so re-publishing keeps the same link) and
**skips re-uploading stems whose SHA-256 is unchanged** (`hash` in the manifest).

## Deployment

Netlify (config in `netlify.toml`; SPA fallback in `public/_redirects` so
`/c/:id`, `/gallery`, and `/artist/:slug` deep-links resolve). Set the two
`VITE_*` env vars in the Netlify dashboard for Git-based builds.

## Where to look next

`BACKLOG.md` — M1–M4 are done and Milestone 5 is partially complete. Remaining:
map-shape editing, map-aware stem tools, material-aware ambience, tiling editor
aids, publish/viewer compatibility sweeps, and the later high-fidelity
environment pipeline. Update the checkboxes as you complete items.
