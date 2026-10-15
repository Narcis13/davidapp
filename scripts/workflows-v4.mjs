// The studio's iteration-4 workflows, driven in headless Chrome with real input (mouse presses and drags,
// keys, typed text, files dropped from outside the browser, touch taps on the phone sessions) against a
// running studio, each step checked as it goes and each workflow written as a GIF plus stills. The sibling
// of scripts/workflows-v3.mjs: same driver (scripts/lib/browser.mjs), same output and report shape. They change
// the data they run on (they save clips and add assets), so point them at a copy of the showcase with the
// iteration-3 dev seed on top, never at a library you want to keep:
//
//   bash .claude/goal-loop/serve.sh seed <port> <dir>
//   STUDIO_DATA=<dir> node scripts/dev-seed-v3.mjs --no-render
//   STUDIO_DATA=<dir> node scripts/workflows-v4.mjs http://127.0.0.1:<port> [out-dir] [workflow …]
//
//   captions   caption pages on the timeline (clip v3-demo): split at a word, merge two pages (button), move a break by
//              dragging a page's start edge, merge with the J key and undo, split at the playhead, save; through the API
//              the words and their times did not change and the SRT changed as expected
//   footage    a test video made with FFmpeg (testsrc2 and a tone) dropped on the library, added to a clip from the
//              picker, trimmed on the timeline, speed and loop set in the inspector, its sound added, the preview played
//   font       a TTF dropped on the library: the form asks for the licence; the family is in the font menu and on its page
//   provenance images dropped with and without a licence (the upload says an unknown one is refused by a final render); the
//              asset page's Source and licence panel edited (licence, creator, placeholder) with the badge following; the
//              clip's Credits panel names the problem; a final render is refused in the render panel with the server's
//              message; the placeholder cleared, the final render goes through and its credits link is on the render
//   render     the editor's render panel: a draft with two workers and a poster at the playhead, then one request for
//              three shapes (grouped on the queue); the Repo panel shows the changes and Write to repo writes them
//              (needs STUDIO_REPO set to a scratch folder, for the server and for this script)
//   kit        the library's Kit filter; three kit assets opened in the playground, a parameter changed in each
//
// Each runs at 1440×900 and, as a follow-up, at 390×844 with touch. out-dir (default docs/showcase/v4) gets
// gifs/<name>.gif and gifs/<name>-mobile.gif, studio/v4-<name>*.png and reports/workflows-v4.json. Exits 1 when a
// check fails or the page logs a problem.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession } from './lib/browser.mjs';
import { ROOT } from '../src/render/host.js';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';
import { structureOf, toSrt } from '../src/core/captions.js';

const [base, outArg, ...names] = process.argv.slice(2);
if (!base) { console.error('usage: STUDIO_DATA=<dir> node scripts/workflows-v4.mjs <base-url> [out-dir] [workflow …]'); process.exit(2); }
const out = outArg ?? join(ROOT, 'docs', 'showcase', 'v4');
for (const d of ['gifs', 'studio', 'reports']) mkdirSync(join(out, d), { recursive: true });
const CAPS_CLIP = 'v3-demo';
const FOOT_CLIP = 'v4-footage';
const report = {};
let failed = false;

/**
 * One workflow: its own browser session; `expect` records a named check. `fn` gets a `phone(fn)` that runs a short
 * follow-up on a 390×844 touch session (its own GIF, its problems counted here).
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
      await p.shot(join(out, 'studio', `v4-${name}-mobile-failed.png`)).catch(() => {});
    }
    extra.mobileFrames = await p.gif(join(out, 'gifs', `${GIF[name]}-mobile.gif`), { width: 390 }).catch((e) => { error ??= e.message; return 0; });
    problems.push(...p.problems.map((x) => `phone: ${x}`));
    await p.close();
  };
  try {
    await fn(s, expect, phone);
  } catch (e) {
    error = e.message;
    console.log(`  ✖ ${e.message}`);
    failed = true;
    await s.shot(join(out, 'studio', `v4-${name}-failed.png`)).catch(() => {});
  }
  const frames = await s.gif(join(out, 'gifs', `${GIF[name]}.gif`)).catch((e) => { error ??= e.message; return 0; });
  problems.push(...s.problems);
  if (problems.length) { failed = true; for (const p of problems) console.log(`  CONSOLE ${p}`); }
  report[name] = { what, checks, consoleProblems: problems, gif: `gifs/${GIF[name]}.gif`, frames, ...(extra.mobileFrames !== undefined ? { mobileGif: `gifs/${GIF[name]}-mobile.gif`, mobileFrames: extra.mobileFrames } : {}), ...(error ? { error } : {}) };
  await s.close();
}
const GIF = { captions: 'captions-editor', footage: 'footage-timeline', font: 'font-upload', provenance: 'provenance-licence', render: 'render-options-repo', kit: 'kit-playground' };

// ---- helpers that run in the page
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const tid = (id) => `[data-testid=${id}]`;
const setValue = (sel, value, event = 'input') => `(() => { const el = ${q(sel)}; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('${event}', { bubbles: true })); })()`;
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const get = (s, path) => s.evaluate(`fetch(${JSON.stringify(path)}).then((r) => (r.ok ? r.json() : null))`);
const post = (s, path, body) => s.evaluate(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.json())`);
/** A hash of the preview's pixels as the user sees them (the canvas copied to a 2D canvas). */
const pixels = (s, wait = 700) => s.evaluate(`(async () => { const c = ${q(tid('preview-canvas'))}; await new Promise((r) => setTimeout(r, ${wait})); const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const g = k.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, k.width, k.height).data; let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return { hash: h >>> 0, w: k.width, h: k.height }; })()`);
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
const handled = new WeakSet();
async function leave(s, url, ready) {
  // a draft with unsaved changes asks "leave the page?": the workflow leaves anyway
  if (!handled.has(s)) { handled.add(s); s.onEvent((m) => { if (m === 'Page.javascriptDialogOpening') s.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }); }
  await s.evaluate(`window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true)`).catch(() => {});
  await s.goto(url, ready);
}
async function openEditor(s, clip, ready) {
  await leave(s, `${base}/clips/${clip}`, ready ?? `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  await s.evaluate('window.scrollTo(0, 0)');
  await s.sleep(500);
}
/** Save the draft and wait until the studio has the next revision. */
async function save(s, clip) {
  const rev = (await get(s, `/api/clips/${clip}`)).revision;
  await s.evaluate('window.scrollTo(0, 0)');
  await s.click(tid('save'));
  await s.waitFor(`fetch('/api/clips/${clip}').then((r) => r.json()).then((c) => c.revision > ${rev})`, 'the saved revision');
  await s.waitFor(`${q(tid('unsaved'))}?.hidden === true`, 'the unsaved badge to go');
  return get(s, `/api/clips/${clip}`);
}
/** What a page of the layout must satisfy: no sideways scroll, no text cut off, and (on a phone) controls a finger can hit. */
async function layoutOf(s, mobile) {
  return s.evaluate(`(() => {
    const doc = document.documentElement;
    const clipped = [];
    for (const el of document.querySelectorAll('main *, dialog[open] *')) {
      if (el.closest('.timeline, .vgrid-scroll, pre, .tl-lane, .footage-along, svg, canvas, select, option, .picker-option, .upload-name, .upload-note, .stage')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
      if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && (el.textContent ?? '').trim()) clipped.push(el.tagName.toLowerCase() + '.' + el.className + ': ' + el.textContent.trim().slice(0, 40));
    }
    const small = [];
    if (${mobile}) {
      for (const el of document.querySelectorAll('main button:not(:disabled), main input:not([type=hidden]):not(.visually-hidden), main select, dialog[open] button, dialog[open] input, dialog[open] select, main [role=button]')) {
        if (el.closest('.timeline, .vgrid-scroll, .tl-lane, .vcard, .layer-row, .tl-flags') || el.type === 'checkbox' || el.type === 'range' || el.classList.contains('visually-hidden')) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 32 || r.width < 32) && getComputedStyle(el).visibility !== 'hidden') small.push((el.dataset.testid ?? el.tagName.toLowerCase()) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
    return { overflowX: Math.max(0, doc.scrollWidth - innerWidth), clipped: clipped.slice(0, 6), small: small.slice(0, 8) };
  })()`);
}
const checkLayout = async (s, expect, label, mobile) => {
  const l = await layoutOf(s, mobile);
  expect(`${label}: no sideways scroll, no text cut off${mobile ? ', controls big enough to tap' : ''}`, l.overflowX === 0 && !l.clipped.length && !l.small.length, l);
};

// ---- 1. captions
const pageList = (s) => s.evaluate(`[...document.querySelectorAll('[data-testid=caption-page]')].map((p) => ({ index: Number(p.dataset.index), key: p.dataset.key, start: Number(p.dataset.start), end: Number(p.dataset.end), selected: p.classList.contains('selected'), words: [...p.querySelectorAll('[data-testid=caption-word]')].map((w) => w.dataset.key) }))`);
const srtText = (s) => s.evaluate(`${q(tid('srt-preview'))}.textContent`);
const keysOf = (pages) => pages.map((p) => p.key);

await workflow('captions', 'caption pages on the timeline: split at a word, merge two pages, move a break by dragging, undo, split at the playhead; the words and their times stay as they were', async (s, expect, phone) => {
  await openEditor(s, CAPS_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=caption-page]').length > 0`);
  const clip0 = await get(s, `/api/clips/${CAPS_CLIP}`);
  const words0 = clip0.words;
  const auto0 = await post(s, `/api/clips/${CAPS_CLIP}/bundle`, { composition: clip0.composition });
  const srt0 = toSrt(auto0.captions);
  s.step('The caption lane under the narration: a block per page, the words at their times');
  await s.evaluate(`${q(tid('caption-lane'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(400);
  await s.frame();
  let pages = await pageList(s);
  const shown = await srtText(s);
  expect('the lane shows the studio\'s pages, one block each', pages.length === clip0.captions.length && keysOf(pages).join() === clip0.captions.map((p) => p.keys.start).join(), keysOf(pages));
  expect('each page holds its words as chips (all 21 words of the narration)', pages.flatMap((p) => p.words).length === words0.length && pages.flatMap((p) => p.words).join() === words0.map((w) => w.key).join());
  expect('the SRT preview is what a render would write', shown === srt0, shown.split('\n\n').length - 1 + ' cues');
  expect('with no structure of its own yet: the pages are chosen by the rules', (await s.evaluate(`${q(tid('captions-panel'))}.dataset.structure`)) === 'automatic');

  // 1. split: click a word inside the second page
  const andKey = 'vo:10';
  s.step('Click the word "and" inside page 2: a new page starts there');
  await s.click(`[data-testid=caption-word][data-key="${andKey}"]`);
  await s.waitFor(`document.querySelectorAll('[data-testid=caption-page]').length === 4`, 'a fourth page');
  await s.sleep(900);
  pages = await pageList(s);
  await s.frame();
  expect('page 2 split at "and": four pages, the new one starts on that word', keysOf(pages).join() === 'vo:0,vo:7,vo:10,vo:14', keysOf(pages));
  expect('the new page is selected', pages[2].selected && pages.filter((p) => p.selected).length === 1);
  expect('the SRT preview has four cues', (await srtText(s)).trim().split('\n\n').length === 4);

  // 2. merge two neighbours: select pages 3 and 4, press the button
  s.step('Select page 3, Shift-click page 4 and press Merge pages');
  await s.click(`[data-testid=caption-page][data-index="2"] .tl-cap-head`);
  await s.click(`[data-testid=caption-page][data-index="3"] .tl-cap-head`, { modifiers: ['shift'] });
  pages = await pageList(s);
  expect('two neighbouring pages are selected and the button is ready', pages[2].selected && pages[3].selected && !(await s.evaluate(`${q(tid('caption-merge'))}.disabled`)), await s.evaluate(`${q(tid('caption-selection'))}.textContent`));
  await s.click(tid('caption-merge'));
  await s.waitFor(`document.querySelectorAll('[data-testid=caption-page]').length === 3`, 'the merged pages');
  await s.sleep(900);
  pages = await pageList(s);
  await s.frame();
  expect('the pages joined: three pages, the break after "and" is gone', keysOf(pages).join() === 'vo:0,vo:7,vo:10', keysOf(pages));
  expect('the merged page holds the words of both', pages[2].words.length === 11 && pages[2].words[0] === 'vo:10' && pages[2].words[10] === 'vo:20', pages[2].words.length);

  // 3. move a break: drag the start edge of page 3 onto the word "the"
  s.step('Drag the left edge of page 3 onto the word "the": the break moves to that word');
  await s.evaluate(`${q(tid('caption-lane'))}.scrollIntoView({ block: 'center' })`);
  const edge = await s.rect(`[data-testid=caption-edge][data-page="2"]`);
  const target = await s.rect(`[data-testid=caption-word][data-key="vo:11"]`);
  await s.drag({ x: edge.cx, y: edge.cy }, { x: target.cx, y: edge.cy }, { during: async () => ({ lit: await s.evaluate(`document.querySelector('.tl-cap-word.target')?.dataset.key`), line: await s.evaluate(`!${q(tid('time-snap'))}.hidden`) }) });
  await s.waitFor(`document.querySelector('[data-testid=caption-page][data-index="2"]')?.dataset.key === 'vo:11'`, 'the break on the new word');
  await s.sleep(900);
  pages = await pageList(s);
  await s.frame();
  expect('page 3 now starts on "the", and page 2 took "and"', keysOf(pages).join() === 'vo:0,vo:7,vo:11' && pages[1].words.at(-1) === 'vo:10', keysOf(pages));
  const afterMove = await srtText(s);
  expect('the SRT preview follows', /Change the words, and\n/.test(afterMove) && afterMove.includes('the captions follow.'), afterMove.split('\n\n')[1]);
  const issues = await s.evaluate(`!${q(tid('issues-stale'))}.hidden || ${q(tid('issues-panel'))} !== null`);
  expect('the issues panel is there to check the new pages', issues);

  // 4. merge with the key, then undo
  s.step('Select page 2 and press J: it merges with the next page. Then Ctrl+Z');
  await s.click(`[data-testid=caption-page][data-index="1"] .tl-cap-head`);
  const srtBeforeJ = await srtText(s);
  await s.key('j');
  await s.waitFor(`document.querySelectorAll('[data-testid=caption-page]').length === 2`, 'the J merge');
  await s.sleep(700);
  await s.frame();
  expect('J merged the selected page with the next', (await pageList(s)).length === 2 && (await srtText(s)) !== srtBeforeJ);
  await s.key('z', { modifiers: ['ctrl'] });
  await s.waitFor(`document.querySelectorAll('[data-testid=caption-page]').length === 3`, 'undo to bring the pages back');
  await s.sleep(900);
  await s.frame();
  pages = await pageList(s);
  expect('undo gave the three pages and the SRT back', keysOf(pages).join() === 'vo:0,vo:7,vo:11' && (await srtText(s)) === srtBeforeJ);

  // 5. split at the playhead
  const whileWord = words0.find((w) => w.key === 'vo:18');
  s.step(`Put the playhead on "${whileWord.text}" and press Split at the playhead`);
  await s.evaluate(setValue(tid('scrub'), (whileWord.start + 0.05).toFixed(2)));
  await s.sleep(500);
  await s.click(tid('caption-split'));
  await s.waitFor(`document.querySelectorAll('[data-testid=caption-page]').length === 4`, 'the split at the playhead');
  await s.sleep(900);
  pages = await pageList(s);
  await s.frame();
  expect('a new page starts on the word under the playhead', keysOf(pages).join() === 'vo:0,vo:7,vo:11,vo:18', keysOf(pages));

  // save, and check through the API
  s.step('Save: the composition keeps only the structure');
  const saved = await save(s, CAPS_CLIP);
  const stored = saved.composition.captions;
  expect('the saved composition stores which word starts each page, never a time', JSON.stringify(stored.pages.map((p) => p.start)) === JSON.stringify(['vo:0', 'vo:7', 'vo:11', 'vo:18']) && stored.pages.every((p) => typeof p.start === 'string' && (p.lines ?? []).every((l) => typeof l === 'string')) && !/"(start|end|t)":\s*\d/.test(JSON.stringify(stored)), stored);
  expect('the words and their times did not change', JSON.stringify(saved.words) === JSON.stringify(words0), `${saved.words.length} words`);
  const after = await post(s, `/api/clips/${CAPS_CLIP}/bundle`, { composition: saved.composition });
  const srt1 = toSrt(after.captions);
  const cues0 = srt0.trim().split('\n\n'), cues1 = srt1.trim().split('\n\n');
  expect('the SRT of the next render has the four pages', cues1.length === 4 && after.captions.map((p) => p.keys.start).join() === 'vo:0,vo:7,vo:11,vo:18', cues1.length);
  expect('its first cue is the one it was (page 1 was not touched)', cues1[0] === cues0[0]);
  expect('and the others read the way the pages were cut', /Change the words, and/.test(cues1[1].replace(/\n/g, ' ')) && /^the captions follow\. The music steps/.test(cues1[2].split('\n').slice(2).join(' ')) && /while I speak\.$/.test(cues1[3].replace(/\n/g, ' ')), cues1.slice(1));
  const wordAt = Object.fromEntries(words0.map((w) => [w.key, w]));
  expect('every cue starts at its first word (up to the lead of 2 frames) and ends after its last', after.captions.every((p) => p.start <= wordAt[p.keys.start].start + 1e-6 && p.start >= wordAt[p.keys.start].start - 2 / clip0.fps - 0.002 && p.end >= wordAt[p.lines.flat().at(-1).key].end - 1e-6), after.captions.map((p) => `${p.start}-${p.end}`));
  expect('the SRT preview in the editor is that very text', (await srtText(s)) === srt1);
  expect('the structure of the saved pages is the one the core functions give', JSON.stringify(structureOf(after.captions).map((p) => p.start)) === JSON.stringify(stored.pages.map((p) => p.start)));
  await s.evaluate(`${q(tid('caption-lane'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(400);
  await s.frame();
  await s.shot(join(out, 'studio', 'v4-captions.png'));
  await s.evaluate(`${q(tid('captions-panel'))}.scrollIntoView({ block: 'start' })`);
  await s.sleep(300);
  await s.shot(join(out, 'studio', 'v4-captions-panel.png'));
  await checkLayout(s, expect, 'desktop', false);

  await phone(async (p, expectP) => {
    await openEditor(p, CAPS_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=caption-page]').length > 0`);
    p.step('On a phone: the caption lane, the pages as blocks (saved pages)');
    await p.evaluate(`${q(tid('caption-lane'))}.scrollIntoView({ block: 'center' })`);
    await p.sleep(500);
    await p.frame();
    const n = (await pageList(p)).length;
    expectP('the saved pages show on the phone', n === 4, n);
    p.step('Tap page 2, then Merge pages');
    await tapAt(p, `[data-testid=caption-page][data-index="1"] .tl-cap-head`, 0.5);
    await p.waitFor(`document.querySelector('[data-testid=caption-page][data-index="1"]').classList.contains('selected')`, 'the page to be selected');
    await tapAt(p, tid('caption-merge'));
    await p.waitFor(`document.querySelectorAll('[data-testid=caption-page]').length === 3`, 'the merge by touch');
    await p.sleep(900);
    await p.evaluate(`${q(tid('captions-panel'))}.scrollIntoView({ block: 'start' })`);
    await p.sleep(400);
    await p.frame();
    expectP('a tap selected the page and the button merged it with the next', (await pageList(p)).length === 3);
    await p.shot(join(out, 'studio', 'v4-captions-mobile.png'));
    await p.evaluate(`${q(tid('caption-lane'))}.scrollIntoView({ block: 'center' })`);
    await p.sleep(300);
    await p.shot(join(out, 'studio', 'v4-captions-lane-mobile.png'));
    await checkLayout(p, expectP, 'captions panel', true);
  });
});

// ---- 2. footage
/** Make the test video: testsrc2 at 25 fps with a tone (the picture and the sound both say where they are). */
async function makeVideo() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'v4-video-'));
  const file = join(dir, 'testsrc2-tone.mp4');
  const r = await run(ffmpegPath(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '25', '-b:v', '2500k', '-c:a', 'aac', '-shortest', file]);
  if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return file;
}
const itemBox = (s, id) => s.rect(`[data-testid=item][data-id="${id}"]`);
const field = (s, id) => s.evaluate(`Number(${q(tid(id))}.value)`);

await workflow('footage', 'a video file dropped on the library, added to a clip, trimmed on the timeline, speed and loop in the inspector, its sound added, the preview played', async (s, expect, phone) => {
  const video = await makeVideo();
  // a clip to put it in (made through the API: this workflow is about the footage)
  await get(s, '/api/status').catch(() => null);
  await leave(s, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
  const made = await post(s, '/api/clips', { name: FOOT_CLIP, title: 'Footage on the timeline', format: 'horizontal', fps: 30, duration: 10 });
  expect('a clip of 10 s to work in', made.slug === FOOT_CLIP || made.error?.includes('already'), made.slug ?? made.error);

  s.step('Drop the test video (testsrc2 with a tone) on the library page');
  await s.dropFiles({ x: 720, y: 450 }, [video]);
  await s.waitFor(`document.querySelector('[data-testid=upload-row][data-kind=video]')`, 'the upload row');
  await s.frame();
  await s.waitFor(`document.querySelector('[data-testid=upload-row][data-kind=video]').dataset.state === 'done'`, 'the video to be added', 90000);
  const row = await s.evaluate(`(() => { const r = document.querySelector('[data-testid=upload-row][data-kind=video]'); return { state: r.dataset.state, progress: r.dataset.progress, text: r.textContent }; })()`);
  await s.sleep(500);
  await s.frame();
  expect('the row says Added, with the size, the rate and the sound the file has', /Added/.test(row.text) && /640×360/.test(row.text) && /25 fps/.test(row.text) && /with sound/.test(row.text), row.text);
  expect('the upload was streamed with progress to 100 %', row.progress === '100', row.progress);
  const slug = /testsrc2-tone/.test(row.text) ? 'testsrc2-tone' : null;
  expect('the studio named it from the file', slug === 'testsrc2-tone', row.text);
  const asset = await get(s, `/api/assets/${slug}`);
  expect('it is a footage asset with its frame table, strip and waveform', asset.type === 'video' && asset.meta.frames === 200 && asset.meta.fps === 25 && !!asset.meta.strip && !!asset.meta.wave, { frames: asset.meta.frames, fps: asset.meta.fps });
  await s.shot(join(out, 'studio', 'v4-footage-upload.png'));

  s.step('The footage page: its frames from the server, the facts, filmstrip and waveform');
  await leave(s, `${base}/assets/${slug}`, `document.querySelector('[data-testid=footage-frame]')?.complete`);
  await s.sleep(500);
  await s.click(tid('footage-next'));
  await s.click(tid('footage-next'));
  await s.waitFor(`${q(tid('footage-frame'))}.dataset.frame === '2'`, 'frame 2');
  await s.evaluate(`window.scrollTo(0, 0)`);
  await s.frame();
  expect('stepping goes frame by frame and the readout follows', (await s.evaluate(`${q(tid('footage-readout'))}.textContent`)).startsWith('frame 2 of 200'));
  await s.evaluate(`${q(tid('footage-play'))}.click()`);
  await s.sleep(900);
  const playing = await s.evaluate(`({ on: ${q(tid('footage-play'))}.dataset.playing, frame: Number(${q(tid('footage-frame'))}.dataset.frame) })`);
  await s.evaluate(`${q(tid('footage-play'))}.click()`);
  expect('play runs the frames at the file\'s own rate', playing.on === 'true' && playing.frame > 8, playing);
  await s.shot(join(out, 'studio', 'v4-footage-page.png'), { full: true });

  // the editor
  await openEditor(s, FOOT_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined`);
  s.step('Add item → Footage: pick the video');
  await s.click(tid('add-item'));
  await s.waitFor(`document.querySelector('[data-testid=asset-picker]')`, 'the picker');
  await s.click(`[data-testid=picker-kind][data-kind=footage]`);
  await s.waitFor(`document.querySelector('[data-testid=picker-option][data-slug="${slug}"]')`, 'the footage in the list');
  await s.frame();
  await s.click(`[data-testid=picker-option][data-slug="${slug}"]`);
  await s.waitFor(`document.querySelector('[data-testid=item][data-asset^="${slug}@"]')`, 'the footage item on the timeline');
  const id = await s.evaluate(`${q(`[data-testid=item][data-asset^="${slug}@"]`)}.dataset.id`);
  await s.waitFor(`document.querySelectorAll('[data-testid=filmstrip] img').length > 1 && [...document.querySelectorAll('[data-testid=filmstrip] img')].every((i) => i.complete && i.naturalWidth > 0)`, 'the filmstrip frames', 30000);
  await s.sleep(500);
  const added = await s.evaluate(`(() => { const b = ${q(`[data-testid=item][data-id="${id}"]`)}; const r = ${q(tid('ruler'))}.getBoundingClientRect(); return { width: b.getBoundingClientRect().width, left: b.getBoundingClientRect().left - r.left, cells: b.querySelectorAll('[data-testid=filmstrip] img').length }; })()`);
  await s.evaluate(`${q(tid('timeline'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(300);
  await s.frame();
  expect('the item takes the file\'s own length (8 s) with a filmstrip of a few frames', added.cells >= 3 && added.cells <= 12 && near(added.width / added.width * 8, 8, 0.01), added);
  await s.click({ x: (await itemBox(s, id)).x + 60, y: (await itemBox(s, id)).cy });
  await s.waitFor(`${q(tid('selected-id'))}?.textContent === ${JSON.stringify(id)} && !!${q(tid('footage-section'))}`, 'the footage section of the inspector');
  const pps = added.width / 8;
  const f0 = { start: await field(s, 'item-start'), duration: await field(s, 'item-duration'), in: await field(s, 'footage-in'), speed: await field(s, 'footage-speed') };
  expect('the inspector shows the file facts and in, out, speed, loop and hold', f0.start === 0 && f0.duration === 8 && f0.in === 0 && f0.speed === 1 && !!(await s.evaluate(`${q(tid('footage-facts'))}`)) && !!(await s.evaluate(`${q(tid('footage-hold-on'))}`)) && !!(await s.evaluate(`${q(tid('footage-loop'))}`)));
  expect('and the frame next to the in point', (await s.evaluate(`${q(tid('footage-in-frame'))}.textContent`)) === 'frame 0');
  await s.evaluate(setValue(tid('scrub'), '3'));
  const before = await pixels(s);
  s.step('Drag the left edge of the item 1.5 s to the right: it trims in');
  const box = await itemBox(s, id);
  await s.drag({ x: box.x + 3, y: box.cy }, { x: box.x + 3 + 1.5 * pps, y: box.cy });
  await s.sleep(500);
  const t1 = { start: await field(s, 'item-start'), duration: await field(s, 'item-duration'), in: await field(s, 'footage-in') };
  await s.frame();
  expect('start and in moved together, the end stayed where it was', near(t1.start, 1.5, 0.11) && near(t1.in, t1.start, 0.011) && near(t1.start + t1.duration, 8, 0.011), t1);
  expect('the in point shows its frame', (await s.evaluate(`${q(tid('footage-in-frame'))}.textContent`)) === `frame ${Math.floor(t1.in * 25 + 1e-6)}`, await s.evaluate(`${q(tid('footage-in-frame'))}.textContent`));
  await s.evaluate(setValue(tid('scrub'), '3'));
  const afterIn = await pixels(s);
  expect('the picture at 3 s is the very same frame as before the trim', afterIn.hash === before.hash, { before: before.hash, after: afterIn.hash });

  s.step('Drag the right edge 2 s to the left: it trims out');
  const box2 = await itemBox(s, id);
  await s.drag({ x: box2.x + box2.width - 3, y: box2.cy }, { x: box2.x + box2.width - 3 - 2 * pps, y: box2.cy });
  await s.sleep(500);
  const t2 = { start: await field(s, 'item-start'), duration: await field(s, 'item-duration'), in: await field(s, 'footage-in'), out: await field(s, 'footage-out') };
  await s.frame();
  expect('out is the point of the file the item ends on', near(t2.out, t2.in + t2.duration, 0.011) && near(t2.out, 6, 0.11) && near(t2.start, t1.start, 0.001), t2);
  await s.evaluate(setValue(tid('scrub'), '3'));
  expect('and the picture at 3 s did not move either', (await pixels(s)).hash === before.hash);

  s.step('Speed 2 and Loop in the inspector');
  await fill(s, tid('footage-speed'), '2');
  await s.click(`label[for="${await s.evaluate(`${q(tid('footage-loop'))}.id`)}"]`, { settle: 200 }).catch(() => {});
  if (!(await s.evaluate(`${q(tid('footage-loop'))}.checked`))) await s.evaluate(`${q(tid('footage-loop'))}.click()`);
  await s.sleep(500);
  await s.frame();
  expect('speed 2 and loop are set', (await field(s, 'footage-speed')) === 2 && (await s.evaluate(`${q(tid('footage-loop'))}.checked`)));
  const faster = await pixels(s);
  expect('at speed 2 the same clip time shows another frame', faster.hash !== before.hash);

  s.step('Play its sound: the file goes on an audio track and its waveform shows');
  await s.click(tid('footage-add-sound'));
  await s.waitFor(`document.querySelectorAll('[data-testid=footage-wave]').length >= 1 && !!document.querySelector('.tl-item.audio.footage')`, 'the waveform of the sound');
  await s.evaluate(`${q(tid('timeline'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(600);
  await s.frame();
  const snd = await s.evaluate(`(() => { const b = document.querySelector('.tl-item.audio.footage'); return { id: b.dataset.id, track: b.dataset.track, wave: !!b.querySelector('[data-testid=footage-wave]') }; })()`);
  expect('an audio item of the same file, with the file\'s own waveform', snd.track === 'footage-sound' && snd.wave, snd);

  s.step('Trim the start of the sound: it starts further into the file by as much');
  const sb = await itemBox(s, snd.id);
  await s.drag({ x: sb.x + 3, y: sb.cy }, { x: sb.x + 3 + 0.5 * pps, y: sb.cy });
  await s.sleep(400);
  await s.waitFor(`${q(tid('selected-id'))}?.textContent === ${JSON.stringify(snd.id)} && !!${q(tid('item-offset'))}`, 'the sound item in the inspector');
  const trimmed = { start: await field(s, 'item-start'), duration: await field(s, 'item-duration'), offset: await s.evaluate(`(() => { const m = /(\\d+):(\\d+\\.\\d+) into/.exec(${q(tid('item-offset'))}.textContent); return Number(m[1]) * 60 + Number(m[2]); })()`) };
  await s.frame();
  expect('the sound item shrank from the left, its end stayed, and it starts as far into the file as it starts on the timeline', near(trimmed.start, 2, 0.11) && near(trimmed.start + trimmed.duration, 6, 0.011) && near(trimmed.offset, trimmed.start, 0.011), trimmed);
  await s.evaluate(`window.scrollTo(0, 0)`);

  s.step('Play the preview');
  await s.evaluate(`window.scrollTo(0, 0)`);
  await s.evaluate(setValue(tid('scrub'), '1.6'));
  await s.sleep(600);
  const f1 = await s.evaluate(`Number(${q(tid('preview-canvas'))}.dataset.frame)`);
  await s.click(tid('play'));
  await s.sleep(1400);
  await s.frame();
  const f2 = await s.evaluate(`Number(${q(tid('preview-canvas'))}.dataset.frame)`);
  await s.click(tid('play'));
  expect('the preview played the footage', f2 > f1 + 10 && (await s.evaluate(`${q(tid('play'))}.dataset.playing`)) !== 'true', { from: f1, to: f2 });

  s.step('Save: the trim is in the composition');
  const saved = await save(s, FOOT_CLIP);
  const item = saved.composition.tracks.flatMap((t) => t.items).find((i) => i.id === id);
  const sound = saved.composition.tracks.find((t) => t.id === 'footage-sound')?.items[0];
  expect('the saved item has in, out, speed and loop together with its start and duration', near(item.params.in, t2.in, 0.001) && near(item.params.out, t2.out, 0.001) && item.params.speed === 2 && item.params.loop === true && near(item.start, t2.start, 0.001) && near(item.duration, t2.duration, 0.001), { start: item.start, duration: item.duration, ...item.params });
  expect('and the sound item (trimmed at its start) keeps its place in the file: its offset moved with its start', !!sound && sound.asset === item.asset && near(sound.offset ?? 0, trimmed.offset, 0.001) && near(sound.start, trimmed.start, 0.001) && near(sound.start + sound.duration, 6, 0.011), sound);
  await s.shot(join(out, 'studio', 'v4-footage-editor.png'));
  await s.evaluate(`${q(tid('inspector'))}.scrollIntoView({ block: 'start' })`);
  await s.sleep(300);
  await s.shot(join(out, 'studio', 'v4-footage-inspector.png'));
  await checkLayout(s, expect, 'desktop', false);

  await phone(async (p, expectP) => {
    await openEditor(p, FOOT_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=filmstrip] img').length > 0`);
    p.step('On a phone: the footage item with its filmstrip, tapped to select');
    await p.evaluate(`${q(tid('timeline'))}.scrollIntoView({ block: 'center' })`);
    await p.sleep(600);
    await p.frame();
    await tapAt(p, `[data-testid=item][data-id="${id}"]`, 0.5);
    await p.waitFor(`!!${q(tid('footage-section'))}`, 'the footage section');
    await p.evaluate(`${q(tid('footage-section'))}.scrollIntoView({ block: 'start' })`);
    await p.sleep(500);
    await p.frame();
    expectP('a tap selects it and the inspector shows the footage controls', (await p.evaluate(`${q(tid('selected-id'))}.textContent`)) === id);
    await p.shot(join(out, 'studio', 'v4-footage-mobile.png'));
    await checkLayout(p, expectP, 'footage inspector', true);
    await leave(p, `${base}/assets/${slug}`, `document.querySelector('[data-testid=footage-frame]')?.complete`);
    await p.sleep(500);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-footage-page-mobile.png'), { full: true });
    await checkLayout(p, expectP, 'footage page', true);
  });
});

// ---- 3. font
await workflow('font', 'a font file dropped on the library: the form asks for the licence; the family is in the font menu and has its page', async (s, expect, phone) => {
  const file = join(ROOT, 'test', 'fixtures', 'fonts', 'fixture-blocks-regular.ttf');
  await leave(s, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
  s.step('Drop the font file on the library page');
  await s.dropFiles({ x: 720, y: 450 }, [file]);
  await s.waitFor(`document.querySelector('[data-testid=font-dialog]')?.open`, 'the licence form');
  await s.sleep(500);
  await s.frame();
  const facts = await s.evaluate(`${q(tid('font-facts'))}.textContent`);
  expect('the form shows what the file says: family, weight and style', /Fixture Blocks/.test(facts) && /400 Regular/.test(facts) && /normal/.test(facts) && /TTF/.test(facts), facts);
  expect('the name in the library comes from the file name', (await s.evaluate(`${q(tid('font-name'))}.value`)) === 'fixture-blocks-regular');
  const picks = await s.evaluate(`[...document.querySelectorAll('[data-testid=font-license-pick]')].map((b) => b.dataset.value)`);
  expect('OFL-1.1 and Apache-2.0 are quick picks', picks.join() === 'OFL-1.1,Apache-2.0', picks);

  s.step('Press Add font without a licence: the form says it is required');
  await s.click(tid('font-add'));
  await s.waitFor(`!${q(tid('font-error'))}.hidden`, 'the licence message');
  await s.frame();
  expect('a licence is required, in plain words', /licence is required/i.test(await s.evaluate(`${q(tid('font-error'))}.textContent`)), await s.evaluate(`${q(tid('font-error'))}.textContent`));
  s.step('Pick OFL-1.1, then type the licence this fixture really has (CC0-1.0) as free text');
  await s.click(`[data-testid=font-license-pick][data-value="OFL-1.1"]`);
  expect('the quick pick fills the licence', (await s.evaluate(`${q(tid('font-license'))}.value`)) === 'OFL-1.1');
  await fill(s, tid('font-license'), 'CC0-1.0');
  await s.frame();
  s.step('Add font');
  await s.click(tid('font-add'));
  await s.waitFor(`document.querySelector('[data-testid=upload-row][data-kind=font]')?.dataset.state === 'done'`, 'the font to be added', 30000);
  await s.sleep(600);
  await s.frame();
  const row = await s.evaluate(`document.querySelector('[data-testid=upload-row][data-kind=font]').textContent`);
  expect('the row says Added, with the family, weight, licence and coverage', /Added/.test(row) && /Fixture Blocks 400 normal/.test(row) && /CC0-1.0/.test(row) && /Latin Extended-A/.test(row), row);
  await s.shot(join(out, 'studio', 'v4-font-upload.png'));
  const font = await get(s, '/api/assets/fixture-blocks-regular');
  expect('the studio has it as a font asset with licence and coverage', font.type === 'font' && font.meta.license === 'CC0-1.0' && font.meta.family === 'Fixture Blocks' && font.meta.weight === 400 && !!font.meta.coverage, { license: font.meta?.license, family: font.meta?.family });

  s.step('The font menu of a text item in the editor lists the new family');
  await openEditor(s, CAPS_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  await s.click({ x: (await itemBox(s, 'title')).x + 50, y: (await itemBox(s, 'title')).cy });
  await s.waitFor(`${q(tid('selected-id'))}?.textContent === 'title'`, 'the title item');
  const options = await s.evaluate(`(() => { const sel = [...document.querySelectorAll('[data-testid^=param-]')].find((e) => e.tagName === 'SELECT' && [...e.options].some((o) => o.value === 'Inter')); return sel ? { testid: sel.dataset.testid, options: [...sel.options].map((o) => o.value) } : null; })()`);
  await s.evaluate(`(() => { const sel = [...document.querySelectorAll('[data-testid^=param-]')].find((e) => e.tagName === 'SELECT' && [...e.options].some((o) => o.value === 'Inter')); sel?.scrollIntoView({ block: 'center' }); })()`);
  await s.sleep(500);
  await s.frame();
  expect('"Fixture Blocks" is among the fonts a parameter can name, next to the bundled ones', !!options && options.options.includes('Fixture Blocks') && options.options.includes('Inter'), options);
  if (options) {
    await s.evaluate(`window.scrollTo(0, 0)`);
    await s.evaluate(setValue(tid('scrub'), '2.0'));
    const plain = await pixels(s, 900);
    await s.evaluate(`document.querySelector('[data-testid=${options.testid}]').scrollIntoView({ block: 'center' })`);
    await s.evaluate(setValue(`[data-testid=${options.testid}]`, 'Fixture Blocks', 'change'));
    await s.sleep(1200);
    await s.evaluate(`window.scrollTo(0, 0)`);
    await s.evaluate(setValue(tid('scrub'), '2.0'));
    const drawn = await pixels(s, 1200);
    await s.frame();
    await s.shot(join(out, 'studio', 'v4-font-in-editor.png'));
    expect('the preview draws the title in it at once (no restart): other pixels, no error', drawn.hash !== plain.hash && !(await s.evaluate(`${q(tid('preview-error'))} && !${q(tid('preview-error'))}.hidden`)), { plain: plain.hash, drawn: drawn.hash });
  }

  if (options) {
    s.step('Save the clip: it pins the font files it was made with');
    const saved = await save(s, CAPS_CLIP);
    const pin = saved.composition.fonts?.['Fixture Blocks'];
    expect('the saved clip names the family and pins the font asset (so a new version of the font does not change it)', JSON.stringify(pin) === JSON.stringify(['fixture-blocks-regular@1']) && saved.composition.tracks.flatMap((t) => t.items).find((i) => i.id === 'title').params.font === 'Fixture Blocks', pin);
  }

  s.step('The playground page of the font: specimen, licence, coverage, a line of your own text');
  await leave(s, `${base}/assets/fixture-blocks-regular`, `document.querySelector('[data-testid=font-specimen] .specimen-line')`);
  await s.sleep(600);
  await s.frame();
  const page = await s.evaluate(`document.querySelector('[data-testid=font-page]').textContent`);
  expect('it shows weight, style, licence and the coverage', /400 · Regular/.test(page) && /CC0-1.0/.test(page) && /Latin Extended-A\s*no/.test(page) && /Romanian letters\s*yes/.test(page), page.slice(0, 300));
  expect('and the blocks it covers', (await s.evaluate(`document.querySelectorAll('[data-testid=font-blocks] .chip').length`)) >= 1);
  await fill(s, tid('font-sample-input'), 'Rapid și îndrăzneț');
  await s.sleep(300);
  const sample = await s.evaluate(`(() => { const p = ${q(tid('font-sample'))}; return { text: p.textContent, family: getComputedStyle(p).fontFamily, loaded: document.fonts.check('64px "' + getComputedStyle(p).fontFamily.split(',')[0].replace(/"/g, '') + '"') }; })()`);
  await s.frame();
  expect('the line the person typed is set in the font', sample.text === 'Rapid și îndrăzneț' && /specimen-fixture-blocks-regular/.test(sample.family), sample);
  await s.shot(join(out, 'studio', 'v4-font-page.png'), { full: true });
  await checkLayout(s, expect, 'desktop', false);

  await phone(async (p, expectP) => {
    await leave(p, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
    p.step('On a phone: Upload opens the file chooser; the licence form is a dialog, here from a dropped file');
    await p.dropFiles({ x: 195, y: 400 }, [join(ROOT, 'test', 'fixtures', 'fonts', 'fixture-blocks-bold.ttf')]);
    await p.waitFor(`document.querySelector('[data-testid=font-dialog]')?.open`, 'the licence form on the phone');
    await p.sleep(500);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-font-form-mobile.png'));
    await checkLayout(p, expectP, 'licence form', true);
    await tapAt(p, `[data-testid=font-license-pick][data-value="Apache-2.0"]`);
    expectP('a tap on a quick pick fills the licence', (await p.evaluate(`${q(tid('font-license'))}.value`)) === 'Apache-2.0');
    await tapAt(p, tid('font-cancel'));
    await p.waitFor(`!document.querySelector('[data-testid=font-dialog]')`, 'the form to close');
    await p.sleep(400);
    await p.frame();
    const row = await p.evaluate(`document.querySelector('[data-testid=upload-row][data-kind=font]')?.textContent ?? ''`);
    expectP('cancelling leaves the row saying no licence was given', /no licence was given/.test(row), row);
    await leave(p, `${base}/assets/fixture-blocks-regular`, `document.querySelector('[data-testid=font-specimen] .specimen-line')`);
    await p.sleep(500);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-font-page-mobile.png'), { full: true });
    await checkLayout(p, expectP, 'font page', true);
  });
});

// ---- 4. provenance
const CRED_CLIP = 'v4-credits';
const STOCK = 'v4-stock-photo', SKY = 'v4-sky-photo';
/** Two small different pictures (a test pattern, colour bars) as PNG files. */
async function makePictures() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'v4-pictures-'));
  const files = [];
  for (const [name, src] of [[STOCK, 'testsrc2=size=640x360'], [SKY, 'smptebars=size=640x360']]) {
    const file = join(dir, `${name}.png`);
    const r = await run(ffmpegPath(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-frames:v', '1', file]);
    if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    files.push(file);
  }
  return files;
}
const badgeIssues = (s) => s.evaluate(`[...document.querySelectorAll('[data-testid=prov-badge]')].map((b) => b.dataset.issue)`);
/** The state of the render queue's first row (the newest render). */
const firstRender = (s) => s.evaluate(`(() => { const r = document.querySelector('[data-testid=render-row]'); return r ? { id: r.dataset.id, status: r.dataset.status, kinds: [...r.querySelectorAll('[data-testid=render-kind]')].map((k) => k.dataset.kind), credits: !!r.querySelector('[data-testid=render-credits]') } : null; })()`);

await workflow('provenance', 'images dropped with and without a licence; Source and licence edited on the asset page (licence, creator, placeholder); the clip\'s Credits name the problem; a final render is refused, then goes through with its credits', async (s, expect, phone) => {
  const [stock, sky] = await makePictures();
  await leave(s, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
  const made = await post(s, '/api/clips', { name: CRED_CLIP, title: 'Credits and a final render', format: 'horizontal', fps: 30, duration: 3 });
  expect('a clip of 3 s to put the picture in', made.slug === CRED_CLIP || made.error?.includes('already'), made.slug ?? made.error);

  s.step('Drop a picture on the library without saying where it came from');
  await s.dropFiles({ x: 720, y: 450 }, [stock]);
  await s.waitFor(`document.querySelector('[data-testid=upload-row][data-kind=image]')?.dataset.state === 'done'`, 'the picture to be added');
  await s.sleep(500);
  await s.frame();
  const row1 = await s.evaluate(`document.querySelector('[data-testid=upload-row][data-kind=image]').textContent`);
  expect('the row says it has an unknown licence and that a final render will refuse it', /Licence unknown: a final render will refuse it/.test(row1), row1);
  const a1 = await get(s, `/api/assets/${STOCK}`);
  expect('the studio recorded it with no licence', a1.provenance.license === null && a1.provenance.placeholder === false, a1.provenance.license);
  s.step('Search for it: its card carries an unknown-licence mark');
  await fill(s, tid('search'), 'v4-stock');
  await s.waitFor(`document.querySelector('[data-testid=asset-card][data-slug="${STOCK}"] [data-testid=prov-flag][data-issue=unknown]')`, 'the unknown-licence mark on its card', 20000);
  await s.sleep(300);
  await s.frame();
  expect('its library card carries the mark', true);
  await s.shot(join(out, 'studio', 'v4-provenance-library.png'));

  s.step('Licence: say what the next uploads are under (CC0-1.0), then drop a second picture');
  await s.click(tid('upload-license'));
  await s.waitFor(`document.querySelector('[data-testid=upload-license-dialog]')?.open`, 'the licence dialog');
  await s.sleep(300);
  await s.frame();
  expect('the dialog says an upload without a licence is recorded as unknown', /unknown licence/.test(await s.evaluate(`${q(tid('upload-license-note'))}.textContent`)) && /final render will refuse/.test(await s.evaluate(`${q(tid('upload-license-note'))}.textContent`)));
  const picks = await s.evaluate(`[...document.querySelectorAll('[data-testid=prov-license-pick]')].map((b) => b.dataset.value)`);
  expect('the quick picks are original, CC0-1.0, CC-BY-4.0, OFL-1.1, Apache-2.0 and MIT', picks.join() === 'original,CC0-1.0,CC-BY-4.0,OFL-1.1,Apache-2.0,MIT', picks);
  await s.click(`[data-testid=prov-license-pick][data-value="CC0-1.0"]`);
  await s.click(tid('upload-license-save'));
  await s.waitFor(`!document.querySelector('[data-testid=upload-license-dialog]')`, 'the dialog to close');
  expect('the button now says the licence', /Licence: CC0-1.0/.test(await s.evaluate(`${q(tid('upload-license'))}.textContent`)));
  await s.dropFiles({ x: 720, y: 450 }, [sky]);
  await s.waitFor(`[...document.querySelectorAll('[data-testid=upload-row][data-kind=image]')].some((r) => r.dataset.name === '${SKY}.png' && r.dataset.state === 'done')`, 'the second picture');
  await s.sleep(400);
  await s.frame();
  const a2 = await get(s, `/api/assets/${SKY}`);
  expect('the second picture is recorded under CC0-1.0', a2.provenance.license === 'CC0-1.0', a2.provenance.license);
  const row2 = await s.evaluate(`[...document.querySelectorAll('[data-testid=upload-row]')].find((r) => r.dataset.name === '${SKY}.png').textContent`);
  expect('and its row says so', /Licence: CC0-1.0/.test(row2), row2);
  const added = await post(s, `/api/clips/${CRED_CLIP}/add-assets`, { slugs: [STOCK] });
  expect('the first picture is on the clip\'s timeline', added.added?.length === 1, added);

  s.step('Open the first picture\'s page: the badge and the Source and licence panel');
  await leave(s, `${base}/assets/${STOCK}`, `document.querySelector('[data-testid=provenance]')`);
  await s.evaluate(`window.scrollTo(0, 0)`);
  await s.sleep(300);
  await s.frame();
  expect('the page header carries the unknown-licence badge', (await badgeIssues(s)).includes('unknown'), await badgeIssues(s));
  expect('the panel shows the licence as unknown, with a warning', /unknown/.test(await s.evaluate(`${q(tid('prov-facts'))}.textContent`)) && !!(await s.evaluate(`${q(tid('prov-warning'))}`)));
  await s.shot(join(out, 'studio', 'v4-provenance-asset-unknown.png'), { full: true });

  s.step('Edit: pick CC-BY-4.0, give the creator, the credit line and the source');
  await s.evaluate('window.scrollTo(0, 0)');
  await s.click(tid('prov-edit'));
  await s.waitFor(`document.querySelector('[data-testid=prov-save]')`, 'the form');
  await s.click(`[data-testid=prov-license-pick][data-value="CC-BY-4.0"]`);
  await fill(s, tid('prov-creator'), 'Ada Lovelace');
  await fill(s, tid('prov-credit'), 'Photo: Ada Lovelace, CC BY 4.0');
  await fill(s, tid('prov-source-url'), 'https://example.org/photos/stock-photo');
  await fill(s, tid('prov-date'), '2026-10-01');
  await s.frame();
  await s.shot(join(out, 'studio', 'v4-provenance-edit.png'), { full: true });
  await s.click(tid('prov-save'));
  await s.waitFor(`document.querySelector('[data-testid=prov-edit]')`, 'the panel to be read-only again');
  await s.sleep(400);
  await s.frame();
  const a3 = await get(s, `/api/assets/${STOCK}`);
  expect('saved on the version: licence, creator, credit line, source and date', a3.provenance.license === 'CC-BY-4.0' && a3.provenance.creator === 'Ada Lovelace' && a3.provenance.credit === 'Photo: Ada Lovelace, CC BY 4.0' && a3.provenance.sourceUrl === 'https://example.org/photos/stock-photo' && a3.provenance.date === '2026-10-01', a3.provenance);
  expect('no new version was made', a3.version === 1 && a3.latestVersion === 1 && a3.versions.length === 1);
  expect('the panel says who edited it and when', /Edited by .+ · \d{4}-\d{2}-\d{2}/.test(await s.evaluate(`${q(tid('prov-edited'))}?.textContent ?? ''`)), await s.evaluate(`${q(tid('prov-edited'))}?.textContent`));
  expect('the unknown-licence badge is gone', !(await badgeIssues(s)).includes('unknown'), await badgeIssues(s));
  expect('a restriction-free CC-BY file may go in a public repo', a3.provenance.redistributable === true);

  s.step('Edit again: mark it a placeholder');
  await s.evaluate('window.scrollTo(0, 0)');
  await s.click(tid('prov-edit'));
  await s.waitFor(`document.querySelector('[data-testid=prov-placeholder]')`, 'the form');
  await s.click(tid('prov-placeholder'));
  await s.frame();
  expect('the switch is on', await s.evaluate(`${q(tid('prov-placeholder'))}.checked`));
  await s.click(tid('prov-save'));
  await s.waitFor(`document.querySelector('[data-testid=prov-badge][data-issue=placeholder]')`, 'the placeholder badge');
  await s.evaluate(`window.scrollTo(0, 0)`);
  await s.sleep(400);
  await s.frame();
  expect('the page header shows a Placeholder badge', (await badgeIssues(s)).includes('placeholder'), await badgeIssues(s));
  expect('stored as a flag', (await get(s, `/api/assets/${STOCK}`)).provenance.placeholder === true);
  await s.shot(join(out, 'studio', 'v4-provenance-placeholder.png'), { full: true });

  s.step('Its library card now says Placeholder');
  await leave(s, `${base}/?q=v4`, `document.querySelector('[data-testid=asset-card][data-slug="${STOCK}"]')`);
  await s.waitFor(`document.querySelector('[data-testid=asset-card][data-slug="${STOCK}"] [data-testid=prov-flag][data-issue=placeholder]')`, 'the placeholder mark on the card', 20000);
  await s.sleep(300);
  await s.frame();
  expect('the card carries the placeholder mark', true);

  s.step('The editor: the Credits panel lists the problem, with a link to the asset');
  await openEditor(s, CRED_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  await s.waitFor(`document.querySelector('[data-testid=credit-problem][data-problem=placeholder]')`, 'the problem in the credits panel');
  await s.evaluate(`${q(tid('credits-panel'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(400);
  await s.frame();
  const prob = await s.evaluate(`(() => { const p = document.querySelector('[data-testid=credit-problem]'); return { ref: p.dataset.ref, href: p.querySelector('a').getAttribute('href'), count: document.querySelector('[data-testid=credits-count]').textContent }; })()`);
  expect('the problem names the asset and links to its page', prob.ref === `${STOCK}@1` && prob.href === `/assets/${STOCK}?v=1` && prob.count === '1 problem', prob);
  expect('the credit line is listed', /Ada Lovelace/.test(await s.evaluate(`${q(tid('credit-lines'))}.textContent`)), await s.evaluate(`${q(tid('credit-lines'))}.textContent`));
  await s.shot(join(out, 'studio', 'v4-credits-problem.png'));

  s.step('Render → Final: the sources are checked, and the render is refused');
  await s.evaluate('window.scrollTo(0, 0)');
  await s.click(tid('render-button'));
  await s.waitFor(`document.querySelector('[data-testid=render-dialog]')?.open`, 'the render panel');
  await s.click(`[data-testid=render-mode][data-mode=final]`);
  await s.frame();
  await s.click(tid('render-start'));
  await s.waitFor(`!${q(tid('render-error'))}.hidden`, 'the refusal');
  await s.sleep(300);
  await s.frame();
  const refusal = await s.evaluate(`${q(tid('render-error'))}.textContent`);
  expect('the studio\'s own message is shown, naming the asset', /refused/.test(refusal) && new RegExp(`${STOCK}@1`).test(refusal) && /placeholder/.test(refusal), refusal.slice(0, 160));
  expect('the asset in it is a link', await s.evaluate(`!!${q(tid('render-error'))}.querySelector('a[href="/assets/${STOCK}?v=1"]')`));
  await s.shot(join(out, 'studio', 'v4-render-refused.png'));
  expect('nothing was queued', (await get(s, `/api/renders?clip=${CRED_CLIP}`)).renders.length === 0);

  s.step('Follow the link to the asset and clear the placeholder');
  await s.click(`${tid('render-error')} a`);
  await s.waitFor(`location.pathname === '/assets/${STOCK}' && document.querySelector('[data-testid=prov-edit]')`, 'the asset page');
  await s.evaluate('window.scrollTo(0, 0)');
  await s.click(tid('prov-edit'));
  await s.waitFor(`document.querySelector('[data-testid=prov-placeholder]')`, 'the form');
  await s.click(tid('prov-placeholder'));
  await s.click(tid('prov-save'));
  await s.waitFor(`!document.querySelector('[data-testid=prov-badge][data-issue=placeholder]') && document.querySelector('[data-testid=prov-edit]')`, 'the badge to go');
  await s.sleep(400);
  await s.frame();
  expect('the placeholder is cleared and the badge is gone', (await get(s, `/api/assets/${STOCK}`)).provenance.placeholder === false && !(await badgeIssues(s)).length, await badgeIssues(s));

  s.step('Back in the editor: nothing stands in the way; Render → Final goes through');
  await openEditor(s, CRED_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  await s.waitFor(`document.querySelector('[data-testid=credits-ready]')`, 'the credits panel to say it is ready');
  await s.evaluate(`${q(tid('credits-panel'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(400);
  await s.frame();
  expect('the credits panel says a final render can go ahead', !(await s.evaluate(`!!document.querySelector('[data-testid=credit-problem]')`)));
  await s.evaluate('window.scrollTo(0, 0)');
  await s.click(tid('render-button'));
  await s.waitFor(`document.querySelector('[data-testid=render-dialog]')?.open`, 'the render panel');
  await s.click(`[data-testid=render-mode][data-mode=final]`);
  await s.click(tid('render-start'));
  await s.waitFor(`location.pathname === '/renders' && document.querySelector('[data-testid=render-row]')`, 'the render queue');
  await s.waitFor(`document.querySelector('[data-testid=render-row]').dataset.status === 'done'`, 'the final render to finish', 120000);
  await s.sleep(500);
  await s.frame();
  const fin = await firstRender(s);
  expect('the render is labelled Final and links its credits file', fin.status === 'done' && fin.kinds.includes('final') && fin.credits, fin);
  const credits = await s.evaluate(`fetch(document.querySelector('[data-testid=render-credits]').getAttribute('href')).then((r) => r.text())`);
  expect('the credits file names the creator and the licence', /Ada Lovelace/.test(credits) && /CC-BY-4\.0/.test(credits), credits.slice(0, 200));
  await s.shot(join(out, 'studio', 'v4-render-final.png'));
  await checkLayout(s, expect, 'renders', false);

  await phone(async (p, expectP) => {
    await leave(p, `${base}/assets/${STOCK}`, `document.querySelector('[data-testid=provenance]')`);
    p.step('On a phone: the asset page with its Source and licence panel');
    await p.evaluate(`${q(tid('provenance'))}.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70)`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-provenance-mobile.png'));
    await checkLayout(p, expectP, 'provenance panel', true);
    await tapAt(p, tid('prov-edit'));
    await p.waitFor(`document.querySelector('[data-testid=prov-save]')`, 'the form');
    await p.evaluate(`${q(tid('provenance'))}.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70)`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-provenance-edit-mobile.png'), { full: true });
    await checkLayout(p, expectP, 'provenance form', true);
    await tapAt(p, tid('prov-cancel'));
    await openEditor(p, CRED_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined`);
    await p.waitFor(`document.querySelector('[data-testid=credit-lines]')`, 'the credits');
    p.step('On a phone: the Credits panel, then the Render panel');
    await p.evaluate(`${q(tid('credits-panel'))}.scrollIntoView({ block: 'start' })`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-credits-mobile.png'));
    await checkLayout(p, expectP, 'credits panel', true);
    await p.evaluate('window.scrollTo(0, 0)');
    await tapAt(p, tid('render-button'));
    await p.waitFor(`document.querySelector('[data-testid=render-dialog]')?.open`, 'the render panel');
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-render-panel-mobile.png'));
    await checkLayout(p, expectP, 'render panel', true);
    await tapAt(p, tid('render-cancel'));
    await leave(p, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
    await tapAt(p, tid('upload-license'));
    await p.waitFor(`document.querySelector('[data-testid=upload-license-dialog]')?.open`, 'the licence dialog');
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-upload-licence-mobile.png'));
    await checkLayout(p, expectP, 'upload licence dialog', true);
  });
}, { expected: (p) => /\b422\b.*\/api\/clips\/[a-z0-9-]+\/render$/.test(p) });   // the refused final render

// ---- 5. render options and write to repo
const REPO_CLIP = 'v4-repo';
await workflow('render', 'the render panel: a draft with two workers and a poster at the playhead, then three shapes in one request; the Repo panel lists what to write and Write to repo writes it', async (s, expect, phone) => {
  const repo = process.env.STUDIO_REPO;
  if (!repo) throw new Error('set STUDIO_REPO to a scratch folder (for the studio server and for this script): Write to repo would write into the real repo otherwise');
  await leave(s, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
  const made = await post(s, '/api/clips', { name: REPO_CLIP, title: 'Render options and the repo', format: 'horizontal', fps: 30, duration: 2 });
  expect('a clip of 2 s to render', made.slug === REPO_CLIP || made.error?.includes('already'), made.slug ?? made.error);
  const added = await post(s, `/api/clips/${REPO_CLIP}/add-assets`, { slugs: ['bg-gradient-drift'] });
  expect('a background on its timeline', added.added?.length === 1, added);

  await openEditor(s, REPO_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  s.step('Put the playhead at 1 s and press Render: the panel opens');
  await s.evaluate(setValue(tid('scrub'), '1'));
  await s.sleep(500);
  await s.click(tid('render-button'));
  await s.waitFor(`document.querySelector('[data-testid=render-dialog]')?.open`, 'the render panel');
  await s.sleep(300);
  await s.frame();
  const shapes = await s.evaluate(`[...document.querySelectorAll('[data-testid=render-shape]')].map((b) => b.dataset.shape + ':' + b.getAttribute('aria-pressed'))`);
  expect('three shapes to pick, the clip\'s own on', shapes.join() === 'horizontal:true,vertical:false,square:false', shapes);
  expect('the poster time starts at the playhead', (await s.evaluate(`${q(tid('render-poster'))}.value`)) === '1', await s.evaluate(`${q(tid('render-poster'))}.value`));
  await s.shot(join(out, 'studio', 'v4-render-panel.png'));

  s.step('Draft, two workers');
  await s.click(`[data-testid=render-mode][data-mode=draft]`);
  await fill(s, tid('render-workers'), '2');
  await s.frame();
  expect('the panel says what size a draft is (2/3 of 1920×1080)', /1280×720/.test(await s.evaluate(`${q(tid('render-shape-note'))}.textContent`)), await s.evaluate(`${q(tid('render-shape-note'))}.textContent`));
  await s.shot(join(out, 'studio', 'v4-render-panel-draft.png'));
  await s.click(tid('render-start'));
  await s.waitFor(`location.pathname === '/renders' && document.querySelector('[data-testid=render-row]')`, 'the render queue');
  await s.waitFor(`document.querySelector('[data-testid=render-row]').dataset.status === 'done'`, 'the draft to finish', 120000);
  await s.sleep(400);
  await s.frame();
  const draftRow = await firstRender(s);
  const draft = (await get(s, `/api/renders?clip=${REPO_CLIP}`)).renders[0];
  expect('the row is labelled Draft with its size', draftRow.kinds.includes('draft') && draft.stats.draft.width === 1280 && draft.stats.draft.height === 720, { kinds: draftRow.kinds, draft: draft.stats.draft });
  expect('it ran with two workers, and its poster is the frame at 1 s', draft.stats.workers === 2 && draft.stats.posterFrame === 30, { workers: draft.stats.workers, poster: draft.stats.posterFrame });
  expect('the file is the smaller size', draft.stats.probe.video.width === 1280 && draft.stats.probe.video.height === 720);

  s.step('Back in the editor: Render with all three shapes');
  await openEditor(s, REPO_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  await s.click(tid('render-button'));
  await s.waitFor(`document.querySelector('[data-testid=render-dialog]')?.open`, 'the render panel');
  await s.click(`[data-testid=render-shape][data-shape=vertical]`);
  await s.click(`[data-testid=render-shape][data-shape=square]`);
  await s.frame();
  expect('the button says three shapes', /Render 3 shapes/.test(await s.evaluate(`${q(tid('render-start'))}.textContent`)), await s.evaluate(`${q(tid('render-start'))}.textContent`));
  await s.click(tid('render-start'));
  await s.waitFor(`location.pathname === '/renders' && document.querySelectorAll('[data-testid=render-row]').length >= 4`, 'the three renders');
  await s.sleep(500);
  await s.frame();
  await s.waitFor(`document.querySelectorAll('[data-testid=render-row].in-batch[data-status=done]').length === 3`, 'the three shapes to finish', 240000);
  await s.sleep(500);
  await s.evaluate(`${q(tid('render-batch'))}.scrollIntoView({ block: 'center' })`);
  await s.frame();
  const list = (await get(s, `/api/renders?clip=${REPO_CLIP}`)).renders;
  const batch = list.filter((r) => r.options.batch);
  expect('one request made three renders with one batch id: horizontal, vertical, square', batch.length === 3 && new Set(batch.map((r) => r.options.batch)).size === 1 && batch.map((r) => r.format).sort().join() === 'horizontal,square,vertical', batch.map((r) => `${r.format}#${r.id}`));
  expect('the queue groups them under one heading', (await s.evaluate(`document.querySelectorAll('[data-testid=render-batch]').length`)) === 1 && /3 shapes/.test(await s.evaluate(`${q(tid('render-batch'))}.textContent`)), await s.evaluate(`${q(tid('render-batch'))}.textContent`));
  expect('the draft is not part of it', !list.find((r) => r.id === draft.id).options.batch);
  await s.shot(join(out, 'studio', 'v4-render-batch.png'), { full: true });
  await checkLayout(s, expect, 'renders', false);

  s.step('The editor\'s Repo panel: the clip is not in the repo yet');
  await openEditor(s, REPO_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`);
  await s.waitFor(`document.querySelector('[data-testid=repo-state]')?.dataset.state === 'changes'`, 'the dry run');
  await s.evaluate(`${q(tid('repo-panel'))}.scrollIntoView({ block: 'center' })`);
  await s.sleep(400);
  await s.frame();
  const state0 = await s.evaluate(`document.querySelector('[data-testid=repo-state]').textContent`);
  expect('it says how many changes there are to write', /\d+ changes? to write/.test(state0), state0);
  expect('the new files are listed', (await s.evaluate(`document.querySelectorAll('[data-testid=repo-new] li').length`)) >= 2);
  expect('nothing was written by looking', !existsSync(join(repo, 'clips', REPO_CLIP, 'clip.json')));
  await s.shot(join(out, 'studio', 'v4-repo-changes.png'));

  s.step('Write to repo');
  await s.click(tid('repo-write'));
  await s.waitFor(`document.querySelector('[data-testid=repo-result]')`, 'the result', 90000);
  await s.waitFor(`document.querySelector('[data-testid=repo-state]').dataset.state === 'up-to-date'`, 'the repo to be up to date');
  await s.sleep(400);
  await s.frame();
  const wrote = await s.evaluate(`[...document.querySelectorAll('[data-testid=repo-wrote]')].map((l) => l.textContent)`);
  expect('it lists what it wrote, the clip\'s file among it', wrote.includes(`clips/${REPO_CLIP}/clip.json`), wrote);
  expect('the files are in the scratch repo', existsSync(join(repo, 'clips', REPO_CLIP, 'clip.json')));
  expect('the indicator says up to date', (await s.evaluate(`document.querySelector('[data-testid=repo-state]').textContent`)) === 'Up to date');
  expect('the dry run agrees', (await get(s, `/api/clips/${REPO_CLIP}/export`)).upToDate === true);
  await s.shot(join(out, 'studio', 'v4-repo-written.png'));
  await checkLayout(s, expect, 'editor', false);

  await phone(async (p, expectP) => {
    await openEditor(p, REPO_CLIP, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined`);
    await p.waitFor(`document.querySelector('[data-testid=repo-state]')?.dataset.state === 'up-to-date'`, 'the repo panel');
    p.step('On a phone: the Repo panel, then the render panel with the shapes');
    await p.evaluate(`${q(tid('repo-panel'))}.scrollIntoView({ block: 'center' })`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-repo-mobile.png'));
    await checkLayout(p, expectP, 'repo panel', true);
    await p.evaluate('window.scrollTo(0, 0)');
    await tapAt(p, tid('render-button'));
    await p.waitFor(`document.querySelector('[data-testid=render-dialog]')?.open`, 'the render panel');
    await tapAt(p, `[data-testid=render-shape][data-shape=vertical]`);
    await tapAt(p, `[data-testid=render-mode][data-mode=draft]`);
    await p.sleep(400);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-render-panel-draft-mobile.png'));
    await checkLayout(p, expectP, 'render panel', true);
    await tapAt(p, tid('render-cancel'));
    await leave(p, `${base}/renders`, `document.querySelector('[data-testid=render-row]')`);
    await p.sleep(500);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-render-batch-mobile.png'));
    await checkLayout(p, expectP, 'renders', true);
  });
});

// ---- 6. the kit
const KIT = ['kit-cursor', 'kit-spotlight', 'kit-camera', 'kit-arrow', 'kit-callout', 'kit-ui-frame', 'kit-plate', 'kit-steps', 'kit-icon', 'kit-chart-line', 'kit-chart-donut'];
await workflow('kit', 'the library\'s Kit filter, then three kit assets in the playground with a parameter changed in each', async (s, expect, phone) => {
  await leave(s, `${base}/`, `document.querySelector('[data-testid=asset-grid]') && document.querySelector('[data-testid=kit-link]')`);
  s.step('Library → Kit: the assets tagged kit');
  await s.click(tid('kit-link'));
  await s.waitFor(`/match/.test(${q(tid('result-count'))}.textContent) && document.querySelectorAll('[data-testid=asset-card]:not(.ph)').length >= 10`, 'the kit cards');
  await s.sleep(900);
  await s.frame();
  const slugs = await s.evaluate(`[...document.querySelectorAll('[data-testid=asset-card]')].map((c) => c.dataset.slug)`);
  expect('every piece of the kit is in the list', KIT.every((k) => slugs.includes(k)), slugs);
  expect('the filter is in the address (the tag kit)', /tag=kit/.test(await s.evaluate('location.search')));
  await s.shot(join(out, 'studio', 'v4-kit-library.png'));

  const tryOne = async (slug, what, param, value, event = 'input') => {
    s.step(`Open ${slug}: ${what}`);
    await leave(s, `${base}/?tag=kit&open=${slug}`, `document.querySelector('[data-testid=detail-open]')`);
    await s.sleep(500);
    await s.frame();
    await s.click(tid('detail-open'));
    await s.waitFor(`location.pathname === '/assets/${slug}' && ${q(tid('preview-canvas'))}?.dataset.frame !== undefined`, 'the playground');
    await s.sleep(900);
    expect(`${slug} opens in the horizontal shape, the one a screen recording has`, (await s.evaluate(`${q(tid('format-horizontal'))}.getAttribute('aria-pressed')`)) === 'true');
    const before = await pixels(s);
    await s.frame();
    const sel = `[data-testid="${param}"]`;
    await s.evaluate(`document.querySelector('${sel}').scrollIntoView({ block: 'center' })`);
    await s.evaluate(setValue(sel, value, event));
    await s.sleep(900);
    await s.evaluate('window.scrollTo(0, 0)');
    const after = await pixels(s);
    await s.frame();
    expect(`${slug}: changing ${param} redraws the preview, with no error`, after.hash !== before.hash && !(await s.evaluate(`${q(tid('preview-error'))} && !${q(tid('preview-error'))}.hidden`)), { before: before.hash, after: after.hash });
    await s.shot(join(out, 'studio', `v4-kit-${slug}.png`));
  };
  await tryOne('kit-callout', 'its text', 'param-text', 'Pick a *kit* piece');
  await tryOne('kit-steps', 'the step it is on', 'param-current', '2');
  await tryOne('kit-chart-donut', 'the first segment\'s value', 'param-segments.0.value', '30');
  await checkLayout(s, expect, 'playground', false);

  await phone(async (p, expectP) => {
    await leave(p, `${base}/`, `document.querySelector('[data-testid=asset-grid]')`);
    p.step('On a phone: Filters → Kit');
    await tapAt(p, tid('facets-toggle'));
    await p.waitFor(`document.querySelector('[data-testid=kit-link]')`, 'the Kit entry');
    await p.sleep(300);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-kit-filters-mobile.png'));
    await tapAt(p, tid('kit-link'));
    await tapAt(p, tid('facets-done'));
    await p.waitFor(`/tag=kit/.test(location.search) && document.querySelectorAll('[data-testid=asset-card]').length >= 1 && /12 assets match/.test(${q(tid('result-count'))}.textContent)`, 'the kit cards');
    await p.sleep(900);
    await p.frame();
    await p.shot(join(out, 'studio', 'v4-kit-library-mobile.png'));
    await checkLayout(p, expectP, 'kit library', true);
    for (const [slug, param, value] of [['kit-callout', 'param-text', 'Tap a *kit* piece'], ['kit-icon', 'param-weight', '3']]) {
      await leave(p, `${base}/assets/${slug}`, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined`);
      await p.sleep(900);
      p.step(`On a phone: ${slug} in the playground`);
      await p.frame();
      const before = await pixels(p);
      await p.evaluate(`document.querySelector('[data-testid="${param}"]').scrollIntoView({ block: 'center' })`);
      await p.evaluate(setValue(`[data-testid="${param}"]`, value));
      await p.sleep(900);
      await p.evaluate('window.scrollTo(0, 0)');
      const after = await pixels(p);
      await p.frame();
      expectP(`${slug}: the parameter redraws the preview`, after.hash !== before.hash, { before: before.hash, after: after.hash });
      await p.shot(join(out, 'studio', `v4-kit-${slug}-mobile.png`));
      await checkLayout(p, expectP, slug, true);
    }
  });
});

// a run of some workflows keeps the report of the others
const reportFile = join(out, 'reports', 'workflows-v4.json');
let before = {};
try { before = JSON.parse(readFileSync(reportFile, 'utf8')).workflows ?? {}; } catch { /* the first run */ }
writeFileSync(reportFile, `${JSON.stringify({ what: 'Iteration-4 studio workflows driven in headless Chrome with real mouse, keyboard, file-drop and touch input (scripts/workflows-v4.mjs); every check is asserted by the script.', base, workflows: { ...before, ...report } }, null, 1)}\n`);
console.log(failed ? '\nworkflows: FAILED' : '\nworkflows: all checks passed');
process.exit(failed ? 1 : 0);
