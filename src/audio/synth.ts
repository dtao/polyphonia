// Procedural placeholder stems. These render short looping AudioBuffers so the
// whole experience works with zero audio assets. They share one bpm/bar grid so
// they sound like a single coherent composition once you swap them for real
// stems, the spatial + sync machinery is identical.

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type Note = { beat: number; dur: number; midi: number; gain: number };

// Waveforms take a phase in cycles (f * t) and return -1..1.
const sine = (p: number) => Math.sin(2 * Math.PI * p);
const triangle = (p: number) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
const saw = (p: number) => 2 * (p - Math.floor(p + 0.5));

type Env = (t: number, dur: number) => number;
// Plucked: quick attack, exponential decay.
const pluck = (tau: number): Env => (t) => Math.exp(-t / tau) * (t < 0.005 ? t / 0.005 : 1);
// Sustained: soft attack and release.
const pad: Env = (t, dur) => {
  const a = 0.08, r = 0.15;
  if (t < a) return t / a;
  if (t > dur - r) return Math.max(0, (dur - t) / r);
  return 1;
};

function renderNotes(
  data: Float32Array,
  sr: number,
  bpm: number,
  notes: Note[],
  wave: (p: number) => number,
  env: Env,
) {
  const beatSec = 60 / bpm;
  for (const n of notes) {
    const f = midiToFreq(n.midi);
    const startSample = Math.floor(n.beat * beatSec * sr);
    const durSec = n.dur * beatSec;
    const len = Math.floor(durSec * sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const idx = startSample + i;
      if (idx >= data.length) break;
      data[idx] += wave(f * t) * env(t, durSec) * n.gain;
    }
  }
}

// Am - F - C - G, one bar each (4 bars total).
const ROOTS = [45, 41, 48, 43]; // A2, F2, C3, G2
const CHORDS = [
  [57, 60, 64], // Am: A C E
  [53, 57, 60], // F:  F A C
  [60, 64, 67], // C:  C E G
  [55, 59, 62], // G:  G B D
];

function buildBuffer(ctx: BaseAudioContext, bpm: number, bars: number, fill: (data: Float32Array, sr: number) => void) {
  const sr = ctx.sampleRate;
  const loopSec = bars * 4 * (60 / bpm);
  const buf = ctx.createBuffer(1, Math.ceil(loopSec * sr), sr);
  const data = buf.getChannelData(0);
  fill(data, sr);
  // Soft clip to keep things clean.
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * 1.2);
  return buf;
}

export function createPlaceholderStems(ctx: BaseAudioContext, bpm: number, bars: number) {
  const bassNotes: Note[] = [];
  const padNotes: Note[] = [];
  const arpNotes: Note[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4;
    const root = ROOTS[bar % ROOTS.length];
    const chord = CHORDS[bar % CHORDS.length];
    // Bass: root on 1 and 3, plus an octave skip.
    bassNotes.push({ beat: b0, dur: 1, midi: root, gain: 0.9 });
    bassNotes.push({ beat: b0 + 1.5, dur: 0.5, midi: root + 12, gain: 0.5 });
    bassNotes.push({ beat: b0 + 2, dur: 1, midi: root, gain: 0.9 });
    bassNotes.push({ beat: b0 + 3.5, dur: 0.5, midi: root + 7, gain: 0.5 });
    // Pad: hold the chord for the whole bar.
    for (const m of chord) padNotes.push({ beat: b0, dur: 4, midi: m + 12, gain: 0.18 });
    // Arp: eighth notes cycling chord tones, up an octave.
    for (let s = 0; s < 8; s++) {
      const m = chord[s % chord.length] + 12;
      arpNotes.push({ beat: b0 + s * 0.5, dur: 0.45, midi: m, gain: 0.35 });
    }
  }

  const bass = buildBuffer(ctx, bpm, bars, (d, sr) => renderNotes(d, sr, bpm, bassNotes, (p) => 0.6 * saw(p) + 0.4 * sine(p), pluck(0.45)));
  const padBuf = buildBuffer(ctx, bpm, bars, (d, sr) => renderNotes(d, sr, bpm, padNotes, (p) => 0.5 * (saw(p) + saw(p * 1.005)), pad));
  const arp = buildBuffer(ctx, bpm, bars, (d, sr) => renderNotes(d, sr, bpm, arpNotes, triangle, pluck(0.18)));
  const drums = buildBuffer(ctx, bpm, bars, (d, sr) => renderDrums(d, sr, bpm, bars));

  return { bass, pad: padBuf, arp, drums };
}

function renderDrums(data: Float32Array, sr: number, bpm: number, bars: number) {
  const beatSec = 60 / bpm;
  const beats = bars * 4;
  for (let beat = 0; beat < beats; beat++) {
    const start = Math.floor(beat * beatSec * sr);
    // Kick on every beat: sine with a fast pitch drop.
    for (let i = 0; i < 0.18 * sr; i++) {
      const t = i / sr;
      const f = 130 * Math.exp(-t * 28) + 45;
      const env = Math.exp(-t * 14);
      const idx = start + i;
      if (idx < data.length) data[idx] += Math.sin(2 * Math.PI * f * t) * env * 0.9;
    }
    // Hi-hat on the off-beat: filtered noise burst.
    const hatStart = Math.floor((beat + 0.5) * beatSec * sr);
    for (let i = 0; i < 0.05 * sr; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 60);
      const idx = hatStart + i;
      if (idx < data.length) data[idx] += (Math.random() * 2 - 1) * env * 0.25;
    }
  }
}
