// Glow: bright parts bloom softly.
asset({
  kind: 'effect',
  title: 'Glow',
  description: 'A soft bloom around the bright parts of a layer, optionally tinted. Good on titles, neon lines and 3D highlights.',
  tags: ['effect', 'glow', 'bloom', 'neon'],
  params: { radius: { type: 'number', default: 2.2, min: 0, max: 10, description: 'Blur radius in % of the short side' }, strength: { type: 'number', default: 0.9, min: 0, max: 2 }, threshold: { type: 'number', default: 0.5, min: 0, max: 1 }, tint: { type: 'color', default: 'transparent' } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.glow(img, { radius: p.radius * f.vmin, strength: p.strength, threshold: p.threshold, color: p.tint === 'transparent' ? null : p.tint });
    f.lib.fx.write(f.ctx, img);
  },
});
