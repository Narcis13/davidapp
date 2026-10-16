// A doodle cut: a fat marker scribbles across the frame in a zigzag, and wherever it passes the next layer shows
// through, with a coloured marker rim riding the leading edge. Nothing is ever a flat colour: outside the stroke the
// old layer is still there, inside it the new one. The geometry depends only on the params and the progress (no
// random seed), so the same transition on two tracks at the same time (a title track and an art track) reads as one
// scribble.
// Usage: the cut between two scenes of a hand-drawn video, on the incoming item.
//   { "id": "scene-2", "asset": "text-handwrite", "start": 8, "duration": 10,
//     "transition": { "asset": "trans-scribble", "duration": 0.7, "params": { "rows": 4, "angle": -12 } } }
asset({
  kind: 'transition',
  title: 'Scribble wipe',
  description: 'Hand-drawn transition: a fat, wobbly marker stroke zigzags across the frame and paints the next layer in where it passes; a thin marker rim in the theme\'s marker colour (accent2) rides its leading edge. Rows, tilt, rim width and colour are params; deterministic, so the same transition on several tracks lines up. For doodle, sketchbook and whiteboard videos.',
  tags: ['transition', 'scribble', 'marker', 'wipe', 'sketch', 'hand-drawn', 'doodle'],
  duration: 0.7,
  uses: ['sketch-ink', 'easing'],
  params: {
    rows: { type: 'integer', default: 4, min: 2, max: 10, description: 'Zigzag passes across the frame' },
    angle: { type: 'number', default: -10, min: -45, max: 45, step: 1, description: 'Tilt of each pass, degrees' },
    rim: { type: 'number', default: 1.6, min: 0, max: 8, step: 0.1, description: 'Width of the coloured rim, % of the frame\'s short side' },
    color: { type: 'string', default: '', description: 'Rim colour, a CSS colour (empty: the theme\'s accent2, else a marker pink)' },
    wobble: { type: 'number', default: 0.35, min: 0, max: 2, step: 0.05 },
    ease: { type: 'enum', options: ['inOutCubic', 'outCubic', 'inOutQuad', 'linear'], default: 'inOutCubic' },
  },
  render(f, p) {
    const { ctx, width: W, height: H } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const k = p.ease === 'linear' ? f.progress : E[p.ease](f.progress);
    if (k <= 0) { if (f.from) ctx.drawImage(f.from.canvas, 0, 0); return; }
    if (k >= 1) { ctx.drawImage(f.to.canvas, 0, 0); return; }
    const short = Math.min(W, H);
    // the zigzag: rows passes, each tilted, alternating direction, wide enough to overlap its neighbours
    const n = p.rows, band = (H * 1.16) / n, width = band * 1.55;
    const tilt = Math.tan((p.angle * Math.PI) / 180) * W * 0.5;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const y = -H * 0.08 + band * (i + 0.5);
      const l = [-W * 0.12, y + tilt], r = [W * 1.12, y - tilt];
      if (i % 2) pts.push(r, l); else pts.push(l, r);
    }
    // the rim runs ahead of the reveal by about two rim widths along the path
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const lead = ((p.rim / 100) * short * 2) / total;
    // wobble and period fixed (by default they follow the width), so the rim and the inner stroke wobble together
    const o = { width, wobble: p.wobble, wobblePx: short * 0.03, period: short * 0.5, minWidth: 0.85, seed: 11, overshoot: 0, style: 'ink' };
    const rimC = p.color || f.theme?.accent2 || '#ff5c8a';
    const kIn = Math.max(0, k * (1 + lead) - lead), kRim = Math.min(1, k * (1 + lead));
    // where the stroke has passed: the inner mask
    const inner = f.offscreen(W, H);
    I.stroke(f, pts, { ...o, ctx: inner.ctx, color: '#000', progress: kIn });
    // the last stretch settles onto the whole new layer, so no corner the stroke missed is left behind
    const settle = f.lib.clamp01((k - 0.85) / 0.15);
    // the old layer, rubbed out where the stroke has passed
    if (f.from) {
      const old = f.offscreen(W, H);
      old.ctx.drawImage(f.from.canvas, 0, 0);
      old.ctx.globalCompositeOperation = 'destination-out';
      old.ctx.drawImage(inner.canvas, 0, 0);
      ctx.save(); ctx.globalAlpha = 1 - settle; ctx.drawImage(old.canvas, 0, 0); ctx.restore();
    }
    // the new layer, shown where the stroke has passed
    const neu = f.offscreen(W, H);
    neu.ctx.drawImage(inner.canvas, 0, 0);
    neu.ctx.globalCompositeOperation = 'source-in';
    neu.ctx.drawImage(f.to.canvas, 0, 0);
    ctx.drawImage(neu.canvas, 0, 0);
    if (settle > 0) { ctx.save(); ctx.globalAlpha = settle; ctx.drawImage(f.to.canvas, 0, 0); ctx.restore(); }
    // the marker rim: a band along the stroke's edge and ahead of it, never inside it
    if (p.rim > 0) {
      const rim = f.offscreen(W, H);
      I.stroke(f, pts, { ...o, ctx: rim.ctx, width: width + (p.rim / 100) * short * 2, color: rimC, progress: kRim });
      rim.ctx.globalCompositeOperation = 'destination-out';
      rim.ctx.drawImage(inner.canvas, 0, 0);
      ctx.save(); ctx.globalAlpha = 1 - settle; ctx.drawImage(rim.canvas, 0, 0); ctx.restore();
    }
  },
});
