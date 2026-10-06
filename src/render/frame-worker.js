// A render worker thread. It owns one asset runtime (compiled from the bundle it was last given)
// and answers requests for frames, contact sheets, audio and asset validation. Asset code only
// ever runs here, inside vm contexts; the pool kills the thread if a request overruns its timeout.

import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRuntime, describeError } from '../core/runtime.js';
import { FORMATS, SAMPLE_RATE } from '../core/engine.js';
import { hashSeed } from '../core/rng.js';
import { nodeHost, registerFonts, createCanvas, loadImage, takeLogs, FRAME_CONTEXT } from './host.js';

registerFonts();

let state = { key: null, rt: null, comp: null, beats: [], sequences: {} };
let canvas = null;

// Sequence frames are PNG files, loaded as a frame needs them and kept in a small cache.
const seqCache = new Map();
const SEQ_CACHE = 96;

async function makeRuntime(bundle) {
  const rt = createRuntime(nodeHost);
  for (const [ref, img] of Object.entries(bundle.images ?? {})) rt.setImage(ref, await loadImage(img.path), img.vector);
  for (const [ref, s] of Object.entries(bundle.sequences ?? {})) {
    rt.setSequence(ref, { frames: s.frames, fps: s.fps, width: s.width, height: s.height, dir: s.dir, get: (i) => seqCache.get(`${ref}#${i}`) ?? null });
  }
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

function surface(width, height) {
  if (!canvas || canvas.width !== width || canvas.height !== height) canvas = createCanvas(width, height);
  return canvas;
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

const metaOf = (def) => JSON.parse(JSON.stringify({ kind: def.kind, title: def.title, description: def.description, tags: def.tags, duration: def.duration, formats: def.formats, schema: def.schema, uses: def.uses }));

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
        const c = drawAsset(rt, msg.ref, { ...o, t });
        const ms = performance.now() - t0;
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

const handlers = {
  async load(msg) {
    takeLogs();
    const rt = await makeRuntime(msg.bundle);
    state = { key: msg.bundle.key, rt, comp: msg.bundle.composition ?? null, beats: msg.bundle.beats ?? [], sequences: msg.bundle.sequences ?? {} };
    return { result: {} };
  },
  async clipFrame(msg) {
    const comp = state.comp;
    await loadSequenceFrames(state.rt, comp, msg.frame);
    const c = surface(comp.width, comp.height);
    state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, msg.frame, { beats: state.beats });
    return output(c, msg);
  },
  assetFrame(msg) {
    return output(drawAsset(state.rt, msg.ref, msg), msg);
  },
  /** Contact sheet of clip frames: msg.frames = [frame numbers]. */
  async clipSheet(msg) {
    const comp = state.comp;
    const cells = [];
    for (const frame of msg.frames) {
      // each cell is drawn as soon as its sequence frames are in (the cache is smaller than a whole sheet)
      await loadSequenceFrames(state.rt, comp, frame);
      const c = surface(comp.width, comp.height);
      state.rt.renderClipFrame(c.getContext('2d', FRAME_CONTEXT), comp, frame, { beats: state.beats });
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
    const cells = msg.times.map((t) => ({ label: `${t.toFixed(2)}s`, draw: () => drawAsset(state.rt, msg.ref, { ...msg, t, background: msg.background ?? '#101018' }) }));
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
  try {
    const { result, transfer } = await handlers[msg.op](msg);
    parentPort.postMessage({ id: msg.id, ok: true, result: { ...result, logs: result.logs ?? takeLogs() } }, transfer ?? []);
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: { message: describeError(err), stack: String(err?.stack ?? ''), logs: takeLogs() } });
  }
});
