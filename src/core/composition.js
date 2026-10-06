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
import { FORMAT_NAMES, boxToTransform, checkKeyframes, checkTransform } from './transform.js';

export const TRACK_TYPES = ['visual', 'text', 'audio'];
export const BLEND_MODES = ['source-over', 'screen', 'multiply', 'overlay', 'lighter', 'soft-light', 'difference'];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export const MOTION_PHASES = ['in', 'out', 'emphasis', 'loop'];
export const MASK_MODES = ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'];

/**
 * An asset attached to an item, a track or the clip (a motion, an effect, a transition, a mask):
 * { asset, params, …extra }. Returns the normalized attachment, or null after reporting problems.
 */
function attachment(a, path, err, extra = {}) {
  if (!isPlain(a)) { err(path, 'an attachment is an object such as { asset: "fx-glow", params: {} }'); return null; }
  if (typeof a.asset !== 'string' || !REF_RE.test(a.asset)) { err(`${path}.asset`, 'asset must be a reference such as "fx-glow" or "fx-glow@2"'); return null; }
  if (a.params !== undefined && !isPlain(a.params)) { err(`${path}.params`, 'params must be an object'); return null; }
  const out = { asset: a.asset, params: isPlain(a.params) ? a.params : {} };
  for (const [k, check] of Object.entries(extra)) {
    if (a[k] === undefined) continue;
    const problem = check(a[k]);
    if (problem) err(`${path}.${k}`, problem); else out[k] = a[k];
  }
  for (const k of Object.keys(a)) if (!['asset', 'params', ...Object.keys(extra)].includes(k)) err(`${path}.${k}`, `unknown field (use asset, params${Object.keys(extra).map((x) => `, ${x}`).join('')})`);
  return out;
}
const positive = (v) => (num(v) && v > 0 ? null : 'must be a number of seconds > 0');
const effectList = (list, path, err) => {
  if (!Array.isArray(list)) { err(path, 'effects is a list of { asset, params }'); return undefined; }
  const out = list.map((a, i) => attachment(a, `${path}[${i}]`, err)).filter(Boolean);
  return out.length ? out : undefined;
};
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
  else if (Number.isInteger(fps) && Math.round(duration * fps) < 1) err('duration', 'the clip is shorter than one frame');
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
    // editor flags (v2): only written when set, so a v1 track normalizes to exactly what it was
    for (const k of ['locked', 'solo', 'muted']) if (tr[k]) track[k] = true;
    // an effect on a track processes everything on it, like an adjustment layer
    if (tr.effects !== undefined) { if (type === 'audio') err(`${tp}.effects`, 'an audio track takes no effects'); else { const fx = effectList(tr.effects, `${tp}.effects`, err); if (fx) track.effects = fx; } }
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
      for (const k of ['offset', 'assetDuration']) {
        if (it[k] === undefined) continue;
        if (!num(it[k]) || it[k] < 0 || (k === 'assetDuration' && it[k] <= 0)) err(`${ip}.${k}`, k === 'offset' ? 'offset is seconds into the asset where the item starts (≥ 0)' : 'assetDuration is the length of the asset timeline the item is cut from (> 0)');
        else item[k] = round(it[k]);
      }
      if (item.assetDuration !== undefined && item.assetDuration + 1e-6 < (item.offset ?? 0) + item.duration) err(`${ip}.assetDuration`, `assetDuration (${item.assetDuration}s) is shorter than offset + duration (${round((item.offset ?? 0) + item.duration)}s)`);
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
        if (it.transform !== undefined) {
          const problems = checkTransform(it.transform, `${ip}.transform`);
          for (const [p, m] of problems) err(p, m);
          if (!problems.length) {
            // a box and a transform: the box becomes the transform's starting geometry
            if (item.box && it.transform.space === 'safe') err(`${ip}.box`, 'box is in frame fractions; with transform.space "safe" give the geometry in the transform instead');
            const base = item.box ? boxToTransform(item.box, it.transform.anchorX ?? 0.5, it.transform.anchorY ?? 0.5) : {};
            delete item.box;
            item.transform = { ...base, ...it.transform };
          }
        }
        if (it.keyframes !== undefined) {
          const { problems, keyframes } = checkKeyframes(it.keyframes, `${ip}.keyframes`);
          for (const [p, m] of problems) err(p, m);
          if (!problems.length && Object.keys(keyframes).length) item.keyframes = keyframes;
        }
        if (it.formats !== undefined) {
          if (!isPlain(it.formats)) err(`${ip}.formats`, 'formats maps a format name to its overrides: { vertical: { transform, keyframes, params, hidden } }');
          else for (const [fname, o] of Object.entries(it.formats)) {
            const fp = `${ip}.formats.${fname}`;
            if (!FORMAT_NAMES.includes(fname)) { err(fp, `unknown format (use ${FORMAT_NAMES.join(', ')})`); continue; }
            if (!isPlain(o)) { err(fp, 'an override is an object: { transform, keyframes, params, hidden, opacity }'); continue; }
            const out = {};
            for (const k of Object.keys(o)) if (!['transform', 'keyframes', 'params', 'hidden', 'opacity'].includes(k)) err(`${fp}.${k}`, 'unknown override (use transform, keyframes, params, hidden, opacity)');
            if (o.transform !== undefined) { const pr = checkTransform(o.transform, `${fp}.transform`); for (const [p, m] of pr) err(p, m); if (!pr.length) out.transform = { ...o.transform }; }
            if (o.keyframes !== undefined) { const r = checkKeyframes(o.keyframes, `${fp}.keyframes`); for (const [p, m] of r.problems) err(p, m); if (!r.problems.length) out.keyframes = r.keyframes; }
            if (o.params !== undefined) { if (!isPlain(o.params)) err(`${fp}.params`, 'params must be an object'); else out.params = o.params; }
            if (o.hidden !== undefined) out.hidden = !!o.hidden;
            if (o.opacity !== undefined) { if (!num(o.opacity) || o.opacity < 0 || o.opacity > 1) err(`${fp}.opacity`, 'opacity must be between 0 and 1'); else out.opacity = o.opacity; }
            if (Object.keys(out).length) (item.formats ??= {})[fname] = out;
          }
        }
        if (it.motions !== undefined) {
          if (!Array.isArray(it.motions)) err(`${ip}.motions`, 'motions is a list of { asset, phase, duration, at, params }');
          else {
            const list = it.motions.map((m, mi) => attachment(m, `${ip}.motions[${mi}]`, err, {
              phase: (v) => (MOTION_PHASES.includes(v) ? null : `phase must be one of ${MOTION_PHASES.join(', ')}`),
              duration: positive,
              at: (v) => (num(v) && v >= 0 ? null : 'at is the item time (seconds) an emphasis starts'),
            })).filter(Boolean);
            if (list.length) item.motions = list;
          }
        }
        if (it.effects !== undefined) { const fx = effectList(it.effects, `${ip}.effects`, err); if (fx) item.effects = fx; }
        if (it.mask !== undefined) {
          const m = attachment(it.mask, `${ip}.mask`, err, {
            mode: (v) => (MASK_MODES.includes(v) ? null : `mode must be one of ${MASK_MODES.join(', ')}`),
            transform: (v) => checkTransform(v, `${ip}.mask.transform`).map((x) => x[1]).join('; ') || null,
          });
          if (m) item.mask = m;
        }
        if (it.transition !== undefined) {
          const tr2 = attachment(it.transition, `${ip}.transition`, err, { duration: positive });
          if (tr2) item.transition = tr2;
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

  let effects;
  if (input.effects !== undefined) effects = effectList(input.effects, 'effects', err);
  let easing;
  if (input.easing !== undefined) {
    if (typeof input.easing !== 'string' || !REF_RE.test(input.easing)) err('easing', 'easing is the reference of the easing asset keyframes take their curves from, e.g. "easing@1"');
    else easing = input.easing;
  }

  if (errors.length) return { composition: null, errors };
  const composition = { format: formatOf(width, height), width, height, fps, duration, seed, background, tracks };
  if (markers) composition.markers = markers;
  if (easing) composition.easing = easing;
  if (effects) composition.effects = effects;
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
