// Pop: in, the item grows from small with an overshoot and fades up; out, the reverse.
asset({
  kind: 'motion',
  title: 'Pop',
  description: 'Pops an item in from a small scale with a springy overshoot (and fades it), or pops it out. Use on titles, badges and stickers.',
  tags: ['motion', 'pop', 'enter', 'exit'],
  duration: 0.5,
  uses: ['easing'],
  params: { from: { type: 'number', default: 0.4, min: 0, max: 1, description: 'Scale it starts from' } },
  render(f, p) {
    const e = f.use('easing');
    const k = f.phase === 'out' ? 1 - f.progress : f.phase === 'in' ? f.progress : 1;
    if (f.phase === 'emphasis' || f.phase === 'loop') return { scale: 1 + 0.12 * Math.sin(Math.PI * f.progress) };
    return { scale: p.from + (1 - p.from) * e.outBack(k), opacity: Math.min(1, k * 2.5) };
  },
});
