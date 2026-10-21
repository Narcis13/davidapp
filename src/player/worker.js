// The player's worker: the asset runtime (../core, the renderer's own) drawing a clip on an OffscreenCanvas,
// so a shared clip is drawn in the viewer's browser by the same code that renders its MP4. Asset source is
// evaluated exactly as in the studio preview (src/ui/preview-worker.js): the worker's globals hidden, no
// randomness, no clock. Imports are relative, so the folder plays wherever it is copied (an exported share
// keeps the layout player/ next to core/).
//
// Media comes by absolute URL (engine.js resolves the bundle against its base). Encoded files are fetched once
// and kept within a byte budget; the frames a clip frame draws are decoded just before it is drawn, and the
// files of the next second or so are fetched while it plays.

import { createRuntime, describeError } from '../core/runtime.js';
import { fontAliases } from '../core/lib/text.js';

// What asset source can see: nothing from the worker's global scope (the same list as the studio preview's).
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

let rt = null, composition = null, clipExtra = { beats: [] }, fontMap = null, canvas = null;
/** ref → { url, files? } of the bundle's sequences and footage */
let sequences = {}, footage = {};

// ── media: encoded files by URL, decoded bitmaps by URL ──────────────────────────────────────
const FILE_BYTES = 96 * 1024 * 1024;
const BITMAP_BYTES = 96 * 1024 * 1024;
const files = new Map(), fetching = new Map(), bitmaps = new Map(), decoding = new Map();
let fileBytes = 0, bitmapBytes = 0;
/** the URLs the frame being drawn needs: never evicted while it is drawn */
let pinned = new Set();

const touch = (map, key) => { const v = map.get(key); map.delete(key); map.set(key, v); return v; };

/** The file at url as a Blob, fetched once. */
function fileOf(url) {
  if (files.has(url)) return Promise.resolve(touch(files, url));
  if (fetching.has(url)) return fetching.get(url);
  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url.split('/').slice(-2).join('/')} could not be loaded (${res.status})`);
    const blob = await res.blob();
    files.set(url, blob);
    fileBytes += blob.size;
    for (const [k, b] of files) {
      if (fileBytes <= FILE_BYTES) break;
      if (pinned.has(k) || k === url) continue;
      files.delete(k); fileBytes -= b.size;
    }
    return blob;
  })().finally(() => fetching.delete(url));
  fetching.set(url, p);
  return p;
}

/** The file at url decoded (an ImageBitmap), kept while the budget allows. */
function bitmapOf(url) {
  if (bitmaps.has(url)) return Promise.resolve(touch(bitmaps, url));
  if (decoding.has(url)) return decoding.get(url);
  const p = (async () => {
    const bitmap = await createImageBitmap(await fileOf(url));
    bitmaps.set(url, bitmap);
    bitmapBytes += bitmap.width * bitmap.height * 4;
    for (const [k, b] of bitmaps) {
      if (bitmapBytes <= BITMAP_BYTES) break;
      if (pinned.has(k) || k === url) continue;
      bitmaps.delete(k); bitmapBytes -= b.width * b.height * 4; b.close();
    }
    return bitmap;
  })().finally(() => decoding.delete(url));
  decoding.set(url, p);
  return p;
}

// Footage from the studio is decoded by its server (/api/footage/<slug>/<v>/<index>.png|jpg: PNG exact, JPEG fast
// while playing) and sequences are its PNG files; an exported share lists the file of each frame the clip shows
// (files: { index: name }, a frame that repeats an earlier one names the same file).
const pad = (i) => String(i).padStart(6, '0');
function sequenceUrls(ref, i) {
  const s = sequences[ref];
  if (!s) return [];
  if (s.files) return s.files[i] ? [`${s.url}${s.files[i]}`] : [];
  return [`${s.url}${pad(i)}.png`];
}
function footageUrls(ref, i, fast) {
  const v = footage[ref];
  if (!v) return [];
  if (v.files) return v.files[i] ? [`${v.url}${v.files[i]}`] : [];
  const png = `${v.url}${i}.png`, jpg = `${v.url}${i}.jpg`;
  return fast ? [jpg, png] : [png, jpg];
}
/** What the runtime draws for a frame: the first of its URLs that is decoded. */
const decoded = (urls) => { for (const u of urls) if (bitmaps.has(u)) return bitmaps.get(u); return null; };

/** The media URLs a clip frame draws: one per sequence or footage frame (one already decoded wins). */
function mediaAt(comp, frame, fast) {
  const out = new Set();
  const want = (urls) => { const ready = urls.find((u) => bitmaps.has(u)); if (urls.length) out.add(ready ?? urls[0]); };
  for (const { ref, index } of rt.sequenceFramesAt(comp, frame)) want(sequenceUrls(ref, index));
  for (const { ref, index } of rt.footageFramesAt(comp, frame)) want(footageUrls(ref, index, fast));
  return [...out];
}

// Fetching ahead while it plays: the latest call replaces the queue, four files at a time.
let queue = [], active = 0;
function fetchAhead(urls) {
  queue = urls.filter((u) => !files.has(u) && !fetching.has(u));
  pump();
}
function pump() {
  while (active < 4 && queue.length) {
    active++;
    fileOf(queue.shift()).catch(() => {}).finally(() => { active--; pump(); });
  }
}

function ahead(comp, frame, count, fast) {
  const total = Math.round(comp.duration * comp.fps);
  const urls = [];
  for (let f = frame + 1; f <= Math.min(total - 1, frame + count); f++) for (const u of mediaAt(comp, f, fast)) if (!urls.includes(u)) urls.push(u);
  fetchAhead(urls);
  // the next two frames' pictures are decoded already, off this thread where the browser can
  for (let f = frame + 1; f <= Math.min(total - 1, frame + 2); f++) for (const u of mediaAt(comp, f, fast)) if (files.has(u)) bitmapOf(u).catch(() => {});
}

function surface(w, h) {
  if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
  return canvas;
}

// bundled font files already added to this worker, by family and URL
const fontsAdded = new Set();
/** Add font faces: [{ family, url, weight, style }], each once. */
function addFonts(faces, progress) {
  return Promise.all(faces.map(async (f) => {
    const key = `${f.family}|${f.url}|${f.weight}|${f.style}`;
    if (!fontsAdded.has(key)) {
      const face = await new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight), style: f.style }).load().catch((e) => { throw new Error(`The font "${f.label ?? f.family}" could not be loaded: ${e.message}`); });
      self.fonts.add(face);
      fontsAdded.add(key);
    }
    progress();
  }));
}

const handlers = {
  /**
   * Load a clip: { bundle, composition, fonts }. fonts: the bundled families it draws with ([{ family, files: [{ url, weight,
   * style }], ext? }], as /api/status lists them); the bundle's own fonts are the uploaded sets it pins. Reports progress.
   */
  async load({ bundle, composition: comp, fonts = [] }, progress) {
    const faces = [];
    for (const fam of fonts) {
      for (const f of fam.files) faces.push({ family: fam.family, ...f });
      // Latin Extended under the family's alias, as in Node (core/lib/text.js fontString)
      for (const f of fam.ext?.files ?? []) faces.push({ family: fam.ext.family, ...f });
    }
    // an uploaded set goes under its alias, which names exactly the files the clip pinned
    for (const [alias, set] of Object.entries(bundle.fonts ?? {})) for (const f of set.files) faces.push({ family: alias, label: set.family, ...f });
    const images = Object.entries(bundle.images ?? {});
    const total = faces.length + images.length;
    let done = 0;
    const step = () => progress(++done, total);
    await addFonts(faces, step);
    fontMap = fontAliases(bundle.fonts);
    const next = createRuntime(host);
    // images stay decoded for as long as the clip is loaded (outside the frames' budget)
    await Promise.all(images.map(async ([ref, img]) => { next.setImage(ref, await createImageBitmap(await fileOf(img.url)), img.vector); step(); }));
    sequences = bundle.sequences ?? {};
    footage = bundle.footage ?? {};
    for (const [ref, seq] of Object.entries(sequences)) next.setSequence(ref, { frames: seq.frames, fps: seq.fps, width: seq.width, height: seq.height, get: (i) => decoded(sequenceUrls(ref, i)) });
    for (const [ref, v] of Object.entries(footage)) next.setFootage(ref, { meta: v.meta, get: (i) => decoded(footageUrls(ref, i, false)) });
    next.load(bundle.assets ?? {});
    rt = next;
    composition = comp ?? null;
    // what reaches assets as f.clip besides the composition: beats, the narration's words, caption pages and lane
    clipExtra = { beats: bundle.beats ?? [], words: bundle.words, captions: bundle.captions, lane: bundle.lane, ...(fontMap ? { fonts: fontMap } : {}) };
    return {};
  },
  /**
   * Draw one clip frame: { frame, composition?, fast?, ahead?, record?, ui? }. fast: playing (footage from the studio
   * comes as JPEG); ahead: fetch the media of that many frames after it; ui: an interactive composition's state.
   * → the bitmap, and what the runtime returned: regions (interactive), texts (record).
   */
  async clipFrame(m) {
    const comp = m.composition ?? composition;
    const urls = mediaAt(comp, m.frame, !!m.fast);
    pinned = new Set(urls);
    try {
      await Promise.all(urls.map(bitmapOf));
      const c = surface(comp.width, comp.height);
      const r = rt.renderClipFrame(c.getContext('2d', { willReadFrequently: true }), comp, m.frame, { ...clipExtra, record: !!m.record, ui: m.ui });
      const bitmap = c.transferToImageBitmap();
      if (m.ahead > 0) ahead(comp, m.frame, m.ahead, !!m.fast);
      return { result: { bitmap, frame: m.frame, regions: r?.regions, texts: r?.texts }, transfer: [bitmap] };
    } finally {
      pinned = new Set();
    }
  },
  /** Fetch the media of these frames before they are needed ({ frames: [n] }); the first one is decoded too. Reports progress. */
  async preload({ frames, fast }, progress) {
    const comp = composition;
    const urls = [...new Set(frames.flatMap((f) => mediaAt(comp, f, !!fast)))];
    let done = 0;
    await Promise.all(urls.map((u) => fileOf(u).then(() => progress(++done, urls.length))));
    if (frames.length) await Promise.all(mediaAt(comp, frames[0], !!fast).map(bitmapOf));
    return { result: { files: urls.length } };
  },
  // a draft composition with the same assets (an editor's edits): no recompile needed
  setComposition({ composition: comp }) {
    composition = comp;
    return {};
  },
};

self.onmessage = async ({ data: m }) => {
  const progress = (done, total) => self.postMessage({ id: m.id, progress: [done, total] });
  try {
    const out = await handlers[m.op](m, progress);
    self.postMessage({ id: m.id, ok: true, ...(out.result ?? {}) }, out.transfer ?? []);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: describeError(err) });
  }
};
