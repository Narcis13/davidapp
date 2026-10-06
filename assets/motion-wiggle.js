// Wiggle: a quick attention shake that dies away (emphasis), or keeps going (loop).
asset({
  kind: 'motion',
  title: 'Wiggle',
  description: 'A quick rotational shake for emphasis that settles back to rest; as a loop it keeps a gentle wiggle going.',
  tags: ['motion', 'emphasis', 'wiggle', 'loop'],
  duration: 0.6,
  params: { angle: { type: 'number', default: 8, min: 0, max: 45 }, speed: { type: 'number', default: 3, min: 0.5, max: 12 } },
  render(f, p) {
    const decay = f.phase === 'loop' ? 0.4 : 1 - f.progress;
    return { rotation: Math.sin(f.t * p.speed * Math.PI * 2) * p.angle * decay, scale: 1 + 0.04 * decay * Math.abs(Math.sin(f.t * p.speed * Math.PI)) };
  },
});
