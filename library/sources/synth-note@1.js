// One synth note. The same asset plays bass, plucks and pads depending on its parameters.
asset({
  kind: 'audio',
  title: 'Synth note',
  description: 'A single synthesized note (MIDI pitch): two detuned oscillators through a low-pass filter with an attack/decay envelope. Short decay and a bright filter make a pluck; a low note with a dark filter makes a bass; a long attack makes a pad.',
  tags: ['audio', 'synth', 'note', 'bass', 'pluck', 'pad'],
  duration: 0.5,
  params: {
    note: { type: 'number', default: 57, min: 12, max: 108, step: 1, description: 'MIDI note (57 = A3)' },
    wave: { type: 'enum', options: ['saw', 'square', 'triangle', 'sine'], default: 'saw' },
    detune: { type: 'number', default: 0.006, min: 0, max: 0.05, step: 0.001, description: 'Second oscillator offset, as a ratio' },
    cutoff: { type: 'number', default: 2400, min: 80, max: 12000, step: 10, description: 'Low-pass cutoff in Hz' },
    attack: { type: 'number', default: 0.004, min: 0.001, max: 2, step: 0.001 },
    decay: { type: 'number', default: 0.18, min: 0.01, max: 4, step: 0.01, description: 'Time constant of the fall, in seconds' },
    gain: { type: 'number', default: 0.4, min: 0, max: 1, step: 0.01 },
  },
  render(f, p) {
    const A = f.lib.audio;
    const hz = A.midi(p.note);
    const out = A.tone({ freq: hz, dur: f.duration, wave: p.wave, decay: p.decay, attack: p.attack, gain: p.gain * 0.6 });
    if (p.detune > 0) A.mix(out, A.tone({ freq: hz * (1 + p.detune), dur: f.duration, wave: p.wave, decay: p.decay, attack: p.attack, gain: p.gain * 0.4 }));
    return A.fade(A.lowpass(A.lowpass(out, p.cutoff), p.cutoff), 0.001, Math.min(0.03, f.duration / 4));
  },
});
