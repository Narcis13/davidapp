// A donut chart for explainers and marketing videos: two to six segments sweeping in around a ring, a number counting
// up in the middle with a caption, and a legend (label, share) that fills in as the sweep passes each segment. All text
// goes through f.lib.text with a size floor, so it shows in the layout report and fails loudly instead of shrinking.
//
// Usage: "72% of every clip is reused": the first segment is the story, the centre counts up to its share.
//   { "asset": "kit-chart-donut", "start": 3, "duration": 5, "params": { "center": "first",
//       "segments": [{ "label": "Reused", "value": 72 }, { "label": "New", "value": 28 }] },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.5, "width": 0.9, "height": 0.8 } }
// With "center": "total" it counts up to the sum instead (give "suffix" a unit); with "custom" to "value".

asset({
  title: 'Donut chart',
  description: 'An animated donut chart: two to six segments that sweep in around a ring, a number counting up in the centre (the first segment\'s share, the total, or any value) with a caption, and a legend with each segment\'s share that fills in as the sweep passes it (to the right in a wide box, below in a tall one). Theme colours or your own per segment. Sizes are a share of the frame\'s short side with a floor. Pairs with kit-plate and kit-chart-line. Takes a theme.',
  tags: ['kit', 'chart', 'donut', 'pie', 'data', 'graph', 'marketing', 'explainer'],
  duration: 5,
  floor: 2.5,
  uses: ['easing'],
  params: {
    segments: {
      type: 'array', minItems: 2, maxItems: 6,
      of: { type: 'object', fields: { label: { type: 'string', default: 'Segment' }, value: { type: 'number', min: 0, default: 1 }, color: { type: 'string', description: 'A CSS colour (empty: from the theme)' } } },
      default: [{ label: 'Reused', value: 72 }, { label: 'New', value: 21 }, { label: 'Forked', value: 7 }],
    },
    center: { type: 'enum', options: ['first', 'total', 'custom'], default: 'first', description: 'What counts up in the middle: the first segment\'s share (%), the total of the segments, or `value`' },
    value: { type: 'number', default: 0, description: 'The centre number when center is custom' },
    caption: { type: 'string', default: '', description: 'Under the centre number (empty: the first segment\'s label, or "Total")' },
    prefix: { type: 'string', default: '', description: 'Before the centre number (total and custom), e.g. $' },
    suffix: { type: 'string', default: '', description: 'After the centre number (total and custom), e.g. k' },
    legend: { type: 'enum', options: ['auto', 'right', 'bottom', 'none'], default: 'auto', description: 'auto: right in a wide box, below in a tall one' },
    legendValues: { type: 'enum', options: ['percent', 'value', 'none'], default: 'percent' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    thickness: { type: 'number', default: 0.3, min: 0.1, max: 0.6, step: 0.01, description: 'Ring thickness as a share of its radius' },
    gap: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.05, description: 'Gap between segments, % of the frame\'s short side' },
    size: { type: 'number', default: 3.3, min: 2.5, max: 8, step: 0.1, description: 'Legend and caption text in % of the frame\'s short side' },
    delay: { type: 'number', default: 0.4, min: 0, max: 10, step: 0.05 },
    sweep: { type: 'number', default: 1.5, min: 0.2, max: 20, step: 0.05, description: 'Seconds the ring takes to sweep around' },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const u = short / 100;
    const segs = p.segments;
    segs.forEach((s, i) => { if (!(s.value >= 0) || !Number.isFinite(s.value)) throw new Error(`segment ${i + 1} ("${s.label}") needs a value of zero or more`); });
    const total = segs.reduce((a, s) => a + s.value, 0);
    if (!(total > 0)) throw new Error('the segments add up to zero: give at least one of them a value above zero');
    const palette = [th.accent, th.accent2, th.accent3, lib.color.mix(th.accent, th.ink, 0.45), lib.color.mix(th.accent2, th.ink, 0.45), lib.color.mix(th.accent3, th.ink, 0.45)];
    const colors = segs.map((s, i) => {
      const c = s.color || palette[i];
      try { lib.color.parse(c); } catch { throw new Error(`segment ${i + 1} colour "${s.color}" is not a CSS colour: use #rrggbb, rgb() or hsl(), or leave it empty for the theme`); }
      return c;
    });
    const A = f.safe;
    const txt = p.size * u;
    const body = th.fonts?.body ?? 'Inter', head = th.fonts?.headline ?? 'Space Grotesk';
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const pct = (s) => `${Math.round((s.value / total) * 100)}%`;
    const num = (v) => `${Number.isInteger(v) ? v : +v.toFixed(1)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const valueText = (s) => (p.legendValues === 'percent' ? pct(s) : p.legendValues === 'value' ? `${p.prefix}${num(s.value)}${p.suffix}` : '');

    // legend rows measured first: they decide how much room the ring gets
    const mode = p.legend === 'auto' ? (A.width > A.height * 1.15 ? 'right' : 'bottom') : p.legend;
    const rows = segs.map((s) => ({ L: lib.text.layout(ctx, s.label, { font: body, weight: 600, size: txt, wrap: 'none' }), V: valueText(s) ? lib.text.layout(ctx, valueText(s), { font: head, weight: 700, size: txt, wrap: 'none' }) : null }));
    const rowH = txt * 1.95, dot = txt * 0.62;
    const labelW = Math.max(...rows.map((r) => r.L.width)), valW = Math.max(0, ...rows.map((r) => (r.V ? r.V.width : 0)));
    const legW = dot * 1.6 + labelW + (valW ? txt * 1.6 + valW : 0), legH = rowH * segs.length;
    const gapBig = txt * 2.4;
    let ring, leg = null;
    if (mode === 'right') {
      const D = Math.max(0, Math.min(A.height * 0.92, A.width - legW - gapBig));
      const x0 = A.x + (A.width - (D + gapBig + legW)) / 2;
      ring = { cx: x0 + D / 2, cy: A.y + A.height / 2, D };
      leg = { x: x0 + D + gapBig, y: A.y + (A.height - legH) / 2 };
    } else if (mode === 'bottom') {
      const D = Math.max(0, Math.min(A.width, A.height - legH - gapBig * 0.7));
      const y0 = A.y + (A.height - (D + gapBig * 0.7 + legH)) / 2;
      ring = { cx: A.x + A.width / 2, cy: y0 + D / 2, D };
      leg = { x: A.x + (A.width - legW) / 2, y: y0 + D + gapBig * 0.7 };
    } else ring = { cx: A.x + A.width / 2, cy: A.y + A.height / 2, D: Math.min(A.width, A.height) };
    if (ring.D < txt * 6) throw new Error('the chart box is too small for its text at the size floor: give it a bigger box, fewer segments or a legend: "none"');

    const R = ring.D / 2, T = R * p.thickness, rs = R - T / 2;
    const sweepK = E.outCubic(lib.clamp01((f.t - p.delay) / p.sweep));
    const reached = sweepK * Math.PI * 2;
    const gapA = Math.min(0.4, (p.gap * u) / rs);

    ctx.save();
    ctx.globalAlpha = exit;
    // the track, then the segments in order, each up to the angle the sweep has reached
    ctx.lineWidth = T;
    ctx.strokeStyle = lib.color.alpha(th.ink, 0.07);
    ctx.beginPath(); ctx.arc(ring.cx, ring.cy, rs, 0, Math.PI * 2); ctx.stroke();
    // angles in canvas terms: 12 o'clock is -90 degrees; `starts` are measured from there, like `reached`
    let a = -Math.PI / 2;
    const starts = [];
    segs.forEach((s, i) => {
      const span = (s.value / total) * Math.PI * 2;
      const half = span > gapA * 2 ? gapA / 2 : 0;
      starts.push(a + Math.PI / 2);
      const lo = a + half, hi = Math.min(a + span, -Math.PI / 2 + reached) - half;
      if (hi > lo + 1e-4) {
        ctx.strokeStyle = colors[i];
        ctx.beginPath(); ctx.arc(ring.cx, ring.cy, rs, lo, hi); ctx.stroke();
      }
      a += span;
    });

    // the centre: the number counts up, sized from its final text so it does not jump
    const k = E.outCubic(lib.clamp01((f.t - p.delay) / (p.sweep * 0.9)));
    const finalV = p.center === 'first' ? (segs[0].value / total) * 100 : p.center === 'total' ? total : p.value;
    const fmtC = (v) => (p.center === 'first' ? `${Math.round(v)}%` : `${p.prefix}${num(Number.isInteger(finalV) ? Math.round(v) : +v.toFixed(1))}${p.suffix}`);
    const inner = (R - T) * 2 * 0.86;
    const finalL = lib.text.layout(ctx, fmtC(finalV), { font: head, weight: 700, size: inner * 0.34, maxWidth: inner, fit: true, wrap: 'none', align: 'center' });
    const curL = lib.text.layout(ctx, fmtC(finalV * k), { font: head, weight: 700, size: finalL.size, maxWidth: inner, wrap: 'none', align: 'center' });
    const cap = p.caption || (p.center === 'first' ? segs[0].label : 'Total');
    const capL = cap ? lib.text.layout(ctx, cap, { font: body, weight: 600, size: Math.max(txt, finalL.size * 0.36), maxWidth: inner, fit: true, wrap: 'none', align: 'center' }) : null;
    const blockH = curL.height + (capL ? capL.height + finalL.size * 0.08 : 0);
    let cy = ring.cy - blockH / 2;
    ctx.save();
    ctx.globalAlpha = exit * lib.clamp01((f.t - p.delay) / 0.3);
    lib.text.fill(ctx, curL, ring.cx - curL.boxWidth / 2, cy, { color: th.ink });
    cy += curL.height + finalL.size * 0.08;
    if (capL) lib.text.fill(ctx, capL, ring.cx - capL.boxWidth / 2, cy, { color: th.muted });
    ctx.restore();

    // the legend: a row appears as the sweep reaches its segment
    if (leg) {
      segs.forEach((s, i) => {
        const r = rows[i];
        const on = lib.clamp01((reached - starts[i] + 0.15) / 0.35) * (f.t >= p.delay ? 1 : 0);
        if (on <= 0) return;
        const y = leg.y + i * rowH;
        ctx.save();
        ctx.globalAlpha = exit * on;
        ctx.fillStyle = colors[i];
        ctx.beginPath(); ctx.roundRect(leg.x, y + (rowH - dot) / 2, dot, dot, dot * 0.3); ctx.fill();
        lib.text.fill(ctx, r.L, leg.x + dot * 1.6, y + (rowH - r.L.height) / 2 + (1 - on) * txt * 0.4, { color: th.ink });
        if (r.V) lib.text.fill(ctx, r.V, leg.x + legW - r.V.width, y + (rowH - r.V.height) / 2 + (1 - on) * txt * 0.4, { color: th.muted });
        ctx.restore();
      });
    }
    ctx.restore();
  },
});
