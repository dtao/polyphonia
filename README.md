# Polyphonia

Navigate *through* a musical composition in 3D. Each instrument (stem) lives at
a point in space; as you move, the spatial mix shifts around you — walk toward
the bass and it swells, drift to the center and you hear the full blend.

Polyphonia is a browser-based tool to **explore**, **build**, and **share**
these spatial compositions.

## Features

- **Explore** — first-person movement (WASD + mouse) through a composition;
  realistic 3D audio via the Web Audio API (HRTF panning on capable devices,
  adaptive lower-cost panning on mobile/low-power devices, plus distance
  falloff), thickness-aware room/tunnel/wall occlusion for muffled obstructed
  stems, room reverb, and
  every stem kept sample-locked in sync. Square/hex tiled maps can also opt into
  experimental movement modes: **AR Walk** uses Android WebXR pose tracking for
  room-scale walking, while **Geo Drive** uses GPS movement at 100 ft per unit
  for car-scale exploration.
- **Immersive spaces** — every composition starts from the same neutral visual
  space and can optionally select an authored detail pack at an automatic, low,
  or high quality tier. Atlas Cavern, Verdant Grove, and Prismatic Reach dress
  existing paths, ramps, tunnels, rooms, platforms, and standalone walls with
  modular GLTF landmarks and aligned PBR textures without replacing the map
  used for movement or acoustics. High-quality mode adds restrained bloom,
  ambient occlusion, tone mapping, vignette, and shadowed authored lighting;
  automatic low quality keeps the dressing while reducing repeated assets and
  expensive effects. Creators can also import reusable PBR materials and
  self-contained GLB landmarks separately, assign different materials to
  floors/walls/ceilings, place models directly, and carry those assets through
  export or cloud publishing. Placed landmarks remain in the composition when
  switching detail packs and repeat continuously across tiled or path-loop
  maps. A full detail pack is optional.
  Editable path maps can define terminal loop points for corridor-like
  spaces that wrap back on themselves. Path segments can be marked as enclosed
  **tunnels** whose walls and ceiling muffle sound passing in or out the sides,
  and open **platforms** (rectangle, hex, or circle) attach to a terminal path
  point — like rooms — to add wide walkable areas. Room doorways can
  carry sliding **doors** that open as you approach (from either side or just
  one), blocking movement and muffling sound while shut, and free-standing
  **walls** can be placed
  anywhere to shape occlusion deliberately. Rooms, tunnels, and walls expose
  wall thickness controls, so thin barriers lightly darken sound while thick
  barriers heavily damp it.
- **Edit** — an overhead edit mode to place tracks in space (drag gizmo), and a
  properties panel to rename, recolor, set volume, and tune distance falloff.
- **Build from scratch** — create a new composition (title / BPM, plus an
  artist name for local-only use) and add stems by file picker or
  drag-and-drop; uploads drop into the running loop in time.
- **Local-first** — your work autosaves to the browser (manifests in
  `localStorage`, stem audio and creator environment assets in IndexedDB) and
  survives reloads. Keep a library of compositions in a searchable, sortable
  home grid and switch between them.
- **Portable** — export a composition as a single self-contained
  `.polyphonia.json` (audio, custom packs, and every referenced creator asset
  embedded) and re-import it anywhere. Cloned spatial instances share one
  embedded audio asset rather than multiplying the file size.
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

High-fidelity environment production is documented in
[`docs/environment-authoring.md`](docs/environment-authoring.md).
For ready-to-import free assets and supported formats, see
[`docs/creator-assets.md`](docs/creator-assets.md).

For performance diagnostics, append `?debug=1` to the local URL. This enables a
small overlay and exportable JSON log. Optional A/B flags include
`debugNoPointLights=1`, `debugNoLoopPreview=1`, `debugNoLoopLights=1`, and
the orb-layer switches `debugNoFlare=1` and `debugNoStarRays=1`.
Audio quality can be A/B tested with `audioQuality=full` or
`audioQuality=reduced`.

### Controls

- **Explore:** `WASD` move · mouse look · click the scene to look · `Esc` frees the cursor.
  On square/hex tiled maps, **AR Walk** can use Android WebXR pose tracking as the movement source; it renders the Polyphonia environment (not the live camera passthrough) so the space is fully immersive while you physically walk. **Geo Drive** uses device GPS as the movement source for driving; movement direction sets listener facing, and 100 real-world feet maps to 1 Polyphonia unit.
- **Edit** (toggle with the button or `Tab`): `WASD` pan · `Q`/`E` lower/raise
  elevation · drag to orbit/turn · scroll to zoom · click a pillar to select, then drag the gizmo to
  move it. Selected stems show Near/Far rings and a rolloff gradient on the
  ground; the pillar size reflects volume. The Loop panel can audition the seam,
  trim loop start/end, adjust crossfade, or disable looping. The Environment
  panel selects optional detail packs, imports materials/models, assigns map
  surfaces, and places landmarks. Selected walls use the same three-axis move
  gizmo as stems, with endpoint handles for reshaping. Selected path points use
  that three-axis gizmo too, moving connected branches in X/Z and setting ramp
  elevation on Y.

## Sharing setup (optional)

Sharing uses [Supabase](https://supabase.com) directly from the frontend — no
custom server. In a Supabase project:

1. Create the public Storage buckets, tables, and policies by running the SQL
   migrations in [`supabase/migrations`](supabase/migrations):

   - `202605300001_initial_sharing.sql` sets up the original sharing schema
     (`compositions` + `stems` bucket).
   - `202605300002_add_artist_identities.sql` adds artist identity, slug routes,
     avatar metadata, and per-artist composition title uniqueness.
   - `202606060001_custom_detail_packs.sql` adds immutable creator pack
     manifests and the public `environment-assets` bucket.
   - `202606060002_creator_assets.sql` adds independently reusable material and
     landmark manifests.

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
  together (so they never drift); each feeds a spatial `PannerNode` at its 3D
  position while the camera drives the `AudioListener`. Mobile/low-power
  devices use a reduced-cost path with a larger playback buffer, cheaper
  panning, fewer virtual tiled instances, and throttled acoustic updates to
  avoid crackle from audio underruns. Live setters let edits apply without
  restarting playback; loop buffers are padded/trimmed to a shared BPM-aligned
  musical length to hide MP3 encoder padding and keep every stem restarting
  together.
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
  library (localStorage manifests + deduplicated IndexedDB stem blobs), plus
  export/import. Multiple cloned tracks can independently place and mix one
  shared audio asset.
- **Cloud** ([src/cloud.ts](src/cloud.ts)) — publish uploads stems to Supabase
  Storage and the manifest to Postgres; the `/c/:id` viewer and artist pages
  fetch public rows back.

## Project layout

```
src/
  audio/        AudioEngine (Web Audio) + procedural placeholder synth
  scene/        React Three Fiber scene: detail packs, Player, EditControls, gizmo, markers
  ui/           EntryScreen, PropertiesPanel, AddStem, EnvironmentPanel, LoopPanel, PublishControl, Account, Viewer, Gallery, ArtistPage
  artist.ts       artist identity helpers (slugs, artist routes)
  environment.ts  optional detail-pack, surface-material, and landmark metadata
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
