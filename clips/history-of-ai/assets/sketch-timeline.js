// A timeline scribbled along the bottom of the page: a wavy ink line with ticks and years. A red pin
// hops from year to year as the story reaches them, and red marker fills the line behind it.
asset({
  title: 'Sketched timeline',
  description: 'Hand-drawn timeline along the bottom (or top) of the safe zone: a wavy ink line with a tick and a label per stop, a red pin that hops to each stop at its time, and red marker filling the road travelled. Future stops are pencil-faint; the current one is bold. Stops are { at (seconds from the start of the item), label }.',
  tags: ['sketch', 'hand-drawn', 'timeline', 'progress', 'chapters', 'overlay'],
  uses: ['sketch-ink', 'easing'],
  params: {
    stops: {
      type: 'array', minItems: 2, maxItems: 16,
      of: { type: 'object', fields: { at: { type: 'number', min: 0 }, label: { type: 'string' } } },
      default: [{ at: 0, label: '1950' }, { at: 1.5, label: '1980' }, { at: 3, label: '2010' }, { at: 4.5, label: 'now' }],
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    position: { type: 'enum', options: ['bottom', 'top'], default: 'bottom' },
    height: { type: 'number', default: 0.09, min: 0.03, max: 0.3, step: 0.005, description: 'Fraction of the safe-zone height' },
    drawDur: { type: 'number', default: 0.8, min: 0.1, max: 5, step: 0.05 },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const b = I.boil(f, p.boil);
    const box = f.safe, H = box.height * p.height;
    const top = p.position === 'bottom' ? box.y + box.height - H : box.y;
    const ly = top + H * 0.38;
    const n = p.stops.length, x0 = box.x + box.width * 0.04, x1 = box.x + box.width * 0.96;
    const xs = p.stops.map((_, i) => lib.lerp(x0, x1, n === 1 ? 0.5 : i / (n - 1)));
    const lw = Math.max(2, H * 0.06);
    const k = lib.clamp01(f.t / p.drawDur);
    ctx.save();
    if (p.outDur > 0) ctx.globalAlpha = lib.clamp01((f.duration - f.t) / p.outDur);

    // where the pin is: hops to each stop at its time
    let cur = -1;
    p.stops.forEach((s, i) => { if (f.t >= s.at) cur = i; });
    let px = x0;
    if (cur >= 0) {
      const hop = E.inOutCubic(lib.clamp01((f.t - p.stops[cur].at) / 0.55));
      px = cur === 0 ? xs[0] : lib.lerp(xs[cur - 1], xs[cur], hop);
    }
    const wave = [];
    for (let i = 0; i <= 24; i++) wave.push([lib.lerp(x0 - H * 0.2, x1 + H * 0.2, i / 24), ly + Math.sin(i * 1.3) * H * 0.04]);
    if (cur >= 0 && px > x0) I.stroke(f, [[x0 - H * 0.15, ly], [px, ly]], { style: 'marker', width: H * 0.2, color: th.accent, boil: b, seed: 2, progress: k });
    I.stroke(f, wave, { width: lw, color: th.ink, boil: b, seed: 1, progress: k });

    const fs = Math.min(H * 0.34, (x1 - x0) / Math.max(1, n - 1) * 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    p.stops.forEach((s, i) => {
      const tk = lib.clamp01((k - i / n * 0.8) / 0.2);
      if (tk <= 0) return;
      I.stroke(f, I.line(xs[i], ly - H * 0.1, xs[i], ly + H * 0.1), { width: lw * 0.9, color: th.ink, boil: b, seed: 10 + i, progress: tk });
      const state = i === cur ? 2 : i < cur ? 1 : 0;
      const big = i === cur ? 1 + 0.25 * E.outBack(lib.clamp01((f.t - s.at - 0.35) / 0.35)) : 1;
      ctx.save();
      ctx.globalAlpha *= tk * (state === 0 ? 0.45 : state === 1 ? 0.8 : 1);
      ctx.fillStyle = state === 2 ? th.accent : state === 1 ? th.ink : th.pencil;
      ctx.font = `${state ? 700 : 400} ${fs * big}px "Space Grotesk"`;
      ctx.fillText(s.label, xs[i], ly + H * 0.2 + fs * big);
      ctx.restore();
    });

    // the pin, bouncing as it lands
    if (cur >= 0 && k >= 1) {
      const land = lib.clamp01((f.t - p.stops[cur].at) / 0.55);
      const lift = Math.sin(Math.PI * land) * H * 0.45 * (cur > 0 ? 1 : 0);
      const pr = H * 0.17, py = ly - H * 0.2 - pr - lift;
      ctx.fillStyle = th.accent;
      ctx.beginPath(); ctx.arc(px, py - pr * 0.4, pr, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(px, ly - H * 0.12 - lift); ctx.closePath(); ctx.fill();
      I.stroke(f, I.circle(px, py - pr * 0.4, pr, { turns: 1.05, seed: 5 }), { width: lw * 0.7, color: th.ink, boil: b, seed: 6 });
      ctx.fillStyle = th.paper;
      ctx.beginPath(); ctx.arc(px, py - pr * 0.4, pr * 0.38, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
});
