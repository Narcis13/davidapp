// Play an interactive share page in headless Chrome the way a viewer would, and measure it: the press on the big play
// button, taps on the clip's own controls (found by item in the regions the frame drew, pressed with real mouse or
// touch input at their centre), key presses, and for a rhythm game a bot that presses each note's key while it is
// in reach. It reports console and network problems, the time to the first frame, the bytes loaded, the states it
// went through, and the frame timings (draw time per frame, session frames skipped), and can record a GIF.
//
//   node scripts/play-check.mjs <page url> <out dir> [--size 390x844] [--mobile] [--steps steps.json] [--gif name] [--name run]
//
// A step: { "start": true } · { "tap": "<item>" | { "item", "region", "id" } } · { "key": "d" } · { "wait": seconds }
// · { "bot": { "until": "<scene>", "miss": 0.08, "good": 0.2 } } · { "shot": "name" } · { "expect": { "scene": "game" } }
// · { "measure": true } (frame timings from here) · { "pointer": "x,y" } (a move, frame pixels).
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
mkdirSync(out, { recursive: true });

const s = await openSession({ width, height, mobile });
const report = { url, size: `${width}x${height}`, mobile, steps: [], problems: [], states: [] };
const frames = [];
let stopCast = null;
try {
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const t0 = Date.now();
  await s.goto(url, 'document.querySelector("[data-share]")?.dataset.state === "ready"');
  report.firstFrame = await s.evaluate('Number(document.querySelector("[data-share]").dataset.firstFrame)');
  report.readyMs = Date.now() - t0;
  if (gif) {
    // the screencast's frames, scaled to 480 px, kept with their times
    stopCast = s.onEvent((method, p) => {
      if (method !== 'Page.screencastFrame') return;
      frames.push({ at: p.metadata.timestamp, data: p.data });
      s.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    });
    await s.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: mobile ? 480 : 960, maxHeight: mobile ? 1040 : 600, everyNthFrame: 1 });
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
    if (step.start) { if (mobile) await s.tap('[data-testid=big-play]'); else await s.click('[data-testid=big-play]'); }
    else if (step.wait !== undefined) await s.sleep(step.wait * 1000);
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
    } else if (step.bot) {
      // page-side, so a key lands in the frame its note is in reach: the first key of each note region, some notes
      // pressed late (good) and some let go (missed), chosen by the note's index so a run is the same every time
      await s.evaluate(`(() => {
        const f = window.fablecut, o = ${JSON.stringify(step.bot)}, done = new Set();
        const hash = (n) => { const x = Math.sin(n * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };
        f.botDone = false;
        const tick = () => {
          if (f.session.state.scene === o.until) { f.botDone = true; return; }
          for (const r of f.session.regions) {
            if ((r.name !== 'perfect' && r.name !== 'good') || done.has(r.id)) continue;
            const h = hash(r.id);
            if (h < (o.miss ?? 0)) { done.add(r.id); continue; }
            if (r.name === 'perfect' && h < (o.miss ?? 0) + (o.good ?? 0)) continue;
            done.add(r.id);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: r.keys[0], bubbles: true }));
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })()`);
      await s.waitFor('window.fablecut.botDone === true', 'the bot to reach the end of the song', 120000);
    } else if (step.shot) await s.shot(join(out, `${name}-${step.shot}.png`));
    else if (step.measure) measureFrom = await s.evaluate('({ drawn: window.fablecut.stats.drawn, skipped: window.fablecut.stats.skipped, n: window.fablecut.stats.ms.length })');
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
  const fps = 12, first = frames[0].at, last = frames.at(-1).at;
  let k = 0, j = 0;
  for (let t = first; t <= last; t += 1 / fps, k++) {
    while (j + 1 < frames.length && frames[j + 1].at <= t) j++;
    writeFileSync(join(dir, `${String(k).padStart(5, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'));
  }
  const file = join(out, `${gif}.gif`);
  const r = await run(ffmpegPath(), ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, '%05d.jpg'), '-vf', 'split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', file]);
  if (r.code !== 0) report.gifError = r.stderr;
  else report.gif = { file, frames: k, seconds: Math.round((last - first) * 10) / 10 };
  rmSync(dir, { recursive: true, force: true });
}

writeFileSync(join(out, `${name}-report.json`), `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ size: report.size, error: report.error, problems: report.problems, firstFrame: report.firstFrame, frames: report.frames, bytes: report.bytes, end: report.end, gif: report.gif }, null, 1));
process.exit(report.error || report.problems.length ? 1 : 0);
