// Horizontal bar chart with up to two stacked series per row, growing in with counted totals.
asset({
  title: 'Bar chart',
  description: 'Animated horizontal bar chart: a title, then one row per item whose bar grows in (optionally two stacked series, e.g. new vs reused) while its total counts up. Rows, labels and the legend are content slots; takes a theme.',
  tags: ['chart', 'data', 'bars', 'scene', 'template'],
  duration: 7,
  uses: ['text-line-reveal', 'text-counter', 'easing'],
  params: {
    title: { type: 'string', default: 'Assets written for each clip' },
    rows: {
      type: 'array', minItems: 1, maxItems: 6,
      of: { type: 'object', fields: { label: { type: 'string' }, value: { type: 'number', min: 0 }, value2: { type: 'number', min: 0 } } },
      default: [{ label: 'Clip 1', value: 28, value2: 0 }, { label: 'Clip 2', value: 7, value2: 21 }],
    },
    series: { type: 'array', of: { type: 'string' }, default: ['new', 'reused'], maxItems: 2, description: 'Legend labels for value and value2' },
    suffix: { type: 'string', default: '' },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    stagger: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const safe = f.safe;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const titleH = safe.height * 0.2;
    f.use('text-line-reveal', { text: p.title, font: th.fonts.headline, weight: 700, size: titleH * 0.6, color: th.ink, accent: th.accent, emFont: th.fonts.serif, align: 'left', valign: 'middle', outDur: p.outDur },
      { x: safe.x, y: safe.y, width: safe.width, height: titleH });
    const legendH = p.series.length ? safe.height * 0.12 : 0;
    const area = { x: safe.x, y: safe.y + titleH * 1.1, width: safe.width, height: safe.height - titleH * 1.1 - legendH };
    const n = p.rows.length;
    const rowH = Math.min(area.height / n, safe.height * 0.3);
    area.y += (area.height - rowH * n) / 2;
    const barH = rowH * 0.5;
    const labelW = area.width * 0.2, totalW = area.width * 0.16;
    const trackX = area.x + labelW, trackW = area.width - labelW - totalW;
    const max = Math.max(1, ...p.rows.map((r) => r.value + r.value2));
    const colors = [th.accent, th.accent2];
    p.rows.forEach((row, i) => {
      const at = 0.5 + i * p.stagger;
      const k = E.outExpo(lib.clamp01((f.t - at) / 1.1));
      const appear = lib.clamp01((f.t - at + 0.15) / 0.3) * exit;
      const y = area.y + i * rowH + (rowH - barH) / 2;
      ctx.save();
      ctx.globalAlpha = appear;
      const LL = lib.text.layout(ctx, row.label, { font: th.fonts.headline, weight: 700, size: barH * 0.52, maxWidth: labelW - barH * 0.4, fit: true, wrap: 'none' });
      ctx.fillStyle = th.ink;
      lib.text.fill(ctx, LL, area.x, y + (barH - LL.height) / 2);
      ctx.fillStyle = lib.color.alpha(th.ink, 0.08);
      ctx.beginPath(); ctx.roundRect(trackX, y, trackW, barH, barH * 0.22); ctx.fill();
      let x = trackX;
      [row.value, row.value2].forEach((v, s) => {
        const w = (v / max) * trackW * k;
        if (w <= 0.5) return;
        ctx.fillStyle = colors[s];
        ctx.beginPath(); ctx.roundRect(x, y, w, barH, barH * 0.22); ctx.fill();
        // the value sits inside its segment once there is room for it
        const VL = lib.text.layout(ctx, String(Math.round(v * k)), { font: th.fonts.mono, weight: 700, size: barH * 0.42, wrap: 'none' });
        if (w > VL.width + barH * 0.5) { ctx.fillStyle = lib.color.onColor(colors[s]); lib.text.fill(ctx, VL, x + w - VL.width - barH * 0.22, y + (barH - VL.height) / 2); }
        x += w;
      });
      ctx.restore();
      f.use('text-counter', { to: row.value + row.value2, label: '', suffix: p.suffix, font: th.fonts.headline, size: barH * 0.9, color: th.ink, accent: th.muted, align: 'left', countDur: 1.1, outDur: p.outDur },
        { x: trackX + trackW + barH * 0.35, y, width: totalW - barH * 0.35, height: barH, at, key: i });
    });
    if (legendH) {
      const ly = safe.y + safe.height - legendH * 0.7;
      let lx = trackX;
      ctx.globalAlpha = lib.clamp01((f.t - 0.9) / 0.4) * exit;
      p.series.forEach((name, s) => {
        const d = legendH * 0.32;
        ctx.fillStyle = colors[s];
        ctx.beginPath(); ctx.roundRect(lx, ly, d, d, d * 0.25); ctx.fill();
        const SL = lib.text.layout(ctx, name, { font: th.fonts.body, weight: 600, size: legendH * 0.36, wrap: 'none' });
        ctx.fillStyle = th.muted;
        lib.text.fill(ctx, SL, lx + d * 1.5, ly + (d - SL.height) / 2);
        lx += d * 1.5 + SL.width + d * 2.2;
      });
    }
  },
});
