// Per-word reveal. v2: words now rise from behind a mask at their own line (the default "mask"
// mode) instead of fading through each other; v1's look is still there as mode "rise", and
// "pop" scales each word in on a spring-like overshoot.
const TEXT_PARAMS = {
  text: { type: 'text', default: 'Every frame is a *function* of time' },
  font: { type: 'font', default: 'Space Grotesk' },
  weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
  size: { type: 'number', default: 150, min: 12, max: 600, step: 1, description: 'Largest size in px; the text shrinks to fit its box' },
  color: { type: 'color', default: '#f4f1ea' },
  accent: { type: 'color', default: '#ffd166', description: 'Colour of *emphasized* words' },
  emFont: { type: 'font', default: 'Playfair Display', description: 'Typeface of *emphasized* words' },
  emItalic: { type: 'boolean', default: true },
  align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
  valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
  lineHeight: { type: 'number', default: 1.1, min: 0.8, max: 2, step: 0.01 },
  tracking: { type: 'number', default: 0, min: -0.1, max: 0.5, step: 0.005 },
  uppercase: { type: 'boolean', default: false },
};

asset({
  title: 'Word reveal',
  description: 'Per-word text reveal: each word comes in one after another (rising from behind a mask, rising with a fade, or popping), then the block fades out. *Asterisks* mark emphasized words, set in a second typeface and colour. For headlines and statements.',
  tags: ['text', 'text-animation', 'reveal', 'per-word', 'headline', 'mask'],
  duration: 4,
  uses: ['easing', 'text-block'],
  params: {
    ...TEXT_PARAMS,
    mode: { type: 'enum', options: ['mask', 'rise', 'pop'], default: 'mask', description: 'mask: slide up from behind the line · rise: travel and fade (the v1 look) · pop: scale in with overshoot' },
    stagger: { type: 'number', default: 0.08, min: 0, max: 1, step: 0.01, description: 'Seconds between words' },
    inDur: { type: 'number', default: 0.6, min: 0.05, max: 3, step: 0.01 },
    rise: { type: 'number', default: 70, min: 0, max: 400, step: 1, description: 'How far each word travels in "rise" mode, in px' },
    ease: { type: 'enum', options: ['outCubic', 'outExpo', 'outBack', 'outQuint', 'outElastic'], default: 'outExpo' },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const B = f.use('text-block');
    const { L, x, y } = B.layout(f, p);
    const exit = B.exit(f, p.outDur);
    for (const word of L.words) {
      const k = lib.stagger(f.t, word.index, p.stagger, p.inDur);
      if (k <= 0) continue;
      const e = E[p.ease](k);
      ctx.save();
      ctx.fillStyle = word.em ? p.accent : p.color;
      if (p.mode === 'mask') {
        ctx.globalAlpha = exit;
        ctx.beginPath();
        ctx.rect(x + word.x - L.size * 0.3, y + word.top - word.height * 0.06, word.width + L.size * 0.6, word.height * 1.16);
        ctx.clip();
        lib.text.fillWord(ctx, word, x, y + (1 - e) * word.height * 1.1 - (1 - exit) * 24);
      } else if (p.mode === 'pop') {
        const s = E.outBack(k);
        ctx.globalAlpha = lib.clamp01(k * 3) * exit;
        ctx.translate(x + word.x + word.width / 2, y + word.top + word.height / 2);
        ctx.scale(0.5 + 0.5 * s, 0.5 + 0.5 * s);
        lib.text.fillWord(ctx, word, -word.x - word.width / 2, -word.top - word.height / 2);
      } else {
        ctx.globalAlpha = lib.clamp01(k * 2.2) * exit;
        lib.text.fillWord(ctx, word, x, y + (1 - e) * p.rise - (1 - exit) * 24);
      }
      ctx.restore();
    }
  },
});
