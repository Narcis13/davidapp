// Drift: a slow floating loop, for things that should feel alive while they sit on screen.
asset({
  kind: 'motion',
  title: 'Drift',
  description: 'A slow floating loop: the item drifts on a small figure-eight and tilts a little. Use phase loop on logos, stickers and 3D pieces.',
  tags: ['motion', 'loop', 'drift', 'float'],
  params: {
    amount: { type: 'number', default: 0.012, min: 0, max: 0.1, description: 'Drift as a fraction of the frame' },
    tilt: { type: 'number', default: 2, min: 0, max: 20 },
    period: { type: 'number', default: 4, min: 0.5, max: 20 },
  },
  render(f, p) {
    const a = (f.t / p.period) * Math.PI * 2, m = Math.min(f.clip.width, f.clip.height) * p.amount;
    return { x: Math.sin(a) * m, y: Math.sin(a * 2) * m * 0.6, rotation: Math.sin(a + 1) * p.tilt };
  },
});
