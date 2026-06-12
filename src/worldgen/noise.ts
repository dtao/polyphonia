// Deterministic value noise for generated environments.
//
// Everything here is built from integer hashing (Math.imul + shifts) and
// basic float arithmetic only — no Math.sin or Math.random — so a published
// composition's terrain reproduces bit-for-bit across browsers and devices.

/** 32-bit integer hash of a seed + 2D lattice coordinate, mapped to [0, 1). */
export function hash2(seed: number, ix: number, iz: number): number {
  let h = (seed | 0) ^ Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iz | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise over a unit lattice, in [0, 1). */
export function valueNoise2(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(seed, ix, iz);
  const b = hash2(seed, ix + 1, iz);
  const c = hash2(seed, ix, iz + 1);
  const d = hash2(seed, ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Fractal (octave-summed) value noise in [-1, 1]-ish range, centered on 0. */
export function fbm2(seed: number, x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise2(seed + i * 101, x * frequency, z * frequency) * 2 - 1) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/** Small deterministic RNG stream (mulberry32) for scatter placement. */
export function rngFromSeed(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
