// The JS mixer: placement, fades, dB automation, ducking, the limiter and loudness targeting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EASINGS, ease, dbToGain, gainToDb, sampleDb, wordRegions, envelopeRegions, duckCurve, mixInputs,
  limit, applyGainDb, planLoudness, reachTarget, silences, clipping,
} from '../src/render/mix.js';
import { measureLoudness, truePeak, oversample4 } from '../src/render/loudness.js';

const SR = 48000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const constant = (seconds, v, sr = SR) => new Float32Array(Math.round(seconds * sr)).fill(v);

/** Low-passed noise (a couple of one-pole stages) at a given RMS: bounded and music-like enough. */
function noise(seconds, rms, seed, sr = SR) {
  const r = rng(seed);
  const x = new Float32Array(Math.round(seconds * sr));
  let a = 0, b = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    a += 0.35 * (r() * 2 - 1 - a);
    b += 0.5 * (a - b);
    x[i] = b;
    sum += b * b;
  }
  const k = rms / Math.sqrt(sum / x.length);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

const sha = (...arrays) => {
  const h = createHash('sha256');
  for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex');
};

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b} (eps ${eps})`);

/** Largest |sample| and |oversampled value| of a stereo buffer. */
const peakOf = (l, r) => Math.max(...[l, r].flatMap((c) => [c, oversample4(c)]).map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));

test('easings: endpoints, monotonic, known names, and a helpful error for an unknown one', () => {
  assert.equal(EASINGS.length, 12);
  for (const name of EASINGS) {
    assert.equal(ease(name, 0), 0, name);
    assert.equal(ease(name, 1), 1, name);
    let prev = 0;
    for (let i = 0; i <= 100; i++) { const v = ease(name, i / 100); assert.ok(v >= prev - 1e-12, `${name} at ${i}`); prev = v; }
    assert.equal(ease(name, -3), 0);
    assert.equal(ease(name, 7), 1);
  }
  near(ease('inQuad', 0.5), 0.25, 1e-12);
  near(ease('outQuad', 0.5), 0.75, 1e-12);
  near(ease('smooth', 0.5), 0.5, 1e-12);
  near(ease('inCubic', 0.5), 0.125, 1e-12);
  near(ease('inOutCubic', 0.25), 0.0625, 1e-12);
  near(ease('inSine', 0.5), 1 - Math.SQRT1_2, 1e-12);
  assert.equal(ease('hold', 0.999), 0);
  assert.throws(() => ease('bounce', 0.5), (e) => e instanceof Error && /bounce/.test(e.message) && /inOutCubic/.test(e.message) && /hold/.test(e.message));
  assert.throws(() => ease('toString', 0.5), /Unknown easing/);
});

test('dB and gain convert both ways', () => {
  near(dbToGain(-6.0206), 0.5, 1e-4);
  near(dbToGain(0), 1, 0);
  near(gainToDb(0.1), -20, 1e-12);
  assert.equal(gainToDb(0), -Infinity);
  near(gainToDb(dbToGain(-13.7)), -13.7, 1e-12);
});

test('sampleDb: holds ends, shapes each segment by the key it leaves, hold keeps its value', () => {
  const keys = [{ t: 1, v: 0 }, { t: 2, v: -12, ease: 'inQuad' }, { t: 4, v: -12, ease: 'hold' }, { t: 5, v: 6 }, { t: 6, v: 6 }];
  assert.equal(sampleDb(keys, 0), 0); // before the first key
  assert.equal(sampleDb(keys, 1), 0);
  near(sampleDb(keys, 1.5), -6, 1e-12); // the first key leaves linearly, halfway to -12
  near(sampleDb(keys, 2), -12, 1e-12);
  near(sampleDb(keys, 3), -12, 1e-12);
  assert.equal(sampleDb(keys, 4.99), -12); // 'hold' until the next key
  assert.equal(sampleDb(keys, 5), 6);
  assert.equal(sampleDb(keys, 100), 6); // after the last key
  assert.equal(sampleDb([], 3), 0);
  // the ease belongs to the key that starts the segment
  const eased = [{ t: 0, v: 0, ease: 'inQuad' }, { t: 2, v: -8 }];
  near(sampleDb(eased, 1), -2, 1e-12);
  assert.throws(() => sampleDb([{ t: 0, v: 0, ease: 'nope' }, { t: 1, v: 1 }], 0.5), /nope/);
});

test('mixInputs places an input: start, offset, duration, silence outside and past the source', () => {
  const sr = 8000;
  const ramp = new Float32Array(sr * 10);
  for (let i = 0; i < ramp.length; i++) ramp[i] = (i + 1) / ramp.length;
  const other = ramp.map((v) => -v);
  const { left, right } = mixInputs([{ id: 'a', left: ramp, right: other, start: 1, duration: 2, offset: 0.5 }], { duration: 5, sampleRate: sr });
  assert.equal(left.length, 5 * sr);
  assert.equal(right.length, 5 * sr);
  for (const [t, srcT] of [[1, 0.5], [1.7, 1.2], [2.9999, 2.4999]]) {
    const o = Math.round(t * sr), s = Math.round(srcT * sr);
    assert.equal(left[o], ramp[s], `t=${t}`);
    assert.equal(right[o], other[s], `t=${t}`);
  }
  assert.equal(left[Math.round(1 * sr) - 1], 0);
  assert.equal(left[Math.round(3 * sr)], 0); // start + duration is exclusive
  assert.equal(left[Math.round(4.5 * sr)], 0);
  // a source shorter than needed is silence past its end
  const short = constant(1, 0.5, sr);
  const m = mixInputs([{ id: 's', left: short, right: short, start: 0, duration: 3 }], { duration: 4, sampleRate: sr });
  assert.equal(m.left[sr - 1], 0.5);
  assert.equal(m.left[sr], 0);
  // an input starting before 0 and one running past the end are cut, not rejected
  const cut = mixInputs([{ id: 'c', left: ramp, right: ramp, start: -1, duration: 3 }, { id: 'd', left: ramp, right: ramp, start: 4.5, duration: 3 }], { duration: 5, sampleRate: sr });
  assert.equal(cut.left[0], ramp[sr]);
  assert.equal(cut.left.length, 5 * sr);
  assert.equal(cut.left[4.5 * sr], ramp[0]);
  assert.equal(mixInputs([], { duration: 1, sampleRate: sr }).left.length, sr);
});

test('mixInputs sums inputs, applies gain, and fades belong to the item', () => {
  const sr = 8000;
  const one = constant(10, 1, sr), half = constant(10, 0.5, sr);
  const sum = mixInputs([
    { id: 'a', left: one, right: half, start: 0, duration: 2, gain: 0.5 },
    { id: 'b', left: half, right: half, start: 1, duration: 2, gain: 2 },
  ], { duration: 4, sampleRate: sr });
  near(sum.left[sr / 2], 0.5, 1e-7);
  near(sum.right[sr / 2], 0.25, 1e-7);
  near(sum.left[Math.round(1.5 * sr)], 0.5 + 1, 1e-6);
  near(sum.left[Math.round(2.5 * sr)], 1, 1e-6);
  // fades are linear in amplitude over the item's own start and end
  const f = mixInputs([{ id: 'f', left: one, right: one, start: 1, duration: 2, fadeIn: 0.5, fadeOut: 1 }], { duration: 4, sampleRate: sr });
  const at = (t) => f.left[Math.round(t * sr)];
  assert.equal(at(1), 0);
  near(at(1.25), 0.5, 1e-6);
  near(at(1.5), 1, 1e-6);
  near(at(1.75), 1, 1e-6);
  near(at(2), 1, 1e-3); // fade-out starts at 2
  near(at(2.5), 0.5, 1e-3);
  assert.ok(at(2.99) < 0.02 && at(2.99) > 0);
  assert.equal(at(3), 0);
  // a fade longer than the item doesn't blow up
  const g = mixInputs([{ id: 'g', left: one, right: one, start: 0, duration: 0.5, fadeIn: 2, fadeOut: 2 }], { duration: 1, sampleRate: sr });
  assert.ok(g.left.every((v) => v >= 0 && v <= 1));
});

test('mixInputs follows dB keyframes on the item timeline (offset included) and hold eases', () => {
  const sr = 8000;
  const one = constant(10, 1, sr);
  const volume = [{ t: 0, v: 0 }, { t: 1, v: -20 }, { t: 2, v: -20, ease: 'hold' }, { t: 3, v: 0 }];
  const m = mixInputs([{ id: 'v', left: one, right: one, start: 1, duration: 4, volume }], { duration: 6, sampleRate: sr });
  const gainAt = (clipT) => m.left[Math.round(clipT * sr)];
  near(gainAt(1), 1, 1e-6);
  near(gainAt(1.5), dbToGain(-10), 1e-3); // halfway down the first segment
  near(gainAt(2), dbToGain(-20), 1e-3);
  near(gainAt(3.5), dbToGain(-20), 1e-6); // 'hold' from t=2 until t=3
  near(gainAt(3.9), dbToGain(-20), 1e-6); // item time 2.9, still holding
  near(gainAt(4.2), 1, 1e-6); // item time 3.2: back at 0 dB
  near(gainAt(4.9), 1, 1e-6); // after the last key
  // t counts from the start of the item plus the offset into the source
  const o = mixInputs([{ id: 'o', left: one, right: one, start: 0, duration: 2, offset: 1, volume }], { duration: 2, sampleRate: sr });
  near(o.left[0], dbToGain(-20), 1e-6);
  near(o.left[Math.round(1.5 * sr)], dbToGain(-20), 1e-6); // item time 1.5 + offset 1 = 2.5, still holding
  // an eased segment: inQuad from 0 to -12 dB over 4 s, at t=2 it is -3 dB
  const q = mixInputs([{ id: 'q', left: one, right: one, start: 0, duration: 4, volume: [{ t: 0, v: 0, ease: 'inQuad' }, { t: 4, v: -12 }] }], { duration: 4, sampleRate: sr });
  near(q.left[2 * sr], dbToGain(-3), 2e-3);
  near(q.left[0], 1, 1e-6);
});

test('mixInputs multiplies in the duck curve per output sample', () => {
  const sr = 1000;
  const one = constant(4, 1, sr);
  const duckDb = duckCurve([[1, 2]], { by: 12, attack: 0.2, release: 0.5 }, 4 * sr, sr);
  const m = mixInputs([{ id: 'm', left: one, right: one, start: 0, duration: 4, gain: 0.5, fadeIn: 0, duckDb }], { duration: 4, sampleRate: sr });
  near(m.left[500], 0.5, 1e-6);
  near(m.left[1500], 0.5 * dbToGain(-12), 1e-6);
  near(m.left[2250], 0.5 * dbToGain(-6), 1e-4);
  near(m.left[3500], 0.5, 1e-6);
});

test('duckCurve: -by inside, a cosine ramp that arrives exactly at the start, release after, deeper wins', () => {
  const sr = 1000, n = 10 * sr;
  const c = duckCurve([[4, 6]], { by: 12, attack: 0.2, release: 0.5 }, n, sr);
  assert.ok(c instanceof Float32Array);
  assert.equal(c.length, n);
  assert.equal(c[0], 0);
  assert.equal(c[3799], 0);
  assert.equal(c[3800], 0);
  near(c[3900], -6, 1e-5); // halfway through the attack
  assert.ok(c[3999] < -11.99, `${c[3999]}`);
  assert.equal(c[4000], -12); // −by exactly at the start
  assert.equal(c[5000], -12);
  assert.equal(c[5999], -12);
  assert.equal(c[6000], -12);
  near(c[6250], -6, 1e-5); // halfway through the release
  assert.ok(c[6499] > -0.001);
  assert.equal(c[6500], 0);
  assert.equal(c[9999], 0);
  for (let i = 3800; i < 4000; i++) assert.ok(c[i] <= c[i - 1] + 1e-6, `attack not monotone at ${i}`);
  for (let i = 6001; i < 6500; i++) assert.ok(c[i] >= c[i - 1] - 1e-6, `release not monotone at ${i}`);
  assert.ok(c.every((v) => v <= 0));
  // overlapping ramps: the deeper value wins (here: the first region's release against the second's attack)
  const regions = [[1, 2], [2.3, 3]];
  const both = duckCurve(regions, { by: 9, attack: 0.3, release: 0.3 }, 4 * sr, sr);
  const a = duckCurve([regions[0]], { by: 9, attack: 0.3, release: 0.3 }, 4 * sr, sr);
  const b = duckCurve([regions[1]], { by: 9, attack: 0.3, release: 0.3 }, 4 * sr, sr);
  for (let i = 0; i < both.length; i++) assert.equal(both[i], Math.min(a[i], b[i]), `sample ${i}`);
  assert.ok(both[2150] < 0 && both[2150] <= Math.max(a[2150], b[2150]));
  // no ramps: a hard gate; a region at the very start or end of the buffer is fine
  const hard = duckCurve([[0, 0.5], [3.5, 4]], { by: 6, attack: 0, release: 0 }, 4 * sr, sr);
  assert.equal(hard[0], -6);
  assert.equal(hard[499], -6);
  assert.equal(hard[500], 0);
  assert.equal(hard[3999], -6);
});

test('wordRegions merges words closer than hold, sorts, and ignores bad words', () => {
  const words = [{ start: 2, end: 2.5 }, { start: 0, end: 0.4 }, { start: 0.5, end: 0.9 }, { start: 0.95, end: 1.1 }, { start: 5, end: 5.2 }, { start: NaN, end: 1 }];
  assert.deepEqual(wordRegions(words), [[0, 1.1], [2, 2.5], [5, 5.2]]);
  assert.deepEqual(wordRegions(words, { hold: 0.05 }), [[0, 0.4], [0.5, 1.1], [2, 2.5], [5, 5.2]]);
  assert.deepEqual(wordRegions(words, { hold: 3 }), [[0, 5.2]]);
  assert.deepEqual(wordRegions([]), []);
  assert.deepEqual(wordRegions([{ start: 1, end: 3 }, { start: 1.5, end: 2 }]), [[1, 3]]); // nested
});

test('envelopeRegions finds where the level is above the threshold, on either channel', () => {
  const sr = 8000;
  const n = sr * 8;
  const l = new Float32Array(n), r = new Float32Array(n);
  const burst = (x, from, to, amp) => { for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) x[i] = amp * Math.sin(2 * Math.PI * 300 * (i / sr)); };
  burst(l, 1, 2, 0.1); // -23 dBFS rms
  burst(l, 2.1, 2.6, 0.1); // 0.1 s gap: merges
  burst(r, 4, 5, 0.1); // only on the right
  burst(l, 6, 6.03, 0.5); // too short
  burst(l, 7, 8, 0.004); // -51 dBFS rms: under the threshold
  const regions = envelopeRegions(l, r, sr);
  assert.equal(regions.length, 2, JSON.stringify(regions));
  near(regions[0][0], 1, 0.02);
  near(regions[0][1], 2.6, 0.02);
  near(regions[1][0], 4, 0.02);
  near(regions[1][1], 5, 0.02);
  // a lower threshold picks up the quiet burst; a short hold keeps the gap
  assert.equal(envelopeRegions(l, r, sr, { threshold: -60 }).length, 3);
  assert.equal(envelopeRegions(l, r, sr, { hold: 0.05 }).length, 3);
  assert.deepEqual(envelopeRegions(new Float32Array(n), new Float32Array(n), sr), []);
});

test('limit: oversampled peak stays under the ceiling, and under-ceiling audio is bit-identical', () => {
  // a loud 6 kHz sine whose crests fall between samples: sample peaks look fine, true peaks do not
  const n = SR * 2;
  const l = new Float32Array(n), r = new Float32Array(n);
  const rand = rng(3);
  for (let i = 0; i < n; i++) {
    const burst = i > SR * 0.5 && i < SR * 0.9 ? 1.3 : 0.2;
    l[i] = burst * Math.cos(2 * Math.PI * 6000 * ((i + 0.5) / SR)) + 0.05 * (rand() - 0.5);
    r[i] = 0.7 * l[i];
  }
  const ceilingDb = -3, ceiling = dbToGain(ceilingDb);
  const out = limit(l, r, { ceilingDb });
  assert.equal(out.left.length, n);
  assert.notEqual(out.left, l);
  assert.ok(peakOf(out.left, out.right) <= ceiling, `peak ${gainToDb(peakOf(out.left, out.right))} dB`);
  assert.ok(out.reductionDb > 5.2 && out.reductionDb < 6.5, `reduction ${out.reductionDb}`); // 1.3 down to 0.708 is 5.3 dB
  assert.ok(out.limitedSamples > 10000);
  // before the burst (further back than the 5 ms lookahead) the audio is untouched, bit for bit
  assert.deepEqual(out.left.slice(0, SR * 0.49), l.slice(0, SR * 0.49));
  // sample-peak mode only guarantees samples
  const plain = limit(l, r, { ceilingDb, truePeak: false });
  assert.ok(Math.max(...plain.left.map(Math.abs)) <= ceiling);
  assert.ok(plain.reductionDb < out.reductionDb);
  // quiet audio goes through untouched, in new buffers
  const quiet = limit(l.map((v) => v * 0.1), r.map((v) => v * 0.1), { ceilingDb: -3 });
  assert.deepEqual(quiet.left, l.map((v) => v * 0.1));
  assert.equal(quiet.limitedSamples, 0);
  assert.equal(quiet.reductionDb, 0);
  const src = new Float32Array(100).fill(0.1);
  const copy = limit(src, src, { ceilingDb: 0 });
  assert.notEqual(copy.left, src);
  assert.deepEqual(copy.left, src);
});

test('limit: the gain is already low when a lone spike arrives, and recovers smoothly', () => {
  const sr = 48000, n = sr;
  const x = new Float32Array(n).fill(0.1);
  x[sr / 2] = 1.5;
  const out = limit(x, x, { ceilingDb: -6, sampleRate: sr });
  const ceiling = dbToGain(-6);
  assert.ok(out.left[sr / 2] <= ceiling);
  // the ramp down starts 5 ms (240 samples) before the spike: the gain steps down a little each sample
  let prev = 1;
  for (let i = sr / 2 - 260; i <= sr / 2; i++) { const g = out.left[i] / x[i]; assert.ok(g <= prev + 1e-6, `gain rose at ${i}`); prev = g; }
  assert.equal(out.left[sr / 2 - 300], x[sr / 2 - 300]);
  // after the spike the gain climbs back towards 1 with the release time
  const g1 = out.left[sr / 2 + 100] / 0.1, g2 = out.left[sr / 2 + 4000] / 0.1, g3 = out.left[sr / 2 + 20000] / 0.1;
  assert.ok(g1 < g2 && g2 < g3 && g3 <= 1, `${g1} ${g2} ${g3}`);
  assert.ok(g3 > 0.99);
});

test('applyGainDb returns new buffers scaled by the dB', () => {
  const l = new Float32Array([0.5, -0.25, 0]), r = new Float32Array([1, 0, -1]);
  const o = applyGainDb(l, r, -6.0206);
  near(o.left[0], 0.25, 1e-5);
  near(o.right[2], -0.5, 1e-5);
  assert.equal(l[0], 0.5);
  assert.deepEqual(applyGainDb(l, r, 0).left, l);
});

test('planLoudness: one gain, and a limiter ceiling only when the peaks need it', () => {
  const p = planLoudness({ integrated: -20, truePeak: -8 });
  assert.equal(p.gainDb, 6);
  assert.equal(p.limitDb, null);
  assert.equal(typeof p.reason, 'string');
  const q = planLoudness({ integrated: -20, truePeak: -3 }); // -3 + 6 = +3 > -1.5
  assert.equal(q.gainDb, 6);
  near(q.limitDb, -1.5 - 6, 1e-12);
  const r = planLoudness({ integrated: -10, truePeak: -2 }, { target: -16, truePeak: -2, margin: 1 });
  assert.equal(r.gainDb, -6);
  assert.equal(r.limitDb, null);
  assert.equal(planLoudness({ integrated: null, truePeak: -Infinity }).gainDb, 0);
});

/** Noise plus (optionally) single-sample spikes that are far above the body of the signal. */
function material(seconds, rms, spikes, seed) {
  const l = noise(seconds, rms, seed), r = noise(seconds, rms, seed + 1);
  if (spikes) for (let s = 1; s < seconds; s += 1.3) { const i = Math.round(s * SR); l[i] = 0.9; r[i - 7] = -0.85; }
  return { l, r };
}

test('reachTarget with spikes limits first, lands on -14 LUFS, true peak under -1.5', () => {
  const { l, r } = material(20, 0.02, true, 21);
  const t0 = performance.now();
  const res = reachTarget(l, r);
  console.log(`# reachTarget with spikes: ${(performance.now() - t0).toFixed(0)} ms, gain ${res.gainDb.toFixed(2)} dB, limit ${res.limitDb?.toFixed(2)}, ${res.note}`);
  const m = measureLoudness(res.left, res.right, SR);
  near(m.integrated, -14, 0.1, 'integrated');
  assert.ok(m.truePeak <= -1.5, `true peak ${m.truePeak}`);
  assert.equal(res.limited, true);
  assert.ok(res.limitDb < 0);
  assert.match(res.note, /limited/);
  assert.match(res.note, /−14\.0 LUFS|-14\.0 LUFS/);
  assert.equal(typeof res.note, 'string');
  assert.ok(res.before.integrated < -25 && res.before.truePeak > -1);
  near(res.after.integrated, m.integrated, 1e-9);
  assert.ok(res.gainDb > 10);
});

test('reachTarget without spikes needs only one gain', () => {
  const { l, r } = material(20, 0.03, false, 31);
  const res = reachTarget(l, r);
  const m = measureLoudness(res.left, res.right, SR);
  near(m.integrated, -14, 0.1);
  assert.ok(m.truePeak <= -1.5, `true peak ${m.truePeak}`);
  assert.equal(res.limited, false);
  assert.equal(res.limitDb, null);
  assert.match(res.note, /^One gain of [+−]?\d/);
  assert.match(res.note, /LUFS/);
  near(res.gainDb, -14 - res.before.integrated, 0.1);
  // a different target and a stricter ceiling
  const loud = reachTarget(l, r, { target: -23, truePeak: -3 });
  near(measureLoudness(loud.left, loud.right, SR).integrated, -23, 0.1);
});

test('reachTarget on a silent mix changes nothing and says so', () => {
  const z = new Float32Array(SR);
  const res = reachTarget(z, z);
  assert.equal(res.gainDb, 0);
  assert.equal(res.limited, false);
  assert.deepEqual(res.left, z);
  assert.match(res.note, /silent/);
  assert.equal(res.before.integrated, null);
});

test('silences finds quiet runs of at least minDuration', () => {
  const sr = 8000;
  const x = new Float32Array(sr * 6);
  const tone = (from, to) => { for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (i / sr)); };
  tone(0, 1); tone(2, 2.3); tone(2.6, 3.5); tone(5, 6);
  const found = silences(x, x, sr);
  assert.deepEqual(found, [{ start: 1, end: 2, duration: 1 }, { start: 3.5, end: 5, duration: 1.5 }]);
  assert.equal(silences(x, x, sr, { minDuration: 0.25 }).length, 3);
  assert.deepEqual(silences(x, x, sr, { minDuration: 2 }), []);
  // very quiet counts as silent at -50 dBFS, not at -80
  const hiss = new Float32Array(sr).fill(0.001);
  assert.equal(silences(hiss, hiss, sr).length, 1);
  assert.equal(silences(hiss, hiss, sr, { threshold: -80 }).length, 0);
  // the louder channel decides
  const loud = new Float32Array(sr).fill(0.3);
  assert.equal(silences(new Float32Array(sr), loud, sr).length, 0);
});

test('clipping counts full-scale samples and reports runs of three or more', () => {
  const sr = 8000;
  const l = new Float32Array(sr).fill(0.2), r = new Float32Array(sr).fill(-0.2);
  for (let i = 160; i < 165; i++) l[i] = 1;
  l[300] = 1; l[301] = 1; // two in a row: counted, not an event
  r[4000] = -1; r[4001] = -1; r[4002] = -1;
  const c = clipping(l, r, sr);
  assert.equal(c.samples, 5 + 2 + 3);
  assert.deepEqual(c.events, [{ t: 0.02, length: 5 }, { t: 0.5, length: 3 }]);
  assert.equal(c.peakDb, 0);
  const clean = clipping(new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.5), sr);
  assert.deepEqual(clean, { samples: 0, events: [], peakDb: gainToDb(0.5) });
  // only the first 50 events are listed
  const many = new Float32Array(sr);
  for (let k = 0; k < 100; k++) for (let i = 0; i < 3; i++) many[k * 20 + i] = 1;
  const m = clipping(many, many, sr);
  assert.equal(m.events.length, 50);
  assert.equal(m.samples, 600);
  // a run at the very end of the buffer is still an event
  const end = new Float32Array(100);
  end.fill(1, 96);
  assert.equal(clipping(end, end, sr).events.length, 2);
});

/** Six inputs over 60 s: noise with fades, volume keys and a shared duck curve. */
function sixInputs() {
  const seconds = 60;
  const a = noise(seconds, 0.1, 51), b = noise(seconds, 0.1, 52);
  const duckDb = duckCurve([[5, 9], [20, 30], [41, 45.5]], { by: 12 }, seconds * SR);
  return [0, 1, 2, 3, 4, 5].map((k) => ({
    id: `i${k}`, left: k % 2 ? a : b, right: k % 2 ? b : a, start: k * 0.5, duration: 55, offset: k,
    gain: 0.4, fadeIn: 0.5, fadeOut: 1,
    volume: k % 3 === 0 ? [{ t: 0, v: 0 }, { t: 20, v: -9, ease: 'inOutSine' }, { t: 40, v: -3 }] : undefined,
    duckDb: k >= 3 ? duckDb : undefined,
  }));
}

test('determinism: the same inputs give bit-identical mixes, limits and targets', () => {
  const inputs = sixInputs().map((x) => ({ ...x, duration: 12 }));
  const a = mixInputs(inputs, { duration: 15 }), b = mixInputs(inputs, { duration: 15 });
  assert.equal(sha(a.left, a.right), sha(b.left, b.right));
  const la = limit(a.left, a.right, { ceilingDb: -9 }), lb = limit(b.left, b.right, { ceilingDb: -9 });
  assert.ok(la.limitedSamples > 0);
  assert.equal(sha(la.left, la.right), sha(lb.left, lb.right));
  const ra = reachTarget(a.left, a.right), rb = reachTarget(b.left, b.right);
  assert.equal(sha(ra.left, ra.right), sha(rb.left, rb.right));
  assert.equal(ra.note, rb.note);
  assert.equal(ra.gainDb, rb.gainDb);
});

test('speed: 60 s with six inputs mixes quickly', () => {
  const inputs = sixInputs();
  mixInputs(inputs.map((x) => ({ ...x, duration: 1 })), { duration: 2 }); // warm up
  const t0 = performance.now();
  const m = mixInputs(inputs, { duration: 60 });
  const ms = performance.now() - t0;
  console.log(`# mixInputs 60 s x 6 inputs: ${ms.toFixed(0)} ms`);
  assert.equal(m.left.length, 60 * SR);
  assert.ok(ms < 900, `${ms} ms`);
  const t1 = performance.now();
  const lim = limit(m.left, m.right, { ceilingDb: -14 });
  assert.ok(lim.limitedSamples > 0, 'the speed test should actually limit something');
  const t2 = performance.now();
  const tp = truePeak(lim.left, lim.right, SR);
  console.log(`# limit 60 s: ${(t2 - t1).toFixed(0)} ms (${lim.limitedSamples} samples limited, ${lim.reductionDb.toFixed(1)} dB), truePeak ${(performance.now() - t2).toFixed(0)} ms`);
  assert.ok(tp <= -14, `true peak ${tp}`);
});
