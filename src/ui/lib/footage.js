// Footage in the editor and the playground: the facts of a video asset (fetched once per ref), the URL
// of a frame the server decodes, and the two edge trims that keep the picture where it is. The frame rule
// itself is /core/footage.js, the same code the preview worker and the renderer run.

import { api } from '/ui/lib/api.js';
import { frameAt, frameTime, trimRange } from '/core/footage.js';
import { fmtBytes, fmtDuration, splitRef, trim } from '/ui/lib/util.js';

const round3 = (v) => Math.round(v * 1000) / 1000;
const cache = new Map();   // ref → Promise<asset | null>

/** The video asset a ref names, with its meta (size, rate, frame table, sound); null when it cannot be read. Cached. */
export function footageAsset(ref) {
  if (!cache.has(ref)) {
    const { slug, version } = splitRef(ref);
    cache.set(ref, api.get(`/api/assets/${slug}${version ? `?version=${version}` : ''}`).catch(() => { cache.delete(ref); return null; }));
  }
  return cache.get(ref);
}

/** The URL of frame `index` of a footage version, as the preview asks for it (JPEG is fast, PNG exact). */
export function frameUrl(ref, index, ext = 'jpg') {
  const { slug, version } = splitRef(ref);
  return `/api/footage/${slug}/${version}/${index}.${ext}`;
}

/** The meta fields the frame rule reads. */
export const metaOf = (asset) => asset?.meta ?? null;

/** Source seconds → the frame the file shows there. */
export const frameOfSecond = (meta, s) => (meta?.table ? frameAt(meta.table, s) : Math.round(s * (meta?.fps ?? 30)));
/** Frame index → its time in seconds. */
export const secondOfFrame = (meta, i) => (meta?.table ? frameTime(meta.table, Math.min(Math.max(0, i), meta.table.pts.length - 1)) : i / (meta?.fps ?? 30));

/** The trimmed range of an item in source seconds. */
export const rangeOf = (params, meta) => trimRange(params ?? {}, meta);

/** The facts of a file in short lines: [label, value] pairs for a definition list. */
export function factsOf(a) {
  const m = a.meta ?? {};
  const c = m.colour ?? {};
  const rows = [
    ['Size', `${m.width}×${m.height}${m.rotation ? ` (rotated ${m.rotation}°)` : ''}`],
    ['Frame rate', `${trim(m.fps, 3)} fps${m.constantRate === false ? ', variable' : ''}`],
    ['Frames', String(m.frames)],
    ['Duration', fmtDuration(m.duration)],
    ['Colour', `${c.matrix ?? 'unknown'}, ${c.range === 'pc' ? 'full range' : 'limited range'}${c.assumed ? ' (assumed: the file does not say)' : ''}`],
    ['Sound', m.audio ? `${m.audio.codec}, ${m.audio.channels === 1 ? 'mono' : m.audio.channels === 2 ? 'stereo' : `${m.audio.channels} channels`}, ${Math.round(m.audio.sampleRate / 100) / 10} kHz` : 'none'],
    ['File', `${[m.container?.split(',')[0], m.codec, m.pixFmt].filter(Boolean).join(' · ')}${m.bytes ? ` · ${fmtBytes(m.bytes)}` : ''}`],
  ];
  return rows;
}

const clean = (p) => { for (const [k, d] of [['in', 0], ['out', 0], ['speed', 1], ['hold', -1]]) if (p[k] === d) delete p[k]; if (p.loop === false) delete p.loop; return p; };

/**
 * A drag of an item's left edge to `newStart`: the source frame shown at every clip time stays what it was, so
 * the trim-in moves with the start (`in` changes by the start's change times the speed). → { start, duration, params }.
 * @param {{ start: number, duration: number, params?: any }} item as it was when the drag began
 * @param {number} newStart @param {any} meta the file's facts
 */
export function trimIn(item, newStart, meta) {
  const end = item.start + item.duration;
  const params = { ...(item.params ?? {}) };
  if ((params.hold ?? -1) >= 0 || !meta) return { start: newStart, duration: end - newStart, params };
  const speed = params.speed ?? 1;
  const { a, b } = trimRange(params, meta);
  const one = 1 / Math.max(1, meta.fps || 30);
  // the file has nothing before its first frame, and the range keeps at least one frame
  const lowest = -a / speed, highest = Math.max(0, (b - one - a) / speed);
  const delta = Math.min(Math.max(newStart - item.start, lowest), highest);
  const start = round3(item.start + delta);
  params.in = round3(Math.max(0, a + delta * speed));
  return { start, duration: round3(end - start), params: clean(params) };
}

/**
 * A drag of the right edge to `newDuration`: trims out (`out` is where the picture ends in the file), never past the
 * end of the file unless the item loops (then only its length changes).
 */
export function trimOut(item, newDuration, meta) {
  const params = { ...(item.params ?? {}) };
  if ((params.hold ?? -1) >= 0 || !meta) return { duration: newDuration, params };
  const speed = params.speed ?? 1;
  const offset = item.offset ?? 0;
  const { a } = trimRange(params, meta);
  if (params.loop) return { duration: newDuration, params };
  // the longest the item can play the file once; past that the last frame would only hold
  const longest = Math.max(0.1, (meta.duration - a) / speed - offset);
  const duration = Math.min(newDuration, longest);
  const out = a + (offset + duration) * speed;
  if (out >= meta.duration - 1e-3) delete params.out; else params.out = round3(out);
  return { duration: round3(duration), params: clean(params) };
}

/** How long a new footage item lasts: the file once at speed 1, at most what is left of the clip. */
export function defaultDuration(meta, room) {
  return round3(Math.max(0.1, Math.min(meta?.duration ?? 3, room)));
}
