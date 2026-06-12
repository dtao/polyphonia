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

/**
 * Controls the spatial shape of a stem's audio emission. Absent or
 * `{ kind: "orb" }` is the default point-source behaviour.
 */
export type StemShape =
  | { kind: "orb" }
  /**
   * Vertical infinite-line source: distance falloff uses only the XZ
   * (horizontal) distance, so moving up or down never changes volume.
   * No extra parameters — position.x/z is the column centre.
   */
  | { kind: "pillar" }
  /**
   * Finite flat panel that emits strongly from one face. The panel
   * extends `width` units along the axis perpendicular to `facing`.
   * `facing` is a unit vector in XZ pointing toward the loud side.
   * `emitBothSides` lets sound pass (quietly) through the back face.
   */
  | { kind: "wall"; facing: [number, number]; width: number; emitBothSides?: boolean }
  /**
   * Horizontal line-source running from `position` to `end`. Distance
   * falloff is computed from the closest point on the segment, so
   * walking alongside the river keeps volume constant while crossing
   * it produces a swell-and-fade.
   */
  | { kind: "river"; end: [number, number, number] };

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
  /** Spatial emission shape. Absent or { kind: "orb" } is the default point source. */
  stemShape?: StemShape;
  /** Content hash of the stem audio, set in published manifests for change detection. */
  hash?: string;
}

export const audioAssetKey = (track: Pick<TrackDef, "id" | "audioAssetId">): string =>
  track.audioAssetId ?? track.id;

// One captured moment of an auto-pilot route: seconds since the route began,
// the listener's XZ position, and the camera's yaw/pitch. Surface height is
// derived at playback time so routes stay valid when elevations are retuned.
export interface AutopilotSample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface AutopilotRoute {
  duration: number;
  samples: AutopilotSample[];
}

export const MAX_AUTOPILOT_SAMPLES = 12000; // ~20 min at 10 Hz

// Consecutive samples further apart than this are a recorded teleport (e.g. a
// path-loop wrap): playback snaps instead of sweeping across the map.
export const AUTOPILOT_JUMP_DISTANCE = 8;

export function normalizeAutopilot(value: unknown): AutopilotRoute | undefined {
  const route = value as Partial<AutopilotRoute> | undefined;
  if (!route || typeof route !== "object" || !Array.isArray(route.samples)) return undefined;
  const samples: AutopilotSample[] = [];
  for (const raw of route.samples) {
    const s = raw as Partial<AutopilotSample> | undefined;
    if (!s || typeof s !== "object") continue;
    if (![s.t, s.x, s.z, s.yaw, s.pitch].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    if (samples.length >= MAX_AUTOPILOT_SAMPLES) break;
    samples.push({ t: s.t!, x: s.x!, z: s.z!, yaw: s.yaw!, pitch: s.pitch! });
  }
  samples.sort((a, b) => a.t - b.t);
  if (samples.length < 2) return undefined;
  const duration =
    typeof route.duration === "number" && Number.isFinite(route.duration)
      ? Math.max(route.duration, samples[samples.length - 1].t)
      : samples[samples.length - 1].t;
  if (duration <= 0) return undefined;
  return { duration, samples };
}

/**
 * Interpolated route state at `t` seconds. Position/look lerp between the
 * surrounding samples (yaw is recorded unwrapped, so plain lerp is correct);
 * `jump` flags a recorded teleport, where playback should snap rather than
 * interpolate. Clamps to the route's ends.
 */
export function sampleAutopilotRoute(
  route: AutopilotRoute,
  t: number,
): { x: number; z: number; yaw: number; pitch: number; jump: boolean } {
  const samples = route.samples;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (t <= first.t) return { x: first.x, z: first.z, yaw: first.yaw, pitch: first.pitch, jump: false };
  if (t >= last.t) return { x: last.x, z: last.z, yaw: last.yaw, pitch: last.pitch, jump: false };
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const jump = Math.hypot(b.x - a.x, b.z - a.z) > AUTOPILOT_JUMP_DISTANCE;
  if (jump) {
    // Hold the pre-teleport sample until its time passes, then snap.
    const at = t - a.t < b.t - t ? a : b;
    return { x: at.x, z: at.z, yaw: at.yaw, pitch: at.pitch, jump: true };
  }
  const f = (t - a.t) / (b.t - a.t || 1);
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    yaw: a.yaw + (b.yaw - a.yaw) * f,
    pitch: a.pitch + (b.pitch - a.pitch) * f,
    jump: false,
  };
}

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
  /**
   * Recorded auto-pilot route (M7.6): the author's movement and camera over
   * time, captured in Explore mode. Playback walks the listener along it,
   * including look direction. Absent = no route authored.
   */
  autopilot?: AutopilotRoute;
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
  const autopilot = normalizeAutopilot(comp.autopilot);
  if (autopilot) normalized.autopilot = autopilot;
  else delete normalized.autopilot;
  return normalized;
}

function normalizeTrack(track: TrackDef): TrackDef {
  const directivity = normalizeDirectivity(track.directivity);
  const stemShape = normalizeStemShape(track.stemShape);
  return {
    ...track,
    ...(directivity ? { directivity } : { directivity: undefined }),
    ...(stemShape ? { stemShape } : { stemShape: undefined }),
  };
}

function normalizeStemShape(value: StemShape | undefined): StemShape | undefined {
  if (!value) return undefined;
  if (value.kind === "orb") return undefined; // orb is the default; no need to store
  if (value.kind === "pillar") return { kind: "pillar" };
  if (value.kind === "wall") return normalizeWallShape(value);
  if (value.kind === "river") return normalizeRiverShape(value);
  return undefined;
}

function normalizeRiverShape(value: Extract<StemShape, { kind: "river" }>): StemShape | undefined {
  if (!Array.isArray(value.end) || value.end.length !== 3) return undefined;
  if (!value.end.every(Number.isFinite)) return undefined;
  return { kind: "river", end: value.end as [number, number, number] };
}

function normalizeWallShape(value: Extract<StemShape, { kind: "wall" }>): StemShape | undefined {
  if (!Array.isArray(value.facing) || value.facing.length !== 2) return undefined;
  const [fx, fz] = value.facing;
  if (![fx, fz].every(Number.isFinite)) return undefined;
  const len = Math.hypot(fx, fz);
  if (len < 0.000001) return undefined;
  const width = Number.isFinite(value.width) ? Math.max(1, Math.min(200, value.width)) : 10;
  return {
    kind: "wall",
    facing: [fx / len, fz / len],
    width,
    ...(value.emitBothSides ? { emitBothSides: true } : {}),
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
        stemShape: track.stemShape,
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
