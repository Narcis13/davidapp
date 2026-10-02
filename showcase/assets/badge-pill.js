// A small rounded label that pops in: a kicker, a tag, a number.
asset({
  title: 'Badge pill',
  description: 'A rounded pill with a short label that pops in on a spring: for kickers above a title, numbered bullets, tags and status chips. Sized by its box height; aligns left, centre or right inside the box.',
  tags: ['badge', 'label', 'pill', 'ui', 'accent'],
  duration: 3,
  uses: ['spring'],
  params: {
    text: { type: 'string', default: 'NEW' },
    fill: { type: 'color', default: '#ffd166' },
    color: { type: 'color', default: '#0b0b12' },
    font: { type: 'font', default: 'JetBrains Mono' },
    weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'left' },
    outline: { type: 'boolean', default: false },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const s = f.use('spring', { stiffness: 320, damping: 15 })(f.t);
    if (s <= 0) return;
    const h = f.height;
    const L = lib.text.layout(ctx, p.text, { font: p.font, weight: p.weight, size: h * 0.5, letterSpacing: 0.06, wrap: 'none', maxWidth: Math.max(f.width - h * 0.9, h * 0.62), fit: true });
    const w = Math.max(h, L.width + h * 0.9);
    const x = p.align === 'left' ? 0 : p.align === 'right' ? f.width - w : (f.width - w) / 2;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    ctx.globalAlpha = lib.clamp01(f.t / 0.12) * exit;
    ctx.translate(x + w / 2, h / 2);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    if (p.outline) { ctx.strokeStyle = p.fill; ctx.lineWidth = Math.max(2, h * 0.06); ctx.stroke(); }
    else { ctx.fillStyle = p.fill; ctx.fill(); }
    ctx.fillStyle = p.outline ? p.fill : p.color;
    lib.text.fill(ctx, L, -L.width / 2, -L.height / 2);
  },
});
