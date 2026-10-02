// Deterministic value noise for organic motion. noise(seed) returns a function of 1–3 coordinates
// with output in [-1, 1]; fbm sums octaves.

const hash = (seed, x, y, z) => {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mixv = (a, b, t) => a + (b - a) * t;

export function noise(seed = 1) {
  const s = seed >>> 0;
  return (x = 0, y = 0, z = 0) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const c = (dx, dy, dz) => hash(s, xi + dx, yi + dy, zi + dz);
    const x00 = mixv(c(0, 0, 0), c(1, 0, 0), u), x10 = mixv(c(0, 1, 0), c(1, 1, 0), u);
    const x01 = mixv(c(0, 0, 1), c(1, 0, 1), u), x11 = mixv(c(0, 1, 1), c(1, 1, 1), u);
    return mixv(mixv(x00, x10, v), mixv(x01, x11, v), w) * 2 - 1;
  };
}

export function fbm(seed = 1, octaves = 4, gain = 0.5, lacunarity = 2) {
  const n = noise(seed);
  return (x = 0, y = 0, z = 0) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n(x * freq + i * 17.13, y * freq + i * 31.7, z * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  };
}
