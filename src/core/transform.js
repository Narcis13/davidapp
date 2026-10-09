// Layout of a visual item: its transform, keyframes and per-format overrides. Shared by the
// runtime (Node render and browser preview) and the editor, so the handles drawn on the preview
// are computed by the same code that places the layer.
//
//   item.transform = { space: 'frame' | 'safe', x, y, width, height, anchorX, anchorY, scale, scaleX, scaleY, rotation }
//     x, y, width, height are fractions of the space rectangle (the frame, or its safe zone), so a
//     layout means the same thing in every format. The item draws into a width × height box (its
//     f.width × f.height); the box's anchor point (anchorX, anchorY as fractions of the box) sits at
//     (x, y); the box is scaled and rotated (degrees, clockwise) about the anchor.
//   item.keyframes = { x: [{ t, v, ease }], opacity: […], 'params.size': […] }   t: seconds of the item's own time
//   item.formats = { vertical: { transform, keyframes, params, hidden }, … }      merged over the base in that format

import { parse as parseColor, css as cssColor } from './lib/color.js';
import { safeZone } from './engine.js';
import { isColor } from './schema.js';

export const TRANSFORM_KEYS = ['x', 'y', 'width', 'height', 'anchorX', 'anchorY', 'scale', 'scaleX', 'scaleY', 'rotation'];
export const TRANSFORM_DEFAULTS = Object.freeze({ space: 'frame', x: 0.5, y: 0.5, width: 1, height: 1, anchorX: 0.5, anchorY: 0.5, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 });
export const SPACES = ['frame', 'safe'];
/** Item properties keyframes can drive, besides `params.<name>` for numeric and colour params. */
export const ANIMATABLE = [...TRANSFORM_KEYS, 'opacity'];
export const FORMAT_NAMES = ['vertical', 'horizontal', 'square'];
/** Item fields that only exist in composition v2: an item with none of them is drawn exactly as in v1. */
export const V2_ITEM_FIELDS = ['transform', 'keyframes', 'formats', 'motions', 'effects', 'mask', 'transition', 'offset', 'assetDuration', 'seedId'];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Does this item use anything composition v2 added? */
export const isV2Item = (item) => V2_ITEM_FIELDS.some((k) => item[k] !== undefined);

/** The item as it is laid out in one format: its overrides for that format merged over the base. */
export function forFormat(item, format) {
  const o = item.formats?.[format];
  if (!o) return item;
  const out = { ...item };
  // an override on a v1 item starts from its box (as normalizeComposition does for a box with a transform), not from the full frame
  if (o.transform) out.transform = { ...(item.transform ?? (item.box ? boxToTransform(item.box, o.transform.anchorX ?? 0.5, o.transform.anchorY ?? 0.5) : {})), ...o.transform };
  if (o.keyframes) out.keyframes = { ...(item.keyframes ?? {}), ...o.keyframes };
  if (o.params) out.params = { ...item.params, ...o.params };
  if (o.hidden !== undefined) out.hidden = o.hidden;
  if (o.opacity !== undefined) out.opacity = o.opacity;
  return out;
}

/** The rectangle positions are fractions of: the whole frame, or its safe zone. */
export function spaceRect(space, width, height) {
  if (space === 'safe') { const s = safeZone(width, height); return { x: s.x, y: s.y, width: s.width, height: s.height }; }
  return { x: 0, y: 0, width, height };
}

/** A legacy `box` ({ x, y, width, height } fractions of the frame) as transform fields. */
export function boxToTransform(box, anchorX = 0.5, anchorY = 0.5) {
  return { x: box.x + box.width * anchorX, y: box.y + box.height * anchorY, width: box.width, height: box.height };
}

const isColorValue = (v) => typeof v === 'string';
/** A keyframe colour is what a colour param accepts, with every channel a number: parseColor alone reads "#zzzzzz" as NaN without throwing. */
const parsesAsColor = (v) => { try { return isColor(v) && parseColor(v).every(Number.isFinite); } catch { return false; } };

/**
 * The value of a keyframed property at item time t. Before the first key it holds the first value,
 * after the last it holds the last. A key's `ease` shapes the segment that leaves it.
 * @param {{ t: number, v: any, ease?: string }[]} keys sorted by t
 * @param {number} t
 * @param {(name: string) => (x: number) => number} ease
 */
export function sampleKeys(keys, t, ease) {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const name = a.ease ?? 'linear';
  if (name === 'hold') return a.v;
  const x = (t - a.t) / (b.t - a.t);
  const k = name === 'linear' ? x : ease(name)(x);
  if (isColorValue(a.v)) {
    const A = parseColor(a.v), B = parseColor(b.v);
    return cssColor([0, 1, 2, 3].map((c) => A[c] + (B[c] - A[c]) * k));
  }
  return a.v + (b.v - a.v) * k;
}

/** Does any keyframe use a curve that has to come from the easing asset? */
export function needsEasing(item) {
  const all = [item.keyframes, ...Object.values(item.formats ?? {}).map((o) => o?.keyframes)];
  for (const kf of all) for (const keys of Object.values(kf ?? {})) for (const k of keys) if (k.ease && k.ease !== 'linear' && k.ease !== 'hold') return true;
  return false;
}

/**
 * An item's animated state at item time lt: the full transform (defaults filled), opacity, and
 * params with keyframed values applied.
 * @param {any} item already merged for the format (forFormat)
 * @param {number} lt
 * @param {(name: string) => (x: number) => number} ease
 */
export function sampleItem(item, lt, ease) {
  // a v1 item drawn through this path (a transition's outgoing layer) keeps its box
  const transform = { ...TRANSFORM_DEFAULTS, ...(item.transform ?? (item.box ? boxToTransform(item.box) : {})) };
  let opacity = item.opacity ?? 1;
  let params = item.params ?? {};
  const kf = item.keyframes;
  if (kf) {
    let copied = false;
    for (const [prop, keys] of Object.entries(kf)) {
      if (!keys?.length) continue;
      const v = sampleKeys(keys, lt, ease);
      if (prop === 'opacity') opacity = v;
      else if (prop.startsWith('params.')) {
        if (!copied) { params = { ...params }; copied = true; }
        params[prop.slice(7)] = v;
      } else transform[prop] = v;
    }
  }
  return { transform, opacity: Math.min(1, Math.max(0, opacity)), params };
}

/**
 * Where a layer goes in a frame of width × height. Returns the box size (what the asset sees as
 * f.width × f.height), whether it is the whole frame, and the matrix [a, b, c, d, e, f] that maps
 * box coordinates to frame pixels (the same arguments as ctx.transform).
 */
export function layerGeometry(transform, width, height) {
  const t = { ...TRANSFORM_DEFAULTS, ...transform };
  const R = spaceRect(t.space, width, height);
  const w = t.width * R.width, h = t.height * R.height;
  const px = R.x + t.x * R.width, py = R.y + t.y * R.height;
  const sx = t.scale * t.scaleX, sy = t.scale * t.scaleY;
  const r = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  // translate(px, py) · rotate(r) · scale(sx, sy) · translate(-ax·w, -ay·h)
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  const ox = -t.anchorX * w, oy = -t.anchorY * h;
  const matrix = [a, b, c, d, px + a * ox + c * oy, py + b * ox + d * oy];
  const full = t.space === 'frame' && w === width && h === height;
  return { width: w, height: h, matrix, full, space: R, anchor: { x: px, y: py } };
}

/** Apply a matrix to a point. */
export const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** The inverse of a matrix (frame pixels → box coordinates), or null when it is degenerate. */
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** The four corners of a layer's box in frame pixels (top-left, top-right, bottom-right, bottom-left). */
export function corners(geo) {
  const m = geo.matrix;
  return [apply(m, 0, 0), apply(m, geo.width, 0), apply(m, geo.width, geo.height), apply(m, 0, geo.height)];
}

/** Validate a transform object; returns [path, message] problems. */
export function checkTransform(t, path) {
  const out = [];
  if (!isPlain(t)) return [[path, 'transform is an object such as { x: 0.5, y: 0.5, width: 1, height: 1, scale: 1, rotation: 0 }']];
  for (const k of Object.keys(t)) {
    if (k === 'space') { if (!SPACES.includes(t.space)) out.push([`${path}.space`, `space must be one of ${SPACES.join(', ')}`]); continue; }
    if (!TRANSFORM_KEYS.includes(k)) { out.push([`${path}.${k}`, `unknown transform field (use space, ${TRANSFORM_KEYS.join(', ')})`]); continue; }
    if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) out.push([`${path}.${k}`, `${k} must be a finite number`]);
    else if ((k === 'width' || k === 'height') && t[k] <= 0) out.push([`${path}.${k}`, `${k} must be greater than 0 (a fraction of the ${t.space === 'safe' ? 'safe zone' : 'frame'})`]);
  }
  return out;
}

/**
 * A word anchor: { item (the narration item's id), word (the script word's index), edge: start | end, offset (seconds) }.
 * The studio resolves it to a time when the clip is saved; returns [path, message] problems.
 */
export function checkAnchor(a, path) {
  if (!isPlain(a)) return [[path, 'an anchor is { item (narration item id), word (word index), edge: start|end, offset }']];
  const out = [];
  if (typeof a.item !== 'string' || !a.item) out.push([`${path}.item`, 'item is the id of the narration item on the clip']);
  if (!Number.isInteger(a.word) || a.word < 0) out.push([`${path}.word`, 'word is the index of the word in the narration\'s script (0 is the first)']);
  if (a.edge !== undefined && !['start', 'end'].includes(a.edge)) out.push([`${path}.edge`, 'edge is start or end (of the word)']);
  if (a.offset !== undefined && (typeof a.offset !== 'number' || !Number.isFinite(a.offset) || Math.abs(a.offset) > 30)) out.push([`${path}.offset`, 'offset is seconds from the word (−30–30)']);
  for (const k of Object.keys(a)) if (!['item', 'word', 'edge', 'offset'].includes(k)) out.push([`${path}.${k}`, 'unknown anchor field (use item, word, edge, offset)']);
  return out;
}

/** Validate keyframes; returns [path, message] problems and the keys sorted by time. */
export function checkKeyframes(kf, path) {
  const out = [];
  if (!isPlain(kf)) return { problems: [[path, 'keyframes is an object mapping a property to [{ t, v, ease }]']], keyframes: null };
  const sorted = {};
  for (const [prop, keys] of Object.entries(kf)) {
    const p = `${path}.${prop}`;
    if (!ANIMATABLE.includes(prop) && !/^params\.[A-Za-z_][A-Za-z0-9_]*$/.test(prop)) { out.push([p, `cannot animate "${prop}" (use ${ANIMATABLE.join(', ')} or params.<name>)`]); continue; }
    if (!Array.isArray(keys) || !keys.length) { out.push([p, 'keyframes for a property are a non-empty array of { t, v, ease }']); continue; }
    const list = [];
    keys.forEach((k, i) => {
      if (!isPlain(k) || typeof k.t !== 'number' || !Number.isFinite(k.t) || k.t < 0) return out.push([`${p}[${i}].t`, 't must be a number of seconds ≥ 0 (item time)']);
      const colour = prop.startsWith('params.') && typeof k.v === 'string';
      if (!colour && (typeof k.v !== 'number' || !Number.isFinite(k.v))) return out.push([`${p}[${i}].v`, prop.startsWith('params.') ? 'v must be a number or a colour' : 'v must be a number']);
      if (colour && !parsesAsColor(k.v)) return out.push([`${p}[${i}].v`, `${JSON.stringify(k.v)} is not a colour`]);
      if (k.ease !== undefined && (typeof k.ease !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(k.ease))) return out.push([`${p}[${i}].ease`, 'ease is the name of a curve from the easing asset (outCubic, outBack…), linear or hold']);
      const key = k.ease === undefined ? { t: k.t, v: k.v } : { t: k.t, v: k.v, ease: k.ease };
      if (k.anchor !== undefined) { const pr = checkAnchor(k.anchor, `${p}[${i}].anchor`); if (pr.length) return out.push(...pr); key.anchor = k.anchor; }
      list.push(key);
    });
    list.sort((a, b) => a.t - b.t);
    if (list.length && list.some((k) => typeof k.v !== typeof list[0].v)) out.push([p, 'all keyframes of a property must be numbers, or all colours']);
    if ((prop === 'width' || prop === 'height') && list.some((k) => k.v <= 0)) out.push([p, `${prop} keyframes must be greater than 0`]);
    sorted[prop] = list;
  }
  return { problems: out, keyframes: sorted };
}
