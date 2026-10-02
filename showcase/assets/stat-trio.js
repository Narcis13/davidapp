// Three numbers under a heading: a row in wide frames, a column in tall ones.
asset({
  title: 'Stat trio',
  description: 'A heading with up to three animated counters, each with a label. Lays out as a row in horizontal frames and a column in vertical ones. A template: the heading and the stats are content slots.',
  tags: ['stats', 'data', 'scene', 'template', 'counter'],
  duration: 6,
  uses: ['text-counter', 'text-line-reveal'],
  params: {
    heading: { type: 'string', default: 'One clip, by the numbers' },
    stats: {
      type: 'array', minItems: 1, maxItems: 3,
      of: { type: 'object', fields: { value: { type: 'number' }, label: { type: 'string' }, prefix: { type: 'string' }, suffix: { type: 'string' }, decimals: { type: 'integer', min: 0, max: 3 } } },
      default: [{ value: 960, label: 'frames rendered' }, { value: 0, label: 'keyframes set by hand' }, { value: 1, label: 'function per asset' }],
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    stagger: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { lib } = f;
    const th = f.use(p.theme);
    const safe = f.safe;
    const wide = safe.width > safe.height * 1.1;
    const headH = safe.height * (wide ? 0.2 : 0.12);
    f.use('text-line-reveal', { text: p.heading, font: th.fonts.headline, weight: 700, size: headH * 0.62, color: th.ink, accent: th.accent2, emFont: th.fonts.serif, valign: 'middle', outDur: p.outDur },
      { x: safe.x, y: safe.y, width: safe.width, height: headH });
    const n = p.stats.length;
    const area = { x: safe.x, y: safe.y + headH * 1.15, width: safe.width, height: safe.height - headH * 1.15 };
    const accents = [th.accent, th.accent2, th.accent3];
    p.stats.forEach((s, i) => {
      const cell = wide
        ? { x: area.x + (area.width / n) * i, y: area.y, width: area.width / n, height: area.height * 0.8 }
        : { x: area.x, y: area.y + (area.height / n) * i, width: area.width, height: area.height / n };
      const pad = Math.min(cell.width, cell.height) * 0.1;
      f.use('text-counter', { to: s.value, label: s.label, prefix: s.prefix, suffix: s.suffix, decimals: s.decimals, font: th.fonts.headline, size: 320, color: accents[i % 3], accent: th.ink, labelColor: lib.color.alpha(th.ink, 0.78), countDur: 1.3, outDur: p.outDur },
        { x: cell.x + pad, y: cell.y + pad, width: cell.width - pad * 2, height: cell.height - pad * 2, at: 0.5 + i * p.stagger, key: i });
    });
  },
});
