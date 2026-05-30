// A "composition" is the data the engine renders. Decoupling this from the
// engine is the single most important design decision for the long-term
// vision: "one composition" and "a platform of many compositions" become the
// same code path — only the *source* of this manifest changes.
//
// A track is one stem (one instrument) placed at a point in 3D space.

export type StemSource =
  // Procedurally synthesized placeholder — runs with zero audio files.
  | { kind: "synth"; preset: "bass" | "pad" | "arp" | "drums" }
  // A real audio file. Drop stems in /public/stems and point here.
  | { kind: "file"; url: string };

export interface TrackDef {
  name: string;
  color: string;
  position: [number, number, number];
  source: StemSource;
  /** Distance at which volume starts falling off. */
  refDistance?: number;
  /** Distance past which volume no longer decreases. */
  maxDistance?: number;
  /** How sharply volume drops with distance. */
  rolloff?: number;
}

export interface Composition {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /** Loop length in bars (4 beats each). All stems share this for tight sync. */
  bars: number;
  tracks: TrackDef[];
}

// The default Phase-0 composition: four coordinated parts in A-minor, spread
// across the corners of a plaza so that walking around rebalances the mix.
export const defaultComposition: Composition = {
  id: "demo-plaza",
  title: "Plaza (placeholder)",
  artist: "Polyphonia",
  bpm: 120,
  bars: 4,
  tracks: [
    {
      name: "bass",
      color: "#5b8cff",
      position: [-9, 1.5, -9],
      source: { kind: "synth", preset: "bass" },
      refDistance: 4,
      maxDistance: 40,
      rolloff: 1.1,
    },
    {
      name: "pad",
      color: "#b96bff",
      position: [9, 1.5, -9],
      source: { kind: "synth", preset: "pad" },
      refDistance: 5,
      maxDistance: 45,
      rolloff: 0.9,
    },
    {
      name: "arp",
      color: "#56e0c0",
      position: [9, 1.5, 9],
      source: { kind: "synth", preset: "arp" },
      refDistance: 4,
      maxDistance: 40,
      rolloff: 1.2,
    },
    {
      name: "drums",
      color: "#ff7a6b",
      position: [-9, 1.5, 9],
      source: { kind: "synth", preset: "drums" },
      refDistance: 4,
      maxDistance: 40,
      rolloff: 1.2,
    },
  ],
};
