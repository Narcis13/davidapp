// A small brand mark in a corner of the safe zone, drawn from an image asset.
asset({
  title: 'Watermark',
  description: 'A small logo in a corner of the safe zone with an optional label beside it, drawn from an image asset (by default the baked Fablecut mark). Fades in and out with its item.',
  tags: ['brand', 'overlay', 'watermark', 'image', 'logo'],
  uses: ['fablecut-mark'],
  params: {
    image: { type: 'image', default: 'fablecut-mark' },
    corner: { type: 'enum', options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], default: 'top-left' },
    size: { type: 'number', default: 60, min: 16, max: 400, step: 1 },
    offsetX: { type: 'number', default: 0, min: -400, max: 400, step: 1 },
    offsetY: { type: 'number', default: 0, min: -400, max: 400, step: 1 },
    label: { type: 'string', default: '' },
    labelColor: { type: 'color', default: '#f4f1ea' },
    opacity: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const img = f.image(p.image);
    const s = f.safe;
    const right = p.corner.endsWith('right'), bottom = p.corner.startsWith('bottom');
    const h = p.size, w = (img.width / img.height) * h;
    const x = right ? s.x + s.width - w - p.offsetX : s.x + p.offsetX;
    const y = bottom ? s.y + s.height - h - p.offsetY : s.y + p.offsetY;
    ctx.globalAlpha = p.opacity * lib.envelope(f.t, f.duration, 0.4, 0.4);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, w, h);
    if (p.label) {
      const L = lib.text.layout(ctx, p.label, { font: 'Space Grotesk', weight: 700, size: h * 0.42, wrap: 'none' });
      ctx.fillStyle = p.labelColor;
      lib.text.fill(ctx, L, right ? x - L.width - h * 0.25 : x + w + h * 0.25, y + (h - L.height) / 2);
    }
  },
});
