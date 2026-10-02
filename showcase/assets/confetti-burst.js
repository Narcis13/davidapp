// Forked from sparkle-field: the same seeded particles, but thrown outward from a point and
// pulled down by gravity, tumbling as they fall.
asset({
  title: 'Confetti burst',
  description: 'A burst of seeded confetti: pieces fly out from a point, slow down, tumble and fall under gravity, then fade. Forked from sparkle-field; the same seed always throws the same burst. For reveals and end cards.',
  tags: ['particles', 'confetti', 'celebration', 'overlay', 'seeded'],
  duration: 3.5,
  params: {
    count: { type: 'integer', default: 140, min: 1, max: 600 },
    colors: { type: 'array', of: { type: 'color' }, default: ['#ffd166', '#ff5c8a', '#7cf5c0', '#f4f1ea', '#5b6cff'], minItems: 1, maxItems: 6 },
    size: { type: 'number', default: 18, min: 2, max: 80, step: 0.5 },
    originX: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, description: 'Where the burst starts, as a fraction of the width' },
    originY: { type: 'number', default: 0.42, min: 0, max: 1, step: 0.01 },
    power: { type: 'number', default: 0.9, min: 0.1, max: 3, step: 0.05, description: 'Launch speed, in frame heights per second' },
    gravity: { type: 'number', default: 0.55, min: 0, max: 3, step: 0.05 },
    opacity: { type: 'number', default: 0.95, min: 0, max: 1, step: 0.01 },
    outDur: { type: 'number', default: 0.8, min: 0, max: 5, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib, width: w, height: h } = f;
    const t = f.t;
    const fade = p.outDur > 0 ? lib.clamp01((f.duration - t) / p.outDur) : 1;
    for (let i = 0; i < p.count; i++) {
      const r = f.rng.fork(i);
      const angle = r.range(0, lib.TAU), speed = p.power * (0.25 + 0.75 * r()), spin = r.range(-9, 9), phase = r() * lib.TAU;
      const color = r.pick(p.colors), s = p.size * (0.5 + 0.8 * r()), long = 0.5 + r();
      // launch speed bleeds off quickly (air drag), then gravity takes over
      const travel = (1 - Math.exp(-t * 2.6)) / 2.6;
      const x = p.originX * w + Math.cos(angle) * speed * travel * h;
      const y = p.originY * h + Math.sin(angle) * speed * travel * h + 0.5 * p.gravity * t * t * h * 0.5;
      if (y > h + s || x < -s || x > w + s) continue;
      ctx.save();
      ctx.globalAlpha = p.opacity * fade * lib.clamp01(t * 12);
      ctx.translate(x, y);
      ctx.rotate(phase + spin * t);
      // a tumbling piece shows its thin side now and then
      ctx.scale(1, Math.cos(phase + t * (4 + spin * 0.3)));
      ctx.fillStyle = color;
      ctx.fillRect(-s / 2, (-s * long) / 2, s, s * long * 0.6);
      ctx.restore();
    }
  },
});
