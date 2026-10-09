// check_clip: what a careful editor would point at, measured on sampled frames of a clip (or a draft, or
// the clip in another format): text outside its safe zone or cut by the frame, text boxes that overlap,
// text in the caption lane, text under its size floor, contrast under 4.5:1 against the worst pixels behind
// it, text held for less than words / 3 + 1 s, caption pages that break a rule, characters the fonts lack,
// an empty first frame, and a last frame held for less than 2 s. Each issue comes with its item, time,
// numbers and a still.

import { WorkerPool } from '../render/pool.js';
import { defaultWorkers } from '../render/video.js';
import { grayDiff } from '../render/contrast.js';
import { drawOverlays } from '../render/overlays.js';
import { zonesOf, glyphFindings, textOf } from './inspect.js';

export const CHECKS = ['safe-zone', 'clipped', 'overlap', 'caption-lane', 'size', 'contrast', 'hold', 'captions', 'glyphs', 'first-frame', 'last-frame'];
const DEFAULTS = { minTextSize: 2.5, contrast: 4.5, step: 0.5, lastHold: 2, overlapShare: 0.04 };

const r2 = (v) => Math.round(v * 100) / 100;
const inside = (b, z, tol = 1) => b.x >= z.x - tol && b.y >= z.y - tol && b.x + b.width <= z.x + z.width + tol && b.y + b.height <= z.y + z.height + tol;
const intersect = (a, b) => { const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; };
const meet = (...zs) => { const z = zs.filter(Boolean); const x = Math.max(...z.map((r) => r.x)), y = Math.max(...z.map((r) => r.y)); return { x, y, width: Math.min(...z.map((r) => r.x + r.width)) - x, height: Math.min(...z.map((r) => r.y + r.height)) - y }; };
const words = (text) => String(text).split(/\s+/).filter(Boolean).length;

/** @param {any} ctx @param {{ clips: any, library: any, compositionOf: (o: any) => Promise<any>, clipFrame: (o: any) => Promise<any>, saveFrame: (name: string, png: Buffer) => string }} deps */
export function createChecks(ctx, { clips, library, compositionOf, clipFrame, saveFrame }) {
  /**
   * Check a clip (or a time range of it). o: { clip | composition, format, from, to, step (seconds between sampled frames, default
   * 0.5), stills (default true), only: [check names] } → { clip, format, frames, seconds, issues: [{ check, severity, item, t, frame, until?,
   * message, numbers, still? }], counts }.
   * @param {{ clip?: string, composition?: any, format?: string, from?: number, to?: number, step?: number, stills?: boolean, only?: string[] }} o
   */
  async function checkClip({ clip, composition, format, from = 0, to, step, stills = true, only }) {
    const t0 = performance.now();
    const comp = await compositionOf({ clip, composition, format });
    const opt = { ...DEFAULTS, ...(comp.checks ?? {}) };
    const fps = comp.fps, total = Math.round(comp.duration * fps);
    const end = Math.min(comp.duration, to ?? comp.duration);
    const a = Math.max(0, Math.min(total - 1, Math.round(from * fps))), b = Math.max(a, Math.min(total - 1, Math.round(end * fps) - (end >= comp.duration ? 1 : 0)));
    const every = Math.max(1, Math.round((step ?? opt.step) * fps));
    const frames = new Set();
    for (let f = a; f <= b; f += every) frames.add(f);
    frames.add(b);
    const want = (name) => !only || only.includes(name);
    const zones = zonesOf(comp);
    const textZone = meet(zones.titleSafe, zones.format, zones.platform);
    const captionTracks = new Set(comp.tracks.filter((t) => t.role === 'captions').map((t) => t.id));
    // captions follow the speech and have their own rules: items on a captions track, or caption assets (tagged so) anywhere
    const captionItems = new Set();
    for (const tr of comp.tracks) for (const it of tr.items) {
      const row = library.versionRow(it.asset);
      if (captionTracks.has(tr.id) || (row && JSON.parse(row.tags ?? '[]').includes('captions'))) captionItems.add(it.id);
    }
    const hasCaptions = !!comp.captions || comp.tracks.some((t) => captionTracks.has(t.id) && t.items.length);
    const { bundle } = await clips.bundleFor(comp);
    const pool = new WorkerPool({ size: defaultWorkers() });
    const found = new Map();
    const issue = (check, key, at, data) => {
      if (!want(check)) return;
      const k = `${check}|${key}`;
      const prev = found.get(k);
      if (!prev) { found.set(k, { check, ...data, frame: at, t: r2(at / fps), until: r2(at / fps), frames: 1 }); return; }
      prev.frames++;
      prev.until = r2(at / fps);
      if (data.worse !== undefined && data.worse < prev.worse) Object.assign(prev, { ...data, frame: at, t: r2(at / fps), until: prev.until, frames: prev.frames });
    };
    const allTexts = [];
    const seen = new Map();
    try {
      const measured = await Promise.all([...frames].sort((x, y) => x - y).map((f) => pool.run('inspectFrame', { frame: f, contrast: want('contrast') }, { bundle, timeout: 120000 }).then((r) => ({ f, ...r }))));
      for (const { f, texts, std } of measured) {
        if (f === 0 && want('first-frame') && std < 2) issue('first-frame', 'f0', 0, { severity: 'error', item: null, message: 'The first frame is empty: a single flat colour (it is the thumbnail many feeds show).', numbers: { spread: r2(std) } });
        const blocks = groupBlocks(texts).map((x) => ({ ...x, caption: captionItems.has(x.item), screenPct: x.screenSize === null ? null : Math.round((x.screenSize / Math.min(comp.width, comp.height)) * 1000) / 10 }));
        for (const t of texts) if (t.family) allTexts.push(t);
        for (const blk of blocks) {
          const key = `${blk.item}|${blk.block}`;
          const s = seen.get(key) ?? { first: f, last: f, words: 0, text: blk.text, item: blk.item, caption: blk.caption };
          s.last = f; s.words = Math.max(s.words, words(blk.text)); if (words(blk.text) >= s.words) s.text = blk.text;
          seen.set(key, s);
          const label = `"${blk.text.length > 40 ? `${blk.text.slice(0, 37)}…` : blk.text}"`;
          if (blk.approximate) continue;
          const box = blk.box;
          if (box.x < -1 || box.y < -1 || box.x + box.width > comp.width + 1 || box.y + box.height > comp.height + 1) {
            issue('clipped', key, f, { severity: 'error', item: blk.item, box, message: `${label} runs off the frame.`, numbers: { box: rbox(box), frame: { width: comp.width, height: comp.height } } });
          } else if (!blk.caption && !inside(box, textZone)) {
            issue('safe-zone', key, f, { severity: 'error', item: blk.item, box, message: `${label} is outside the safe zone (title-safe ∩ f.safe${zones.platform ? ` ∩ ${zones.platform.platforms.join(' + ')}` : ''}).`, numbers: { box: rbox(box), zone: rbox(textZone), past: past(box, textZone) } });
          }
          if (hasCaptions && !blk.caption && intersect(box, zones.lane) > 0) issue('caption-lane', key, f, { severity: 'error', item: blk.item, box, message: `${label} is in the caption lane, where the captions go.`, numbers: { box: rbox(box), lane: rbox(zones.lane), overlap: Math.round(intersect(box, zones.lane)) } });
          const floor = Math.max(blk.floor ?? 0, opt.minTextSize);
          if (blk.screenPct !== null && blk.screenPct < floor) issue('size', key, f, { severity: 'error', item: blk.item, box, worse: blk.screenPct, message: `${label} is ${r2(blk.screenSize)} px on screen (${blk.screenPct}% of the frame's short side), under the floor of ${floor}%.`, numbers: { screenPx: r2(blk.screenSize), screenPct: blk.screenPct, floorPct: floor } });
          if (blk.contrast && blk.alpha >= 0.95 && blk.contrast.ratio < opt.contrast) issue('contrast', key, f, { severity: 'error', item: blk.item, box, worse: blk.contrast.ratio, message: `${label} has a contrast of ${blk.contrast.ratio}:1 against the worst pixels behind it (needs ${opt.contrast}:1).`, numbers: { ...blk.contrast, needs: opt.contrast } });
        }
        if (want('overlap')) for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
          const p = blocks[i], q = blocks[j];
          if (p.item === q.item || p.approximate || q.approximate) continue;
          const area = intersect(p.box, q.box);
          if (area > opt.overlapShare * Math.min(p.box.width * p.box.height, q.box.width * q.box.height)) {
            issue('overlap', `${p.item}|${p.block}|${q.item}|${q.block}`, f, { severity: 'error', item: p.item, other: q.item, box: unite(p.box, q.box), message: `"${p.text.slice(0, 30)}" (${p.item}) and "${q.text.slice(0, 30)}" (${q.item}) overlap.`, numbers: { area: Math.round(area), a: rbox(p.box), b: rbox(q.box) } });
          }
        }
      }
      // held long enough to read: words / 3 + 1 seconds (captions follow the speech and have their own rules)
      if (want('hold')) for (const [key, s] of seen) {
        // captions, and numbers that count up (a new text every frame), are not held to it
        if (s.caption || /^[\d\s.,:%+\-–×x$€£#/]*$/.test(s.text)) continue;
        const held = (s.last - s.first + every) / fps, needs = s.words / 3 + 1;
        const visibleWholeRange = s.first > a && s.last < b;
        if (visibleWholeRange && held + 1e-6 < needs) issue('hold', key, s.first, { severity: 'error', item: s.item, message: `"${s.text.slice(0, 40)}" is on screen for about ${r2(held)} s; ${s.words} word${s.words === 1 ? '' : 's'} need ${r2(needs)} s (words / 3 + 1).`, numbers: { held: r2(held), needs: r2(needs), words: s.words } });
      }
      // the last frame holds for at least 2 s (a feed loops; a viewer needs a moment on the end card)
      if (want('last-frame') && b === total - 1) {
        const back = Math.min(total - 1, Math.round((opt.lastHold + 0.5) * fps));
        const tail = await Promise.all(Array.from({ length: back + 1 }, (_, i) => total - 1 - i).map((f) => pool.run('inspectFrame', { frame: f, contrast: false }, { bundle, timeout: 120000 }).then((r) => ({ f, thumb: r.thumb }))));
        const last = tail[0].thumb;
        let changed = null;
        for (const x of tail) if (grayDiff(x.thumb, last) > 1.5) { changed = x.f; break; }
        const held = changed === null ? back / fps : (total - 1 - changed) / fps;
        if (held < opt.lastHold) issue('last-frame', 'last', total - 1, { severity: 'error', item: null, message: `The last frame is held for ${r2(held)} s; it should hold for at least ${opt.lastHold} s.`, numbers: { held: r2(held), needs: opt.lastHold, lastChange: changed === null ? null : r2(changed / fps) } });
      }
    } finally {
      await pool.destroy();
    }
    if (want('captions') && (comp.captions || hasCaptions)) {
      const pages = clips.captionPages(comp);
      for (const p of pages.problems) {
        const page = pages.pages[p.page];
        const at = page ? Math.round(page.start * fps) : 0;
        if (at < a || at > b) continue;
        issue('captions', `${p.page}|${p.rule}`, at, { severity: 'error', item: null, message: `Caption page ${p.page + 1}${page ? ` ("${page.text.replace(/\n/g, ' / ').slice(0, 40)}")` : ''}: ${p.message}`, numbers: { rule: p.rule, ...(p.numbers ?? {}) } });
      }
    }
    if (want('glyphs')) for (const g of glyphFindings(allTexts, comp, library)) {
      issue('glyphs', `${g.family}|${g.char}`, 0, { severity: g.kind === 'emoji' ? 'warning' : 'error', item: g.items[0] ?? null, message: `${g.char} (${g.codepoints.join(' ')}) is not in ${g.family}: it would be drawn with a system font${g.kind === 'emoji' ? ' (emoji are drawn with the system emoji font, so they differ per OS)' : ''}.`, numbers: { family: g.family, kind: g.kind, count: g.count, samples: g.samples, items: g.items } });
    }
    // geometry and contrast count when they last: a word sliding in from off the frame is a move, not a problem
    const LASTING = ['clipped', 'safe-zone', 'overlap', 'caption-lane', 'contrast'];
    for (const [k, it] of found) if (LASTING.includes(it.check) && it.frames < 2 && frames.size > 2) found.delete(k);
    const issues = [...found.values()].sort((x, y) => x.frame - y.frame || CHECKS.indexOf(x.check) - CHECKS.indexOf(y.check));
    // a still for each issue: the frame with the zones and the box in question
    if (stills) {
      const cache = new Map();
      for (const [n, it] of issues.slice(0, 40).entries()) {
        let png = cache.get(it.frame);
        if (!png) { png = (await clipFrame({ composition: comp, frame: it.frame, maxSize: 960 })).png; cache.set(it.frame, png); }
        const shot = await drawOverlays(png, { width: comp.width, height: comp.height, zones, show: ['safe', 'platform', 'lane'], highlight: it.box ? { box: it.box, label: it.check } : [] });
        it.still = saveFrame(`check-${clip ?? 'draft'}${format ? `-${format}` : ''}-${String(n + 1).padStart(2, '0')}-${it.check}`, shot);
      }
    }
    for (const it of issues) { delete it.worse; }
    const counts = Object.fromEntries(CHECKS.map((c) => [c, issues.filter((i) => i.check === c).length]));
    return { clip: clip ?? null, format: comp.format, from: r2(a / fps), to: r2(b / fps), step: r2(every / fps), frames: frames.size, seconds: r2((performance.now() - t0) / 1000), thresholds: opt, issues, counts };
  }

  return { checkClip };
}

const rbox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
const unite = (p, q) => { const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y); return { x, y, width: Math.max(p.x + p.width, q.x + q.width) - x, height: Math.max(p.y + p.height, q.y + q.height) - y }; };
/** How far a box pokes out of a zone on each side, px (only the sides it crosses). */
const past = (b, z) => Object.fromEntries(Object.entries({ left: z.x - b.x, top: z.y - b.y, right: b.x + b.width - z.x - z.width, bottom: b.y + b.height - z.y - z.height }).filter(([, v]) => v > 1).map(([k, v]) => [k, Math.round(v)]));

/** The words a frame recorded, as blocks (one layout of one item), with the worst contrast of their words. */
function groupBlocks(texts) {
  const map = new Map();
  for (const t of texts) {
    const key = `${t.item}|${t.kind}|${t.block ?? t.text}|${t.mask ? 'm' : ''}`;
    let b = map.get(key);
    if (!b) map.set(key, (b = { item: t.item, track: t.track, block: t.block ?? t.text, parts: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, screenSize: t.screenSize, floor: t.floor, alpha: t.alpha, contrast: null, approximate: t.approximate }));
    b.parts.push(t);
    b.x0 = Math.min(b.x0, t.box.x); b.y0 = Math.min(b.y0, t.box.y); b.x1 = Math.max(b.x1, t.box.x + t.box.width); b.y1 = Math.max(b.y1, t.box.y + t.box.height);
    if (t.screenSize !== null && (b.screenSize === null || t.screenSize < b.screenSize)) b.screenSize = t.screenSize;
    b.alpha = Math.max(b.alpha, t.alpha);
    // a word still fading in or out does not decide the contrast
    if (t.contrast && t.alpha >= 0.95 && (!b.contrast || t.contrast.ratio < b.contrast.ratio)) b.contrast = t.contrast;
    if (t.approximate) b.approximate = t.approximate;
  }
  return [...map.values()].map((b) => ({ ...b, text: textOf(b.parts), box: { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } }));
}

