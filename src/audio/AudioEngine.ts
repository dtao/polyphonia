import * as THREE from "three";
import { Composition, StemDirectivity, StemShape, TrackDef } from "../composition";
import { CompositionMap, MapRoom, containingRoom, loopPreviewElevationOffset, roomWallObstructionCount, tiledMapTransforms, transformLoopPoint, tunnelObstructionCount, wallObstructionCount } from "../map";
import { createPlaceholderStems } from "./synth";

interface LiveTrack {
  def: TrackDef;
  originalBuffer: AudioBuffer;
  buffer: AudioBuffer;
  gain: GainNode;
  analyser: AnalyserNode;
  instances: Map<string, LiveTrackInstance>;
  source?: AudioBufferSourceNode;
  levelData: Uint8Array<ArrayBuffer>;
}

interface LiveTrackInstance {
  id: string;
  panner: PannerNode;
  distanceGain: GainNode;
  /** Per-instance gain for shape-dependent emission (e.g. wall one-sidedness). */
  shapeGain: GainNode;
  occlusionGain: GainNode;
  occlusionFilter: BiquadFilterNode;
}

interface AudibleTrackInstance {
  id: string;
  position: [number, number, number];
  direction: [number, number];
}

type AudioPerformanceMode = "full" | "reduced";

export interface AudioLoadProgress {
  loaded: number;
  total: number;
  trackName?: string;
  phase: "fetching" | "decoding" | "preparing";
}

const MAX_VIRTUAL_AUDIO_INSTANCES_PER_TRACK = 4;
const REDUCED_MAX_VIRTUAL_AUDIO_INSTANCES_PER_TRACK = 2;
const REDUCED_TILE_AUDIO_PREVIEW_RADIUS = 80;
const REDUCED_LISTENER_UPDATE_INTERVAL = 1 / 30;
const REDUCED_ACOUSTICS_UPDATE_INTERVAL = 1 / 20;
const REDUCED_ROOM_UPDATE_INTERVAL = 1 / 8;
// How much overrun past the musical loop length we treat as a tail to fold
// back across the seam, in beats. Capped so a genuinely longer stem (e.g. a
// 32-beat clip against a 16-beat loop) is not folded onto its own first half.
const LOOP_TAIL_MAX_BEATS = 8;
// Short fade applied to the very end of a folded tail so a capped (still
// ringing) tail does not click where it stops.
const LOOP_TAIL_FADE = 0.03;

function preferredAudioPerformanceMode(): AudioPerformanceMode {
  if (typeof window !== "undefined") {
    const override = new URLSearchParams(window.location.search).get("audioQuality");
    if (override === "full" || override === "desktop") return "full";
    if (override === "reduced" || override === "mobile") return "reduced";
  }

  if (typeof navigator === "undefined") return "full";
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return "reduced";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)) return "reduced";
  if (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1) return "reduced";
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) return "reduced";
  return "full";
}

// Owns the single AudioContext. The golden rule: every stem is scheduled off
// THIS context's clock and started at the SAME time, so they never drift. As
// the listener moves we only change what's *heard*, never restart sources.
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly performanceMode: AudioPerformanceMode;
  private master: GainNode;
  private dryBus: GainNode;
  private roomReverbSend: GainNode;
  private roomConvolver: ConvolverNode;
  private roomReverbWet: GainNode;
  private tracks: LiveTrack[] = [];
  // Cached downsampled waveform peaks per track id, for the stem loop meter.
  private peakCache = new Map<string, { bins: number; peaks: Float32Array }>();
  started = false;
  private loopStartTime = 0; // absolute ctx time the composition loop began
  private loopLength = 0; // musical loop length in seconds (0 = loop whole buffer)
  private loopOffset = 0; // shared leading-silence (encoder delay) to skip
  private loopEnabled = true;
  private loopStartOverride: number | undefined;
  private loopEndTrim = 0;
  private loopCrossfade = 0.035;
  private loopTail = false;
  private bpm = 120;
  private auditionTimer: ReturnType<typeof setTimeout> | undefined;
  private auditionStartTime: number | null = null;
  private auditionDuration = 0;
  private listenerPosition = new THREE.Vector3();
  private trackPosition = new THREE.Vector3();
  private map: CompositionMap | null = null;
  private activeRoomAcousticsKey: string | null = null;
  private tileAudioPreviewRadius: number;
  private activeRoomDebug: { id: string; decay: number; reverbSend: number; impulseDuration: number } | null = null;
  private panningModel: PanningModelType;
  private maxVirtualAudioInstancesPerTrack: number;
  private listenerUpdateInterval: number;
  private acousticsUpdateInterval: number;
  private roomUpdateInterval: number;
  private lastListenerParamUpdate = -Infinity;
  private lastAcousticsUpdate = -Infinity;
  private lastRoomUpdate = -Infinity;
  private lastListenerParamPosition = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  private lastListenerParamForward = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

  constructor() {
    this.performanceMode = preferredAudioPerformanceMode();
    this.ctx = this.createAudioContext();
    this.panningModel = this.performanceMode === "reduced" ? "equalpower" : "HRTF";
    this.maxVirtualAudioInstancesPerTrack =
      this.performanceMode === "reduced" ? REDUCED_MAX_VIRTUAL_AUDIO_INSTANCES_PER_TRACK : MAX_VIRTUAL_AUDIO_INSTANCES_PER_TRACK;
    this.tileAudioPreviewRadius = this.performanceMode === "reduced" ? REDUCED_TILE_AUDIO_PREVIEW_RADIUS : 120;
    this.listenerUpdateInterval = this.performanceMode === "reduced" ? REDUCED_LISTENER_UPDATE_INTERVAL : 0;
    this.acousticsUpdateInterval = this.performanceMode === "reduced" ? REDUCED_ACOUSTICS_UPDATE_INTERVAL : 0;
    this.roomUpdateInterval = this.performanceMode === "reduced" ? REDUCED_ROOM_UPDATE_INTERVAL : 0;
    this.master = this.ctx.createGain();
    this.dryBus = this.ctx.createGain();
    this.roomReverbSend = this.ctx.createGain();
    this.roomConvolver = this.ctx.createConvolver();
    this.roomReverbWet = this.ctx.createGain();

    this.master.gain.value = 0.85;
    this.roomReverbSend.gain.value = 0;
    this.roomReverbWet.gain.value = 0.45;

    this.dryBus.connect(this.master);
    this.dryBus.connect(this.roomReverbSend);
    this.roomReverbSend.connect(this.roomConvolver);
    this.roomConvolver.connect(this.roomReverbWet);
    this.roomReverbWet.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  private createAudioContext(): AudioContext {
    try {
      return new AudioContext({
        latencyHint: this.performanceMode === "reduced" ? "playback" : "interactive",
      });
    } catch {
      return new AudioContext();
    }
  }

  async load(comp: Composition, onProgress?: (progress: AudioLoadProgress) => void): Promise<void> {
    // Only synthesize placeholders if some track actually needs them.
    const needsSynth = comp.tracks.some((t) => t.source.kind === "synth");
    const synthBars = comp.beats != null ? Math.max(1, Math.round(comp.beats / 4)) : 4;
    const stems = needsSynth ? createPlaceholderStems(this.ctx, comp.bpm, synthBars) : null;

    const loaded: Array<{ def: TrackDef; buffer: AudioBuffer }> = [];
    const fileBuffers = new Map<string, Promise<AudioBuffer>>();
    const total = comp.tracks.length;
    for (const [index, def] of comp.tracks.entries()) {
      let buffer: AudioBuffer;
      if (def.source.kind === "file") {
        onProgress?.({ loaded: index, total, trackName: def.name, phase: "fetching" });
        let pending = fileBuffers.get(def.source.url);
        if (!pending) {
          pending = fetch(def.source.url)
            .then((res) => res.arrayBuffer())
            .then((data) => {
              onProgress?.({ loaded: index, total, trackName: def.name, phase: "decoding" });
              return this.ctx.decodeAudioData(data);
            });
          fileBuffers.set(def.source.url, pending);
        }
        buffer = await pending;
      } else {
        onProgress?.({ loaded: index, total, trackName: def.name, phase: "preparing" });
        buffer = stems![def.source.preset];
      }

      loaded.push({ def, buffer });
      onProgress?.({ loaded: index + 1, total, trackName: def.name, phase: "preparing" });
    }

    // Loop bookkeeping. The musical loop length comes from the composition's
    // tempo; the offset skips shared MP3 encoder delay. Buffers with a known
    // musical length are copied into clean loop buffers with a tiny end->start
    // crossfade, which masks residual padding/clicks at the wrap point.
    this.setLoopFields(comp);
    const decodedFileBuffers = [...new Set(loaded.filter((t) => t.def.source.kind === "file").map((t) => t.buffer))];
    const detectedOffsets = decodedFileBuffers.map((b) => this.leadingSilence(b)).filter((s) => s > 0.001);
    this.loopOffset = detectedOffsets.length ? Math.min(0.1, Math.min(...detectedOffsets)) : 0;
    if (this.loopEnabled && !this.loopLength) this.loopLength = this.inferLoopLength(loaded);

    for (const { def, buffer } of loaded) {
      this.tracks.push(this.buildTrack(def, buffer, this.prepareLoopBuffer(buffer, def)));
    }
  }

  private setLoopFields(comp: Pick<Composition, "bpm" | "beats" | "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade" | "loopTail">): void {
    this.bpm = Math.max(1, comp.bpm || 120);
    this.loopEnabled = comp.loopEnabled ?? true;
    this.loopLength = comp.beats ? comp.beats * (60 / this.bpm) : 0;
    this.loopStartOverride = comp.loopStart;
    this.loopEndTrim = comp.loopEndTrim ?? 0;
    this.loopCrossfade = comp.loopCrossfade ?? 0.035;
    this.loopTail = comp.loopTail ?? false;
  }

  // Seconds of (near-)silence before the first audible sample — i.e. the MP3
  // encoder-delay padding the decoder prepends.
  private leadingSilence(buffer: AudioBuffer): number {
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        if (Math.abs(buffer.getChannelData(ch)[i]) > 0.005) return i / buffer.sampleRate;
      }
    }
    return 0;
  }

  private inferLoopLength(loaded: Array<{ buffer: AudioBuffer }>): number {
    const beatLength = 60 / this.bpm;
    const trimStart = Math.max(0, this.loopStartOverride ?? this.loopOffset);
    const longest = loaded.reduce((max, { buffer }) => Math.max(max, buffer.duration - trimStart), 0);
    if (longest <= 0) return 0;
    return Math.max(beatLength, Math.round(longest / beatLength) * beatLength);
  }

  // Copy a decoded file into a shared BPM-aligned loop and blend the very end
  // into the start. Clips shorter than the shared length are padded with
  // silence; clips longer than it are trimmed, so all stems restart together on
  // every loop iteration. MP3 decoders can leave tiny leading/trailing padding
  // even after loop points are set; looping a prepared buffer avoids drift and
  // hides small boundary clicks.
  private prepareLoopBuffer(buffer: AudioBuffer, def?: TrackDef): AudioBuffer {
    if (!this.loopEnabled) return buffer;

    const sr = buffer.sampleRate;
    const globalTrimStart = Math.max(0, this.loopStartOverride ?? this.loopOffset);
    const globalTrimEnd = Math.max(0, this.loopEndTrim);
    const maxStartFrame = Math.max(0, buffer.length - 1);

    // A per-stem sub-loop in-point overrides the shared start trim.
    const startSec = def?.loopStart != null ? Math.max(0, def.loopStart) : globalTrimStart;
    const startFrame = Math.min(Math.round(startSec * sr), maxStartFrame);
    const availableFrames = Math.max(1, buffer.length - startFrame - Math.round(globalTrimEnd * sr));

    // Every prepared buffer is exactly loopFrames long so all stems restart
    // together (the composition musical length, or the whole buffer when no
    // musical length is known).
    const targetFrames = this.loopLength ? Math.round(Math.max(0.1, this.loopLength - globalTrimEnd) * sr) : availableFrames;
    const loopFrames = Math.max(1, targetFrames);
    const out = this.ctx.createBuffer(buffer.numberOfChannels, loopFrames, sr);

    // The stem's loop region. Default is the musical loop length, so audio past
    // it is a foldable tail. A per-stem out-point shortens it; a shorter region
    // is padded with silence (trim) unless loopRepeat tiles it to fill the loop.
    const regionFrames = def?.loopEnd != null
      ? Math.min(availableFrames, Math.max(1, Math.round((def.loopEnd - startSec) * sr)))
      : Math.min(availableFrames, loopFrames);
    const repeat = def?.loopRepeat ?? false;

    // Frames running past the region end: a trailing reverb tail. When enabled
    // (and not repeating) we fold up to LOOP_TAIL_MAX_BARS of it back onto the
    // start so it rings across the seam instead of being clipped at the wrap.
    const tailFrames = repeat ? 0 : this.tailFoldFrames(availableFrames - regionFrames, loopFrames, sr);

    // The seam crossfade smooths a wrap from real audio back to the start. Skip
    // it when a trimmed region leaves trailing silence (the loop restart is the
    // stem's own clean onset, and a crossfade would bleed the start into the
    // silence as a pre-echo).
    const seamCrossfade = repeat || regionFrames >= loopFrames;

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = out.getChannelData(ch);
      for (let k = 0; k < loopFrames; k++) {
        if (repeat) {
          output[k] = input[startFrame + (k % regionFrames)] ?? 0;
        } else {
          output[k] = k < regionFrames ? (input[startFrame + k] ?? 0) : 0;
        }
      }
      // Crossfade the loop region first so the seam uses the clean loop start,
      // then add the tail on top of the head.
      if (seamCrossfade) this.crossfadeLoop(output, sr);
      if (tailFrames > 0) {
        const tailStart = startFrame + regionFrames;
        const fadeFrames = Math.min(Math.floor(LOOP_TAIL_FADE * sr), tailFrames);
        for (let j = 0; j < tailFrames; j++) {
          const fromEnd = tailFrames - j;
          const gain = fadeFrames > 0 && fromEnd < fadeFrames ? fromEnd / fadeFrames : 1;
          output[j] += (input[tailStart + j] ?? 0) * gain;
        }
      }
    }

    return out;
  }

  // How many overrun frames to fold back across the loop seam. Zero unless the
  // tail option is on, a musical loop length is known, and audio actually runs
  // past the loop region; capped to LOOP_TAIL_MAX_BARS and to one loop length.
  private tailFoldFrames(overrun: number, loopFrames: number, sampleRate: number): number {
    if (!this.loopTail || !this.loopLength) return 0;
    if (overrun <= 0) return 0;
    const maxTail = Math.round(LOOP_TAIL_MAX_BEATS * (60 / this.bpm) * sampleRate);
    return Math.min(overrun, maxTail, loopFrames);
  }

  private crossfadeLoop(data: Float32Array, sampleRate: number): void {
    const fadeFrames = Math.min(Math.floor(this.loopCrossfade * sampleRate), Math.floor(data.length / 4));
    if (fadeFrames <= 1) return;

    for (let i = 0; i < fadeFrames; i++) {
      const t = i / (fadeFrames - 1);
      const endIndex = data.length - fadeFrames + i;
      // Equal-power-ish blend from original tail to loop start.
      const tailGain = Math.cos((t * Math.PI) / 2);
      const headGain = Math.sin((t * Math.PI) / 2);
      data[endIndex] = data[endIndex] * tailGain + data[i] * headGain;
    }
  }

  // Build the shared node graph for one track (no source yet). The source feeds
  // the authored gain/analyser, then active tile instances branch into their
  // own distance/occlusion/panner chains.
  private buildTrack(def: TrackDef, originalBuffer: AudioBuffer, buffer = originalBuffer): LiveTrack {
    const gain = this.ctx.createGain();
    gain.gain.value = def.volume ?? 1;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;

    gain.connect(analyser);

    const track = {
      def,
      originalBuffer,
      buffer,
      gain,
      analyser,
      instances: new Map<string, LiveTrackInstance>(),
      levelData: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
    };
    this.updateTrackAcoustics(track, this.ctx.currentTime);
    return track;
  }

  // (Re)create and start a track's looping source. `phase` is how far into the
  // loop region to begin (0 = the region's start), used to drop a new track in
  // aligned with the already-playing loop.
  private startSource(t: LiveTrack, when: number, phase: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = this.loopEnabled;
    src.loopStart = 0;
    src.loopEnd = t.buffer.duration;
    src.connect(t.gain);
    src.start(when, phase);
    t.source = src;
  }

  // Length of a buffer's loop region (the musical length, or the whole buffer).
  private regionLength(buffer: AudioBuffer): number {
    return buffer.duration;
  }

  // A stem's timing offset in seconds (M7.1): positive plays later, negative
  // earlier. The coarse (beat-snapped) and fine offsets sum, both in beats so
  // they track tempo.
  private offsetSeconds(def: TrackDef): number {
    return ((def.offsetBeats ?? 0) + (def.offsetFineBeats ?? 0)) * (60 / this.bpm);
  }

  // Where in a track's buffer to begin so it lands at the right point of the
  // running loop, accounting for its timing offset. When looping, a later
  // offset means starting that much *behind* the global phase so the content is
  // heard later; the whole thing wraps within the loop. When not looping, the
  // offset is ignored and playback simply tracks elapsed time.
  private loopPhase(t: LiveTrack, when: number): number {
    const len = this.regionLength(t.buffer);
    if (!this.loopEnabled) return Math.min(Math.max(0, when - this.loopStartTime), len - 0.001);
    const elapsed = when - this.loopStartTime - this.offsetSeconds(t.def);
    return (((elapsed % len) + len) % len);
  }

  // Start every stem in lockstep, looped.
  start(): void {
    if (this.started) return;
    this.loopStartTime = this.ctx.currentTime + 0.1;
    for (const t of this.tracks) this.startSource(t, this.loopStartTime, this.loopPhase(t, this.loopStartTime));
    this.started = true;
  }

  // Decode an uploaded audio file into a buffer.
  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  // Add a new track to a *playing* composition, phase-aligned to the loop so it
  // drops in musically. We start its source partway into the buffer by the same
  // amount the existing loop has already advanced.
  addLiveTrack(def: TrackDef, buffer: AudioBuffer): void {
    if (this.loopEnabled && !this.loopLength) this.loopLength = this.inferLoopLength([{ buffer }]);
    const t = this.buildTrack(def, buffer, this.prepareLoopBuffer(buffer, def));
    this.tracks.push(t);
    if (this.started) {
      const when = this.ctx.currentTime + 0.06;
      this.startSource(t, when, this.loopPhase(t, when));
    }
  }

  // Clone an existing live track's decoded audio into a new track definition.
  // This avoids re-fetching uploaded blob URLs and keeps duplicated stems
  // phase-aligned with the rest of the composition.
  duplicateLiveTrack(sourceId: string, def: TrackDef): void {
    const source = this.find(sourceId);
    if (!source) return;
    const t = this.buildTrack(def, source.originalBuffer, this.prepareLoopBuffer(source.originalBuffer, def));
    this.tracks.push(t);
    if (this.started) {
      const when = this.ctx.currentTime + 0.06;
      this.startSource(t, when, this.loopPhase(t, when));
    }
  }

  updateLoopSettings(comp: Pick<Composition, "bpm" | "beats" | "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade" | "loopTail">): void {
    clearTimeout(this.auditionTimer);
    this.auditionStartTime = null;
    const wasStarted = this.started;
    const now = this.ctx.currentTime;
    const oldStart = this.loopStartTime;
    this.setLoopFields(comp);
    if (this.loopEnabled && !this.loopLength) this.loopLength = this.inferLoopLength(this.tracks.map((t) => ({ buffer: t.originalBuffer })));

    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.source = undefined;
      t.buffer = this.prepareLoopBuffer(t.originalBuffer, t.def);
    }

    if (!wasStarted) return;
    const when = now + 0.04;
    this.loopStartTime = oldStart;
    for (const t of this.tracks) {
      this.startSource(t, when, this.loopPhase(t, when));
    }
  }

  async replaceComposition(comp: Composition): Promise<void> {
    const wasStarted = this.started;
    clearTimeout(this.auditionTimer);
    this.auditionStartTime = null;
    this.stopAndDisconnectTracks();
    this.started = false;
    await this.load(comp);
    if (wasStarted) this.start();
  }

  auditionSeam(): void {
    if (!this.started || !this.loopEnabled || !this.tracks.length) return;
    clearTimeout(this.auditionTimer);
    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.source = undefined;
    }

    const tail = 1.25;
    const head = 1.25;
    const now = this.ctx.currentTime + 0.03;
    let duration = 0;
    for (const t of this.tracks) {
      const len = t.buffer.duration;
      const tailStart = Math.max(0, len - tail);
      const tailDuration = len - tailStart;
      const headDuration = Math.min(head, len);
      this.playSegment(t, now, tailStart, tailDuration);
      this.playSegment(t, now + tailDuration, 0, headDuration);
      duration = Math.max(duration, tailDuration + headDuration);
    }

    this.auditionStartTime = now;
    this.auditionDuration = duration;
    this.auditionTimer = setTimeout(() => {
      this.auditionStartTime = null;
      const when = this.ctx.currentTime + 0.03;
      for (const t of this.tracks) {
        this.startSource(t, when, this.loopPhase(t, when));
      }
    }, (duration + 0.08) * 1000);
  }

  loopProgress(): { mode: "playing" | "audition"; position: number; duration: number } | null {
    const track = this.tracks[0];
    if (!track) return null;
    const duration = track.buffer.duration;
    if (this.auditionStartTime !== null) {
      const elapsed = Math.max(0, this.ctx.currentTime - this.auditionStartTime);
      const tail = Math.min(1.25, duration);
      const tailStart = Math.max(0, duration - tail);
      const position = elapsed <= tail ? tailStart + elapsed : Math.min(duration, elapsed - tail);
      return { mode: "audition", position: Math.min(position, duration), duration };
    }
    if (!this.started || !this.loopEnabled) return null;
    const position = ((((this.ctx.currentTime - this.loopStartTime) % duration) + duration) % duration);
    return { mode: "playing", position, duration };
  }

  debugSnapshot(): {
    contextState: AudioContextState;
    started: boolean;
    trackCount: number;
    loopEnabled: boolean;
    loopLength: number;
    instances: {
      total: number;
      base: number;
      virtual: number;
      hrtf: number;
      equalpower: number;
      tracksWithInstances: number;
      tracksWithVirtualInstances: number;
      maxPerTrack: number;
    };
    activeRoom: { id: string; decay: number; reverbSend: number; impulseDuration: number } | null;
    performanceMode: AudioPerformanceMode;
  } {
    const instances = this.audioInstanceDebug();
    return {
      contextState: this.ctx.state,
      started: this.started,
      trackCount: this.tracks.length,
      loopEnabled: this.loopEnabled,
      loopLength: this.loopLength,
      instances,
      activeRoom: this.activeRoomDebug,
      performanceMode: this.performanceMode,
    };
  }

  private audioInstanceDebug(): {
    total: number;
    base: number;
    virtual: number;
    hrtf: number;
    equalpower: number;
    tracksWithInstances: number;
    tracksWithVirtualInstances: number;
    maxPerTrack: number;
  } {
    let total = 0;
    let base = 0;
    let virtual = 0;
    let hrtf = 0;
    let equalpower = 0;
    let tracksWithInstances = 0;
    let tracksWithVirtualInstances = 0;
    let maxPerTrack = 0;

    for (const track of this.tracks) {
      const size = track.instances.size;
      if (size > 0) tracksWithInstances++;
      maxPerTrack = Math.max(maxPerTrack, size);
      total += size;
      let trackVirtual = 0;
      for (const [id, inst] of track.instances) {
        if (id === "base") base++;
        else {
          virtual++;
          trackVirtual++;
        }
        if (inst.panner.panningModel === "HRTF") hrtf++;
        else equalpower++;
      }
      if (trackVirtual > 0) tracksWithVirtualInstances++;
    }

    return { total, base, virtual, hrtf, equalpower, tracksWithInstances, tracksWithVirtualInstances, maxPerTrack };
  }

  private playSegment(t: LiveTrack, when: number, offset: number, duration: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.connect(t.gain);
    src.start(when, offset, duration);
  }

  private shouldRunTimedUpdate(lastUpdate: number, interval: number, at: number): boolean {
    return interval <= 0 || at - lastUpdate >= interval;
  }

  private shouldUpdateListenerParams(position: THREE.Vector3, forward: THREE.Vector3, at: number): boolean {
    if (this.listenerUpdateInterval <= 0) return true;
    if (at - this.lastListenerParamUpdate >= this.listenerUpdateInterval) return true;
    if (position.distanceToSquared(this.lastListenerParamPosition) > 0.08 * 0.08) return true;
    return forward.distanceToSquared(this.lastListenerParamForward) > 0.035 * 0.035;
  }

  private setContinuousParam(param: AudioParam, value: number, at: number): void {
    if (this.performanceMode === "reduced") {
      param.setTargetAtTime(value, at, 0.018);
    } else {
      param.setValueAtTime(value, at);
    }
  }

  // Called every frame from the camera. Drives the 3D spatialization.
  updateListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, map?: CompositionMap): void {
    const l = this.ctx.listener;
    const at = this.ctx.currentTime;
    this.map = map ?? this.map;
    this.listenerPosition.copy(position);
    if (this.shouldUpdateListenerParams(position, forward, at)) {
      if (l.positionX) {
        this.setContinuousParam(l.positionX, position.x, at);
        this.setContinuousParam(l.positionY, position.y, at);
        this.setContinuousParam(l.positionZ, position.z, at);
        this.setContinuousParam(l.forwardX, forward.x, at);
        this.setContinuousParam(l.forwardY, forward.y, at);
        this.setContinuousParam(l.forwardZ, forward.z, at);
        this.setContinuousParam(l.upX, up.x, at);
        this.setContinuousParam(l.upY, up.y, at);
        this.setContinuousParam(l.upZ, up.z, at);
      } else {
        // Deprecated fallback for older Safari.
        (l as any).setPosition(position.x, position.y, position.z);
        (l as any).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
      this.lastListenerParamPosition.copy(position);
      this.lastListenerParamForward.copy(forward);
      this.lastListenerParamUpdate = at;
    }

    if (this.shouldRunTimedUpdate(this.lastAcousticsUpdate, this.acousticsUpdateInterval, at)) {
      this.lastAcousticsUpdate = at;
      for (const t of this.tracks) this.updateTrackAcoustics(t, at);
    }
    if (this.shouldRunTimedUpdate(this.lastRoomUpdate, this.roomUpdateInterval, at)) {
      this.lastRoomUpdate = at;
      this.updateRoomAcoustics(at);
    }
  }

  // --- Live edits: mutate a playing track without restarting anything. ---

  setVolume(id: string, volume: number): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, volume };
    // Ramp to avoid clicks.
    t.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  setMinVolume(id: string, minVolume: number): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, minVolume };
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  setPosition(id: string, position: [number, number, number]): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, position };
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  setFalloff(id: string, f: { refDistance?: number; maxDistance?: number; rolloff?: number }): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, ...f };
    for (const instance of t.instances.values()) {
      if (f.refDistance !== undefined) instance.panner.refDistance = f.refDistance;
      if (f.maxDistance !== undefined) instance.panner.maxDistance = f.maxDistance;
    }
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  // Rebuild one stem's loop buffer after a sub-loop edit and restart just that
  // source, phase-aligned to the running loop. Loop-region changes alter the
  // buffer contents, so (like updateLoopSettings) the source must be recreated.
  setTrackLoop(id: string, loop: { loopStart?: number | null; loopEnd?: number | null; loopRepeat?: boolean }): void {
    const t = this.find(id);
    if (!t) return;
    const next = { ...t.def };
    if ("loopStart" in loop) next.loopStart = loop.loopStart ?? undefined;
    if ("loopEnd" in loop) next.loopEnd = loop.loopEnd ?? undefined;
    if ("loopRepeat" in loop) next.loopRepeat = loop.loopRepeat;
    t.def = next;
    t.buffer = this.prepareLoopBuffer(t.originalBuffer, t.def);
    if (!this.started) return;
    try {
      t.source?.stop();
    } catch {
      /* already stopped */
    }
    t.source?.disconnect();
    t.source = undefined;
    const when = this.ctx.currentTime + 0.04;
    this.startSource(t, when, this.loopPhase(t, when));
  }

  // Shift a stem earlier/later within the loop (M7.1). The offset is a start
  // phase, not a buffer edit, so we just restart this one source aligned to the
  // running loop — no buffer rebuild and no effect on the other stems.
  setTrackOffset(id: string, offset: { offsetBeats?: number; offsetFineBeats?: number }): void {
    const t = this.find(id);
    if (!t) return;
    const next = { ...t.def };
    if ("offsetBeats" in offset) next.offsetBeats = offset.offsetBeats || undefined;
    if ("offsetFineBeats" in offset) next.offsetFineBeats = offset.offsetFineBeats || undefined;
    t.def = next;
    if (!this.started) return;
    try {
      t.source?.stop();
    } catch {
      /* already stopped */
    }
    t.source?.disconnect();
    t.source = undefined;
    const when = this.ctx.currentTime + 0.04;
    this.startSource(t, when, this.loopPhase(t, when));
  }

  // Downsampled peak envelope of a stem's decoded source audio plus its
  // duration, for drawing the stem loop meter. Cached per track id.
  trackPeaks(id: string, bins: number): { peaks: Float32Array; duration: number } | null {
    const t = this.find(id);
    if (!t) return null;
    const buffer = t.originalBuffer;
    const n = Math.max(1, Math.floor(bins));
    const cached = this.peakCache.get(id);
    if (cached && cached.bins === n) return { peaks: cached.peaks, duration: buffer.duration };
    const peaks = new Float32Array(n);
    const frames = buffer.length;
    const per = frames / n;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let b = 0; b < n; b++) {
        const start = Math.floor(b * per);
        const end = Math.min(frames, Math.floor((b + 1) * per));
        let peak = 0;
        for (let i = start; i < end; i++) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
        if (peak > peaks[b]) peaks[b] = peak;
      }
    }
    this.peakCache.set(id, { bins: n, peaks });
    return { peaks, duration: buffer.duration };
  }

  setDirectivity(id: string, directivity: StemDirectivity | undefined): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, directivity };
    for (const instance of t.instances.values()) {
      this.applyPannerDirectivity(instance.panner, directivity);
    }
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  setTrackShape(id: string, stemShape: StemShape | undefined): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, stemShape };
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  // Stop everything and release the audio context. The engine is dead after.
  dispose(): void {
    clearTimeout(this.auditionTimer);
    this.auditionStartTime = null;
    this.stopAndDisconnectTracks();
    this.dryBus.disconnect();
    this.roomReverbSend.disconnect();
    this.roomConvolver.disconnect();
    this.roomReverbWet.disconnect();
    this.master.disconnect();
    this.started = false;
    void this.ctx.close();
  }

  // Stop and tear down a playing track.
  removeTrack(id: string): void {
    const i = this.tracks.findIndex((t) => t.def.id === id);
    if (i < 0) return;
    const t = this.tracks[i];
    try {
      t.source?.stop();
    } catch {
      /* already stopped */
    }
    t.source?.disconnect();
    t.gain.disconnect();
    t.analyser.disconnect();
    this.disconnectTrackInstances(t);
    this.tracks.splice(i, 1);
    this.peakCache.delete(id);
  }

  // Current audio level (0..1) for a track, for visual reactivity.
  level(id: string): number {
    const t = this.find(id);
    return t ? this.computeLevel(t) : 0;
  }

  // Batch level read for all live tracks — one AnalyserNode sweep per frame
  // instead of one per TrackMarker instance.
  getLevels(): Map<string, number> {
    const out = new Map<string, number>();
    for (const t of this.tracks) out.set(t.def.id, this.computeLevel(t));
    return out;
  }

  private computeLevel(t: LiveTrack): number {
    t.analyser.getByteTimeDomainData(t.levelData);
    let sum = 0;
    for (let i = 0; i < t.levelData.length; i++) {
      const v = (t.levelData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / t.levelData.length) * 3);
  }

  private find(id: string): LiveTrack | undefined {
    return this.tracks.find((x) => x.def.id === id);
  }

  private stopAndDisconnectTracks(): void {
    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.gain.disconnect();
      t.analyser.disconnect();
      this.disconnectTrackInstances(t);
    }
    this.tracks = [];
  }

  private updateTrackAcoustics(t: LiveTrack, at: number): void {
    const maxVolume = Math.max(0, t.def.volume ?? 1);
    const minVolume = Math.min(Math.max(0, t.def.minVolume ?? 0), maxVolume);
    const audibleInstances = this.audibleTrackInstances(t.def);
    this.syncTrackInstances(t, audibleInstances, at);
    const stackGain = 1 / Math.sqrt(Math.max(1, audibleInstances.length));
    for (const audible of audibleInstances) {
      const instance = t.instances.get(audible.id);
      if (!instance) continue;
      // Shaped stems use the closest point on the shape as the effective panner
      // position so that falloff is computed from the right distance.
      const effectivePos = this.effectivePannerPosition(t.def, audible.position);
      this.setPannerPosition(instance.panner, effectivePos);
      this.setPannerOrientation(instance.panner, audible.direction);
      const level = this.distanceLevel(t.def, effectivePos, minVolume, maxVolume);
      const ratio = maxVolume > 0 ? (level / maxVolume) * stackGain : 0;
      this.setContinuousParam(instance.distanceGain.gain, ratio, at);
      this.updateShapeGain(instance, t.def.stemShape, effectivePos, at);
      this.updateOcclusion(instance, audible.position, at);
    }
  }

  // Returns the closest point on the stem's spatial shape to the listener.
  // For point sources (orb / absent) this is just the tile centre.
  private effectivePannerPosition(def: TrackDef, tilePosition: [number, number, number]): [number, number, number] {
    const shape = def.stemShape;
    if (shape?.kind === "pillar") {
      // Track listener elevation so horizontal XZ distance is all that drives falloff.
      return [tilePosition[0], this.listenerPosition.y, tilePosition[2]];
    }
    if (shape?.kind === "river") {
      // The segment runs from the track's base position to shape.end. Tile copies
      // apply an offset to the base; apply the same offset to the end so the
      // segment rotates/translates with the tile.
      const [bx, by, bz] = tilePosition;
      const ox = tilePosition[0] - def.position[0];
      const oy = tilePosition[1] - def.position[1];
      const oz = tilePosition[2] - def.position[2];
      const ex = shape.end[0] + ox, ey = shape.end[1] + oy, ez = shape.end[2] + oz;
      const sdx = ex - bx, sdz = ez - bz;
      const lenSq = sdx * sdx + sdz * sdz;
      const lx = this.listenerPosition.x, lz = this.listenerPosition.z;
      const t = lenSq > 0 ? THREE.MathUtils.clamp(((lx - bx) * sdx + (lz - bz) * sdz) / lenSq, 0, 1) : 0;
      return [bx + t * sdx, by + t * (ey - by), bz + t * sdz];
    }
    if (shape?.kind === "wall") {
      // Wall centre is the tile position. The panel extends along the tangent axis
      // (perpendicular to facing). Project the listener's XZ offset onto that
      // tangent, clamp to ±width/2, then resolve back to world XZ. Y tracks the
      // listener so the panner reads horizontal distance to the panel.
      const [fx, fz] = shape.facing;
      const tx = -fz, tz = fx; // tangent = perpendicular to facing in XZ
      const dx = this.listenerPosition.x - tilePosition[0];
      const dz = this.listenerPosition.z - tilePosition[2];
      const along = dx * tx + dz * tz;
      const clamped = THREE.MathUtils.clamp(along, -shape.width / 2, shape.width / 2);
      return [
        tilePosition[0] + clamped * tx,
        this.listenerPosition.y,
        tilePosition[2] + clamped * tz,
      ];
    }
    return tilePosition;
  }

  // Applies one-sided emission gain for wall shapes.
  private updateShapeGain(instance: LiveTrackInstance, shape: StemShape | undefined, effectivePos: [number, number, number], at: number): void {
    if (shape?.kind !== "wall") {
      instance.shapeGain.gain.setTargetAtTime(1, at, 0.05);
      return;
    }
    // Positive dot = listener is in front of the wall (loud side).
    const [fx, fz] = shape.facing;
    const dx = this.listenerPosition.x - effectivePos[0];
    const dz = this.listenerPosition.z - effectivePos[2];
    const dot = dx * fx + dz * fz;
    const backGain = shape.emitBothSides ? 0.15 : 0.04;
    // Smooth S-curve over a ±1 unit transition zone around the panel surface.
    const t = THREE.MathUtils.clamp((dot + 1) / 2, 0, 1);
    const gain = THREE.MathUtils.lerp(backGain, 1.0, t * t * (3 - 2 * t));
    instance.shapeGain.gain.setTargetAtTime(gain, at, 0.05);
  }

  private updateOcclusion(instance: LiveTrackInstance, position: [number, number, number], at: number): void {
    const from: [number, number] = [this.listenerPosition.x, this.listenerPosition.z];
    const target: [number, number] = [position[0], position[2]];
    const obstructions = this.map
      ? roomWallObstructionCount(this.map, from, target) + tunnelObstructionCount(this.map, from, target) + wallObstructionCount(this.map, from, target)
      : 0;
    const strength = Math.min(1, obstructions);
    const gain = THREE.MathUtils.lerp(1, 0.05, strength);
    const frequency = THREE.MathUtils.lerp(22000, 260, Math.pow(strength, 0.78));
    instance.occlusionGain.gain.setTargetAtTime(gain, at, 0.12);
    instance.occlusionFilter.frequency.setTargetAtTime(frequency, at, 0.12);
  }

  private updateRoomAcoustics(at: number): void {
    const room = this.map ? containingRoom(this.map, [this.listenerPosition.x, this.listenerPosition.z]) : null;
    if (!room) {
      this.activeRoomAcousticsKey = null;
      this.activeRoomDebug = null;
      this.roomReverbSend.gain.setTargetAtTime(0, at, 0.18);
      return;
    }

    const profile = this.roomAcousticProfile(room);
    const key = `${room.id}:${room.width.toFixed(2)}:${room.depth.toFixed(2)}:${room.height.toFixed(2)}`;
    if (this.activeRoomAcousticsKey !== key) {
      this.activeRoomAcousticsKey = key;
      this.roomConvolver.buffer = this.roomImpulse(profile.decay);
    }
    this.activeRoomDebug = {
      id: room.id,
      decay: profile.decay,
      reverbSend: profile.reverbSend,
      impulseDuration: this.roomConvolver.buffer?.duration ?? 0,
    };

    this.roomReverbSend.gain.setTargetAtTime(profile.reverbSend, at, 0.18);
  }

  private roomAcousticProfile(room: MapRoom): { decay: number; reverbSend: number } {
    const volume = room.width * room.depth * room.height;
    return {
      decay: THREE.MathUtils.clamp(0.28 + volume / 850, 0.35, 3.2),
      reverbSend: THREE.MathUtils.clamp(0.16 + volume / 2600, 0.18, 0.58),
    };
  }

  private roomImpulse(decay: number): AudioBuffer {
    const duration = Math.max(0.2, decay);
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const tail = Math.pow(1 - t, 2.1);
        data[i] = (Math.random() * 2 - 1) * tail;
      }
      for (const [ms, gain] of [
        [32, 0.6],
        [61, 0.42],
        [109, 0.26],
      ] as Array<[number, number]>) {
        const index = Math.floor((ms / 1000) * this.ctx.sampleRate);
        if (index < data.length) data[index] += (ch === 0 ? 1 : -1) * gain;
      }
    }
    return impulse;
  }

  private audibleTrackInstances(def: TrackDef): AudibleTrackInstance[] {
    const base = def.position;
    const direction = def.directivity?.direction ?? [0, -1];
    if (!this.map) return [{ id: "base", position: base, direction }];
    const previews = tiledMapTransforms(this.map, [this.listenerPosition.x, this.listenerPosition.z], this.tileAudioPreviewRadius);
    if (!previews.length) return [{ id: "base", position: base, direction }];

    const candidates: AudibleTrackInstance[] = [{ id: "base", position: base, direction }];
    for (const preview of previews) {
      const [x, z] = transformLoopPoint(preview, [base[0], base[2]]);
      const c = Math.cos(preview.rotation);
      const s = Math.sin(preview.rotation);
      candidates.push({
        id: preview.id,
        position: [x, base[1] + loopPreviewElevationOffset(this.map, preview), z],
        direction: [direction[0] * c + direction[1] * s, -direction[0] * s + direction[1] * c],
      });
    }
    const far = Math.max(def.maxDistance ?? 40, def.refDistance ?? 4);
    const audibleDistance = Math.max(far, this.tileAudioPreviewRadius);
    const audibleDistanceSq = audibleDistance * audibleDistance;
    const sorted = candidates.sort((a, b) => this.distanceSqToListener(a.position) - this.distanceSqToListener(b.position));
    const audible = sorted.filter((candidate, index) => index === 0 || this.distanceSqToListener(candidate.position) <= audibleDistanceSq);
    return audible.slice(0, this.maxVirtualAudioInstancesPerTrack);
  }

  private distanceSqToListener([x, y, z]: [number, number, number]): number {
    const dx = this.listenerPosition.x - x;
    const dy = this.listenerPosition.y - y;
    const dz = this.listenerPosition.z - z;
    return dx * dx + dy * dy + dz * dz;
  }

  private distanceLevel(def: TrackDef, position: [number, number, number], minVolume: number, maxVolume: number): number {
    const near = def.refDistance ?? 4;
    const far = Math.max(def.maxDistance ?? 40, near + 0.001);
    const [x, y, z] = position;
    const distance = this.listenerPosition.distanceTo(this.trackPosition.set(x, y, z));
    if (distance <= near) return maxVolume;
    if (distance >= far) return minVolume;

    const t = (distance - near) / (far - near);
    const k = Math.max(def.rolloff ?? 1, 0.001) * 2.5;
    const shaped = (1 - Math.exp(-t * k)) / (1 - Math.exp(-k));
    return THREE.MathUtils.lerp(maxVolume, minVolume, shaped);
  }

  private setPannerPosition(p: PannerNode, [x, y, z]: [number, number, number]) {
    const at = this.ctx.currentTime;
    if (p.positionX) {
      this.setContinuousParam(p.positionX, x, at);
      this.setContinuousParam(p.positionY, y, at);
      this.setContinuousParam(p.positionZ, z, at);
    } else {
      (p as any).setPosition(x, y, z);
    }
  }

  private setPannerOrientation(p: PannerNode, [x, z]: [number, number]) {
    const at = this.ctx.currentTime;
    if (p.orientationX) {
      this.setContinuousParam(p.orientationX, x, at);
      this.setContinuousParam(p.orientationY, 0, at);
      this.setContinuousParam(p.orientationZ, z, at);
    } else {
      (p as any).setOrientation(x, 0, z);
    }
  }

  private applyPannerDirectivity(panner: PannerNode, directivity: StemDirectivity | undefined): void {
    panner.coneInnerAngle = directivity?.width ?? 360;
    panner.coneOuterAngle = directivity ? Math.min(360, directivity.width + directivity.dispersion) : 360;
    panner.coneOuterGain = directivity?.outsideGain ?? 1;
  }

  private syncTrackInstances(t: LiveTrack, audibleInstances: AudibleTrackInstance[], at: number): void {
    const desired = new Set(audibleInstances.map((instance) => instance.id));
    for (const [id, instance] of t.instances) {
      if (desired.has(id)) continue;
      instance.distanceGain.gain.setTargetAtTime(0, at, 0.04);
      t.instances.delete(id);
      setTimeout(() => {
        this.disconnectTrackInstance(t, instance);
      }, 80);
    }

    for (const audible of audibleInstances) {
      if (!t.instances.has(audible.id)) {
        const instance = this.createTrackInstance(t, audible);
        instance.distanceGain.gain.setValueAtTime(0, at);
        t.instances.set(audible.id, instance);
      }
    }
  }

  private createTrackInstance(t: LiveTrack, audible: AudibleTrackInstance): LiveTrackInstance {
    const panner = this.ctx.createPanner();
    panner.panningModel = this.panningModel;
    panner.distanceModel = "inverse";
    panner.refDistance = t.def.refDistance ?? 4;
    panner.maxDistance = t.def.maxDistance ?? 40;
    panner.rolloffFactor = 0;
    this.setPannerPosition(panner, audible.position);
    this.setPannerOrientation(panner, audible.direction);
    this.applyPannerDirectivity(panner, t.def.directivity);

    const distanceGain = this.ctx.createGain();
    distanceGain.gain.value = 0;
    const shapeGain = this.ctx.createGain();
    shapeGain.gain.value = 1;
    const occlusionGain = this.ctx.createGain();
    occlusionGain.gain.value = 1;
    const occlusionFilter = this.ctx.createBiquadFilter();
    occlusionFilter.type = "lowpass";
    occlusionFilter.frequency.value = 22000;
    occlusionFilter.Q.value = 0.4;

    t.gain.connect(distanceGain);
    distanceGain.connect(shapeGain);
    shapeGain.connect(occlusionFilter);
    occlusionFilter.connect(occlusionGain);
    occlusionGain.connect(panner);
    panner.connect(this.dryBus);

    return { id: audible.id, panner, distanceGain, shapeGain, occlusionGain, occlusionFilter };
  }

  private disconnectTrackInstances(t: LiveTrack): void {
    for (const instance of t.instances.values()) this.disconnectTrackInstance(t, instance);
    t.instances.clear();
  }

  private disconnectTrackInstance(t: LiveTrack, instance: LiveTrackInstance): void {
    try {
      t.gain.disconnect(instance.distanceGain);
    } catch {
      /* already disconnected */
    }
    instance.distanceGain.disconnect();
    instance.shapeGain.disconnect();
    instance.occlusionFilter.disconnect();
    instance.occlusionGain.disconnect();
    instance.panner.disconnect();
  }
}
