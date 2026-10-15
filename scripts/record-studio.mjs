// Record a studio workflow in headless Chrome to an MP4, with a sidecar JSON of what happened when, so a
// video about the studio can show its real UI and draw its own cursor and spotlights from the sidecar.
//
//   node scripts/record-studio.mjs <url> <workflow> <out.mp4> [--size 1440x900] [--scale 1] [--fps 30]
//                                  [--max-seconds 60] [--format png|jpeg] [--crf 20] [--keep-frames]
//
//   url        the studio page the recording starts on (a workflow can name its own start page, see below)
//   workflow   a name in scripts/recordings/<name>.mjs, or a path to a module
//   out.mp4    H.264, yuv420p, BT.709 tags, constant frame rate, faststart; <out.mp4>.json is the sidecar
//   --size     the viewport in CSS pixels; --scale the device scale factor (2 = a 2× video of the same layout)
//
// A workflow module default-exports `async (r) => { … }`. It may also export `start` (a path, used when the
// url has none) and `ready` (a selector that must exist before recording begins: the first frame is the
// page after load). `r` drives the page with real input: a mouse that moves in eased arcs over a few
// hundred ms, typed keys with a human rhythm, wheel scrolling, slider drags. See scripts/recordings/.
//
//   r.navigate(path, ready?)        load a page (visible in the recording; prefer clicking links)
//   r.waitFor(selector)             wait for an element; its box goes to the sidecar; → { x, y, width, height, cx, cy }
//   r.until(expression, what?)      wait until a page expression is truthy
//   r.click(selector) r.clickAt(x, y)   move the cursor there, press, release
//   r.hover(selector, { dwell })    move there and rest
//   r.move(x, y) r.drag(from, to)   from/to are { x, y } or a selector
//   r.slider(selector, value)       drag a range input's thumb to a value
//   r.fill(selector, text)          click a field, select its content, type
//   r.type(text, { delay }) r.press(key, { modifiers })
//   r.scroll(dy, { at: [x, y], ms })
//   r.pause(ms) r.mark(label) r.evaluate(js) r.at()   … and r.size, r.scale
//
// Frames come from the CDP screencast (Page.startScreencast, PNG by default): Chrome sends one when the page
// repainted, with a timestamp. They are resampled to a constant frame rate (frame k shows the last captured
// frame at or before k/fps), so a still page costs almost nothing. All times in the sidecar are seconds on
// the video's timeline (0 = the first frame), all coordinates are video pixels (CSS pixels × scale).
//
// A live capture is not deterministic: the page's timers, the machine's speed and Chrome's repaint timing
// all vary, so two recordings of one workflow differ in their bytes. What is deterministic is what follows:
// commit the MP4 and its sidecar, and every clip made from them uses the same bytes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSession } from './lib/browser.mjs';
import { easeInOut, encode, travelMs } from './lib/record.mjs';
import { ROOT } from '../src/render/host.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function parse(argv) {
  const pos = [];
  const o = { size: '1440x900', scale: 1, fps: 30, maxSeconds: 60, format: 'png', crf: 20, keepFrames: false, tail: 0.6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const key = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (key === 'keepFrames') { o.keepFrames = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    if (!(key in o)) throw new Error(`unknown option ${a}`);
    o[key] = typeof o[key] === 'number' ? Number(v) : v;
    if (typeof o[key] === 'number' && !(o[key] > 0)) throw new Error(`${a} must be a positive number`);
  }
  if (pos.length !== 3) throw new Error('usage: node scripts/record-studio.mjs <url> <workflow> <out.mp4> [--size 1440x900] [--scale 1] [--fps 30] [--max-seconds 60]');
  const m = /^(\d+)x(\d+)$/.exec(o.size);
  if (!m) throw new Error('--size must look like 1440x900');
  if (!['png', 'jpeg'].includes(o.format)) throw new Error('--format must be png or jpeg');
  return { url: pos[0], workflow: pos[1], out: resolve(pos[2]), ...o, width: Number(m[1]), height: Number(m[2]) };
}

async function loadWorkflow(name) {
  const file = /[\\/]|\.m?js$/.test(name) ? resolve(name) : join(ROOT, 'scripts', 'recordings', `${name}.mjs`);
  const mod = await import(pathToFileURL(file).href).catch((e) => { throw new Error(`cannot load workflow ${name} (${file}): ${e.message}`); });
  if (typeof mod.default !== 'function') throw new Error(`${file} must default-export an async function`);
  return mod;
}

const KEYS = { Enter: 13, Escape: 27, Tab: 9, Delete: 46, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

async function main() {
  const opt = parse(process.argv.slice(2));
  const mod = await loadWorkflow(opt.workflow);
  const target = new URL(opt.url);
  if (mod.start && (target.pathname === '/' || target.pathname === '')) target.pathname = mod.start;
  const base = target.origin;
  // an even video size; the viewport is what the page lays out in
  const W = Math.floor((opt.width * opt.scale) / 2) * 2, H = Math.floor((opt.height * opt.scale) / 2) * 2;
  const scale = opt.scale;
  const px = (v) => round(v * scale);

  const s = await openSession({ width: opt.width, height: opt.height, scale, chromeArgs: ['--force-color-profile=srgb'] });
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'record-frames-'));
  const ext = opt.format === 'png' ? 'png' : 'jpg';
  /** @type {{ file: string, ts: number, time: number }[]} */
  const frames = [];
  const writes = [];
  let T0 = null;
  let failure = null;

  try {
    await s.goto(target.href, mod.ready && `!!document.querySelector(${JSON.stringify(mod.ready)})`);
    await s.evaluate(`document.fonts?.ready`).catch(() => {});

    // ---- capture
    const stop = s.onEvent((method, p) => {
      if (method !== 'Page.screencastFrame') return;
      const file = join(dir, `f${String(frames.length).padStart(5, '0')}.${ext}`);
      frames.push({ file, ts: p.metadata.timestamp, time: 0 });
      writes.push(writeFile(file, Buffer.from(p.data, 'base64')));
      s.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    });
    await s.send('Page.startScreencast', { format: opt.format, quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    const t0 = Date.now();
    while (!frames.length && Date.now() - t0 < 2000) await sleep(20);
    if (!frames.length) {
      // a still page may send nothing until it repaints: take the first frame by hand
      const shot = await s.send('Page.captureScreenshot', { format: opt.format, quality: 95 });
      const file = join(dir, `f00000.${ext}`);
      frames.push({ file, ts: Date.now() / 1000, time: 0 });
      writes.push(writeFile(file, Buffer.from(shot.data, 'base64')));
    }
    T0 = frames[0].ts;
    const skew = Math.abs(frames[0].ts - Date.now() / 1000);
    if (skew > 3) console.warn(`  ! the first frame is stamped ${skew.toFixed(1)} s from this machine's clock; cursor times may be off`);
    const now = () => Date.now() / 1000 - T0;

    // ---- the sidecar's records
    const cursor = [], clicks = [], keys = [], marks = [], boxes = [];
    let cur = { x: opt.width / 2, y: opt.height / 2 };
    let down = false;
    const boxOf = (sel, kind, b) => {
      const box = { x: px(b.x), y: px(b.y), width: px(b.width), height: px(b.height) };
      boxes.push({ t: round(now(), 3), kind, selector: sel, ...box });
      return box;
    };
    cursor.push({ t: 0, x: px(cur.x), y: px(cur.y) });
    const guard = () => { if (now() > opt.maxSeconds) throw new Error(`the workflow ran past --max-seconds ${opt.maxSeconds}`); };
    const pause = async (ms) => { guard(); await sleep(ms); guard(); };

    async function mouse(type, x, y, extra = {}) {
      const t = now();
      cur = { x, y };
      const last = cursor[cursor.length - 1];
      const nx = px(x), ny = px(y);
      if (type !== 'mouseMoved' || last.x !== nx || last.y !== ny || (down && !last.down)) cursor.push({ t: round(t, 3), x: nx, y: ny, ...(down ? { down: true } : {}) });
      await s.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
    }
    /**
     * Move in an eased arc to (x, y): a few hundred ms, every step a real mouse move.
     * @param {number} x @param {number} y @param {{ ms?: number }} [o]
     */
    async function move(x, y, { ms } = {}) {
      const from = cur;
      const dx = x - from.x, dy = y - from.y, dist = Math.hypot(dx, dy);
      if (dist < 1) return;
      const dur = ms ?? travelMs(dist * scale);
      const arc = Math.min(30, dist * 0.05) * (dx >= 0 ? 1 : -1); // a slight bow, as a hand makes
      const nx = -dy / dist, ny = dx / dist;
      const start = Date.now();
      for (;;) {
        guard();
        const p = Math.min(1, (Date.now() - start) / dur);
        const e = easeInOut(p), bow = Math.sin(Math.PI * e) * arc;
        await mouse('mouseMoved', p >= 1 ? x : from.x + dx * e + nx * bow, p >= 1 ? y : from.y + dy * e + ny * bow);
        if (p >= 1) break;
        await sleep(10);
      }
    }
    const measure = (sel) => s.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; })()`);
    // its middle is on screen: a tall element (a stage) that is partly cut off needs no scrolling
    const inView = (b) => b && b.cx >= 0 && b.cx <= opt.width && b.cy >= 4 && b.cy <= opt.height - 4;
    /** The element's box, waiting for it to exist and, if `scroll` and it is out of view, scrolling it there smoothly. */
    async function reveal(sel, ms = 15000, scroll = true) {
      const end = Date.now() + ms;
      let b;
      for (;;) {
        guard();
        b = await measure(sel);
        if (b && b.width > 0 && b.height > 0) break;
        if (Date.now() > end) throw new Error(`timed out waiting for ${sel}`);
        await sleep(100);
      }
      if (scroll && !inView(b)) {
        await s.evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })`);
        let prev = null;
        for (let i = 0; i < 60; i++) {
          await sleep(100);
          b = await measure(sel);
          if (prev && Math.abs(prev.y - b.y) < 0.5 && Math.abs(prev.x - b.x) < 0.5) break;
          prev = b;
        }
      }
      return b;
    }
    /** A point from a selector (its middle, its box noted) or as given. @param {string | { x: number, y: number }} t @param {string} kind @returns {Promise<{ x: number, y: number }>} */
    async function point(t, kind) {
      if (typeof t !== 'string') return t;
      const b = await reveal(t);
      boxOf(t, kind, b);
      return { x: b.cx, y: b.cy };
    }

    /** @param {string} k @param {{ modifiers?: string[], text?: string }} [o] */
    async function key(k, { modifiers = [], text } = {}) {
      // letters and digits have their virtual key code; punctuation has none here (46 would be Delete) and is sent as text
      const code = KEYS[k] ?? (/^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0);
      const m = modifiers.reduce((a, n) => a | MOD[n], 0);
      const printable = k.length === 1 && !m;
      const base = { key: k, code: k.length === 1 ? (/[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : /\d/.test(k) ? `Digit${k}` : k === ' ' ? 'Space' : '') : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: m };
      const commands = modifiers.includes('ctrl') && k.toLowerCase() === 'a' ? ['selectAll'] : undefined;
      keys.push({ t: round(now(), 3), key: k, ...(modifiers.length ? { modifiers } : {}) });
      await s.send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', ...base, ...(printable ? { text: text ?? k, unmodifiedText: text ?? k } : {}), ...(commands ? { commands } : {}) });
      await sleep(printable ? 18 : 40);
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    }
    let seed = 7; // a fixed rhythm: the same text is typed with the same gaps every time
    const jitter = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };

    const r = {
      size: { width: opt.width, height: opt.height }, scale, base, fps: opt.fps,
      at: now,
      evaluate: (js) => s.evaluate(js),
      pause,
      mark(label) { marks.push({ t: round(now(), 3), label }); console.log(`  · ${round(now(), 1)} s ${label}`); },
      async navigate(path, ready) {
        await s.send('Page.navigate', { url: new URL(path, base).href });
        await pause(500);
        if (ready) await r.waitFor(ready);
      },
      async waitFor(sel, { timeout = 15000 } = {}) {
        const b = await reveal(sel, timeout, false); // waiting never scrolls the page
        boxOf(sel, 'wait', b);
        return b;
      },
      async until(expression, what = expression, ms = 15000) {
        const end = Date.now() + ms;
        for (;;) {
          guard();
          if (await s.evaluate(expression).catch(() => null)) return;
          if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
          await sleep(100);
        }
      },
      move: async (x, y, o) => move(x, y, o),
      /** @param {string | { x: number, y: number }} t @param {{ dwell?: number, ms?: number }} [o] */
      async hover(t, { dwell = 450, ms } = {}) {
        const p = await point(t, 'hover');
        await move(p.x, p.y, { ms });
        await pause(dwell);
      },
      /** @param {string | { x: number, y: number }} t @param {{ settle?: number, ms?: number, at?: number[] }} [o] */
      async click(t, { settle = 300, ms, at = [0.5, 0.5] } = {}) {
        /** @type {{ x: number, y: number }} */
        let p;
        let box = null;
        if (typeof t === 'string') {
          const b = await reveal(t);
          box = boxOf(t, 'click', b);
          p = { x: b.x + b.width * at[0], y: b.y + b.height * at[1] };
        } else p = t;
        await move(p.x, p.y, { ms });
        await pause(120);
        down = true;
        await mouse('mousePressed', p.x, p.y);
        clicks.push({ t: round(now(), 3), x: px(p.x), y: px(p.y), selector: typeof t === 'string' ? t : null, ...(box ? { box } : {}) });
        await sleep(80);
        down = false;
        await mouse('mouseReleased', p.x, p.y);
        await pause(settle);
      },
      clickAt: (x, y, o) => r.click({ x, y }, o),
      async drag(from, to, { ms = 700 } = {}) {
        const a = await point(from, 'drag'), b = await point(to, 'drag');
        await move(a.x, a.y);
        await pause(100);
        down = true;
        await mouse('mousePressed', a.x, a.y);
        clicks.push({ t: round(now(), 3), x: px(a.x), y: px(a.y), selector: typeof from === 'string' ? from : null, drag: true });
        await sleep(60);
        await move(b.x, b.y, { ms });
        await sleep(60);
        down = false;
        await mouse('mouseReleased', b.x, b.y);
        await pause(250);
      },
      async slider(sel, value, o = {}) {
        const info = await s.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el && { min: Number(el.min || 0), max: Number(el.max || 100), value: Number(el.value) }; })()`);
        if (!info) throw new Error(`no element ${sel}`);
        const b = await reveal(sel);
        boxOf(sel, 'slider', b);
        const thumb = 8; // half the default thumb width
        const xAt = (v) => b.x + thumb + ((v - info.min) / (info.max - info.min)) * (b.width - 2 * thumb);
        await r.drag({ x: xAt(info.value), y: b.cy }, { x: xAt(value), y: b.cy }, o);
      },
      async type(text, { delay = 75 } = {}) {
        for (const ch of text) {
          guard();
          await key(ch);
          await sleep(Math.round(delay * (0.55 + jitter() * 0.9)));
        }
        await pause(150);
      },
      async press(k, { modifiers = [], settle = 250 } = {}) { await key(k, { modifiers }); await pause(settle); },
      async fill(sel, text, o = {}) {
        await r.click(sel, { settle: 150 });
        await key('a', { modifiers: ['ctrl'] });
        await sleep(120);
        await r.type(text, o);
      },
      async scroll(dy, { at = [opt.width / 2, opt.height / 2], ms = 600 } = {}) {
        await move(at[0], at[1]);
        const start = Date.now();
        let sent = 0;
        for (;;) {
          guard();
          const p = Math.min(1, (Date.now() - start) / ms);
          const want = Math.round(dy * easeInOut(p));
          if (want !== sent) { await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cur.x, y: cur.y, deltaX: 0, deltaY: want - sent }); sent = want; }
          if (p >= 1) break;
          await sleep(14);
        }
        await pause(300);
      },
    };

    // ---- run
    console.log(`recording ${opt.workflow} on ${target.href} at ${opt.width}x${opt.height}@${scale} → ${W}x${H}, ${opt.fps} fps`);
    await Promise.race([
      mod.default(r),
      sleep((opt.maxSeconds + 5) * 1000).then(() => { throw new Error(`the workflow ran past --max-seconds ${opt.maxSeconds}`); }),
    ]);
    await sleep(opt.tail * 1000);
    const endT = now();
    await s.send('Page.stopScreencast').catch(() => {});
    stop();
    await Promise.all(writes);

    // ---- encode
    for (const f of frames) f.time = Math.max(0, f.ts - T0);
    const duration = Math.max(endT, frames[frames.length - 1].time + 1 / opt.fps);
    mkdirSync(dirname(opt.out), { recursive: true });
    const enc = await encode(frames, { out: opt.out, fps: opt.fps, duration, width: W, height: H, format: opt.format === 'png' ? 'png' : 'jpeg', crf: opt.crf });
    const sidecar = {
      workflow: opt.workflow, url: target.href,
      viewport: { width: opt.width, height: opt.height, scale }, video: { width: W, height: H, fps: opt.fps, duration: round(enc.frames / opt.fps, 3), frames: enc.frames, capturedFrames: enc.captured },
      cursor, clicks, keys, marks, boxes, problems: s.problems,
    };
    writeFileSync(`${opt.out}.json`, `${JSON.stringify(sidecar, null, 1)}\n`);
    console.log(`  ${opt.out}: ${enc.frames} frames (${enc.captured} captured), ${sidecar.video.duration} s, ${clicks.length} clicks, ${keys.length} keys, ${marks.length} marks`);
    for (const p of s.problems) console.warn(`  ! page: ${p}`);
  } catch (e) {
    failure = e;
    await s.shot(`${opt.out}.failed.png`).catch(() => {});
  } finally {
    await s.close();
    if (!opt.keepFrames) rmSync(dir, { recursive: true, force: true });
    else console.log(`  frames kept in ${dir}`);
  }
  if (failure) { console.error(`record-studio: ${failure.message}`); process.exit(1); }
}

main().catch((e) => { console.error(`record-studio: ${e.message}`); process.exit(1); });
