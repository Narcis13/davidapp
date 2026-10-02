// The Fablecut mark: a rounded tile with an "F" built from three bars and a playhead dot.
asset({
  title: 'Fablecut mark',
  description: 'The studio\'s logo mark, drawn in code: a rounded tile, an F made of bars that slide out one after another, and a dot that lands like a playhead. Scales to any box; hold it at the end for a still.',
  tags: ['logo', 'brand', 'mark', 'identity'],
  duration: 1.6,
  uses: ['easing', 'spring'],
  params: {
    tile: { type: 'color', default: '#ffd166' },
    ink: { type: 'color', default: '#0b0b12' },
    dot: { type: 'color', default: '#ff5c8a' },
    radius: { type: 'number', default: 0.24, min: 0, max: 0.5, step: 0.01, description: 'Corner radius as a fraction of the tile' },
    scale: { type: 'number', default: 0.8, min: 0.1, max: 1, step: 0.01, description: 'Tile size as a fraction of the box' },
    animate: { type: 'boolean', default: true },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const spring = f.use('spring', { stiffness: 220, damping: 13 });
    const t = p.animate ? f.t : 99;
    const s = Math.min(f.width, f.height) * p.scale;
    const pop = spring(t);
    ctx.translate(f.width / 2, f.height / 2);
    ctx.scale(pop, pop);
    ctx.translate(-s / 2, -s / 2);
    ctx.fillStyle = p.tile;
    ctx.beginPath(); ctx.roundRect(0, 0, s, s, s * p.radius); ctx.fill();
    // the F: a stem and two arms, each growing from the stem
    const u = s / 16;
    const bar = (x, y, w, h, delay, vertical) => {
      const k = E.outExpo(lib.clamp01((t - delay) / 0.45));
      if (k <= 0) return;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      if (vertical) ctx.roundRect(x, y + h * (1 - k), w, h * k, u * 0.5);
      else ctx.roundRect(x, y, w * k, h, u * 0.5);
      ctx.fill();
    };
    bar(4.2 * u, 3.5 * u, 2.4 * u, 9 * u, 0.15, true);
    bar(4.2 * u, 3.5 * u, 7.6 * u, 2.4 * u, 0.35, false);
    bar(4.2 * u, 7.2 * u, 5.6 * u, 2.2 * u, 0.5, false);
    const d = spring(t - 0.75);
    if (d > 0) {
      ctx.fillStyle = p.dot;
      ctx.beginPath(); ctx.arc(11.4 * u, 11.4 * u, 1.45 * u * d, 0, lib.TAU); ctx.fill();
    }
  },
});
