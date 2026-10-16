// A checklist written by hand: rows arrive one after another, each with a wobbly hand-drawn box, then a marker tick
// is drawn into each box on its cue (and the row darkens from pencil to ink as it is ticked). Ticks are timed evenly
// from tickStart, or per row. Sizes are a share of the frame's short side with a floor; the rows are left aligned.
// Usage: the checks a product passes, steps completed, a feature list ticked off.
//   { "asset": "sketch-checklist", "start": 66, "duration": 10, "params": { "items": ["Inside the safe area", "Contrast of 4.5 : 1"],
//       "tickStart": 1.2, "tickEvery": 0.7, "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.63, "width": 0.9, "height": 0.7 } }
asset({
  title: 'Sketched checklist',
  description: 'A hand-written checklist: rows slide in staggered, each with a wobbly hand-drawn box; then a marker tick is drawn into each box on its cue (evenly from tickStart, or per row) with a small pop, and the row darkens from pencil to ink. Optional handwritten heading. Left aligned, sizes a share of the frame\'s short side with a floor. For doodle explainers: checks passed, steps done, features ticked off.',
  tags: ['sketch', 'hand-drawn', 'doodle', 'checklist', 'list', 'tick', 'explainer', 'marketing', 'scene'],
  duration: 8,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    items: { type: 'array', of: { type: 'string' }, minItems: 1, maxItems: 8, default: ['Write the script', 'Draw the frames', 'Check every shot', 'Ship it'] },
    heading: { type: 'string', default: '', description: 'A handwritten heading above the rows (empty: none)' },
    ticks: { type: 'array', of: { type: 'number', min: 0 }, maxItems: 8, default: [], description: 'Seconds from the item start for each row\'s tick (empty: tickStart + i × tickEvery)' },
    tickStart: { type: 'number', default: 1.2, min: 0, max: 60, step: 0.05 },
    tickEvery: { type: 'number', default: 0.6, min: 0.05, max: 10, step: 0.05 },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    tickColor: { type: 'enum', options: ['accent', 'accent2', 'accent3', 'ink'], default: 'accent3' },
    size: { type: 'number', default: 5, min: 2.5, max: 12, step: 0.1, description: 'Row text size, % of the frame\'s short side' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1 },
    spacing: { type: 'number', default: 1.85, min: 1.2, max: 3, step: 0.05, description: 'Row pitch, in row text sizes' },
    delay: { type: 'number', default: 0.1, min: 0, max: 30, step: 0.05 },
    stagger: { type: 'number', default: 0.1, min: 0, max: 2, step: 0.01, description: 'Seconds between rows arriving' },
    inDur: { type: 'number', default: 0.45, min: 0.1, max: 2, step: 0.01 },
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
    const n = p.items.length;
    const S = Math.max(p.size, p.floor) * u;
    const box = S * 0.95, textX = box + S * 0.75;
    const H = lib.text.layout(ctx, p.heading || ' ', { font, weight: 700, size: S * 1.2, maxWidth: f.width, fit: true, wrap: 'none', floor: p.floor });
    const headH = p.heading ? H.height + S * 0.6 : 0;
    // the pitch shrinks to the box when it must, never the text
    const pitch = Math.min(S * p.spacing, (f.height - headH) / n);
    const rows = p.items.map((s) => lib.text.layout(ctx, s, { font, weight: 700, size: S, maxWidth: f.width - textX, fit: true, wrap: 'none', floor: p.floor }));
    const blockH = headH + pitch * n;
    const y0 = (f.height - blockH) / 2;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    if (p.heading) {
      ctx.save();
      ctx.globalAlpha *= E.outCubic(lib.clamp01(t / p.inDur));
      lib.text.fill(ctx, H, 0, y0, { color: th.ink });
      ctx.restore();
    }
    const tickC = th[p.tickColor] ?? th.accent3;
    rows.forEach((L, i) => {
      const k = E.outCubic(lib.clamp01((t - i * p.stagger) / p.inDur));
      if (k <= 0) return;
      const cy = y0 + headH + pitch * (i + 0.5);
      const at = (p.ticks[i] ?? (p.tickStart + i * p.tickEvery)) - p.delay;
      const kt = lib.clamp01((t - at) / 0.35);
      ctx.save();
      ctx.globalAlpha *= k;
      ctx.translate(-(1 - k) * u * 4, 0);
      // the box
      I.stroke(f, I.roundBox(0, cy - box / 2, box, box, box * 0.12), { width: u * 0.45, color: th.ink, closed: true, progress: k, boil: b, seed: 5 + i, wobble: 0.6 });
      // the row text, pencil until it is ticked, then ink
      const col = kt > 0 ? lib.color.mix(th.muted, th.ink, E.outCubic(kt)) : th.muted;
      lib.text.fill(ctx, L, textX, cy - L.height / 2, { color: col });
      // the tick, overshooting the box like a real one, with a little pop
      if (kt > 0) {
        const pop = 1 + 0.18 * Math.sin(Math.PI * lib.clamp01((t - at - 0.25) / 0.3));
        ctx.save();
        ctx.translate(box * 0.55, cy); ctx.scale(pop, pop); ctx.translate(-box * 0.55, -cy);
        I.stroke(f, I.tick(box * 0.55, cy - box * 0.08, box * 1.25), { width: u * 0.95, color: tickC, progress: E.outCubic(kt), boil: b, seed: 15 + i, wobble: 0.5 });
        ctx.restore();
      }
      ctx.restore();
    });
    ctx.restore();
  },
});
