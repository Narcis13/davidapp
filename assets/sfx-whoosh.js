// Transition whoosh: noise through a filter that opens and closes.
asset({
  kind: 'audio',
  title: 'Whoosh',
  description: 'A transition whoosh: filtered noise that swells and falls away, peaking part-way through. Put one under a scene change.',
  tags: ['audio', 'sfx', 'transition', 'whoosh', 'one-shot'],
  duration: 0.8,
  params: {
    peak: { type: 'number', default: 0.6, min: 0.1, max: 0.9, step: 0.01, description: 'Where the swell peaks, as a fraction of the length' },
    brightness: { type: 'number', default: 3200, min: 400, max: 10000, step: 50, description: 'Filter cutoff at the peak, in Hz' },
    gain: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const A = f.lib.audio;
    const n = Math.round(f.duration * f.sampleRate);
    const L = A.buffer(f.duration), R = A.buffer(f.duration);
    let yl = 0, yr = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      // a skewed bell: rise to the peak, then fall
      const env = u < p.peak ? (u / p.peak) ** 2 : ((1 - u) / (1 - p.peak)) ** 1.5;
      const a = 1 - Math.exp((-2 * Math.PI * (200 + p.brightness * env)) / f.sampleRate);
      yl += a * ((f.rng() * 2 - 1) - yl);
      yr += a * ((f.rng() * 2 - 1) - yr);
      L[i] = yl * env * p.gain * 2.2;
      R[i] = yr * env * p.gain * 2.2;
    }
    return { left: A.highpass(L, 180), right: A.highpass(R, 180) };
  },
});
