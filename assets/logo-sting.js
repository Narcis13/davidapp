// End card: the mark, the wordmark, and a tagline.
asset({
  title: 'Logo sting',
  description: 'End card: the Fablecut mark pops in, the wordmark is revealed character by character, and a tagline follows word by word. Takes a theme; adapts to vertical, horizontal and square frames.',
  tags: ['logo', 'brand', 'outro', 'end-card', 'scene'],
  duration: 4,
  uses: ['logo-mark', 'text-char-reveal', 'text-word-reveal'],
  params: {
    wordmark: { type: 'string', default: 'Fablecut' },
    tagline: { type: 'string', default: 'Every clip leaves *building blocks* behind' },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    outDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const th = f.use(p.theme);
    const safe = f.safe;
    const wide = safe.width > safe.height * 1.2;
    // stack the mark, wordmark and tagline in the middle of the safe zone
    const mark = Math.min(safe.width, safe.height) * (wide ? 0.34 : 0.3);
    const wordH = mark * 0.62, tagH = mark * (wide ? 0.42 : 0.62), gap = mark * 0.16;
    const total = mark + gap + wordH + gap * 0.6 + tagH;
    let y = safe.y + (safe.height - total) / 2;
    // the mark is drawn on its own layer, so it fades out as one piece instead of shape by shape
    // (with a margin, because the pop overshoots its box)
    const pad = Math.ceil(mark * 0.15);
    const layer = f.offscreen(mark + pad * 2, mark + pad * 2);
    f.use('logo-mark', { tile: th.accent, ink: th.bg, dot: th.accent2, scale: 0.92 }, { ctx: layer.ctx, x: pad, y: pad, width: mark, height: mark, hold: true });
    f.ctx.save();
    f.ctx.globalAlpha = p.outDur > 0 ? Math.max(0, Math.min(1, (f.duration - f.t) / p.outDur)) : 1;
    f.ctx.drawImage(layer.canvas, safe.x + (safe.width - mark) / 2 - pad, y - pad);
    f.ctx.restore();
    y += mark + gap;
    f.use('text-char-reveal', { text: p.wordmark, font: th.fonts.headline, weight: 700, size: wordH, color: th.ink, tracking: -0.02, stagger: 0.05, drop: 0.4, spin: 0, outDur: p.outDur },
      { x: safe.x, y, width: safe.width, height: wordH, at: 0.55 });
    y += wordH + gap * 0.6;
    f.use('text-word-reveal', { text: p.tagline, font: th.fonts.body, weight: 600, size: tagH * (wide ? 0.62 : 0.42), color: th.muted, accent: th.accent, emFont: th.fonts.serif, stagger: 0.06, rise: 30, valign: 'top', outDur: p.outDur },
      { x: safe.x + safe.width * 0.06, y, width: safe.width * 0.88, height: tagH, at: 1.2 });
  },
});
