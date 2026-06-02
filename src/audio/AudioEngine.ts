import * as THREE from "three";
import { Composition, TrackDef } from "../composition";
import { CompositionMap, MapRoom, containingRoom, roomWallObstructionCount } from "../map";
import { createPlaceholderStems } from "./synth";

interface LiveTrack {
  def: TrackDef;
  originalBuffer: AudioBuffer;
  buffer: AudioBuffer;
  panner: PannerNode;
  gain: GainNode;
  distanceGain: GainNode;
  occlusionGain: GainNode;
  occlusionFilter: BiquadFilterNode;
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
  private dryBus: GainNode;
  private roomReverbSend: GainNode;
  private roomConvolver: ConvolverNode;
  private roomReverbWet: GainNode;
  private roomEchoDelay: DelayNode;
  private roomEchoFeedback: GainNode;
  private roomEchoWet: GainNode;
  private tracks: LiveTrack[] = [];
  started = false;
  private loopStartTime = 0; // absolute ctx time the composition loop began
  private loopLength = 0; // musical loop length in seconds (0 = loop whole buffer)
  private loopOffset = 0; // shared leading-silence (encoder delay) to skip
  private loopEnabled = true;
  private loopStartOverride: number | undefined;
  private loopEndTrim = 0;
  private loopCrossfade = 0.035;
  private bpm = 120;
  private auditionTimer: ReturnType<typeof setTimeout> | undefined;
  private auditionStartTime: number | null = null;
  private auditionDuration = 0;
  private listenerPosition = new THREE.Vector3();
  private trackPosition = new THREE.Vector3();
  private map: CompositionMap | null = null;
  private activeRoomAcousticsKey: string | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.dryBus = this.ctx.createGain();
    this.roomReverbSend = this.ctx.createGain();
    this.roomConvolver = this.ctx.createConvolver();
    this.roomReverbWet = this.ctx.createGain();
    this.roomEchoDelay = this.ctx.createDelay(0.8);
    this.roomEchoFeedback = this.ctx.createGain();
    this.roomEchoWet = this.ctx.createGain();

    this.master.gain.value = 0.85;
    this.roomReverbSend.gain.value = 0;
    this.roomReverbWet.gain.value = 0.45;
    this.roomEchoDelay.delayTime.value = 0.12;
    this.roomEchoFeedback.gain.value = 0;
    this.roomEchoWet.gain.value = 0;

    this.dryBus.connect(this.master);
    this.dryBus.connect(this.roomReverbSend);
    this.roomReverbSend.connect(this.roomConvolver);
    this.roomConvolver.connect(this.roomReverbWet);
    this.roomReverbWet.connect(this.master);
    this.dryBus.connect(this.roomEchoDelay);
    this.roomEchoDelay.connect(this.roomEchoWet);
    this.roomEchoWet.connect(this.master);
    this.roomEchoDelay.connect(this.roomEchoFeedback);
    this.roomEchoFeedback.connect(this.roomEchoDelay);
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
    if (this.loopEnabled && !this.loopLength) this.loopLength = this.inferLoopLength(loaded);

    for (const { def, buffer } of loaded) {
      this.tracks.push(this.buildTrack(def, buffer, this.prepareLoopBuffer(buffer)));
    }
  }

  private setLoopFields(comp: Pick<Composition, "bpm" | "bars" | "loopEnabled" | "loopStart" | "loopEndTrim" | "loopCrossfade">): void {
    this.bpm = Math.max(1, comp.bpm || 120);
    this.loopEnabled = comp.loopEnabled ?? true;
    this.loopLength = comp.bars ? comp.bars * 4 * (60 / this.bpm) : 0;
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
  private prepareLoopBuffer(buffer: AudioBuffer): AudioBuffer {
    if (!this.loopEnabled) return buffer;

    const sr = buffer.sampleRate;
    const trimStart = Math.max(0, this.loopStartOverride ?? this.loopOffset);
    const trimEnd = Math.max(0, this.loopEndTrim);
    const maxStartFrame = Math.max(0, buffer.length - 1);
    const startFrame = Math.min(Math.round(trimStart * sr), maxStartFrame);
    const availableFrames = Math.max(1, buffer.length - startFrame - Math.round(trimEnd * sr));
    const targetFrames = this.loopLength ? Math.round(Math.max(0.1, this.loopLength - trimEnd) * sr) : availableFrames;
    const loopFrames = Math.max(1, targetFrames);
    const out = this.ctx.createBuffer(buffer.numberOfChannels, loopFrames, sr);

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = out.getChannelData(ch);
      const copyFrames = Math.min(loopFrames, availableFrames);
      for (let i = 0; i < copyFrames; i++) {
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
    const occlusionGain = this.ctx.createGain();
    occlusionGain.gain.value = 1;
    const occlusionFilter = this.ctx.createBiquadFilter();
    occlusionFilter.type = "lowpass";
    occlusionFilter.frequency.value = 22000;
    occlusionFilter.Q.value = 0.4;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;

    gain.connect(distanceGain);
    gain.connect(analyser);
    distanceGain.connect(occlusionFilter);
    occlusionFilter.connect(occlusionGain);
    occlusionGain.connect(panner);
    panner.connect(this.dryBus);

    const track = { def, originalBuffer, buffer, panner, gain, distanceGain, occlusionGain, occlusionFilter, analyser, levelData: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
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
    if (this.loopEnabled && !this.loopLength) this.loopLength = this.inferLoopLength([{ buffer }]);
    const t = this.buildTrack(def, buffer, this.prepareLoopBuffer(buffer));
    this.tracks.push(t);
    if (this.started) {
      const when = this.ctx.currentTime + 0.06;
      const len = this.regionLength(t.buffer);
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
    if (this.loopEnabled && !this.loopLength) this.loopLength = this.inferLoopLength(this.tracks.map((t) => ({ buffer: t.originalBuffer })));

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
  updateListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, map?: CompositionMap): void {
    const l = this.ctx.listener;
    const at = this.ctx.currentTime;
    this.map = map ?? this.map;
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
    for (const t of this.tracks) this.updateTrackAcoustics(t, at);
    this.updateRoomAcoustics(at);
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
    this.setPannerPosition(t.panner, position);
    this.updateTrackAcoustics(t, this.ctx.currentTime);
  }

  setFalloff(id: string, f: { refDistance?: number; maxDistance?: number; rolloff?: number }): void {
    const t = this.find(id);
    if (!t) return;
    t.def = { ...t.def, ...f };
    if (f.refDistance !== undefined) t.panner.refDistance = f.refDistance;
    if (f.maxDistance !== undefined) t.panner.maxDistance = f.maxDistance;
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
    this.roomEchoDelay.disconnect();
    this.roomEchoFeedback.disconnect();
    this.roomEchoWet.disconnect();
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
    t.occlusionFilter.disconnect();
    t.occlusionGain.disconnect();
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

  private stopAndDisconnectTracks(): void {
    for (const t of this.tracks) {
      try {
        t.source?.stop();
      } catch {
        /* already stopped */
      }
      t.source?.disconnect();
      t.gain.disconnect();
      t.distanceGain.disconnect();
      t.occlusionFilter.disconnect();
      t.occlusionGain.disconnect();
      t.panner.disconnect();
      t.analyser.disconnect();
    }
    this.tracks = [];
  }

  private updateTrackAcoustics(t: LiveTrack, at: number): void {
    const maxVolume = Math.max(0, t.def.volume ?? 1);
    const minVolume = Math.min(Math.max(0, t.def.minVolume ?? 0), maxVolume);
    const level = this.distanceLevel(t.def, minVolume, maxVolume);
    const ratio = maxVolume > 0 ? level / maxVolume : 0;
    t.distanceGain.gain.setValueAtTime(ratio, at);
    this.updateOcclusion(t, at);
  }

  private updateOcclusion(t: LiveTrack, at: number): void {
    const obstructions = this.map
      ? roomWallObstructionCount(this.map, [this.listenerPosition.x, this.listenerPosition.z], [t.def.position[0], t.def.position[2]])
      : 0;
    const strength = Math.min(1, obstructions);
    const gain = THREE.MathUtils.lerp(1, 0.18, strength);
    const frequency = THREE.MathUtils.lerp(22000, 420, strength);
    t.occlusionGain.gain.setTargetAtTime(gain, at, 0.12);
    t.occlusionFilter.frequency.setTargetAtTime(frequency, at, 0.12);
  }

  private updateRoomAcoustics(at: number): void {
    const room = this.map ? containingRoom(this.map, [this.listenerPosition.x, this.listenerPosition.z]) : null;
    if (!room) {
      this.activeRoomAcousticsKey = null;
      this.roomReverbSend.gain.setTargetAtTime(0, at, 0.18);
      this.roomEchoWet.gain.setTargetAtTime(0, at, 0.18);
      this.roomEchoFeedback.gain.setTargetAtTime(0, at, 0.18);
      return;
    }

    const profile = this.roomAcousticProfile(room);
    const key = `${room.id}:${room.width.toFixed(2)}:${room.depth.toFixed(2)}:${room.height.toFixed(2)}`;
    if (this.activeRoomAcousticsKey !== key) {
      this.activeRoomAcousticsKey = key;
      this.roomConvolver.buffer = this.roomImpulse(profile.decay);
    }

    this.roomReverbSend.gain.setTargetAtTime(profile.reverbSend, at, 0.18);
    this.roomEchoDelay.delayTime.setTargetAtTime(profile.echoDelay, at, 0.18);
    this.roomEchoWet.gain.setTargetAtTime(profile.echoWet, at, 0.18);
    this.roomEchoFeedback.gain.setTargetAtTime(profile.echoFeedback, at, 0.18);
  }

  private roomAcousticProfile(room: MapRoom): { decay: number; reverbSend: number; echoDelay: number; echoWet: number; echoFeedback: number } {
    const volume = room.width * room.depth * room.height;
    const span = Math.max(room.width, room.depth);
    return {
      decay: THREE.MathUtils.clamp(0.28 + volume / 850, 0.35, 3.2),
      reverbSend: THREE.MathUtils.clamp(0.16 + volume / 2600, 0.18, 0.58),
      echoDelay: THREE.MathUtils.clamp(span / 88, 0.09, 0.56),
      echoWet: span > 18 ? THREE.MathUtils.clamp((span - 18) / 70, 0, 0.26) : 0,
      echoFeedback: span > 18 ? THREE.MathUtils.clamp((span - 18) / 95, 0, 0.34) : 0,
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
