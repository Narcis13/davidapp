// The compounding, drawn: one column per clip, a dot per asset it wrote, and a ring for every
// asset it took from an earlier clip, joined to where that asset came from.
asset({
  title: 'Lineage flow',
  description: 'Diagram of a library compounding: one column per clip, filled dots for the assets it created, rings for the assets it reused, and curves that travel from each reused asset\'s origin. Columns and counts are parameters; the wiring is seeded.',
  tags: ['lineage', 'diagram', 'data', 'graph', 'scene'],
  duration: 8,
  uses: ['easing', 'spring'],
  params: {
    columns: {
      type: 'array', minItems: 1, maxItems: 5,
      of: { type: 'object', fields: { label: { type: 'string' }, created: { type: 'integer', min: 0, max: 60 }, reused: { type: 'integer', min: 0, max: 60 } } },
      default: [{ label: 'Clip 1', created: 28, reused: 0 }, { label: 'Clip 2', created: 7, reused: 21 }],
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    columnDur: { type: 'number', default: 2.2, min: 0.5, max: 10, step: 0.1, description: 'Seconds between columns appearing' },
    perRow: { type: 'integer', default: 5, min: 2, max: 10 },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const pop = f.use('spring', { stiffness: 300, damping: 16 });
    const safe = f.safe;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const n = p.columns.length;
    const colW = safe.width / n;
    const headH = safe.height * 0.16;
    const most = Math.max(...p.columns.map((c) => c.created + c.reused));
    const rows = Math.ceil(most / p.perRow);
    const step = Math.min((colW * 0.8) / p.perRow, (safe.height - headH * 1.3) / Math.max(1, rows + 0.5));
    const r = step * 0.3;
    // where every node sits
    const cols = p.columns.map((c, ci) => {
      const total = c.created + c.reused;
      const gridW = (Math.min(p.perRow, total) - 1) * step;
      const x0 = safe.x + colW * ci + (colW - gridW) / 2, y0 = safe.y + headH * 1.35;
      return Array.from({ length: total }, (_, i) => ({ x: x0 + (i % p.perRow) * step, y: y0 + Math.floor(i / p.perRow) * step, created: i < c.created, i }));
    });
    ctx.globalAlpha = exit;
    const accents = [th.accent, th.accent2, th.accent3];
    // links first, so the nodes sit on top of them
    cols.forEach((nodes, ci) => {
      if (!ci) return;
      const t0 = ci * p.columnDur + 0.7;
      const sources = cols.slice(0, ci).flatMap((list, si) => list.filter((nd) => nd.created).map((nd) => ({ ...nd, si })));
      const pick = f.rng.fork(`links-${ci}`).shuffle(sources);
      nodes.filter((nd) => !nd.created).forEach((nd, j) => {
        const src = pick[j % pick.length];
        const k = E.inOutCubic(lib.clamp01((f.t - t0 - j * 0.045) / 0.7));
        if (k <= 0) return;
        const dx = (nd.x - src.x) * 0.5;
        ctx.strokeStyle = lib.color.alpha(accents[src.si % 3], 0.5);
        ctx.lineWidth = Math.max(2, r * 0.22);
        ctx.beginPath();
        for (let s = 0; s <= 24; s++) {
          const u = (s / 24) * k, v = 1 - u;
          const bx = v * v * v * src.x + 3 * v * v * u * (src.x + dx) + 3 * v * u * u * (nd.x - dx) + u * u * u * nd.x;
          const by = v * v * v * src.y + 3 * v * v * u * src.y + 3 * v * u * u * nd.y + u * u * u * nd.y;
          ctx[s ? 'lineTo' : 'moveTo'](bx, by);
        }
        ctx.stroke();
        nd.linked = k;
        nd.color = accents[src.si % 3];
      });
    });
    cols.forEach((nodes, ci) => {
      const t0 = ci * p.columnDur;
      const c = p.columns[ci];
      const a = lib.clamp01((f.t - t0) / 0.4);
      if (a <= 0) return;
      // heading: the clip and what it wrote / took
      ctx.save();
      ctx.globalAlpha = a * exit;
      const cx = safe.x + colW * ci + colW / 2;
      const H = lib.text.layout(ctx, c.label, { font: th.fonts.headline, weight: 700, size: headH * 0.42, maxWidth: colW * 0.9, fit: true, wrap: 'none' });
      ctx.fillStyle = th.ink;
      lib.text.fill(ctx, H, cx - H.width / 2, safe.y + (1 - E.outCubic(a)) * 20);
      const sub = c.reused ? `${c.created} new · ${c.reused} reused` : `${c.created} new`;
      const S = lib.text.layout(ctx, sub, { font: th.fonts.mono, weight: 400, size: headH * 0.27, maxWidth: colW * 0.9, fit: true, wrap: 'none' });
      ctx.fillStyle = th.muted;
      lib.text.fill(ctx, S, cx - S.width / 2, safe.y + headH * 0.58);
      ctx.restore();
      for (const nd of nodes) {
        const s = pop(f.t - t0 - 0.2 - nd.i * 0.03);
        if (s <= 0) continue;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r * s, 0, lib.TAU);
        if (nd.created) { ctx.fillStyle = accents[ci % 3]; ctx.fill(); }
        else {
          ctx.fillStyle = lib.color.alpha(nd.color ?? th.muted, 0.25 * (nd.linked ?? 0));
          ctx.fill();
          ctx.strokeStyle = nd.linked ? nd.color : lib.color.alpha(th.muted, 0.7);
          ctx.lineWidth = Math.max(2, r * 0.28);
          ctx.stroke();
        }
      }
    });
  },
});
