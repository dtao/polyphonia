# Architecture Overview

Polyphonia is a browser app for exploring, building, and sharing spatial music.
Stems (instrument tracks) are placed in 3D; as you move through the space the
Web Audio mix shifts around you. The app is local-first — it works fully offline
— and cloud sharing is opt-in via Supabase.

## The central design decision

The most important architectural idea is a clean seam between **data** and
**rendering**:

> A *composition* is plain JSON. The engine/scene renders any normalized
> manifest. The *source* of that manifest is what changes between "local editor"
> and "shared-link viewer."

This means the editor and the viewer are the same rendering stack pointed at
different data sources. The same `<Scene>` renders in both. Cloud sharing,
import/export, and gallery work for free because they all produce a composition
manifest that the engine already knows how to render.

## System map

```
┌──────────────── Data layer ────────────────────┐
│  src/composition.ts   Composition manifest      │
│  src/map.ts           Walkable map + topology   │
│  src/environment.ts   Environment settings      │
└─────────────────────────────────────────────────┘
            ↕  normalizeComposition / normalizeMap
┌──────────────── State hub ─────────────────────┐
│  src/store.ts         Zustand store             │
│    • composition      current manifest          │
│    • library          all saved manifests       │
│    • engine           AudioEngine singleton     │
│    • mode / selected* editor UI state           │
│    • user/auth        cloud identity            │
│    non-reactive module singletons:              │
│    viewState, markerObjects, loopWrap, …        │
└─────────────────────────────────────────────────┘
      ↕ reads              ↕ actions (withHistory)
┌───────────────┐   ┌────────────────────────────┐
│  src/scene/   │   │  src/ui/                   │
│  R3F canvas   │   │  DOM overlays              │
│  Player       │   │  EntryScreen, PropertiesPanel│
│  MapScene     │   │  Inspectors, PublishControl │
│  TrackMarker  │   └────────────────────────────┘
│  ListenerSync │
└───────┬───────┘
        ↓ updateListener()
┌──────────────── Audio layer ───────────────────┐
│  src/audio/AudioEngine.ts                       │
│    ONE AudioContext, stems started together     │
│    HRTF PannerNodes, room reverb, occlusion     │
│    Loop buffers with crossfade                  │
│  src/audio/synth.ts   procedural fallback       │
└─────────────────────────────────────────────────┘
      ↕
┌──────────────── Persistence ───────────────────┐
│  src/persistence.ts   localStorage + IndexedDB │
│  src/cloud.ts         Supabase (opt-in)         │
└─────────────────────────────────────────────────┘
```

## Request path: user moves → audio shifts

1. `<Player>` (R3F component) reads keyboard/touch/AR input each frame.
2. It calls `stepOnMap(map, previous, attempted)` from `src/map.ts` to clamp
   movement to the walkable topology.
3. It writes the new position into `viewState` (a non-reactive module global)
   and updates the R3F camera.
4. `<ListenerSync>` reads the camera each frame and calls
   `engine.updateListener(position, forward, map)`.
5. `AudioEngine.updateListener` moves Web Audio's `AudioListener`, recomputes
   occlusion, adjusts reverb, and updates tiled virtual instances — all without
   restarting any source.

## Request path: user edits a track

1. User drags `<TrackGizmo>` or types in a UI panel.
2. A store action (e.g. `setTrackPosition`) is called.
3. The action calls `withHistory(state, updatedComp)` to push an undo entry and
   update `state.composition`.
4. The action also calls `engine.setPosition(id, position)` — a live setter that
   repositions the panner without restarting playback.
5. React re-renders the affected scene objects. The composition is auto-saved to
   localStorage.

## Routing

`src/main.tsx` owns all routes:

| Path | Component | Auth required |
|---|---|---|
| `/` | `<App>` (editor) or `<PublicLanding>` | depends on `user` |
| `/c/:id` | `<Viewer>` (read-only) | no |
| `/gallery` | `<Gallery>` | yes |
| `/artist/:slug` | `<ArtistPage>` | yes |

## Stack

- **Vite** — build/dev server
- **React 18** — UI and R3F host
- **TypeScript** — throughout
- **React Three Fiber + drei + three.js** — 3D canvas and helpers
- **Zustand** — global state
- **Web Audio API** — all audio; one `AudioContext` per session
- **Supabase** — auth (magic link) + Postgres + Storage; no custom server
- **React Router v6** — client-side routing

## Where to go next

- Data shape: [composition-model.md](composition-model.md)
- State management: [state-and-store.md](state-and-store.md)
- Audio: [audio-engine.md](audio-engine.md)
- Map/movement: [map-model.md](map-model.md)
- Rendering: [scene-and-rendering.md](scene-and-rendering.md)
- Saving and sharing: [persistence-and-cloud.md](persistence-and-cloud.md)
- Editor UX rules: [editing-and-ux-patterns.md](editing-and-ux-patterns.md)
- Adding new features: [adding-a-new-system.md](adding-a-new-system.md)
