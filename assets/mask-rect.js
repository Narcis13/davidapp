// A white rounded rectangle that fills its box: a mask that keeps a layer inside a window.
asset({
  title: 'Window mask',
  description: 'A white rounded rectangle filling its box: attach it as an alpha mask with a fixed transform to keep a layer inside a window while the layer itself moves or zooms (a kit-camera move on footage stays inside its frame). Corner radius as a share of the frame\'s short side.',
  tags: ['mask', 'shape', 'window', 'kit'],
  params: {
    radius: { type: 'number', default: 1.2, min: 0, max: 20, step: 0.1, description: 'Corner radius in % of the frame\'s short side' },
    inset: { type: 'number', default: 0, min: 0, max: 20, step: 0.1, description: 'Space kept inside the box, in % of the frame\'s short side' },
  },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const short = Math.min(f.clip?.width ?? w, f.clip?.height ?? h);
    const i = (p.inset / 100) * short;
    const r = Math.min((p.radius / 100) * short, (w - 2 * i) / 2, (h - 2 * i) / 2);
    if (w - 2 * i <= 0 || h - 2 * i <= 0) return;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(i, i, w - 2 * i, h - 2 * i, Math.max(0, r));
    ctx.fill();
  },
});
