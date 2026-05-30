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
  /** Stable identity, independent of name — so renaming never breaks lookups. */
  id: string;
  name: string;
  color: string;
  position: [number, number, number];
  /** Linear gain, 0..1+. Defaults to 1. */
  volume?: number;
  source: StemSource;
  /** Distance at which volume starts falling off. */
  refDistance?: number;
  /** Distance past which volume no longer decreases. */
  maxDistance?: number;
  /** How sharply volume drops with distance. */
  rolloff?: number;
  /** Content hash of the stem audio, set in published manifests for change detection. */
  hash?: string;
}

export interface Composition {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /**
   * Loop length in bars (4 beats each). When set, stems are trimmed to this
   * musical length for seamless looping. Omitted for user-built compositions,
   * where each stem simply loops its whole buffer.
   */
  bars?: number;
  tracks: TrackDef[];
  /** Share id if this composition is currently published (cleared on unpublish). */
  publishedId?: string;
}

// "Journey" — six stems (32s / 16-bar loop at 120 BPM), arranged in a hexagon
// around the origin so you can walk between the voices. The rhythm section
// (bass + drums) sits together; the harmonic/melodic voices spread around.
//
// Positions are points on a circle of radius ~10, every 60 degrees.
export const defaultComposition: Composition = {
  id: "journey",
  title: "Journey",
  artist: "Polyphonia",
  bpm: 120,
  bars: 16,
  tracks: [
    {
      id: "bass",
      name: "bass",
      color: "#5b8cff",
      position: [10, 1.5, 0],
      source: { kind: "file", url: "/stems/Journey_Bass.mp3" },
    },
    {
      id: "drums",
      name: "drums",
      color: "#ff7a6b",
      position: [5, 1.5, 8.7],
      source: { kind: "file", url: "/stems/Journey_Drums.mp3" },
    },
    {
      id: "piano",
      name: "piano",
      color: "#ffd166",
      position: [-5, 1.5, 8.7],
      source: { kind: "file", url: "/stems/Journey_Piano.mp3" },
    },
    {
      id: "choir",
      name: "choir",
      color: "#b96bff",
      position: [-10, 1.5, 0],
      source: { kind: "file", url: "/stems/Journey_Choir.mp3" },
    },
    {
      id: "synth",
      name: "synth",
      color: "#56e0c0",
      position: [-5, 1.5, -8.7],
      source: { kind: "file", url: "/stems/Journey_Synth.mp3" },
    },
    {
      id: "sine",
      name: "sine",
      color: "#f78fb3",
      position: [5, 1.5, -8.7],
      source: { kind: "file", url: "/stems/Journey_Sine.mp3" },
    },
  ],
  // Shared falloff: gentle enough to always hear the whole piece, but each
  // voice clearly strengthens as you approach it.
};
