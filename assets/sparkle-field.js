// Seeded particles: the same seed always scatters the same sparks, which is the point.
asset({
  title: 'Sparkle field',
  description: 'A field of seeded particles that drift upward and twinkle. The layout comes from f.rng, so the same seed always gives the same field. An ambient accent layer for any scene.',
  tags: ['particles', 'ambient', 'overlay', 'seeded', 'loop'],
  params: {
    count: { type: 'integer', default: 90, min: 1, max: 600 },
    colors: { type: 'array', of: { type: 'color' }, default: ['#ffd166', '#ff5c8a', '#7cf5c0', '#f4f1ea'], minItems: 1, maxItems: 6 },
    size: { type: 'number', default: 7, min: 1, max: 60, step: 0.5 },
    speed: { type: 'number', default: 0.05, min: 0, max: 1, step: 0.005, description: 'Rise per second, as a fraction of the frame height' },
    twinkle: { type: 'number', default: 1.4, min: 0, max: 10, step: 0.1 },
    shape: { type: 'enum', options: ['dot', 'plus', 'diamond'], default: 'plus' },
    opacity: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
    inDur: { type: 'number', default: 0.6, min: 0, max: 5, step: 0.01 },
    outDur: { type: 'number', default: 0.6, min: 0, max: 5, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib, width: w, height: h } = f;
    const env = lib.envelope(f.t, f.duration, p.inDur, p.outDur);
    for (let i = 0; i < p.count; i++) {
      const r = f.rng.fork(i);
      const x0 = r(), y0 = r(), depth = 0.35 + 0.65 * r(), phase = r() * lib.TAU, color = r.pick(p.colors);
      const y = lib.mod(y0 - f.t * p.speed * depth, 1);
      const x = x0 + 0.012 * Math.sin(f.t * 0.7 * depth + phase);
      const a = (0.45 + 0.55 * Math.sin(f.t * p.twinkle * (0.6 + depth) + phase)) * env * p.opacity * depth;
      if (a <= 0.01) continue;
      const s = p.size * depth;
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      const px = x * w, py = y * h;
      if (p.shape === 'dot') { ctx.beginPath(); ctx.arc(px, py, s / 2, 0, lib.TAU); ctx.fill(); }
      else if (p.shape === 'plus') { ctx.fillRect(px - s, py - s / 6, s * 2, s / 3); ctx.fillRect(px - s / 6, py - s, s / 3, s * 2); }
      else { ctx.beginPath(); ctx.moveTo(px, py - s); ctx.lineTo(px + s * 0.6, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s * 0.6, py); ctx.closePath(); ctx.fill(); }
    }
  },
});
