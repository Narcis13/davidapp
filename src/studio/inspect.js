// Inspection: what a frame of a clip shows, measured. The layout report (every text drawn through
// f.lib.text or as 3D block letters, with its box in frame pixels, font, on-screen size, colour and
// item), the zones it is measured against (title-safe, action-safe, the format's safe zone, the clip's
// platform profiles, the caption lane), and the characters the bundled fonts cannot draw. For an interactive
// clip (v5), also the hit regions a frame draws, with their size on a phone.

import { FORMATS, safeZone } from '../core/engine.js';
import { itemsOf } from '../core/composition.js';
import { sceneAt } from '../core/interactive.js';
import { walkParams } from '../core/schema.js';
import { platformSafe, captionLane } from '../core/platforms.js';
import { coverageReport } from '../render/glyphs.js';
import { json } from '../db/db.js';
import { StudioError } from './library.js';

const r1 = (v) => Math.round(v * 10) / 10;
const rect = (x, y, width, height) => ({ x: r1(x), y: r1(y), width: r1(width), height: r1(height) });
const inset = (w, h, k) => rect(w * k, h * k, w * (1 - 2 * k), h * (1 - 2 * k));

/**
 * The zones a frame is measured against, in frame pixels: title-safe (90 %) and action-safe (93 %) after SMPTE
 * ST 2046-1, the format's safe zone (f.safe), the tightest edge of the clip's platform profiles, and the caption lane
 * at the bottom of the tightest of those.
 */
export function zonesOf(comp) {
  const { width: w, height: h } = comp;
  const format = safeZone(w, h);
  const platform = comp.platforms?.length ? platformSafe(comp.platforms, w, h, { matching: true }) : null;
  const tight = platform ?? format;
  return {
    frame: rect(0, 0, w, h),
    titleSafe: inset(w, h, 0.05),
    actionSafe: inset(w, h, 0.035),
    format: rect(format.x, format.y, format.width, format.height),
    platform: platform ? { ...rect(platform.x, platform.y, platform.width, platform.height), platforms: platform.platforms, from: platform.from, warnings: platform.warnings } : null,
    lane: (() => { const l = captionLane(tight, w, h); return rect(l.x, l.y, l.width, l.height); })(),
  };
}

/**
 * How a phone shows an interactive clip: the frame contained in 390×844 CSS px (taller than wide), 844×390 (wider, landscape)
 * or 390×390 (square). → { viewport: { width, height }, scale (CSS px per frame pixel) }
 */
export function phoneView(comp) {
  const ratio = comp.width / comp.height;
  const viewport = ratio > 1.05 ? { width: 844, height: 390 } : ratio < 0.95 ? { width: 390, height: 844 } : { width: 390, height: 390 };
  return { viewport, scale: Math.min(viewport.width / comp.width, viewport.height / comp.height) };
}

/**
 * The hit regions a frame drew (core/interactive.js regions: a rectangle of the asset's own and the matrix that carries it
 * into the frame), as people read them: the item and event they fire, their label, the box they cover in frame pixels
 * (turned, the box around them), and their size in frame pixels and in CSS px on a phone. A range region also says its range.
 * @param {any[]} regions @param {any} comp @param {{ viewport: any, scale: number }} [phone]
 */
export function hitRegions(regions, comp, phone = phoneView(comp)) {
  return regions.map((r) => {
    const [a, b, c, d, e, f] = r.m;
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const width = r.w * Math.hypot(a, b), height = r.h * Math.hypot(c, d);
    return {
      key: r.key, item: r.item, event: r.name,
      ...(r.id !== undefined ? { id: r.id } : {}), ...(r.label ? { label: r.label } : {}), ...(r.shape ? { shape: r.shape } : {}),
      ...(r.range ? { range: r.range } : {}), ...(r.keys ? { keys: r.keys } : {}),
      box: rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
      size: { width: r1(width), height: r1(height) },
      css: { width: r1(width * phone.scale), height: r1(height * phone.scale) },
    };
  });
}

/**
 * The session frames a play reports when it is not told which: the times asked for (seconds), else the frame after each scripted
 * step (stepsToLog starts a log at frame 1; a wait takes its seconds, at least one frame, a tap two frames, any other step one),
 * else the frame after each frame of a raw log that has input, else the first frame.
 * → { frames (distinct, in order), ends (the frame after each step: [] without steps) }
 * @param {number} fps @param {{ steps?: any[], log?: any[], times?: number[] }} o
 */
export function playFrames(fps, { steps, log, times }) {
  let n = 1;
  const ends = (steps ?? []).map((step) => { n += step?.wait !== undefined ? Math.max(1, Math.round(step.wait * fps)) : step?.tap !== undefined ? 2 : 1; return n; });
  const asked = times ? times.map((t) => Math.round(t * fps)) : steps ? ends : (log ?? []).map((e) => (Number.isInteger(e?.f) ? e.f + 1 : 0));
  return { frames: [...new Set(asked.length ? asked : [0])].sort((a, b) => a - b), ends };
}

/** The text of a block from its drawn parts: glyphs of one word run together, words are separated by a space. */
export function textOf(parts) {
  const out = [];
  let word = null;
  for (const p of parts) {
    if (p.glyph && p.word !== undefined && p.word === word) out[out.length - 1] += p.text;
    else out.push(p.text);
    word = p.glyph ? p.word : null;
  }
  return out.join(' ');
}

/**
 * Words recorded by the runtime → one entry per drawn text block (one layout of one item), boxes united.
 * Each: { item, track, kind, text, font, family, size, screenSize, screenPct (of the frame's short side), floor, fill, alpha, box, words, mask?, approximate? }.
 */
export function blocksOf(texts, comp) {
  const short = Math.min(comp.width, comp.height);
  const map = new Map();
  for (const t of texts) {
    const key = `${t.item}|${t.kind}|${t.block ?? t.text}|${t.mask ? 'm' : ''}`;
    let b = map.get(key);
    if (!b) {
      map.set(key, (b = { item: t.item, track: t.track, kind: t.kind, parts: [], font: t.font, family: t.family, size: t.size, screenSize: t.screenSize, floor: t.floor, fill: t.fill, alpha: t.alpha, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, mask: t.mask, approximate: t.approximate }));
    }
    b.parts.push(t);
    b.x0 = Math.min(b.x0, t.box.x); b.y0 = Math.min(b.y0, t.box.y);
    b.x1 = Math.max(b.x1, t.box.x + t.box.width); b.y1 = Math.max(b.y1, t.box.y + t.box.height);
    if (t.screenSize !== null && (b.screenSize === null || t.screenSize < b.screenSize)) b.screenSize = t.screenSize;
    b.alpha = Math.max(b.alpha, t.alpha);
    if (t.approximate) b.approximate = t.approximate;
  }
  return [...map.values()].map((b) => ({
    item: b.item, track: b.track, kind: b.kind, text: textOf(b.parts), font: b.font, family: b.family,
    size: b.size === null ? null : r1(b.size), screenSize: b.screenSize === null ? null : r1(b.screenSize), screenPct: b.screenSize === null ? null : Math.round((b.screenSize / short) * 1000) / 10,
    floor: b.floor || undefined, fill: b.fill, alpha: Math.round(b.alpha * 1000) / 1000,
    box: rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0), words: b.parts.length,
    mask: b.mask || undefined, approximate: b.approximate || undefined,
  }));
}

/** @param {any} ctx @param {{ clips: any, compositionOf: (o: any) => Promise<any> }} deps */
export function createInspect(ctx, { clips, compositionOf }) {
  const { pool } = ctx;

  /**
   * Draw one frame with the recorder on → { texts (raw), png? }.
   * @param {any} comp @param {number} frame @param {{ png?: boolean, maxSize?: number }} [o]
   */
  async function recordFrame(comp, frame, { png = false, maxSize } = {}) {
    const { bundle } = await clips.bundleFor(comp);
    const r = await pool.run('clipFrame', { frame, record: true, output: png ? 'png' : 'none', maxSize }, { bundle, timeout: 30000 });
    return { texts: r.texts ?? [], png: r.png ? Buffer.from(r.png) : null };
  }

  /**
   * The layout report for one frame of a clip (or a draft, or the clip in another format). An interactive clip's frame is on its
   * design timeline (nobody playing) and the report adds the scene, the hit regions and the phone size they are measured at.
   * @param {{ clip?: string, composition?: any, format?: string, t?: number, frame?: number }} o
   */
  async function layoutReport({ clip, composition, format, t = 0, frame }) {
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new StudioError('t must be a time in seconds');
    if (frame !== undefined && !Number.isInteger(frame)) throw new StudioError('frame must be a whole frame number');
    const comp = await compositionOf({ clip, composition, format });
    const total = Math.round(comp.duration * comp.fps);
    const n = Math.max(0, Math.min(total - 1, frame ?? Math.round(t * comp.fps)));
    const head = { clip: clip ?? null, format: comp.format, width: comp.width, height: comp.height, frame: n, t: n / comp.fps, zones: zonesOf(comp) };
    if (comp.interactive) {
      // v5: the design timeline (nobody playing, the variables at their first values), with the hit regions the frame draws
      const { bundle } = await clips.bundleFor(comp);
      const r = await pool.run('inspectScene', { frame: n, contrast: false }, { bundle, timeout: 30000 });
      const phone = phoneView(comp);
      return { ...head, scene: sceneAt(comp, n / comp.fps)?.id ?? null, texts: blocksOf(r.texts, comp), regions: hitRegions(r.regions, comp, phone), phone };
    }
    const { texts } = await recordFrame(comp, n);
    return { ...head, texts: blocksOf(texts, comp) };
  }

  return { layoutReport, recordFrame };
}

/** Text-bearing string params of an item (every string, recursively, defaults included), to check against the fonts the item draws with. */
function stringsOf(library, item) {
  const out = [];
  const row = library.versionRow(item.asset);
  if (!row || row.type !== 'function') return out;
  walkParams(json(row.schema, {}), item.params ?? {}, ['string', 'text'], (value) => { if (typeof value === 'string' && value.trim()) out.push(value); });
  return out;
}

/**
 * Characters the bundled fonts cannot draw (they would fall back to a system font), before any render: the texts
 * recorded on sampled frames, plus every string param of each item checked against the families that item drew
 * with (so caption pages and slides not on a sampled frame are covered too).
 * → [{ family, char, codepoints, kind, count, samples, items }]
 */
export function glyphFindings(texts, comp, library) {
  const entries = [];
  const familiesOf = new Map();
  for (const t of texts) {
    if (!t.family) continue;
    entries.push({ text: t.text, family: t.family, item: t.item });
    if (!familiesOf.has(t.item)) familiesOf.set(t.item, new Set());
    familiesOf.get(t.item).add(t.family);
  }
  for (const { track, item } of itemsOf(comp)) {
    if (track.type === 'audio' || !familiesOf.has(item.id)) continue;
    for (const s of stringsOf(library, item)) for (const family of familiesOf.get(item.id)) entries.push({ text: s.replace(/\*/g, ''), family, item: item.id });
  }
  // the uploaded fonts the clip pins are read from their pinned files (a bundled family keeps its own coverage)
  const report = /** @type {any[]} */ (coverageReport(entries, library.fontCoverage?.(comp)));
  for (const g of report) g.items = [...new Set(entries.filter((e) => e.family === g.family && e.text.includes(g.char)).map((e) => e.item))];
  return report;
}

export { FORMATS };
