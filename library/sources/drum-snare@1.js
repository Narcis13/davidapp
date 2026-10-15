// Snare / clap: filtered noise over a short tone.
asset({
  kind: 'audio',
  title: 'Snare drum',
  description: 'Synthesized snare one-shot: a burst of band-limited noise over a short pitched body. Lower the tone and lengthen the decay for a clap-like hit.',
  tags: ['audio', 'drums', 'snare', 'one-shot', 'synth'],
  duration: 0.3,
  params: {
    tone: { type: 'number', default: 190, min: 80, max: 400, step: 1 },
    decay: { type: 'number', default: 0.09, min: 0.02, max: 0.6, step: 0.01 },
    snap: { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, description: 'Amount of noise' },
    gain: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const A = f.lib.audio;
    const out = A.tone({ freq: (t) => p.tone * (1 + 0.5 * Math.exp(-t * 60)), dur: f.duration, decay: p.decay * 0.6, wave: 'triangle', gain: p.gain * 0.6 });
    const noise = A.lowpass(A.highpass(A.noiseBurst({ rng: f.rng, dur: f.duration, decay: p.decay, gain: p.gain * p.snap }), 1200), 9000);
    return A.fade(A.mix(out, noise), 0.001, 0.02);
  },
});
