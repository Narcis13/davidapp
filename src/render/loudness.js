// Loudness the way broadcasters measure it: ITU-R BS.1770-4 / EBU R128 (integrated, range,
// momentary, short-term, true peak) in pure JS, so the studio can measure the exact samples it
// renders. ebur128() asks FFmpeg for the same numbers from a file, as an independent cross-check.

import { ffmpegPath, probe, run } from './ffmpeg.js';

const OFFSET = -0.691;
const lufs = (power) => (power > 0 ? OFFSET + 10 * Math.log10(power) : -Infinity);
const db = (amp) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

/**
 * K-weighting filters (BS.1770 stage 1 high shelf, stage 2 RLB high-pass) for any sample rate,
 * from the analogue prototypes; at 48 kHz these are the coefficients the standard publishes.
 * @returns {{ shelf: { b: number[], a: number[] }, highpass: { b: number[], a: number[] } }}
 */
export function kWeighting(sampleRate = 48000) {
  const f1 = 1681.974450955533, g1 = 3.999843853973347, q1 = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * f1) / sampleRate);
  const vh = 10 ** (g1 / 20), vb = vh ** 0.4996667741545416;
  const d1 = 1 + k1 / q1 + k1 * k1;
  const shelf = {
    b: [(vh + (vb * k1) / q1 + k1 * k1) / d1, (2 * (k1 * k1 - vh)) / d1, (vh - (vb * k1) / q1 + k1 * k1) / d1],
    a: [1, (2 * (k1 * k1 - 1)) / d1, (1 - k1 / q1 + k1 * k1) / d1],
  };
  const f2 = 38.13547087602444, q2 = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * f2) / sampleRate);
  const d2 = 1 + k2 / q2 + k2 * k2;
  const highpass = { b: [1, -2, 1], a: [1, (2 * (k2 * k2 - 1)) / d2, (1 - k2 / q2 + k2 * k2) / d2] };
  return { shelf, highpass };
}

// BS.1770-4 Annex 2: the 48-tap interpolation filter as 4 phases of 12 taps (each phase has unity DC gain)
const PHASES = new Float64Array([
  0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500,
  -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875,
  -0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750,
]);
// the largest sum of |tap| in a phase: an oversampled value can't exceed this times the samples around it
const GAIN_BOUND = Math.max(...[0, 1, 2, 3].map((p) => PHASES.slice(p * 12, p * 12 + 12).reduce((s, v) => s + Math.abs(v), 0)));
const BLOCK = 256;

/** The four oversampled values between sample i and i+1 → max |value| (samples past either end are zero). */
function oversampledMax(x, i, n) {
  const lo = Math.max(0, i - 5), hi = Math.min(n - 1, i + 6);
  let m = 0;
  for (let p = 0; p < 48; p += 12) {
    let s = 0;
    for (let j = lo; j <= hi; j++) s += PHASES[p + i + 6 - j] * x[j];
    if (s < 0) s = -s;
    if (s > m) m = s;
  }
  return m;
}

/**
 * Oversample one channel 4×: out[4i + p] lies between samples i and i+1 (the filter's group delay is removed).
 * @param {Float32Array} channel @returns {Float32Array}
 */
export function oversample4(channel) {
  const n = channel.length;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 5), hi = Math.min(n - 1, i + 6);
    for (let p = 0; p < 4; p++) {
      let s = 0;
      for (let j = lo; j <= hi; j++) s += PHASES[p * 12 + i + 6 - j] * channel[j];
      out[4 * i + p] = s;
    }
  }
  return out;
}

/** Largest |sample| per block of 256 (both channels). */
function blockMaxima(left, right) {
  const n = left.length;
  const bm = new Float64Array(Math.ceil(n / BLOCK));
  for (let b = 0; b < bm.length; b++) {
    let m = 0;
    for (let i = b * BLOCK, e = Math.min(n, i + BLOCK); i < e; i++) {
      const l = Math.abs(left[i]), r = Math.abs(right[i]);
      if (l > m) m = l;
      if (r > m) m = r;
    }
    bm[b] = m;
  }
  return bm;
}

/** Largest |sample| of both channels. */
function samplePeakOf(left, right) {
  let m = 0;
  for (const bm of blockMaxima(left, right)) if (bm > m) m = bm;
  return m;
}

/**
 * Per-sample peak: the largest of |L|, |R| and the oversampled values that follow (4× oversampling).
 * Blocks whose oversampled values can't reach `skipAbove` are not oversampled (their plain sample peak is used).
 * @param {Float32Array} left @param {Float32Array} right @param {number} skipAbove
 * @returns {Float32Array}
 */
export function peakEnvelope(left, right, skipAbove = 0) {
  const n = left.length;
  const bm = blockMaxima(left, right);
  const out = new Float32Array(n);
  for (let b = 0; b < bm.length; b++) {
    const near = Math.max(bm[b], bm[b - 1] ?? 0, bm[b + 1] ?? 0);
    const from = b * BLOCK, to = Math.min(n, from + BLOCK);
    const exact = near * GAIN_BOUND > skipAbove;
    for (let i = from; i < to; i++) {
      let m = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      if (exact) m = Math.max(m, oversampledMax(left, i, n), oversampledMax(right, i, n));
      out[i] = m;
    }
  }
  return out;
}

/**
 * True peak in dBTP (BS.1770-4 Annex 2, 4× oversampling; at 96 kHz and above the sample peak is used).
 * Silence is -Infinity.
 * @param {Float32Array} left @param {Float32Array} right @param {number} [sampleRate]
 */
export function truePeak(left, right, sampleRate = 48000) {
  const n = left.length;
  const bm = blockMaxima(left, right);
  let best = 0;
  for (const m of bm) if (m > best) best = m;
  if (sampleRate < 96000) {
    for (let b = 0; b < bm.length; b++) {
      if (Math.max(bm[b], bm[b - 1] ?? 0, bm[b + 1] ?? 0) * GAIN_BOUND <= best) continue; // can't beat the best so far
      for (let i = b * BLOCK, e = Math.min(n, i + BLOCK); i < e; i++) {
        const m = Math.max(oversampledMax(left, i, n), oversampledMax(right, i, n));
        if (m > best) best = m;
      }
    }
  }
  return db(best);
}

/** Energy of the K-weighted signal per 100 ms hop, both channels summed. */
function hopEnergies(left, right, sampleRate) {
  const hop = Math.round(sampleRate * 0.1);
  const hops = Math.floor(left.length / hop);
  const e = new Float64Array(hops);
  const { shelf: s, highpass: h } = kWeighting(sampleRate);
  for (const x of [left, right]) {
    let s1 = 0, s2 = 0, h1 = 0, h2 = 0;
    for (let k = 0, i = 0; k < hops; k++) {
      let acc = 0;
      for (const end = i + hop; i < end; i++) {
        const v = x[i];
        const y = s.b[0] * v + s1;
        s1 = s.b[1] * v - s.a[1] * y + s2;
        s2 = s.b[2] * v - s.a[2] * y;
        const z = h.b[0] * y + h1;
        h1 = h.b[1] * y - h.a[1] * z + h2;
        h2 = h.b[2] * y - h.a[2] * z;
        acc += z * z;
      }
      e[k] += acc;
    }
  }
  return { e, hop };
}

/** Mean-square power of every window of `span` hops, stepping one hop (100 ms). */
function windowPowers(e, hop, span) {
  const out = new Float64Array(Math.max(0, e.length - span + 1));
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    for (let k = w; k < w + span; k++) sum += e[k];
    out[w] = sum / (span * hop);
  }
  return out;
}

/** BS.1770 gating of block powers: absolute -70 LUFS, then 10 LU under the mean of what is left → LUFS or null. */
function gated(powers) {
  const above = [];
  let sum = 0;
  for (const p of powers) if (lufs(p) > -70) { above.push(p); sum += p; }
  if (!above.length) return null;
  const relative = lufs(sum / above.length) - 10;
  let kept = 0, total = 0;
  for (const p of above) if (lufs(p) > relative) { kept++; total += p; }
  return kept ? lufs(total / kept) : null;
}

/** EBU Tech 3342 loudness range from short-term powers (-70 absolute gate, -20 LU relative gate, 10th to 95th percentile). */
function loudnessRange(powers) {
  const above = [];
  let sum = 0;
  for (const p of powers) if (lufs(p) > -70) { above.push(p); sum += p; }
  if (!above.length) return 0;
  const relative = lufs(sum / above.length) - 20;
  const values = above.map(lufs).filter((l) => l > relative).sort((a, b) => a - b);
  if (values.length < 2) return 0;
  const at = (q) => values[Math.round((values.length - 1) * q)];
  return at(0.95) - at(0.1);
}

const maxLufs = (powers) => {
  let m = 0;
  for (const p of powers) if (p > m) m = p;
  return m > 0 ? lufs(m) : null;
};

/**
 * Loudness of a stereo signal → { integrated (LUFS, null when everything is gated out), range (LU, EBU Tech 3342),
 * truePeak (dBTP), samplePeak (dBFS), momentaryMax, shortTermMax (LUFS, null when there is no such window or it is silent) }.
 * Peaks of silence are -Infinity.
 * @param {Float32Array} left @param {Float32Array} right @param {number} [sampleRate]
 */
export function measureLoudness(left, right, sampleRate = 48000) {
  const { e, hop } = hopEnergies(left, right, sampleRate);
  const blocks = windowPowers(e, hop, 4);
  const shortTerm = windowPowers(e, hop, 30);
  return {
    integrated: gated(blocks),
    range: loudnessRange(shortTerm),
    truePeak: truePeak(left, right, sampleRate),
    samplePeak: db(samplePeakOf(left, right)),
    momentaryMax: maxLufs(blocks),
    shortTermMax: maxLufs(shortTerm),
  };
}

/**
 * Gated integrated loudness over only the 400 ms blocks whose centre lies inside one of regions
 * ([[start, end]] seconds); null when no block qualifies.
 * @param {Float32Array} left @param {Float32Array} right @param {number} sampleRate @param {number[][]} regions
 */
export function loudnessOver(left, right, sampleRate, regions) {
  const { e, hop } = hopEnergies(left, right, sampleRate);
  const blocks = windowPowers(e, hop, 4);
  const chosen = [];
  for (let b = 0; b < blocks.length; b++) {
    const centre = (b * hop + 2 * hop) / sampleRate;
    if (regions.some(([s, t]) => centre >= s && centre <= t)) chosen.push(blocks[b]);
  }
  return chosen.length ? gated(chosen) : null;
}

/**
 * FFmpeg's ebur128 on a file's audio stream → { integrated, range, truePeak }.
 * @param {string} path
 */
export async function ebur128(path) {
  const r = await run(ffmpegPath(), ['-nostats', '-hide_banner', '-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  if (r.code !== 0) {
    const p = await probe(path).catch(() => null);
    if (p && !p.streams.some((s) => s.codec_type === 'audio')) throw new Error(`${path} has no audio stream`);
    throw new Error(`ffmpeg could not measure ${path}: ${r.stderr.trim().split(/\r?\n/).slice(-3).join(' ')}`);
  }
  const summary = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => {
    const m = re.exec(summary);
    if (!m) throw new Error(`ffmpeg's ebur128 summary for ${path} could not be read`);
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  };
  const N = '(-?\\d+(?:\\.\\d+)?|-inf)';
  const integrated = num(new RegExp(`^\\s*I:\\s+${N}\\s+LUFS`, 'm'));
  return {
    integrated: Number.isFinite(integrated) ? integrated : null,
    range: num(new RegExp(`^\\s*LRA:\\s+${N}\\s+LU`, 'm')),
    truePeak: num(new RegExp(`True peak:[\\s\\S]*?Peak:\\s+${N}\\s+dBFS`)),
  };
}
