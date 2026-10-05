// Per-character reveal: glyphs pop in one by one, in reading order, from the centre, or shuffled.
const TEXT_PARAMS = {
  text: { type: 'text', default: 'Same input. *Same pixels.*' },
  font: { type: 'font', default: 'Space Grotesk' },
  weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
  size: { type: 'number', default: 150, min: 12, max: 600, step: 1, description: 'Largest size in px; the text shrinks to fit its box' },
  color: { type: 'color', default: '#f4f1ea' },
  accent: { type: 'color', default: '#7cf5c0', description: 'Colour of *emphasized* words' },
  emFont: { type: 'font', default: 'Playfair Display', description: 'Typeface of *emphasized* words' },
  emItalic: { type: 'boolean', default: true },
  align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
  valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
  lineHeight: { type: 'number', default: 1.1, min: 0.8, max: 2, step: 0.01 },
  tracking: { type: 'number', default: 0, min: -0.1, max: 0.5, step: 0.005 },
  uppercase: { type: 'boolean', default: false },
};

asset({
  title: 'Character reveal',
  description: 'Per-character text reveal: each glyph scales and drops into place with a small overshoot. Order can be forward, backward, from the centre out, or a seeded shuffle. Emoji count as one glyph.',
  tags: ['text', 'text-animation', 'reveal', 'per-character', 'headline'],
  duration: 4,
  uses: ['easing', 'text-block'],
  params: {
    ...TEXT_PARAMS,
    order: { type: 'enum', options: ['forward', 'backward', 'center', 'random'], default: 'forward' },
    stagger: { type: 'number', default: 0.035, min: 0, max: 0.5, step: 0.005, description: 'Seconds between characters' },
    inDur: { type: 'number', default: 0.5, min: 0.05, max: 3, step: 0.01 },
    drop: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.05, description: 'Fall distance as a fraction of the line height' },
    spin: { type: 'number', default: 12, min: 0, max: 90, step: 1, description: 'Starting rotation in degrees (alternating direction)' },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const B = f.use('text-block');
    const { L, x, y } = B.layout(f, p);
    const exit = B.exit(f, p.outDur);
    const n = L.glyphs.length;
    const shuffled = p.order === 'random' ? f.rng.shuffle(L.glyphs.map((g) => g.index)) : null;
    const rank = (i) => (p.order === 'backward' ? n - 1 - i : p.order === 'center' ? Math.abs(i - (n - 1) / 2) : p.order === 'random' ? shuffled[i] : i);
    for (const g of L.glyphs) {
      const k = lib.stagger(f.t, rank(g.index), p.stagger, p.inDur);
      if (k <= 0) continue;
      const e = E.outBack(k);
      const cx = x + g.x + g.width / 2, cy = y + g.top + g.height / 2;
      ctx.save();
      ctx.globalAlpha = lib.clamp01(k * 3) * exit;
      ctx.translate(cx, cy - (1 - E.outCubic(k)) * p.drop * L.lineHeight);
      ctx.rotate(lib.deg((1 - E.outCubic(k)) * p.spin * (g.index % 2 ? 1 : -1)));
      ctx.scale(0.4 + 0.6 * e, 0.4 + 0.6 * e);
      ctx.fillStyle = g.em ? p.accent : p.color;
      lib.text.fillGlyph(ctx, g, -g.x - g.width / 2, -g.top - g.height / 2);
      ctx.restore();
    }
  },
});
