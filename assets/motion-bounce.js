// Bounce: drops in from above and bounces to rest (in), or a single hop (emphasis).
asset({
  kind: 'motion',
  title: 'Bounce',
  description: 'Drops an item in from above and bounces it to rest (in), hops it once for emphasis, or lifts it away (out).',
  tags: ['motion', 'bounce', 'enter', 'emphasis'],
  duration: 0.8,
  uses: ['easing'],
  params: { height: { type: 'number', default: 0.3, min: 0, max: 1.5 } },
  render(f, p) {
    const e = f.use('easing');
    if (f.phase === 'emphasis' || f.phase === 'loop') return { y: -Math.sin(Math.PI * f.progress) * p.height * 0.4 * f.clip.height };
    const k = f.phase === 'out' ? e.inCubic(f.progress) : 1 - e.outBounce(f.progress);
    return { y: -k * p.height * f.clip.height, opacity: f.phase === 'out' ? 1 - f.progress : 1 };
  },
});
