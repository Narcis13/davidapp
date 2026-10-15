// Mono WAV helpers for the speech tools: read what a voice engine wrote, write what the tests and the
// word-by-word takes need, and find where a word's sound begins and ends.

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Read a PCM (16/24/32-bit) or float WAV and mix it down to mono → { sampleRate, channels, samples (Float32Array, -1..1) }.
 * @param {string | Buffer} source a path or the bytes
 */
export function readWav(source) {
  const b = Buffer.isBuffer(source) ? source : readFileSync(source);
  if (b.length < 44 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('latin1', o, o + 4);
    let size = b.readUInt32LE(o + 4);
    if (o + 8 + size > b.length) size = b.length - o - 8; // a stream cut short, or a size left at its placeholder
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    else if (id === 'data') { data = b.subarray(o + 8, o + 8 + size); break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('the WAV has no fmt or data chunk');
  const { channels, bits } = fmt;
  const float = fmt.tag === 3 && bits === 32;
  const bytes = bits / 8;
  if (![8, 16, 24, 32].includes(bits) || !channels) throw new Error(`unsupported WAV format (${bits}-bit, ${channels} channels)`);
  const frames = Math.floor(data.length / (bytes * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      sum += bits === 16 ? data.readInt16LE(o) / 32768 : bits === 8 ? (data[o] - 128) / 128 : bits === 24 ? data.readIntLE(o, 3) / 8388608 : float ? data.readFloatLE(o) : data.readInt32LE(o) / 2147483648;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate: fmt.rate, channels, samples };
}

/** A mono 16-bit PCM WAV as bytes. */
export function wavBytes(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

export const writeWav = (path, samples, sampleRate) => writeFileSync(path, wavBytes(samples, sampleRate));

/** Duration in seconds from a WAV's header-sized data (no decoding). */
export function wavSeconds(path) {
  const { samples, sampleRate } = readWav(path);
  return samples.length / sampleRate;
}

/**
 * Where the sound is: the first and last 5 ms window whose RMS is above max(floor, share × the loudest window).
 * → [from, to) in samples, or null for silence.
 */
export function soundSpan(samples, sampleRate, { share = 0.04, floor = 0.004 } = {}) {
  const win = Math.max(1, Math.round(sampleRate * 0.005));
  const n = Math.floor(samples.length / win);
  const rms = new Float64Array(n);
  let peak = 0;
  for (let w = 0; w < n; w++) {
    let s = 0;
    for (let i = w * win; i < (w + 1) * win; i++) s += samples[i] * samples[i];
    rms[w] = Math.sqrt(s / win);
    if (rms[w] > peak) peak = rms[w];
  }
  const limit = Math.max(floor, share * peak);
  let a = 0, b = n - 1;
  while (a < n && rms[a] <= limit) a++;
  if (a === n) return null;
  while (b > a && rms[b] <= limit) b--;
  return [a * win, (b + 1) * win];
}
