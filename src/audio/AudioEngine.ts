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

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
  }

  async load(comp: Composition): Promise<void> {
    // Only synthesize placeholders if some track actually needs them.
    const needsSynth = comp.tracks.some((t) => t.source.kind === "synth");
    const stems = needsSynth ? createPlaceholderStems(this.ctx, comp.bpm, comp.bars) : null;

    for (const def of comp.tracks) {
      let buffer: AudioBuffer;
      if (def.source.kind === "file") {
        const res = await fetch(def.source.url);
        buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } else {
        buffer = stems![def.source.preset];
      }

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

      // source -> gain -> panner -> master.  analyser taps the gain for visuals.
      gain.connect(panner);
      gain.connect(analyser);
      panner.connect(this.master);

      this.tracks.push({
        def,
        buffer,
        panner,
        gain,
        analyser,
        levelData: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
      });
    }
  }

  // Start every stem in lockstep, looped.
  start(): void {
    if (this.started) return;
    const startAt = this.ctx.currentTime + 0.1;
    for (const t of this.tracks) {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.loop = true;
      src.connect(t.gain);
      src.start(startAt);
      t.source = src;
    }
    this.started = true;
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
