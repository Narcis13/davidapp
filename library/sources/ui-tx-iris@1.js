// An iris for interactive scenes: the next scene opens inside a circle that grows from where the viewer last tapped
// (f.ui.pointer: the button they pressed seems to swell into the next screen), from the centre, or from a set point.
// The circle is edged with a glowing ring in the theme's accent (stacked strokes, no blur); the old scene dims and
// leans in a little, the new one settles from a slight zoom.
//
// Usage. Open the quiz from the Start button the viewer tapped:
//   "wires": [{ "on": "start.press", "do": { "go": "quiz", "transition": { "asset": "ui-tx-iris", "duration": 0.7 } } }]
// With nothing tapped (a key, a timer), or in a video, it opens from `x`, `y` (the centre by default).

asset({
  kind: 'transition',
  title: 'Iris from the tap',
  description: 'A circular reveal for interactive compositions: the next scene opens inside a circle growing from the viewer\'s last tap (f.ui.pointer), the centre or a set point, edged with a glowing accent ring; the old scene dims and leans in, the new one settles from a slight zoom. Without a tap (a key, a timer, a video) it opens from x, y. Blur-free, cheap at 60 fps. Takes a theme for the ring.',
  tags: ['ui', 'interactive', 'transition', 'iris', 'circle', 'reveal', 'scene', 'tap'],
  duration: 0.7,
  uses: ['easing'],
  params: {
    origin: { type: 'enum', options: ['tap', 'center', 'point'], default: 'tap', description: 'Where the circle grows from: the last tap (else x, y), the centre, or x, y' },
    x: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, description: 'Across the frame (0 left, 1 right)' },
    y: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, description: 'Down the frame (0 top, 1 bottom)' },
    ring: { type: 'string', default: '', description: 'Ring colour, a CSS colour (empty: the theme\'s accent; "none": no ring)' },
    ringWidth: { type: 'number', default: 1.1, min: 0, max: 6, step: 0.05, description: '% of the frame\'s short side' },
    dim: { type: 'number', default: 0.4, min: 0, max: 1, step: 0.01, description: 'How dark the old scene gets' },
    zoom: { type: 'number', default: 0.06, min: 0, max: 0.4, step: 0.005, description: 'How much the old scene leans in and the new one settles' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
  },
  render(f, p) {
    const { ctx, width: w, height: h, lib } = f;
    const E = f.use('easing');
    const th = f.theme ?? f.use(p.theme);
    const k = E.inOutCubic(f.progress);
    const ptr = p.origin === 'tap' ? f.ui.pointer : null;
    const ox = p.origin === 'center' ? w / 2 : ptr ? Math.max(0, Math.min(w, ptr.x)) : p.x * w;
    const oy = p.origin === 'center' ? h / 2 : ptr ? Math.max(0, Math.min(h, ptr.y)) : p.y * h;
    const short = Math.min(w, h);
    const R = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)) + short * 0.03;
    const r0 = short * 0.05;
    const r = r0 + (R - r0) * k;

    // the old scene: leaning in towards the origin, dimming
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    if (f.from) {
      ctx.save();
      const s = 1 + p.zoom * k;
      ctx.translate(ox, oy); ctx.scale(s, s); ctx.translate(-ox, -oy);
      ctx.drawImage(f.from.canvas, 0, 0);
      ctx.restore();
      if (p.dim > 0) { ctx.fillStyle = `rgba(0,0,0,${(p.dim * k).toFixed(4)})`; ctx.fillRect(0, 0, w, h); }
    }
    // the new scene inside the circle, settling from a slight zoom
    ctx.save();
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.clip();
    const s2 = 1 + p.zoom * (1 - k);
    ctx.translate(ox, oy); ctx.scale(s2, s2); ctx.translate(-ox, -oy);
    ctx.drawImage(f.to.canvas, 0, 0);
    ctx.restore();
    // the ring: a bright stroke with two soft ones around it, fading as it opens
    if (p.ring !== 'none' && p.ringWidth > 0 && k < 1) {
      const color = p.ring || th.accent;
      try { lib.color.parse(color); } catch { throw new Error(`ring "${p.ring}" is not a CSS colour: use #rrggbb, rgb() or hsl(), "none", or leave it empty for the theme's accent`); }
      const a = Math.min(1, (1 - k) * 2.5) * Math.min(1, f.progress * 8);
      const lw = (p.ringWidth / 100) * short;
      ctx.save();
      for (const [m, al] of [[5, 0.08], [2.6, 0.18], [1, 1]]) {
        ctx.strokeStyle = lib.color.alpha(color, al * a);
        ctx.lineWidth = lw * m;
        ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  },
});
