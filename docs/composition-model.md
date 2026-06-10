# Composition Model

**Source:** `src/composition.ts`, `src/environment.ts`, `src/map.ts`

A *composition* is the plain-data manifest the engine renders. Keeping it
decoupled from the engine is the single most important architectural decision:
the editor and viewer use the exact same rendering stack because both produce
a `Composition` object that the scene already knows how to render.

## Top-level shape

```ts
interface Composition {
  id: string;          // stable, never changes after creation
  title: string;
  artist: string;
  artistId?: string;   // cloud identity (slug-stable, display names may collide)
  artistSlug?: string;
  bpm: number;
  beats?: number;      // loop length in beats; absent = infer from stem length
  beatsPerBar?: number; // time-signature numerator (default 4)
  loopEnabled?: boolean;
  loopStart?: number;      // seconds to trim from start of each stem loop
  loopEndTrim?: number;    // seconds to trim from end
  loopCrossfade?: number;  // end-to-start fade inside prepared loop buffers
  loopTail?: boolean;      // fold reverb tails back across the seam
  environment: EnvironmentSettings;
  map: CompositionMap;
  tracks: TrackDef[];
  publishedId?: string;   // present when shared to cloud; cleared on unpublish
  publishedRevision?: string; // fingerprint of last published state
  createdAt?: string;
  updatedAt?: string;
}
```

## Tracks (`TrackDef`)

Each track is one stem placed in 3D space:

```ts
interface TrackDef {
  id: string;           // stable identity — renaming never breaks lookups
  audioAssetId?: string; // shared audio identity — cloned tracks share one file
  name: string;
  color: string;
  position: [number, number, number]; // x, y (elevation), z in world space
  volume?: number;       // max linear gain (default 1)
  minVolume?: number;    // floor gain at maxDistance (default 0)
  source: StemSource;
  refDistance?: number;  // distance where falloff begins
  maxDistance?: number;  // distance where falloff stops
  rolloff?: number;      // falloff sharpness
  loopStart?: number;    // per-stem sub-loop in-point (seconds into source)
  loopEnd?: number;      // per-stem sub-loop out-point
  loopRepeat?: boolean;  // tile short sub-loop to fill composition loop
  offsetBeats?: number;  // coarse timing offset (snaps to beats)
  offsetFineBeats?: number; // fine offset (snaps to 1/16 note)
  directivity?: StemDirectivity; // optional speaker-like cone
  hash?: string;         // SHA-256 of audio file, used for publish dedup
}
```

### Stem sources

```ts
type StemSource =
  | { kind: "synth"; preset: "bass" | "pad" | "arp" | "drums" }
  | { kind: "file"; url: string }
```

`kind: "file"` urls are either:
- Public paths under `/public/stems/` (bundled demo content)
- `blob:` object URLs (user-uploaded audio, loaded from IndexedDB at runtime)
- CDN URLs (fetched from Supabase Storage in viewer mode)

Persistence swaps `blob:` urls to a `{kind:"stored"}` marker before writing to
localStorage. Cloud publishing rewrites them to CDN URLs before writing to
Postgres. Neither storage concern appears in the composition the engine sees.

### Audio asset identity

`audioAssetKey(track)` returns `track.audioAssetId ?? track.id`. When the user
clones a stem to place another spatial instance of the same audio, both tracks
share the same `audioAssetId` so only one audio file is stored and uploaded.

## Environment settings

`EnvironmentSettings` stores only what varies per composition:

```ts
interface EnvironmentSettings {
  pack?: EnvironmentPackSelection;   // optional authored visual layer
  landmarks?: EnvironmentLandmarkPlacement[]; // placed 3D objects
  surfaces?: { floor?: string; wall?: string; ceiling?: string }; // material ids
}
```

The pack registry (`src/environmentPacks.ts`) holds all asset paths, quality
budgets, and postprocessing config. The map remains authoritative for movement
and acoustics; packs are purely visual dressing.

## The composition map

`CompositionMap` is documented in detail in [map-model.md](map-model.md). At
the `Composition` level it is just `composition.map`.

## `normalizeComposition`

Every manifest passes through `normalizeComposition` before use. This function:

- Migrates legacy `bars` field to `beats` (`bars * 4`)
- Fills in `createdAt`/`updatedAt` timestamps
- Calls `normalizeEnvironment` and `normalizeMap` recursively
- Strips unknown fields and corrects invalid values
- Ensures `directivity` vectors are unit-length and within valid ranges

**Always pass incoming manifests through `normalizeComposition` before storing
or rendering them.** Never scatter legacy-compat checks through rendering code.

## `compositionRevision`

`compositionRevision(comp)` returns a short hex fingerprint of the
composition's content (title, artist, BPM, tracks, map, environment) with audio
source URLs normalized away. The engine stores this as `publishedRevision` after
a successful publish so it can detect whether the local state has drifted from
what's on the cloud.

## Default composition

`defaultComposition` ("Journey") is the built-in demo: six stems arranged in a
hexagon at radius ~10, 120 BPM, 64-beat loop. It uses only `kind:"file"` sources
pointing at `/public/stems/Journey_*.mp3`.

## Identity rules

- `id` is a UUID from `newId()` (`src/id.ts`). It never changes and is the
  library key in localStorage.
- `publishedId` is a separate stable UUID assigned on first publish. Re-publishing
  the same composition reuses it, so the share link never changes.
- Cloud identity is `artistId`/`artistSlug`. `artist` (display name) is
  denormalized for viewer/gallery rendering and may change without breaking
  lookups. Never use `artist` as an identity key.
