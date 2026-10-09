// The last card: a logo, a title and a line, in for under a second and then perfectly still, so the end of a
// video holds (a feed loops it; the checks want the last frame held for 2 s or more). On a plate if asked: a
// small card on a dark frame reads as black frames to a detector, and the plate keeps its contrast too.
asset({
  title: 'End card',
  description: 'A closing card: a logo image, a title and one line, eased in within the first second and then completely still for the rest of the item, so the last frame holds; optionally on a solid plate. Sizes are a share of the frame\'s short side, with a floor. Takes a theme.',
  tags: ['end-card', 'outro', 'logo', 'title', 'scene', 'static'],
  duration: 4,
  floor: 2.6,
  uses: ['easing'],
  params: {
    logo: { type: 'image', default: 'fablecut-mark' },
    title: { type: 'string', default: 'Fablecut', description: '*Asterisks* mark the accent colour' },
    line: { type: 'string', default: 'Every clip makes the next one cheaper' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 8, min: 2.6, max: 20, step: 0.1, description: 'Title size in % of the frame\'s short side' },
    inDur: { type: 'number', default: 0.8, min: 0, max: 3, step: 0.01 },
    plate: { type: 'boolean', default: false, description: 'Draw the card on a solid plate (the theme surface) filling its box' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short;
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    const img = f.image(p.logo);
    const logoH = size * 1.8, logoW = (img.width / img.height) * logoH;
    const T = lib.text.layout(ctx, p.title, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size, maxWidth: f.width * 0.9, fit: true, markup: true, align: 'center' });
    const Ln = lib.text.layout(ctx, p.line, { font: th.fonts?.body ?? 'Inter', weight: 600, size: Math.max((2.6 / 100) * short, size * 0.42), maxWidth: f.width * 0.9, fit: true, align: 'center' });
    const gap = size * 0.4;
    const total = logoH + gap + T.height + gap * 0.6 + Ln.height;
    let y = (f.height - total) / 2;
    ctx.save();
    ctx.globalAlpha = k;
    if (p.plate) {
      ctx.fillStyle = th.surface;
      ctx.beginPath();
      ctx.roundRect(0, 0, f.width, f.height, size * 0.4);
      ctx.fill();
    }
    ctx.translate(0, (1 - k) * size * 0.5);
    ctx.drawImage(img, (f.width - logoW) / 2, y, logoW, logoH);
    y += logoH + gap;
    lib.text.fill(ctx, T, (f.width - T.boxWidth) / 2, y, { color: th.ink, emColor: th.accent });
    y += T.height + gap * 0.6;
    ctx.fillStyle = th.muted;
    lib.text.fill(ctx, Ln, (f.width - Ln.boxWidth) / 2, y);
    ctx.restore();
  },
});
