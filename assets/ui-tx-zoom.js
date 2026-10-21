// A zoom-through for interactive scenes: the camera dives into the old scene towards a point (the last tap, the centre or
// a set point) while the next one grows in from behind it, with faint speed lines radiating from that point; or the
// other way round (out: the old scene recedes and the next one comes from in front). Plain scaled drawImage calls.
//
// Usage. Dive into a level from the card the viewer tapped, and zoom back out when they leave it:
//   "wires": [{ "on": "level1.select", "do": { "go": "level1", "transition": { "asset": "ui-tx-zoom", "duration": 0.6 } } },
//             { "on": "key:Escape", "scene": "level1", "do": { "go": "back", "transition": { "asset": "ui-tx-zoom", "duration": 0.5, "params": { "mode": "out" } } } }]

asset({
  kind: 'transition',
  title: 'Zoom-through',
  description: 'A zoom-through for interactive compositions and app-style videos: the camera dives into the outgoing scene towards the viewer\'s last tap (f.ui.pointer), the centre or a set point while the next scene grows in from behind, with faint speed lines radiating from that point; mode "out" plays it backwards (the old scene recedes, the new one arrives from in front) for going back. Cheap scaled drawImage calls, no filters.',
  tags: ['ui', 'interactive', 'transition', 'zoom', 'scene', 'tap', 'dive'],
  duration: 0.6,
  uses: ['easing'],
  params: {
    mode: { type: 'enum', options: ['in', 'out'], default: 'in', description: 'in: dive into the old scene (forward); out: pull back from it (back)' },
    origin: { type: 'enum', options: ['tap', 'center', 'point'], default: 'tap', description: 'Where the zoom aims: the last tap (else x, y), the centre, or x, y' },
    x: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    y: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    amount: { type: 'number', default: 0.6, min: 0.05, max: 3, step: 0.05, description: 'How far the old scene is magnified (0.6: to 1.6 times)' },
    streaks: { type: 'boolean', default: true, description: 'Faint speed lines radiating from the point' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
  },
  render(f, p) {
    const { ctx, width: w, height: h, lib } = f;
    const E = f.use('easing');
    const th = f.theme ?? f.use(p.theme);
    const x = f.progress;
    const ptr = p.origin === 'tap' ? f.ui.pointer : null;
    const ox = p.origin === 'center' ? w / 2 : ptr ? Math.max(0, Math.min(w, ptr.x)) : p.x * w;
    const oy = p.origin === 'center' ? h / 2 : ptr ? Math.max(0, Math.min(h, ptr.y)) : p.y * h;
    const at = (layer, s, alpha) => {
      if (!layer || alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(ox, oy); ctx.scale(s, s); ctx.translate(-ox, -oy);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    };
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    if (p.mode === 'in') {
      // the old scene swells past the camera; the new one grows from 0.8 to 1 over it
      const kOld = E.inOutCubic(x), kNew = E.outCubic(lib.clamp01((x - 0.32) / 0.6));
      at(f.from, 1 + p.amount * kOld, 1);
      if (f.from) { ctx.fillStyle = `rgba(0,0,0,${(0.55 * Math.min(1, x * 1.6)).toFixed(4)})`; ctx.fillRect(0, 0, w, h); }
      at(f.to, 0.82 + 0.18 * kNew, f.from ? kNew : 1);
    } else {
      // the new scene arrives from in front (1 + amount to 1); the old one recedes and fades over it
      const kNew = E.outCubic(x), kOld = E.inOutCubic(lib.clamp01(x / 0.8));
      at(f.to, 1 + p.amount * 0.5 * (1 - kNew), 1);
      at(f.from, 1 - 0.25 * kOld, 1 - kOld);
    }
    if (p.streaks) {
      const a = Math.sin(Math.PI * x) ** 2 * 0.2;
      if (a > 0.005) {
        const R = Math.hypot(w, h);
        const n = 28;
        ctx.save();
        ctx.strokeStyle = lib.color.alpha(th.ink, a);
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.003);
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + ((i * 7) % 5) * 0.05;
          const len = 0.05 + ((i * 13) % 7) / 70;
          const r1 = R * (0.22 + 0.45 * (p.mode === 'in' ? x : 1 - x) + ((i * 5) % 3) * 0.03), r2 = r1 + R * len;
          ctx.moveTo(ox + Math.cos(ang) * r1, oy + Math.sin(ang) * r1);
          ctx.lineTo(ox + Math.cos(ang) * r2, oy + Math.sin(ang) * r2);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  },
});
