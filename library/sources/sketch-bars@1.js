// A bar chart drawn by hand: a pencil baseline, bars that grow up from it filled with marker (or hatching) inside a
// wobbly ink outline, each value counting up above its bar and its label written under it, a caption below. One bar
// can be the point of the chart: its value is circled in the accent and a few sparks burst around it (a record, a
// zero, a win). Sizes are a share of the frame's short side with a floor.
// Usage: a small comparison in a doodle explainer, 2 to 6 bars.
//   { "asset": "sketch-bars", "start": 28, "duration": 10, "params": { "bars": [{ "label": "clip 4", "value": 242 }, { "label": "clip 6", "value": 0 }],
//       "caption": "new lines of asset code", "focus": 1, "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.63, "width": 0.8, "height": 0.72 } }
asset({
  title: 'Sketched bar chart',
  description: 'Hand-drawn bar chart: a pencil baseline, bars growing from it with marker (or hatched) fill inside a wobbly ink outline, values counting up above them, labels written under them and a caption below. A focus bar gets its value circled in the accent with a burst of sparks. 2 to 6 bars; sizes are a share of the frame\'s short side with a floor. For doodle explainers and marketing: before/after, growth, a drop to zero.',
  tags: ['sketch', 'hand-drawn', 'doodle', 'chart', 'bars', 'data', 'counter', 'explainer', 'marketing'],
  duration: 8,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    bars: {
      type: 'array', minItems: 1, maxItems: 6,
      of: { type: 'object', fields: { label: { type: 'string' }, value: { type: 'number' } } },
      default: [{ label: 'May', value: 40 }, { label: 'June', value: 75 }, { label: 'July', value: 120 }],
    },
    caption: { type: 'string', default: 'videos made', description: 'A line under the chart (empty: none)' },
    prefix: { type: 'string', default: '' },
    suffix: { type: 'string', default: '' },
    focus: { type: 'integer', default: -1, min: -1, max: 5, description: 'The bar to circle and spark (-1: none)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    fill: { type: 'enum', options: ['marker', 'hatch'], default: 'marker' },
    color: { type: 'enum', options: ['accent', 'accent2', 'accent3', 'highlight'], default: 'accent2', description: 'Theme colour of the bars' },
    size: { type: 'number', default: 5, min: 2.5, max: 12, step: 0.1, description: 'Label size, % of the frame\'s short side (values are 1.5 times it)' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1 },
    delay: { type: 'number', default: 0.2, min: 0, max: 30, step: 0.05 },
    stagger: { type: 'number', default: 0.35, min: 0, max: 2, step: 0.01 },
    growDur: { type: 'number', default: 0.9, min: 0.1, max: 4, step: 0.05 },
    focusAt: { type: 'number', default: 0, min: 0, max: 60, step: 0.05, description: 'Seconds from the item start for the focus mark (0: right after its bar lands)' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const t = f.t - p.delay;
    if (t < 0) return;
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height), u = short / 100;
    const b = I.boil(f, p.boil);
    const out = p.outDur > 0 ? E.inCubic(lib.clamp01(1 - (f.duration - f.t) / p.outDur)) : 0;
    const font = th.fonts?.body ?? 'Kalam';
    const n = p.bars.length;
    const ls = Math.max(p.size, p.floor) * u, vs = ls * 1.5;
    const cap = p.caption ? lib.text.layout(ctx, p.caption, { font, weight: 400, size: ls, maxWidth: f.width, fit: true, wrap: 'none', floor: p.floor }) : null;
    const labelH = ls * 1.4, valueH = vs * 1.3, capH = cap ? cap.height + u * 2 : 0;
    const base = f.height - capH - labelH - u * 1.5;
    const top = valueH + u * 2;
    const slot = f.width / n, bw = Math.min(slot * 0.5, u * 22);
    const max = Math.max(1e-9, ...p.bars.map((x) => Math.abs(x.value)));
    const fillC = th[p.color] ?? th.accent2;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    // the baseline
    const kb = E.outCubic(lib.clamp01(t / 0.5));
    I.stroke(f, I.line(u, base, f.width - u, base), { width: u * 0.55, color: th.ink, progress: kb, boil: b, seed: 3 });
    const landed = (i) => 0.35 + i * p.stagger + p.growDur;
    p.bars.forEach((bar, i) => {
      const t0 = 0.35 + i * p.stagger;
      const kg = E.outCubic(lib.clamp01((t - t0) / p.growDur));
      if (kg <= 0) return;
      const cx = slot * (i + 0.5), x = cx - bw / 2;
      const hFull = (Math.abs(bar.value) / max) * (base - top), h = hFull * kg;
      if (h > 0.5) {
        if (p.fill === 'marker') {
          ctx.save();
          ctx.fillStyle = fillC;
          ctx.globalAlpha *= 0.9;
          ctx.beginPath(); ctx.rect(x + u * 0.4, base - h + u * 0.4, bw - u * 0.8, h - u * 0.4); ctx.fill();
          ctx.restore();
        } else {
          ctx.save();
          ctx.beginPath(); ctx.rect(x, base - h, bw, h); ctx.clip();
          I.strokes(f, I.hatch(x, base - h, bw, h, { gap: u * 1.6, seed: 5 + i }), { width: u * 0.35, color: fillC, style: 'pen', lift: 0, boil: b, wobble: 0.4 });
          ctx.restore();
        }
        I.strokes(f, [[[x, base], [x, base - h], [x + bw, base - h], [x + bw, base]]], { width: u * 0.5, color: th.ink, boil: b, seed: 8 + i, wobble: 0.5 });
      }
      // the value counts up above the bar
      const kv = E.outExpo(lib.clamp01((t - t0) / (p.growDur * 1.1)));
      const value = `${p.prefix}${Math.round(bar.value * kv)}${p.suffix}`;
      const V = lib.text.layout(ctx, value, { font, weight: 700, size: vs, maxWidth: slot * 0.95, fit: true, wrap: 'none', floor: p.floor });
      const vy = base - h - u * 1.4 - V.height;
      lib.text.fill(ctx, V, cx - V.width / 2, vy, { color: i === p.focus ? th.accent : th.ink });
      // the label under the baseline
      const L = lib.text.layout(ctx, bar.label, { font, weight: 700, size: ls, maxWidth: slot * 0.95, fit: true, wrap: 'none', floor: p.floor });
      ctx.save();
      ctx.globalAlpha *= lib.clamp01((t - t0) / 0.3);
      lib.text.fill(ctx, L, cx - L.width / 2, base + u * 1.5, { color: th.ink });
      ctx.restore();
      // the focus: circle the value, then a burst of sparks
      if (i === p.focus) {
        const tf = (p.focusAt > 0 ? p.focusAt - p.delay : landed(i) + 0.1);
        const kc = E.outCubic(lib.clamp01((t - tf) / 0.5));
        if (kc > 0) {
          const ccx = cx, ccy = vy + V.height / 2;
          const rx = V.width / 2 + u * 3, ry = V.height / 2 + u * 1.8;
          I.stroke(f, I.circle(ccx, ccy, rx, { ry, turns: 1.15, start: -2.3, seed: 12 }), { width: u * 0.6, color: th.accent, progress: kc, boil: b, seed: 13 });
          const ks = lib.clamp01((t - tf - 0.35) / 0.35);
          if (ks > 0) {
            for (let s = 0; s < 6; s++) {
              const a = -Math.PI / 2 + (s - 2.5) * 0.42;
              const r0 = Math.max(rx, ry) + u * 1.2, r1 = r0 + u * 2.6;
              I.stroke(f, I.line(ccx + Math.cos(a) * rx / ry * r0 * 0.8, ccy + Math.sin(a) * r0, ccx + Math.cos(a) * rx / ry * r1 * 0.8, ccy + Math.sin(a) * r1), { width: u * 0.5, color: th.accent2, progress: E.outCubic(ks), boil: b, seed: 40 + s });
            }
          }
        }
      }
    });
    if (cap) {
      ctx.save();
      ctx.globalAlpha *= lib.clamp01((t - 0.3) / 0.4);
      lib.text.fill(ctx, cap, (f.width - cap.width) / 2, f.height - cap.height, { color: th.muted });
      ctx.restore();
    }
    ctx.restore();
  },
});
