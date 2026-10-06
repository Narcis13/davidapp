// Grain: film grain that moves every frame (seeded: every render is the same).
asset({
  kind: 'effect',
  title: 'Film grain',
  description: 'Fine film grain that changes every frame, seeded so every render is identical. Use clip-wide at a low amount for texture.',
  tags: ['effect', 'grain', 'film', 'texture'],
  params: { amount: { type: 'number', default: 0.07, min: 0, max: 1 }, size: { type: 'integer', default: 1, min: 1, max: 4 } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.grain(img, { amount: p.amount, seed: f.seed * 31 + f.frame, size: p.size });
    f.lib.fx.write(f.ctx, img);
  },
});
