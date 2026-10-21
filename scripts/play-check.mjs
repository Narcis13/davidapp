// Play an interactive share page in headless Chrome the way a viewer would, and measure it: the press on the big play
// button, taps on the clip's own controls (found by item in the regions the frame drew, pressed with real mouse or
// touch input at their centre), key presses, and for a rhythm game a bot that presses each note's key while it is
// in reach. It reports console and network problems, the time to the first frame, the bytes loaded, the states it
// went through, and the frame timings (draw time per frame, session frames skipped and where, and any time the browser
// itself gave the page no animation frame for 50 ms), and can record a GIF.
//
//   node scripts/play-check.mjs <page url> <out dir> [--size 390x844] [--mobile] [--steps steps.json] [--gif name] [--name run] [--gpu | --headful] [--gif-fps 12] [--gif-size 480]
//
// --gpu runs headless Chrome with its GPU on (by default it runs without one); --headful opens a visible window instead
// (its frames come at the display's own rate). Frame timings are worth reading with one of them.
//
// A step: { "start": true } (presses the play button if the page shows one) · { "tap": "<item>" | { "item", "region", "id" } } · { "key": "d" } · { "wait": seconds }
// · { "bot": { "until": "<scene>", "miss": 0.08, "good": 0.2, "input": "key" | "touch" | "mouse" } } (key by default)
// · { "shot": "name" } · { "expect": { "scene": "game" } }
// · { "measure": true } (frame timings from here) · { "pointer": "x,y" } (a move, frame pixels)
// · { "click": "<selector>" } (a page control, by mouse or finger) · { "check": "<js expression>" } (must be true).
// Headless Chrome: set TMPDIR and CHROME only (not TEMP/TMP; see .claude/goal-loop/project.md).

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openSession } from './lib/browser.mjs';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';

const argv = process.argv.slice(2);
const [url, out] = argv;
if (!url || !out) { console.error('usage: node scripts/play-check.mjs <url> <out dir> [--size WxH] [--mobile] [--steps file] [--gif name] [--name run]'); process.exit(2); }
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [width, height] = opt('--size', '1440x900').split('x').map(Number);
const mobile = argv.includes('--mobile');
const name = opt('--name', `${width}x${height}${mobile ? '-mobile' : ''}`);
const steps = JSON.parse(readFileSync(opt('--steps', ''), 'utf8'));
const gif = opt('--gif', null);
// the GIF's frame rate and the longer side of its frames
const gifFps = Number(opt('--gif-fps', 12)), gifSize = Number(opt('--gif-size', mobile ? 480 : 960));
mkdirSync(out, { recursive: true });

const headful = argv.includes('--headful'), gpu = argv.includes('--gpu');

// The bot's choice, page-side: the notes to press now (keys, or points on screen for taps and clicks). A note in reach
// draws good over its whole window and perfect on top near the beat: a perfect press waits for perfect, a good one goes
// at the first sight of good, a missed note is let go; which is which comes from the note's index (o.miss and o.good
// are shares), so a run presses the same notes every time.
const CHOOSE = `(o, done, where) => {
  const f = window.fablecut;
  if (f.session.state.scene === o.until) return { done: true };
  const hash = (n) => { const x = Math.sin(n * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };
  const perfect = new Set(f.session.regions.filter((r) => r.name === 'perfect').map((r) => r.id));
  const cv = document.querySelector('[data-testid=canvas]'), box = where ? cv.getBoundingClientRect() : null;
  const press = [];
  for (const r of f.session.regions) {
    if ((r.name !== 'perfect' && r.name !== 'good') || done.has(r.id)) continue;
    const h = hash(r.id);
    if (h < (o.miss ?? 0)) { done.add(r.id); continue; }
    const early = h < (o.miss ?? 0) + (o.good ?? 0);
    if (!early && !perfect.has(r.id)) continue;
    if (early && perfect.has(r.id)) continue;
    done.add(r.id);
    if (!where) { press.push(r.keys[0]); continue; }
    const [a, b, c, d, e, g] = r.m, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    press.push({ x: box.left + ((a * cx + c * cy + e) * box.width) / cv.width, y: box.top + ((b * cx + d * cy + g) * box.height) / cv.height });
  }
  return { press };
}`;
const s = await openSession({ width, height, mobile, headful, gpu });
const report = { url, size: `${width}x${height}`, mobile, headful, gpu, steps: [], problems: [], states: [] };
const frames = [];
let stopCast = null;
try {
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const t0 = Date.now();
  // an interactive page plays as soon as it is ready (with reduced motion it waits for its play button)
  await s.goto(url, '["ready", "playing"].includes(document.querySelector("[data-share]")?.dataset.state)');
  report.firstFrame = await s.evaluate('Number(document.querySelector("[data-share]").dataset.firstFrame)');
  await s.evaluate(`(() => { window.__stalls = []; let last = performance.now();
    const watch = (t) => { if (t - last > 50) window.__stalls.push({ at: Math.round(last), ms: Math.round(t - last) }); last = t; requestAnimationFrame(watch); };
    requestAnimationFrame(watch); })()`);
  report.readyMs = Date.now() - t0;
  if (gif) {
    // the screencast's frames, scaled to 480 px, kept with their times
    stopCast = s.onEvent((method, p) => {
      if (method !== 'Page.screencastFrame') return;
      frames.push({ at: p.metadata.timestamp, data: p.data });
      s.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    });
    await s.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: gifSize, maxHeight: gifSize, everyNthFrame: 1 });
  }
  const state = () => s.evaluate('(() => { const f = window.fablecut; if (!f) return null; const st = f.session.state; return { scene: st.scene, vars: st.vars, frame: f.session.frame, page: document.querySelector("[data-share]").dataset.state }; })()');
  /** The centre of a region on screen, in CSS pixels. */
  const regionPoint = (want) => s.evaluate(`(() => {
    const f = window.fablecut, w = ${JSON.stringify(want)};
    const r = f.session.regions.find((x) => x.item === w.item && (w.region === undefined || x.name === w.region) && (w.id === undefined || String(x.id) === String(w.id)));
    if (!r) return { missing: f.session.regions.map((x) => x.item + '.' + x.name).join(', ') };
    const [a, b, c, d, e, g] = r.m, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const fx = a * cx + c * cy + e, fy = b * cx + d * cy + g;
    const cv = document.querySelector('[data-testid=canvas]'), box = cv.getBoundingClientRect();
    return { x: box.left + (fx * box.width) / cv.width, y: box.top + (fy * box.height) / cv.height };
  })()`);
  let measureFrom = null;
  for (const step of steps) {
    const at = Date.now();
    // the play button, when the page shows one (reduced motion, or paused)
    if (step.start) { if (await s.evaluate('!document.querySelector("[data-testid=big-play]").hidden')) { if (mobile) await s.tap('[data-testid=big-play]'); else await s.click('[data-testid=big-play]'); } }
    else if (step.wait !== undefined) await s.sleep(step.wait * 1000);
    else if (step.click) { if (mobile) await s.tap(step.click); else await s.click(step.click); }
    else if (step.check) { if (!(await s.evaluate(step.check))) throw new Error(`check failed: ${step.check}`); }
    else if (step.key !== undefined) await s.key(step.key);
    else if (step.tap !== undefined) {
      const want = typeof step.tap === 'string' ? { item: step.tap } : step.tap;
      // the region may still be fading in: look for it for a second
      let p = null;
      for (let i = 0; i < 20 && !(p && !p.missing); i++) { p = await regionPoint(want); if (p.missing !== undefined) await s.sleep(50); }
      if (p.missing !== undefined) throw new Error(`no region for ${JSON.stringify(want)} (regions: ${p.missing})`);
      if (mobile) await s.tap({ x: p.x, y: p.y }, { settle: 150 }); else await s.click({ x: p.x, y: p.y }, { settle: 150 });
    } else if (step.pointer !== undefined) {
      const [x, y] = step.pointer.split(',').map(Number);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    } else if (step.bot && (step.bot.input === 'touch' || step.bot.input === 'mouse')) {
      // real taps or clicks on the notes, sent from here: each round asks the page which notes to press now (the same
      // choice as the key bot) and where they are, and presses them. A round trip takes a few ms, well inside a note's
      // window (±0.14 s; perfect ±0.06 s)
      await s.evaluate('window.__bot = new Set()');
      const end = Date.now() + 120000;
      for (;;) {
        const r = await s.evaluate(`(${CHOOSE})(${JSON.stringify(step.bot)}, window.__bot, true)`);
        if (r.done) break;
        for (const p of r.press) {
          if (step.bot.input === 'touch') {
            await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
            await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
            await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
          }
        }
        if (Date.now() > end) throw new Error(`the bot did not reach ${step.bot.until}`);
        await s.sleep(4);
      }
    } else if (step.bot) {
      // page-side, so a key lands in the frame its note is in reach: the first key of each note region
      await s.evaluate(`(() => {
        const f = window.fablecut, o = ${JSON.stringify(step.bot)}, done = new Set(), choose = ${CHOOSE};
        f.botDone = false;
        const tick = () => {
          const r = choose(o, done, false);
          if (r.done) { f.botDone = true; return; }
          for (const key of r.press) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })()`);
      await s.waitFor('window.fablecut.botDone === true', 'the bot to reach the end of the song', 120000);
    } else if (step.shot) await s.shot(join(out, `${name}-${step.shot}.png`));
    else if (step.measure) measureFrom = await s.evaluate('({ drawn: window.fablecut.stats.drawn, skipped: window.fablecut.stats.skipped, n: window.fablecut.stats.ms.length, last: window.fablecut.stats.last, at: performance.now() })');
    else if (step.expect) {
      const st = await state();
      for (const [k, v] of Object.entries(step.expect)) {
        const got = k === 'scene' ? st.scene : k === 'page' ? st.page : st.vars[k];
        if (got !== v) throw new Error(`expected ${k} = ${JSON.stringify(v)}, got ${JSON.stringify(got)} (state ${JSON.stringify(st)})`);
      }
    }
    const st = await state();
    report.steps.push({ step, ms: Date.now() - at, scene: st?.scene, vars: st?.vars });
  }
  if (stopCast) { await s.send('Page.stopScreencast'); stopCast(); }
  // frame timings over what was measured (from the measure step, else the whole run)
  const stats = await s.evaluate('JSON.parse(JSON.stringify(window.fablecut.stats))');
  const ms = stats.ms.slice(measureFrom ? measureFrom.n : 0).sort((a, b) => a - b);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  report.frames = {
    drawn: stats.drawn - (measureFrom?.drawn ?? 0), skipped: stats.skipped - (measureFrom?.skipped ?? 0),
    drawMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: ms.at(-1), over16: ms.filter((x) => x > 16.7).length },
    slow: stats.slow,
    // where frames were skipped, and the times the browser itself gave the page no animation frame for over 50 ms
    // (then frames are skipped however fast they draw: the browser or the machine was busy elsewhere)
    gaps: (stats.gaps ?? []).filter((g) => g.after >= (measureFrom?.last ?? -1)),
    stalls: (await s.evaluate('window.__stalls ?? []')).filter((g) => g.at >= (measureFrom?.at ?? 0)),
  };
  report.bytes = await s.evaluate('performance.getEntriesByType("resource").reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize ?? 0)');
  report.log = await s.evaluate('window.fablecut.session.log.length');
  report.end = await state();
  writeFileSync(join(out, `${name}-log.json`), JSON.stringify(await s.evaluate('window.fablecut.session.log')));
} catch (e) {
  report.error = e.message;
  await s.shot(join(out, `${name}-error.png`)).catch(() => {});
} finally {
  report.problems = [...s.problems];
  await s.close();
}

if (gif && frames.length) {
  // a constant 12 fps from the screencast's uneven frames: each output frame shows the latest one before its time
  const dir = join(out, `${name}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fps = gifFps, first = frames[0].at, last = frames.at(-1).at;
  let k = 0, j = 0;
  for (let t = first; t <= last; t += 1 / fps, k++) {
    while (j + 1 < frames.length && frames[j + 1].at <= t) j++;
    writeFileSync(join(dir, `${String(k).padStart(5, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'));
  }
  const file = join(out, `${gif}.gif`);
  const r = await run(ffmpegPath(), ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, '%05d.jpg'), '-vf', 'split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', file]);
  if (r.code !== 0) report.gifError = r.stderr;
  else report.gif = { file: `${gif}.gif`, frames: k, seconds: Math.round((last - first) * 10) / 10 };
  rmSync(dir, { recursive: true, force: true });
}

writeFileSync(join(out, `${name}-report.json`), `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ size: report.size, error: report.error, problems: report.problems, firstFrame: report.firstFrame, frames: report.frames, bytes: report.bytes, end: report.end, gif: report.gif }, null, 1));
process.exit(report.error || report.problems.length ? 1 : 0);
