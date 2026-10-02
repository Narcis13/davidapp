// The sound of drawing: graphite scratching across paper, or an eraser rubbing it out. Filtered
// noise shaped into strokes (each with its own length, pressure and brightness) plus the grit of
// the paper's tooth, so it sits under a self-drawing doodle or a write-on title.
asset({
  kind: 'audio',
  title: 'Pencil scratch',
  description: 'Synthesized drawing sound: pencil scratching on paper (bright filtered noise in strokes, with crackle from the paper grain) or an eraser rubbing back and forth (lower, rubbery). Stroke rate, brightness and level are parameters; put one under any self-drawing asset.',
  tags: ['audio', 'sfx', 'foley', 'pencil', 'sketch', 'one-shot'],
  duration: 1.5,
  params: {
    mode: { type: 'enum', options: ['pencil', 'eraser'], default: 'pencil' },
    rate: { type: 'number', default: 5, min: 1, max: 16, step: 0.5, description: 'Strokes per second' },
    brightness: { type: 'number', default: 1, min: 0.3, max: 2, step: 0.05 },
    gain: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const A = f.lib.audio;
    const sr = f.sampleRate, n = Math.round(f.duration * sr);
    const L = A.buffer(f.duration), R = A.buffer(f.duration);
    const eraser = p.mode === 'eraser';
    // a stroke plan: start, length, pressure, brightness
    const plan = [];
    for (let t = 0.02; t < f.duration - 0.05;) {
      const len = (eraser ? 0.16 : 0.09) + f.rng() * (eraser ? 0.08 : 0.16);
      plan.push({ t, len, amp: 0.6 + f.rng() * 0.4, bright: 0.8 + f.rng() * 0.4, pan: (f.rng() - 0.5) * 0.4 });
      t += len + (eraser ? 0.015 : 0.03 + f.rng() * 0.05) * (5 / p.rate);
    }
    let lp = 0, lp2 = 0, hp = 0, si = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      while (si < plan.length - 1 && t > plan[si].t + plan[si].len) si++;
      const s = plan[si];
      const u = (t - s.t) / s.len;
      const env = u < 0 || u > 1 ? 0 : Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.25) * s.amp;
      const white = f.rng() * 2 - 1;
      // band-pass: a one-pole low-pass pair minus a slow one
      const hi = (eraser ? 1400 : 5200) * p.brightness * s.bright, lo = eraser ? 220 : 1300;
      const a = 1 - Math.exp((-2 * Math.PI * hi) / sr), c = 1 - Math.exp((-2 * Math.PI * lo) / sr);
      lp += a * (white - lp); lp2 += a * (lp - lp2); hp += c * (lp2 - hp);
      let x = (lp2 - hp) * env * (eraser ? 3.2 : 2.4);
      // paper tooth: sparse clicks while the pencil is down
      if (!eraser && env > 0.2 && f.rng() < 0.004) x += (f.rng() - 0.5) * 0.9 * env;
      if (eraser) x *= 0.75 + 0.25 * Math.sin(t * Math.PI * 2 * 38);
      L[i] = x * p.gain * (1 - Math.max(0, s.pan));
      R[i] = x * p.gain * (1 + Math.min(0, s.pan));
    }
    return { left: A.fade(L, 0.005, 0.05), right: A.fade(R, 0.005, 0.05) };
  },
});
