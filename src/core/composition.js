// Clip compositions: the declarative description of a clip. Structure only; whether the asset
// references exist and the params match their schemas is checked by the studio (studio/clips.js).
//
//   {
//     format: 'vertical', fps: 30, duration: 32, seed: 1, background: '#0b0b12',
//     tracks: [
//       { id: 'bg', type: 'visual', items: [{ id: 'bg1', asset: 'gradient-bg@1', start: 0, duration: 32, params: {} }] },
//       { id: 'titles', type: 'text', items: [{ id: 't1', asset: 'text-word-reveal@2', start: 1, duration: 4,
//           params: { text: 'Hello' }, fadeOut: 0.3, box: { x: 0, y: 0.5, width: 1, height: 0.5 } }] },
//       { id: 'music', type: 'audio', items: [{ id: 'm1', asset: 'beat-loop@1', start: 0, duration: 32, gain: 0.8, beats: true }] },
//     ],
//   }
//
// Tracks draw bottom to top in array order. "visual" and "text" tracks render the same way; the
// type is a label for the editor. Audio items are synthesized (or read) and mixed by FFmpeg.

import { FORMATS, MAX_CLIP_SECONDS, REF_RE, formatOf } from './engine.js';
import { isColor } from './schema.js';

export const TRACK_TYPES = ['visual', 'text', 'audio'];
export const BLEND_MODES = ['source-over', 'screen', 'multiply', 'overlay', 'lighter', 'soft-light', 'difference'];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Validate the structure of a composition and return a normalized copy.
 * Returns { composition, errors: [{ path, message }] }; composition is null when there are errors.
 */
export function normalizeComposition(input) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isPlain(input)) return { composition: null, errors: [{ path: '', message: 'a composition is an object with format, fps, duration and tracks' }] };

  let width = input.width, height = input.height;
  if (input.format !== undefined && input.format !== 'custom') {
    const f = FORMATS[input.format];
    if (!f) err('format', `unknown format ${JSON.stringify(input.format)}; use ${Object.keys(FORMATS).join(', ')} or give width and height`);
    else { width = f.width; height = f.height; }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 3840 || height > 3840 || width % 2 || height % 2) err('format', 'width and height must be even integers between 16 and 3840 (or use a named format)');

  const fps = input.fps ?? 30;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) err('fps', 'fps must be an integer between 1 and 60');
  const duration = input.duration;
  if (!num(duration) || duration <= 0 || duration > MAX_CLIP_SECONDS) err('duration', `duration must be a number of seconds between 0 and ${MAX_CLIP_SECONDS}`);
  const background = input.background ?? '#000000';
  if (!isColor(background)) err('background', 'background must be a CSS color');
  const seed = input.seed ?? 1;
  if (!Number.isInteger(seed)) err('seed', 'seed must be an integer');

  const ids = new Set();
  const tracks = [];
  if (!Array.isArray(input.tracks)) err('tracks', 'tracks must be an array');
  else input.tracks.forEach((tr, ti) => {
    const tp = `tracks[${ti}]`;
    if (!isPlain(tr)) return err(tp, 'a track is an object with type and items');
    const type = tr.type ?? 'visual';
    if (!TRACK_TYPES.includes(type)) err(`${tp}.type`, `track type must be one of ${TRACK_TYPES.join(', ')}`);
    const track = { id: typeof tr.id === 'string' && tr.id ? tr.id : `track-${ti + 1}`, name: typeof tr.name === 'string' ? tr.name : undefined, type, hidden: tr.hidden ? true : undefined, items: [] };
    if (!Array.isArray(tr.items)) { err(`${tp}.items`, 'items must be an array'); tracks.push(track); return; }
    tr.items.forEach((it, ii) => {
      const ip = `${tp}.items[${ii}]`;
      if (!isPlain(it)) return err(ip, 'an item is an object with asset, start, duration and params');
      let id = typeof it.id === 'string' && it.id ? it.id : `${track.id}-${ii + 1}`;
      if (ids.has(id)) { err(`${ip}.id`, `duplicate item id "${id}"`); id = `${id}-${ti}-${ii}`; }
      ids.add(id);
      if (typeof it.asset !== 'string' || !REF_RE.test(it.asset)) err(`${ip}.asset`, 'asset must be a reference such as "text-word-reveal" or "text-word-reveal@2"');
      const start = it.start ?? 0;
      if (!num(start) || start < 0) err(`${ip}.start`, 'start must be a number of seconds ≥ 0');
      const dur = it.duration ?? (num(duration) && num(start) ? duration - start : undefined);
      if (!num(dur) || dur <= 0) err(`${ip}.duration`, 'duration must be a number of seconds > 0');
      else if (num(start) && num(duration) && start + dur > duration + 1e-6) err(ip, `the item ends at ${round(start + dur)}s, after the clip ends (${duration}s)`);
      if (it.params !== undefined && !isPlain(it.params)) err(`${ip}.params`, 'params must be an object');
      const item = { id, asset: it.asset, start: num(start) ? round(start) : 0, duration: num(dur) ? round(dur) : 1, params: isPlain(it.params) ? it.params : {} };
      if (typeof it.label === 'string') item.label = it.label;
      for (const k of ['fadeIn', 'fadeOut']) {
        if (it[k] === undefined) continue;
        if (!num(it[k]) || it[k] < 0) err(`${ip}.${k}`, `${k} must be a number of seconds ≥ 0`); else if (it[k] > 0) item[k] = it[k];
      }
      if (type === 'audio') {
        if (it.gain !== undefined) { if (!num(it.gain) || it.gain < 0 || it.gain > 4) err(`${ip}.gain`, 'gain must be between 0 and 4'); else item.gain = it.gain; }
        if (it.beats !== undefined) item.beats = !!it.beats;
      } else {
        if (it.opacity !== undefined) { if (!num(it.opacity) || it.opacity < 0 || it.opacity > 1) err(`${ip}.opacity`, 'opacity must be between 0 and 1'); else if (it.opacity < 1) item.opacity = it.opacity; }
        if (it.blend !== undefined) { if (!BLEND_MODES.includes(it.blend)) err(`${ip}.blend`, `blend must be one of ${BLEND_MODES.join(', ')}`); else if (it.blend !== 'source-over') item.blend = it.blend; }
        if (it.box !== undefined) {
          const b = it.box;
          if (!isPlain(b) || !['x', 'y', 'width', 'height'].every((k) => num(b[k])) || b.width <= 0 || b.height <= 0) err(`${ip}.box`, 'box is { x, y, width, height } as fractions of the frame (0..1)');
          else item.box = { x: b.x, y: b.y, width: b.width, height: b.height };
        }
      }
      track.items.push(item);
    });
    tracks.push(track);
  });

  let markers;
  if (input.markers !== undefined) {
    if (!Array.isArray(input.markers) || !input.markers.every((m) => isPlain(m) && num(m.t) && m.t >= 0)) err('markers', 'markers must be an array of { t, label }');
    else markers = input.markers.map((m) => ({ t: m.t, label: typeof m.label === 'string' ? m.label : '' }));
  }

  if (errors.length) return { composition: null, errors };
  const composition = { format: formatOf(width, height), width, height, fps, duration, seed, background, tracks };
  if (markers) composition.markers = markers;
  return { composition, errors };
}

/** Every item with its track, in draw order. */
export function* itemsOf(comp) {
  for (const track of comp.tracks) for (const item of track.items) yield { track, item };
}

/** Change a composition's format, keeping everything else (assets re-flow from f.width/f.height/f.safe). */
export function reformat(comp, format) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Unknown format "${format}"`);
  return { ...structuredClone(comp), format, width: f.width, height: f.height };
}

/** SRT text from every item that has a `cues` parameter ([{ start, end, text }], item-relative seconds). */
export function toSrt(comp) {
  const cues = [];
  for (const { item, track } of itemsOf(comp)) {
    if (track.type === 'audio' || !Array.isArray(item.params?.cues)) continue;
    for (const c of item.params.cues) {
      if (!isPlain(c) || !num(c.start) || !num(c.end) || typeof c.text !== 'string') continue;
      cues.push({ start: item.start + c.start, end: Math.min(item.start + c.end, item.start + item.duration), text: c.text.replace(/\*/g, '') });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  const stamp = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
}
