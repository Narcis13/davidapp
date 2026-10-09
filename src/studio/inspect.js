// Inspection: what a frame of a clip shows, measured. The layout report (every text drawn through
// f.lib.text or as 3D block letters, with its box in frame pixels, font, on-screen size, colour and
// item), the zones it is measured against (title-safe, action-safe, the format's safe zone, the clip's
// platform profiles, the caption lane), and the characters the bundled fonts cannot draw.

import { FORMATS, safeZone } from '../core/engine.js';
import { itemsOf } from '../core/composition.js';
import { walkParams } from '../core/schema.js';
import { platformSafe, captionLane } from '../core/platforms.js';
import { coverageReport } from '../render/glyphs.js';
import { json } from '../db/db.js';

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
  const platform = comp.platforms?.length ? platformSafe(comp.platforms, w, h) : null;
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
    b.parts.push(t.text);
    b.x0 = Math.min(b.x0, t.box.x); b.y0 = Math.min(b.y0, t.box.y);
    b.x1 = Math.max(b.x1, t.box.x + t.box.width); b.y1 = Math.max(b.y1, t.box.y + t.box.height);
    if (t.screenSize !== null && (b.screenSize === null || t.screenSize < b.screenSize)) b.screenSize = t.screenSize;
    b.alpha = Math.max(b.alpha, t.alpha);
    if (t.approximate) b.approximate = t.approximate;
  }
  return [...map.values()].map((b) => ({
    item: b.item, track: b.track, kind: b.kind, text: b.parts.join(' '), font: b.font, family: b.family,
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
   * The layout report for one frame of a clip (or a draft, or the clip in another format).
   * @param {{ clip?: string, composition?: any, format?: string, t?: number, frame?: number }} o
   */
  async function layoutReport({ clip, composition, format, t = 0, frame }) {
    const comp = await compositionOf({ clip, composition, format });
    const total = Math.round(comp.duration * comp.fps);
    const n = Math.max(0, Math.min(total - 1, frame ?? Math.round(t * comp.fps)));
    const { texts } = await recordFrame(comp, n);
    return { clip: clip ?? null, format: comp.format, width: comp.width, height: comp.height, frame: n, t: n / comp.fps, zones: zonesOf(comp), texts: blocksOf(texts, comp) };
  }

  /** Glyph findings over sampled frames (see glyphFindings). */
  async function glyphReport(comp, library, frames) {
    const texts = [];
    for (const f of frames) texts.push(...(await recordFrame(comp, f)).texts);
    return glyphFindings(texts, comp, library);
  }

  return { layoutReport, recordFrame, glyphReport };
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
  const report = /** @type {any[]} */ (coverageReport(entries));
  for (const g of report) g.items = [...new Set(entries.filter((e) => e.family === g.family && e.text.includes(g.char)).map((e) => e.item))];
  return report;
}

export { FORMATS };
