# AGENTS.md

Orientation for coding agents working on Polyphonia. Read this, then
[README.md](README.md) (product/features) and [BACKLOG.md](BACKLOG.md) (active
roadmap). Keep README product guidance current when behavior changes. Treat
BACKLOG as a forward-looking planning list: update existing relevant checkboxes
when roadmap work is completed or priorities change, but do not add completed
implementation notes after the fact. Git history is the record of changes.

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
  stems + 3D position + properties, plus loop, environment-pack, map,
  start-position, elevation, and tiling metadata. The engine/scene render any
  normalized manifest. This is why "one demo" scales to "a platform."
- **State hub:** `src/store.ts` — a Zustand store is the single source of truth
  (current `composition`, `library`, `mode`, `selectedId`, `engine`, `user`,
  `accountArtist`, `entered`, `viewer`, all editor selections, and undo/redo
  stacks). The scene renders from it; edits flow back into it and out to the
  engine. It also owns **non-reactive module singletons** for frame-sensitive
  state: `markerObjects`, `viewState`, `loopWrap`, `touchMove`, `arWalk`, and
  `geoWalk`.
- **Audio:** `src/audio/AudioEngine.ts` — owns ONE `AudioContext`. All stems are
  scheduled off the same clock and started together so they never drift; each
  feeds one or more HRTF `PannerNode` instances while the camera drives the
  `AudioListener`. It also applies adaptive audio quality, room reverb,
  thickness-aware room/tunnel/door/wall occlusion, and square/hex/path-loop
  virtual audio instances. See gotchas below. `src/audio/synth.ts` is the
  procedural fallback.
- **Scene (R3F):** `src/scene/` — `Scene` composes the runtime and tiled
  previews; `EnvironmentScene` renders the neutral base while
  `AuthoredEnvironmentScene` and `DetailMapDressing` add optional authored
  packs; `EnvironmentEffects` owns pack-aware postprocessing; `MapScene`
  renders and edits paths, tunnels, rooms, entrances/doors, platforms, walls,
  the start marker, elevations, and tile boundaries. `Player` handles keyboard,
  touch, AR, and geo movement while preserving map support and loop wrapping.
  `EditControls`, `TrackGizmo`, and `TrackMarker` provide editing;
  `ListenerSync` drives audio; `DebugSampler` captures diagnostics.
- **Environment packs:** `src/environment.ts` stores only the selected pack,
  variant, and quality. `src/environmentPacks.ts` is the runtime registry for
  assets, profiles, quality budgets, attribution, and postprocessing. The map
  remains authoritative for movement and acoustics; packs dress it.
- **Map model:** `src/map.ts` defines path/tunnel segments, shared branch points
  and elevations, rooms with multiple entrances and optional doors, open
  platforms, standalone acoustic walls, start position/facing, support-aware
  movement, collision/occlusion geometry, and
  `none`/`path-loop`/`square`/`hex` tiling.
- **UI (DOM overlays):** `src/ui/` — `EntryScreen` (start screen: library
  chooser, new/export/import, sign-in, gallery link), `PropertiesPanel`,
  `AddStem`, composition-level Environment/Map/Loop panels, and contextual
  inspectors for map points, segments, rooms, entrances, platforms, and walls.
  `ARWalkControls`, `GeoWalkControls`, and `TouchControls` provide alternate
  Explore inputs. Sharing surfaces are `PublishControl`, `Account`, `Viewer`,
  `Gallery`, and `ArtistPage`.
- **Persistence (local-first):** `src/persistence.ts` — composition manifests in
  `localStorage` (a *library*, schema v2, with migration from the old single
  slot); uploaded stem audio in **IndexedDB** (localStorage can't hold audio).
  Also export/import of a self-contained `.polyphonia.json`.
- **Cloud:** `src/cloud.ts` — Supabase auth (email magic link), account artist
  load/create, publish (uploads stems to Storage, manifest to Postgres), fetch,
  unpublish, gallery list, artist page list. No custom server — RLS does the
  gating. DB schema lives in `supabase/migrations`.
- **Diagnostics:** `src/debug.ts`, `src/scene/DebugSampler.tsx`, and
  `src/ui/DebugPanel.tsx` implement URL-controlled A/B flags, runtime sampling,
  and JSON export. Dev builds also expose `window.polyStore`.
- **Compatibility boundary:** older manifests are normalized through
  `normalizeComposition`, `normalizeEnvironment`, and `normalizeMap`. Keep
  backward-compatible defaults there instead of scattering legacy checks
  through rendering and audio code.
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

## Editor UX conventions

- **Composition controls live at the top left.** Reserve that area for settings
  that affect the composition as a whole, currently Environment, Map, and Loop.
  Add new composition-level configuration to that stack/drawer pattern rather
  than introducing another floating location.
- **Selected-object inspectors live at the bottom left.** Stems, path points,
  path segments, rooms, entrances, platforms, and walls are selected directly
  in the 3D view and expose one contextual inspector in the same bottom-left
  slot. Selection is mutually exclusive; selecting one object clears the
  others. Clicking empty canvas or pressing Escape clears the selection.
- **Direct manipulation comes first.** Move spatial objects in the map view,
  with inspectors reserved for properties and actions. Use the established
  affordance for each object: a transform gizmo for stems and detached
  rooms/platforms, shared endpoint handles for paths, doorway handles for
  entrances, endpoint handles for walls, and move/rotate modes for the start
  marker. Keep camera controls disabled while dragging.
- **Connectivity is visible behavior, not just metadata.** A path is a
  centerline segment plus width; coincident endpoints are one logical branch
  point. Joints can grow more branches. Terminal points can grow a branch or
  become an attached room/platform; path-loop endpoints must also be terminal
  and unattached. Tunnels are enclosed path segments, not a separate movement
  system.
- **Rooms and platforms are destinations in the same path graph.** Rooms are
  enclosed, may have multiple entrances, and may have sliding doors. Platforms
  are open walkable areas. Both can attach to terminal path points, and paths
  can grow outward from room entrances or platform edges. Moving connected
  structures should preserve connections and shared elevation; moving an
  attached room/platform independently requires deliberate detachment.
- **Walkability and acoustics are related but distinct.** Paths, rooms, and
  platforms define where the listener can move. Room/tunnel/door geometry and
  standalone walls shape occlusion; standalone walls do not block movement.
  Authored packs are visual dressing, not movement or acoustic geometry.
- **Preserve editing context.** Select new objects immediately, and have growth
  actions select the new endpoint/object so the next likely action is ready.
  Map edits remain undoable and older manifests must normalize into valid
  topology.

## Bug investigation escalation

If two attempted fixes have not resolved the same bug, stop making speculative
patches and turn the next step into an investigation:

1. Create or update `docs/investigations/<bug-name>.md` with the symptom,
   reproduction conditions, attempts made, observed evidence, current
   hypotheses, and next discriminating checks. Include relevant device,
   browser, map/environment, and composition details.
2. Add a narrowly scoped debug option when the suspected subsystem can be
   isolated or measured by the user. Prefer URL flags using `debugFlag` /
   `debugValue`, samples in the `?debug=1` export, or another reversible
   diagnostic that does not change normal behavior.
3. Hand the user a short troubleshooting checklist stating exactly which
   flags/build to run and which observations or exported data to return.

The investigation note is not a substitute for fixing an understood bug. Resume
implementation once evidence distinguishes the likely causes, and keep the
investigation document current with the result.

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
environment pipeline. Use it to track remaining work, not as a changelog.
