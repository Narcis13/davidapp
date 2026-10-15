// Footage (video files) in a composition: which source frame shows at a clip time. Shared by the
// renderer and the browser preview, so both pick the same frame: the source frame shown at asset
// time `at` is a pure function of the item's params and the footage's frame table.
//
// The frame table is the presentation time of every decoded frame (stream time base ticks, as the
// decoder reports them), read once when the file is imported. A clip at any frame rate samples it
// and holds: clip time → source time (trim, speed, loop, hold) → the last source frame whose time
// is at or before it. No blending, so every clip frame shows one real frame of the file.

/** What a footage layer takes, besides the transform every layer has. */
export const FOOTAGE_ITEM_SCHEMA = {
  fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain' },
  in: { type: 'number', min: 0, default: 0, description: 'Trim in: seconds into the file where the item starts' },
  out: { type: 'number', min: 0, default: 0, description: 'Trim out: seconds into the file where it stops (0 = the end of the file)' },
  speed: { type: 'number', min: 0.05, max: 16, default: 1, description: 'Playback speed (2 = twice as fast)' },
  loop: { type: 'boolean', default: false, description: 'Play the trimmed range again from the start when it ends (else the last frame holds)' },
  hold: { type: 'number', min: -1, default: -1, description: 'Freeze on this time of the file for the whole item (-1 = play)' },
};

/** Ticks → seconds, exactly enough: a time base is a small rational. */
const secondsOf = (ticks, tb) => (ticks * tb[0]) / tb[1];

/** Presentation time of frame i in seconds after the first frame. */
export const frameTime = (table, i) => secondsOf(table.pts[i] - table.pts[0], table.tb);

/** The trimmed range of a footage item in source seconds: [a, b), b exclusive. */
export function trimRange(params, meta) {
  const dur = meta.duration;
  const a = Math.min(Math.max(0, params.in ?? 0), dur);
  const out = params.out ?? 0;
  const b = out > 0 ? Math.min(Math.max(out, a), dur) : dur;
  return { a, b: b > a ? b : Math.min(dur, a + 1 / Math.max(1, meta.fps || 30)) };
}

/** Source seconds shown at asset time `at` (seconds since the item's own start, split offsets included). */
export function footageTime(params, at, meta) {
  const hold = params.hold ?? -1;
  if (hold >= 0) return Math.min(hold, meta.duration);
  const { a, b } = trimRange(params, meta);
  const span = b - a;
  const local = Math.max(0, at) * (params.speed ?? 1);
  // b is exclusive: past the end the frame before the out point holds (0.1 ms back: more than frameAt's slack, less than any frame)
  // a trim of no length (in at the very end) holds its one frame, looped or not
  if (params.loop && span > 0) return a + (local % span);
  return a + Math.min(local, span - 1e-4);
}

/** The index of the frame shown at source time s: the last frame at or before it (sample and hold). */
export function frameAt(table, s) {
  const n = table.pts.length;
  if (!n) return 0;
  // a microsecond of slack, so a time computed as k / fps lands on frame k and not just before it
  const target = s + 1e-6;
  let lo = 0, hi = n - 1;
  if (frameTime(table, 0) > target) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frameTime(table, mid) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The frame a footage item shows at asset time `at`. */
export const footageIndex = (meta, params, at) => frameAt(meta.table, footageTime(params, at, meta));

/** How long an item plays the trimmed range once at its speed (the natural duration of a new item). */
export function naturalDuration(params, meta) {
  if ((params.hold ?? -1) >= 0) return 3;
  const { a, b } = trimRange(params, meta);
  return (b - a) / (params.speed ?? 1);
}
