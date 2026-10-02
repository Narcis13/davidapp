// Beat helpers. A clip's audio is analysed once into f.clip.beats (seconds, ascending); these
// turn that list into values an animation can use.

/** The beat at or before t: { index, time, since, until, phase } or null before the first beat. */
export function at(t, beats) {
  if (!beats || !beats.length || t < beats[0]) return null;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t) lo = mid; else hi = mid - 1;
  }
  const next = beats[lo + 1];
  const since = t - beats[lo];
  const until = next === undefined ? Infinity : next - t;
  return { index: lo, time: beats[lo], since, until, phase: next === undefined ? 0 : since / (next - beats[lo]) };
}

/** A 0..1 pulse that jumps to 1 on every beat and decays with the given time constant (seconds). */
export function pulse(t, beats, decay = 0.18) {
  const b = at(t, beats);
  return b ? Math.exp(-b.since / decay) : 0;
}

/** How many beats have happened by time t. */
export const count = (t, beats) => {
  const b = at(t, beats);
  return b ? b.index + 1 : 0;
};
