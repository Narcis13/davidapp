// Hi-hat: bright noise with a very short decay (closed) or a longer one (open).
asset({
  kind: 'audio',
  title: 'Hi-hat',
  description: 'Synthesized hi-hat one-shot: high-passed noise with a short decay; set `open` for the longer, washier version.',
  tags: ['audio', 'drums', 'hat', 'one-shot', 'synth'],
  duration: 0.25,
  params: {
    open: { type: 'boolean', default: false },
    brightness: { type: 'number', default: 7000, min: 2000, max: 12000, step: 100, description: 'High-pass cutoff in Hz' },
    gain: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const A = f.lib.audio;
    const out = A.noiseBurst({ rng: f.rng, dur: f.duration, decay: p.open ? 0.09 : 0.022, gain: p.gain });
    return A.fade(A.highpass(A.highpass(out, p.brightness), p.brightness), 0.0005, 0.02);
  },
});
