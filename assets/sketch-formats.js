// One layout in three shapes, drawn by hand: a wide (16:9), a tall (9:16) and a square (1:1) frame side by side on one
// baseline, each holding the same blocks (a bouncing ball, two lines of "text" scribbled in ink, a button) re-flowed
// for its shape rather than cropped. The ball bounces in all three at once, because it is one composition. Frames draw
// on one after another, blocks pop in, a handwritten label sits under each.
// Usage: "one composition, every shape" in a doodle explainer of a video tool or a responsive design.
//   { "asset": "sketch-formats", "start": 50, "duration": 8, "params": { "labels": ["16:9", "9:16", "1:1"], "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.63, "width": 0.92, "height": 0.72 } }
const LAYOUTS = {
  // each block in fractions of its frame: ball { x, y, r (of the short side) }, text lines [x0, x1, y], pill [x, y, w, h]
  wide: { ball: [0.73, 0.52, 0.22], lines: [[0.09, 0.5, 0.34], [0.09, 0.38, 0.5]], pill: [0.09, 0.64, 0.22, 0.13] },
  tall: { ball: [0.5, 0.28, 0.24], lines: [[0.14, 0.86, 0.55], [0.14, 0.66, 0.63]], pill: [0.14, 0.74, 0.46, 0.065] },
  square: { ball: [0.5, 0.33, 0.18], lines: [[0.16, 0.84, 0.62], [0.16, 0.64, 0.72]], pill: [0.16, 0.8, 0.36, 0.1] },
};

asset({
  title: 'Sketched formats',
  description: 'Three hand-drawn frames on one baseline (16:9, 9:16, 1:1), each holding the same blocks re-flowed for its shape: a ball, two scribbled text lines and a button. The frames draw on staggered, the blocks pop in, and the ball bounces in all three in sync (one composition). A handwritten label under each frame. For doodle explainers of multi-format video, responsive layouts, "one source, every screen".',
  tags: ['sketch', 'hand-drawn', 'doodle', 'formats', 'aspect-ratio', 'responsive', 'explainer', 'diagram'],
  duration: 8,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    labels: { type: 'array', of: { type: 'string' }, minItems: 3, maxItems: 3, default: ['16:9', '9:16', '1:1'] },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    size: { type: 'number', default: 5, min: 2.5, max: 12, step: 0.1, description: 'Label size, % of the frame\'s short side' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1 },
    delay: { type: 'number', default: 0.2, min: 0, max: 30, step: 0.05 },
    stagger: { type: 'number', default: 0.3, min: 0, max: 2, step: 0.01 },
    drawDur: { type: 'number', default: 0.6, min: 0.1, max: 3, step: 0.05 },
    bounce: { type: 'number', default: 0.9, min: 0, max: 3, step: 0.05, description: 'Seconds per bounce of the ball (0: still)' },
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
    const labels = p.labels.map((s) => lib.text.layout(ctx, s, { font, weight: 700, size: p.size * u, maxWidth: f.width / 3, fit: true, wrap: 'none', floor: p.floor }));
    const labelH = Math.max(...labels.map((L) => L.height)) + u * 2.5;
    // frame sizes from one height unit h: wide 0.62h tall, tall h, square 0.72h
    const gap = u * 5, shadow = u * 1.3;
    const h = Math.min(f.height - labelH - shadow, (f.width - gap * 2 - shadow) / (0.62 * 16 / 9 + 9 / 16 + 0.72));
    const sizes = { wide: [0.62 * h * 16 / 9, 0.62 * h], tall: [h * 9 / 16, h], square: [0.72 * h, 0.72 * h] };
    const total = sizes.wide[0] + sizes.tall[0] + sizes.square[0] + gap * 2;
    const base = (f.height - labelH + h) / 2;
    let x = (f.width - total) / 2;
    const hop = p.bounce > 0 ? Math.abs(Math.sin((Math.PI * f.t) / p.bounce)) : 0;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ['wide', 'tall', 'square'].forEach((key, i) => {
      const [fw, fh] = sizes[key], fx = x, fy = base - fh;
      x += fw + gap;
      const t0 = i * p.stagger;
      const kd = E.outCubic(lib.clamp01((t - t0) / p.drawDur));
      if (kd <= 0) return;
      I.card(f, fx, fy, fw, fh, { progress: kd, fill: th.surface ?? '#fffaf0', color: th.ink, shadow: th.ink, shadowX: shadow * 0.8, shadowY: shadow, radius: u * 1.4, boil: b, seed: 4 + i, width: u * 0.5 });
      const lay = LAYOUTS[key], m = Math.min(fw, fh);
      const kb = (d) => E.outBack(lib.clamp01((t - t0 - p.drawDur * 0.6 - d) / 0.4));
      // two scribbled lines of "text"
      lay.lines.forEach(([x0, x1, y], j) => {
        const k = E.outCubic(lib.clamp01((t - t0 - p.drawDur * 0.6 - 0.1 - j * 0.08) / 0.35));
        if (k > 0) I.stroke(f, I.line(fx + fw * x0, fy + fh * y, fx + fw * x1, fy + fh * y), { width: m * 0.065, color: j ? th.pencil : th.ink, progress: k, boil: b, seed: 20 + i * 3 + j, wobble: 0.6 });
      });
      // the button
      const kp = kb(0.25);
      if (kp > 0) {
        const [px, py, pw, ph] = lay.pill;
        ctx.save();
        ctx.translate(fx + fw * (px + pw / 2), fy + fh * (py + ph / 2)); ctx.scale(kp, kp);
        ctx.fillStyle = th.accent;
        ctx.beginPath(); ctx.roundRect(-fw * pw / 2, -fh * ph / 2, fw * pw, fh * ph, fh * ph / 2); ctx.fill();
        ctx.restore();
      }
      // the ball, bouncing in sync in every frame
      const kball = kb(0);
      if (kball > 0) {
        const [bx, by, br] = lay.ball, r = m * br * kball;
        const cx = fx + fw * bx, cy = fy + fh * by - hop * m * 0.07;
        ctx.fillStyle = lib.color.alpha(th.ink, 0.12);
        ctx.beginPath(); ctx.ellipse(cx, fy + fh * by + r * 1.05, r * (0.8 - hop * 0.2), r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = th.accent2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        I.stroke(f, I.circle(cx, cy, r, { seed: 30 + i }), { width: u * 0.4, color: th.ink, boil: b, seed: 33 + i, wobble: 0.5 });
      }
      // the label
      const L = labels[i];
      ctx.save();
      ctx.globalAlpha *= lib.clamp01((t - t0 - 0.2) / 0.3);
      lib.text.fill(ctx, L, fx + fw / 2 - L.width / 2, base + u * 2.5, { color: th.ink });
      ctx.restore();
    });
    ctx.restore();
  },
});
