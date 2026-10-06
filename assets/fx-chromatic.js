// Chromatic aberration: red and blue pulled apart towards the edges, optionally on the beat.
asset({
  kind: 'effect',
  title: 'Chromatic aberration',
  description: 'Pulls the red and blue channels apart towards the edges of the frame, like a cheap lens; can kick on the beat. Good for glitchy, energetic moments.',
  tags: ['effect', 'chromatic', 'glitch', 'lens'],
  params: { amount: { type: 'number', default: 0.5, min: 0, max: 4, description: '% of the short side' }, beatKick: { type: 'number', default: 1, min: 0, max: 4 } },
  render(f, p) {
    const kick = p.beatKick ? f.lib.beat.pulse(f.clip.t, f.clip.beats, 0.25) * p.beatKick : 0;
    const img = f.lib.fx.read(f.source);
    f.lib.fx.chromatic(img, { amount: (p.amount + kick) * f.vmin, angle: 0, radial: true });
    f.lib.fx.write(f.ctx, img);
  },
});
