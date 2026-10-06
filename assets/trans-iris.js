// Iris: the next layer opens up inside a circle, edged with a ring.
asset({
  kind: 'transition',
  title: 'Iris',
  description: 'A mask reveal: the next layer opens inside a growing circle edged with a coloured ring; with nothing before it, it opens from black.',
  tags: ['transition', 'iris', 'mask', 'reveal'],
  duration: 0.9,
  uses: ['easing'],
  params: { x: { type: 'number', default: 0.5, min: 0, max: 1 }, y: { type: 'number', default: 0.5, min: 0, max: 1 }, ring: { type: 'color', default: '#ffd166' } },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const k = f.use('easing').inOutCubic(f.progress);
    const cx = p.x * w, cy = p.y * h, r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * k;
    if (f.from) ctx.drawImage(f.from.canvas, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(f.to.canvas, 0, 0);
    ctx.restore();
    if (k > 0 && k < 1) { ctx.strokeStyle = p.ring; ctx.lineWidth = f.vmin * 0.8 * (1 - k) + 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  },
});
