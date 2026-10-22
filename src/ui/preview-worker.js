// The studio's preview worker. It runs the same asset runtime as the renderer (src/core, served
// at /core) against an OffscreenCanvas, so the preview is drawn by the same asset code as the
// final MP4. Asset code never runs on the page's main thread: if it hangs, the page kills this
// worker and starts another.

import { createRuntime, describeError } from '/core/runtime.js';
import { fontAliases } from '/core/lib/text.js';
import { evaluateBrowser } from '/core/isolate.js';

const host = {
  lineOffset: 2,
  evaluate: evaluateBrowser,
  createCanvas: (w, h) => new OffscreenCanvas(w, h),
};

let rt = null, composition = null, clipExtra = { beats: [] }, sequenceUrls = {}, footageUrls = {}, fontMap = null;
// uploaded font sets already added to this worker, by alias: a set is loaded the first time a bundle needs it
const fontSets = new Map();

/** Add the uploaded fonts a bundle pins ({ <alias>: { family, files: [{ url, weight, style }] } }), each set under its alias. */
async function registerFontSets(fonts) {
  const loading = [];
  for (const [alias, set] of Object.entries(fonts ?? {})) {
    if (!fontSets.has(alias)) {
      fontSets.set(alias, Promise.all(set.files.map((f) => new FontFace(alias, `url(${f.url})`, { weight: String(f.weight), style: f.style }).load().then((face) => self.fonts.add(face)))).catch((e) => {
        fontSets.delete(alias); // tried again at the next load
        throw new Error(`The font "${set.family}" could not be loaded: ${e.message}`);
      }));
    }
    loading.push(fontSets.get(alias));
  }
  await Promise.all(loading);
}
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

// Footage frames come from the server, decoded by the same service as the render's (so the same source frame,
// converted the same way): PNG when the preview is paused or scrubbed (exact), JPEG while it plays (fast).
// A frame drawn from JPEG is fetched again as PNG once the preview stops on it.
const vidCache = new Map();
const VID_CACHE = 36;
const vidKey = (ref, i, ext) => `${ref}#${i}.${ext}`;
const pending = new Map();

function fetchFootage(ref, index, ext) {
  const key = vidKey(ref, index, ext);
  if (vidCache.has(key)) { const v = vidCache.get(key); vidCache.delete(key); vidCache.set(key, v); return Promise.resolve(); }
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const res = await fetch(`${footageUrls[ref]}${index}.${ext}`);
    if (!res.ok) throw new Error(`Frame ${index} of the footage ${ref} could not be loaded (${res.status})`);
    vidCache.set(key, await createImageBitmap(await res.blob()));
    while (vidCache.size > VID_CACHE) { const k = vidCache.keys().next().value; vidCache.get(k).close?.(); vidCache.delete(k); }
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

async function loadFootageFrames(comp, frame, fast) {
  const want = rt.footageFramesAt(comp, frame);
  await Promise.all(want.map(({ ref, index }) => fetchFootage(ref, index, fast ? 'jpg' : 'png')));
  // while playing, the next few frames are asked for already (the server decodes forward, so they are cheap)
  if (fast) for (const { ref, index } of want) for (let k = 1; k <= 3; k++) fetchFootage(ref, index + k, 'jpg').catch(() => {});
}

function surface(w, h) {
  if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
  return canvas;
}

const handlers = {
  async fonts({ fonts }) {
    const faces = [];
    for (const fam of fonts) {
      for (const f of fam.files) faces.push(new FontFace(fam.family, `url(${f.url})`, { weight: String(f.weight), style: f.style }));
      // Latin Extended under the family's alias, as in Node (core/lib/text.js fontString)
      for (const f of fam.ext?.files ?? []) faces.push(new FontFace(fam.ext.family, `url(${f.url})`, { weight: String(f.weight), style: f.style }));
    }
    await Promise.all(faces.map((face) => face.load().then((loaded) => self.fonts.add(loaded))));
    return {};
  },
  async load({ bundle, composition: comp }) {
    await registerFontSets(bundle.fonts);
    fontMap = fontAliases(bundle.fonts);
    const next = createRuntime(host);
    for (const [ref, img] of Object.entries(bundle.images ?? {})) {
      const blob = await (await fetch(img.url)).blob();
      next.setImage(ref, await createImageBitmap(blob), img.vector);
    }
    for (const [ref, seq] of Object.entries(bundle.sequences ?? {})) {
      next.setSequence(ref, { frames: seq.frames, fps: seq.fps, width: seq.width, height: seq.height, get: (i) => seqCache.get(`${ref}#${i}`) ?? null });
    }
    for (const [ref, v] of Object.entries(bundle.footage ?? {})) {
      next.setFootage(ref, { meta: v.meta, get: (i) => vidCache.get(vidKey(ref, i, 'png')) ?? vidCache.get(vidKey(ref, i, 'jpg')) ?? null });
    }
    next.load(bundle.assets ?? {});
    sequenceUrls = Object.fromEntries(Object.entries(bundle.sequences ?? {}).map(([ref, seq]) => [ref, seq.url]));
    footageUrls = Object.fromEntries(Object.entries(bundle.footage ?? {}).map(([ref, v]) => [ref, v.url]));
    rt = next;
    composition = comp ?? null;
    // what reaches assets as f.clip besides the composition: beats, the narration's words, caption pages and lane
    clipExtra = { beats: bundle.beats ?? [], words: bundle.words, captions: bundle.captions, lane: bundle.lane, ...(fontMap ? { fonts: fontMap } : {}) };
    return {};
  },
  assetFrame(m) {
    const c = surface(m.width, m.height);
    rt.renderAsset(c.getContext('2d', { willReadFrequently: true }), m.ref, m.params ?? {}, fontMap ? { ...m, fonts: fontMap } : m);
    const bitmap = c.transferToImageBitmap();
    return { result: { bitmap }, transfer: [bitmap] };
  },
  async clipFrame(m) {
    const comp = m.composition ?? composition;
    await loadSequenceFrames(comp, m.frame);
    await loadFootageFrames(comp, m.frame, !!m.fast);
    // an interactive scene change draws the frame the outgoing scene left on too
    if (m.transition && m.transition.from !== m.frame) {
      await loadSequenceFrames(comp, m.transition.from);
      await loadFootageFrames(comp, m.transition.from, !!m.fast);
    }
    const c = surface(comp.width, comp.height);
    const r = rt.renderClipFrame(c.getContext('2d', { willReadFrequently: true }), comp, m.frame, { ...clipExtra, record: !!m.record, ui: m.ui, transition: m.transition });
    const bitmap = c.transferToImageBitmap();
    // with record: the measured text boxes, for the editor's overlay; an interactive clip also returns its hit regions
    return { result: { bitmap, texts: r?.texts, regions: r?.regions }, transfer: [bitmap] };
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
