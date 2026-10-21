// check_clip: what a careful editor would point at, measured on sampled frames of a clip (or a draft, or
// the clip in another format): text outside its safe zone or cut by the frame, text boxes that overlap,
// text in the caption lane, text under its size floor, contrast under 4.5:1 against the worst pixels behind
// it, text held for less than words / 3 + 1 s, caption pages that break a rule, characters the fonts lack,
// an empty first frame, and a last frame held for less than 2 s. Each issue comes with its item, time,
// numbers and a still.
//
// An interactive clip (v5) is not a video, so it is checked as what it is: its structure (scenes nobody can reach or
// leave, wires that listen to nothing, variables nothing reads), the same frame checks on frames of each scene, its hit
// regions (size at phone size, bounds, overlap, label) and the states a viewer can reach, found by trying every press
// and key from the first state (the frame worker's `explore`), each state measured like a frame.

import { WorkerPool } from '../render/pool.js';
import { defaultWorkers } from '../render/video.js';
import { grayDiff } from '../render/contrast.js';
import { drawOverlays } from '../render/overlays.js';
import { zonesOf, glyphFindings, textOf, phoneView, hitRegions } from './inspect.js';
import { structureIssues, wireIssues, sceneGraph, reachable } from './interactive-checks.js';
import { reachable as inReach } from '../core/interactive.js';
import { StudioError } from './library.js';

export const CHECKS = ['safe-zone', 'clipped', 'overlap', 'caption-lane', 'size', 'contrast', 'hold', 'captions', 'glyphs', 'first-frame', 'last-frame'];
/** The checks only an interactive clip has (the frame checks above run on its scenes too, except captions and last-frame). */
export const INTERACTIVE_CHECKS = ['unreachable-scene', 'dead-end', 'no-target', 'inert-region', 'unused-variable', 'hit-size', 'hit-bounds', 'hit-overlap', 'hit-label', 'no-path-to-final', 'state-error'];
const DEFAULTS = { minTextSize: 2.5, contrast: 4.5, step: 0.5, lastHold: 2, overlapShare: 0.04 };
/**
 * Interactive clips: the least size of a hit target in CSS px at phone size (WCAG 2.5.8 asks 24, the enhanced 2.5.5 advises 44),
 * the share of the smaller region that two regions may share, the share of the frame that makes a region a backdrop (exempt
 * from the zone and overlap checks), and the crawl's size.
 */
const HIT = { hitSize: 24, hitAdvised: 44, hitOverlapShare: 0.1, backdrop: 0.6, maxStates: 40 };
/** Geometry and contrast count when they last: a word sliding in from off the frame is a move, not a problem. */
const LASTING = ['clipped', 'safe-zone', 'overlap', 'caption-lane', 'contrast'];

const r2 = (v) => Math.round(v * 100) / 100;
const inside = (b, z, tol = 1) => b.x >= z.x - tol && b.y >= z.y - tol && b.x + b.width <= z.x + z.width + tol && b.y + b.height <= z.y + z.height + tol;
const intersect = (a, b) => { const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; };
const meet = (...zs) => { const z = zs.filter(Boolean); const x = Math.max(...z.map((r) => r.x)), y = Math.max(...z.map((r) => r.y)); return { x, y, width: Math.min(...z.map((r) => r.x + r.width)) - x, height: Math.min(...z.map((r) => r.y + r.height)) - y }; };
const words = (text) => String(text).split(/\s+/).filter(Boolean).length;
/** A frame that cannot be drawn because a text does not fit at its size floor (TextFloorError) is an issue at that time, not a failed check: the asset's stack names it, or (an asset that draws another's text, a kit frame's chrome) only the message does. */
const floorError = (e) => /^TextFloorError\b/.test(String(e?.assetStack ?? '')) || /\bTextFloorError:/.test(String(e?.message ?? ''));

/** @param {any} ctx @param {{ clips: any, library: any, compositionOf: (o: any) => Promise<any>, clipFrame: (o: any) => Promise<any>, saveFrame: (name: string, png: Buffer) => string }} deps */
export function createChecks(ctx, { clips, library, compositionOf, clipFrame, saveFrame }) {
  /**
   * Check a clip (or a time range of it). o: { clip | composition, format, from, to, step (seconds between sampled frames, default
   * 0.5), stills (default true), only: [check names] } → { clip, format, frames, seconds, issues: [{ check, severity, item, t, frame, until?,
   * message, numbers, still? }], counts }. An interactive clip also takes maxStates (the crawl's cap, default 40) and answers with
   * `interactive` besides (its scenes, the phone size, the state graph); its issues may name a scene and a state.
   * @param {{ clip?: string, composition?: any, format?: string, from?: number, to?: number, step?: number, stills?: boolean, only?: string[], name?: string, maxStates?: number }} o (name: what a draft's stills are called, e.g. the clip it was edited from)
   */
  async function checkClip({ clip, composition, format, from = 0, to, step, stills = true, only, name, maxStates }) {
    const t0 = performance.now();
    for (const [k, v] of Object.entries({ from, to, step })) if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new StudioError(`${k} must be a number of seconds ≥ 0`);
    if (step !== undefined && step !== null && step < 0.04) throw new StudioError('step is the time between sampled frames: at least 0.04 s');
    if (only !== undefined && (!Array.isArray(only) || !only.every((c) => CHECKS.includes(c) || INTERACTIVE_CHECKS.includes(c)))) throw new StudioError(`only lists checks by name: ${[...CHECKS, ...INTERACTIVE_CHECKS].join(', ')}`);
    if (maxStates !== undefined && (!Number.isInteger(maxStates) || maxStates < 1 || maxStates > 200)) throw new StudioError('max_states is a whole number of states, 1–200');
    const comp = await compositionOf({ clip, composition, format });
    if (comp.interactive) return checkInteractive(comp, { clip, format, from, to, step, stills, only, name, maxStates, t0 });
    const opt = { ...DEFAULTS, ...(comp.checks ?? {}) };
    const fps = comp.fps, total = Math.round(comp.duration * fps);
    const end = Math.min(comp.duration, to ?? comp.duration);
    const a = Math.max(0, Math.min(total - 1, Math.round(from * fps))), b = Math.max(a, Math.min(total - 1, Math.round(end * fps) - 1));
    const every = Math.max(1, Math.round((step ?? opt.step) * fps));
    const frames = new Set();
    for (let f = a; f <= b; f += every) frames.add(f);
    frames.add(b);
    const want = (name) => !only || only.includes(name);
    const zones = zonesOf(comp);
    const textZone = meet(zones.titleSafe, zones.format, zones.platform);
    const { captionItems, hasCaptions } = captionsOf(comp);
    const { bundle } = await clips.bundleFor(comp);
    const pool = new WorkerPool({ size: defaultWorkers() });
    const { found, issue } = collector(want, fps);
    const scan = createScanner({ comp, opt, want, zones, textZone, captionItems, hasCaptions, issue });
    const allTexts = [];
    try {
      const measured = await Promise.all([...frames].sort((x, y) => x - y).map((f) => pool.run('inspectFrame', { frame: f, contrast: want('contrast') }, { bundle, timeout: 120000 })
        .then((r) => ({ f, ...r }), (e) => { if (!floorError(e)) throw e; return { f, floorError: e.message, texts: [], std: 99 }; })));
      for (const { f, texts, std, floorError: fe } of measured) {
        if (fe && want('size')) issue('size', `floor|${fe}`, f, { severity: 'error', item: null, message: `Text does not fit at its size floor: ${fe}`, numbers: {} });
        if (f === 0 && want('first-frame') && std < 2) issue('first-frame', 'f0', 0, { severity: 'error', item: null, message: 'The first frame is empty: a single flat colour (it is the thumbnail many feeds show).', numbers: { spread: r2(std) } });
        for (const t of texts) if (t.family) allTexts.push(t);
        scan.frame(f, texts);
      }
      // held long enough to read: words / 3 + 1 seconds (captions follow the speech and have their own rules)
      scan.holds(a, b, every);
      // the last frame holds for at least 2 s (a feed loops; a viewer needs a moment on the end card)
      if (want('last-frame') && b === total - 1) {
        const back = Math.min(total - 1, Math.round((opt.lastHold + 0.5) * fps));
        const tail = await Promise.all(Array.from({ length: back + 1 }, (_, i) => total - 1 - i).map((f) => pool.run('inspectFrame', { frame: f, contrast: false }, { bundle, timeout: 120000 }).then((r) => ({ f, thumb: r.thumb }), (e) => { if (!floorError(e)) throw e; return { f, thumb: null }; })));
        const last = tail[0].thumb;
        let changed = null;
        for (const x of tail) if (x.thumb && last && grayDiff(x.thumb, last) > 1.5) { changed = x.f; break; }
        const held = changed === null ? back / fps : (total - 1 - changed) / fps;
        if (last && held < opt.lastHold) issue('last-frame', 'last', total - 1, { severity: 'error', item: null, message: `The last frame is held for ${r2(held)} s; it should hold for at least ${opt.lastHold} s.`, numbers: { held: r2(held), needs: opt.lastHold, lastChange: changed === null ? null : r2(changed / fps) } });
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
    if (want('glyphs')) glyphIssues(allTexts, comp, issue);
    for (const [k, it] of found) if (LASTING.includes(it.check) && it.frames < 2 && frames.size > 2) found.delete(k);
    const issues = [...found.values()].sort((x, y) => x.frame - y.frame || CHECKS.indexOf(x.check) - CHECKS.indexOf(y.check));
    // a still for each issue: the frame with the zones and the box in question
    if (stills) {
      const cache = new Map();
      for (const [n, it] of issues.slice(0, 40).entries()) {
        let png = cache.get(it.frame);
        if (!png) {
          // a frame that cannot be drawn (text that does not fit at its floor) has no still
          try { png = (await clipFrame({ composition: comp, frame: it.frame, maxSize: 960 })).png; } catch { continue; }
          cache.set(it.frame, png);
        }
        const shot = await drawOverlays(png, { width: comp.width, height: comp.height, zones, show: ['safe', 'platform', 'lane'], highlight: it.box ? { box: it.box, label: it.check } : [] });
        it.still = saveFrame(`check-${clip ?? name ?? 'draft'}${format ? `-${format}` : ''}-${String(n + 1).padStart(2, '0')}-${it.check}`, shot);
      }
    }
    for (const it of issues) { delete it.worse; }
    const counts = Object.fromEntries(CHECKS.map((c) => [c, issues.filter((i) => i.check === c).length]));
    return { clip: clip ?? null, format: comp.format, from: r2(a / fps), to: r2(b / fps), step: r2(every / fps), frames: frames.size, seconds: r2((performance.now() - t0) / 1000), thresholds: opt, issues, counts };
  }

  /** Items that are captions (on a captions-role track, or caption assets tagged so) and whether the clip has any: captions follow the speech and have their own rules. */
  function captionsOf(comp) {
    const captionTracks = new Set(comp.tracks.filter((t) => t.role === 'captions').map((t) => t.id));
    const captionItems = new Set();
    for (const tr of comp.tracks) for (const it of tr.items) {
      const row = library.versionRow(it.asset);
      if (captionTracks.has(tr.id) || (row && JSON.parse(row.tags ?? '[]').includes('captions'))) captionItems.add(it.id);
    }
    return { captionItems, hasCaptions: !!comp.captions || comp.tracks.some((t) => captionTracks.has(t.id) && t.items.length) };
  }

  /** The characters the bundled fonts lack, as issues (the first item that draws each is named). */
  function glyphIssues(texts, comp, issue) {
    for (const g of glyphFindings(texts, comp, library)) {
      issue('glyphs', `${g.family}|${g.char}`, 0, { severity: g.kind === 'emoji' ? 'warning' : 'error', item: g.items[0] ?? null, message: `${g.char} (${g.codepoints.join(' ')}) is not in ${g.family}: it would be drawn with a system font${g.kind === 'emoji' ? ' (emoji are drawn with the system emoji font, so they differ per OS)' : ''}.`, numbers: { family: g.family, kind: g.kind, count: g.count, samples: g.samples, items: g.items } });
    }
  }

  /**
   * check_clip of an interactive clip → the video's result plus `interactive: { start, phone, scenes: [{ id, start, duration, end,
   * final?, reachable, frames }], crawl: { max, truncated, states: [{ id, scene, vars, reachesFinal? }], edges: [{ from, action, to }], errors } }`.
   * The frame checks run on frames of each scene's range on the design timeline (nobody playing, the variables at their first
   * values) and on the frame each crawled state draws at rest; the hit regions of every such frame are measured at phone size.
   * A state's `t` and `frame` are those of the design frame it draws.
   */
  async function checkInteractive(comp, { clip, format, from, to, step, stills, only, name, maxStates, t0 }) {
    const want = (c) => !only || only.includes(c);
    const opt = { ...DEFAULTS, ...HIT, ...(comp.checks ?? {}) };
    const I = comp.interactive;
    const fps = comp.fps, total = Math.round(comp.duration * fps);
    const every = Math.max(1, Math.round((step ?? opt.step) * fps));
    const zones = zonesOf(comp);
    const textZone = meet(zones.titleSafe, zones.format, zones.platform);
    const phone = phoneView(comp);
    const { captionItems, hasCaptions } = captionsOf(comp);
    const { found, issue } = collector(want, fps);
    const hit = hitChecker({ comp, opt, phone, zones });
    // the frames of each scene's range on the design timeline: every `step`, and the last
    const lo = Math.round(from * fps), hi = to === undefined ? total - 1 : Math.round(to * fps);
    const plan = I.scenes.map((scene) => {
      const a = Math.round(scene.start * fps), b = Math.min(total - 1, a + Math.max(1, Math.round(scene.duration * fps)) - 1);
      const set = new Set();
      for (let f = a; f <= b; f += every) set.add(f);
      set.add(b);
      return { scene, a, b, frames: [...set].filter((f) => f >= lo && f <= hi) };
    }).filter((p) => p.frames.length);
    const { bundle } = await clips.bundleFor(comp);
    const pool = new WorkerPool({ size: defaultWorkers() });
    const contrast = want('contrast');
    let measured, crawl;
    try {
      [measured, crawl] = await Promise.all([
        Promise.all(plan.map((p) => Promise.all(p.frames.map((f) => pool.run('inspectScene', { frame: f, contrast }, { bundle, timeout: 120000 })
          .then((r) => ({ f, ...r }), (e) => { if (!floorError(e)) throw e; return { f, floorError: e.message, texts: [], regions: [], std: 99 }; }))))),
        pool.run('explore', { maxStates: maxStates ?? opt.maxStates, contrast }, { bundle, timeout: 300000 }),
      ]);
    } finally {
      await pool.destroy();
    }
    const allTexts = [];
    // the hit regions each scene drew in any frame ("<item>.<event>"), and the regions of each frame for the stills
    const drawn = new Map();
    const regionsAt = new Map();
    const see = (scene, regions) => {
      if (!drawn.has(scene)) drawn.set(scene, new Map());
      for (const r of regions) drawn.get(scene).set(`${r.item}.${r.name}`, true);
    };
    // the scenes, on the design timeline
    plan.forEach((p, i) => {
      const at = (check, key, f, data) => issue(check, `${p.scene.id}|${key}`, f, { scene: p.scene.id, ...data });
      const scan = createScanner({ comp, opt, want, zones, textZone, captionItems, hasCaptions, issue: at });
      for (const m of measured[i]) {
        if (m.floorError) at('size', `floor|${m.floorError}`, m.f, { severity: 'error', item: null, message: `Text does not fit at its size floor: ${m.floorError}`, numbers: {} });
        if (p.scene.id === I.start && m.f === p.a && m.std < 2) at('first-frame', 'first', m.f, { severity: 'error', item: null, message: `The first frame of the first scene ("${p.scene.id}") is empty: a single flat colour (it is the thumbnail many feeds show).`, numbers: { spread: r2(m.std) } });
        for (const t of m.texts) if (t.family) allTexts.push(t);
        scan.frame(m.f, inFront(m.texts, m.regions, comp));
        const reports = hitRegions(inReach(m.regions), comp, phone);
        regionsAt.set(m.f, reports);
        see(p.scene.id, m.regions);
        hit(reports, m.f, at);
      }
      scan.holds(p.a, p.b, every);
    });
    // the states a viewer can reach, each drawn at rest. A finding the scenes (or an earlier state) made already is not made again.
    const byId = new Map(crawl.states.map((n) => [n.id, n]));
    for (const node of crawl.states) {
      const at = (check, key, f, data) => (found.has(`${check}|${node.scene}|${key}`) ? null : issue(check, `${node.scene}|${key}`, f, { scene: node.scene, state: node.id, ...data }));
      if (node.floorError) { at('size', `floor|${node.error}`, node.playhead, { severity: 'error', item: null, message: `Text does not fit at its size floor (state ${node.id}, scene "${node.scene}"): ${node.error}`, numbers: { vars: node.vars } }); continue; }
      if (node.error) { at('state-error', `draw|${node.id}`, node.playhead, { severity: 'error', item: null, message: `State ${node.id} (scene "${node.scene}", ${JSON.stringify(node.vars)}) cannot be drawn: ${node.error}`, numbers: { vars: node.vars } }); continue; }
      for (const t of node.texts) if (t.family) allTexts.push(t);
      createScanner({ comp, opt, want, zones, textZone, captionItems, hasCaptions, issue: at }).frame(node.playhead, inFront(node.texts, node.regions, comp));
      const reports = hitRegions(inReach(node.regions), comp, phone);
      regionsAt.set(`state:${node.id}`, reports);
      see(node.scene, node.regions);
      hit(reports, node.playhead, at);
      for (const o of node.occluded) {
        const r = reports.find((x) => x.key === o.key), by = reports.find((x) => x.key === o.by);
        at('hit-overlap', `covered|${o.key}`, node.playhead, { severity: 'error', item: r?.item ?? null, other: by?.item ?? null, box: r?.box, region: o.key, message: `${hitName(r)} is completely covered${by ? ` by ${hitName(by)}` : ''} (state ${node.id}, scene "${node.scene}"): a viewer cannot press it anywhere.`, numbers: { coveredBy: o.by } });
      }
    }
    for (const e of crawl.errors) {
      const node = byId.get(e.state);
      issue('state-error', `${e.state}|${e.action}`, node.playhead, { severity: 'error', item: null, scene: node.scene, state: node.id, message: `In state ${node.id} (scene "${node.scene}", ${JSON.stringify(node.vars)}), "${e.action}" fails: ${e.message}`, numbers: { action: e.action, vars: node.vars } });
    }
    // the structure; a finding about a scene is shown on that scene, a little way in
    const { edges } = sceneGraph(I, drawn);
    const live = new Set([...reachable(I, edges), ...crawl.states.map((n) => n.scene)]);
    const sampled = measured.reduce((n, list) => n + list.length, 0);
    const shown = (scene) => { const p = plan.find((x) => x.scene.id === scene); return p ? Math.min(p.b, p.a + Math.round(fps)) : 0; };
    for (const { check, key, scene, ...rest } of [...structureIssues(comp, drawn), ...wireIssues(comp, drawn, { frames: sampled, states: crawl.states.length })]) {
      issue(check, key, scene ? shown(scene) : 0, { item: null, ...(scene ? { scene } : { noStill: true }), ...rest });
    }
    // the states that lead to no final scene (said only when the crawl saw every state)
    const finals = new Set(I.scenes.filter((s) => s.final).map((s) => s.id));
    const finishes = new Set(crawl.states.filter((n) => finals.has(n.scene)).map((n) => n.id));
    for (let grew = true; grew;) {
      grew = false;
      for (const e of crawl.edges) if (finishes.has(e.to) && !finishes.has(e.from)) { finishes.add(e.from); grew = true; }
    }
    const judged = finals.size > 0 && !crawl.truncated;
    if (judged) {
      const stuck = new Map();
      for (const n of crawl.states) if (!finishes.has(n.id)) stuck.set(n.scene, [...(stuck.get(n.scene) ?? []), n.id]);
      for (const [scene, ids] of stuck) issue('no-path-to-final', scene, shown(scene), { severity: 'info', item: null, scene, state: ids[0], message: `From scene "${scene}" (state${ids.length > 1 ? 's' : ''} ${ids.join(', ')}) no sequence of presses, keys or waiting reaches a final scene (${[...finals].join(', ')}).`, numbers: { states: ids, final: [...finals] } });
    }
    if (want('glyphs')) glyphIssues(allTexts, comp, issue);
    for (const [k, it] of found) {
      const sampledIn = plan.find((p) => p.scene.id === it.scene)?.frames.length ?? 0;
      if (LASTING.includes(it.check) && !it.state && it.frames < 2 && sampledIn > 2) found.delete(k);
    }
    const severity = ['error', 'warning', 'info'];
    const sceneIndex = (id) => I.scenes.findIndex((s) => s.id === id);
    const everyCheck = [...CHECKS, ...INTERACTIVE_CHECKS];
    const issues = [...found.values()].sort((x, y) => severity.indexOf(x.severity) - severity.indexOf(y.severity) || sceneIndex(x.scene) - sceneIndex(y.scene) || x.frame - y.frame || everyCheck.indexOf(x.check) - everyCheck.indexOf(y.check));
    // a still for each issue: the scene's frame, or the frame the state draws, with the zones, the hit regions and the box in question
    if (stills) {
      const cache = new Map();
      for (const [n, it] of issues.slice(0, 40).entries()) {
        if (it.noStill) continue;
        const key = it.state ? `state:${it.state}` : it.frame;
        let png = cache.get(key);
        if (!png) {
          try {
            png = it.state
              ? Buffer.from((await ctx.pool.run('stateFrame', { state: byId.get(it.state).state, maxSize: 960 }, { bundle, timeout: 120000 })).png)
              : (await clipFrame({ composition: comp, frame: it.frame, maxSize: 960 })).png;
          } catch { continue; }
          cache.set(key, png);
        }
        const shot = await drawOverlays(png, { width: comp.width, height: comp.height, zones, regions: regionsAt.get(key) ?? [], show: ['safe', 'platform', 'lane', 'text'], highlight: it.box ? { box: it.box, label: it.check } : [] });
        it.still = saveFrame(`check-${clip ?? name ?? 'draft'}${format ? `-${format}` : ''}-${String(n + 1).padStart(2, '0')}-${it.check}`, shot);
      }
    }
    for (const it of issues) { delete it.worse; delete it.noStill; }
    const counts = Object.fromEntries(everyCheck.map((c) => [c, issues.filter((i) => i.check === c).length]));
    const firsts = plan.map((p) => p.frames[0]), lasts = plan.map((p) => p.frames.at(-1));
    return {
      clip: clip ?? null, format: comp.format, from: r2(Math.min(...firsts, 0) / fps), to: r2(Math.max(...lasts, 0) / fps), step: r2(every / fps),
      frames: sampled + crawl.states.length, seconds: r2((performance.now() - t0) / 1000), thresholds: opt, issues, counts,
      interactive: {
        start: I.start, phone,
        scenes: I.scenes.map((s) => ({ id: s.id, start: s.start, duration: s.duration, end: s.end, ...(s.final ? { final: true } : {}), reachable: live.has(s.id), frames: plan.find((p) => p.scene.id === s.id)?.frames.length ?? 0 })),
        crawl: { max: crawl.max, truncated: crawl.truncated, states: crawl.states.map((n) => ({ id: n.id, scene: n.scene, vars: n.vars, ...(judged ? { reachesFinal: finishes.has(n.id) } : {}) })), edges: crawl.edges, errors: crawl.errors.length },
      },
    };
  }

  return { checkClip };
}

/**
 * The issues found so far, one per check and key: a repeat on a later frame extends the first (a worse one replaces its numbers).
 * issue(check, key, frame, data) → the issue, or null when the check is not asked for.
 */
function collector(want, fps) {
  const found = new Map();
  const issue = (check, key, at, data) => {
    if (!want(check)) return null;
    const k = `${check}|${key}`;
    const prev = found.get(k);
    if (!prev) { const it = { check, ...data, frame: at, t: r2(at / fps), until: r2(at / fps), frames: 1 }; found.set(k, it); return it; }
    prev.frames++;
    prev.until = r2(at / fps);
    if (data.worse !== undefined && data.worse < prev.worse) Object.assign(prev, { ...data, frame: at, t: r2(at / fps), until: prev.until, frames: prev.frames });
    return prev;
  };
  return { found, issue };
}

/**
 * The per-frame checks on the text a frame drew, and the runs of text that tell how long it is held. frame(f, texts) takes
 * each measured frame in order; holds(a, b, every) judges the runs once the frames of the range a–b have been seen.
 * env: { comp, opt, want, zones, textZone, captionItems, hasCaptions, issue }
 */
function createScanner({ comp, opt, want, zones, textZone, captionItems, hasCaptions, issue }) {
  const fps = comp.fps;
  // runs of text: by block and by words, and every run in the order it began
  const seen = new Map(), byText = new Map();
  const runs = [];
  let prevFrame = -1;
  return {
    frame(f, texts) {
      const blocks = groupBlocks(texts).map((x) => ({ ...x, caption: captionItems.has(x.item), screenPct: x.screenSize === null ? null : Math.round((x.screenSize / Math.min(comp.width, comp.height)) * 1000) / 10 }));
      for (const blk of blocks) {
        const key = `${blk.item}|${blk.block}`;
        // how long a text is held: a run goes on while the same block of the same item is drawn (a text that types
        // itself out grows inside its block), or the same words of the same item are, wherever they are drawn (a block
        // that moves or scales may be grouped as another block); a text that leaves and comes back starts a new run
        const textKey = `${blk.item}|${blk.text.replace(/\s+/g, ' ').trim()}`;
        const going = (x) => (x && x.last >= prevFrame ? x : undefined);
        let s = going(seen.get(key)) ?? going(byText.get(textKey));
        if (!s) { s = { first: f, last: f, words: 0, text: blk.text, item: blk.item, caption: blk.caption, ticker: blk.role === 'ticker', key }; runs.push(s); }
        s.last = f;
        s.words = Math.max(s.words, words(blk.text)); if (words(blk.text) >= s.words) s.text = blk.text;
        seen.set(key, s);
        byText.set(textKey, s);
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
      prevFrame = f;
      if (want('overlap')) for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
        const p = blocks[i], q = blocks[j];
        if (p.item === q.item || p.approximate || q.approximate) continue;
        const area = intersect(p.box, q.box);
        if (area > opt.overlapShare * Math.min(p.box.width * p.box.height, q.box.width * q.box.height)) {
          issue('overlap', `${p.item}|${p.block}|${q.item}|${q.block}`, f, { severity: 'error', item: p.item, other: q.item, box: unite(p.box, q.box), message: `"${p.text.slice(0, 30)}" (${p.item}) and "${q.text.slice(0, 30)}" (${q.item}) overlap.`, numbers: { area: Math.round(area), a: rbox(p.box), b: rbox(q.box) } });
        }
      }
    },
    holds(a, b, every) {
      if (!want('hold')) return;
      for (const s of runs) {
        const key = `${s.key}|${s.first}`;
        // captions, tickers (text that scrolls past, f.lib.text role 'ticker') and numbers that count up are not held to it
        if (s.caption || s.ticker || /^[\d\s.,:%+\-–×x$€£#/]*$/.test(s.text)) continue;
        const held = (s.last - s.first + every) / fps, needs = s.words / 3 + 1;
        const visibleWholeRange = s.first > a && s.last < b;
        if (visibleWholeRange && held + 1e-6 < needs) issue('hold', key, s.first, { severity: 'error', item: s.item, message: `"${s.text.slice(0, 40)}" is on screen for about ${r2(held)} s; ${s.words} word${s.words === 1 ? '' : 's'} need ${r2(needs)} s (words / 3 + 1).`, numbers: { held: r2(held), needs: r2(needs), words: s.words } });
      }
    },
  };
}

/** A hit region as a sentence names it: item.event#id ("label"). */
const hitName = (r) => (r ? `${r.item}.${r.event}${r.id !== undefined ? `#${r.id}` : ''}${r.label ? ` ("${r.label}")` : ''}` : 'a region');

/**
 * The checks on the hit regions a frame drew (hitRegions' reports): the size at phone size, whether they lie inside the frame
 * and the safe zone, whether two of different items overlap, whether they have a label. → (reports, frame, issue) => void
 * @param {{ comp: any, opt: any, phone: any, zones: any }} o
 */
function hitChecker({ comp, opt, phone, zones }) {
  const safe = meet(zones.format, zones.platform);
  const area = comp.width * comp.height;
  const backdrop = (r) => r.box.width * r.box.height >= opt.backdrop * area;
  const screen = `${phone.viewport.width}×${phone.viewport.height}`;
  return (reports, f, issue) => {
    for (const r of reports) {
      const base = { item: r.item, region: r.key, box: r.box };
      const small = Math.min(r.css.width, r.css.height);
      if (small < opt.hitAdvised) {
        const error = small < opt.hitSize;
        issue('hit-size', r.key, f, { ...base, severity: error ? 'error' : 'info', message: `${hitName(r)} is ${r.css.width}×${r.css.height} CSS px on a phone (${screen}); a tap target is at least ${opt.hitSize}×${opt.hitSize} (WCAG 2.5.8)${error ? '' : ` and ${opt.hitAdvised}×${opt.hitAdvised} is advised`}.`, numbers: { css: r.css, frame: r.size, scale: Math.round(phone.scale * 1000) / 1000, needs: opt.hitSize, advised: opt.hitAdvised } });
      }
      const b = r.box;
      if (b.x < -1 || b.y < -1 || b.x + b.width > comp.width + 1 || b.y + b.height > comp.height + 1) {
        issue('hit-bounds', r.key, f, { ...base, severity: 'error', message: `${hitName(r)} runs off the frame, so part of it cannot be pressed.`, numbers: { box: rbox(b), frame: { width: comp.width, height: comp.height } } });
      } else if (!backdrop(r) && !inside(b, safe)) {
        issue('hit-bounds', r.key, f, { ...base, severity: 'warning', message: `${hitName(r)} is outside the safe zone (f.safe${zones.platform ? ` ∩ ${zones.platform.platforms.join(' + ')}` : ''}), where a phone's edges and a platform's own controls are in the way.`, numbers: { box: rbox(b), zone: rbox(safe), past: past(b, safe) } });
      }
      if (!r.label) issue('hit-label', r.key, f, { ...base, severity: 'info', message: `${hitName(r)} has no label: a screen reader announces it by its event only. Pass { label: "…" } to f.ui.hit.`, numbers: {} });
    }
    for (let i = 0; i < reports.length; i++) for (let j = i + 1; j < reports.length; j++) {
      const p = reports[i], q = reports[j];
      if (p.item === q.item || backdrop(p) || backdrop(q)) continue;
      const share = intersect(p.box, q.box) / Math.min(p.box.width * p.box.height, q.box.width * q.box.height);
      if (share > opt.hitOverlapShare) {
        issue('hit-overlap', `${p.key}|${q.key}`, f, { severity: share >= 0.5 ? 'error' : 'warning', item: p.item, other: q.item, region: p.key, box: unite(p.box, q.box), message: `${hitName(p)} and ${hitName(q)} overlap by ${Math.round(share * 100)}% of the smaller: a press where they overlap goes to the one drawn in front.`, numbers: { share: Math.round(share * 100) / 100, a: rbox(p.box), b: rbox(q.box) } });
      }
    }
  };
}

const rbox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
const unite = (p, q) => { const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y); return { x, y, width: Math.max(p.x + p.width, q.x + q.width) - x, height: Math.max(p.y + p.height, q.y + q.height) - y }; };
/** How far a box pokes out of a zone on each side, px (only the sides it crosses). */
const past = (b, z) => Object.fromEntries(Object.entries({ left: z.x - b.x, top: z.y - b.y, right: b.x + b.width - z.x - z.width, bottom: b.y + b.height - z.y - z.height }).filter(([, v]) => v > 1).map(([k, v]) => [k, Math.round(v)]));

/**
 * The texts a viewer is meant to read while a modal is open: those of the items drawn before a modal region (a dialog's
 * scrim, f.ui.hit with modal: true) are behind it, dimmed on purpose, and out of reach; they are not checked as text.
 */
function inFront(texts, regions, comp) {
  const i = (regions ?? []).findLastIndex((r) => r.modal);
  if (i < 0) return texts;
  const order = new Map(comp.tracks.filter((t) => t.type !== 'audio').flatMap((t) => t.items).map((item, k) => [item.id, k]));
  const at = order.get(regions[i].item) ?? -1;
  return texts.filter((t) => (order.get(t.item) ?? Infinity) >= at);
}

/** The words a frame recorded, as blocks (one layout of one item), with the worst contrast of their words. */
function groupBlocks(texts) {
  const map = new Map();
  for (const t of texts) {
    const key = `${t.item}|${t.kind}|${t.block ?? t.text}|${t.mask ? 'm' : ''}`;
    let b = map.get(key);
    if (!b) map.set(key, (b = { item: t.item, track: t.track, block: t.block ?? t.text, parts: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, screenSize: t.screenSize, floor: t.floor, alpha: t.alpha, contrast: null, approximate: t.approximate, role: t.role }));
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
