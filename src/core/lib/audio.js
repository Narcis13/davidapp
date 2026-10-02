// DSP helpers for audio assets. Buffers are mono Float32Arrays at f.sampleRate; an audio asset
// returns one (or { left, right }) and the engine writes the WAV that FFmpeg mixes.

import { SAMPLE_RATE } from '../engine.js';

export function createAudio(sampleRate = SAMPLE_RATE) {
  const sr = sampleRate;
  const buffer = (seconds) => new Float32Array(Math.max(0, Math.round(seconds * sr)));
  const midi = (note) => 440 * 2 ** ((note - 69) / 12);

  const waves = {
    sine: (ph) => Math.sin(2 * Math.PI * ph),
    square: (ph) => (ph % 1 < 0.5 ? 1 : -1),
    saw: (ph) => 2 * (ph % 1) - 1,
    triangle: (ph) => 1 - 4 * Math.abs((ph % 1) - 0.5),
  };

  /** Attack/decay/sustain/release gain at time t of a note held for `hold` seconds. */
  const adsr = (t, a, d, s, r, hold) => {
    if (t < 0) return 0;
    if (t < a) return t / a;
    if (t < a + d) return 1 - ((t - a) / d) * (1 - s);
    if (t < hold) return s;
    const rel = (t - hold) / r;
    return rel >= 1 ? 0 : s * (1 - rel);
  };

  /**
   * A pitched note. freq may be a number or a function of time (for sweeps). Returns a buffer of
   * `dur` seconds: wave (sine|square|saw|triangle), gain, and an exponential decay or ADSR envelope.
   * @param {any} o
   */
  function tone({ freq, dur, wave = 'sine', gain = 1, decay, attack = 0.005, release = 0.03, sustain = 0.7, env }) {
    const out = buffer(dur);
    const fn = waves[wave] ?? waves.sine;
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const hz = typeof freq === 'function' ? freq(t) : freq;
      ph += hz / sr;
      const e = env ? env(t) : decay ? Math.min(1, t / attack) * Math.exp(-t / decay) : adsr(t, attack, 0.05, sustain, release, dur - release);
      out[i] = fn(ph) * e * gain;
    }
    return out;
  }

  /** White noise from a seeded rng, with an exponential decay. @param {any} o */
  function noiseBurst({ rng, dur, gain = 1, decay = 0.05, attack = 0.001 }) {
    const out = buffer(dur);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] = (rng() * 2 - 1) * Math.min(1, t / attack) * Math.exp(-t / decay) * gain;
    }
    return out;
  }

  /** Add src into dst starting at `at` seconds. Returns dst. */
  function mix(dst, src, at = 0, gain = 1) {
    const start = Math.round(at * sr);
    const from = Math.max(0, -start);
    const n = Math.min(src.length, dst.length - start);
    for (let i = from; i < n; i++) dst[start + i] += src[i] * gain;
    return dst;
  }

  /** One-pole filters, in place. Returns the buffer. */
  function lowpass(buf, cutoff) {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    let y = 0;
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
    return buf;
  }
  function highpass(buf, cutoff) {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    let y = 0;
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] -= y; }
    return buf;
  }

  /** Feedback delay (echo), in place. */
  function delay(buf, time, feedback = 0.35, wet = 0.3) {
    const d = Math.max(1, Math.round(time * sr));
    const line = new Float32Array(d);
    for (let i = 0, p = 0; i < buf.length; i++, p = (p + 1) % d) {
      const echoed = line[p];
      line[p] = buf[i] + echoed * feedback;
      buf[i] += echoed * wet;
    }
    return buf;
  }

  /** Gain ramps at both ends, in place. */
  function fade(buf, fadeIn = 0.01, fadeOut = 0.01) {
    const a = Math.round(fadeIn * sr), b = Math.round(fadeOut * sr);
    for (let i = 0; i < a && i < buf.length; i++) buf[i] *= i / a;
    for (let i = 0; i < b && i < buf.length; i++) buf[buf.length - 1 - i] *= i / b;
    return buf;
  }

  const softclip = (buf, drive = 1) => { for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive); return buf; };
  const peak = (buf) => { let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i])); return m; };
  const normalize = (buf, level = 0.9) => { const p = peak(buf); if (p > 0) { const g = level / p; for (let i = 0; i < buf.length; i++) buf[i] *= g; } return buf; };
  const gain = (buf, g) => { for (let i = 0; i < buf.length; i++) buf[i] *= g; return buf; };

  return { sampleRate: sr, buffer, midi, waves, adsr, tone, noiseBurst, mix, lowpass, highpass, delay, fade, softclip, peak, normalize, gain };
}
