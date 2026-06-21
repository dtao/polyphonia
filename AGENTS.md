# AGENTS.md

Orientation for coding agents working on Polyphonia. Read this, then
[README.md](README.md) (product/features) and [BACKLOG.md](BACKLOG.md) (active
roadmap). For a deeper understanding of any subsystem, see the
[docs/](docs/) directory: [architecture-overview.md](docs/architecture-overview.md)
is the entry point, with links to per-system deep-dives covering the composition
model, state/store, audio engine, map model, scene/rendering, persistence/cloud,
editor UX patterns, and how to add new systems.

Keep README product guidance current when behavior changes. Treat BACKLOG as a
forward-looking planning list. Never mark a backlog item complete without the
user's manual verification, even when implementing a requested range of items
autonomously; finish the code and hand off the relevant manual checks while
leaving the checkbox open. Update existing items when priorities change, but do
not add completed implementation notes after the fact. Git history is the record
of changes.

## What this is

A browser app to **explore, build, and share** spatial music: stems (instrument
tracks) are placed in 3D; as you move, the Web Audio mix shifts around you.
Local-first (works fully offline); cloud sharing is opt-in via Supabase.

Stack: Vite · React 18 · TypeScript · React Three Fiber (+ drei, three) ·
Zustand · Web Audio API · Supabase · React Router.

## When to consult the docs

Read the relevant doc **before** starting work in these areas — don't rely on
inferring system behaviour from source alone:

| Working on… | Read first |
|---|---|
| Composition fields, track properties, loop settings, normalization | [composition-model.md](docs/composition-model.md) |
| Zustand store, undo/redo, non-reactive singletons (`viewState`, etc.) | [state-and-store.md](docs/state-and-store.md) |
| Audio (stem parameters, loop behaviour, occlusion, spatialization, tiling) | [audio-engine.md](docs/audio-engine.md) |
| Map objects, movement, elevation, tiling, occlusion geometry | [map-model.md](docs/map-model.md) |
| Scene rendering, materials, fade/pop-in | [scene-and-rendering.md](docs/scene-and-rendering.md) |
| Generated worlds: terrain, scatter, constraint zones, regeneration modes | [generated-environments.md](docs/generated-environments.md) |
| Local persistence, export/import, Supabase publishing | [persistence-and-cloud.md](docs/persistence-and-cloud.md) |
| Editor UI layout, selection model, inspector patterns, direct manipulation | [editing-and-ux-patterns.md](docs/editing-and-ux-patterns.md) |
| Adding any new system: composition field, map object, UI panel, stem param | [adding-a-new-system.md](docs/adding-a-new-system.md) |

## Commands

```bash
npm run dev       # local dev server (Vite)
npm run build     # tsc --noEmit equivalent + vite build  — RUN THIS to verify
npm test          # deterministic unit/business-logic tests (Vitest)
npm run test:watch # watch-mode Vitest while developing logic-heavy changes
npx tsc --noEmit  # type-check only
```

Verify changes with `npm run build` (it type-checks via `tsc`) and, when the
change touches deterministic business logic, `npm test`. Automated tests should
cover stable rules and contracts: normalization/migration, persistence/export
shape, store actions, artist/title identity, and frontend-to-Supabase payloads.
Prefer small Vitest module tests with local fakes over browser automation.

Keep subjective or browser-feel checks manual: audio quality, spatial
perception, camera/pointer-lock feel, visual polish, and "does this experience
feel right?" When you finish a change that affects runtime behavior, hand off a
short "to test" checklist rather than assuming you can fully judge the browser
experience from automation.

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
  Generated terrain, surface materials, and placed objects are visual
  dressing, not movement or acoustic geometry.
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

### Merging

Do not rebase feature branches to integrate them into `main`. A fast-forward or
a real merge commit (`git merge --no-ff`) are both fine — the only firm rule is
to avoid rewriting history with rebase.

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
- **Radial fade (no pop-in):** objects must never blink into existence on the
  horizon. There is ONE camera-centered gradient — two concentric circles
  (`RADIAL_FADE_INNER`/`RADIAL_FADE_OUTER` in `src/scene/fade.ts`): fully visible
  inside the inner circle, fully gone outside the outer, smooth between. Any new
  per-object renderable whose material the scene `<fog>` can't cleanly fade
  (additive/transparent glows, GPU-instanced meshes, point lights, tiled map
  copies) MUST route its opacity/intensity/scale through `radialFade(distance)`
  rather than inventing its own start/end constants — that drift is exactly what
  caused the recurring pop-in. Standard opaque materials respect the scene fog,
  whose far distance is pinned to `RADIAL_FADE_OUTER`, so they fade at the same
  circle for free. Generation and culling are separate lifecycle concerns:
  actual instances may cull at `RADIAL_FADE_OUTER`, but repeated copies admitted
  by a tile/loop anchor must generate beyond it by the maximum object offset
  within the copy plus a movement buffer. Otherwise a newly admitted copy can
  place an object inside the fully visible circle before `radialFade` ever sees
  it. The one deliberate exception is the structural map-copy fade
  (`MAP_COPY_FADE_*` in `Scene.tsx`), which fades a whole tiled copy by anchor
  distance to hide the tiling seam and is coupled to the preview radius, not the
  per-object gradient.
- **Uploaded stems are `blob:` object URLs** (from IndexedDB). They aren't
  serializable and must be revoked on delete (`revokeBlobUrls`). Persistence
  swaps them to `{kind:"stored"}` + IndexedDB; cloud swaps them to public CDN
  URLs.
- **Dev-only debug tools:** `window.polyStore` exposes the store in dev builds.
  `?debug=1` enables the debug overlay/log, with flags such as
  `debugNoPointLights=1`, `debugNoLoopPreview=1`, and `debugNoLoopLights=1`.
  The overlay's Export button embeds the `map` + `generated` params (no audio)
  with the samples, so a debug export is enough to rebuild/scan terrain offline.
- **Driving the editor in preview/headless:** `<App>` (the editor) only mounts
  when a `user` is signed in; otherwise `main.tsx` shows `<PublicLanding>`. To
  exercise the editor without auth (e.g. preview-tool verification), shim a fake
  session in dev:
  `window.polyStore.setState({ user: { id: "dev", email: "dev@local" }, authReady: true })`,
  then `setEntered(true)`. This only unlocks the client view for local testing —
  it does **not** grant backend access (Supabase RLS still gates real
  publish/fetch), so it cannot be used to test sharing.

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
