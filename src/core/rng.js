// Seeded randomness. Assets never see Math.random(): the runtime hands each asset instance an
// rng whose seed comes from the clip seed and the instance's place in the call tree, so the same
// frame always draws the same thing, and the sequence restarts on every frame.

/** FNV-1a over the parts joined as strings → uint32. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const s = parts.join('\u0001');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // final avalanche so nearby seeds diverge
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  // mulberry32
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.seed = seed >>> 0;
  rng.float = next;
  rng.range = (min, max) => min + (max - min) * next();
  rng.int = (min, max) => Math.floor(min + (max - min + 1) * next());
  rng.bool = (p = 0.5) => next() < p;
  rng.pick = (list) => list[Math.floor(next() * list.length)];
  rng.sign = () => (next() < 0.5 ? -1 : 1);
  rng.gauss = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  rng.shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  /** An independent stream for a sub-key (e.g. a particle index or a frame number). */
  rng.fork = (key) => createRng(hashSeed(seed, key));
  return rng;
}
