// Story-style progress: one segment per chapter, filling as the clip plays.
asset({
  title: 'Progress segments',
  description: 'A segmented progress bar like the one on stories: one segment per chapter, each filling as its part of the clip plays. Give the chapter start times in seconds; sits at the top or bottom of the safe zone.',
  tags: ['progress', 'chapters', 'ui', 'overlay'],
  params: {
    starts: { type: 'array', of: { type: 'number', min: 0 }, default: [0, 1, 2, 3], minItems: 1, maxItems: 24, description: 'Start time of each chapter, in seconds from the start of this item' },
    position: { type: 'enum', options: ['top', 'bottom'], default: 'top' },
    color: { type: 'color', default: '#f4f1ea' },
    track: { type: 'color', default: 'rgba(244,241,234,0.22)' },
    thickness: { type: 'number', default: 8, min: 2, max: 40, step: 1 },
    gap: { type: 'number', default: 10, min: 0, max: 60, step: 1 },
    inset: { type: 'number', default: 0, min: -200, max: 400, step: 1, description: 'Distance from the safe-zone edge, in px' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const box = f.safe;
    const starts = [...p.starts].sort((a, b) => a - b);
    const n = starts.length;
    const w = (box.width - p.gap * (n - 1)) / n;
    const y = p.position === 'top' ? box.y + p.inset : box.y + box.height - p.thickness - p.inset;
    ctx.globalAlpha = lib.envelope(f.t, f.duration, 0.4, 0.4);
    for (let i = 0; i < n; i++) {
      const end = starts[i + 1] ?? f.duration;
      const k = lib.clamp01((f.t - starts[i]) / Math.max(0.001, end - starts[i]));
      const x = box.x + i * (w + p.gap);
      ctx.fillStyle = p.track;
      ctx.beginPath(); ctx.roundRect(x, y, w, p.thickness, p.thickness / 2); ctx.fill();
      if (k > 0) {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.roundRect(x, y, Math.max(p.thickness, w * k), p.thickness, p.thickness / 2); ctx.fill();
      }
    }
  },
});
