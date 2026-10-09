// Captions from the narration's words: the clip's caption pages (f.clip.captions, built by the studio from
// the words by the caption rules) drawn in the caption lane, the word being spoken marked by brightness at
// its real time. Without caption pages it falls back to timed cues, as version 1 did. Place it full-frame
// on a track with role "captions" (so a clip can make its captions file only).
asset({
  title: 'Captions (word timed)',
  description: 'Captions from the narration: the clip\'s caption pages in the caption lane, each spoken word lit at its real time, never smaller than its size floor. Falls back to timed cues when the clip has no caption pages.',
  tags: ['text', 'text-animation', 'captions', 'subtitles', 'safe-zone', 'per-word', 'narration'],
  uses: ['easing'],
  params: {
    cues: {
      type: 'array', maxItems: 80,
      of: { type: 'object', fields: { start: { type: 'number', min: 0 }, end: { type: 'number', min: 0 }, text: { type: 'string' } } },
      default: [
        { start: 0.2, end: 2.4, text: 'Captions come from the words' },
        { start: 2.6, end: 4.8, text: 'and light up as they are spoken' },
      ],
      description: 'Only when the clip has no caption pages; seconds are relative to this item',
    },
    font: { type: 'font', default: 'Inter' },
    weight: { type: 'integer', default: 800, min: 100, max: 900, step: 100 },
    size: { type: 'number', default: 4.2, min: 1, max: 12, step: 0.1, description: 'Text size in % of the frame\'s short side' },
    floor: { type: 'number', default: 3, min: 1, max: 12, step: 0.1, description: 'Never smaller than this, in % of the frame\'s short side' },
    color: { type: 'color', default: '#f4f1ea' },
    active: { type: 'color', default: '#ffd166', description: 'Colour of the word being spoken' },
    dim: { type: 'number', default: 0.55, min: 0, max: 1, step: 0.01, description: 'Brightness of the words not yet spoken' },
    pill: { type: 'color', default: 'rgba(11,11,18,0.78)' },
    align: { type: 'enum', options: ['bottom', 'middle', 'top'], default: 'bottom', description: 'Where in the caption lane' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const t = f.clip.t;
    const pages = f.clip.captions;
    let page = null, lines = null, words = null, start = 0, end = 0;
    if (pages && pages.length) {
      page = pages.find((pg) => t >= pg.start && t < pg.end);
      if (!page) return;
      lines = page.lines.map((line) => line.map((w) => w.text).join(' '));
      words = page.lines.flat();
      start = page.start; end = page.end;
    } else {
      const cue = p.cues.find((c) => f.t >= c.start && f.t < c.end);
      if (!cue) return;
      lines = [cue.text];
      start = f.clip.t - (f.t - cue.start); end = start + (cue.end - cue.start);
    }
    // the lane (frame pixels) when the studio gives one, else the bottom of the safe zone
    const short = Math.min(f.clip.width ?? f.width, f.clip.height ?? f.height);
    const lane = f.clip.lane ?? { x: f.safe.x, y: f.safe.y + f.safe.height * 0.8, width: f.safe.width, height: f.safe.height * 0.2 };
    const size = (p.size / 100) * short;
    const padX = size * 0.55, padY = size * 0.32;
    const L = lib.text.layout(ctx, lines.join('\n'), {
      font: p.font, weight: p.weight, size, align: 'center', lineHeight: 1.22,
      maxWidth: lane.width - padX * 2, maxHeight: lane.height - padY * 2, maxLines: Math.max(1, lines.length), fit: true, floor: p.floor,
    });
    const w = L.width + padX * 2, h = L.height + padY * 2;
    const x = lane.x + (lane.width - w) / 2;
    const y = p.align === 'top' ? lane.y : p.align === 'middle' ? lane.y + (lane.height - h) / 2 : lane.y + lane.height - h;
    const local = t - start;
    const pop = E.outBack(lib.clamp01(local / 0.2));
    ctx.save();
    ctx.globalAlpha = lib.clamp01(local / 0.08) * lib.clamp01((end - t) / 0.1);
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(0.94 + 0.06 * pop, 0.94 + 0.06 * pop);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = p.pill;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.min(h / 2, size * 0.5));
    ctx.fill();
    const tx = padX - (L.boxWidth - L.width) / 2, ty = padY;
    for (const word of L.words) {
      const spoken = words ? words[word.index] : null;
      // the spoken word is lit at its own time; words already said stay bright, words still to come are dim
      const state = !spoken ? 'said' : t >= spoken.end ? 'said' : t >= spoken.start ? 'now' : 'next';
      ctx.fillStyle = state === 'now' ? p.active : state === 'said' ? p.color : lib.color.alpha(p.color, p.dim);
      lib.text.fillWord(ctx, word, tx, ty);
    }
    ctx.restore();
  },
});
