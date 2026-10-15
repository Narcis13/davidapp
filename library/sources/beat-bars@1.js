// An equalizer strip that jumps on the beats found in the clip's audio.
asset({
  title: 'Beat bars',
  description: 'A row of rounded bars that jump on every beat detected in the clip\'s audio and decay in between, with seeded variation per bar. Falls back to a steady tempo when the clip has no beats. A music-reactive accent for any scene.',
  tags: ['beat', 'audio-reactive', 'equalizer', 'accent', 'loop'],
  uses: ['easing'],
  params: {
    bars: { type: 'integer', default: 24, min: 3, max: 96 },
    color: { type: 'color', default: '#ffd166' },
    color2: { type: 'color', default: '#ff5c8a', description: 'Colour at the ends of the row' },
    height: { type: 'number', default: 0.12, min: 0.01, max: 1, step: 0.01, description: 'Tallest bar as a fraction of the box height' },
    position: { type: 'enum', options: ['bottom', 'middle', 'top'], default: 'bottom' },
    gap: { type: 'number', default: 0.45, min: 0, max: 0.9, step: 0.01 },
    decay: { type: 'number', default: 0.22, min: 0.03, max: 2, step: 0.01 },
    fallbackBpm: { type: 'number', default: 120, min: 30, max: 300, step: 1 },
    mirror: { type: 'boolean', default: true, description: 'Grow up and down from the baseline' },
    inDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const box = f.safe;
    let beats = f.clip.beats;
    if (!beats.length) {
      const step = 60 / p.fallbackBpm;
      beats = Array.from({ length: Math.ceil(f.clip.duration / step) + 1 }, (_, i) => i * step);
    }
    const b = lib.beat.at(f.clip.t, beats);
    const pulse = b ? Math.exp(-b.since / p.decay) : 0;
    const n = lib.noise(f.seed);
    const env = E.outCubic(lib.envelope(f.t, f.duration, p.inDur, p.outDur));
    const slot = box.width / p.bars, bw = slot * (1 - p.gap);
    const maxH = box.height * p.height;
    const base = p.position === 'top' ? box.y + maxH / 2 : p.position === 'middle' ? box.y + box.height / 2 : box.y + box.height - maxH / 2;
    for (let i = 0; i < p.bars; i++) {
      // each beat hits a different set of bars hardest
      const hit = 0.35 + 0.65 * (0.5 + 0.5 * n(i * 0.9, (b?.index ?? 0) * 1.7));
      const idle = 0.08 + 0.06 * (0.5 + 0.5 * n(i * 1.3, f.clip.t * 1.5));
      const h = Math.max(bw, maxH * (idle + pulse * hit) * env);
      const u = Math.abs(i / (p.bars - 1) - 0.5) * 2;
      ctx.fillStyle = lib.color.mix(p.color, p.color2, u);
      ctx.beginPath();
      ctx.roundRect(box.x + i * slot + (slot - bw) / 2, p.mirror ? base - h / 2 : base + maxH / 2 - h, bw, h, bw / 2);
      ctx.fill();
    }
  },
});
