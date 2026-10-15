// Word times from whisper are token times. Measured on a take whose word times are known, they are far from the
// sound: a word's start sits in the silence before it or, late in a long file, up to a second away (median 175 ms
// off with small.en). whisper's DTW token times (one time inside each word, from the decoder's attention) do not
// drift, so they say which sound belongs to which word; the audio then says where the sound starts and stops.
//
// Between the anchors of two neighbouring words lies the boundary between them. If there is a pause there (a run of
// quiet 5 ms windows, at least 40 ms), the first word ends where the pause begins and the next starts where it ends.
// Where there is no pause (continuous speech) whisper's own times are kept: they were within 10–50 ms there.

/** Quiet = under this share of the file's speech level (its 90th percentile of 5 ms RMS), and at least this long. */
const QUIET = 0.02, MIN_PAUSE = 0.04, WIN = 0.005;

/**
 * @param {{ text: string, start: number, end: number }[]} words from whisper, in seconds
 * @param {(number | null)[]} anchors one time inside each word (its last DTW token), or null
 * @param {Float32Array} samples mono audio @param {number} sampleRate
 * @returns {{ words: { text: string, start: number, end: number }[], moved: number }} moved: boundaries put on a pause
 */
export function refineWords(words, anchors, samples, sampleRate) {
  const win = Math.max(1, Math.round(sampleRate * WIN));
  const n = Math.floor(samples.length / win);
  const rms = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let s = 0;
    for (let i = w * win; i < (w + 1) * win; i++) s += samples[i] * samples[i];
    rms[w] = Math.sqrt(s / win);
  }
  const sorted = Float64Array.from(rms).sort();
  const level = sorted[Math.floor(n * 0.9)] ?? 0;
  const quiet = (w) => rms[w] < Math.max(1e-5, QUIET * level);
  const minRun = Math.round(MIN_PAUSE / WIN);
  const t = (w) => (w * win) / sampleRate;

  /** The longest quiet run between two times (null = file edge): { from, to } in seconds, or null. */
  function pauseBetween(a, b) {
    const w0 = Math.max(0, Math.ceil(((a ?? 0) * sampleRate) / win)), w1 = Math.min(n, Math.floor(((b ?? n * WIN) * sampleRate) / win));
    let best = null;
    for (let w = w0; w < w1;) {
      if (!quiet(w)) { w++; continue; }
      let e = w;
      while (e < w1 && quiet(e)) e++;
      if (e - w >= minRun && (!best || e - w > best.len)) best = { from: t(w), to: t(e), len: e - w };
      w = e;
    }
    return best;
  }

  const out = words.map((w) => ({ ...w }));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const duration = samples.length / sampleRate;
  let moved = 0;
  for (let i = 0; i <= words.length; i++) {
    // the boundary before word i lies between the anchors of words i-1 and i (the file's edges for the first and the last)
    const lo = i > 0 ? anchors[i - 1] : 0, hi = i < words.length ? anchors[i] : duration;
    if (lo === null || hi === null || !(hi > lo)) continue;
    const p = pauseBetween(lo, hi);
    if (p) {
      if (i > 0) out[i - 1].end = r3(p.from);
      if (i < words.length) out[i].start = r3(p.to);
      moved++;
      continue;
    }
    // continuous speech: whisper's time stands if it lies between the anchors; else (late in a file whisper's tokens
    // can be half a second off) the boundary goes just after the earlier word's anchor, which sits about 100 ms
    // before that word's end
    const eps = 0.01;
    const plausible = (v) => v > lo + eps && v < hi - eps;
    const b = i === 0 ? Math.max(0, hi - 0.25) : i === words.length ? Math.min(duration, lo + 0.15) : Math.min(lo + 0.1, (lo + hi) / 2);
    if (i < words.length && !plausible(out[i].start) && !(i === 0 && out[i].start < hi - eps)) out[i].start = r3(b);
    if (i > 0 && !plausible(out[i - 1].end) && !(i === words.length && out[i - 1].end > lo + eps)) out[i - 1].end = r3(i < words.length ? out[i].start : b);
  }
  // a word keeps some length and the words stay in order
  let prev = 0;
  for (const w of out) {
    if (w.start < prev) w.start = prev;
    if (w.end < w.start + 0.01) w.end = Math.round((w.start + 0.01) * 1000) / 1000;
    prev = w.start;
  }
  return { words: out, moved };
}
