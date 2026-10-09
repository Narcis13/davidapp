// The narration's words on a moving strip, in reading order: the strip scrolls so the word being spoken sits
// at the playhead, lit, with a bar under it filling for as long as the word lasts. Reads f.clip.words, so it
// follows any take of the narration.
asset({
  title: 'Word strip',
  description: 'The narration\'s words on a strip in reading order, scrolling with the speech so the word being spoken sits at the playhead, lit, with a bar under it that fills for as long as the word lasts. Reads f.clip.words (a placeholder without a narration). Takes a theme.',
  tags: ['narration', 'words', 'timeline', 'text', 'scene', 'diagram'],
  duration: 6,
  floor: 2.6,
  uses: ['easing'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 4, min: 2.6, max: 12, step: 0.1, description: 'Word size in % of the frame\'s short side' },
    label: { type: 'string', default: 'f.clip.words', description: 'A small label above the strip (empty: none)' },
    playhead: { type: 'number', default: 0.42, min: 0.1, max: 0.9, step: 0.01, description: 'Where the spoken word sits, as a share of the width' },
    inDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short;
    const t = f.clip?.t ?? f.t;
    const words = f.clip?.words?.length ? f.clip.words : ['no', 'narration', 'yet'].map((text, i) => ({ text, start: t - 1 + i * 0.6, end: t - 0.6 + i * 0.6 }));
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const h = size * 3.2, y = (f.height - h) / 2, gap = size * 0.55, edge = size * 0.5;
    const font = th.fonts?.headline ?? 'Space Grotesk';
    // the words in reading order, each at its place on the ribbon
    const L = words.map((w) => lib.text.layout(ctx, w.text, { font, weight: 700, size }));
    const xs = [];
    let acc = 0;
    for (const l of L) { xs.push(acc); acc += l.width + gap; }
    // where the ribbon is now: between the start of the word being spoken and the next one, in proportion to the time
    let i = 0;
    while (i < words.length - 1 && t >= words[i + 1].start) i++;
    const a = words[i], b = words[i + 1];
    const along = t < a.start ? 0 : b ? lib.clamp01((t - a.start) / Math.max(0.01, b.start - a.start)) : lib.clamp01((t - a.start) / Math.max(0.01, a.end - a.start));
    const pos = xs[i] + ((b ? xs[i + 1] : xs[i] + L[i].width) - xs[i]) * along;
    const shift = f.width * p.playhead - pos;
    ctx.save();
    ctx.globalAlpha = Math.min(k, out);
    ctx.fillStyle = th.surface;
    ctx.beginPath();
    ctx.roundRect(0, y, f.width, h, size * 0.4);
    ctx.fill();
    const base = y + h * 0.5;
    ctx.fillStyle = th.accent;
    ctx.fillRect(f.width * p.playhead - 1.5, y + size * 0.3, 3, h - size * 0.6);
    words.forEach((w, n) => {
      const x = xs[n] + shift;
      // only whole words on the strip, fading at its ends (a word is never cut by the strip's edge)
      if (x < edge || x + L[n].width > f.width - edge) return;
      const now = t >= w.start && t < w.end, said = t >= w.end;
      ctx.save();
      ctx.globalAlpha *= lib.clamp01(Math.min(x - edge, f.width - edge - x - L[n].width) / (size * 2));
      if (now) {
        ctx.fillStyle = th.accent;
        ctx.beginPath();
        ctx.roundRect(x - size * 0.2, base - size * 0.8, L[n].width + size * 0.4, size * 1.2, size * 0.25);
        ctx.fill();
      }
      ctx.fillStyle = now ? th.bg : said ? th.ink : th.muted;
      lib.text.fill(ctx, L[n], x, base - size * 0.8 + (size * 1.2 - L[n].height) / 2);
      // a bar under the word: full once said, filling while spoken
      const fill = said ? 1 : now ? (t - w.start) / Math.max(0.01, w.end - w.start) : 0;
      ctx.fillStyle = th.muted;
      ctx.fillRect(x, base + size * 0.65, L[n].width, Math.max(2, size * 0.06));
      if (fill > 0) { ctx.fillStyle = th.accent; ctx.fillRect(x, base + size * 0.65, L[n].width * fill, Math.max(2, size * 0.06)); }
      ctx.restore();
    });
    if (p.label) {
      const lab = lib.text.layout(ctx, p.label, { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: Math.max((2.6 / 100) * short, size * 0.5) });
      ctx.fillStyle = th.accent;
      lib.text.fill(ctx, lab, size * 0.6, y - lab.height - size * 0.25);
    }
    ctx.restore();
  },
});
