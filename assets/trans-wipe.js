// Wipe: the next layer is revealed behind a soft, angled edge with a thin accent line.
asset({
  kind: 'transition',
  title: 'Soft wipe',
  description: 'Reveals the next layer behind a moving, angled edge with a soft feather and a thin accent line along it.',
  tags: ['transition', 'wipe'],
  duration: 0.8,
  uses: ['easing'],
  params: { angle: { type: 'number', default: 20, min: -80, max: 80 }, feather: { type: 'number', default: 0.06, min: 0, max: 0.3 }, accent: { type: 'color', default: '#ffd166' } },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const k = f.use('easing').inOutCubic(f.progress);
    if (f.from) ctx.drawImage(f.from.canvas, 0, 0);
    const slope = Math.tan((p.angle * Math.PI) / 180) * h, span = w + Math.abs(slope) + w * p.feather * 2;
    const x = -Math.abs(slope) - w * p.feather + k * span;
    const layer = f.offscreen(w, h);
    layer.ctx.drawImage(f.to.canvas, 0, 0);
    const g = layer.ctx.createLinearGradient(x, 0, x + w * p.feather + 1, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    layer.ctx.globalCompositeOperation = 'destination-in';
    layer.ctx.fillStyle = g;
    layer.ctx.beginPath();
    layer.ctx.moveTo(-w, 0); layer.ctx.lineTo(x + w * p.feather + slope, 0); layer.ctx.lineTo(x + w * p.feather, h); layer.ctx.lineTo(-w, h); layer.ctx.fill();
    ctx.drawImage(layer.canvas, 0, 0);
    if (k > 0 && k < 1) { ctx.strokeStyle = p.accent; ctx.lineWidth = Math.max(2, f.vmin * 0.4); ctx.beginPath(); ctx.moveTo(x + slope, 0); ctx.lineTo(x, h); ctx.stroke(); }
  },
});
