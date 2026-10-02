// Lower third: an accent bar grows, a title rises behind a mask, a subtitle types itself.
asset({
  title: 'Lower third',
  description: 'A lower-third caption block: an accent bar grows, the title is revealed line by line behind a mask, and a subtitle types out underneath. Sits in a corner of the safe zone; takes a theme. For names, sources and chapter labels.',
  tags: ['lower-third', 'caption', 'label', 'scene', 'overlay'],
  duration: 5,
  uses: ['text-line-reveal', 'text-typewriter', 'easing'],
  params: {
    title: { type: 'string', default: 'Lower third' },
    subtitle: { type: 'string', default: 'title by line, subtitle typed' },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    corner: { type: 'enum', options: ['bottom-left', 'bottom-right', 'top-left', 'top-right'], default: 'bottom-left' },
    scale: { type: 'number', default: 1, min: 0.4, max: 3, step: 0.01 },
    plate: { type: 'boolean', default: true, description: 'Draw a dark plate behind the text' },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const safe = f.safe;
    const u = Math.min(f.width, f.height) / 1080 * p.scale;
    const titleSize = 54 * u, subSize = 34 * u;
    const w = Math.min(safe.width, 880 * u), h = titleSize * 1.25 + subSize * 1.7;
    const right = p.corner.endsWith('right'), top = p.corner.startsWith('top');
    const x = right ? safe.x + safe.width - w : safe.x;
    const y = top ? safe.y : safe.y + safe.height - h;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const grow = E.outExpo(lib.clamp01(f.t / 0.5));
    const barW = 8 * u, pad = 22 * u;
    ctx.save();
    ctx.globalAlpha = exit;
    if (p.plate) {
      ctx.fillStyle = lib.color.alpha(th.bg, 0.72);
      ctx.beginPath();
      ctx.roundRect(x, y - pad * 0.5, (w + pad) * grow, h + pad, 14 * u);
      ctx.fill();
    }
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.roundRect(right ? x + w - barW : x, y + h * (1 - grow) * 0.5, barW, h * grow, barW / 2);
    ctx.fill();
    ctx.restore();
    const tx = right ? x : x + barW + pad, tw = w - barW - pad;
    const align = right ? 'right' : 'left';
    f.use('text-line-reveal', { text: p.title, font: th.fonts.headline, weight: 700, size: titleSize, color: th.ink, accent: th.accent, emFont: th.fonts.serif, align, valign: 'top', lineHeight: 1.2, outDur: p.outDur },
      { x: tx, y, width: tw, height: titleSize * 1.25, at: 0.15 });
    f.use('text-typewriter', { text: p.subtitle, font: th.fonts.mono, weight: 400, size: subSize, color: th.muted, accent: th.accent, cursor: 'underscore', cursorColor: th.accent, cps: 30, delay: 0, align, valign: 'top', lineHeight: 1.3, outDur: p.outDur },
      { x: tx, y: y + titleSize * 1.3, width: tw, height: subSize * 1.5, at: 0.6 });
  },
});
