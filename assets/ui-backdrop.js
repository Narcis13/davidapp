// The screen behind the controls of an interactive composition: the theme's background with a soft vertical gradient,
// two large glows of the accents drifting slowly (on the session clock, so they keep moving while a scene holds for
// input), an optional faint grid and a vignette that keeps the eye in the middle. Plain fills and gradients only.
//
// Usage. The bottom track of a game or quiz, for the whole timeline; every ui-* control reads well on it:
//   { "id": "bg", "asset": "ui-backdrop", "start": 0, "duration": 30, "params": { "style": "grid" } }
// Under footage or a picture, put it below and give the picture item a lower opacity, or leave it out.

asset({
  title: 'UI backdrop',
  description: 'A full-frame background for interactive compositions and app-like scenes: the theme\'s background with a soft gradient, two large accent glows that drift slowly on the session clock (f.ui.now, so they keep moving while a scene waits for input), an optional faint grid and a vignette. Cheap to draw (a few gradients), the same in every format. Put it under ui-button, ui-card, ui-menu and the other ui-* controls. Takes a theme.',
  tags: ['ui', 'interactive', 'background', 'backdrop', 'game', 'app'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    style: { type: 'enum', options: ['glow', 'grid', 'plain'], default: 'glow', description: 'glow: the accent glows; grid: the glows and a faint grid; plain: the gradient only' },
    glow: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, description: 'Strength of the glows' },
    colorA: { type: 'string', default: '', description: 'First glow, a CSS colour (empty: the theme\'s accent)' },
    colorB: { type: 'string', default: '', description: 'Second glow, a CSS colour (empty: the theme\'s third accent, else its second)' },
    drift: { type: 'boolean', default: true, description: 'Let the glows drift (on the session clock)' },
    vignette: { type: 'number', default: 0.45, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const C = lib.color;
    const th = f.theme ?? f.use(p.theme);
    const w = f.width, h = f.height, big = Math.max(w, h);
    const light = C.luminance(th.bg) > 0.4;
    const top = th.bgAlt ?? C.mix(th.bg, light ? '#ffffff' : '#000000', 0.06);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(1, th.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (p.style !== 'plain' && p.glow > 0) {
      const t = p.drift ? f.ui.now : 0;
      const blobs = [
        { c: p.colorA || th.accent, x: 0.22 + 0.08 * Math.sin(t * 0.21), y: 0.2 + 0.06 * Math.cos(t * 0.17), r: 0.62 },
        { c: p.colorB || th.accent3 || th.accent2 || th.accent, x: 0.8 + 0.07 * Math.cos(t * 0.19 + 1), y: 0.78 + 0.05 * Math.sin(t * 0.23 + 2), r: 0.7 },
      ];
      const a = p.glow * (light ? 0.16 : 0.26);
      for (const b of blobs) {
        const cx = b.x * w, cy = b.y * h, r = b.r * big;
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, C.alpha(b.c, a));
        rg.addColorStop(0.45, C.alpha(b.c, a * 0.35));
        rg.addColorStop(1, C.alpha(b.c, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, h);
      }
    }

    if (p.style === 'grid') {
      // one path for every line, faded towards the bottom
      const step = Math.min(w, h) / 9;
      ctx.save();
      ctx.beginPath();
      for (let x = (w % step) / 2; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = (h % step) / 2; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      const lg = ctx.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0, C.alpha(th.ink, light ? 0.07 : 0.06));
      lg.addColorStop(1, C.alpha(th.ink, 0.015));
      ctx.strokeStyle = lg;
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0012);
      ctx.stroke();
      ctx.restore();
    }

    if (p.vignette > 0) {
      const vg = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, big * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, light ? C.alpha(th.ink, 0.1 * p.vignette) : `rgba(0,0,0,${(0.55 * p.vignette).toFixed(3)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }
  },
});
