// A render worker thread. It owns one asset runtime (compiled from the bundle it was last given)
// and answers requests for frames, contact sheets, audio and asset validation. Asset code only
// ever runs here, inside vm contexts; the pool kills the thread if a request overruns its timeout.

import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRuntime, describeError } from '../core/runtime.js';
import { normalizeLog, replay, stepsToLog, summary, initialState, advance, applyInput, viewOf, inside, parseOn } from '../core/interactive.js';
import { FORMATS, SAMPLE_RATE } from '../core/engine.js';
import { hashSeed } from '../core/rng.js';
import { fontAliases } from '../core/lib/text.js';
import { nodeHost, registerFonts, registerFontSets, createCanvas, loadImage, takeLogs, FRAME_CONTEXT } from './host.js';
import { ImageData } from '@napi-rs/canvas';
import { coverageReport } from './glyphs.js';
import { boxContrast, thumbGray, grayStd } from './contrast.js';

registerFonts();

let state = { key: null, rt: null, comp: null, beats: [], sequences: {}, videos: {}, clip: {}, fonts: null };
let canvas = null;

// Sequence frames are PNG files, loaded as a frame needs them and kept in a small cache.
const seqCache = new Map();
const SEQ_CACHE = 96;

// Footage frames come decoded (RGBA) from the process's footage service, through the pool: one decoder per file
// for every worker, instead of one per worker. A few are kept here, drawn on canvases, for holds and slow motion.
const vidCache = new Map();
const VID_CACHE = 6;
const asked = new Map();
let askId = 0;
/** Ask the pool's thread for one decoded footage frame → { buffer, width, height }. */
const askFrame = (video, index) => new Promise((resolve, reject) => {
  const id = ++askId;
  asked.set(id, { resolve, reject });
  parentPort.postMessage({ footage: { id, path: video.path, meta: video.meta, index } });
});

async function makeRuntime(bundle) {
  const rt = createRuntime(nodeHost);
  for (const [ref, img] of Object.entries(bundle.images ?? {})) rt.setImage(ref, await loadImage(img.path), img.vector);
  for (const [ref, s] of Object.entries(bundle.sequences ?? {})) {
    rt.setSequence(ref, { frames: s.frames, fps: s.fps, width: s.width, height: s.height, dir: s.dir, get: (i) => seqCache.get(`${ref}#${i}`) ?? null });
  }
  for (const [ref, v] of Object.entries(bundle.videos ?? {})) rt.setFootage(ref, { meta: v.meta, get: (i) => vidCache.get(`${v.path}#${i}`) ?? null });
  rt.load(bundle.assets ?? {});
  return rt;
}

/** Load the sequence frames a clip frame needs before it is drawn. */
async function loadSequenceFrames(rt, comp, frame) {
  for (const { ref, index } of rt.sequenceFramesAt(comp, frame)) {
    const key = `${ref}#${index}`;
    if (seqCache.has(key)) { const v = seqCache.get(key); seqCache.delete(key); seqCache.set(key, v); continue; }
    const s = state.sequences[ref];
    seqCache.set(key, await loadImage(join(s.dir, `${String(index).padStart(6, '0')}.png`)));
    while (seqCache.size > SEQ_CACHE) seqCache.delete(seqCache.keys().next().value);
  }
}

/** Decode (through the pool) the footage frames a clip frame needs before it is drawn. */
async function loadFootageFrames(rt, frame) {
  const comp = state.comp;
  // every frame this clip frame draws stays until it is drawn, however many there are; older ones go first
  const needed = new Set();
  for (const { ref, index } of rt.footageFramesAt(comp, frame)) {
    const v = state.videos[ref];
    const key = `${v.path}#${index}`;
    needed.add(key);
    if (vidCache.has(key)) { const c = vidCache.get(key); vidCache.delete(key); vidCache.set(key, c); continue; }
    const r = await askFrame(v, index);
    const c = createCanvas(r.width, r.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.buffer), r.width, r.height), 0, 0);
    vidCache.set(key, c);
  }
  for (const key of vidCache.keys()) {
    if (vidCache.size <= VID_CACHE) break;
    if (!needed.has(key)) vidCache.delete(key);
  }
}

/** Everything a clip frame loads before it is drawn: sequence frames (files) and footage frames (decoded). */
async function loadMedia(rt, comp, frame) {
  await loadSequenceFrames(rt, comp, frame);
  await loadFootageFrames(rt, frame);
}

function surface(width, height) {
  if (!canvas || canvas.width !== width || canvas.height !== height) canvas = createCanvas(width, height);
  return canvas;
}
let bare = null;
/** A second canvas: the same frame drawn without its text, to measure contrast against. */
function bareSurface(width, height) {
  if (!bare || bare.width !== width || bare.height !== height) bare = createCanvas(width, height);
  return bare;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function raw(c) {
  const data = c.data();
  const ab = new ArrayBuffer(data.length);
  new Uint8Array(ab).set(data);
  return ab;
}

/** PNG of the canvas, scaled down so its longer side is at most maxSize. */
function png(c, maxSize) {
  const long = Math.max(c.width, c.height);
  if (!maxSize || long <= maxSize) return c.toBuffer('image/png');
  const k = maxSize / long;
  const small = createCanvas(Math.round(c.width * k), Math.round(c.height * k));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(c, 0, 0, small.width, small.height);
  return small.toBuffer('image/png');
}

function output(c, msg) {
  if (msg.output === 'none') return { result: { hash: msg.hash ? sha(c.data()) : undefined, width: c.width, height: c.height } };
  if (msg.output === 'raw') {
    const buffer = raw(c);
    return { result: { buffer, hash: msg.hash ? sha(new Uint8Array(buffer)) : undefined, width: c.width, height: c.height }, transfer: [buffer] };
  }
  const out = { png: png(c, msg.maxSize), width: c.width, height: c.height };
  if (msg.hash) out.hash = sha(c.data());
  return { result: out };
}

function isBlank(c) {
  const d = c.data();
  for (let i = 3; i < d.length; i += 4 * 37) if (d[i] !== 0) return false;
  return true;
}

function drawAsset(rt, ref, o) {
  const c = surface(o.width, o.height);
  rt.renderAsset(c.getContext('2d', FRAME_CONTEXT), ref, o.params ?? {}, o);
  return c;
}

/** A grid of scaled-down frames with a time label on each. cells: [{ label, draw() → canvas }]. */
function sheet(cells, { cols, cellWidth, width, height }) {
  const cw = cellWidth, ch = Math.round((cellWidth * height) / width);
  const rows = Math.ceil(cells.length / cols);
  const gap = 6, pad = 8;
  const out = createCanvas(pad * 2 + cols * cw + (cols - 1) * gap, pad * 2 + rows * ch + (rows - 1) * gap);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#16161d';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  cells.forEach((cell, i) => {
    const x = pad + (i % cols) * (cw + gap), y = pad + Math.floor(i / cols) * (ch + gap);
    ctx.drawImage(cell.draw(), x, y, cw, ch);
    ctx.font = '600 13px "JetBrains Mono"';
    const tw = ctx.measureText(cell.label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x, y, tw + 10, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(cell.label, x + 5, y + 15);
  });
  return out;
}

const metaOf = (def) => JSON.parse(JSON.stringify({ kind: def.kind, title: def.title, description: def.description, tags: def.tags, duration: def.duration, formats: def.formats, schema: def.schema, uses: def.uses, events: def.events ?? undefined }));

/** Compile unsaved source, check it and render test frames. Throws with a useful message when it fails. */
async function validate(msg) {
  const rt = await makeRuntime({ assets: msg.assets, images: msg.images });
  rt.load({ [msg.ref]: { source: msg.source, deps: msg.deps ?? {} } });
  const def = rt.definition(msg.ref);
  const meta = metaOf(def);
  if (msg.inspectOnly) return { result: { meta } };
  const warnings = [];
  const frames = [];
  const params = msg.params ?? {};
  const seed = 1;
  let thumb, strip = null;
  // what the test frames draw as text: characters the bundled fonts lack are flagged
  const drawnTexts = [];
  if (def.kind === 'visual') {
    const duration = msg.duration ?? def.duration ?? 3;
    const fps = 30;
    const order = ['horizontal', 'vertical', 'square'].filter((f) => def.formats.includes(f)).slice(0, 2);
    for (const format of order) {
      const { width, height } = FORMATS[format];
      const o = { params, duration, width, height, fps, seed };
      const mid = Math.round(duration * 0.5 * fps) / fps;
      let midHash = null, blank = true;
      for (const t of [0, mid, Math.max(0, duration - 1 / fps)]) {
        const t0 = performance.now();
        const c = drawAsset(rt, msg.ref, { ...o, t, record: true });
        const ms = performance.now() - t0;
        drawnTexts.push(...rt.takeTexts());
        const hash = sha(c.data());
        if (t === mid) midHash = hash;
        if (!isBlank(c)) blank = false;
        frames.push({ format, t, ms: Math.round(ms * 10) / 10 });
        if (ms > 250) warnings.push(`${format} frame at t=${t}s took ${Math.round(ms)}ms to draw; long clips will render slowly`);
      }
      // the same (t, params) must give the same pixels, whatever was drawn in between
      const again = sha(drawAsset(rt, msg.ref, { ...o, t: mid }).data());
      if (again !== midHash) throw new Error(`Not deterministic: drawing t=${mid}s twice (${format}) gave different pixels. A frame must depend only on f.t, the params and f.rng; do not keep state between calls.`);
      if (blank) warnings.push(`all ${format} test frames are blank with the default parameters`);
      if (!thumb) {
        const c = createCanvas(width, height);
        rt.renderAsset(c.getContext('2d', FRAME_CONTEXT), msg.ref, params, { ...o, t: Math.round(duration * (msg.thumbAt ?? 0.6) * fps) / fps, background: '#101018' });
        thumb = png(c, 640);
        strip = filmstrip(rt, msg.ref, params, { width, height, duration });
      }
    }
  } else if (def.kind === 'motion') {
    // a motion is called at the start, middle and end of each phase; it must return a delta, the same every time
    const duration = def.duration ?? 0.6;
    for (const phase of ['in', 'out', 'emphasis', 'loop']) {
      for (const t of [0, duration / 2, duration]) {
        const a = rt.callMotion(msg.ref, params, { phase, t, duration, seed });
        const b = rt.callMotion(msg.ref, params, { phase, t, duration, seed });
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Not deterministic: the ${phase} motion at t=${t}s returned different deltas on two calls. Use f.t, the params and f.rng only.`);
        frames.push({ format: phase, t, delta: a });
      }
    }
    const rest = rt.callMotion(msg.ref, params, { phase: 'in', t: duration, duration, seed });
    if (Object.entries(rest).some(([k, v]) => (['x', 'y', 'rotation'].includes(k) ? Math.abs(v) > 0.5 : Math.abs(v - 1) > 0.01))) warnings.push(`at the end of its "in" phase the motion returns ${JSON.stringify(rest)}, not rest (x, y, rotation 0; scale, opacity 1): the item will jump when the motion ends`);
    thumb = demoThumb(rt, msg.ref, params, Math.round(duration * 0.5 * 30) / 30, 3);
    strip = filmstrip(rt, msg.ref, params, { ...FORMATS.horizontal, duration: 3 });
  } else if (def.kind === 'transition' || def.kind === 'effect') {
    const duration = def.duration ?? 1;
    const { width, height } = FORMATS.horizontal;
    const o = { params, duration, width, height, fps: 30, seed, background: '#101018' };
    let midHash = null, blank = true;
    const mid = Math.round(duration * 0.5 * 30) / 30;
    for (const t of [0, mid, Math.max(0, duration - 1 / 30)]) {
      const t0 = performance.now();
      const c = drawAsset(rt, msg.ref, { ...o, t });
      const ms = performance.now() - t0;
      frames.push({ format: 'horizontal', t, ms: Math.round(ms * 10) / 10 });
      if (t === mid) midHash = sha(c.data());
      if (!isBlank(c)) blank = false;
      if (ms > 400) warnings.push(`a 1920×1080 frame at t=${t}s took ${Math.round(ms)}ms; long clips will render slowly`);
    }
    if (sha(drawAsset(rt, msg.ref, { ...o, t: mid }).data()) !== midHash) throw new Error(`Not deterministic: drawing t=${mid}s twice gave different pixels. A frame must depend only on f.t, the params, f.rng and the layers it is given.`);
    if (blank) warnings.push(`the ${def.kind} draws nothing with the default parameters`);
    thumb = demoThumb(rt, msg.ref, params, mid, duration);
    strip = filmstrip(rt, msg.ref, params, { ...FORMATS.horizontal, duration });
  } else if (def.kind === 'value') {
    const value = rt.callValue(msg.ref, params);
    if (value === undefined) warnings.push('render() returned undefined with the default parameters');
    thumb = png(drawAsset(rt, msg.ref, { params, t: 0, duration: 3, width: 1280, height: 720, seed }), 640);
  } else {
    const duration = Math.min(msg.duration ?? def.duration ?? 2, 8);
    const a = rt.renderAudio(msg.ref, params, { duration, seed });
    const b = rt.renderAudio(msg.ref, params, { duration, seed });
    const h = (x) => sha(new Uint8Array(x.left.buffer, x.left.byteOffset, x.left.byteLength));
    if (h(a) !== h(b)) throw new Error('Not deterministic: synthesizing twice gave different samples. Use f.rng() for noise.');
    let peak = 0;
    for (let i = 0; i < a.left.length; i++) peak = Math.max(peak, Math.abs(a.left[i]));
    if (peak < 0.001) warnings.push('the audio is silent with the default parameters');
    if (peak > 1) warnings.push(`the audio peaks at ${peak.toFixed(2)} (above 1.0) and will clip`);
    frames.push({ format: 'audio', t: 0, peak: Math.round(peak * 1000) / 1000 });
    thumb = png(drawAsset(rt, msg.ref, { params, t: 0, duration, width: 1280, height: 720, seed }), 640);
  }
  for (const g of coverageReport(drawnTexts.filter((x) => x.family).map((x) => ({ text: x.text, family: x.family })))) {
    warnings.push(`${g.char} (${g.codepoints.join(' ')}) is not in ${g.family}: it falls back to a system font (in "${g.samples[0]}")`);
  }
  return { result: { meta, warnings, frames, thumb, strip, logs: takeLogs() } };
}

/** Eight frames across the asset's duration in one row (240 px cells): the library's hover preview. */
function filmstrip(rt, ref, params, { width, height, duration }) {
  const n = 8, cw = 240, ch = Math.round((cw * height) / width);
  const out = createCanvas(cw * n, ch);
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const c = createCanvas(width, height);
  for (let i = 0; i < n; i++) {
    const t = Math.round(((i + 0.5) / n) * duration * 30) / 30;
    rt.renderAsset(c.getContext('2d', FRAME_CONTEXT), ref, params, { params, t, duration, width, height, fps: 30, seed: 1, background: '#101018' });
    g.drawImage(c, i * cw, 0, cw, ch);
  }
  return out.toBuffer('image/png');
}

/** The playground's demo of a motion, transition or effect as a 640px thumbnail. */
function demoThumb(rt, ref, params, t, duration) {
  const { width, height } = FORMATS.horizontal;
  const c = createCanvas(width, height);
  rt.renderAsset(c.getContext('2d', FRAME_CONTEXT), ref, params, { params, t, duration, width, height, fps: 30, seed: 1, background: '#101018' });
  return png(c, 640);
}

// ── interactive clips: the checks' views of a session ───────────────────────────────────────────

/** Seconds a state is left to settle before it is drawn and acted on: the animations of a scene or of a change have run out. */
const SETTLE = 1.5;

/** Did drawing fail because a text cannot fit at its size floor? (check_clip reports that as an issue, not as a failed check) */
const isFloorError = (e) => /^TextFloorError\b/.test(String(e?.stack ?? '')) || /\bTextFloorError:/.test(String(e?.message ?? ''));

/**
 * One view of an interactive clip as the checks measure it: a session state (view = viewOf(…)) or, without a `ui`, the
 * design timeline with the variables at their first values. → { texts (each with its contrast), regions, std (spread of the greys) }.
 */
async function measureView(comp, view, contrast) {
  await loadMedia(state.rt, comp, view.frame);
  const c = surface(comp.width, comp.height);
  const extra = { ...state.clip, ...(view.ui ? { ui: view.ui } : {}) };
  const r = state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, view.frame, { ...extra, record: true });
  const a = new Uint8Array(c.data());
  if (contrast && r.texts.length) {
    const b2 = bareSurface(comp.width, comp.height);
    state.rt.renderClipFrame(b2.getContext('2d', FRAME_CONTEXT), comp, view.frame, { ...extra, suppressText: true });
    const b = new Uint8Array(b2.data());
    for (const t of r.texts) t.contrast = boxContrast(a, b, comp.width, comp.height, t.box, { fill: t.fill });
  }
  return { texts: r.texts, regions: r.regions ?? [], std: grayStd(thumbGray(a, comp.width, comp.height)) };
}

/** The topmost region at a frame-pixel point (the last drawn is in front), as applyInput reads a press. */
function topmost(regions, x, y) {
  for (let i = regions.length - 1; i >= 0; i--) if (inside(regions[i], x, y)) return regions[i];
  return null;
}

/** A point of region r in frame pixels, from fractions of its own rectangle. */
function place(r, u, v) {
  const [a, b, c, d, e, f] = r.m;
  const lx = r.x + r.w * u, ly = r.y + r.h * v;
  return { x: a * lx + c * ly + e, y: b * lx + d * ly + f };
}

/**
 * Where a viewer can press region r so that r gets the press: its middle, else the first of a few other points that no
 * region in front covers. A range region is pressed at its minimum or maximum end. → { x, y } or null (covered all over).
 */
function spot(regions, r, end = null) {
  const here = (p) => topmost(regions, p.x, p.y)?.key === r.key;
  let candidates;
  if (r.range) {
    // u runs along the axis from the minimum (0) to the maximum (1); start at the very end, then a little inside it
    // (a point on the edge may fall just outside the region)
    const along = (u) => (r.range.axis === 'y' ? place(r, 0.5, 1 - u) : place(r, u, 0.5));
    candidates = (end === 'max' ? [1, 0.999, 0.98] : [0, 0.001, 0.02]).map(along);
  } else {
    candidates = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5]].map(([u, v]) => place(r, u, v));
  }
  return candidates.find(here) ?? null;
}

/** A point of the frame that no region covers (a press there is a `tap` event), or null. */
function freeSpot(regions, width, height) {
  for (let j = 1; j < 12; j++) for (let i = 1; i < 12; i++) {
    const x = (width * i) / 12, y = (height * j) / 12;
    if (!topmost(regions, x, y)) return { x, y };
  }
  return null;
}

/** A press and release at a point, stamped with session frame n. */
const pressAt = (n, p) => ['move', 'down', 'up'].map((type) => ({ f: n, type, x: p.x, y: p.y, pointer: 'mouse' }));

/**
 * A state at rest: its scene entered at frame 0 and observed after the settling time (or just before the scene ends), with
 * every animation of what the viewer did run out. The crawl keeps states in this form, so that how a state was reached (and
 * how quickly) does not decide how it is drawn, and a scene is never over before the crawl has acted in it.
 */
function atRest(comp, s, settleFrames) {
  const scene = comp.interactive.scenes.find((x) => x.id === s.scene);
  const len = Math.max(1, Math.round(scene.duration * comp.fps));
  const out = structuredClone(s);
  Object.assign(out, { entered: 0, f: Math.max(0, Math.min(settleFrames, len - 2)), ended: false, tx: null, pointer: null, capture: null, hover: null });
  for (const x of Object.values(out.changed)) x.f = 0;
  for (const k of Object.keys(out.pressed)) out.pressed[k] = 0;
  for (const box of Object.values(out.inbox)) for (const x of Object.values(box)) x.f = 0;
  for (const x of out.sounds) x.f = 0;
  return out;
}

const handlers = {
  async load(msg) {
    takeLogs();
    // the uploaded fonts the bundle pins, each set under its own alias, before anything can draw (no restart needed)
    registerFontSets(msg.bundle.fonts);
    const rt = await makeRuntime(msg.bundle);
    const b = msg.bundle;
    const fonts = fontAliases(b.fonts);
    // what reaches assets as f.clip besides the composition: beats, the narration's words, the caption pages and lane
    state = { key: b.key, rt, comp: b.composition ?? null, beats: b.beats ?? [], sequences: b.sequences ?? {}, videos: b.videos ?? {}, clip: { beats: b.beats ?? [], words: b.words, captions: b.captions, lane: b.lane, ...(fonts ? { fonts } : {}) }, fonts };
    return { result: {} };
  },
  async clipFrame(msg) {
    const comp = state.comp;
    await loadMedia(state.rt, comp, msg.frame);
    const c = surface(comp.width, comp.height);
    const r = state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, msg.frame, { ...state.clip, record: !!msg.record, suppressText: !!msg.suppressText });
    const out = output(c, msg);
    if (r?.texts) out.result.texts = r.texts;
    return out;
  },
  /**
   * A frame measured for the checks: what it draws as text (frame pixels, item, font, size, colour), each text's
   * contrast against the worst pixels behind it (the frame drawn again without text), and a small greyscale copy.
   */
  async inspectFrame(msg) {
    const comp = state.comp;
    await loadMedia(state.rt, comp, msg.frame);
    const c = surface(comp.width, comp.height);
    const r = state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, msg.frame, { ...state.clip, record: true });
    const a = new Uint8Array(c.data());
    const texts = r.texts;
    if (msg.contrast && texts.length) {
      const b2 = bareSurface(comp.width, comp.height);
      state.rt.renderClipFrame(b2.getContext('2d', FRAME_CONTEXT), comp, msg.frame, { ...state.clip, suppressText: true });
      const b = new Uint8Array(b2.data());
      for (const t of texts) t.contrast = boxContrast(a, b, comp.width, comp.height, t.box, { fill: t.fill });
    }
    const thumb = thumbGray(a, comp.width, comp.height);
    return { result: { texts, thumb, std: grayStd(thumb) }, transfer: [thumb.buffer] };
  },
  /**
   * v5: play an interactive clip from an input log or scripted steps (core/interactive.js), as a viewer's browser
   * would, and report the chosen session frames: { frame, playhead, state, hash, png?, regions? }, the log played and
   * the final state. msg: { log | steps, frames, stills, maxSize, regions }.
   */
  async play(msg) {
    const comp = state.comp;
    if (!comp?.interactive) throw new Error('this clip is not interactive: it has no interactive section to play');
    const c = surface(comp.width, comp.height);
    const draw = async (view) => {
      await loadMedia(state.rt, comp, view.frame);
      if (view.transition) await loadMedia(state.rt, comp, view.transition.from);
      return state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, view.frame, { ...state.clip, ui: view.ui, transition: view.transition }).regions;
    };
    const log = msg.steps ? (await stepsToLog(comp, msg.steps, { draw })).log : normalizeLog(msg.log ?? []);
    const frames = [];
    const end = await replay(comp, log, {
      frames: msg.frames ?? [], draw,
      onFrame: async (n, view, s) => {
        const regions = await draw(view);
        frames.push({ frame: n, t: n / comp.fps, playhead: view.frame, state: summary(s), hash: sha(c.data()), ...(msg.stills ? { png: png(c, msg.maxSize) } : {}), ...(msg.regions ? { regions } : {}) });
      },
    });
    return { result: { log, frames, end: summary(end), last: Math.max(0, ...log.map((e) => e.f)) } };
  },
  /**
   * v5: a frame of an interactive clip's design timeline (nobody playing, the variables at their first values) measured for
   * the checks, with the hit regions it draws → { texts (each with its contrast), regions, std }. msg: { frame, contrast }.
   */
  async inspectScene(msg) {
    return { result: await measureView(state.comp, { frame: msg.frame }, msg.contrast) };
  },
  /**
   * v5: crawl the states of an interactive clip. From the first state, each state is drawn at rest and measured, then every
   * way a viewer can leave it is tried: a press on each hit region (a range region at its minimum and at its maximum),
   * each key a wire listens to, a press on nothing when a wire listens to `tap`, and waiting for the scene to end.
   * States are told apart by scene and variables; at most msg.maxStates are visited, breadth first. msg: { maxStates, contrast }.
   * → { states: [{ id, scene, vars, state, frame, playhead, texts, regions, std, occluded: [{ key, by }], error?, floorError? }],
   *     edges: [{ from, action, to }], errors: [{ state, action, message }], truncated, max }
   */
  async explore(msg) {
    const comp = state.comp;
    if (!comp?.interactive) throw new Error('this clip is not interactive: it has no interactive section to explore');
    const I = comp.interactive;
    const max = msg.maxStates ?? 40;
    const settle = Math.round(SETTLE * comp.fps);
    const keyOf = (s) => JSON.stringify([s.scene, s.vars]);
    const nodes = [], index = new Map(), edges = [], errors = [];
    let truncated = false;
    /** The node of a state, new ones appended to the queue; null when the crawl is full. */
    const visit = (s) => {
      const key = keyOf(s);
      let node = index.get(key);
      if (node) return node;
      if (nodes.length >= max) { truncated = true; return null; }
      node = { id: `s${nodes.length}`, scene: s.scene, vars: { ...s.vars }, state: atRest(comp, s, settle) };
      index.set(key, node);
      nodes.push(node);
      return node;
    };
    visit(initialState(comp));
    for (const node of nodes) {
      const s = node.state, n = s.f;
      const view = viewOf(comp, s, n);
      Object.assign(node, { frame: n, playhead: view.frame, occluded: [] });
      let regions = [];
      try {
        const m = await measureView(comp, view, msg.contrast);
        Object.assign(node, m);
        regions = m.regions;
      } catch (e) {
        Object.assign(node, { error: describeError(e), ...(isFloorError(e) ? { floorError: true } : {}) });
      }
      const here = (w) => w.scene === undefined || [].concat(w.scene).includes(s.scene);
      /** Try one thing a viewer can do in this state; the state it leads to is a node too (and a wire that throws is an error). */
      const act = (action, make) => {
        let next;
        try { next = make(); } catch (e) { errors.push({ state: node.id, action, message: e.message }); return; }
        const to = next && visit(next);
        if (to) edges.push({ from: node.id, action, to: to.id });
      };
      for (const r of regions) {
        const name = `${r.item}.${r.name}${r.id !== undefined ? `#${r.id}` : ''}`;
        // a range region is dragged to the end it is not at
        for (const end of r.range ? ['min', 'max'].filter((e) => r.range.value !== r.range[e]) : [null]) {
          const p = spot(regions, r, end);
          if (!p) {
            if (!node.occluded.some((o) => o.key === r.key)) { const mid = place(r, 0.5, 0.5); node.occluded.push({ key: r.key, by: topmost(regions, mid.x, mid.y)?.key ?? null }); }
            continue;
          }
          act(end ? `drag ${name} to ${end}` : `tap ${name}`, () => applyInput(comp, s, n, pressAt(n, p), regions));
        }
      }
      const keys = new Set();
      for (const w of I.wires) {
        const on = parseOn(w.on);
        if (on?.kind === 'key' && here(w)) keys.add(on.key === 'any' ? 'x' : on.key);
      }
      for (const key of keys) act(`key ${key}`, () => applyInput(comp, s, n, [{ f: n, type: 'key', key }], regions));
      if (I.wires.some((w) => w.on === 'tap' && here(w))) {
        const p = freeSpot(regions, comp.width, comp.height);
        if (p) act('tap on nothing', () => applyInput(comp, s, n, pressAt(n, p), regions));
      }
      // time: the scene runs out (its end rule and the `end:` wires); no new state when nothing changes
      const len = Math.max(1, Math.round(I.scenes.find((x) => x.id === s.scene).duration * comp.fps));
      act('wait', () => { const t = advance(comp, s, len); return keyOf(t) === keyOf(s) ? null : t; });
    }
    return { result: { states: nodes, edges, errors, truncated, max } };
  },
  /** v5: the frame a session state draws (a state of `explore`, or any from the fold) as PNG. msg: { state, maxSize }. */
  async stateFrame(msg) {
    const comp = state.comp;
    const view = viewOf(comp, msg.state, msg.state.f);
    await loadMedia(state.rt, comp, view.frame);
    const c = surface(comp.width, comp.height);
    state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, view.frame, { ...state.clip, ui: view.ui });
    return output(c, { maxSize: msg.maxSize });
  },
  assetFrame(msg) {
    return output(drawAsset(state.rt, msg.ref, state.fonts ? { ...msg, fonts: state.fonts } : msg), msg);
  },
  /** Contact sheet of clip frames: msg.frames = [frame numbers]. */
  async clipSheet(msg) {
    const comp = state.comp;
    const cells = [];
    for (const frame of msg.frames) {
      // each cell is drawn as soon as its sequence frames are in (the cache is smaller than a whole sheet)
      await loadMedia(state.rt, comp, frame);
      const c = surface(comp.width, comp.height);
      state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, frame, state.clip);
      // kept at cell size: a full-size copy per cell would be hundreds of MB for a vertical clip
      const copy = createCanvas(msg.cellWidth, Math.round((msg.cellWidth * comp.height) / comp.width));
      const g = copy.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, copy.width, copy.height);
      cells.push({ label: `${(frame / comp.fps).toFixed(2)}s`, draw: () => copy });
    }
    const out = sheet(cells, { cols: msg.cols, cellWidth: msg.cellWidth, width: comp.width, height: comp.height });
    return { result: { png: out.toBuffer('image/png'), width: out.width, height: out.height } };
  },
  /** Filmstrip of one asset: msg.times = [seconds]. */
  assetSheet(msg) {
    const cells = msg.times.map((t) => ({ label: `${t.toFixed(2)}s`, draw: () => drawAsset(state.rt, msg.ref, { ...msg, t, background: msg.background ?? '#101018', fonts: state.fonts }) }));
    const out = sheet(cells, { cols: msg.cols, cellWidth: msg.cellWidth, width: msg.width, height: msg.height });
    return { result: { png: out.toBuffer('image/png'), width: out.width, height: out.height } };
  },
  audio(msg) {
    const { left, right } = state.rt.renderAudio(msg.ref, msg.params ?? {}, { duration: msg.duration, seed: msg.seed ?? hashSeed(1, msg.ref) });
    const l = left.buffer, r = right === left ? left.slice().buffer : right.buffer;
    return { result: { left: l, right: r, sampleRate: SAMPLE_RATE }, transfer: [l, r] };
  },
  value(msg) {
    const v = state.rt.callValue(msg.ref, msg.params ?? {});
    return { result: { value: JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? '[function]' : x)) ?? 'null') } };
  },
  validate,
};

parentPort.on('message', async (msg) => {
  // a decoded footage frame (or why not) for a request made while drawing
  if (msg.footageReply) {
    const p = asked.get(msg.footageReply);
    asked.delete(msg.footageReply);
    if (msg.ok) p?.resolve(msg); else p?.reject(new Error(msg.error));
    return;
  }
  try {
    const { result, transfer } = await handlers[msg.op](msg);
    parentPort.postMessage({ id: msg.id, ok: true, result: { ...result, logs: result.logs ?? takeLogs() } }, transfer ?? []);
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: { message: describeError(err), stack: String(err?.stack ?? ''), logs: takeLogs() } });
  }
});
