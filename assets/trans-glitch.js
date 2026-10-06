// Glitch: horizontal slices jump and split before the next layer locks in.
asset({
  kind: 'transition',
  title: 'Glitch cut',
  description: 'A glitchy cut: horizontal slices of both layers jump sideways with a colour split, seeded so it is the same every render, then the next layer locks in.',
  tags: ['transition', 'glitch', 'cut'],
  duration: 0.5,
  params: { slices: { type: 'integer', default: 14, min: 2, max: 60 }, shift: { type: 'number', default: 0.08, min: 0, max: 0.5 } },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const step = Math.floor(f.progress * 6);
    const r = f.rng.fork(`step-${step}`);
    const sh = h / p.slices;
    for (let i = 0; i < p.slices; i++) {
      const src = r() < f.progress ? f.to : f.from ?? f.to;
      const dx = (r() - 0.5) * 2 * p.shift * w * Math.sin(Math.PI * f.progress);
      ctx.drawImage(src.canvas, 0, i * sh, w, sh, dx, i * sh, w, sh);
      if (r() < 0.3) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; ctx.drawImage(src.canvas, 0, i * sh, w, sh, dx + w * 0.01, i * sh, w, sh); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    }
  },
});
