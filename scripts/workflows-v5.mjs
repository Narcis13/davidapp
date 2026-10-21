// The studio editor's interactive mode, driven in headless Chrome with real input (mouse presses and moves, touch taps,
// keys) against a running studio, each step checked as it goes and each workflow written as a GIF plus stills. The
// sibling of scripts/workflows-v4.mjs: same driver (scripts/lib/browser.mjs), same report shape. They change the data
// they run on (they save and create clips), so point them at a scratch data dir:
//
//   bash .claude/goal-loop/serve.sh fresh <port> <dir>
//   STUDIO_DATA=<dir> node scripts/dev-seed-v5.mjs
//   STUDIO_DATA=<dir> node scripts/workflows-v5.mjs http://127.0.0.1:<port> [out-dir] [play problems clips]
//
//   play      the clip interactive-demo in the editor: the scene bands and the Interactive panel, a click on a band moves
//             the playhead, the Share button says the clip is played, then Play: the pointer (hover cursor, a click on the
//             Start button found through the hit-region outlines), Tab and Enter, Escape going back, a letter key, Pause,
//             Restart, a whole run to the win scene, the live readout following the scene and the variables, Copy log (the
//             recorded input; replayed by the studio when STUDIO_DATA is set, it reaches the same state), Stop back to the
//             design timeline. Then on a phone (390×844): the same with touch taps.
//   problems  an item that a wire needs is deleted: the panel names the problem and Play refuses; undo brings it back
//   clips     the new-clip form's kind choice: an interactive clip starts as one scene and plays; a video clip is
//             unchanged (no Interactive panel, no scene bands, its button still says Render)
//
// out-dir (default output/workflows-v5) gets gifs/<name>.gif and gifs/<name>-mobile.gif, studio/v5-<name>*.png and
// reports/workflows-v5.json. Exits 1 when a check fails or the page logs a problem (console errors, failed requests).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession } from './lib/browser.mjs';
import { ROOT } from '../src/render/host.js';

const [base, outArg, ...names] = process.argv.slice(2);
if (!base) { console.error('usage: STUDIO_DATA=<dir> node scripts/workflows-v5.mjs <base-url> [out-dir] [workflow …]'); process.exit(2); }
const out = outArg ?? join(ROOT, 'output', 'workflows-v5');
for (const d of ['gifs', 'studio', 'reports']) mkdirSync(join(out, d), { recursive: true });
const DEMO = 'interactive-demo';
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
      await p.shot(join(out, 'studio', `v5-${name}-mobile-failed.png`)).catch(() => {});
    }
    extra.mobileFrames = await p.gif(join(out, 'gifs', `${name}-mobile.gif`), { width: 390 }).catch((e) => { error ??= e.message; return 0; });
    problems.push(...p.problems.map((x) => `phone: ${x}`));
    await p.close();
  };
  try {
    await fn(s, expect, phone);
  } catch (e) {
    error = e.message;
    console.log(`  ✖ ${e.message}`);
    failed = true;
    await s.shot(join(out, 'studio', `v5-${name}-failed.png`)).catch(() => {});
  }
  const frames = await s.gif(join(out, 'gifs', `${name}.gif`)).catch((e) => { error ??= e.message; return 0; });
  problems.push(...s.problems);
  if (problems.length) { failed = true; for (const p of problems) console.log(`  CONSOLE ${p}`); }
  report[name] = { what, checks, consoleProblems: problems, gif: `gifs/${name}.gif`, frames, ...(extra.mobileFrames !== undefined ? { mobileGif: `gifs/${name}-mobile.gif`, mobileFrames: extra.mobileFrames } : {}), ...(error ? { error } : {}) };
  await s.close();
}

// ---- helpers that run in the page
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const tid = (id) => `[data-testid=${id}]`;
const get = (s, path) => s.evaluate(`fetch(${JSON.stringify(path)}).then((r) => (r.ok ? r.json() : null))`);
/** What the live readout says (scene, variables, mode, frame, focus, the number of recorded inputs). */
const readout = (s) => s.evaluate(`(() => { const e = ${q(tid('interactive-state'))}; return { mode: e.dataset.mode, scene: e.dataset.scene, vars: JSON.parse(e.dataset.vars || '{}'), frame: Number(e.dataset.frame), focus: e.dataset.focus ?? '', events: Number(e.dataset.events ?? 0) }; })()`);
const sceneIs = (id) => `${q(tid('interactive-state'))}?.dataset.scene === ${JSON.stringify(id)}`;
const modeIs = (m) => `${q(tid('play-interactive'))}?.dataset.mode === ${JSON.stringify(m)}`;
const regionSel = (key) => `${tid('region-overlay')} polygon[data-key="${key}"]`;
/** The preview canvas hashed as the person sees it (copied to a 2D canvas). */
const pixels = (s, wait = 300) => s.evaluate(`(async () => { const c = ${q(tid('preview-canvas'))}; await new Promise((r) => setTimeout(r, ${wait})); const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const g = k.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, k.width, k.height).data; let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; })()`);
const handled = new WeakSet();
async function leave(s, url, ready) {
  // a draft with unsaved changes asks "leave the page?": the workflow leaves anyway
  if (!handled.has(s)) { handled.add(s); s.onEvent((m) => { if (m === 'Page.javascriptDialogOpening') s.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }); }
  await s.evaluate(`window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true)`).catch(() => {});
  await s.goto(url, ready);
}
async function openEditor(s, clip) {
  await leave(s, `${base}/clips/${clip}`, `${q(tid('preview-canvas'))}?.dataset.frame !== undefined && ${q(tid('play-interactive'))}`);
  await s.evaluate('window.scrollTo(0, 0)');
  await s.sleep(400);
}
/** Tap on a phone: the element first goes to the middle of the screen. */
async function tapAt(p, selector) {
  await p.evaluate(`${q(selector)}.scrollIntoView({ block: 'center', inline: 'nearest' })`);
  await p.sleep(250);
  const r = await p.rect(selector, { scroll: false });
  await p.tap({ x: r.cx, y: r.cy });
}
/** A real click on an element that is first scrolled to the middle of the window (clear of the sticky bar at the top). */
async function press(s, selector, opts) {
  await s.evaluate(`${q(selector)}.scrollIntoView({ block: 'center' })`);
  await s.sleep(80);
  return s.click(selector, opts);
}
/** A mouse move with no button (hover). */
async function hover(s, selector) {
  const r = await s.rect(selector);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.cy, button: 'none', buttons: 0 });
  await s.sleep(250);
  return r;
}
/** What a page must satisfy: no sideways scroll, no text cut off, and (on a phone) controls a finger can hit. */
async function layoutOf(s, mobile) {
  return s.evaluate(`(() => {
    const doc = document.documentElement;
    const clipped = [];
    for (const el of document.querySelectorAll('main *, dialog[open] *')) {
      if (el.closest('.timeline, .vgrid-scroll, pre, .tl-lane, svg, canvas, select, option, .stage, .iv-state')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
      if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && (el.textContent ?? '').trim()) clipped.push(el.tagName.toLowerCase() + '.' + el.className + ': ' + el.textContent.trim().slice(0, 40));
    }
    const small = [];
    if (${mobile}) {
      for (const el of document.querySelectorAll('.play-bar button:not(:disabled), .interactive-panel button, dialog[open] button, dialog[open] select')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 32 || r.width < 32)) small.push((el.dataset.testid ?? el.tagName.toLowerCase()) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
    return { overflowX: Math.max(0, doc.scrollWidth - innerWidth), clipped: clipped.slice(0, 6), small: small.slice(0, 8) };
  })()`);
}
const checkLayout = async (s, expect, label, mobile) => {
  const l = await layoutOf(s, mobile);
  expect(`${label}: no sideways scroll, no text cut off${mobile ? ', controls big enough to tap' : ''}`, l.overflowX === 0 && !l.clipped.length && !l.small.length, l);
};
/** Make the next Copy log capture what it copies (headless Chrome has no clipboard permission). */
const captureClipboard = (s) => s.evaluate(`(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } }); })()`);
const noError = (s) => s.evaluate(`!${q(tid('preview-error'))} || ${q(tid('preview-error'))}.hidden`);

/** Replay the log through the studio's own player (needs STUDIO_DATA: the same data dir as the server) → { scene, vars }. */
async function replayInStudio(slug, log) {
  if (!process.env.STUDIO_DATA) return null;
  const { createStudio } = await import('../src/studio/studio.js');
  const studio = createStudio({ role: 'seed', runner: false });
  try {
    const frames = [Math.max(...log.map((e) => e.f)) + 1];
    const r = await studio.play({ clip: slug, log, frames });
    return { scene: r.end.scene, vars: r.end.vars };
  } finally {
    await studio.close();
  }
}

// ---- 1. play
await workflow('play', 'the editor plays an interactive clip: pointer, keys, readout, log, stop; then on a phone with touch', async (s, expect, phone) => {
  await openEditor(s, DEMO);
  s.step('An interactive clip in the editor: scene bands under the ruler, the Interactive panel');
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(tid('scene-band'))}).length === 3`, 'three scene bands');
  const bands = await s.evaluate(`[...document.querySelectorAll('[data-testid=scene-band]')].map((b) => b.dataset.scene + ':' + b.dataset.start + '-' + b.dataset.end)`);
  expect('the timeline shows a band per scene, at its range', bands.join() === 'menu:0-3,play:3-7,win:7-10', bands.join());
  const panel = await s.evaluate(`(() => { const p = ${q(tid('interactive-panel'))}; return { shown: !p.hidden, vars: [...p.querySelectorAll('[data-testid=interactive-var]')].map((v) => v.textContent.trim()), scenes: p.querySelectorAll('[data-testid=interactive-scene]').length, wires: p.querySelectorAll('[data-testid=interactive-wire]').length, errors: p.querySelectorAll('[data-testid=interactive-errors]').length, text: p.textContent }; })()`);
  expect('the Interactive panel lists the variables (first values), 3 scenes and 6 wires, no problems', panel.shown && panel.vars.join('|') === 'score = 0|muted = false' && panel.scenes === 3 && panel.wires === 6 && !panel.errors, { vars: panel.vars, scenes: panel.scenes, wires: panel.wires });
  expect('a wire reads as a sentence', /tap\.press[\s\S]*add 1 to score \(max 5\)[\s\S]*if score ≥ 3: play chime; go to win/.test(panel.text));
  expect('the design timeline reads the first values', JSON.stringify((await readout(s)).vars) === '{"score":0,"muted":false}' && (await readout(s)).mode === 'design');
  await s.frame();
  await s.shot(join(out, 'studio', 'v5-play-editor.png'), { full: true });
  await checkLayout(s, expect, 'the editor', false);

  s.step('A click on a scene band moves the playhead to its start');
  await press(s, `${tid('scene-band')}[data-scene=play]`);
  await s.waitFor(`${q(tid('preview-canvas'))}.dataset.frame === '90'`, 'the playhead at 3 s');
  const marked = await s.evaluate(`(() => { const b = ${q(`${tid('scene-band')}[data-scene=play]`)}; return { selected: b.classList.contains('selected'), here: b.classList.contains('here'), pressed: b.getAttribute('aria-pressed'), row: ${q(`${tid('interactive-scene')}[data-scene=play]`)}.getAttribute('aria-pressed') }; })()`);
  expect('the band is selected, the playhead is in it, the panel row agrees', marked.selected && marked.here && marked.pressed === 'true' && marked.row === 'true', marked);
  expect('the readout names the scene at the playhead', (await readout(s)).scene === 'play');
  await press(s, `${tid('interactive-scene')}[data-scene=menu]`);
  await s.waitFor(`${q(tid('preview-canvas'))}.dataset.frame === '0'`, 'the playhead back at 0');

  s.step('The Share button: it is played, not rendered');
  expect('the render button says Share', (await s.evaluate(`${q(tid('render-button'))}.textContent.trim()`)) === 'Share');
  await press(s, tid('render-button'));
  await s.waitFor(`${q(tid('interactive-share-dialog'))}?.open`, 'the dialog');
  const share = await s.evaluate(`({ text: ${q(tid('interactive-share-dialog'))}.textContent, href: ${q(tid('interactive-share-link'))}.getAttribute('href') })`);
  expect('the dialog says played, not rendered, and links the share page', /played in the browser/.test(share.text) && share.href === `/share/${DEMO}`, share.href);
  await s.frame();
  await s.key('Escape');
  await s.waitFor(`!${q(tid('interactive-share-dialog'))}`, 'the dialog to close');

  s.step('Play: the session runs on the preview');
  await press(s, tid('play-interactive'));
  await s.waitFor(`${modeIs('playing')} && ${q(tid('interactive-state'))}.dataset.frame > 5`, 'the session to run');
  expect('the button says it is playing, the readout shows the first scene', (await s.evaluate(`${q(tid('play-interactive'))}.dataset.playing`)) === 'true' && (await readout(s)).scene === 'menu');
  expect('the timeline, layers and inspector are read-only meanwhile', await s.evaluate(`${q(tid('timeline'))}.closest('[inert]') !== null && ${q(tid('inspector'))}.inert`));
  await press(s, tid('interactive-regions'));
  await s.waitFor(`${q(regionSel('start:press:'))}`, 'the Start region outline');
  await s.frame();
  await s.shot(join(out, 'studio', 'v5-play-menu.png'));
  const loop = await readout(s);
  await s.sleep(500);
  expect('the clock runs (the menu scene loops)', (await readout(s)).frame > loop.frame);

  s.step('Over the button the cursor is a pointer; elsewhere it is not');
  await hover(s, regionSel('start:press:'));
  expect('the cursor is a pointer over a region', (await s.evaluate(`${q(tid('preview-canvas'))}.style.cursor`)) === 'pointer');
  await s.frame();
  const hoverPx = await pixels(s);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: (await s.rect(tid('preview-canvas'))).y + 30, button: 'none', buttons: 0 });
  await s.sleep(250);
  expect('away from every region it is not', (await s.evaluate(`${q(tid('preview-canvas'))}.style.cursor`)) === '');
  expect('the button draws its hover state (the pixels changed)', (await pixels(s)) !== hoverPx);

  s.step('Click Start: the wire runs, the scene changes');
  await press(s, regionSel('start:press:'));
  await s.waitFor(sceneIs('play'), 'the play scene');
  await s.waitFor(`${q(regionSel('tap:press:'))}`, 'the Tap region');
  expect('the click reached the button: scene play, score 0', (await readout(s)).scene === 'play' && (await readout(s)).vars.score === 0);
  expect('the timeline playhead follows the session into the scene', await s.evaluate(`${q(`${tid('scene-band')}[data-scene=play]`)}.classList.contains('live')`));
  // sound: the studio mixed the three audio items and Web Audio started the music and the blip (nothing is heard in headless Chrome)
  await s.waitFor(`${q(tid('play-bar'))}.dataset.buffers === '3' && Number(${q(tid('play-bar'))}.dataset.started) >= 2`, 'the sounds mixed and started');
  const sound = await s.evaluate(`({ buffers: Number(${q(tid('play-bar'))}.dataset.buffers), started: Number(${q(tid('play-bar'))}.dataset.started), note: ${q(tid('interactive-note'))}.textContent })`);
  expect('the sounds were mixed by the studio and the music and the blip started', sound.buffers === 3 && sound.started >= 2 && !/sound/i.test(sound.note), sound);

  s.step('Tab to the button, Enter presses it');
  await s.key('Tab');
  await s.waitFor(`${q(tid('interactive-state'))}.dataset.focus === 'tap:press:'`, 'the focus on Tap');
  await s.key('Enter');
  await s.waitFor(`JSON.parse(${q(tid('interactive-state'))}.dataset.vars).score === 1`, 'score 1');
  expect('Tab focuses the button, Enter fires it: score 1', (await readout(s)).vars.score === 1);
  await s.frame();

  s.step('Click Tap twice: three taps win');
  await press(s, regionSel('tap:press:'), { settle: 150 });
  await s.waitFor(`JSON.parse(${q(tid('interactive-state'))}.dataset.vars).score === 2`, 'score 2');
  await press(s, regionSel('tap:press:'), { settle: 150 });
  await s.waitFor(sceneIs('win'), 'the win scene');
  expect('the third tap goes to win with score 3', (await readout(s)).vars.score === 3);
  await s.waitFor(`${q(regionSel('again:press:'))}`, 'the Play again region');
  await s.sleep(500);
  await s.frame();
  await s.shot(join(out, 'studio', 'v5-play-win.png'));

  s.step('Play again restarts the session');
  await press(s, regionSel('again:press:'));
  await s.waitFor(`${sceneIs('menu')} && ${q(regionSel('start:press:'))}`, 'the menu again');
  expect('the restart wire put the first values back', JSON.stringify((await readout(s)).vars) === '{"score":0,"muted":false}');

  s.step('Keys: Tab and Enter start, Escape goes back, M toggles a variable');
  await s.key('Tab');
  await s.key('Enter');
  await s.waitFor(sceneIs('play'), 'the play scene by keyboard');
  await s.key('Escape');
  await s.waitFor(sceneIs('menu'), 'back to the menu');
  expect('Escape ran the go back wire', (await readout(s)).scene === 'menu');
  await s.key('m');
  await s.waitFor(`JSON.parse(${q(tid('interactive-state'))}.dataset.vars).muted === true`, 'muted');
  expect('a letter key reaches the wires: muted is true', (await readout(s)).vars.muted === true);
  await s.key('m');
  await s.waitFor(`JSON.parse(${q(tid('interactive-state'))}.dataset.vars).muted === false`, 'unmuted');
  const scrollY = await s.evaluate('scrollY');
  await s.key(' ');
  await s.key('ArrowDown');
  expect('Space and the arrows do not scroll the page', (await s.evaluate('scrollY')) === scrollY);
  await s.frame();

  s.step('Pause holds the clock, Resume goes on');
  await press(s, tid('play-interactive'));
  await s.waitFor(modeIs('paused'), 'paused');
  const held = (await readout(s)).frame;
  await s.sleep(500);
  expect('paused: the frame count does not move', (await readout(s)).frame === held);
  await s.shot(join(out, 'studio', 'v5-play-paused.png'));
  await press(s, tid('play-interactive'));
  await s.waitFor(`${modeIs('playing')} && ${q(tid('interactive-state'))}.dataset.frame > ${held}`, 'running again');
  expect('resumed: the clock runs on', true);

  s.step('Restart starts again from the first scene');
  await s.key('Tab');
  await s.key('Enter');
  await s.waitFor(sceneIs('play'), 'play scene');
  await press(s, tid('interactive-restart'));
  await s.waitFor(`${sceneIs('menu')} && ${q(tid('interactive-state'))}.dataset.events === '0'`, 'a fresh session');
  expect('Restart: scene menu, nothing recorded yet', (await readout(s)).scene === 'menu' && (await readout(s)).events === 0);
  await s.key('Tab');
  await s.waitFor(`${q(tid('interactive-state'))}.dataset.focus === 'start:press:'`, 'the focus on Start');
  await s.key('Tab');
  expect('Tab past the last button moves on to the page: the keyboard is not trapped on the stage', (await s.evaluate(`document.activeElement !== ${q(tid('preview-canvas'))}`)) && (await readout(s)).events === 1, await s.evaluate('document.activeElement?.tagName + "." + (document.activeElement?.dataset?.testid ?? "")'));
  await s.evaluate(`${q(tid('preview-canvas'))}.focus()`);

  s.step('A whole run, then Copy log');
  await press(s, regionSel('start:press:'));
  await s.waitFor(`${sceneIs('play')} && ${q(regionSel('tap:press:'))}`, 'the play scene');
  for (let i = 1; i <= 3; i++) {
    await press(s, regionSel('tap:press:'), { settle: 150 });
    if (i < 3) await s.waitFor(`JSON.parse(${q(tid('interactive-state'))}.dataset.vars).score === ${i}`, `score ${i}`);
  }
  await s.waitFor(sceneIs('win'), 'win');
  const end = await readout(s);
  await captureClipboard(s);
  await press(s, tid('interactive-log'));
  await s.waitFor('window.__copied', 'the copied log');
  const log = JSON.parse(await s.evaluate('window.__copied'));
  const types = [...new Set(log.map((e) => e.type))].sort().join();
  expect('Copy log copies the recorded input as JSON (pointer events in frame pixels)', Array.isArray(log) && log.length >= 8 && types.includes('down') && types.includes('up') && log.every((e) => Number.isInteger(e.f) && (e.type === 'key' || e.type === 'leave' || e.type === 'cancel' || (typeof e.x === 'number' && e.x >= 0 && e.x <= 1920 && e.y >= 0 && e.y <= 1080))), { events: log.length, types });
  expect('the frames in the log never go back in time', log.every((e, i) => i === 0 || e.f >= log[i - 1].f));
  expect('the note says what was copied', /Copied \d+ input events/.test(await s.evaluate(`${q(tid('interactive-note'))}.textContent`)));
  const replay = await replayInStudio(DEMO, log);
  if (replay) expect('the studio replays the log to the same scene and variables', replay.scene === end.scene && JSON.stringify(replay.vars) === JSON.stringify(end.vars), { replay, editor: { scene: end.scene, vars: end.vars } });
  else console.log('  · (STUDIO_DATA is not set: the log was not replayed)');

  s.step('Stop goes back to the design timeline');
  await press(s, tid('interactive-stop'));
  await s.waitFor(modeIs('design'), 'design mode');
  await s.waitFor(`${q(tid('preview-canvas'))}.dataset.frame === '0'`, 'the design frame');
  const stopped = await readout(s);
  expect('stopped: the design readout, the timeline and inspector editable again', stopped.mode === 'design' && !(await s.evaluate(`${q(tid('timeline'))}.closest('[inert]') !== null || ${q(tid('inspector'))}.inert`)));
  expect('Copy log still works after Stop', !(await s.evaluate(`${q(tid('interactive-log'))}.disabled`)));
  expect('no preview error was shown', await noError(s));
  await s.frame();
  await s.shot(join(out, 'studio', 'v5-play-stopped.png'));

  await phone(async (p, expectP) => {
    await openEditor(p, DEMO);
    await p.waitFor(`document.querySelectorAll(${JSON.stringify(tid('scene-band'))}).length === 3`, 'the scene bands');
    p.step('On a phone: the stage, the play bar, the scene bands');
    await p.evaluate(`${q(tid('play-bar'))}.scrollIntoView({ block: 'start' })`);
    await p.sleep(300);
    await p.frame();
    await p.shot(join(out, 'studio', 'v5-play-editor-mobile.png'));
    await checkLayout(p, expectP, 'the editor', true);
    await tapAt(p, tid('play-interactive'));
    await p.waitFor(`${modeIs('playing')} && ${q(tid('interactive-state'))}.dataset.frame > 5`, 'the session');
    await tapAt(p, tid('interactive-regions'));
    await p.evaluate(`${q(tid('play-bar'))}.scrollIntoView({ block: 'start' })`);
    await p.sleep(300);
    await p.waitFor(`${q(regionSel('start:press:'))}`, 'the Start outline');
    await p.frame();
    await p.shot(join(out, 'studio', 'v5-play-menu-mobile.png'));
    p.step('Tap Start');
    await p.tap(await p.rect(regionSel('start:press:')).then((r) => ({ x: r.cx, y: r.cy })));
    await p.waitFor(`${sceneIs('play')} && ${q(regionSel('tap:press:'))}`, 'the play scene');
    expectP('a finger on the Start button changes the scene', (await readout(p)).scene === 'play');
    p.step('Tap the button three times');
    for (let i = 1; i <= 3; i++) {
      await p.tap(await p.rect(regionSel('tap:press:'), { scroll: false }).then((r) => ({ x: r.cx, y: r.cy })));
      if (i < 3) await p.waitFor(`JSON.parse(${q(tid('interactive-state'))}.dataset.vars).score === ${i}`, `score ${i}`);
    }
    await p.waitFor(sceneIs('win'), 'win');
    expectP('three taps reach the win scene with score 3', (await readout(p)).vars.score === 3);
    await p.sleep(500);
    await p.frame();
    await p.shot(join(out, 'studio', 'v5-play-win-mobile.png'));
    expectP('the page did not scroll sideways while playing', (await layoutOf(p, false)).overflowX === 0);
    await tapAt(p, tid('interactive-log'));
    await tapAt(p, tid('interactive-stop'));
    await p.waitFor(modeIs('design'), 'design mode');
    expectP('Stop returns to the design timeline, with no preview error', await noError(p));
    await p.frame();
  });
}, {});

// ---- 2. problems
await workflow('problems', 'a deleted item that a wire needs: the panel names the problem and Play refuses; undo fixes it', async (s, expect) => {
  await openEditor(s, DEMO);
  await s.waitFor(`${q(tid('interactive-panel'))} && !${q(tid('interactive-panel'))}.hidden`, 'the panel');
  s.step('Select the Start button and delete it: a wire names an item that is gone');
  await press(s, `${tid('item')}[data-id=start]`);
  await s.waitFor(`${q(tid('selected-id'))}?.textContent === 'start'`, 'the item selected');
  await s.key('Delete');
  await s.waitFor(`${q(tid('interactive-errors'))}`, 'the problems');
  const errs = await s.evaluate(`${q(tid('interactive-errors'))}.textContent`);
  expect('the panel names the problem with its path', /interactive\.wires\[0\]\.on/.test(errs) && /"start"/.test(errs), errs.slice(0, 120));
  await s.frame();
  await s.shot(join(out, 'studio', 'v5-problems.png'), { full: true });
  await press(s, tid('play-interactive'));
  await s.sleep(500);
  expect('Play refuses and says why', (await s.evaluate(`${q(tid('play-interactive'))}.dataset.mode`)) === 'design' && /Fix the problems/.test(await s.evaluate(`${q(tid('interactive-note'))}.textContent`)));
  s.step('Undo brings the item back and the problems go');
  await press(s, tid('undo'));
  await s.waitFor(`!${q(tid('interactive-errors'))}`, 'the problems to go');
  await press(s, tid('play-interactive'));
  await s.waitFor(modeIs('playing'), 'playing');
  expect('after undo Play runs', true);
  await press(s, tid('interactive-stop'));
  await s.waitFor(modeIs('design'), 'design');
  await s.frame();
// the editor asks the studio to measure the draft after each edit; the studio refuses a draft that names a missing item (a 400 the page expects)
}, { expected: (p) => /\/api\/clips\/[a-z0-9-]+\/bundle/.test(p) && /400/.test(p) });

// ---- 3. clips
await workflow('clips', 'the new-clip form: an interactive clip starts as one scene and plays; a video clip is as before', async (s, expect, phone) => {
  await leave(s, `${base}/clips`, `${q(tid('new-clip'))}`);
  s.step('New clip → kind: Interactive');
  await press(s, tid('new-clip'));
  await s.waitFor(`${q(tid('new-clip-dialog'))}?.open`, 'the form');
  expect('the form asks for the kind; video is the default', (await s.evaluate(`${q(tid('new-clip-kind'))}.value`)) === 'video' && (await s.evaluate(`[...${q(tid('new-clip-kind'))}.options].map((o) => o.value).join()`)) === 'video,interactive');
  await press(s, tid('new-clip-name'), { settle: 100 });
  await s.type('v5-new');
  await s.evaluate(`(() => { const k = ${q(tid('new-clip-kind'))}; k.value = 'interactive'; k.dispatchEvent(new Event('change', { bubbles: true })); const d = ${q(tid('new-clip-duration'))}; d.value = '8'; d.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  expect('the hint says it is not rendered', /not rendered/.test(await s.evaluate(`${q(tid('new-clip-kind-hint'))}.textContent`)));
  await s.frame();
  await s.shot(join(out, 'studio', 'v5-clips-form.png'));
  await checkLayout(s, expect, 'the new-clip form', false);
  await press(s, tid('new-clip-create'));
  await s.waitFor(`location.pathname === '/clips/v5-new' && ${q(tid('play-interactive'))} && ${q(tid('preview-canvas'))}?.dataset.frame !== undefined`, 'the editor of the new clip');
  const made = await get(s, '/api/clips/v5-new');
  expect('it was created with one scene as long as the clip', JSON.stringify(made.composition.interactive.scenes) === JSON.stringify([{ id: 'start', start: 0, duration: 8, end: 'hold' }]) && made.composition.duration === 8, made.composition.interactive.scenes);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(tid('scene-band'))}).length === 1`, 'one scene band');
  expect('the editor shows its scene and panel', (await s.evaluate(`${q(`${tid('scene-band')}`)}.dataset.scene`)) === 'start' && /1 scene · 0 variables · 0 wires/.test(await s.evaluate(`${q(tid('interactive-count'))}.textContent`)));
  await s.shot(join(out, 'studio', 'v5-clips-new-editor.png'), { full: true });
  await press(s, tid('play-interactive'));
  await s.waitFor(`${modeIs('playing')} && ${q(tid('interactive-state'))}.dataset.frame > 3`, 'an empty session to run');
  expect('an empty interactive clip plays (scene start), no preview error', (await readout(s)).scene === 'start' && (await noError(s)));
  await s.frame();
  // the page is left while it plays (no Stop): the session and its sound must go quietly (a console error would be counted)

  s.step('A video clip is unchanged');
  await leave(s, `${base}/clips`, `${q(tid('new-clip'))}`);
  await press(s, tid('new-clip'));
  await s.waitFor(`${q(tid('new-clip-dialog'))}?.open`, 'the form');
  await press(s, tid('new-clip-name'), { settle: 100 });
  await s.type('v5-plain');
  await press(s, tid('new-clip-create'));
  await s.waitFor(`location.pathname === '/clips/v5-plain' && ${q(tid('render-button'))}`, 'the editor of the video clip');
  await s.sleep(500);
  const plain = await s.evaluate(`({ render: ${q(tid('render-button'))}.textContent.trim(), bar: !!${q(tid('play-bar'))}, panel: !!${q(tid('interactive-panel'))} && !${q(tid('interactive-panel'))}.hidden, bands: document.querySelectorAll('[data-testid=scene-band]').length, badge: !!${q(tid('interactive-badge'))} })`);
  expect('no play bar, no Interactive panel, no scene bands, the button says Render', plain.render === 'Render' && !plain.bar && !plain.panel && !plain.bands && !plain.badge, plain);
  await s.frame();
  const cards = await get(s, '/api/clips');
  if (cards.clips.some((c) => 'interactive' in c)) {
    await leave(s, `${base}/clips`, `document.querySelectorAll('[data-testid=clip-card]').length >= 3`);
    expect('the clips list marks the interactive clips', (await s.evaluate(`[...document.querySelectorAll('[data-testid=clip-card]')].filter((c) => c.querySelector('[data-testid=interactive-badge]')).map((c) => c.dataset.slug).sort().join()`)) === `${DEMO},v5-new`);
  } else console.log('  · (the clips list has no interactive flag yet: its cards show no badge)');

  await phone(async (p, expectP) => {
    await leave(p, `${base}/clips`, `${q(tid('new-clip'))}`);
    await tapAt(p, tid('new-clip'));
    await p.waitFor(`${q(tid('new-clip-dialog'))}?.open`, 'the form');
    await p.evaluate(`(() => { const k = ${q(tid('new-clip-kind'))}; k.value = 'interactive'; k.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await p.sleep(300);
    await p.frame();
    await p.shot(join(out, 'studio', 'v5-clips-form-mobile.png'));
    await checkLayout(p, expectP, 'the new-clip form', true);
  });
});

// a run of some workflows keeps the report of the others
const reportFile = join(out, 'reports', 'workflows-v5.json');
let before = {};
try { before = JSON.parse(readFileSync(reportFile, 'utf8')).workflows ?? {}; } catch { /* the first run */ }
writeFileSync(reportFile, `${JSON.stringify({ what: 'Iteration-5 studio workflows (the editor\'s interactive mode) driven in headless Chrome with real mouse, keyboard and touch input (scripts/workflows-v5.mjs); every check is asserted by the script.', base, workflows: { ...before, ...report } }, null, 1)}\n`);
console.log(failed ? '\nworkflows: FAILED' : '\nworkflows: all checks passed');
process.exit(failed ? 1 : 0);
