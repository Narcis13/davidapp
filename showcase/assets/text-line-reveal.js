// Per-line reveal: each line slides up from behind a mask at its own baseline.
const TEXT_PARAMS = {
  text: { type: 'text', default: 'No timeline.\nNo keyframes.\n*Just code.*' },
  font: { type: 'font', default: 'Space Grotesk' },
  weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
  size: { type: 'number', default: 120, min: 12, max: 600, step: 1, description: 'Largest size in px; the text shrinks to fit its box' },
  color: { type: 'color', default: '#f4f1ea' },
  accent: { type: 'color', default: '#ff5c8a', description: 'Colour of *emphasized* words' },
  emFont: { type: 'font', default: 'Playfair Display', description: 'Typeface of *emphasized* words' },
  emItalic: { type: 'boolean', default: true },
  align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
  valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
  lineHeight: { type: 'number', default: 1.15, min: 0.8, max: 2, step: 0.01 },
  tracking: { type: 'number', default: 0, min: -0.1, max: 0.5, step: 0.005 },
  uppercase: { type: 'boolean', default: false },
};

asset({
  title: 'Line reveal',
  description: 'Per-line text reveal: every line slides up from behind a mask, one after another, like titles in a film. Leaves by sliding up and out. For stacked statements, lists and sub-headings.',
  tags: ['text', 'text-animation', 'reveal', 'per-line', 'mask'],
  duration: 4,
  uses: ['easing', 'text-block'],
  params: {
    ...TEXT_PARAMS,
    stagger: { type: 'number', default: 0.14, min: 0, max: 2, step: 0.01, description: 'Seconds between lines' },
    inDur: { type: 'number', default: 0.7, min: 0.05, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const B = f.use('text-block');
    const { L, x, y, box } = B.layout(f, p);
    const leaving = p.outDur > 0 ? 1 - lib.clamp01((f.duration - f.t) / p.outDur) : 0;
    for (const line of L.lines) {
      const k = lib.stagger(f.t, line.index, p.stagger, p.inDur);
      if (k <= 0) continue;
      const e = E.outExpo(k);
      const out = E.inCubic(leaving);
      ctx.save();
      // the mask is the line's own box, a little taller for descenders
      ctx.beginPath();
      ctx.rect(box.x - 40, y + line.top - line.height * 0.08, box.width + 80, line.height * 1.2);
      ctx.clip();
      ctx.globalAlpha = 1 - out;
      lib.text.fillLine(ctx, line, x, y + (1 - e) * line.height * 1.15 - out * line.height, { color: p.color, emColor: p.accent });
      ctx.restore();
    }
  },
});
