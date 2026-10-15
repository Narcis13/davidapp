// A whole backing track, sequenced from the drum and synth assets: four-on-the-floor kick, snare
// on two and four, hats, a bass line that follows a four-bar chord loop, and a seeded arpeggio.
// The arrangement builds: parts enter one by one and drop out before the end.
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
const PROGRESSIONS = { minor: [0, 5, 2, 6], major: [0, 4, 5, 3], dorian: [0, 3, 6, 4] };

asset({
  kind: 'audio',
  title: 'Music loop',
  description: 'A complete synthesized backing track for any length: kick, snare, hats, bass and a seeded arpeggio over a four-bar chord loop, with an arrangement that builds and winds down. Tempo, key, scale and mix are parameters; the kick gives the clip its beats.',
  tags: ['audio', 'music', 'beat', 'sequencer', 'soundtrack'],
  uses: ['drum-kick', 'drum-snare', 'drum-hat', 'synth-note'],
  params: {
    bpm: { type: 'number', default: 120, min: 60, max: 180, step: 1 },
    root: { type: 'integer', default: 45, min: 24, max: 60, description: 'MIDI note of the key (45 = A2)' },
    scale: { type: 'enum', options: ['minor', 'major', 'dorian'], default: 'minor' },
    drums: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    bass: { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 },
    arp: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    arpWave: { type: 'enum', options: ['saw', 'square', 'triangle'], default: 'square' },
    swing: { type: 'number', default: 0.0, min: 0, max: 0.3, step: 0.01, description: 'Delay of the off-beat sixteenths, as a fraction of a sixteenth' },
    build: { type: 'boolean', default: true, description: 'Bring the parts in one by one over the first bars' },
    outroBars: { type: 'integer', default: 1, min: 0, max: 4, description: 'Bars at the end with the drums pulled back' },
  },
  render(f, p) {
    const A = f.lib.audio;
    const beat = 60 / p.bpm, bar = beat * 4, six = beat / 4;
    const bars = Math.ceil(f.duration / bar);
    const L = A.buffer(f.duration), R = A.buffer(f.duration);
    const put = (buf, at, gain, pan = 0) => { A.mix(L, buf, at, gain * (1 - Math.max(0, pan))); A.mix(R, buf, at, gain * (1 + Math.min(0, pan))); };
    const scale = SCALES[p.scale], prog = PROGRESSIONS[p.scale];
    const degree = (d) => p.root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

    const kick = f.use('drum-kick', {}, { duration: 0.45 });
    const snare = f.use('drum-snare', {}, { duration: 0.3 });
    const hat = f.use('drum-hat', {}, { duration: 0.12 });
    const hatOpen = f.use('drum-hat', { open: true }, { duration: 0.3 });
    const notes = new Map();
    const note = (n, kind) => {
      const key = `${kind}${n}`;
      if (!notes.has(key)) {
        notes.set(key, kind === 'bass'
          ? f.use('synth-note', { note: n, wave: 'saw', cutoff: 420, decay: 0.2, gain: 0.7, detune: 0.004 }, { duration: beat * 0.9, key })
          : f.use('synth-note', { note: n, wave: p.arpWave, cutoff: 3200, decay: 0.11, gain: 0.3, detune: 0.008 }, { duration: beat * 0.75, key }));
      }
      return notes.get(key);
    };
    const pattern = f.rng.fork('arp');
    const steps = Array.from({ length: 16 }, () => pattern.pick([0, 2, 4, 7, 9, 4, 2]));
    const rests = Array.from({ length: 16 }, (_, i) => i % 4 !== 0 && pattern.bool(0.3));

    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const outro = bars - b <= p.outroBars;
      const last = b === bars - 1;
      const chord = prog[b % 4];
      // the arrangement: which parts play in this bar
      const hasSnare = (!p.build || b >= 1) && !outro;
      const hasBass = (!p.build || b >= 2) && !last;
      const hasArp = !p.build || b >= 4 || (b >= 2 && b % 2 === 1);
      const hasHats = !last;
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * six + (s % 2 ? p.swing * six : 0);
        if (t >= f.duration) break;
        if (s % 4 === 0 && (!last || s === 0)) put(kick, t, p.drums);
        if (hasSnare && (s === 4 || s === 12)) put(snare, t, p.drums * 0.8);
        if (hasHats && s % 2 === 0) put(s % 4 === 2 ? hatOpen : hat, t, p.drums * (s % 4 === 2 ? 0.55 : 0.4), 0.25);
        if (hasHats && !outro && s % 2 === 1 && b % 2 === 1) put(hat, t, p.drums * 0.18, -0.2);
        if (hasBass && s % 2 === 0 && s % 8 !== 6) put(note(degree(chord) - 12 + (s % 8 === 4 ? 12 : 0), 'bass'), t, p.bass * 0.8);
        if (hasArp && !rests[s] && !last) put(note(degree(chord + steps[s]) + 12, 'arp'), t, p.arp * (outro ? 0.6 : 1), s % 2 ? 0.35 : -0.35);
      }
    }
    // a little space on the arpeggio side-chains nothing, but an echo glues the parts together
    A.delay(L, beat * 0.75, 0.25, 0.12);
    A.delay(R, beat * 0.5, 0.25, 0.12);
    const peak = Math.max(A.peak(L), A.peak(R));
    if (peak > 0) { A.gain(L, 0.85 / peak); A.gain(R, 0.85 / peak); }
    return { left: A.fade(L, 0.005, 0.4), right: A.fade(R, 0.005, 0.4) };
  },
});
