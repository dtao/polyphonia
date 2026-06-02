import * as THREE from "three";
import { Composition, TrackDef } from "../composition";
import { createPlaceholderStems } from "./synth";

interface LiveTrack {
  def: TrackDef;
  originalBuffer: AudioBuffer;
  buffer: AudioBuffer;
  panner: PannerNode;
  gain: GainNode;
  distanceGain: GainNode;
  analyser: AnalyserNode;
  source?: AudioBufferSourceNode;
  levelData: Uint8Array<ArrayBuffer>;
}

// Owns the single AudioContext. The golden rule: every stem is scheduled off
// THIS context's clock and started at the SAME time, so they never drift. As
// the listener moves we only change what's *heard*, never restart sources.
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private tracks: LiveTrack[] = [];
  started = false;
  private loopStartTime = 0; // absolute ctx time the composition loop began
  private loopLength = 0; // musical loop length in seconds (0 = loop whole buffer)
  private loopOffset = 0; // shared leading-silence (encoder delay) to skip
  private loopEnabled = true;
  private loopStartOverride: number | undefined;
  private loopEndTrim = 0;
  private loopCrossfade = 0.035;
  private auditionTimer: ReturnType<typeof setTimeout> | undefined;
  private auditionStartTime: number | null = null;
  private auditionDuration = 0;
  private listenerPosition = new THREE.Vector3();
  private trackPosition = new THREE.Vector3();

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
  }

  async load(comp: Composition): Promise<void> {
    // Only synthesize placeholders if some track actually needs them.
    const needsSynth = comp.tracks.some((t) => t.source.kind === "synth");
    const stems = needsSynth ? createPlaceholderStems(this.ctx, comp.bpm, comp.bars ?? 4) : null;

    const loaded: Array<{ def: TrackDef; buffer: AudioBuffer }> = [];
    for (const def of comp.tracks) {
      let buffer: AudioBuffer;
      if (def.source.kind === "file") {
        const res = await fetch(def.source.url);
        buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } else {
        buffer = stems![def.source.preset];
      }

      loaded.push({ def, buffer });
    }

    // Loop bookkeeping. The musical loop length comes from the composition's
    // tempo; the offset skips shared MP3 encoder delay. Buffers with a known
    // musical length are copied into clean loop buffers with a tiny end->start
    // crossfade, which masks residual padding/clicks at the wrap point.
    this.setLoopFields(comp);
    const fileBuffers = loaded.filter((t) => t.def.source.kind === "file").map((t) => t.buffer);
    const detectedOffsets = fileBuffers.map((b) => this.leadingSilence(b)).filter((s) => s > 0.001);
    this.loopOffset = detectedOffsets.length ? Math.min(0.1, Math.min(...detectedOffsets)) : 0;

    for (const { def, buffer } of loaded) {
      this.tracks.push(this.buildTrack(def, buffer, this.prepareLoopBuffer(buffer)));
    }
  }

  private setLoopFields(comp: Pick<Composition, "bpm" | "bars" | "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade">): void {
    this.loopEnabled = comp.loopEnabled ?? true;
    this.loopLength = comp.bars ? comp.bars * 4 * (60 / comp.bpm) : 0;
    this.loopStartOverride = comp.loopStart;
    this.loopEndTrim = comp.loopEndTrim ?? 0;
    this.loopCrossfade = comp.loopCrossfade ?? 0.035;
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

  // Copy a decoded file into an exact musical loop and blend the very end into
  // the start. MP3 decoders can leave tiny leading/trailing padding even after
  // loop points are set; looping a prepared buffer avoids a split-second gap.
  private prepareLoopBuffer(buffer: AudioBuffer): AudioBuffer {
    if (!this.loopEnabled) return buffer;

    const sr = buffer.sampleRate;
    const trimStart = Math.max(0, this.loopStartOverride ?? this.loopOffset);
    const trimEnd = Math.max(0, this.loopEndTrim);
    const maxStartFrame = Math.max(0, buffer.length - 1);
    const startFrame = Math.min(Math.round(trimStart * sr), maxStartFrame);
    const availableFrames = Math.max(1, buffer.length - startFrame - Math.round(trimEnd * sr));
    const targetFrames = this.loopLength ? Math.round(Math.max(0.1, this.loopLength - trimEnd) * sr) : availableFrames;
    const loopFrames = Math.max(1, Math.min(targetFrames, availableFrames));
    const out = this.ctx.createBuffer(buffer.numberOfChannels, loopFrames, sr);

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = out.getChannelData(ch);
      for (let i = 0; i < loopFrames; i++) {
        output[i] = input[startFrame + i] ?? 0;
      }
      this.crossfadeLoop(output, sr);
    }

    return out;
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

  // Build the node graph for one track (no source yet). source -> gain ->
  // distanceGain -> panner -> master; the analyser taps the authored gain for
  // visual reactivity, independent of where the listener is standing.
  private buildTrack(def: TrackDef, originalBuffer: AudioBuffer, buffer = originalBuffer): LiveTrack {
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = def.refDistance ?? 4;
    panner.maxDistance = def.maxDistance ?? 40;
    panner.rolloffFactor = 0;
    this.setPannerPosition(panner, def.position);

    const gain = this.ctx.createGain();
    gain.gain.value = def.volume ?? 1;
    const distanceGain = this.ctx.createGain();
    distanceGain.gain.value = 1;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;

    gain.connect(distanceGain);
    gain.connect(analyser);
    distanceGain.connect(panner);
    panner.connect(this.master);

    const track = { def, originalBuffer, buffer, panner, gain, distanceGain, analyser, levelData: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
    this.updateDistanceGain(track, this.ctx.currentTime);
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

  // Start every stem in lockstep, looped.
  start(): void {
    if (this.started) return;
    this.loopStartTime = this.ctx.currentTime + 0.1;
    for (const t of this.tracks) this.startSource(t, this.loopStartTime, 0);
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
    const t = this.buildTrack(def, buffer, this.prepareLoopBuffer(buffer));
    this.tracks.push(t);
    if (this.started) {
      const when = this.ctx.currentTime + 0.06;
      const len = this.regionLength(buffer);
      const phase = ((((when - this.loopStartTime) % len) + len) % len);
      this.startSource(t, when, phase);
    }
  }

  // Clone an existing live track's decoded audio into a new track definition.
  // This avoids re-fetching uploaded blob URLs and keeps duplicated stems
  // phase-aligned with the rest of the composition.
  duplicateLiveTrack(sourceId: string, def: TrackDef): void {
    const source = this.find(sourceId);
    if (!source) return;
    const t = this.buildTrack(def, source.originalBuffer, this.prepareLoopBuffer(source.originalBuffer));
    this.tracks.push(t);
    if (this.started) {
      const when = this.ctx.currentTime + 0.06;
      const len = this.regionLength(t.buffer);
      const phase = ((((when - this.loopStartTime) % len) + len) % len);
      this.startSource(t, when, phase);
    }
  }

  updateLoopSettings(comp: Pick<Composition, "bpm" | "bars" | "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade">): void {
    clearTimeout(this.auditionTimer);
    this.auditionStartTime = null;
    const wasStarted = this.started;
    const now = this.ctx.currentTime;
    const oldStart = this.loopStartTime;
    this.setLoopFields(comp);

    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.source = undefined;
      t.buffer = this.prepareLoopBuffer(t.originalBuffer);
    }

    if (!wasStarted) return;
    const when = now + 0.04;
    this.loopStartTime = oldStart;
    for (const t of this.tracks) {
      const len = this.regionLength(t.buffer);
      const phase = this.loopEnabled ? ((((when - this.loopStartTime) % len) + len) % len) : Math.min(Math.max(0, when - this.loopStartTime), len - 0.001);
      this.startSource(t, when, phase);
    }
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
        const len = this.regionLength(t.buffer);
        const phase = ((((when - this.loopStartTime) % len) + len) % len);
        this.startSource(t, when, phase);
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

  private playSegment(t: LiveTrack, when: number, offset: number, duration: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.connect(t.gain);
    src.start(when, offset, duration);
  }

  // Called every frame from the camera. Drives the 3D spatialization.
  updateListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    const l = this.ctx.listener;
    const at = this.ctx.currentTime;
    this.listenerPosition.copy(position);
    if (l.positionX) {
      l.positionX.setValueAtTime(position.x, at);
      l.positionY.setValueAtTime(position.y, at);
      l.positionZ.setValueAtTime(position.z, at);
      l.forwardX.setValueAtTime(forward.x, at);
      l.forwardY.setValueAtTime(forward.y, at);
      l.forwardZ.setValueAtTime(forward.z, at);
      l.upX.setValueAtTime(up.x, at);
      l.upY.setValueAtTime(up.y, at);
      l.upZ.setValueAtTime(up.z, at);
    } else {
      // Deprecated fallback for older Safari.
      (l as any).setPosition(position.x, position.y, position.z);
      (l as any).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
    for (const t of this.tracks) this.updateDistanceGain(t, at);
  }

  // --- Live edits: mutate a playing track without restarting anything. ---

  setVolume(id: string, volume: number): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, volume };
    // Ramp to avoid clicks.
    t.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
    this.updateDistanceGain(t, this.ctx.currentTime);
  }

  setMinVolume(id: string, minVolume: number): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, minVolume };
    this.updateDistanceGain(t, this.ctx.currentTime);
  }

  setPosition(id: string, position: [number, number, number]): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, position };
    this.setPannerPosition(t.panner, position);
    this.updateDistanceGain(t, this.ctx.currentTime);
  }

  setFalloff(id: string, f: { refDistance?: number; maxDistance?: number; rolloff?: number }): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, ...f };
    if (f.refDistance !== undefined) t.panner.refDistance = f.refDistance;
    if (f.maxDistance !== undefined) t.panner.maxDistance = f.maxDistance;
    this.updateDistanceGain(t, this.ctx.currentTime);
  }

  // Stop everything and release the audio context. The engine is dead after.
  dispose(): void {
    clearTimeout(this.auditionTimer);
    this.auditionStartTime = null;
    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.gain.disconnect();
      t.distanceGain.disconnect();
      t.panner.disconnect();
      t.analyser.disconnect();
    }
    this.tracks = [];
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
    t.distanceGain.disconnect();
    t.panner.disconnect();
    t.analyser.disconnect();
    this.tracks.splice(i, 1);
  }

  // Current audio level (0..1) for a track, for visual reactivity.
  level(id: string): number {
    const t = this.find(id);
    if (!t) return 0;
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

  private updateDistanceGain(t: LiveTrack, at: number): void {
    const maxVolume = Math.max(0, t.def.volume ?? 1);
    const minVolume = Math.min(Math.max(0, t.def.minVolume ?? 0), maxVolume);
    const level = this.distanceLevel(t.def, minVolume, maxVolume);
    const ratio = maxVolume > 0 ? level / maxVolume : 0;
    t.distanceGain.gain.setValueAtTime(ratio, at);
  }

  private distanceLevel(def: TrackDef, minVolume: number, maxVolume: number): number {
    const near = def.refDistance ?? 4;
    const far = Math.max(def.maxDistance ?? 40, near + 0.001);
    const [x, y, z] = def.position;
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
      p.positionX.setValueAtTime(x, at);
      p.positionY.setValueAtTime(y, at);
      p.positionZ.setValueAtTime(z, at);
    } else {
      (p as any).setPosition(x, y, z);
    }
  }
}
