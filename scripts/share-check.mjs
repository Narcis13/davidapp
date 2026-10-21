// Check a share page in headless Chrome, as a viewer would use it: at 1440×900 and 390×844 (a phone: touch, mobile
// emulation), load it, wait for the first frame, let it play, pause, scrub, go full screen and back, start the sound
// with the first tap, play it to its end and replay; then load it again with prefers-reduced-motion (nothing may
// start by itself). Reports console errors, failed requests, the page's weight (bytes over the network) and the
// time to the first frame, with screenshots. With --parity, frames drawn by the page's own engine are compared
// with the Node renderer's (the studio's data dir, in this process: the studio server need not run).
//
//   node scripts/share-check.mjs <page url> [--out <dir>] [--sizes 1440x900,390x844m | none]
//        [--parity --clip <slug> [--frames 0,120,240]]      (parity needs STUDIO_DATA)
//
// Set TMPDIR and CHROME (Windows). Writes <out>/share-check.json and the screenshots; exits 1 when a check failed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession } from './lib/browser.mjs';
import { compare, decode, diffImage } from './lib/parity.mjs';
import { LIMIT } from './lib/parity-cases.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const url = argv[0];
if (!url || url.startsWith('--')) {
  console.error('usage: node scripts/share-check.mjs <page url> [--out dir] [--sizes 1440x900,390x844m] [--parity --clip <slug> [--frames 0,120]]');
  process.exit(2);
}
const out = opt('out', join(process.env.TMPDIR ?? '.', 'share-check'));
mkdirSync(out, { recursive: true });
// WxH, an m for a phone (touch, mobile emulation); none: only the parity check
const sizes = opt('sizes', '1440x900,390x844m').split(',').map((s) => /^(\d+)x(\d+)(m?)$/.exec(s)).filter(Boolean).map((m) => ({ width: Number(m[1]), height: Number(m[2]), mobile: !!m[3] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAIN = 'document.querySelector("[data-share]")';
const state = `${MAIN}.dataset.state`;
const frameNow = 'Number(document.querySelector("[data-testid=canvas]").dataset.frame ?? -1)';

/** One viewport: every check, its numbers, its screenshots. */
async function checkSize({ width, height, mobile }) {
  const name = `${width}x${height}${mobile ? '-mobile' : ''}`;
  console.log(`\n${name}`);
  const s = await openSession({ width, height, mobile, scale: mobile ? 3 : 1 });
  const checks = {}, shots = [];
  let bytes = 0, requests = 0;
  s.onEvent((method, p) => {
    // the player's worker is a target of its own: its requests, console and exceptions are only seen once attached
    if (method === 'Target.attachedToTarget') {
      (async () => {
        for (const d of ['Runtime', 'Network', 'Log']) await s.send(`${d}.enable`, {}, p.sessionId).catch(() => {});
        await s.send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {});
      })();
    }
    if (method === 'Network.requestWillBeSent') requests++;
    if (method === 'Network.loadingFinished') bytes += p.encodedDataLength;
  });
  const ok = (key, pass, detail) => { checks[key] = { ok: !!pass, ...(detail === undefined ? {} : { detail }) }; console.log(`  ${pass ? '✓' : '✖'} ${key}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };
  const shot = async (label) => { const file = join(out, `${name}-${label}.png`); await s.shot(file); shots.push(file); };
  const press = (target) => (mobile ? s.tap(target, { settle: 400 }) : s.click(target, { settle: 400 }));
  const frameAdvances = async (ms = 1200) => { const a = await s.evaluate(frameNow); await sleep(ms); const b = await s.evaluate(frameNow); return { from: a, to: b }; };
  // the viewer's way to bring the controls up: a mouse moves over the frame, a finger taps it once
  const controls = async () => {
    const r = await s.rect('[data-testid=frame]');
    if (mobile) { if ((await s.evaluate(`${MAIN}.dataset.chrome`)) === 'off') await s.tap({ x: r.cx, y: r.y + r.height * 0.3 }); } else await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.y + r.height * 0.3 });
    await sleep(200);
  };
  try {
    await s.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await s.send('Page.navigate', { url });
    await s.waitFor(`${MAIN}?.dataset.firstFrame`, 'the first frame', 60000);
    const ttff = Number(await s.evaluate(`${MAIN}.dataset.firstFrame`));
    ok('first frame', ttff > 0, `${ttff} ms after navigation`);
    const firstBytes = bytes, firstRequests = requests;
    await s.waitFor(`${state} === 'playing'`, 'it to play by itself', 15000);
    const moved = await frameAdvances();
    ok('plays by itself (muted)', moved.to > moved.from && (await s.evaluate(`${MAIN}.hasAttribute('data-muted')`)), moved);
    ok('a way to turn the sound on', await s.evaluate('!document.querySelector("[data-testid=sound-hint]").hidden'));
    await shot('1-playing');

    // the first tap: the sound starts, the picture keeps playing
    await press('[data-testid=sound-hint]');
    await sleep(600);
    const sound = await s.evaluate(`(() => { const a = document.querySelector('audio'); return { playing: !!a && !a.paused, muted: ${MAIN}.hasAttribute('data-muted'), t: a?.currentTime, state: ${state} }; })()`);
    ok('sound starts on the first tap', sound.playing && !sound.muted && sound.state === 'playing', sound);

    // pause and play with the control bar
    await controls();
    await press('[data-testid=play]');
    await s.waitFor(`${state} === 'paused'`, 'it to pause', 5000);
    const still = await frameAdvances(700);
    ok('pauses', still.to === still.from && (await s.evaluate('document.querySelector("audio").paused')), still);
    await shot('2-paused');
    await press('[data-testid=play]');
    await s.waitFor(`${state} === 'playing'`, 'it to play again', 5000);
    const again = await frameAdvances(800);
    ok('plays again', again.to > again.from, again);

    // scrub: press on the scrubber at 60% of its track
    await controls();
    const bar = await s.rect('[data-testid=scrub]');
    const total = await s.evaluate('(() => { const d = Number(document.querySelector("[data-testid=scrub]").max); return d; })()');
    await press('[data-testid=play]');
    await s.waitFor(`${state} === 'paused'`, 'it to pause before scrubbing', 5000);
    await controls();
    const at = { x: bar.x + 7 + (bar.width - 14) * 0.6, y: bar.cy };
    await press(at);
    await sleep(900);
    const fps = await s.evaluate(`${MAIN}.querySelector('[data-testid=scrub]').step`).then((v) => Math.round(1 / Number(v)));
    const want = Math.floor(total * 0.6 * fps);
    const got = await s.evaluate(frameNow);
    ok('scrubs', Math.abs(got - want) <= Math.max(3, fps / 2), { want, got, time: await s.evaluate('document.querySelector("[data-testid=time] .now").textContent') });
    await shot('3-scrubbed');

    // keyboard (desktop): K plays and pauses, → jumps 5 s, M turns the sound off and on
    if (!mobile) {
      await s.key('k');
      const k1 = await s.evaluate(state);
      await s.key('k');
      const k2 = await s.evaluate(state);
      const before = await s.evaluate(frameNow);
      await s.key('ArrowRight');
      await sleep(500);
      const after = await s.evaluate(frameNow);
      await s.key('m');
      const m1 = await s.evaluate(`${MAIN}.hasAttribute('data-muted')`);
      await s.key('m');
      const m2 = await s.evaluate(`${MAIN}.hasAttribute('data-muted')`);
      ok('keyboard: K, →, M', k1 === 'playing' && k2 === 'paused' && after - before >= 5 * fps - 2 && m1 && !m2, { k1, k2, before, after, m1, m2 });
    }

    // full screen and back
    await controls();
    await press('[data-testid=fullscreen]');
    await sleep(700);
    const fs = await s.evaluate(`({ full: ${MAIN}.dataset.full ?? null, element: document.fullscreenElement === ${MAIN}, frame: (() => { const r = document.querySelector('[data-testid=frame]').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(), viewport: [innerWidth, innerHeight] })`);
    ok('full screen', !!fs.full && (fs.frame[0] === fs.viewport[0] || fs.frame[1] === fs.viewport[1]), fs);
    await shot('4-fullscreen');
    await controls();
    await press('[data-testid=fullscreen]');
    await sleep(600);
    ok('leaves full screen', !(await s.evaluate(`${MAIN}.dataset.full`)) && !(await s.evaluate('document.fullscreenElement')));

    // the end: replay starts it again from the start
    await s.evaluate(`(() => { const r = document.querySelector('[data-testid=scrub]'); r.value = String(Number(r.max) - 0.6); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(300);
    await controls();
    if ((await s.evaluate(state)) !== 'playing') await press('[data-testid=play]');
    await s.waitFor(`${state} === 'ended'`, 'the end', 8000);
    ok('ends with a replay button', await s.evaluate('!document.querySelector("[data-testid=big-play]").hidden && document.querySelector("[data-testid=big-play]").getAttribute("aria-label") === "Replay"'));
    await shot('5-ended');
    await press('[data-testid=big-play]');
    await sleep(600);
    ok('replays from the start', (await s.evaluate(state)) === 'playing' && (await s.evaluate(frameNow)) < fps * 2, { frame: await s.evaluate(frameNow) });

    // the details under the frame stay on screen: nothing scrolls
    const fit = await s.evaluate('({ scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], viewport: [innerWidth, innerHeight] })');
    ok('fits the viewport (no scroll)', fit.scroll[0] <= fit.viewport[0] && fit.scroll[1] <= fit.viewport[1], fit);
    const weight = bytes;
    const count = requests;
    await sleep(300);

    // reduced motion: the poster and the play button, nothing moves until asked
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await s.send('Page.navigate', { url });
    await s.waitFor(`${state} === 'ready'`, 'the page to be ready', 60000);
    await sleep(1200);
    const rm = await s.evaluate(`({ state: ${state}, drawn: ${MAIN}.hasAttribute('data-drawn'), big: !document.querySelector('[data-testid=big-play]').hidden })`);
    ok('reduced motion: poster and play button, no autoplay', rm.state === 'ready' && !rm.drawn && rm.big, rm);
    await shot('6-reduced-motion');
    await press('[data-testid=big-play]');
    await sleep(800);
    const rmPlay = await s.evaluate(`({ state: ${state}, sound: !document.querySelector('audio')?.paused })`);
    ok('reduced motion: play starts it with sound', rmPlay.state === 'playing' && rmPlay.sound, rmPlay);

    ok('no console errors or failed requests', !s.problems.length, s.problems.length ? s.problems.slice(0, 8) : undefined);
    return { size: name, width, height, mobile, firstFrameMs: ttff, firstFrameBytes: firstBytes, firstFrameRequests: firstRequests, bytes: weight, requests: count, checks, problems: [...s.problems], screenshots: shots };
  } catch (e) {
    ok('ran to the end', false, e.message);
    await shot('error').catch(() => {});
    return { size: name, width, height, mobile, checks, problems: [...s.problems], screenshots: shots, error: e.message };
  } finally {
    await s.close();
  }
}

// Runs in the page: its own engine (the share page's player/engine.js) draws the frames into a fresh canvas.
const PAGE_FRAMES = `async (frames) => {
  const script = [...document.scripts].find((s) => s.type === 'module' && /player\\.js$/.test(s.src));
  const { Engine } = await import(new URL('engine.js', script.src).href);
  const base = new URL(document.querySelector('[data-share]').dataset.bundle, location.href);
  const data = await (await fetch(base)).json();
  const canvas = document.createElement('canvas');
  const engine = new Engine({ canvas });
  try {
    await engine.load(data, { base });
    const out = [];
    for (const frame of frames) {
      await engine.drawFrame(frame, {});
      const c = new OffscreenCanvas(canvas.width, canvas.height);
      const g = c.getContext('2d');
      g.drawImage(canvas, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = '';
      for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      out.push({ width: c.width, height: c.height, rgba: btoa(s) });
    }
    return out;
  } finally { engine.destroy(); }
}`;

async function parity() {
  const clip = opt('clip');
  if (!clip || !process.env.STUDIO_DATA) throw new Error('--parity needs --clip <slug> and STUDIO_DATA');
  const { createStudio } = await import('../src/studio/studio.js');
  const studio = createStudio({ role: 'share-check' });
  const s = await openSession({ width: 1440, height: 900 });
  const rows = [];
  try {
    const comp = studio.clips.getClip(clip).composition;
    const total = Math.round(comp.duration * comp.fps);
    const frames = opt('frames') ? opt('frames').split(',').map(Number) : [0, Math.round(total * 0.25), Math.round(total * 0.5), total - 1];
    await s.send('Page.navigate', { url });
    await s.waitFor(`${MAIN}?.dataset.firstFrame`, 'the page', 60000);
    const page = (await s.evaluate(`(${PAGE_FRAMES})(${JSON.stringify(frames)})`)).map((f) => ({ width: f.width, height: f.height, data: new Uint8Array(Buffer.from(f.rgba, 'base64')) }));
    console.log('\nparity (share page vs Node render)');
    for (const [i, frame] of frames.entries()) {
      const node = await decode((await studio.clipFrame({ clip, frame })).png);
      const m = compare(page[i], node);
      const pass = m.meanDiff <= LIMIT.meanDiff && m.over64 <= LIMIT.over64 && m.distinct > 8;
      const image = join(out, `parity-${clip}-f${frame}.png`);
      writeFileSync(image, diffImage(page[i], node));
      rows.push({ frame, t: Math.round((frame / comp.fps) * 1000) / 1000, ...m, ok: pass, image });
      console.log(`  ${pass ? '✓' : '✖'} frame ${String(frame).padStart(4)}  mean ${m.meanDiff}  max ${m.maxDiff}  >16 ${m.over16}%  >64 ${m.over64}%  colours ${m.distinct}`);
    }
    return { clip, limit: LIMIT, frames: rows, problems: [...s.problems] };
  } finally {
    await s.close();
    await studio.close();
  }
}

const report = { url, at: new Date().toISOString(), sizes: [], parity: null };
for (const size of sizes) report.sizes.push(await checkSize(size));
if (argv.includes('--parity')) report.parity = await parity();
const failed = report.sizes.some((r) => r.error || Object.values(r.checks).some((c) => !c.ok)) || (report.parity && (report.parity.frames.some((f) => !f.ok) || report.parity.problems.length));
report.ok = !failed;
writeFileSync(join(out, 'share-check.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log(`\n${failed ? 'FAILED' : 'ok'}: ${join(out, 'share-check.json')}`);
for (const r of report.sizes) if (r.bytes) console.log(`  ${r.size}: first frame ${r.firstFrameMs} ms after ${(r.firstFrameBytes / 1e6).toFixed(2)} MB in ${r.firstFrameRequests} requests; the whole visit ${(r.bytes / 1e6).toFixed(2)} MB in ${r.requests} requests`);
process.exit(failed ? 1 : 0);
