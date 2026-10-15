// A line chart for explainers and marketing videos: one to four series over named categories, an axis with round
// tick values, faint gridlines, the lines drawing on one after the other, a dot popping in where each point is
// reached, and the last value of each line called out with a label. Every label goes through f.lib.text (a size
// floor, and it shows in the layout report); labels that do not fit side by side are thinned, never shrunk.
//
// Usage: the growth beat of a marketing video. Give it a plate (kit-plate) or a dark background, the same box as the
// plate inset by its padding, and let it draw while the narration says the number.
//   { "asset": "kit-chart-line", "start": 2, "duration": 6, "params": {
//       "title": "Clips made per month", "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
//       "series": [{ "label": "Clips", "values": [4, 9, 14, 26, 41, 63] }], "draw": 1.8, "suffix": "" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.5, "width": 0.9, "height": 0.8 } }

/** A "nice" number near x (1, 2, 5 times a power of ten): rounded to the nearest, or the next one up. */
function niceNum(x, round) {
  const exp = Math.floor(Math.log10(x)), fr = x / 10 ** exp;
  const nf = round ? (fr < 1.5 ? 1 : fr < 3 ? 2 : fr < 7 ? 5 : 10) : (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

/** Axis bounds and step that land on round numbers, about `count` ticks. */
function niceScale(lo, hi, count) {
  if (!(hi > lo)) { hi = lo + 1; }
  const step = niceNum(niceNum(hi - lo, false) / Math.max(1, count - 1), true);
  return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
}

/** Monotone cubic (Fritsch-Carlson) through the points: smooth, and it never overshoots a value. */
function monotone(pts, per) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  tan.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
  }
  const out = [pts[0]];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 1; j <= per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([pts[i][0] + dx[i] * t, (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * dx[i] * tan[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * dx[i] * tan[i + 1]]);
    }
  }
  return out;
}

asset({
  title: 'Line chart',
  description: 'An animated line chart: one to four series over named categories, an axis with round tick values, gridlines, lines that draw on over `draw` seconds, dots that pop in as each point is reached, and the last value of every line called out with a label (a legend when there are several). Smooth or straight lines, a soft area under them, a unit prefix or suffix on the values. Sizes are a share of the frame\'s short side with a floor. Pairs with kit-plate. Takes a theme.',
  tags: ['kit', 'chart', 'line', 'data', 'graph', 'marketing', 'explainer'],
  duration: 6,
  floor: 2.5,
  uses: ['easing'],
  params: {
    title: { type: 'string', default: 'Clips made per month', description: '*Asterisks* mark words in the accent colour (empty: no title)' },
    labels: { type: 'array', of: { type: 'string' }, minItems: 2, maxItems: 24, default: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], description: 'The x categories' },
    series: {
      type: 'array', minItems: 1, maxItems: 4,
      of: { type: 'object', fields: { label: { type: 'string' }, values: { type: 'array', of: { type: 'number' }, minItems: 1, maxItems: 24, default: [0, 1] }, color: { type: 'string', description: 'A CSS colour (empty: from the theme)' } } },
      default: [{ label: 'New', values: [4, 9, 14, 26, 41, 63] }, { label: 'Reused', values: [1, 3, 8, 12, 20, 29] }],
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    prefix: { type: 'string', default: '', description: 'Before every value, e.g. $' },
    suffix: { type: 'string', default: '', description: 'After every value, e.g. % or k' },
    zero: { type: 'boolean', default: true, description: 'Start the axis at zero when all values are above it' },
    ticks: { type: 'integer', default: 5, min: 2, max: 9, description: 'About this many axis ticks' },
    smooth: { type: 'boolean', default: true, description: 'Curved lines (never overshooting a value) instead of straight ones' },
    area: { type: 'boolean', default: true, description: 'A soft fill under each line' },
    highlight: { type: 'boolean', default: true, description: 'Call out the last value of each line' },
    size: { type: 'number', default: 2.8, min: 2.5, max: 8, step: 0.1, description: 'Axis and label text in % of the frame\'s short side' },
    titleSize: { type: 'number', default: 4.6, min: 2.5, max: 14, step: 0.1, description: 'Title size in % of the frame\'s short side' },
    delay: { type: 'number', default: 0.5, min: 0, max: 10, step: 0.05, description: 'Seconds before the lines start to draw' },
    draw: { type: 'number', default: 1.8, min: 0.2, max: 20, step: 0.05, description: 'Seconds the lines take to draw on' },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const u = short / 100;
    const n = p.labels.length;
    p.series.forEach((s, i) => {
      if (s.values.length > n) throw new Error(`series ${i + 1} ("${s.label}") has ${s.values.length} values but there are only ${n} labels: add labels or drop values`);
      if (!s.values.length || s.values.some((v) => !Number.isFinite(v))) throw new Error(`series ${i + 1} ("${s.label}") needs numbers only, at least one`);
    });
    const palette = [th.accent, th.accent2, th.accent3, lib.color.mix(th.accent, th.ink, 0.5)];
    const colors = p.series.map((s, i) => {
      const c = s.color || palette[i % palette.length];
      try { lib.color.parse(c); } catch { throw new Error(`series ${i + 1} colour "${s.color}" is not a CSS colour: use #rrggbb, rgb() or hsl(), or leave it empty for the theme`); }
      return c;
    });
    const fade = lib.clamp01(f.t / 0.45);
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const A = f.safe;
    const axisSize = p.size * u;
    const body = th.fonts?.body ?? 'Inter', head = th.fonts?.headline ?? 'Space Grotesk';
    const text = (s, o) => lib.text.layout(ctx, s, { wrap: 'none', ...o });

    // the scale: round numbers around the data
    const all = p.series.flatMap((s) => s.values);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (p.zero && lo > 0) lo = 0;
    if (p.zero && hi < 0) hi = 0;
    const sc = niceScale(lo, hi, p.ticks);
    const dec = sc.step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(sc.step) - 1e-9));
    const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fmt = (v) => `${p.prefix}${group(v.toFixed(dec).replace(/^-0(\.0+)?$/, '0'))}${p.suffix}`;
    const tickVals = [];
    for (let v = sc.min; v <= sc.max + sc.step / 1e6; v += sc.step) tickVals.push(Math.round(v / sc.step) * sc.step);

    ctx.save();
    ctx.globalAlpha = exit;
    let top = A.y;
    // title and legend
    if (p.title) {
      const T = lib.text.layout(ctx, p.title, { font: head, weight: 700, size: p.titleSize * u, maxWidth: A.width, fit: true, markup: true, lineHeight: 1.08 });
      ctx.save();
      ctx.globalAlpha = exit * fade;
      lib.text.fill(ctx, T, A.x, top + (1 - fade) * axisSize * 0.6, { color: th.ink, emColor: th.accent });
      ctx.restore();
      top += T.height + axisSize * 0.7;
    }
    if (p.series.length > 1) {
      let lx = A.x;
      const sw = axisSize * 0.9;
      ctx.save();
      ctx.globalAlpha = exit * fade;
      p.series.forEach((s, i) => {
        const L = text(s.label, { font: body, weight: 600, size: axisSize });
        ctx.fillStyle = colors[i];
        ctx.beginPath(); ctx.roundRect(lx, top + (L.height - sw * 0.5) / 2, sw, sw * 0.5, sw * 0.25); ctx.fill();
        lib.text.fill(ctx, L, lx + sw * 1.4, top, { color: th.muted });
        lx += sw * 1.4 + L.width + axisSize * 1.8;
      });
      ctx.restore();
      top += axisSize * 1.5 + axisSize * 0.7;
    }

    // plot box: room for the y labels, the x labels and the called-out values
    const tickLabels = tickVals.map((v) => text(fmt(v), { font: body, weight: 600, size: axisSize }));
    const yW = Math.max(...tickLabels.map((L) => L.width)) + axisSize * 0.8;
    const xH = axisSize * 1.5 + axisSize * 0.5;
    const lastVals = p.series.map((s) => s.values[s.values.length - 1]);
    const callouts = p.highlight ? lastVals.map((v) => text(fmt(v), { font: head, weight: 700, size: axisSize * 1.05 })) : [];
    const pillPad = axisSize * 0.55;
    const gutter = p.highlight ? Math.max(...callouts.map((L) => L.width)) + pillPad * 2 + axisSize * 0.9 : axisSize * 0.4;
    const plot = { x: A.x + yW, y: top + axisSize * 0.6, width: A.width - yW - gutter, height: A.y + A.height - xH - top - axisSize * 0.6 };
    if (plot.width < axisSize * 4 || plot.height < axisSize * 3) throw new Error('the chart box is too small for its text at the size floor: give it a bigger box or fewer, shorter labels');
    const band = plot.width / n;
    const px = (i) => plot.x + (i + 0.5) * band;
    const py = (v) => plot.y + plot.height * (1 - (v - sc.min) / (sc.max - sc.min));
    const base = plot.y + plot.height;

    // axis: gridlines and tick labels
    ctx.save();
    ctx.globalAlpha = exit * fade;
    tickVals.forEach((v, i) => {
      const y = py(v);
      ctx.fillStyle = lib.color.alpha(th.ink, v === sc.min ? 0.28 : 0.09);
      ctx.fillRect(plot.x, y - Math.max(1, 0.07 * u), plot.width, Math.max(1.5, 0.14 * u));
      lib.text.fill(ctx, tickLabels[i], plot.x - axisSize * 0.8 - tickLabels[i].width, y - tickLabels[i].height / 2, { color: th.muted });
    });
    // x labels, every nth when they would touch
    const xl = p.labels.map((s) => text(s, { font: body, weight: 600, size: axisSize }));
    const stride = Math.max(1, Math.ceil((Math.max(...xl.map((L) => L.width)) * 1.3) / band));
    xl.forEach((L, i) => { if (i % stride === 0) lib.text.fill(ctx, L, px(i) - L.width / 2, base + axisSize * 0.6, { color: th.muted }); });
    ctx.restore();

    // the lines
    const pr = E.inOutCubic(lib.clamp01((f.t - p.delay) / p.draw));
    const r = Math.max(3, 0.62 * u);
    const marks = [];
    p.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [px(i), py(v)]);
      const dense = p.smooth ? monotone(pts, 14) : pts;
      const cum = [0];
      for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
      const total = cum[cum.length - 1] || 1;
      // the pen: the polyline up to this share of its length
      const reach = pr * total;
      const drawn = [dense[0]];
      for (let i = 1; i < dense.length && cum[i - 1] < reach; i++) {
        if (cum[i] <= reach) drawn.push(dense[i]);
        else { const k = (reach - cum[i - 1]) / (cum[i] - cum[i - 1]); drawn.push([dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * k, dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * k]); }
      }
      if (p.area && drawn.length > 1) {
        const g = ctx.createLinearGradient(0, plot.y, 0, base);
        g.addColorStop(0, lib.color.alpha(colors[si], p.series.length > 1 ? 0.16 : 0.26));
        g.addColorStop(1, lib.color.alpha(colors[si], 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(drawn[0][0], base);
        for (const q of drawn) ctx.lineTo(q[0], q[1]);
        ctx.lineTo(drawn[drawn.length - 1][0], base);
        ctx.closePath();
        ctx.fill();
      }
      if (drawn.length > 1) {
        ctx.strokeStyle = colors[si];
        ctx.lineWidth = Math.max(2, 0.5 * u);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        drawn.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.stroke();
      }
      // a dot pops in where the pen reaches each point (the point's own place on the line)
      let at = 0;
      pts.forEach((q, i) => {
        // arc length of the dense line at this point
        const idx = p.smooth ? i * 14 : i;
        at = cum[Math.min(idx, cum.length - 1)] / total;
        const k = pr >= 1 ? 1 : lib.clamp01((pr - at) / 0.05 + (i === 0 && pr > 0 ? 1 : 0));
        if (k <= 0) return;
        ctx.fillStyle = colors[si];
        ctx.beginPath(); ctx.arc(q[0], q[1], r * (0.4 + 0.6 * E.outBack(k)) * (i === pts.length - 1 && p.highlight ? 1.25 : 1), 0, Math.PI * 2); ctx.fill();
      });
      marks.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
    });

    // the last values: a ring on the point and a label to its right, pushed apart where lines end close together
    if (p.highlight) {
      const kh = E.outBack(lib.clamp01((f.t - p.delay - p.draw) / 0.45));
      if (kh > 0) {
        const h = callouts[0].height + pillPad;
        const order = marks.map((m, i) => i).sort((a, b) => marks[a].y - marks[b].y);
        const ys = new Map();
        let prev = -Infinity;
        for (const i of order) { const y = Math.max(marks[i].y, prev + h + axisSize * 0.2); ys.set(i, y); prev = y; }
        const shift = Math.max(0, ys.get(order[order.length - 1]) + h / 2 - (A.y + A.height));
        order.forEach((i) => {
          const m = marks[i], L = callouts[i], w = L.width + pillPad * 2;
          const cy = ys.get(i) - shift, x = m.x + r * 2.6;
          ctx.save();
          ctx.globalAlpha = exit * Math.min(1, kh);
          ctx.strokeStyle = lib.color.alpha(colors[i], 0.4);
          ctx.lineWidth = Math.max(1.5, 0.22 * u);
          ctx.beginPath(); ctx.arc(m.x, m.y, r * 2.1 * kh, 0, Math.PI * 2); ctx.stroke();
          // slides in from the point; the text is never scaled, so it stays above its floor all the way
          ctx.translate(x - (1 - Math.min(1, kh)) * axisSize, cy);
          ctx.fillStyle = colors[i];
          ctx.beginPath(); ctx.roundRect(0, -h / 2, w, h, h / 2); ctx.fill();
          lib.text.fill(ctx, L, pillPad, -L.height / 2, { color: lib.color.onColor(colors[i], th.bg, '#ffffff') });
          ctx.restore();
        });
      }
    }
    ctx.restore();
  },
});
