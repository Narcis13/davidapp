// Slide: in from one side of the frame (eased), out to the same side.
asset({
  kind: 'motion',
  title: 'Slide',
  description: 'Slides an item in from a side of the frame, settling with an ease-out, and slides it back out. Distance is a fraction of the frame.',
  tags: ['motion', 'slide', 'enter', 'exit'],
  duration: 0.7,
  uses: ['easing'],
  params: {
    from: { type: 'enum', options: ['left', 'right', 'up', 'down'], default: 'left' },
    distance: { type: 'number', default: 0.25, min: 0, max: 1.5 },
    fade: { type: 'boolean', default: true },
  },
  render(f, p) {
    const e = f.use('easing');
    const k = f.phase === 'out' ? e.inCubic(f.progress) : 1 - e.outCubic(f.progress);
    const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[p.from];
    return { x: dir[0] * k * p.distance * f.clip.width, y: dir[1] * k * p.distance * f.clip.height, opacity: p.fade ? 1 - k : 1 };
  },
});
