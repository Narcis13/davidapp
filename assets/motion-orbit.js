// Orbit: circles round its rest position (loop), like a satellite.
asset({
  kind: 'motion',
  title: 'Orbit',
  description: 'Circles an item around its rest position on a tilted ellipse for as long as it is on screen, with a slight scale change for depth. Use phase loop.',
  tags: ['motion', 'loop', 'orbit'],
  params: { radius: { type: 'number', default: 0.06, min: 0, max: 0.5 }, period: { type: 'number', default: 5, min: 0.5, max: 30 }, depth: { type: 'number', default: 0.08, min: 0, max: 0.5 } },
  render(f, p) {
    const a = (f.t / p.period) * Math.PI * 2, r = p.radius * Math.min(f.clip.width, f.clip.height);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.45, scale: 1 + Math.sin(a) * p.depth };
  },
});
