// An editor window that types its code: window chrome around a typewriter.
asset({
  title: 'Code window',
  description: 'A code editor window (title bar, traffic lights, file name) that scales in and types its code with the typewriter asset. Takes a theme. For showing a snippet being written.',
  tags: ['code', 'window', 'editor', 'scene', 'typewriter'],
  duration: 6,
  uses: ['text-typewriter', 'easing', 'spring'],
  params: {
    code: { type: 'text', default: 'asset({\n  render(f, p) {\n    *draw*(f.t, p)\n  }\n})' },
    filename: { type: 'string', default: 'word-reveal.js' },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    cps: { type: 'number', default: 20, min: 1, max: 120, step: 1 },
    fontSize: { type: 'number', default: 60, min: 12, max: 200, step: 1 },
    widthFraction: { type: 'number', default: 1, min: 0.3, max: 1, step: 0.01, description: 'Window width as a fraction of the safe zone' },
    heightFraction: { type: 'number', default: 0.5, min: 0.1, max: 1, step: 0.01 },
    valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const spring = f.use('spring', { stiffness: 190, damping: 17 });
    const safe = f.safe;
    const w = safe.width * p.widthFraction, h = safe.height * p.heightFraction;
    const x = safe.x + (safe.width - w) / 2;
    const y = p.valign === 'top' ? safe.y : p.valign === 'bottom' ? safe.y + safe.height - h : safe.y + (safe.height - h) / 2;
    const k = spring(f.t);
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const bar = Math.max(64, Math.min(w, h) * 0.13), r = bar * 0.34;
    ctx.save();
    ctx.globalAlpha = lib.clamp01(f.t / 0.2) * E.outCubic(exit);
    ctx.translate(x + w / 2, y + h / 2 + (1 - exit) * 60);
    ctx.scale(0.86 + 0.14 * k, 0.86 + 0.14 * k);
    ctx.translate(-w / 2, -h / 2);
    // body, with a soft shadow
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 30;
    ctx.fillStyle = th.surface;
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = lib.color.alpha(th.ink, 0.12); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(1, 1, w - 2, h - 2, r); ctx.stroke();
    // title bar
    ctx.fillStyle = lib.color.alpha(th.ink, 0.06);
    ctx.beginPath(); ctx.roundRect(0, 0, w, bar, [r, r, 0, 0]); ctx.fill();
    [th.accent2, th.accent, th.accent3].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(bar * 0.55 + i * bar * 0.42, bar / 2, bar * 0.13, 0, Math.PI * 2); ctx.fill();
    });
    const T = lib.text.layout(ctx, p.filename, { font: th.fonts.mono, weight: 400, size: bar * 0.42, wrap: 'none' });
    ctx.fillStyle = th.muted;
    lib.text.fill(ctx, T, (w - T.width) / 2, (bar - T.height) / 2);
    ctx.restore();
    // the code types inside the window (the child gets its own box, so it fits itself to it)
    const pad = Math.max(28, w * 0.06);
    f.use('text-typewriter', { text: p.code, font: th.fonts.mono, size: p.fontSize, color: th.ink, accent: th.accent3, cursorColor: th.accent, cps: p.cps, delay: 0.5, valign: 'top', outDur: p.outDur },
      { x: x + pad, y: y + bar + pad * 0.8 + (1 - exit) * 60, width: w - pad * 2, height: h - bar - pad * 1.6, alpha: lib.clamp01((f.t - 0.15) / 0.2) });
  },
});
