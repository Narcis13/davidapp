// Handwritten notes with hand-drawn arrows, pointing at things: each callout is a label at one point of the box and a
// curved arrow from it to a target point, drawn on one after another (the label appears, the arrow swoops to its
// target and its head lands with a small overshoot). Place the item over whatever it annotates, with the same box.
// Usage: notes around a product shot, a 3D object, a chart, a diagram.
//   { "asset": "sketch-callouts", "start": 59, "duration": 7, "params": { "callouts": [
//       { "text": "no GPU", "x": 0.14, "y": 0.2, "tx": 0.36, "ty": 0.42 }, { "text": "same pixels", "x": 0.86, "y": 0.8, "tx": 0.64, "ty": 0.58 }],
//       "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.62, "width": 1, "height": 0.72 } }
asset({
  title: 'Sketched callouts',
  description: 'Handwritten notes with curved hand-drawn arrows pointing at targets: each callout is a label placed at a point of the box (fractions) and an arrow from the label to a target point; they draw on staggered (label, then the arrow swooping in, its head landing with an overshoot), then the ink boils. Labels can be underlined in the accent. Sizes are a share of the frame\'s short side with a floor. For annotating a product, a 3D object, a chart or a diagram in doodle style.',
  tags: ['sketch', 'hand-drawn', 'doodle', 'callout', 'arrow', 'annotation', 'label', 'overlay', 'explainer'],
  duration: 6,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    callouts: {
      type: 'array', minItems: 1, maxItems: 6,
      of: { type: 'object', fields: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, tx: { type: 'number' }, ty: { type: 'number' } } },
      default: [{ text: 'hand-drawn', x: 0.15, y: 0.2, tx: 0.42, ty: 0.45 }, { text: 'boils', x: 0.85, y: 0.8, tx: 0.58, ty: 0.55 }],
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    arrowColor: { type: 'enum', options: ['ink', 'accent', 'accent2', 'accent3'], default: 'accent2' },
    underline: { type: 'boolean', default: true, description: 'A quick accent underline under each label' },
    bend: { type: 'number', default: 0.25, min: -0.6, max: 0.6, step: 0.01, description: 'How much each arrow curves (sign: which side)' },
    size: { type: 'number', default: 5, min: 2.5, max: 12, step: 0.1, description: 'Label size, % of the frame\'s short side' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1 },
    delay: { type: 'number', default: 0.3, min: 0, max: 30, step: 0.05 },
    stagger: { type: 'number', default: 0.7, min: 0, max: 4, step: 0.05 },
    drawDur: { type: 'number', default: 0.55, min: 0.1, max: 3, step: 0.05, description: 'Seconds an arrow takes to draw' },
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
    const arrowC = th[p.arrowColor] ?? th.accent2;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    p.callouts.forEach((c, i) => {
      const t0 = i * p.stagger;
      const kl = E.outCubic(lib.clamp01((t - t0) / 0.35));
      if (kl <= 0) return;
      const L = lib.text.layout(ctx, c.text, { font, weight: 700, size: p.size * u, maxWidth: f.width * 0.45, maxLines: 2, fit: true, align: 'left', floor: p.floor });
      const lx = c.x * f.width, ly = c.y * f.height;
      const x0 = lib.clamp(lx - L.width / 2, 0, f.width - L.width), y0 = lib.clamp(ly - L.height / 2, 0, f.height - L.height);
      ctx.save();
      ctx.globalAlpha *= kl;
      lib.text.fill(ctx, L, x0, y0 + (1 - kl) * u * 1.5, { color: th.ink });
      ctx.restore();
      if (p.underline) {
        const ku = E.outCubic(lib.clamp01((t - t0 - 0.2) / 0.3));
        const uy = y0 + L.height + u * 0.4;
        if (ku > 0) I.stroke(f, I.line(x0 + L.width * 0.08, uy, x0 + L.width * 0.92, uy - u * 0.3), { width: u * 0.45, color: th.accent, progress: ku, boil: b, seed: 3 + i });
      }
      // the arrow leaves the label's edge nearest the target and lands a little short of it
      const tx = c.tx * f.width, ty = c.ty * f.height;
      const cx = x0 + L.width / 2, cy = y0 + L.height / 2;
      const dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy) || 1;
      const exitR = Math.min(Math.abs((L.width / 2 + u * 1.5) / (dx / d || 1e-6)), Math.abs((L.height / 2 + u * 1.5) / (dy / d || 1e-6)));
      const sx = cx + (dx / d) * exitR, sy = cy + (dy / d) * exitR;
      const ex = tx - (dx / d) * u * 1.2, ey = ty - (dy / d) * u * 1.2;
      const ka = E.outCubic(lib.clamp01((t - t0 - 0.25) / p.drawDur));
      if (ka > 0) {
        const [shaft, head] = I.arrow(sx, sy, ex, ey, { bend: p.bend * (i % 2 ? -1 : 1), head: u * 2.6 });
        I.stroke(f, shaft, { width: u * 0.6, color: arrowC, progress: ka, boil: b, seed: 10 + i });
        const kh = E.outBack(lib.clamp01((t - t0 - 0.25 - p.drawDur * 0.85) / 0.25));
        if (kh > 0) {
          ctx.save();
          ctx.translate(ex, ey); ctx.scale(kh, kh); ctx.translate(-ex, -ey);
          I.stroke(f, head, { width: u * 0.6, color: arrowC, boil: b, seed: 20 + i });
          ctx.restore();
        }
      }
    });
    ctx.restore();
  },
});
