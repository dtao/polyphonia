import * as THREE from "three";
import { Composition, TrackDef } from "../composition";
import { createPlaceholderStems } from "./synth";

interface LiveTrack {
  def: TrackDef;
  buffer: AudioBuffer;
  panner: PannerNode;
  gain: GainNode;
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

    for (const def of comp.tracks) {
      let buffer: AudioBuffer;
      if (def.source.kind === "file") {
        const res = await fetch(def.source.url);
        buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } else {
        buffer = stems![def.source.preset];
      }

      this.tracks.push(this.buildTrack(def, buffer));
    }

    // Loop bookkeeping (see startSource / loopRegion). The musical loop length
    // comes from the composition's tempo; the offset is the smallest leading
    // silence across file stems — the shared MP3 encoder delay to skip.
    this.loopLength = comp.bars ? comp.bars * 4 * (60 / comp.bpm) : 0;
    const fileBuffers = this.tracks.filter((t) => t.def.source.kind === "file").map((t) => t.buffer);
    this.loopOffset = fileBuffers.length
      ? Math.min(0.1, Math.min(...fileBuffers.map((b) => this.leadingSilence(b))))
      : 0;
  }

  // Seconds of (near-)silence before the first audible sample — i.e. the MP3
  // encoder-delay padding the decoder prepends.
  private leadingSilence(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > 0.005) return i / buffer.sampleRate;
    }
    return 0;
  }

  // The slice of a buffer to loop. If it's longer than the musical length (it
  // has padding), trim to [offset, offset + length]; otherwise loop the whole
  // buffer (loopEnd 0 = end of buffer).
  private loopRegion(buffer: AudioBuffer): { start: number; end: number } {
    const extra = buffer.duration - this.loopLength;
    if (!this.loopLength || extra <= 0.002) return { start: 0, end: 0 };
    const start = Math.min(this.loopOffset, extra);
    return { start, end: Math.min(start + this.loopLength, buffer.duration) };
  }

  // Build the node graph for one track (no source yet). source -> gain ->
  // panner -> master; the analyser taps the gain for visual reactivity.
  private buildTrack(def: TrackDef, buffer: AudioBuffer): LiveTrack {
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = def.refDistance ?? 4;
    panner.maxDistance = def.maxDistance ?? 40;
    panner.rolloffFactor = def.rolloff ?? 1;
    this.setPannerPosition(panner, def.position);

    const gain = this.ctx.createGain();
    gain.gain.value = def.volume ?? 1;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;

    gain.connect(panner);
    gain.connect(analyser);
    panner.connect(this.master);

    return { def, buffer, panner, gain, analyser, levelData: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
  }

  // (Re)create and start a track's looping source. `phase` is how far into the
  // loop region to begin (0 = the region's start), used to drop a new track in
  // aligned with the already-playing loop.
  private startSource(t: LiveTrack, when: number, phase: number): void {
    const { start, end } = this.loopRegion(t.buffer);
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = true;
    src.loopStart = start;
    src.loopEnd = end; // 0 means "end of buffer"
    src.connect(t.gain);
    src.start(when, start + phase);
    t.source = src;
  }

  // Length of a buffer's loop region (the musical length, or the whole buffer).
  private regionLength(buffer: AudioBuffer): number {
    const { start, end } = this.loopRegion(buffer);
    return (end || buffer.duration) - start;
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
    const t = this.buildTrack(def, buffer);
    this.tracks.push(t);
    if (this.started) {
      const when = this.ctx.currentTime + 0.06;
      const len = this.regionLength(buffer);
      const phase = ((((when - this.loopStartTime) % len) + len) % len);
      this.startSource(t, when, phase);
    }
  }

  // Called every frame from the camera. Drives the 3D spatialization.
  updateListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    const l = this.ctx.listener;
    const at = this.ctx.currentTime;
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
  }

  // --- Live edits: mutate a playing track without restarting anything. ---

  setVolume(id: string, volume: number): void {
    const t = this.find(id);
    // Ramp to avoid clicks.
    if (t) t.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  setPosition(id: string, position: [number, number, number]): void {
    const t = this.find(id);
    if (t) this.setPannerPosition(t.panner, position);
  }

  setFalloff(id: string, f: { refDistance?: number; maxDistance?: number; rolloff?: number }): void {
    const t = this.find(id);
    if (!t) return;
    if (f.refDistance !== undefined) t.panner.refDistance = f.refDistance;
    if (f.maxDistance !== undefined) t.panner.maxDistance = f.maxDistance;
    if (f.rolloff !== undefined) t.panner.rolloffFactor = f.rolloff;
  }

  // Stop everything and release the audio context. The engine is dead after.
  dispose(): void {
    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.gain.disconnect();
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
