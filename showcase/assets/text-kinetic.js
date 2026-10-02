// Kinetic typography: one word at a time, as large as the box allows, slammed in on a spring.
asset({
  title: 'Kinetic words',
  description: 'Kinetic typography: words appear one at a time, each scaled to fill the box, slamming in on a spring with a seeded tilt and alternating colours. Set `interval` to the beat length to cut on the music.',
  tags: ['text', 'text-animation', 'kinetic', 'per-word', 'hook', 'beat'],
  duration: 4,
  uses: ['spring', 'easing'],
  params: {
    words: { type: 'array', of: { type: 'string' }, default: ['VIDEOS', 'MADE', 'WITH', 'CODE'], minItems: 1, maxItems: 24 },
    interval: { type: 'number', default: 0.5, min: 0.1, max: 4, step: 0.01, description: 'Seconds per word' },
    font: { type: 'font', default: 'Anton' },
    weight: { type: 'integer', default: 400, min: 100, max: 900, step: 100 },
    colors: { type: 'array', of: { type: 'color' }, default: ['#f4f1ea', '#ffd166', '#ff5c8a'], minItems: 1, maxItems: 6 },
    maxSize: { type: 'number', default: 520, min: 40, max: 1200, step: 1 },
    tilt: { type: 'number', default: 5, min: 0, max: 30, step: 0.5, description: 'Largest tilt in degrees' },
    fill: { type: 'number', default: 0.96, min: 0.3, max: 1, step: 0.01, description: 'Fraction of the box width a word may take' },
    stack: { type: 'boolean', default: false, description: 'Keep earlier words on screen, stacked, instead of replacing them' },
    uppercase: { type: 'boolean', default: true },
    outDur: { type: 'number', default: 0.25, min: 0, max: 2, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const spring = f.use('spring', { stiffness: 260, damping: 15 });
    const E = f.use('easing');
    const box = f.safe;
    const words = p.words.map((w) => (p.uppercase ? w.toUpperCase() : w));
    const layouts = words.map((w) => lib.text.layout(ctx, w, { font: p.font, weight: p.weight, size: p.maxSize, maxWidth: box.width * p.fill, maxHeight: box.height / (p.stack ? words.length : 1.2), fit: true, wrap: 'none', lineHeight: 0.98 }));
    const current = Math.min(words.length - 1, Math.floor(f.t / p.interval));
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const totalH = p.stack ? layouts.reduce((s, L) => s + L.height, 0) : 0;
    let stackY = box.y + (box.height - totalH) / 2;
    for (let i = 0; i < words.length; i++) {
      const L = layouts[i];
      const local = f.t - i * p.interval;
      const y0 = stackY;
      stackY += L.height;
      if (local < 0 || (!p.stack && i !== current)) continue;
      const r = f.rng.fork(i);
      const s = spring(local);
      const angle = lib.deg(r.range(-p.tilt, p.tilt)) * (p.stack ? 0.35 : 1);
      // a replaced word is cut on the beat; the last one (and stacked ones) leave with the block
      const alpha = lib.clamp01(local * 14) * exit;
      const cx = box.x + box.width / 2;
      const cy = p.stack ? y0 + L.height / 2 : box.y + box.height / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy + (1 - exit) * 40);
      ctx.rotate(angle * (2 - Math.min(1, s)));
      const scale = 1.7 - 0.7 * s;
      ctx.scale(scale, scale);
      ctx.fillStyle = p.colors[i % p.colors.length];
      lib.text.fill(ctx, L, -L.width / 2, -L.height / 2);
      ctx.restore();
      // a flash of the accent on impact
      const flash = 1 - E.outCubic(lib.clamp01(local / 0.18));
      if (flash > 0 && !p.stack) {
        const R = Math.max(f.width, f.height) * 0.9;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, lib.color.alpha(p.colors[i % p.colors.length], flash * 0.3 * exit));
        g.addColorStop(1, lib.color.alpha(p.colors[i % p.colors.length], 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
    }
  },
});
