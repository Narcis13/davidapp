// A checklist on a plate: each row slides in with its tick at its own time (anchor the item, or give each row
// an `at`), and stays. For the checks a video passes, steps done, claims made one by one.
asset({
  title: 'Check list',
  description: 'A list of short statements on a solid plate, each sliding in with a tick at its own time and staying on screen: the checks a video passes, steps completed, claims made one by one. Optional heading; sizes are a share of the frame\'s short side, with a floor. Takes a theme.',
  tags: ['list', 'checklist', 'text', 'scene', 'bullets', 'plate'],
  duration: 8,
  floor: 2.6,
  uses: ['easing'],
  params: {
    heading: { type: 'string', default: 'Checked', description: 'Empty: no heading' },
    items: {
      type: 'array', maxItems: 8,
      of: { type: 'object', fields: { text: { type: 'string' }, at: { type: 'number', min: 0 } } },
      default: [{ text: 'Inside the safe zone', at: 0.4 }, { text: 'Big enough to read', at: 1.4 }, { text: 'Contrast 4.5:1 or more', at: 2.4 }],
      description: 'Each row and the item time (s) it appears at',
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 4.2, min: 2.6, max: 12, step: 0.1, description: 'Row size in % of the frame\'s short side' },
    mark: { type: 'enum', options: ['tick', 'dot', 'none'], default: 'tick' },
    progress: { type: 'number', default: -1, min: -1, max: 8, step: 0.01, description: 'Rows shown (row i is in when progress passes i + 1); keyframe it, anchored to words, to bring rows in on what is said. -1: use the at of each row' },
    inDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short, pad = size * 0.7, rowH = size * 1.55, box = size * 0.9;
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    // how far in row i is (0..1), from its time or from the progress param
    const rowIn = (i) => (p.progress >= 0 ? lib.clamp01(p.progress - i) : lib.clamp01((f.t - (p.items[i].at ?? 0)) / 0.35));
    const tickIn = (i) => (p.progress >= 0 ? lib.clamp01((p.progress - i - 0.4) / 0.6) : lib.clamp01((f.t - (p.items[i].at ?? 0) - 0.15) / 0.25));
    const first = Math.min(...p.items.map((it) => it.at ?? 0), f.duration);
    const shown = p.progress >= 0 ? lib.clamp01(p.progress / 0.5) : lib.clamp01((f.t - Math.max(0, first - p.inDur)) / Math.max(0.01, p.inDur));
    if (shown <= 0) return;
    const head = p.heading ? lib.text.layout(ctx, p.heading.toUpperCase(), { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: Math.max((2.6 / 100) * short, size * 0.6), letterSpacing: 0.08 }) : null;
    const rows = p.items.map((it) => lib.text.layout(ctx, it.text, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size, maxWidth: f.width - pad * 2 - box * 1.6, fit: true }));
    const w = Math.min(f.width, pad * 2 + box * 1.6 + Math.max(0, ...rows.map((L) => L.width), head ? head.width : 0));
    const h = pad * 2 + (head ? head.height + size * 0.5 : 0) + rows.length * rowH - (rowH - size * 1.1);
    const x = 0, y = (f.height - h) / 2;
    ctx.save();
    ctx.globalAlpha = E.outCubic(shown) * out;
    ctx.fillStyle = th.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, size * 0.35);
    ctx.fill();
    let ry = y + pad;
    if (head) { ctx.fillStyle = th.accent; lib.text.fill(ctx, head, x + pad, ry); ry += head.height + size * 0.5; }
    p.items.forEach((it, i) => {
      const k = rowIn(i);
      if (k <= 0) { ry += rowH; return; }
      const e = E.outCubic(k);
      ctx.save();
      ctx.globalAlpha *= e;
      ctx.translate((1 - e) * size, 0);
      const cy = ry + size * 0.55;
      if (p.mark !== 'none') {
        ctx.strokeStyle = th.accent;
        ctx.fillStyle = th.accent;
        ctx.lineWidth = Math.max(2, size * 0.1);
        if (p.mark === 'dot') { ctx.beginPath(); ctx.arc(x + pad + box / 2, cy, box * 0.22, 0, Math.PI * 2); ctx.fill(); } else {
          ctx.beginPath(); ctx.roundRect(x + pad, cy - box / 2, box, box, box * 0.2); ctx.stroke();
          const d = tickIn(i);
          if (d > 0) {
            ctx.beginPath();
            ctx.moveTo(x + pad + box * 0.22, cy);
            ctx.lineTo(x + pad + box * 0.42, cy + box * 0.2 * Math.min(1, d * 2));
            if (d > 0.5) ctx.lineTo(x + pad + box * 0.42 + box * 0.38 * (d - 0.5) * 2, cy + box * 0.2 - box * 0.45 * (d - 0.5) * 2);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = th.ink;
      lib.text.fill(ctx, rows[i], x + pad + box * 1.6, ry + (size * 1.1 - rows[i].height) / 2);
      ctx.restore();
      ry += rowH;
    });
    ctx.restore();
  },
});
