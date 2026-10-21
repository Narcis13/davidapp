// The title of a music game: big stacked words with a neon split (two coloured copies that kick apart on every beat),
// an equalizer along the bottom and notes drifting up behind, all pulsing at a tempo. It drops in word by word over
// its first second, then keeps moving on f.ui.now: an interactive scene holds its last frame while it waits for a
// tap, and the title stays alive while it does. In a video (no session) it moves on its own time.
//
// Usage: the title scene of an interactive game, behind its menu buttons:
//   { "id": "title", "asset": "beat-title", "start": 0, "duration": 2.5, "params": { "title": "TAP\nTHE\nBEAT", "subtitle": "A rhythm game you play in the browser", "bpm": 120 } }
asset({
  title: 'Beat title',
  description: 'A title screen for a music game or a high-energy intro: stacked display words with a neon split that kicks on the beat, an equalizer along the bottom and notes drifting up, all at a tempo. Drops in word by word, then keeps moving while an interactive scene waits for input (it runs on f.ui.now). Takes a theme.',
  tags: ['title', 'game', 'music', 'neon', 'intro', 'interactive'],
  floor: 2.5,
  params: {
    title: { type: 'string', default: 'TAP\nTHE\nBEAT', description: 'One word per line (\\n breaks a line)' },
    subtitle: { type: 'string', default: 'A rhythm game you play in the browser' },
    bpm: { type: 'number', default: 120, min: 40, max: 200, step: 1 },
    top: { type: 'number', default: 0.07, min: 0, max: 0.6, step: 0.01, description: 'Where the title starts, as a share of the height' },
    size: { type: 'number', default: 30, min: 6, max: 40, step: 0.5, description: 'Line height of the title, % of the frame\'s short side' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const w = f.width, h = f.height, u = Math.min(w, h) / 100;
    const now = f.ui.live ? f.ui.now : f.t;
    const beat = 60 / p.bpm;
    const kick = Math.pow(1 - lib.math.fract(now / beat), 4);
    const accents = [th.accent, th.accent2, th.accent3, th.accent4 ?? th.accent];

    // a horizon: a glow, a striped sun and a grid floor rolling towards the viewer
    const hy = h * 0.6;
    for (let i = 6; i >= 1; i--) {
      ctx.fillStyle = lib.color.alpha(th.accent, (0.03 + 0.025 * kick) * (1 - i / 7));
      ctx.beginPath();
      ctx.ellipse(w / 2, hy, w * 0.11 * i, h * 0.045 * i, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const sunR = Math.min(w, h) * 0.24;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, hy);
    ctx.clip();
    const sun = ctx.createLinearGradient(0, hy - sunR, 0, hy);
    sun.addColorStop(0, lib.color.alpha(th.accent4 ?? th.accent2, 0.9));
    sun.addColorStop(1, lib.color.alpha(th.accent, 0.9));
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(w / 2, hy, sunR, Math.PI, 0);
    ctx.fill();
    // the stripes cut through the lower half of the sun and slide down
    ctx.fillStyle = th.bg;
    for (let i = 0; i < 7; i++) {
      const k = lib.math.fract(i / 7 + now * 0.08);
      const sy = hy - sunR * 0.55 * (1 - k);
      ctx.fillRect(w / 2 - sunR, sy, sunR * 2, Math.max(1, sunR * 0.05 * k + 0.3 * u));
    }
    ctx.restore();
    const floor = ctx.createLinearGradient(0, hy, 0, h);
    floor.addColorStop(0, th.bgAlt);
    floor.addColorStop(1, th.bg);
    ctx.fillStyle = floor;
    ctx.fillRect(0, hy, w, h - hy);
    ctx.strokeStyle = lib.color.alpha(th.accent2, 0.35);
    ctx.lineWidth = Math.max(1, 0.22 * u);
    for (let i = -9; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * w * 0.02, hy);
      ctx.lineTo(w / 2 + i * w * 0.2, h);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const z = lib.math.fract(i / 12 - now * 0.25);
      const yy = hy + (h - hy) * z * z;
      ctx.strokeStyle = lib.color.alpha(th.accent2, 0.1 + 0.35 * z);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
    }
    ctx.fillStyle = lib.color.alpha(th.accent, 0.8);
    ctx.fillRect(0, hy - 0.15 * u, w, 0.3 * u);

    // notes drifting up behind everything, each on its own lane and speed
    for (let i = 0; i < 26; i++) {
      const r1 = hash(i * 3.1), r2 = hash(i * 7.7 + 1), r3 = hash(i * 1.3 + 9);
      const speed = 0.04 + r2 * 0.06;
      const y = h * (1.1 - lib.math.fract(r1 + now * speed));
      const x = w * (0.06 + r3 * 0.88) + Math.sin(now * 0.8 + i) * 1.5 * u;
      const s = (0.6 + r2) * u;
      ctx.fillStyle = lib.color.alpha(accents[i % 4], 0.12 + 0.12 * r1);
      ctx.beginPath();
      ctx.roundRect(x - 3 * s, y - s, 6 * s, 2 * s, s);
      ctx.fill();
    }

    // the equalizer: bars whose heights follow a few slow waves and jump on the beat
    const bars = 24, bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = 0.3 + 0.25 * Math.sin(now * 2.1 + i * 0.7) + 0.2 * Math.sin(now * 3.3 - i * 1.3) + 0.35 * kick * hash(i + Math.floor(now / beat));
      const bh = Math.max(0.6 * u, v * 9 * u);
      const g = ctx.createLinearGradient(0, h - bh, 0, h);
      g.addColorStop(0, lib.color.alpha(accents[i % 3], 0.85));
      g.addColorStop(1, lib.color.alpha(accents[i % 3], 0.15));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(i * bw + bw * 0.18, h - bh, bw * 0.64, bh + u, [0.6 * u, 0.6 * u, 0, 0]);
      ctx.fill();
    }

    // the subtitle as an eyebrow above the title, then the title word by word: a drop with a little overshoot, and the
    // split on every beat
    let y = h * p.top;
    if (p.subtitle) {
      const k = lib.math.clamp01((f.t - 0.6) / 0.5);
      const L = lib.text.layout(ctx, p.subtitle.toUpperCase(), { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: 2.8 * u, letterSpacing: 0.18, maxWidth: w * 0.88, align: 'center', lineHeight: 1.3 });
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha *= k;
        lib.text.fill(ctx, L, (w - L.boxWidth) / 2, y + (1 - k) * 1.5 * u, { color: th.accent3 });
        ctx.restore();
      }
      y += L.height + 2.5 * u;
    }
    const words = p.title.split('\n').filter(Boolean);
    const size = p.size * u;
    words.forEach((word, i) => {
      const k = lib.math.clamp01((f.t - 0.12 - i * 0.16) / 0.5);
      if (k <= 0) { y += size * 0.92; return; }
      const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      const L = lib.text.layout(ctx, word, { font: th.fonts?.display ?? 'Anton', size, maxWidth: w * 0.9, fit: true, wrap: 'none', lineHeight: 1, align: 'center' });
      const x = (w - L.boxWidth) / 2;
      const yy = y - (1 - back) * size * 0.6;
      const split = (0.35 + 1.4 * kick) * u;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, k * 2);
      lib.text.fill(ctx, L, x - split, yy, { color: lib.color.alpha(th.accent, 0.85) });
      lib.text.fill(ctx, L, x + split, yy, { color: lib.color.alpha(th.accent2, 0.85) });
      lib.text.fill(ctx, L, x, yy, { color: th.ink });
      ctx.restore();
      y += size * 0.92;
    });
  },
});

/** A number in [0, 1) from any number, the same every frame. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
