// Small math helpers every asset gets as f.lib.math (and spread on f.lib for brevity).

export const TAU = Math.PI * 2;
export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
/** Map v from [a, b] to [c, d]; clamped unless clampOut is false. */
export const remap = (v, a, b, c, d, clampOut = true) => {
  const t = invLerp(a, b, v);
  return lerp(c, d, clampOut ? clamp01(t) : t);
};
export const smoothstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
/** Progress 0..1 of a span that starts at `start` and lasts `dur` seconds. */
export const phase = (t, start, dur) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / dur));
/** Progress 0..1 for item i of a staggered sequence: each item starts `each` seconds after the previous. */
export const stagger = (t, i, each, dur, start = 0) => phase(t, start + i * each, dur);
export const fract = (v) => v - Math.floor(v);
export const mod = (v, n) => ((v % n) + n) % n;
export const pingpong = (v) => 1 - Math.abs(mod(v, 2) - 1);
export const deg = (d) => (d * Math.PI) / 180;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
/** In/out envelope: rises over `inDur` at the start and falls over `outDur` before `duration`. */
export const envelope = (t, duration, inDur = 0.3, outDur = 0.3) =>
  Math.min(inDur > 0 ? clamp01(t / inDur) : 1, outDur > 0 ? clamp01((duration - t) / outDur) : 1);
