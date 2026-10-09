// The studio's iteration-3 workflows, driven in headless Chrome with real input (mouse presses, drags,
// keys, typed text, touch taps on the phone sessions) against a running studio, each step checked as it
// goes and each workflow written as a GIF plus stills. The sibling of scripts/workflows-v2.mjs: same
// driver (scripts/lib/browser.mjs), same output and report shape. They change the data they run on
// (they save the clip), so point them at a copy of the iteration-3 showcase, never at a library you
// want to keep. The clip is `v3-demo`: a voiced horizontal clip with typed markers, an item anchored to a
// narration word, a music bed with volume keys and ducking, a captions track, a loudness target, and
// a finished render #1 with its report.
//
//   STUDIO_DATA=<that studio's data dir> node scripts/workflows-v3.mjs <base-url> [out-dir] [workflow …]
//
//   words     narration words on the timeline: a click moves the playhead; an anchored item shows its anchor and follows another word
//   markers   the marker lane: add, drag, retype, delete, the M key, undo, save (and the same on a phone)
//   audio     volume keys and ducking in the inspector: add a key, type a dB value, pick an ease, ducking source, save
//   report    the render report: the queue row, the dialog, the gallery section and the downloads
//   issues    run the clip checks, open an issue (playhead and still), an edit makes the list stale
//   overlays  grid, safe areas, platform, caption lane and text boxes over the preview, never in its pixels (and on a phone)
//
// out-dir (default docs/showcase/v3) gets gifs/workflow-v3-<name>.gif, studio/v3-<name>*.png and
// reports/workflows-v3.json. Exits 1 when a check fails or the page logs a problem.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession } from './lib/browser.mjs';
import { ROOT } from '../src/render/host.js';

const [base, outArg, ...names] = process.argv.slice(2);
if (!base) { console.error('usage: STUDIO_DATA=<dir> node scripts/workflows-v3.mjs <base-url> [out-dir] [workflow …]'); process.exit(2); }
const out = outArg ?? join(ROOT, 'docs', 'showcase', 'v3');
for (const d of ['gifs', 'studio', 'reports']) mkdirSync(join(out, d), { recursive: true });
const CLIP = 'v3-demo';
const report = {};
let failed = false;

/**
 * One workflow: its own browser session; `expect` records a named check. `fn` gets a `phone(name, fn)` that runs
 * a short follow-up on a 390×844 touch session (its own GIF, its problems counted here).
 */
async function workflow(name, what, fn, opts = {}) {
  if (names.length && !names.includes(name)) return;
  console.log(`${name}: ${what}`);
  const s = await openSession(opts);
  const checks = {};
  const extra = {};
  const expect = (label, ok, detail) => { checks[label] = !!ok; console.log(`  ${ok ? '✓' : '✖'} ${label}${detail !== undefined ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`); if (!ok) failed = true; };
  let error = null;
  const problems = [];
  const phone = async (fn2) => {
    console.log('  · on a phone (390×844, touch)');
    const p = await openSession({ width: 390, height: 844, mobile: true });
    try {
      await fn2(p, (label, ok, detail) => expect(`phone: ${label}`, ok, detail));
    } catch (e) {
      error ??= `phone: ${e.message}`;
      console.log(`  ✖ phone: ${e.message}`);
      failed = true;
      await p.shot(join(out, 'studio', `v3-${name}-mobile-failed.png`)).catch(() => {});
    }
    extra.mobileFrames = await p.gif(join(out, 'gifs', `workflow-v3-${name}-mobile.gif`)).catch((e) => { error ??= e.message; return 0; });
    problems.push(...p.problems.map((x) => `phone: ${x}`));
    await p.close();
  };
  try {
    await fn(s, expect, phone);
  } catch (e) {
    error = e.message;
    console.log(`  ✖ ${e.message}`);
    failed = true;
    await s.shot(join(out, 'studio', `v3-${name}-failed.png`)).catch(() => {});
  }
  const frames = await s.gif(join(out, 'gifs', `workflow-v3-${name}.gif`)).catch((e) => { error ??= e.message; return 0; });
  problems.push(...s.problems);
  if (problems.length) { failed = true; for (const p of problems) console.log(`  CONSOLE ${p}`); }
  report[name] = { what, checks, consoleProblems: problems, gif: `gifs/workflow-v3-${name}.gif`, frames, ...(extra.mobileFrames !== undefined ? { mobileGif: `gifs/workflow-v3-${name}-mobile.gif`, mobileFrames: extra.mobileFrames } : {}), ...(error ? { error } : {}) };
  await s.close();
}

// ---- helpers that run in the page
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const tid = (id) => `[data-testid=${id}]`;
const setValue = (sel, value, event = 'input') => `(() => { const el = ${q(sel)}; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('${event}', { bubbles: true })); })()`;
const editorReady = `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0 && document.querySelectorAll('[data-testid=tl-word]').length > 0`;
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const api = (s, path) => s.evaluate(`fetch(${JSON.stringify(path)}).then((r) => (r.ok ? r.json() : null))`);
/** The playhead in seconds: the scrub box holds it, snapped to a frame. */
const clock = (s) => s.evaluate(`Number(${q(tid('scrub'))}.value)`);
/** What the timeline lays out: seconds → pixels, from the full-length background item. */
const scale = (s) => s.evaluate(`(() => { const b = ${q('[data-testid=item][data-id=drift]')}.getBoundingClientRect(); const r = ${q(tid('ruler'))}.getBoundingClientRect(); return { pps: b.width / 12, left: r.left }; })()`);
const markers = (s) => s.evaluate(`[...document.querySelectorAll('[data-testid=marker]')].map((m) => ({ index: Number(m.dataset.index), t: Number(m.dataset.t), type: m.dataset.type, label: m.getAttribute('aria-label') }))`);
/** A hash of the preview's pixels as the user sees them (the canvas copied to a 2D canvas). */
const pixels = (s) => s.evaluate(`(async () => { const c = ${q(tid('preview-canvas'))}; await new Promise((r) => setTimeout(r, 450)); const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const g = k.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, k.width, k.height).data; let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return { hash: h >>> 0, w: k.width, h: k.height }; })()`);

/** Tap on a phone: the element first goes to the middle of the screen, clear of the fixed bar at the bottom. */
async function tapAt(p, selector, dx = 0.5) {
  await p.evaluate(`${q(selector)}.scrollIntoView({ block: 'center', inline: 'nearest' })`);
  await p.sleep(250);
  const r = await p.rect(selector, { scroll: false });
  await p.tap({ x: r.x + Math.min(r.width * dx, r.width - 2), y: r.cy });
}
/** Click a field, replace what it holds by typing. */
async function fill(s, selector, text) {
  await s.click(selector, { settle: 120 });
  await s.evaluate(`${q(selector)}.select?.()`);
  await s.type(text);
}
/** Set a <select> the way a choice from its list would (the list itself is native UI the driver cannot click) and fire change. */
const choose = (s, selector, value) => s.evaluate(setValue(selector, value, 'change'));
/** Click a point on the ruler: the playhead goes there. */
async function seekRuler(s, t) {
  const { pps, left } = await scale(s);
  const r = await s.rect(tid('ruler'));
  await s.click({ x: left + t * pps, y: r.cy });
  await s.waitFor(`Math.abs(Number(${q(tid('scrub'))}.value) - ${t}) < 0.06`, `the playhead at ${t}`);
}
/** Open the clip in the editor. A draft with unsaved changes would ask "leave the page?": the workflows never wait for that. */
async function openEditor(s, ready = editorReady) {
  await s.evaluate(`window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true)`).catch(() => {});
  await s.goto(`${base}/clips/${CLIP}`, ready);
  await s.evaluate(`window.scrollTo(0, 0)`);
  await s.sleep(500);
}
async function leave(s, url, ready) {
  await s.evaluate(`window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true)`).catch(() => {});
  await s.goto(url, ready);
}
/** Save the draft and wait until the studio has the next revision. */
async function save(s) {
  const rev = (await api(s, `/api/clips/${CLIP}`)).revision;
  await s.click(tid('save'));
  await s.waitFor(`fetch('/api/clips/${CLIP}').then((r) => r.json()).then((c) => c.revision > ${rev})`, 'the saved revision');
  await s.waitFor(`${q(tid('unsaved'))}?.hidden === true`, 'the unsaved badge to go');
  return (await api(s, `/api/clips/${CLIP}`));
}
/** The bundle the page was served (words in clip time). */
const bundle = (s) => api(s, `/api/clips/${CLIP}`);

// ---- 1. words
await workflow('words', 'narration words on the timeline: click one to go there; the anchored item shows its anchor and follows another word', async (s, expect) => {
  await openEditor(s);
  const clip = await bundle(s);
  const words = clip.words;
  const dom = await s.evaluate(`[...document.querySelectorAll('[data-testid=tl-word]')].map((w) => ({ key: w.dataset.key, i: Number(w.dataset.i), text: w.textContent }))`);
  s.step(`Clip ${CLIP}: the narration shows its ${dom.length} words as blocks`);
  await s.frame();
  expect('every word of the bundle is a block on the narration', dom.length === words.length && words.every((w, i) => dom[i]?.key === w.key && dom[i].i === w.i && dom[i].text === w.text), { blocks: dom.length, words: words.length });

  const target = words[4];
  s.step(`Click the word "${target.text}": the playhead goes to its start`);
  await s.click(`[data-testid=tl-word][data-key="${target.key}"]`);
  await s.waitFor(`Math.abs(Number(${q(tid('scrub'))}.value) - ${target.start}) < 0.06`, 'the playhead at the word');
  const t1 = await clock(s);
  const pos = await s.evaluate(`${q(tid('tl-position'))}.textContent`);
  const timeText = await s.evaluate(`${q(tid('time'))}.textContent`);
  expect('the playhead is at the start of the word', near(t1, target.start, 0.06), { word: target.start, playhead: t1 });
  expect('the position and the time read-out follow', pos.startsWith(`frame ${Math.round(target.start * clip.fps)} `) || near(Number(/frame (\d+)/.exec(pos)?.[1]), target.start * clip.fps, 1.01), `${pos} · ${timeText}`);

  const later = words[9];
  s.step(`Another word, "${later.text}": the playhead follows again`);
  await s.click(`[data-testid=tl-word][data-key="${later.key}"]`);
  await s.waitFor(`Math.abs(Number(${q(tid('scrub'))}.value) - ${later.start}) < 0.06`, 'the playhead at the second word');
  expect('and moves on to the next one', near(await clock(s), later.start, 0.06), { word: later.start });

  s.step('Select the item "follow", which starts on a narration word');
  const sel = '[data-testid=item][data-id=follow]';
  await s.rect(sel);
  const box = await s.rect(sel);
  await s.click({ x: box.x + box.width * 0.2, y: box.cy });
  await s.waitFor(`${q(tid('selected-id'))}?.textContent === 'follow'`, 'the inspector for follow');
  const badge = await s.evaluate(`!!${q(`${sel} [data-testid=item-anchor]`)}`);
  const anchorInfo = await s.evaluate(`${q(tid('anchor-info'))}?.textContent ?? ''`);
  const w0 = words.find((w) => w.item === clip.composition.tracks[1].items[1].anchor.item && w.i === clip.composition.tracks[1].items[1].anchor.word);
  await s.frame();
  expect('the block shows its anchor mark', badge);
  expect('the inspector says which word it starts on', anchorInfo.includes(`"${w0.text}"`), anchorInfo);

  const before = await s.evaluate(`(() => { const b = ${q(sel)}.getBoundingClientRect(); const l = ${q(sel)}.parentElement.getBoundingClientRect(); return { left: b.left - l.left, width: b.width }; })()`);
  const pick = words[3];
  s.step(`Pick the word "${pick.text}" (${pick.start.toFixed(2)} s) in "Narration word": the item moves there`);
  await s.click(tid('anchor-word'));
  await s.key('Escape').catch(() => {});
  await choose(s, tid('anchor-word'), pick.key);
  await s.waitFor(`(() => { const b = ${q(sel)}; const l = b.parentElement.getBoundingClientRect(); return Math.abs(b.getBoundingClientRect().left - l.left - ${before.left}) > 8; })()`, 'the item to move on the timeline');
  await s.sleep(400);
  const after = await s.evaluate(`(() => { const b = ${q(sel)}.getBoundingClientRect(); const l = ${q(sel)}.parentElement.getBoundingClientRect(); return { left: b.left - l.left, width: b.width }; })()`);
  const pps = before.width / clip.composition.tracks[1].items[1].duration;
  await s.frame();
  expect('the item sits on the new word on the timeline', near(after.left, pick.start * pps, 3), { left: Math.round(after.left), expected: Math.round(pick.start * pps) });
  expect('the item moved left, the way the word is earlier', after.left < before.left, { before: Math.round(before.left), after: Math.round(after.left) });
  expect('the inspector follows the new word', (await s.evaluate(`${q(tid('anchor-info'))}.textContent`)).includes(`"${pick.text}"`), await s.evaluate(`${q(tid('anchor-info'))}.textContent`));
  expect('the start in the inspector is the word\'s start', near(Number(await s.evaluate(`${q(tid('item-start'))}.value`)), pick.start, 0.06), pick.start);

  s.step('The item now sits on the new word (an unsaved draft)');
  await s.evaluate(`${q(tid('timeline'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(300);
  await s.frame();
  await s.shot(join(out, 'studio', 'v3-words.png'));
});

// ---- 2. markers
const MARKER_ORIGINAL = 6;
await workflow('markers', 'the marker lane: add, drag, retype and delete a marker, the M key, undo, save', async (s, expect, phone) => {
  await openEditor(s);
  const clip0 = await bundle(s);
  const lane = await s.evaluate(`!!${q(tid('marker-lane'))}`);
  const list0 = await markers(s);
  s.step('The marker lane under the ruler: a flag for every marker, by type');
  await s.rect(tid('marker-lane'));
  await s.frame();
  const types = new Set(list0.map((m) => m.type));
  expect('the lane shows a flag for each marker of the clip', lane && list0.length === clip0.composition.markers.length, list0.length);
  expect('with all five types: cut, hold, beat, word and note', ['cut', 'hold', 'beat', 'word', 'note'].every((t) => types.has(t)), [...types]);

  s.step('Move the playhead to 3 s, pick "cut" and press Add marker');
  await seekRuler(s, 3);
  await choose(s, tid('add-marker-type'), 'cut');
  await s.click(tid('add-marker'));
  await s.waitFor(`document.querySelectorAll('[data-testid=marker]').length === ${MARKER_ORIGINAL + 1}`, 'the new marker');
  const added = (await markers(s)).find((m) => !list0.some((o) => near(o.t, m.t, 0.001) && o.type === m.type));
  await s.waitFor(`!!${q(tid('marker-editor'))}`, 'the marker in the inspector');
  const t0 = Number(await s.evaluate(`${q(tid('marker-t'))}.value`));
  await s.frame();
  expect('a cut marker appears at the playhead and the inspector shows it', added?.type === 'cut' && near(added.t, 3, 0.06) && near(t0, added.t, 0.001), added);

  s.step('Drag the new flag along the lane to a later time');
  const flag = await s.rect(`[data-testid=marker][data-index="${added.index}"]`);
  const { pps } = await scale(s);
  await s.drag({ x: flag.x + 6, y: flag.cy }, { x: flag.x + 6 + 2.1 * pps, y: flag.cy });
  await s.sleep(300);
  const t1 = Number(await s.evaluate(`${q(tid('marker-t'))}.value`));
  const moved = (await markers(s)).find((m) => near(m.t, t1, 0.001) && m.type === 'cut' && !list0.some((o) => near(o.t, m.t, 0.001)));
  expect('the time in the inspector changed with the drag', t1 > t0 + 1 && near(t1, t0 + 2.1, 0.5), { from: t0, to: t1 });
  expect('and the flag sits at the new time', !!moved, moved);

  s.step('Change its type to "beat" in the inspector');
  await s.click(tid('marker-type'));
  await choose(s, tid('marker-type'), 'beat');
  await s.waitFor(`[...document.querySelectorAll('[data-testid=marker]')].some((m) => m.dataset.type === 'beat' && Math.abs(Number(m.dataset.t) - ${t1}) < 0.002)`, 'the flag to become a beat');
  await s.frame();
  expect('the flag is now a beat marker', (await markers(s)).filter((m) => m.type === 'beat').length === 2, (await markers(s)).map((m) => m.type).join(' '));

  s.step('Delete it with "Delete marker"');
  await s.click(tid('marker-delete'));
  await s.waitFor(`document.querySelectorAll('[data-testid=marker]').length === ${MARKER_ORIGINAL}`, 'the marker to go');
  expect('the marker is gone and the inspector has let go of it', !(await s.evaluate(`!!${q(tid('marker-editor'))}`)), (await markers(s)).length);

  s.step('Focus the timeline and press M: a note marker at the playhead');
  await seekRuler(s, 2);
  const lanes = await s.rect('.tl-lane[data-track=bg]');
  await s.click({ x: lanes.x + lanes.width - 30, y: lanes.cy });
  const focused = await s.evaluate(`!!document.activeElement?.closest?.('[data-testid=timeline]')`);
  await s.key('m');
  await s.waitFor(`document.querySelectorAll('[data-testid=marker]').length === ${MARKER_ORIGINAL + 1}`, 'the note marker');
  const head = await clock(s);
  const note = (await markers(s)).find((m) => near(m.t, head, 0.08) && m.type === 'note');
  await s.frame();
  expect('the timeline had the focus', focused);
  expect('a note marker is at the playhead', !!note, (await markers(s)).map((m) => `${m.type}@${m.t}`).join(' '));
  s.step('Undo (Ctrl+Z): the marker is removed');
  await s.key('z', { modifiers: ['ctrl'] });
  await s.waitFor(`document.querySelectorAll('[data-testid=marker]').length === ${MARKER_ORIGINAL}`, 'undo to remove the note');
  await s.frame();
  expect('undo took the note marker away', (await markers(s)).length === MARKER_ORIGINAL);

  s.step('Drag the existing note "tighten this" later, then save');
  const tn = list0.find((m) => m.type === 'note' && /tighten/.test(m.label));
  const nflag = await s.rect(`[data-testid=marker][data-t="${tn.t}"][data-type=note]`);
  await s.drag({ x: nflag.x + 6, y: nflag.cy }, { x: nflag.x + 6 + 0.9 * pps, y: nflag.cy });
  await s.sleep(300);
  const tNew = Number(await s.evaluate(`${q(tid('marker-t'))}.value`));
  expect('the note moved', tNew > tn.t + 0.4, { from: tn.t, to: tNew });
  await s.evaluate('window.scrollTo(0, 0)');
  const saved = await save(s);
  await s.frame();
  await s.shot(join(out, 'studio', 'v3-markers.png'));
  const mk = saved.composition.markers;
  expect('the saved clip has the edited note', mk.some((m) => (m.type ?? 'note') === 'note' && /tighten/.test(m.label) && near(m.t, tNew, 0.01)), mk.find((m) => /tighten/.test(m.label)));
  expect('and still the six markers it began with (the added ones are gone)', mk.length === MARKER_ORIGINAL && !mk.some((m) => near(m.t, 3, 0.1) || near(m.t, 2, 0.1) || near(m.t, t1, 0.01)), mk.map((m) => `${m.type ?? 'note'}@${m.t}`).join(' '));

  await phone(async (p, expectP) => {
    await openEditor(p);
    p.step('On a phone: tap the "end card" hold flag to select it');
    await tapAt(p, '[data-testid=marker][data-type=hold]', 0.1);
    await p.waitFor(`!!${q(tid('marker-editor'))}`, 'the marker editor');
    const type = await p.evaluate(`${q(tid('marker-type'))}.value`);
    expectP('a tap selects the marker and the inspector shows it', type === 'hold', type);
    p.step('Tap "Add marker": a note at the playhead');
    const n0 = (await markers(p)).length;
    await tapAt(p, tid('add-marker'));
    await p.waitFor(`document.querySelectorAll('[data-testid=marker]').length === ${n0 + 1}`, 'the added marker');
    expectP('a marker was added by touch', (await markers(p)).length === n0 + 1);
    await p.evaluate(`${q(tid('timeline'))}.scrollLeft = 0; ${q(tid('marker-lane'))}.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v3-markers-mobile.png'));
  });
});

// ---- 3. audio
await workflow('audio', 'gain keys and ducking in the inspector: add a key, type a dB value, pick an ease, ducking source, save', async (s, expect) => {
  await openEditor(s);
  const clip0 = await bundle(s);
  const bed0 = clip0.composition.tracks.flatMap((t) => t.items).find((i) => i.id === 'bed');
  s.step('Select the music item "bed"');
  const sel = '[data-testid=item][data-id=bed]';
  const box = await s.rect(sel);
  await s.click({ x: box.x + box.width * 0.5, y: box.cy });
  await s.waitFor(`${q(tid('selected-id'))}?.textContent === 'bed' && !!${q(tid('audio-automation'))}`, 'the audio inspector');
  await s.rect(tid('audio-automation'));
  await s.frame();
  const rows = () => s.evaluate(`[...document.querySelectorAll('[data-testid=volume-key]')].map((r) => ({ t: Number(r.querySelector('[data-testid=volume-key-t]').value), db: Number(r.querySelector('[data-testid=volume-key-db]').value), ease: r.querySelector('[data-testid=volume-key-ease]').value }))`);
  const curve = () => s.evaluate(`${q('[data-testid=volume-curve] .vc-line')}.getAttribute('d')`);
  const keys0 = bed0.keyframes.volume;
  const r0 = await rows();
  expect('the key rows match the composition', r0.length === keys0.length && keys0.every((k, i) => near(r0[i].t, k.t, 0.001) && near(r0[i].db, k.v, 0.05) && r0[i].ease === (k.ease ?? 'linear')), r0);
  const d0 = await curve();

  s.step('Move the playhead to 5 s and press "Add key"');
  await seekRuler(s, 5);
  await s.waitFor(`!${q(tid('volume-add'))}.disabled`, 'the add button');
  await s.click(tid('volume-add'));
  await s.waitFor(`document.querySelectorAll('[data-testid=volume-key]').length === ${keys0.length + 1}`, 'the new key row');
  const r1 = await rows();
  const at = r1.findIndex((k) => near(k.t, 5, 0.06));
  expect('a key row appears at the playhead, between its neighbours', at === 2 && near(r1[2].t, 5, 0.06), r1.map((k) => `${k.t}:${k.db}`).join(' '));

  s.step('Type -9 in the dB box of the new key');
  const dbSel = `[data-testid=volume-key][data-index="${at}"] [data-testid=volume-key-db]`;
  await fill(s, dbSel, '-9');
  await s.click(tid('volume-curve'), { settle: 200 });
  const r2 = await rows();
  const d1 = await curve();
  expect('the key holds -9 dB', near(r2[at].db, -9, 0.01), r2[at]);
  expect('the curve changed (it dips between the neighbours)', d1 !== d0, `${d0.length} → ${d1.length} chars`);

  s.step('Pick an ease for that key: "outCubic"');
  const easeSel = `[data-testid=volume-key][data-index="${at}"] [data-testid=volume-key-ease]`;
  const options = await s.evaluate(`[...${q(easeSel)}.options].map((o) => o.value)`);
  const ease = options.includes('outCubic') ? 'outCubic' : options.find((o) => o !== 'linear');
  await s.click(easeSel, { settle: 100 });
  await s.key('Escape').catch(() => {});
  await choose(s, easeSel, ease);
  await s.sleep(300);
  const d2 = await curve();
  await s.frame();
  expect(`the ease is "${ease}" and the curve changed again`, (await rows())[at].ease === ease && d2 !== d1, ease);

  s.step('Ducking: set "Drops by" to 12 dB by typing');
  await s.rect(tid('audio-duck'));
  await fill(s, tid('duck-by'), '12');
  await s.click(tid('audio-duck') + ' .hint, ' + tid('audio-duck') + ' h3', { settle: 100 }).catch(() => {});
  await s.frame();
  expect('the box holds 12', Number(await s.evaluate(`${q(tid('duck-by'))}.value`)) === 12);

  s.step('Switch the source to the track level (envelope): a threshold appears');
  const noThreshold = !(await s.evaluate(`!!${q(tid('duck-threshold'))}`));
  await choose(s, tid('duck-source'), 'envelope');
  await s.waitFor(`!!${q(tid('duck-threshold'))}`, 'the threshold box');
  await s.rect(tid('duck-threshold'));
  await s.frame();
  expect('the threshold box was not there with the words source and is now', noThreshold && (await s.evaluate(`!!${q(tid('duck-threshold'))}`)));
  await fill(s, tid('duck-threshold'), '-35');
  s.step('And back to the words: the threshold goes');
  await choose(s, tid('duck-source'), 'words');
  await s.waitFor(`!${q(tid('duck-threshold'))}`, 'the threshold to go');
  await s.frame();
  expect('the threshold box is gone again', !(await s.evaluate(`!!${q(tid('duck-threshold'))}`)));

  s.step('Save: the composition has the new key and the new ducking');
  await s.evaluate('window.scrollTo(0, 0)');
  const saved = await save(s);
  const bed = saved.composition.tracks.flatMap((t) => t.items).find((i) => i.id === 'bed');
  const key = bed.keyframes.volume.find((k) => near(k.t, 5, 0.06));
  await s.frame();
  expect('the saved composition has the key at 5 s with -9 dB and its ease', key && near(key.v, -9, 0.01) && key.ease === ease && bed.keyframes.volume.length === keys0.length + 1, key);
  expect('and ducking by 12 dB from the words', bed.duck.by === 12 && bed.duck.source === 'words', bed.duck);
  // show the finished panel
  await s.evaluate(`${q(tid('audio-automation'))}.scrollIntoView({ block: 'start' })`);
  await s.sleep(400);
  await s.shot(join(out, 'studio', 'v3-audio.png'));
});

// ---- 4. report
await workflow('report', 'the render report: queue row, report dialog, gallery section and downloads', async (s, expect) => {
  await leave(s, `${base}/renders`, `document.querySelectorAll('[data-testid=render-row]').length > 0`);
  const row = '[data-testid=render-row][data-status=done]';
  s.step('The render queue: the finished render shows its loudness and problems');
  await s.rect(row);
  await s.frame();
  const text = (id) => s.evaluate(`${q(`${row} ${tid(id)}`)}?.textContent ?? null`);
  const loud = await text('render-loudness');
  expect('the row shows the measured loudness', /LUFS/.test(loud ?? ''), loud);
  expect('and whether the target was met', /Target (met|missed)|No target/.test((await text('loudness-met')) ?? ''), await text('loudness-met'));
  expect('and a one-sentence note on the master', (await text('loudness-note'))?.length > 10, await text('loudness-note'));
  expect('and how many problems there are', /problem|thing/i.test((await text('render-problems')) ?? ''), await text('render-problems'));

  s.step('Press "View report": the dialog opens');
  await s.click(`${row} ${tid('render-report-open')}`);
  await s.waitFor(`!!${q(tid('render-report'))}`, 'the report in the dialog');
  await s.sleep(800);
  await s.frame();
  const have = (id) => s.evaluate(`!!${q(`${tid('render-report')} ${tid(id)}`)}`);
  const dialogIds = ['report-probe', 'report-loudness', 'report-black', 'report-freezes', 'report-jumps', 'report-flashes', 'report-silences', 'report-narration'];
  const found = {};
  for (const id of dialogIds) found[id] = await have(id);
  expect('the probe table, loudness and every list are in the report', Object.values(found).every(Boolean), found);
  await s.waitFor(`document.querySelectorAll('${tid('render-report')} ${tid('report-sheet')}').length >= 1`, 'a frame sheet');
  await s.evaluate(`${q(`${tid('render-report')} ${tid('report-sheets')}`)}.scrollIntoView({ block: 'center' })`);
  await s.waitFor(`[...document.querySelectorAll('${tid('report-sheet')} img')].some((i) => i.complete && i.naturalWidth > 0)`, 'a loaded frame sheet');
  await s.sleep(400);
  await s.frame();
  const sheets = await s.evaluate(`[...document.querySelectorAll('${tid('report-sheet')} img')].map((i) => i.naturalWidth)`);
  expect('at least one frame sheet thumbnail loaded', sheets.some((w) => w > 0), sheets);
  expect('the dialog has the download links', (await s.evaluate(`['download-vtt','download-words','download-report'].every((id) => !!document.querySelector('[data-testid=render-report-dialog] [data-testid=' + id + ']'))`)), 'vtt, words, report');
  await s.evaluate(`${q(tid('report-probe'))}.scrollIntoView({ block: 'start' })`);
  await s.sleep(300);
  await s.shot(join(out, 'studio', 'v3-report-dialog.png'));
  s.step('Close the dialog');
  await s.click('[data-testid=render-report-dialog] button[aria-label=Close]');
  await s.waitFor(`!${q(tid('render-report-dialog'))}`, 'the dialog to close');
  expect('the dialog closed', true);

  s.step('Open the render in the gallery: the same report is a section of the page');
  await s.click(`${row} ${tid('open-in-gallery')}`);
  await s.waitFor(`location.pathname === '/gallery/1' && !!${q(tid('render-report-section'))} && !!${q(`${tid('render-report-section')} ${tid('report-probe')}`)}`, 'the gallery page with its report');
  await s.sleep(700);
  const hrefs = await s.evaluate(`Object.fromEntries(['download-vtt', 'download-words', 'download-report'].map((id) => [id, document.querySelector('[data-testid=' + id + ']')?.getAttribute('href') ?? null]))`);
  await s.evaluate(`${q(tid('render-report-section'))}.scrollIntoView({ block: 'start' })`);
  await s.sleep(400);
  await s.frame();
  expect('the gallery has all three download links', Object.values(hrefs).every(Boolean), hrefs);
  for (const [id, href] of Object.entries(hrefs)) {
    const r = await s.evaluate(`fetch(${JSON.stringify(href)}).then(async (r) => ({ status: r.status, bytes: (await r.text()).length }))`);
    expect(`${id} serves its file`, r.status === 200 && r.bytes > 0, { href, ...r });
  }
  expect('the gallery section has the loudness line and the frame sheets', (await s.evaluate(`!!${q(`${tid('render-report-section')} ${tid('render-loudness')}`)} && !!${q(`${tid('render-report-section')} ${tid('report-sheet')}`)}`)));
  await s.shot(join(out, 'studio', 'v3-report-gallery.png'));
});

// ---- 5. issues
await workflow('issues', 'run the clip checks, open an issue (playhead and still), an edit makes the list stale', async (s, expect) => {
  await openEditor(s);
  await s.rect(tid('issues-panel'));
  s.step('The issues panel. Press "Check the clip"');
  await s.frame();
  await s.evaluate(`(() => { const el = ${q(tid('issues-loading'))}; window.__sawLoading = !el.hidden; new MutationObserver(() => { if (!el.hidden) window.__sawLoading = true; }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); })()`);
  await s.click(tid('run-check'));
  await s.waitFor(`${q(tid('issues-count'))} && !${q(tid('issues-count'))}.hidden`, 'the result of the check', 90000);
  await s.sleep(500);
  const sawLoading = await s.evaluate('window.__sawLoading');
  const count = await s.evaluate(`${q(tid('issues-count'))}.textContent`);
  const n = await s.evaluate(`document.querySelectorAll('[data-testid=issue]').length`);
  await s.rect(tid('issues-panel'));
  await s.frame();
  expect('the panel showed that it was checking', sawLoading);
  expect('the count and the rows agree', n > 0 ? new RegExp(`^${n} issue`).test(count) : /No issues/.test(count), `${count} · ${n} rows`);

  if (n > 0) {
    const info = await s.evaluate(`(() => { const r = document.querySelector('[data-testid=issue]'); const m = /(\\d+):(\\d+(?:\\.\\d+)?)/.exec(r.querySelector('.timecode').textContent); return { t: Number(m[1]) * 60 + Number(m[2]), check: r.dataset.check, item: r.dataset.item, text: r.textContent }; })()`);
    s.step(`Click the first issue (${info.check} at ${info.t.toFixed(2)} s): the playhead goes there and the kept frame shows`);
    await s.click('[data-testid=issue]');
    await s.waitFor(`Math.abs(Number(${q(tid('scrub'))}.value) - ${info.t}) < 0.1`, 'the playhead at the issue');
    await s.waitFor(`!!${q(tid('issue-still'))}`, 'the still of the issue');
    await s.waitFor(`${q(tid('issue-still'))}.complete && ${q(tid('issue-still'))}.naturalWidth > 0`, 'the still to load');
    await s.rect(tid('issue-still'));
    await s.sleep(300);
    await s.frame();
    const still = await s.evaluate(`({ w: ${q(tid('issue-still'))}.naturalWidth, h: ${q(tid('issue-still'))}.naturalHeight })`);
    expect('the playhead moved to the time of the issue', near(await clock(s), info.t, 0.1), { issue: info.t, playhead: await clock(s) });
    expect('the still is an image that loaded', still.w > 0 && still.h > 0, still);
    if (info.item) expect('the item of the issue is selected', (await s.evaluate(`${q(tid('selected-id'))}?.textContent`)) === info.item, info.item);
  } else {
    expect('no issues: the panel says so', /No issues/.test(await s.evaluate(`${q(tid('issues-list'))}.textContent`)));
  }
  expect('nothing says the list is stale yet', await s.evaluate(`${q(tid('issues-stale'))}.hidden`));

  s.step('Edit the clip: drag the item "title" a little later');
  await s.evaluate('window.scrollTo(0, 0)');
  const it = await s.rect('[data-testid=item][data-id=title]');
  await s.drag({ x: it.x + it.width * 0.25, y: it.cy }, { x: it.x + it.width * 0.25 + 40, y: it.cy });
  await s.waitFor(`!${q(tid('issues-stale'))}.hidden`, 'the stale notice');
  await s.rect(tid('issues-stale'));
  await s.frame();
  expect('the list says the clip has changed since the check', !(await s.evaluate(`${q(tid('issues-stale'))}.hidden`)) && !(await s.evaluate(`${q(tid('unsaved'))}.hidden`)), await s.evaluate(`${q(tid('issues-stale'))}.textContent`));
  await s.rect(tid('issues-panel'));
  await s.evaluate(`${q(tid('issues-panel'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(300);
  await s.shot(join(out, 'studio', 'v3-issues.png'));
});

// ---- 6. overlays
/** The overlay layer's shapes. */
const shapes = (s) => s.evaluate(`(() => { const l = ${q(tid('overlay-layer'))}; return { zones: [...l.querySelectorAll('[data-testid=overlay-zone]')].map((z) => z.dataset.zone), gridLines: l.querySelectorAll('.ov-grid line').length, texts: l.querySelectorAll('[data-testid=overlay-text-box]').length, children: l.children.length }; })()`);
const pressed = (s, id) => s.evaluate(`${q(tid(id))}.getAttribute('aria-pressed')`);

await workflow('overlays', 'grid, safe areas, platform, caption lane and text boxes over the preview; never in the pixels of the canvas', async (s, expect, phone) => {
  await openEditor(s);
  s.step('Seek to 1.5 s, where the title is on screen');
  await s.evaluate(setValue(tid('scrub'), 1.5));
  await s.sleep(900);
  await s.evaluate(`${q(tid('overlay-layer'))}.scrollIntoView({ block: 'center' })`);
  await s.frame();
  const clean = await pixels(s);
  const none = await shapes(s);
  expect('with every overlay off the layer is empty', none.children === 0, none);

  s.step('Grid');
  await s.click(tid('overlay-grid'));
  const g = await shapes(s);
  expect('the grid draws thirds and a centre cross (6 lines)', (await pressed(s, 'overlay-grid')) === 'true' && g.gridLines === 6 && g.zones.length === 0, g);

  s.step('Safe areas');
  await s.click(tid('overlay-safe'));
  const sa = await shapes(s);
  expect('safe areas add the title-safe, action-safe and f.safe zones', ['title-safe', 'action-safe', 'f-safe'].every((z) => sa.zones.includes(z)) && sa.zones.length === 3, sa.zones);

  s.step('Platform');
  const enabled = await s.evaluate(`!${q(tid('overlay-platform'))}.disabled`);
  await s.click(tid('overlay-platform'));
  const pl = await shapes(s);
  expect('the platform button is enabled (the clip names a platform) and its zone is drawn', enabled && pl.zones.includes('platform'), pl.zones);

  s.step('Caption lane');
  await s.click(tid('overlay-lane'));
  const la = await shapes(s);
  expect('the caption lane is drawn', la.zones.includes('lane') && la.zones.length === 5, la.zones);

  s.step('Text boxes');
  await s.click(tid('overlay-text'));
  await s.waitFor(`document.querySelectorAll('[data-testid=overlay-text-box]').length > 0`, 'boxes around the text on screen');
  await s.sleep(500);
  const tx = await shapes(s);
  const items = await s.evaluate(`[...document.querySelectorAll('[data-testid=overlay-text-box]')].map((b) => b.dataset.item)`);
  await s.frame();
  expect('boxes appear for the text on screen, named by item', tx.texts >= 1 && items.every(Boolean), items);
  const all = await pixels(s);
  await s.shot(join(out, 'studio', 'v3-overlays.png'));
  expect('with every overlay on, the canvas has the very same pixels', all.hash === clean.hash && all.w === clean.w, { off: clean.hash, on: all.hash, size: `${all.w}×${all.h}` });

  s.step('Switch them off again, one by one');
  for (const id of ['overlay-text', 'overlay-lane', 'overlay-platform', 'overlay-safe', 'overlay-grid']) await s.click(tid(id));
  await s.sleep(400);
  const off = await shapes(s);
  const again = await pixels(s);
  expect('every toggle is off and the layer is empty again', off.children === 0, off);
  expect('and the canvas is unchanged', again.hash === clean.hash, { before: clean.hash, after: again.hash });
  expect('no overlay toggle stayed pressed', (await s.evaluate(`['grid','safe','platform','lane','text'].every((k) => ${q(tid('overlay-grid'))}.parentElement.querySelector('[data-testid=overlay-' + k + ']').getAttribute('aria-pressed') === 'false')`)));

  await phone(async (p, expectP) => {
    await openEditor(p);
    p.step('On a phone: seek to 1.5 s and tap Grid, Safe areas, Caption lane and Text boxes');
    await p.evaluate(setValue(tid('scrub'), 1.5));
    await p.sleep(900);
    const before = await pixels(p);
    for (const id of ['overlay-grid', 'overlay-safe', 'overlay-lane', 'overlay-text']) await tapAt(p, tid(id));
    await p.waitFor(`document.querySelectorAll('[data-testid=overlay-text-box]').length > 0`, 'text boxes on the phone');
    await p.sleep(500);
    const sh = await shapes(p);
    expectP('the overlays draw on the phone as well', sh.gridLines === 6 && sh.zones.includes('title-safe') && sh.zones.includes('lane') && sh.texts >= 1, sh);
    const during = await pixels(p);
    expectP('and leave the canvas pixels alone', during.hash === before.hash, { off: before.hash, on: during.hash });
    await p.evaluate(`${q(tid('overlay-layer'))}.scrollIntoView({ block: 'center' })`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v3-overlays-mobile.png'));
  });
});

writeFileSync(join(out, 'reports', 'workflows-v3.json'), `${JSON.stringify({ what: 'Iteration-3 studio workflows driven in headless Chrome with real mouse, keyboard and touch input (scripts/workflows-v3.mjs); every check is asserted by the script.', base, clip: CLIP, workflows: report }, null, 1)}\n`);
console.log(failed ? '\nworkflows: FAILED' : '\nworkflows: all checks passed');
process.exit(failed ? 1 : 0);
