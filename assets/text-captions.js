// Captions: timed cues in a pill, word by word, kept inside the safe zone. The cues are also what
// the studio exports as an .srt file next to the MP4.
asset({
  title: 'Captions',
  description: 'Subtitles from timed cues, shown in a rounded pill inside the safe zone (bottom, middle or top). The current word is highlighted karaoke-style. Cues are exported to SRT with the render.',
  tags: ['text', 'text-animation', 'captions', 'subtitles', 'safe-zone', 'per-word'],
  uses: ['easing'],
  params: {
    cues: {
      type: 'array', maxItems: 80,
      of: { type: 'object', fields: { start: { type: 'number', min: 0 }, end: { type: 'number', min: 0 }, text: { type: 'string' } } },
      default: [
        { start: 0.2, end: 2.4, text: 'Captions stay inside the safe zone' },
        { start: 2.6, end: 4.8, text: 'and light up word by word' },
      ],
      description: 'Seconds are relative to this item',
    },
    position: { type: 'enum', options: ['bottom', 'middle', 'top'], default: 'bottom' },
    font: { type: 'font', default: 'Inter' },
    weight: { type: 'integer', default: 800, min: 100, max: 900, step: 100 },
    size: { type: 'number', default: 56, min: 16, max: 200, step: 1 },
    color: { type: 'color', default: '#f4f1ea' },
    active: { type: 'color', default: '#ffd166', description: 'Colour of the word being spoken' },
    pill: { type: 'color', default: 'rgba(11,11,18,0.78)' },
    maxLines: { type: 'integer', default: 2, min: 1, max: 4 },
    widthFraction: { type: 'number', default: 0.92, min: 0.3, max: 1, step: 0.01 },
    karaoke: { type: 'boolean', default: true },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const cue = p.cues.find((c) => f.t >= c.start && f.t < c.end);
    if (!cue) return;
    const safe = f.safe;
    const padX = p.size * 0.55, padY = p.size * 0.32;
    const maxW = safe.width * p.widthFraction - padX * 2;
    const L = lib.text.layout(ctx, cue.text, { font: p.font, weight: p.weight, size: p.size, maxWidth: maxW, maxHeight: p.size * 1.25 * p.maxLines, maxLines: p.maxLines, fit: true, minSize: 20, align: 'center', lineHeight: 1.25 });
    const w = L.width + padX * 2, h = L.height + padY * 2;
    const x = safe.x + (safe.width - w) / 2;
    const y = p.position === 'top' ? safe.y : p.position === 'middle' ? safe.y + (safe.height - h) / 2 : safe.y + safe.height - h;
    const local = f.t - cue.start, len = cue.end - cue.start;
    const pop = E.outBack(lib.clamp01(local / 0.22));
    const out = lib.clamp01((cue.end - f.t) / 0.12);
    ctx.save();
    ctx.globalAlpha = lib.clamp01(local / 0.1) * out;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = p.pill;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.min(h / 2, p.size * 0.5));
    ctx.fill();
    // the box of the text block is maxW wide and centred; shift so its lines centre in the pill
    const tx = padX - (maxW - L.width) / 2, ty = padY;
    const spoken = p.karaoke ? Math.min(L.words.length - 1, Math.floor((local / Math.max(0.01, len * 0.92)) * L.words.length)) : -1;
    for (const word of L.words) {
      ctx.fillStyle = word.index === spoken ? p.active : word.index < spoken || !p.karaoke ? p.color : lib.color.alpha(p.color, 0.55);
      lib.text.fillWord(ctx, word, tx, ty);
    }
    ctx.restore();
  },
});
