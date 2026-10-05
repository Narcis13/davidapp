// A template: a kicker, a title and up to five bullets. The copy is the only thing you fill in.
asset({
  title: 'Bullet list template',
  description: 'Template scene with content slots: a kicker badge, a title and up to five numbered bullets that arrive one after another. Fill in the copy and pick a theme; the layout adapts to vertical, horizontal and square frames.',
  tags: ['template', 'scene', 'bullets', 'list', 'content-slots'],
  duration: 8,
  uses: ['badge-pill', 'text-line-reveal', 'text-word-reveal'],
  params: {
    kicker: { type: 'string', default: 'RELEASE NOTES' },
    title: { type: 'string', default: 'Three ideas, *one studio*' },
    bullets: { type: 'array', of: { type: 'string' }, minItems: 1, maxItems: 5, default: ['Assets are *functions* with parameters', 'Clips *pin* the versions they use', 'An AI edits both through *MCP*'] },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    stagger: { type: 'number', default: 1.1, min: 0.1, max: 5, step: 0.05, description: 'Seconds between bullets' },
    firstAt: { type: 'number', default: 1.2, min: 0, max: 10, step: 0.05, description: 'When the first bullet arrives' },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const th = f.use(p.theme);
    const safe = f.safe;
    const kickerH = Math.min(safe.height * 0.07, 64);
    const titleH = safe.height * 0.24;
    const accents = [th.accent, th.accent2, th.accent3];
    if (p.kicker) f.use('badge-pill', { text: p.kicker, fill: th.accent, color: th.bg, outDur: p.outDur }, { x: safe.x, y: safe.y, width: safe.width, height: kickerH });
    const ty = safe.y + (p.kicker ? kickerH * 1.4 : 0);
    f.use('text-line-reveal', { text: p.title, font: th.fonts.headline, weight: 700, size: titleH * 0.46, color: th.ink, accent: th.accent, emFont: th.fonts.serif, align: 'left', valign: 'top', lineHeight: 1.08, outDur: p.outDur },
      { x: safe.x, y: ty, width: safe.width, height: titleH, at: 0.2 });
    const top = ty + titleH * 1.05;
    const n = p.bullets.length;
    const rowH = Math.min((safe.y + safe.height - top) / n, safe.height * 0.19);
    const num = rowH * 0.5;
    p.bullets.forEach((text, i) => {
      const at = p.firstAt + i * p.stagger;
      const y = top + i * rowH;
      f.use('badge-pill', { text: String(i + 1), fill: accents[i % 3], color: th.bg, align: 'center', outDur: p.outDur }, { x: safe.x, y: y + (rowH - num) / 2, width: num, height: num, at, key: `n${i}` });
      f.use('text-word-reveal', { text, font: th.fonts.body, weight: 600, size: rowH * 0.36, color: th.ink, accent: accents[i % 3], emFont: th.fonts.serif, align: 'left', lineHeight: 1.15, stagger: 0.05, outDur: p.outDur },
        { x: safe.x + num * 1.5, y, width: safe.width - num * 1.5, height: rowH, at: at + 0.12, key: `t${i}` });
    });
  },
});
