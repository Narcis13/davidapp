// The results card of a music game: an eyebrow, a rank letter (S to D) with a neon split, the score counting up,
// stars that pop in one by one, and a row of stats (perfect, good, missed, best combo, accuracy). Its numbers are
// params, so an interactive clip binds them to its variables ({ "$var": "score" }); it animates in over its own time
// and then breathes on f.ui.now while the scene waits for a tap on its buttons.
//
// Usage: the results scene of a rhythm game, with ui-button items for "play again" and "menu" below it:
//   { "id": "results", "asset": "beat-results", "start": 44, "duration": 3, "params": { "score": { "$var": "score" },
//     "hits": { "$var": "hits" }, "perfects": { "$var": "perfects" }, "best": { "$var": "best" }, "total": 58 } }
asset({
  title: 'Beat results',
  description: 'The results card of a music game or quiz: an eyebrow, a rank letter from S to D with a neon split, the score counting up, up to three stars popping in, and stats (perfect, good, missed, best combo, accuracy) on a panel. Numbers are params to bind to an interactive clip\'s variables; it animates in, then breathes while the scene waits. Takes a theme.',
  tags: ['game', 'results', 'score', 'interactive', 'ui', 'neon'],
  floor: 2.5,
  params: {
    eyebrow: { type: 'string', default: 'SONG CLEAR' },
    retry: { type: 'string', default: 'KEEP PRACTISING', description: 'The eyebrow for a D' },
    score: { type: 'number', default: 0, min: 0 },
    hits: { type: 'number', default: 0, min: 0, description: 'Notes caught' },
    perfects: { type: 'number', default: 0, min: 0, description: 'Notes caught right on the beat' },
    best: { type: 'number', default: 0, min: 0, description: 'Best combo' },
    total: { type: 'number', default: 1, min: 1, description: 'Notes in the song' },
    strays: { type: 'number', default: 0, min: 0, description: 'Presses that caught nothing: they count against the accuracy, so mashing every key does not pay' },
    top: { type: 'number', default: 0.08, min: 0, max: 0.5, step: 0.01, description: 'Where the card starts, as a share of the height' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const w = f.width, h = f.height, u = Math.min(w, h) / 100;
    const now = f.ui.live ? f.ui.now : f.t;
    const t = f.t;
    const ease = (k) => 1 - Math.pow(1 - lib.math.clamp01(k), 3);
    // accuracy: the notes caught, out of the notes and the stray presses
    const acc = Math.min(1, p.hits / (p.total + p.strays));
    const ratio = p.hits ? p.perfects / p.hits : 0;
    const rank = acc >= 0.95 && ratio >= 0.75 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
    const stars = { S: 3, A: 3, B: 2, C: 1, D: 0 }[rank];
    const rankColor = { S: th.accent3, A: th.accent2, B: th.accent, C: th.accent4 ?? th.accent, D: th.muted }[rank];
    const font = th.fonts ?? {};
    let y = h * p.top;

    const eyebrow = lib.text.layout(ctx, rank === 'D' ? p.retry : p.eyebrow, { font: font.mono ?? 'JetBrains Mono', weight: 700, size: 3.2 * u, letterSpacing: 0.35, wrap: 'none' });
    ctx.save();
    ctx.globalAlpha *= ease(t / 0.4);
    lib.text.fill(ctx, eyebrow, (w - eyebrow.boxWidth) / 2, y, { color: th.accent3 });
    ctx.restore();
    y += eyebrow.height + 3 * u;

    // the rank: a big letter that lands with a punch and keeps a slow split
    const kr = ease((t - 0.9) / 0.35);
    const R = lib.text.layout(ctx, rank, { font: font.display ?? 'Anton', size: 34 * u, wrap: 'none', lineHeight: 1 });
    if (kr > 0) {
      const s = 1 + 0.6 * (1 - kr);
      const split = (0.5 + 0.5 * Math.sin(now * 3)) * 0.8 * u;
      ctx.save();
      ctx.translate(w / 2, y + R.height / 2);
      ctx.scale(s, s);
      ctx.globalAlpha *= kr;
      lib.text.fill(ctx, R, -R.boxWidth / 2 - split, -R.height / 2, { color: lib.color.alpha(th.accent, 0.8) });
      lib.text.fill(ctx, R, -R.boxWidth / 2 + split, -R.height / 2, { color: lib.color.alpha(th.accent2, 0.8) });
      lib.text.fill(ctx, R, -R.boxWidth / 2, -R.height / 2, { color: rankColor });
      ctx.restore();
    }
    y += R.height + 2 * u;

    // stars, one after another
    const sr = 4.2 * u, gap = 11 * u;
    for (let i = 0; i < 3; i++) {
      const x = w / 2 + (i - 1) * gap;
      const k = ease((t - 1.3 - i * 0.18) / 0.3);
      const on = i < stars;
      ctx.save();
      ctx.translate(x, y + sr);
      const pop = on ? 1 + 0.5 * (1 - k) + 0.06 * Math.sin(now * 4 + i) : 1;
      ctx.scale(pop, pop);
      ctx.globalAlpha *= on ? k : 0.5 * ease(t / 0.6);
      star(ctx, sr);
      ctx.fillStyle = on ? th.accent4 ?? th.accent3 : lib.color.alpha(th.ink, 0.12);
      ctx.fill();
      if (on) { ctx.lineWidth = 0.4 * u; ctx.strokeStyle = lib.color.lighten(th.accent4 ?? th.accent3, 0.4); ctx.stroke(); }
      ctx.restore();
    }
    y += sr * 2 + 5 * u;

    // the score, counting up with the last digits rolling
    const ks = ease((t - 0.3) / 1.1);
    const shown = Math.round(p.score * ks);
    const label = lib.text.layout(ctx, 'SCORE', { font: font.mono ?? 'JetBrains Mono', weight: 700, size: 2.8 * u, letterSpacing: 0.3, wrap: 'none' });
    lib.text.fill(ctx, label, (w - label.boxWidth) / 2, y, { color: th.muted });
    y += label.height + 1 * u;
    const S = lib.text.layout(ctx, String(shown).replace(/\B(?=(\d{3})+(?!\d))/g, ','), { font: font.display ?? 'Anton', size: 13 * u, wrap: 'none', lineHeight: 1 });
    lib.text.fill(ctx, S, (w - S.boxWidth) / 2, y, { color: th.ink });
    y += S.height + 4 * u;

    // the stats panel
    const kp = ease((t - 0.6) / 0.5);
    const pw = Math.min(w * 0.86, 80 * u), px = (w - pw) / 2;
    const rows = [['Perfect', p.perfects, th.accent3], ['Good', Math.max(0, p.hits - p.perfects), th.accent2], ['Missed', Math.max(0, p.total - p.hits), th.accent], ['Stray taps', p.strays, th.muted], ['Best combo', p.best, th.ink], ['Accuracy', `${Math.round(acc * 100)}%`, th.ink]];
    const rh = 6.2 * u, ph = rows.length * rh + 4 * u;
    ctx.save();
    ctx.globalAlpha *= kp;
    ctx.translate(0, (1 - kp) * 3 * u);
    for (let k = 4; k >= 1; k--) {
      ctx.fillStyle = `rgba(0,0,0,${0.06 * (1 - (k - 1) / 4)})`;
      ctx.beginPath(); ctx.roundRect(px - k * 0.6 * u, y - k * 0.6 * u + 1.2 * u, pw + k * 1.2 * u, ph + k * 1.2 * u, 3 * u + k * 0.6 * u); ctx.fill();
    }
    ctx.fillStyle = lib.color.alpha(th.surface, 0.92);
    ctx.beginPath(); ctx.roundRect(px, y, pw, ph, 3 * u); ctx.fill();
    ctx.strokeStyle = lib.color.alpha(th.ink, 0.12);
    ctx.lineWidth = 0.2 * u;
    ctx.stroke();
    rows.forEach(([name, value, color], i) => {
      const ry = y + 2 * u + i * rh;
      const N = lib.text.layout(ctx, name, { font: font.body ?? 'Inter', weight: 600, size: 3.1 * u, wrap: 'none' });
      const V = lib.text.layout(ctx, String(value), { font: font.headline ?? 'Space Grotesk', weight: 700, size: 3.4 * u, wrap: 'none' });
      lib.text.fill(ctx, N, px + 4 * u, ry + (rh - N.height) / 2, { color: th.muted });
      lib.text.fill(ctx, V, px + pw - 4 * u - V.boxWidth, ry + (rh - V.height) / 2, { color });
      if (i < rows.length - 1) { ctx.fillStyle = lib.color.alpha(th.ink, 0.07); ctx.fillRect(px + 4 * u, ry + rh, pw - 8 * u, Math.max(1, 0.12 * u)); }
    });
    ctx.restore();
  },
});

/** A five-pointed star path of outer radius r around the origin. */
function star(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}
