// Loudness (BS.1770-4 / EBU R128): the pure-JS meter against FFmpeg's ebur128 on real WAV files.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureLoudness, loudnessOver, truePeak, oversample4, kWeighting, ebur128 } from '../src/render/loudness.js';
import { encodeWav } from '../src/render/wav.js';

const SR = 48000;
let dir;
before(() => { dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'loudness-test-')); });
after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ } });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tone = (seconds, hz, amp, phase = 0) => {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.cos(2 * Math.PI * hz * (i / SR) + phase);
  return x;
};

/** Pink-ish noise (Kellet's filter) at a given RMS. */
function pink(seconds, rms, seed) {
  const r = rng(seed);
  const x = new Float32Array(Math.round(seconds * SR));
  let b0 = 0, b1 = 0, b2 = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = b0 + b1 + b2 + w * 0.1848;
    sum += x[i] * x[i];
  }
  const k = rms / Math.sqrt(sum / x.length);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** Raised-cosine fades at both ends: a signal that starts with a step would genuinely ring in any oversampler. */
const faded = (x, seconds = 0.05) => {
  const f = Math.round(seconds * SR);
  for (let i = 0; i < f; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
};

const concat = (...parts) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function against(name, left, right, { integrated = 0.1, peak = 0.2, range = 0.5 } = {}) {
  const path = join(dir, `${name}.wav`);
  writeFileSync(path, encodeWav(left, right, SR));
  const js = measureLoudness(left, right, SR);
  const ff = await ebur128(path);
  const diff = { integrated: js.integrated - ff.integrated, truePeak: js.truePeak - ff.truePeak, range: js.range - ff.range };
  console.log(`# ${name}: JS I=${js.integrated.toFixed(2)} LRA=${js.range.toFixed(2)} TP=${js.truePeak.toFixed(2)} | ffmpeg I=${ff.integrated} LRA=${ff.range} TP=${ff.truePeak} | diff ${JSON.stringify(diff, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}`);
  assert.ok(Math.abs(diff.integrated) <= integrated, `integrated differs by ${diff.integrated}`);
  assert.ok(Math.abs(diff.truePeak) <= peak, `true peak differs by ${diff.truePeak}`);
  assert.ok(Math.abs(diff.range) <= range, `range differs by ${diff.range}`);
  return { js, ff };
}

test('K-weighting at 48 kHz equals the coefficients BS.1770 publishes', () => {
  const k = kWeighting(48000);
  const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${v} vs ${b[i]}`));
  close(k.shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
  close(k.shelf.a, [1, -1.69065929318241, 0.73248077421585]);
  close(k.highpass.b, [1, -2, 1]);
  close(k.highpass.a, [1, -1.99004745483398, 0.99007225036621]);
  // other rates give a valid, stable filter (poles inside the unit circle)
  for (const sr of [8000, 22050, 44100, 96000]) {
    const { shelf, highpass } = kWeighting(sr);
    for (const f of [shelf, highpass]) assert.ok(Math.abs(f.a[2]) < 1 && Math.abs(f.a[1]) < 1 + f.a[2], `unstable at ${sr}`);
  }
});

test('a stereo sine reads its textbook level, and silence is gated out', () => {
  // a 1 kHz sine at -23 dBFS peak in both channels is -23 LUFS (K-weighting is +0.69 dB there, the offset is -0.691)
  const x = tone(10, 1000, 10 ** (-23 / 20));
  const m = measureLoudness(x, x, SR);
  assert.ok(Math.abs(m.integrated + 23) < 0.05, `integrated ${m.integrated}`);
  assert.ok(m.range < 0.05);
  assert.ok(Math.abs(m.samplePeak + 23) < 0.01);
  assert.ok(Math.abs(m.momentaryMax - m.integrated) < 0.05 && Math.abs(m.shortTermMax - m.integrated) < 0.05);
  const silent = new Float32Array(SR * 2);
  const s = measureLoudness(silent, silent, SR);
  assert.equal(s.integrated, null);
  assert.equal(s.momentaryMax, null);
  assert.equal(s.truePeak, -Infinity);
  assert.equal(loudnessOver(silent, silent, SR, [[0, 2]]), null);
});

test('the oversampler has unity gain per phase and recovers an inter-sample peak', () => {
  const dc = new Float32Array(64).fill(1);
  const up = oversample4(dc);
  assert.equal(up.length, 256);
  // the Annex 2 phases sum to 1.002, 0.973, 0.973 and 1.002 (a truncated sinc): within 3 % of the input
  for (let i = 24; i < 232; i++) assert.ok(Math.abs(up[i] - 1) < 0.03, `${i}: ${up[i]}`);
  // 6 kHz sine whose peaks fall between samples: sample peak 0.924, true peak 1.0
  const x = new Float32Array(4800);
  for (let i = 0; i < x.length; i++) x[i] = Math.cos(2 * Math.PI * 6000 * ((i + 0.5) / SR));
  faded(x, 0.02);
  const sp = 20 * Math.log10(Math.max(...x.map(Math.abs))); // the faded signal keeps full-scale crests in the middle
  const tp = truePeak(x, x, SR);
  assert.ok(tp > sp + 0.5, `true ${tp} vs sample ${sp}`);
  assert.ok(Math.abs(tp) < 0.1, `true peak ${tp}`);
});

test('JS loudness of a 1 kHz stereo sine matches FFmpeg ebur128', async () => {
  const l = faded(tone(12, 1000, 0.1)), r = faded(tone(12, 1000, 0.1));
  await against('sine', l, r);
});

test('JS loudness of pink noise with a level step matches FFmpeg ebur128 (range included)', async () => {
  const l = faded(concat(pink(10, 0.02, 11), pink(10, 0.15, 12))), r = faded(concat(pink(10, 0.02, 13), pink(10, 0.15, 14)));
  const { js } = await against('noise-step', l, r);
  assert.ok(js.range > 10, `range ${js.range}`); // about 17 dB between the halves
});

test('JS true peak of an inter-sample peak matches FFmpeg and exceeds the sample peak', async () => {
  // a 6 kHz sine whose crests fall between samples, over a little noise
  const l = new Float32Array(SR * 8), r = new Float32Array(SR * 8);
  const base = pink(8, 0.03, 9);
  for (let i = 0; i < l.length; i++) {
    const crest = 0.5 * Math.cos(2 * Math.PI * 6000 * ((i + 0.5) / SR));
    l[i] = base[i] + crest;
    r[i] = base[i] * 0.8 + crest * 0.6;
  }
  faded(l);
  faded(r);
  const { js } = await against('inter-sample', l, r);
  assert.ok(js.truePeak > js.samplePeak + 0.3, `true ${js.truePeak} vs sample ${js.samplePeak}`);
});

test('ebur128 on a file without audio says so', async () => {
  const path = join(dir, 'video-only.mp4');
  const { run, ffmpegPath } = await import('../src/render/ffmpeg.js');
  const made = await run(ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1:r=10', '-pix_fmt', 'yuv420p', path]);
  assert.equal(made.code, 0, made.stderr);
  await assert.rejects(ebur128(path), /has no audio stream/);
});

test('loudnessOver measures only the blocks centred in the regions', () => {
  // 4 s loud (-20 dBFS), 6 s quiet (-50 dBFS)
  const x = concat(tone(4, 1000, 0.1), tone(6, 1000, 0.1 * 10 ** (-30 / 20)));
  const loud = loudnessOver(x, x, SR, [[0.2, 3.8]]);
  const quiet = loudnessOver(x, x, SR, [[4.5, 9.5]]);
  const both = loudnessOver(x, x, SR, [[0, 10]]);
  assert.ok(Math.abs(loud + 20) < 0.1, `loud ${loud}`);
  assert.ok(Math.abs(quiet + 50) < 0.1, `quiet ${quiet}`);
  // the whole file is gated: the quiet part is more than 10 LU under, so it doesn't count
  assert.ok(Math.abs(both - measureLoudness(x, x, SR).integrated) < 1e-9);
  assert.ok(Math.abs(both - loud) < 0.5);
  assert.equal(loudnessOver(x, x, SR, [[20, 30]]), null);
  assert.equal(loudnessOver(x, x, SR, []), null);
  // blocks more than 10 LU under the rest are gated out of a combined measurement, as in the full measurement
  const two = loudnessOver(x, x, SR, [[0.2, 3.8], [6, 8]]);
  assert.ok(Math.abs(two - loud) < 0.1, `two ${two}`);
});

test('speed: loudness and true peak of 60 s of stereo noise', () => {
  const l = pink(60, 0.1, 5), r = pink(60, 0.1, 6);
  const t0 = performance.now();
  const m = measureLoudness(l, r, SR);
  const t1 = performance.now();
  const tp = truePeak(l, r, SR);
  const ms = performance.now() - t0;
  console.log(`# measureLoudness 60 s: ${(t1 - t0).toFixed(0)} ms (includes one true-peak pass), extra truePeak ${(performance.now() - t1).toFixed(0)} ms, total ${ms.toFixed(0)} ms`);
  assert.equal(m.truePeak, tp);
  assert.ok(ms < 4500, `${ms} ms`);
});
