// Kick drum: a sine whose pitch drops fast, plus a click.
asset({
  kind: 'audio',
  title: 'Kick drum',
  description: 'Synthesized kick drum one-shot: a sine with a fast downward pitch sweep and a short click on top. The low thump the beat detector locks onto.',
  tags: ['audio', 'drums', 'kick', 'one-shot', 'synth'],
  duration: 0.45,
  params: {
    pitch: { type: 'number', default: 48, min: 20, max: 200, step: 1, description: 'Resting pitch in Hz' },
    punch: { type: 'number', default: 150, min: 0, max: 600, step: 1, description: 'How far above the resting pitch the sweep starts, in Hz' },
    decay: { type: 'number', default: 0.16, min: 0.02, max: 1, step: 0.01 },
    click: { type: 'number', default: 0.25, min: 0, max: 1, step: 0.01 },
    gain: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const A = f.lib.audio;
    const out = A.tone({ freq: (t) => p.pitch + p.punch * Math.exp(-t * 38), dur: f.duration, decay: p.decay, attack: 0.002, gain: p.gain });
    if (p.click > 0) A.mix(out, A.highpass(A.noiseBurst({ rng: f.rng, dur: 0.02, decay: 0.004, gain: p.click }), 1800));
    return A.fade(A.softclip(out, 1.4), 0.001, 0.02);
  },
});
