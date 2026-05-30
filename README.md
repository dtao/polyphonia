# Polyphonia

Navigate *through* a musical composition in 3D. Each instrument (stem) lives at
a point in space; as you move, the spatial mix shifts around you.

This is the **Phase 0 spike** — it proves the core experience: multiple stems,
kept in perfect sync, spatialized with the Web Audio API as you walk around.

## Run

```bash
npm install
npm run dev
```

Open the printed URL, click **Enter** (browsers require a gesture before audio),
then **WASD** to move and the **mouse** to look. Walk into a corner and that
instrument dominates; stand in the center and you hear the full blend.

## How it works

- **Sync** — every stem is scheduled off one `AudioContext` clock and started at
  the same instant (`src/audio/AudioEngine.ts`). They never drift.
- **Space** — each stem feeds an HRTF `PannerNode` at its 3D position; the
  camera drives the `AudioListener` every frame (`src/scene/Player.tsx`).
- **Content** — a composition is just data (`src/composition.ts`). The engine
  renders whatever manifest it's handed. This is the seam that lets "one
  composition" grow into "a platform of many."

## Using your own stems

The demo synthesizes four placeholder loops so it runs with zero files. To use
real audio, drop files in `public/stems/` and edit `src/composition.ts`:

```ts
{
  name: "vocals",
  color: "#ffd166",
  position: [0, 1.5, -10],
  source: { kind: "file", url: "/stems/vocals.ogg" },
}
```

For tight looping, all stems should be the same length (an exact number of
bars). Use a compressed format (`.ogg` / `.opus`) to keep loads small.
