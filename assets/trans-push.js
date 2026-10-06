// Push: the next layer pushes the previous one out of the frame.
asset({
  kind: 'transition',
  title: 'Push',
  description: 'The next layer slides in and pushes the previous one out of the frame, with an ease in and out.',
  tags: ['transition', 'push', 'slide'],
  duration: 0.7,
  uses: ['easing'],
  params: { direction: { type: 'enum', options: ['left', 'right', 'up', 'down'], default: 'left' } },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const k = f.use('easing').inOutCubic(f.progress);
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[p.direction];
    if (f.from) ctx.drawImage(f.from.canvas, dx * w * k, dy * h * k);
    ctx.drawImage(f.to.canvas, -dx * w * (1 - k), -dy * h * (1 - k));
  },
});
