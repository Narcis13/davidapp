// The studio's preview worker. It runs the same asset runtime as the renderer (src/core, served
// at /core) against an OffscreenCanvas, so the preview is drawn by the same asset code as the
// final MP4. Asset code never runs on the page's main thread: if it hangs, the page kills this
// worker and starts another.

import { createRuntime, describeError } from '/core/runtime.js';

// What asset source can see: nothing from the worker's global scope.
const HIDDEN = ['self', 'globalThis', 'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'setTimeout', 'setInterval',
  'requestAnimationFrame', 'queueMicrotask', 'performance', 'postMessage', 'close', 'caches', 'indexedDB', 'navigator', 'location', 'Function', 'Worker', 'onmessage'];

const no = (what, instead) => { throw new Error(`${what} is not available inside an asset: frames must be a pure function of (t, params). ${instead}`); };
const SafeMath = Object.freeze(Object.fromEntries([...Object.getOwnPropertyNames(Math).map((k) => [k, Math[k]]), ['random', () => no('Math.random()', 'Use f.rng().')]]));
const SafeDate = new Proxy(Date, {
  construct(T, args) { if (!args.length) no('new Date()', 'Use f.t or f.clip.t.'); return new T(...args); },
  apply() { no('Date()', 'Use f.t or f.clip.t.'); },
  get(T, k) { return k === 'now' ? () => no('Date.now()', 'Use f.t or f.clip.t.') : T[k]; },
});
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

const host = {
  lineOffset: 2,
  evaluate(source, filename) {
    let captured, calls = 0;
    const fn = new Function('asset', 'console', 'Math', 'Date', ...HIDDEN, `"use strict"; ${source}\n//# sourceURL=${filename}`);
    fn((def) => { calls++; captured = def; }, quiet, SafeMath, SafeDate);
    if (calls !== 1) throw new Error(calls ? 'asset({...}) was called more than once; one source declares one asset' : 'The source never called asset({...})');
    return captured;
  },
  createCanvas: (w, h) => new OffscreenCanvas(w, h),
};

let rt = null, composition = null, beats = [], sequenceUrls = {};
let canvas = null;
// sequence frames are fetched as a frame needs them, and a few seconds of them are kept
const seqCache = new Map();
const SEQ_CACHE = 180;

async function loadSequenceFrames(comp, frame) {
  for (const { ref, index } of rt.sequenceFramesAt(comp, frame)) {
    const key = `${ref}#${index}`;
    if (seqCache.has(key)) { const v = seqCache.get(key); seqCache.delete(key); seqCache.set(key, v); continue; }
    const res = await fetch(`${sequenceUrls[ref]}${String(index).padStart(6, '0')}.png`);
    if (!res.ok) throw new Error(`Frame ${index} of ${ref} could not be loaded (${res.status})`);
    seqCache.set(key, await createImageBitmap(await res.blob()));
    while (seqCache.size > SEQ_CACHE) { const k = seqCache.keys().next().value; seqCache.get(k).close?.(); seqCache.delete(k); }
  }
}

function surface(w, h) {
  if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
  return canvas;
}

const handlers = {
  async fonts({ fonts }) {
    const faces = [];
    for (const fam of fonts) for (const f of fam.files) faces.push(new FontFace(fam.family, `url(${f.url})`, { weight: String(f.weight), style: f.style }));
    await Promise.all(faces.map((face) => face.load().then((loaded) => self.fonts.add(loaded))));
    return {};
  },
  async load({ bundle, composition: comp }) {
    const next = createRuntime(host);
    for (const [ref, img] of Object.entries(bundle.images ?? {})) {
      const blob = await (await fetch(img.url)).blob();
      next.setImage(ref, await createImageBitmap(blob), img.vector);
    }
    for (const [ref, seq] of Object.entries(bundle.sequences ?? {})) {
      next.setSequence(ref, { frames: seq.frames, fps: seq.fps, width: seq.width, height: seq.height, get: (i) => seqCache.get(`${ref}#${i}`) ?? null });
    }
    next.load(bundle.assets ?? {});
    sequenceUrls = Object.fromEntries(Object.entries(bundle.sequences ?? {}).map(([ref, seq]) => [ref, seq.url]));
    rt = next;
    composition = comp ?? null;
    beats = bundle.beats ?? [];
    return {};
  },
  assetFrame(m) {
    const c = surface(m.width, m.height);
    rt.renderAsset(c.getContext('2d', { willReadFrequently: true }), m.ref, m.params ?? {}, m);
    const bitmap = c.transferToImageBitmap();
    return { result: { bitmap }, transfer: [bitmap] };
  },
  async clipFrame(m) {
    const comp = m.composition ?? composition;
    await loadSequenceFrames(comp, m.frame);
    const c = surface(comp.width, comp.height);
    rt.renderClipFrame(c.getContext('2d', { willReadFrequently: true }), comp, m.frame, { beats });
    const bitmap = c.transferToImageBitmap();
    return { result: { bitmap }, transfer: [bitmap] };
  },
  // a draft composition with the same assets (param tweaks, moved items): no recompile needed
  setComposition({ composition: comp }) {
    composition = comp;
    return {};
  },
};

self.onmessage = async ({ data: m }) => {
  try {
    const out = await handlers[m.op](m);
    self.postMessage({ id: m.id, ok: true, ...(out.result ?? {}) }, out.transfer ?? []);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: describeError(err) });
  }
};
