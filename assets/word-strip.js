// The narration's words on a moving strip: each word sits at its own time, the strip scrolls with the clip,
// and the word being spoken is lit. Reads f.clip.words, so it follows any take of the narration.
asset({
  title: 'Word strip',
  description: 'The narration\'s words laid out on a strip at the moments they are spoken, scrolling with the clip, with the word being spoken lit and a tick under every word. Reads f.clip.words (it shows a placeholder without a narration). Takes a theme.',
  tags: ['narration', 'words', 'timeline', 'text', 'scene', 'diagram'],
  duration: 6,
  floor: 2.6,
  uses: ['easing'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 4, min: 2.6, max: 12, step: 0.1, description: 'Word size in % of the frame\'s short side' },
    seconds: { type: 'number', default: 5, min: 1, max: 20, step: 0.1, description: 'Seconds of speech across the strip' },
    label: { type: 'string', default: 'f.clip.words', description: 'A small label in the corner of the strip (empty: none)' },
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
    const words = f.clip?.words?.length ? f.clip.words : [{ text: 'no', start: 0.4, end: 0.8 }, { text: 'narration', start: 0.9, end: 1.6 }, { text: 'yet', start: 1.7, end: 2.1 }].map((w) => ({ ...w, start: w.start + t - 1, end: w.end + t - 1 }));
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const h = size * 3.2, y = (f.height - h) / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(k, out);
    ctx.fillStyle = th.surface;
    ctx.beginPath();
    ctx.roundRect(0, y, f.width, h, size * 0.4);
    ctx.fill();
    ctx.save();
    const pps = f.width / p.seconds, mid = f.width * 0.42, base = y + h * 0.5, edge = size * 0.5;
    // the playhead: where "now" is on the strip
    ctx.fillStyle = th.accent;
    ctx.fillRect(mid - 1.5, y + size * 0.35, 3, h - size * 0.7);
    for (const w of words) {
      const x = mid + (w.start - t) * pps;
      if (x > f.width || x < -size * 12) continue;
      const now = t >= w.start && t < w.end, said = t >= w.end;
      const L = lib.text.layout(ctx, w.text, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size });
      // only whole words on the strip, fading in and out at its ends (a word is never cut by the strip's edge)
      if (x < edge || x + L.width > f.width - edge) continue;
      ctx.globalAlpha = Math.min(k, out) * lib.clamp01(Math.min(x - edge, f.width - edge - x - L.width) / (size * 2));
      if (now) {
        ctx.fillStyle = th.accent;
        ctx.beginPath();
        ctx.roundRect(x - size * 0.2, base - size * 0.8, L.width + size * 0.4, size * 1.2, size * 0.25);
        ctx.fill();
      }
      ctx.fillStyle = now ? th.bg : said ? th.ink : th.muted;
      lib.text.fill(ctx, L, x, base - size * 0.8 + (size * 1.2 - L.height) / 2);
      // a tick at the word's start, its length the word's duration
      ctx.fillStyle = now ? th.accent : th.muted;
      ctx.fillRect(x, base + size * 0.65, Math.max(2, (w.end - w.start) * pps), Math.max(2, size * 0.08));
    }
    ctx.restore();
    if (p.label) {
      const lab = lib.text.layout(ctx, p.label, { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: Math.max((2.6 / 100) * short, size * 0.5) });
      ctx.fillStyle = th.accent;
      lib.text.fill(ctx, lab, size * 0.6, y - lab.height - size * 0.25);
    }
    ctx.restore();
  },
});
