// The studio's audio mixer in pure JS: placement, fades, gain automation in dB, ducking, a lookahead
// limiter and loudness targeting. The preview WAV and the render are the same samples because both
// come from here. Everything is deterministic: same input, bit-identical output.

import { SAMPLE_RATE } from '../core/engine.js';
import { measureLoudness, peakEnvelope } from './loudness.js';

export const EASINGS = ['linear', 'hold', 'smooth', 'inSine', 'outSine', 'inOutSine', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic'];

const CURVES = {
  linear: (x) => x,
  hold: (x) => (x < 1 ? 0 : 1),
  smooth: (x) => x * x * (3 - 2 * x),
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => (1 - Math.cos(Math.PI * x)) / 2,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
};

/**
 * Easing curve by name, x in 0..1 (clamped) → 0..1. 'hold' stays at 0 until x reaches 1.
 * @param {string} name @param {number} x
 */
export function ease(name, x) {
  const f = Object.hasOwn(CURVES, name) ? CURVES[name] : null;
  if (!f) throw new Error(`Unknown easing ${JSON.stringify(name)}: the known easings are ${EASINGS.join(', ')}`);
  return x <= 0 ? 0 : x >= 1 ? 1 : f(x);
}

export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/**
 * Value of dB keyframes [{ t, v, ease? }] (sorted by t) at time t: holds the first value before the first key
 * and the last after the last; the segment leaving a key is shaped by that key's ease (default linear; 'hold'
 * keeps its value until the next key).
 * @param {{ t: number, v: number, ease?: string }[]} keys @param {number} t
 */
export function sampleDb(keys, t) {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let lo = 0, hi = keys.length - 1; // keys[lo].t <= t < keys[hi].t
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = keys[lo], b = keys[hi];
  return a.v + (b.v - a.v) * ease(a.ease ?? 'linear', (t - a.t) / (b.t - a.t));
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** Merge sorted [start, end] pairs whose gap is under `gap`. */
function mergeRegions(regions, gap) {
  const out = [];
  for (const [s, e] of regions) {
    const last = out[out.length - 1];
    if (last && s - last[1] < gap) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Speech regions from words [{ start, end }] (seconds): merged [[start, end]], words closer than `hold` merge.
 * @param {{ start: number, end: number }[]} words @param {{ hold?: number }} [opts]
 */
export function wordRegions(words, { hold = 0.25 } = {}) {
  const sorted = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w) => [w.start, w.end]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return mergeRegions(sorted, hold);
}

/** Mean-square energy of consecutive chunks of `size` samples, max-combined later by the callers. */
function chunkEnergies(x, size) {
  const count = Math.floor(x.length / size);
  const e = new Float64Array(count);
  for (let k = 0, i = 0; k < count; k++) {
    let s = 0;
    for (const end = i + size; i < end; i++) s += x[i] * x[i];
    e[k] = s;
  }
  return e;
}

/**
 * Regions where the RMS level (20 ms windows, 10 ms hop, max of the two channels) is above threshold dBFS;
 * merged across gaps < hold; regions shorter than 0.05 s dropped.
 * @param {Float32Array} left @param {Float32Array} right @param {number} sampleRate
 * @param {{ threshold?: number, hold?: number }} [opts]
 */
export function envelopeRegions(left, right, sampleRate, { threshold = -40, hold = 0.25 } = {}) {
  const hop = Math.round(sampleRate * 0.01);
  const el = chunkEnergies(left, hop), er = chunkEnergies(right, hop);
  const atThreshold = hop * 2 * dbToGain(threshold) ** 2; // energy of a 20 ms window at the threshold
  const runs = [];
  for (let k = 0; k + 1 < el.length; k++) {
    if (Math.max(el[k] + el[k + 1], er[k] + er[k + 1]) <= atThreshold) continue;
    const s = (k * hop) / sampleRate, e = ((k + 2) * hop) / sampleRate;
    const last = runs[runs.length - 1];
    if (last && s <= last[1]) last[1] = e;
    else runs.push([s, e]);
  }
  return mergeRegions(runs, hold).filter(([s, e]) => e - s >= 0.05).map(([s, e]) => [round4(s), round4(e)]);
}

/**
 * Duck curve in dB (<= 0) per sample, Float32Array(n): -by inside every region; before each region start it
 * ramps from 0 to -by over `attack` seconds (reaching -by exactly at the start: the future is known, so the
 * first syllable is never loud); after each region end it ramps back to 0 over `release`; ramps are
 * cosine-shaped in dB; where ramps and regions overlap the deeper value wins.
 * @param {number[][]} regions @param {{ by: number, attack?: number, release?: number }} o @param {number} n
 */
export function duckCurve(regions, { by, attack = 0.12, release = 0.4 }, n, sampleRate = SAMPLE_RATE) {
  const out = new Float32Array(n);
  const atk = Math.round(attack * sampleRate), rel = Math.round(release * sampleRate);
  const deeper = (i, depth) => { if (i >= 0 && i < n && -depth < out[i]) out[i] = -depth; };
  for (const [start, end] of regions) {
    const s = Math.round(start * sampleRate), e = Math.round(end * sampleRate);
    for (let i = Math.max(0, s - atk); i < Math.min(n, s); i++) deeper(i, (by * (1 - Math.cos((Math.PI * (i - (s - atk))) / atk))) / 2);
    for (let i = Math.max(0, s); i < Math.min(n, e); i++) out[i] = -by;
    for (let i = Math.max(0, e); i < Math.min(n, e + rel); i++) deeper(i, (by * (1 + Math.cos((Math.PI * (i - e)) / rel))) / 2);
  }
  return out;
}

/**
 * Mix inputs into one stereo buffer of round(duration * sampleRate) samples.
 * input: { id, left, right (Float32Array: the source from its time 0, at sampleRate), start (clip s), duration (s),
 *   offset (s into the source, default 0), gain (linear, default 1), fadeIn, fadeOut (s, default 0),
 *   volume?: [{ t, v (dB), ease }] keys on the item's own timeline (t = seconds since the item's start + offset),
 *   duckDb?: Float32Array (dB per OUTPUT sample, from duckCurve) }
 * Fades are linear in amplitude and belong to the item's own start and end; the item is silent outside
 * [start, start + duration); a source shorter than needed is silence past its end. Final gain per sample =
 * gain x dbToGain(volume(t)) x fade x dbToGain(duckDb[i]). The volume curve is evaluated every 32 samples
 * (linear in gain between those points), everything else per sample.
 * @param {any[]} inputs @param {{ duration: number, sampleRate?: number }} o
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
export function mixInputs(inputs, { duration, sampleRate = SAMPLE_RATE }) {
  const n = Math.max(0, Math.round(duration * sampleRate));
  const left = new Float32Array(n), right = new Float32Array(n);
  const duckGains = new Map(); // one linear-gain array per distinct duck curve
  for (const input of inputs) {
    const at = Math.round(input.start * sampleRate);
    const len = Math.round(input.duration * sampleRate);
    const skip = Math.round((input.offset ?? 0) * sampleRate);
    const fadeIn = Math.round((input.fadeIn ?? 0) * sampleRate), fadeOut = Math.round((input.fadeOut ?? 0) * sampleRate);
    const gain = input.gain ?? 1;
    const keys = input.volume?.length ? input.volume : null;
    const from = Math.max(0, -at, -skip);
    const to = Math.min(len, n - at, input.left.length - skip);
    if (to <= from) continue;
    let duck = null;
    if (input.duckDb) {
      duck = duckGains.get(input.duckDb);
      if (!duck) {
        duck = new Float32Array(input.duckDb.length);
        for (let i = 0; i < duck.length; i++) duck[i] = input.duckDb[i] === 0 ? 1 : dbToGain(input.duckDb[i]);
        duckGains.set(input.duckDb, duck);
      }
    }
    const volumeAt = (j) => dbToGain(sampleDb(keys, j / sampleRate + (input.offset ?? 0)));
    const sl = input.left, sr = input.right;
    let block = -2, v0 = 1, v1 = 1;
    for (let j = from; j < to; j++) {
      const o = at + j, s = skip + j;
      let g = gain;
      if (keys) {
        const b = j >> 5;
        if (b !== block) {
          v0 = block === b - 1 ? v1 : volumeAt(b << 5);
          v1 = volumeAt((b + 1) << 5);
          block = b;
        }
        g *= v0 + (v1 - v0) * ((j & 31) / 32);
      }
      if (j < fadeIn) g *= j / fadeIn;
      if (len - j < fadeOut) g *= (len - j) / fadeOut;
      if (duck) g *= duck[o];
      left[o] += sl[s] * g;
      right[o] += sr[s] * g;
    }
  }
  return { left, right };
}

/** The gain per sample that keeps every peak (p) at or under `aim`: lookahead ramp down, exponential release. */
function limiterGains(p, ceiling, aim, la, alpha) {
  const n = p.length;
  const need = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const q = i > 0 && p[i - 1] > p[i] ? p[i - 1] : p[i]; // a peak between two samples needs both of them down
    if (q > ceiling) need[i] = aim / q;
  }
  // m[i] = lowest need within the next `la` samples; the gain is a box average of m, so it is already
  // that low when the peak arrives and has come down linearly before it
  const m = new Float64Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + la) head++;
    m[i] = need[dq[head]];
  }
  const g = new Float64Array(n);
  const edge = n ? m[0] : 1;
  let sum = la * edge, reduced = edge < 1 ? la : 0, prev = 1;
  for (let j = 0; j < n; j++) {
    const old = j - la > 0 ? m[j - la] : edge;
    sum += m[j] - old;
    reduced += (m[j] < 1 ? 1 : 0) - (old < 1 ? 1 : 0);
    if (reduced === 0) sum = la;
    const attack = reduced === 0 ? 1 : sum / la;
    let v = 1 - (1 - prev) * alpha;
    if (attack < v) v = attack;
    if (1 - v < 1e-9) v = 1;
    g[j] = prev = v;
  }
  return g;
}

/**
 * Deterministic lookahead limiter → { left, right (new buffers), reductionDb (max, >= 0), limitedSamples }.
 * Peak detection on the 4x oversampled signal when truePeak (default true), else on samples; instant attack
 * via lookahead (default 5 ms, linear ramp down so the gain is already low when the peak arrives),
 * exponential release (default 80 ms). Afterwards no oversampled (or sample) peak exceeds the ceiling; below
 * the ceiling nothing changes (bit-identical).
 * @param {Float32Array} left @param {Float32Array} right
 * @param {{ ceilingDb: number, sampleRate?: number, lookahead?: number, release?: number, truePeak?: boolean }} o
 */
export function limit(left, right, { ceilingDb, sampleRate = SAMPLE_RATE, lookahead = 0.005, release = 0.08, truePeak = true }) {
  const ceiling = dbToGain(ceilingDb);
  const la = Math.max(1, Math.round(lookahead * sampleRate));
  const alpha = Math.exp(-1 / (release * sampleRate));
  const n = left.length;
  const peaksOf = (l, r) => peakEnvelope(l, r, truePeak ? ceiling : Infinity);
  const p = peaksOf(left, right);
  let aim = ceiling * (1 - 1e-6);
  let out = { left: left.slice(), right: right.slice(), reductionDb: 0, limitedSamples: 0 };
  for (let attempt = 0; attempt < 8; attempt++) {
    let over = false;
    for (let i = 0; i < n && !over; i++) over = p[i] > ceiling;
    if (!over) return out;
    const g = limiterGains(p, ceiling, aim, la, alpha);
    const l = new Float32Array(n), r = new Float32Array(n);
    let lowest = 1, count = 0;
    for (let i = 0; i < n; i++) {
      l[i] = left[i] * g[i];
      r[i] = right[i] * g[i];
      if (g[i] < 1) { count++; if (g[i] < lowest) lowest = g[i]; }
    }
    out = { left: l, right: r, reductionDb: -gainToDb(lowest), limitedSamples: count };
    // the gain moves between samples, so check what actually came out and tighten if it is over
    const after = peaksOf(l, r);
    let worst = 0;
    for (let i = 0; i < n; i++) if (after[i] > worst) worst = after[i];
    if (worst <= ceiling) return out;
    aim *= (ceiling / worst) * (1 - 1e-6);
  }
  return out;
}

/**
 * A new pair of buffers scaled by db.
 * @param {Float32Array} left @param {Float32Array} right @param {number} db
 */
export function applyGainDb(left, right, db) {
  const g = dbToGain(db);
  const l = new Float32Array(left.length), r = new Float32Array(right.length);
  for (let i = 0; i < l.length; i++) l[i] = left[i] * g;
  for (let i = 0; i < r.length; i++) r[i] = right[i] * g;
  return { left: l, right: r };
}

/**
 * Plan one fixed gain to reach target from measured { integrated, truePeak }: { gainDb, limitDb: null | ceiling
 * for a limiter to apply BEFORE the gain, reason }. gainDb = target - integrated; when truePeak + gainDb exceeds
 * truePeak ceiling - margin, limitDb = ceiling - margin - gainDb.
 * @param {{ integrated: number | null, truePeak: number }} measured
 * @param {{ target?: number, truePeak?: number, margin?: number }} [opts]
 */
export function planLoudness(measured, { target = -14, truePeak = -1, margin = 0.5 } = {}) {
  if (measured.integrated === null || measured.integrated === undefined) return { gainDb: 0, limitDb: null, reason: 'The mix is silent, so no gain can reach the target.' };
  const gainDb = target - measured.integrated;
  const ceiling = truePeak - margin;
  if (measured.truePeak + gainDb > ceiling) {
    return { gainDb, limitDb: ceiling - gainDb, reason: `One gain of ${gainDb.toFixed(1)} dB would put the true peak above ${ceiling.toFixed(1)} dBTP, so the peaks are limited first.` };
  }
  return { gainDb, limitDb: null, reason: `One gain of ${gainDb.toFixed(1)} dB reaches the target with the true peak under ${ceiling.toFixed(1)} dBTP.` };
}

// numbers for people: a real minus sign, and no "-0.0"
const fmt = (v, plus = false) => {
  const s = v.toFixed(1);
  if (Number(s) === 0) return plus ? '+0.0' : '0.0';
  return s.startsWith('-') ? `−${s.slice(1)}` : plus ? `+${s}` : s;
};

/**
 * Reach the target loudness with one gain, limiting the peaks first only when that gain alone would push the
 * true peak over the ceiling: measure, plan, limit, re-measure and re-plan (at most 4 rounds) until the
 * integrated loudness is within 0.05 LU of target and the true peak is under ceiling - margin.
 * → { left, right, gainDb, limited, limitDb, before, after, note } (note: one sentence for a person).
 * A silent mix comes back unchanged.
 * @param {Float32Array} left @param {Float32Array} right
 * @param {{ target?: number, truePeak?: number, margin?: number, sampleRate?: number }} [opts]
 */
export function reachTarget(left, right, { target = -14, truePeak = -1, margin = 0.5, sampleRate = SAMPLE_RATE } = {}) {
  const before = measureLoudness(left, right, sampleRate);
  if (before.integrated === null) {
    return { left: left.slice(), right: right.slice(), gainDb: 0, limited: false, limitDb: null, before, after: before, note: `The mix is silent, so there is nothing to bring to ${fmt(target)} LUFS.` };
  }
  const ceiling = truePeak - margin;
  // plan a hair under the ceiling so rounding in the limiter and the float32 samples can't land above it
  const opts = { target, truePeak, margin: margin + 0.002 };
  const plan = planLoudness(before, opts);
  let gainDb = plan.gainDb, limitDb = plan.limitDb;
  /** @type {{ left: Float32Array, right: Float32Array }} */
  let out = { left, right };
  let after = before;
  for (let round = 0; round < 4; round++) {
    const pre = limitDb === null ? { left, right } : limit(left, right, { ceilingDb: limitDb, sampleRate });
    out = applyGainDb(pre.left, pre.right, gainDb);
    after = measureLoudness(out.left, out.right, sampleRate);
    if (after.integrated === null) break;
    const off = target - after.integrated;
    if (Math.abs(off) <= 0.05 && after.truePeak <= ceiling) break;
    if (round === 3) break;
    if (Math.abs(off) > 0.05) gainDb += off;
    if (after.truePeak + (Math.abs(off) > 0.05 ? off : 0) > ceiling - 0.002) {
      limitDb = Math.min(limitDb ?? Infinity, ceiling - 0.002 - gainDb) - (limitDb === null ? 0 : 0.01);
    }
  }
  const limited = limitDb !== null;
  const alone = before.truePeak + (target - before.integrated);
  const reached = after.integrated === null ? target : after.integrated;
  let note = limited
    ? `The peaks were limited to ${fmt(limitDb)} dBTP first: one gain alone would have put the true peak at ${fmt(alone, true)} dBTP. Then ${fmt(gainDb, true)} dB reached ${fmt(reached)} LUFS.`
    : `One gain of ${fmt(gainDb, true)} dB reached ${fmt(reached)} LUFS (true peak ${fmt(after.truePeak)} dBTP).`;
  if (Math.abs(reached - target) > 0.05) note += ` It landed ${fmt(reached - target, true)} LU from the target.`;
  return { left: out.left, right: out.right, gainDb, limited, limitDb, before, after, note };
}

/**
 * Silences: runs where the 10 ms RMS (max of channels) stays below threshold dBFS for at least minDuration
 * → [{ start, end, duration }] (seconds, 3 decimals).
 * @param {Float32Array} left @param {Float32Array} right @param {number} [sampleRate]
 * @param {{ threshold?: number, minDuration?: number }} [opts]
 */
export function silences(left, right, sampleRate = SAMPLE_RATE, { threshold = -50, minDuration = 0.5 } = {}) {
  const n = left.length;
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const floor = dbToGain(threshold) ** 2;
  const out = [];
  let runStart = -1;
  const close = (endSample) => {
    const start = runStart / sampleRate, end = endSample / sampleRate;
    if (end - start >= minDuration - 1e-9) out.push({ start: +start.toFixed(3), end: +end.toFixed(3), duration: +(end - start).toFixed(3) });
    runStart = -1;
  };
  for (let i = 0; i < n; i += win) {
    const e = Math.min(n, i + win);
    let sl = 0, sr = 0;
    for (let k = i; k < e; k++) { sl += left[k] * left[k]; sr += right[k] * right[k]; }
    const quiet = Math.max(sl, sr) / (e - i) < floor;
    if (quiet && runStart < 0) runStart = i;
    else if (!quiet && runStart >= 0) close(i);
  }
  if (runStart >= 0) close(n);
  return out;
}

/**
 * Clipping: samples with |x| >= 0.999 per channel; runs of >= 3 consecutive such samples are events
 * → { samples (both channels), events: [{ t, length }] (first 50, by time), peakDb }.
 * @param {Float32Array} left @param {Float32Array} right @param {number} [sampleRate]
 */
export function clipping(left, right, sampleRate = SAMPLE_RATE) {
  let samples = 0, peak = 0;
  const events = [];
  for (const x of [left, right]) {
    let run = 0;
    for (let i = 0; i <= x.length; i++) {
      const a = i < x.length ? Math.abs(x[i]) : 0;
      if (a > peak) peak = a;
      if (a >= 0.999) { samples++; run++; continue; }
      if (run >= 3) events.push({ t: +((i - run) / sampleRate).toFixed(3), length: run });
      run = 0;
    }
  }
  events.sort((a, b) => a.t - b.t || b.length - a.length);
  return { samples, events: events.slice(0, 50), peakDb: gainToDb(peak) };
}
