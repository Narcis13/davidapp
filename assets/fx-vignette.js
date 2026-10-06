// Vignette: edges fall off to a colour.
asset({
  kind: 'effect',
  title: 'Vignette',
  description: 'Darkens (or tints) the edges of a layer or the frame, drawing the eye to the middle.',
  tags: ['effect', 'vignette', 'look'],
  params: { amount: { type: 'number', default: 0.55, min: 0, max: 1 }, radius: { type: 'number', default: 0.5, min: 0, max: 1 }, softness: { type: 'number', default: 0.5, min: 0.05, max: 1 }, color: { type: 'color', default: '#05050c' } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.vignette(img, { amount: p.amount, radius: p.radius, softness: p.softness, color: p.color });
    f.lib.fx.write(f.ctx, img);
  },
});
