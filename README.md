# Polyphonia

Navigate *through* a musical composition in 3D. Each instrument (stem) lives at
a point in space; as you move, the spatial mix shifts around you — walk toward
the bass and it swells, drift to the center and you hear the full blend.

Polyphonia is a browser-based tool to **explore**, **build**, and **share**
these spatial compositions.

## Features

- **Explore** — first-person movement (WASD + mouse) through a composition;
  realistic 3D audio via the Web Audio API (HRTF panning + distance falloff),
  room-wall occlusion for muffled obstructed stems, room reverb, and every stem
  kept sample-locked in sync. Square/hex tiled maps can also opt into an
  experimental **AR Walk** mode that mirrors mobile WebXR pose movement into
  the composition and turns the listener toward their direction of travel.
- **Immersive spaces** — compositions carry environment metadata and can render
  procedural spaces such as a studio void, cavern, forest clearing, or crystal
  hall; editable path maps can define terminal loop points for corridor-like
  spaces that wrap back on themselves.
- **Edit** — an overhead edit mode to place tracks in space (drag gizmo), and a
  properties panel to rename, recolor, set volume, and tune distance falloff.
- **Build from scratch** — create a new composition (title / BPM, plus an
  artist name for local-only use) and add stems by file picker or
  drag-and-drop; uploads drop into the running loop in time.
- **Local-first** — your work autosaves to the browser (manifests in
  `localStorage`, stem audio in IndexedDB) and survives reloads. Keep a library
  of compositions in a searchable, sortable home grid and switch between them.
- **Portable** — export a composition as a single self-contained
  `.polyphonia.json` (audio embedded) and re-import it anywhere.
- **Share** — publish a composition to the cloud and get a stable read-only link
  (`/c/:id`) anyone can open, with visible audio-loading progress for first
  plays. *(Requires Supabase config — see below.)*
- **Account artist identity** — signed-in accounts keep a primary artist
  profile; new compositions and publishing use that artist automatically.
- **Discover artists** — browse the public gallery or an artist page
  (`/artist/:slug`) to find everything published under a unique artist slug.

## Run

```bash
npm install
npm run dev
```

Open the printed URL, pick a composition (the built-in **Journey** demo is
seeded on first run), and click **Enter**. The app is fully usable offline; only
publishing/sharing needs the optional Supabase setup.

The start screen shows the short Git commit hash that was present when the app
bundle was built, so deployed builds can be identified without manually updating
a version string.

For performance diagnostics, append `?debug=1` to the local URL. This enables a
small overlay and exportable JSON log. Optional A/B flags include
`debugNoPointLights=1`, `debugNoLoopPreview=1`, and `debugNoLoopLights=1`.

### Controls

- **Explore:** `WASD` move · mouse look · click the scene to look · `Esc` frees the cursor.
  On square/hex tiled maps, **AR Walk** can use mobile WebXR pose tracking as the movement source.
- **Edit** (toggle with the button or `Tab`): `WASD` pan · drag to
  orbit/turn · scroll to zoom · click a pillar to select, then drag the gizmo to
  move it. Selected stems show Near/Far rings and a rolloff gradient on the
  ground; the pillar size reflects volume. The Loop panel can audition the seam,
  trim loop start/end, adjust crossfade, or disable looping. The Environment
  panel switches visual presets and ambience.

## Sharing setup (optional)

Sharing uses [Supabase](https://supabase.com) directly from the frontend — no
custom server. In a Supabase project:

1. Create a **public** Storage bucket named `stems`, tables, and policies by
   running the SQL migrations in [`supabase/migrations`](supabase/migrations):

   - `202605300001_initial_sharing.sql` sets up the original sharing schema
     (`compositions` + `stems` bucket).
   - `202605300002_add_artist_identities.sql` adds artist identity, slug routes,
     avatar metadata, and per-artist composition title uniqueness.

   The resulting schema is:

   ```sql
   create table artists (
     id uuid primary key default gen_random_uuid(),
     owner uuid not null references auth.users(id),
     name text not null,
     slug text not null unique,
     avatar_url text,
     avatar_email_hash text,
     created_at timestamptz default now(),
     unique (owner, name)
   );

   create table compositions (
     id text primary key,
     manifest jsonb not null,
     owner uuid not null references auth.users(id),
     artist_id uuid not null references artists(id),
     title text not null,
     title_key text not null,
     artist text not null,
     artist_slug text not null,
     artist_avatar_url text,
     artist_avatar_email_hash text,
     created_at timestamptz default now(),
     unique (artist_id, title_key)
   );
   alter table artists enable row level security;
   alter table compositions enable row level security;

   create policy "public read artists" on artists
     for select to anon, authenticated using (true);
   create policy "owners insert artists" on artists
     for insert to authenticated with check (owner = auth.uid());
   create policy "owners update artists" on artists
     for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

   create policy "public read compositions" on compositions
     for select to anon, authenticated using (true);
   create policy "owners insert compositions" on compositions
     for insert to authenticated with check (owner = auth.uid());
   create policy "owners update compositions" on compositions
     for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
   create policy "owners delete compositions" on compositions
     for delete to authenticated using (owner = auth.uid());

   create policy "public read stems" on storage.objects
     for select to anon, authenticated using (bucket_id = 'stems');
   create policy "owners upload stems" on storage.objects
     for insert to authenticated with check (bucket_id = 'stems');
   create policy "owners update stems" on storage.objects
     for update to authenticated using (bucket_id = 'stems') with check (bucket_id = 'stems');
   create policy "owners delete stems" on storage.objects
     for delete to authenticated using (bucket_id = 'stems');
   ```

2. Copy `.env.example` to `.env.local` and fill in your project URL + anon key
   (the anon key is safe to expose in frontend code), then restart the dev
   server.

When deploying, set the same two env vars in your host's dashboard, and add an
SPA fallback so routes like `/c/:id`, `/gallery`, and `/artist/:slug` serve
`index.html`.

## How it works

- **Engine** ([src/audio/AudioEngine.ts](src/audio/AudioEngine.ts)) — owns one
  `AudioContext`. Every stem is scheduled off the same clock and started
  together (so they never drift); each feeds an HRTF `PannerNode` at its 3D
  position while the camera drives the `AudioListener`. Live setters let edits
  apply without restarting playback; loop buffers are padded/trimmed to a
  shared BPM-aligned musical length to hide MP3 encoder padding and keep every
  stem restarting together.
- **State** ([src/store.ts](src/store.ts)) — a Zustand store is the single source
  of truth: the current composition, the library, mode/selection, and the audio
  engine. The scene renders from it; edits flow back into it and out to the
  engine.
- **Composition** ([src/composition.ts](src/composition.ts)) — a composition is
  just data (tracks = stems + positions + properties, plus environment
  metadata). Its map data can include a path-loop start/end pair; when the
  listener walks past one terminal endpoint, exploration continues from the
  other endpoint with the camera heading rotated into the destination path. The
  explore player also remembers its current path/room support, so overpasses and
  underpasses can share XZ coordinates without snapping the listener to the
  wrong elevation. The engine renders any manifest, which is what lets one demo
  grow into a platform.
- **Persistence** ([src/persistence.ts](src/persistence.ts)) — local-first
  library (localStorage manifests + IndexedDB stem blobs), plus export/import.
- **Cloud** ([src/cloud.ts](src/cloud.ts)) — publish uploads stems to Supabase
  Storage and the manifest to Postgres; the `/c/:id` viewer and artist pages
  fetch public rows back.

## Project layout

```
src/
  audio/        AudioEngine (Web Audio) + procedural placeholder synth
  scene/        React Three Fiber scene: environments, Player, EditControls, gizmo, markers
  ui/           EntryScreen, PropertiesPanel, AddStem, EnvironmentPanel, LoopPanel, PublishControl, Account, Viewer, Gallery, ArtistPage
  artist.ts       artist identity helpers (slugs, artist routes)
  environment.ts  environment presets, materials, and tiling metadata
  composition.ts  types + the built-in "Journey" demo
  store.ts        Zustand store
  persistence.ts  local-first save/load + export/import
  cloud.ts        Supabase publish/fetch
  App.tsx         editor;  main.tsx  routes ( / editor, /c/:id viewer, /gallery, /artist/:slug )
public/stems/   audio for the built-in demo
supabase/migrations/  sharing schema + artist identity migrations
```

## Tech stack

Vite · React · TypeScript · [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) + drei + three · Zustand · Web Audio API · Supabase · React Router.

## Roadmap

See [BACKLOG.md](BACKLOG.md) for what's done and what's next (polish fixes and
richer environments down the line).
