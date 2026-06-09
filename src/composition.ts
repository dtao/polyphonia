// A "composition" is the data the engine renders. Decoupling this from the
// engine is the single most important design decision for the long-term
// vision: "one composition" and "a platform of many compositions" become the
// same code path — only the *source* of this manifest changes.
//
// A track is one stem (one instrument) placed at a point in 3D space.

import { EnvironmentSettings, defaultEnvironment, normalizeEnvironment } from "./environment";
import { CompositionMap, defaultMap, normalizeMap } from "./map";

export type StemSource =
  // Procedurally synthesized placeholder — runs with zero audio files.
  | { kind: "synth"; preset: "bass" | "pad" | "arp" | "drums" }
  // A real audio file. Drop stems in /public/stems and point here.
  | { kind: "file"; url: string };

export interface StemDirectivity {
  /** Horizontal unit direction in map X/Z coordinates. */
  direction: [number, number];
  /** Full-volume cone width in degrees. */
  width: number;
  /** Additional angular fade region outside the full-volume cone. */
  dispersion: number;
  /** Gain beyond the outer cone. */
  outsideGain: number;
}

export interface TrackDef {
  /** Stable identity, independent of name — so renaming never breaks lookups. */
  id: string;
  /** Shared audio identity. Cloned spatial tracks retain this to reuse one media asset. */
  audioAssetId?: string;
  name: string;
  color: string;
  position: [number, number, number];
  /** Maximum linear gain when the listener is inside refDistance. Defaults to 1. */
  volume?: number;
  /** Minimum linear gain once the listener reaches maxDistance. Defaults to 0. */
  minVolume?: number;
  source: StemSource;
  /** Distance at which volume starts falling off. */
  refDistance?: number;
  /** Distance past which volume no longer decreases. */
  maxDistance?: number;
  /** How sharply volume drops with distance. */
  rolloff?: number;
  /**
   * Per-stem sub-loop in-point, in seconds into the decoded source audio. When
   * set, the stem's loop begins here instead of at the shared loop start.
   */
  loopStart?: number;
  /**
   * Per-stem sub-loop out-point, in seconds into the decoded source audio. The
   * region [loopStart, loopEnd] is this stem's loop. When shorter than the
   * composition loop it is padded with silence (trim) unless loopRepeat is set.
   */
  loopEnd?: number;
  /**
   * When the sub-loop region is shorter than the composition loop, tile it to
   * fill the loop instead of padding with silence. Off by default (trim).
   */
  loopRepeat?: boolean;
  /**
   * Coarse timing offset in whole beats, set by clicking the stem loop meter
   * (snaps to the nearest beat). Combined with offsetFineBeats and applied as a
   * phase shift against the shared clock, so stems stay in sync. Positive plays
   * later in the loop.
   */
  offsetBeats?: number;
  /**
   * Fine timing offset in beats, added to offsetBeats. Set by a slider that
   * snaps in 1/16-note steps over ±1/4 note (±1 beat), for sub-beat nudges.
   */
  offsetFineBeats?: number;
  /** Optional speaker-like directional output; absent means omnidirectional. */
  directivity?: StemDirectivity;
  /** Content hash of the stem audio, set in published manifests for change detection. */
  hash?: string;
}

export const audioAssetKey = (track: Pick<TrackDef, "id" | "audioAssetId">): string =>
  track.audioAssetId ?? track.id;

export interface Composition {
  id: string;
  title: string;
  artist: string;
  /** Cloud artist identity. Display names may collide; slugs/ids should not. */
  artistId?: string;
  artistSlug?: string;
  artistAvatarUrl?: string;
  artistAvatarEmailHash?: string;
  bpm: number;
  /**
   * Loop length in beats. When set, stems are trimmed to this musical length for
   * seamless looping. When omitted, the engine infers a shared BPM-aligned loop
   * length from uploaded stems and pads/trims prepared loop buffers to keep
   * every stem restarting together. (Legacy manifests stored this as `bars`;
   * `normalizeComposition` migrates `bars` to `beats` as `bars * 4`.)
   */
  beats?: number;
  /**
   * Beats per bar — the time-signature numerator, used for visual bar grouping
   * in the loop/stem meters. Defaults to 4. Lets non-standard signatures (5/4,
   * 7/8, …) place bar lines correctly without constraining the loop length.
   */
  beatsPerBar?: number;
  /** Whether playback loops. Defaults to true for existing compositions. */
  loopEnabled?: boolean;
  /** Seconds to trim from the start of each stem's loop region. */
  loopStart?: number;
  /** Seconds to trim from the end of each stem's loop region. */
  loopEndTrim?: number;
  /** Seconds of end-to-start crossfade inside prepared loop buffers. */
  loopCrossfade?: number;
  /**
   * When a stem runs slightly past the musical loop length (e.g. a reverb
   * tail trailing past 8 bars), fold that overrun back onto the start of the
   * loop so the tail rings across the seam instead of being clipped. Capped to
   * a couple of bars so genuinely longer stems are not folded in half.
   */
  loopTail?: boolean;
  /** Visual/acoustic environment metadata. */
  environment: EnvironmentSettings;
  /** Authored walkable area and simple boundary geometry. */
  map: CompositionMap;
  tracks: TrackDef[];
  /** Share id if this composition is currently published (cleared on unpublish). */
  publishedId?: string;
  /** Local library metadata. */
  createdAt?: string;
  updatedAt?: string;
  /** Fingerprint of the last successfully published local state. */
  publishedRevision?: string;
  publishedAt?: string;
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
  beats: 64,
  environment: defaultEnvironment,
  map: defaultMap,
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

export function normalizeComposition(comp: Composition): Composition {
  const now = new Date().toISOString();
  // Legacy manifests stored loop length in bars (4 beats each); migrate to beats.
  const legacyBars = (comp as { bars?: number }).bars;
  const beats = comp.beats ?? (legacyBars != null ? legacyBars * 4 : undefined);
  const normalized: Composition = {
    ...comp,
    beats,
    createdAt: comp.createdAt ?? comp.updatedAt ?? now,
    updatedAt: comp.updatedAt ?? comp.createdAt ?? now,
    environment: normalizeEnvironment(comp.environment),
    map: normalizeMap(comp.map),
    tracks: comp.tracks.map(normalizeTrack),
  };
  delete (normalized as { bars?: number }).bars;
  return normalized;
}

function normalizeTrack(track: TrackDef): TrackDef {
  const directivity = normalizeDirectivity(track.directivity);
  return {
    ...track,
    ...(directivity ? { directivity } : { directivity: undefined }),
  };
}

function normalizeDirectivity(value: StemDirectivity | undefined): StemDirectivity | undefined {
  if (!value || !Array.isArray(value.direction) || value.direction.length !== 2) return undefined;
  const [x, z] = value.direction;
  if (![x, z, value.width, value.dispersion, value.outsideGain].every(Number.isFinite)) return undefined;
  const length = Math.hypot(x, z);
  if (length < 0.000001) return undefined;
  const width = Math.max(1, Math.min(360, value.width));
  return {
    direction: [x / length, z / length],
    width,
    dispersion: Math.max(0, Math.min(360 - width, value.dispersion)),
    outsideGain: Math.max(0, Math.min(1, value.outsideGain)),
  };
}

export function touchComposition<T extends { createdAt?: string; updatedAt?: string }>(comp: T, at = new Date().toISOString()): T {
  return { ...comp, createdAt: comp.createdAt ?? at, updatedAt: at };
}

type RevisionTrack = Omit<TrackDef, "source"> & { source: unknown };
type RevisionComposition = Omit<Partial<Composition>, "tracks"> & { tracks?: RevisionTrack[] };

export function compositionRevision(comp: RevisionComposition): string {
  return hashString(
    stableStringify({
      title: comp.title ?? "Untitled",
      artist: comp.artist ?? "Unknown",
      artistId: comp.artistId,
      artistSlug: comp.artistSlug,
      bpm: comp.bpm,
      beats: comp.beats,
      beatsPerBar: comp.beatsPerBar,
      loopEnabled: comp.loopEnabled,
      loopStart: comp.loopStart,
      loopEndTrim: comp.loopEndTrim,
      loopCrossfade: comp.loopCrossfade,
      loopTail: comp.loopTail,
      environment: comp.environment,
      map: comp.map,
      tracks: (comp.tracks ?? []).map((track) => ({
        id: track.id,
        name: track.name,
        color: track.color,
        position: track.position,
        volume: track.volume,
        minVolume: track.minVolume,
        source: sourceRevision(track.source),
        refDistance: track.refDistance,
        maxDistance: track.maxDistance,
        rolloff: track.rolloff,
        loopStart: track.loopStart,
        loopEnd: track.loopEnd,
        loopRepeat: track.loopRepeat,
        offsetBeats: track.offsetBeats,
        offsetFineBeats: track.offsetFineBeats,
        directivity: track.directivity,
      })),
    }),
  );
}

function sourceRevision(source: unknown): unknown {
  const s = source as StemSource | { kind?: string };
  if (s?.kind === "synth") return { kind: "synth", preset: (s as Extract<StemSource, { kind: "synth" }>).preset };
  if (s?.kind === "file") return { kind: "file" };
  if (s?.kind === "stored") return { kind: "file" };
  return s;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableValue(v)]),
  );
}

function hashString(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, 16);
}
