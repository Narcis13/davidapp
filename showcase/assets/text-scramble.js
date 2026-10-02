// Decode: every glyph starts as a shuffling symbol and settles into the real character, left to right.
const TEXT_PARAMS = {
  text: { type: 'text', default: 'THE LIBRARY *COMPOUNDS*' },
  font: { type: 'font', default: 'Space Grotesk' },
  weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
  size: { type: 'number', default: 150, min: 12, max: 600, step: 1, description: 'Largest size in px; the text shrinks to fit its box' },
  color: { type: 'color', default: '#eef4ff' },
  accent: { type: 'color', default: '#5ce1e6', description: 'Colour of *emphasized* words and of glyphs still scrambling' },
  align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
  valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
  lineHeight: { type: 'number', default: 1.1, min: 0.8, max: 2, step: 0.01 },
  tracking: { type: 'number', default: 0.04, min: -0.1, max: 0.5, step: 0.005 },
  uppercase: { type: 'boolean', default: true },
};
const SYMBOLS = '#%&$@/\\<>[]{}=+*01';

asset({
  title: 'Scramble decode',
  description: 'Decoder text effect: each glyph cycles through seeded symbols before locking onto its real character, resolving left to right. For titles with a technical, data-like feel.',
  tags: ['text', 'text-animation', 'scramble', 'decode', 'per-character', 'title'],
  duration: 4,
  uses: ['easing', 'text-block'],
  params: {
    ...TEXT_PARAMS,
    resolveDur: { type: 'number', default: 1.4, min: 0.1, max: 6, step: 0.05, description: 'Seconds until the last glyph settles' },
    churn: { type: 'number', default: 18, min: 1, max: 60, step: 1, description: 'Symbol changes per second' },
    lead: { type: 'number', default: 0.35, min: 0.05, max: 2, step: 0.01, description: 'How long each glyph scrambles before it settles' },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const B = f.use('text-block');
    const { L, x, y } = B.layout(f, p);
    const exit = B.exit(f, p.outDur);
    const n = Math.max(1, L.glyphs.length);
    const tick = Math.floor(f.t * p.churn);
    for (const g of L.glyphs) {
      const settleAt = p.lead + (g.index / n) * Math.max(0, p.resolveDur - p.lead);
      const startAt = settleAt - p.lead;
      if (f.t < startAt) continue;
      const settled = f.t >= settleAt;
      const k = E.outCubic(lib.clamp01((f.t - startAt) / 0.2));
      ctx.globalAlpha = k * exit * (settled ? 1 : 0.75);
      if (settled) {
        ctx.fillStyle = g.em ? p.accent : p.color;
        lib.text.fillGlyph(ctx, g, x, y);
      } else {
        // a different symbol each tick, the same one every time this frame is drawn
        const sym = SYMBOLS[f.rng.fork(`${g.index}:${tick}`).int(0, SYMBOLS.length - 1)];
        ctx.fillStyle = p.accent;
        ctx.font = g.font;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'center';
        ctx.fillText(sym, x + g.x + g.width / 2, y + g.y);
        ctx.textAlign = 'left';
      }
    }
  },
});
