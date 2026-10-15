// A title on a solid plate: the plate is what sits behind every letter, so the text keeps its contrast over
// any background. An eyebrow label above it, sizes as a share of the frame's short side, a size floor.
asset({
  title: 'Title plate',
  description: 'A title on a solid rounded plate, with an optional eyebrow label: the plate guarantees the contrast behind every letter, whatever the background. Rises in, holds, fades out; sizes are a share of the frame\'s short side and never go under the floor. Takes a theme.',
  tags: ['text', 'title', 'plate', 'contrast', 'scene', 'overlay'],
  duration: 4,
  floor: 2.6,
  uses: ['easing'],
  params: {
    text: { type: 'string', default: 'A title on a plate', description: '*Asterisks* mark words in the accent colour; \\n breaks a line' },
    eyebrow: { type: 'string', default: '', description: 'A small label above the title (empty: none)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 6, min: 2.6, max: 20, step: 0.1, description: 'Title size in % of the frame\'s short side' },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'left' },
    font: { type: 'enum', options: ['headline', 'display', 'body', 'serif'], default: 'headline', description: 'Which of the theme\'s faces' },
    weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
    plate: { type: 'string', default: '', description: 'Plate colour, a CSS colour (empty: the theme\'s surface)' },
    ink: { type: 'string', default: '', description: 'Text colour, a CSS colour (empty: the theme\'s ink)' },
    inDur: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short, eyeSize = Math.max(size * 0.42, (2.6 / 100) * short);
    const pad = size * 0.5;
    const face = th.fonts?.[p.font] ?? 'Space Grotesk';
    const ink = p.ink || th.ink, accent = th.accent;
    const L = lib.text.layout(ctx, p.text, { font: face, weight: p.weight, size, maxWidth: f.width - pad * 2, maxHeight: f.height - pad * 2 - (p.eyebrow ? eyeSize * 1.6 : 0), fit: true, markup: true, lineHeight: 1.08, align: p.align });
    const E2 = p.eyebrow ? lib.text.layout(ctx, p.eyebrow.toUpperCase(), { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: eyeSize, letterSpacing: 0.08, maxWidth: f.width - pad * 2, fit: true }) : null;
    const innerW = Math.max(L.width, E2 ? E2.width : 0);
    const w = innerW + pad * 2, h = L.height + pad * 1.6 + (E2 ? eyeSize * 1.6 : 0);
    const x = p.align === 'left' ? 0 : p.align === 'right' ? f.width - w : (f.width - w) / 2;
    const y = (f.height - h) / 2;
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(k, out);
    ctx.translate(0, (1 - k) * size * 0.6);
    ctx.fillStyle = p.plate || th.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, size * 0.28);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + size * 0.28, Math.max(4, size * 0.09), h - size * 0.56);
    let ty = y + pad * 0.8;
    if (E2) {
      ctx.fillStyle = accent;
      lib.text.fill(ctx, E2, x + pad + (p.align === 'center' ? (innerW - E2.width) / 2 : p.align === 'right' ? innerW - E2.width : 0), ty);
      ty += eyeSize * 1.6;
    }
    const lx = x + pad - (L.boxWidth - innerW) * (p.align === 'center' ? 0.5 : p.align === 'right' ? 1 : 0);
    lib.text.fill(ctx, L, lx, ty, { color: ink, emColor: accent });
    ctx.restore();
  },
});
