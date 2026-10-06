// A white disc that grows: use it as a mask to open a layer from its centre.
asset({
  title: 'Iris mask',
  description: 'A soft-edged white disc that grows open over its first moments: attach it as an alpha mask to reveal a layer inside a circle.',
  tags: ['mask', 'shape', 'reveal'],
  duration: 3,
  uses: ['easing'],
  params: { open: { type: 'number', default: 0.8, min: 0.05, max: 10, description: 'Seconds to open' }, size: { type: 'number', default: 0.75, min: 0, max: 1.5 }, feather: { type: 'number', default: 0.08, min: 0, max: 0.5 } },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const k = f.use('easing').outCubic(Math.min(1, f.t / p.open));
    const r = (Math.hypot(w, h) / 2) * p.size * k;
    if (r <= 0) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * (1 - p.feather), w / 2, h / 2, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
  },
});
