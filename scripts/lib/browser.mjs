// A headless Chrome session driven over CDP with real input: mouse presses, moves and releases,
// keys, typed text and files dragged in from outside (all trusted events, as a person's would be),
// screenshots, and the frames of a workflow written as a GIF. Console errors and warnings, uncaught
// exceptions, failed requests and HTTP statuses >= 400 are collected in `problems`.
// Used by scripts/workflows-v2.mjs.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath } from './parity.mjs';
import { ffmpegPath, run } from '../../src/render/ffmpeg.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEYS = { Enter: 13, Escape: 27, Tab: 9, Delete: 46, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 };
const mods = (list = []) => list.reduce((m, k) => m | MOD[k], 0);

/**
 * @param {{ width?: number, height?: number, mobile?: boolean, expected?: (problem: string) => boolean }} [o]
 *   expected: problems the workflow causes on purpose (a refused request shown in the UI)
 */
export async function openSession({ width = 1440, height = 900, mobile = false, expected = () => false } = {}) {
  const bin = chromePath();
  if (!bin) throw new Error('Chrome not found; set CHROME=/path/to/chrome');
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'workflow-chrome-'));
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${width},${height}`, `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 200 && !target; i++) {
    await sleep(150);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) { chrome.kill('SIGKILL'); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const waiting = new Map();
  const problems = [];
  const urls = new Map();
  const report = (p) => { if (!expected(p)) problems.push(p); };
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    const p = msg.params;
    if (msg.method === 'Runtime.exceptionThrown') report(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(p.type)) report(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level)) report(`log.${p.entry.level}: ${p.entry.text} ${p.entry.url ?? ''}`);
    if (msg.method === 'Network.requestWillBeSent') urls.set(p.requestId, p.request.url);
    if (msg.method === 'Network.responseReceived' && p.response.status >= 400) report(`HTTP ${p.response.status} ${p.response.url}`);
    // a page that navigates away drops its event stream and whatever was loading: not a failure
    if (msg.method === 'Network.loadingFailed' && !p.canceled && p.errorText !== 'net::ERR_ABORTED') report(`failed: ${p.errorText} ${urls.get(p.requestId) ?? ''}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  for (const d of ['Runtime', 'Page', 'Network', 'Log']) await send(`${d}.enable`);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const frames = [];
  let caption = '';

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  }
  /** Wait until the expression is truthy; returns its value, or throws with `what`. */
  async function waitFor(expression, what = expression, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expression).catch(() => null);
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(120);
    }
  }
  /**
   * The centre and box of an element in viewport pixels, scrolled into view first. Scrolling moves
   * everything measured before it: for a drag between two elements, measure both again with
   * `{ scroll: false }` once they are in view.
   */
  async function rect(selector, { scroll = true } = {}) {
    const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; if (${scroll}) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; })()`);
    if (!r) throw new Error(`no element ${selector}`);
    return r;
  }
  // the page has no visible cursor in headless Chrome: draw one, and the step's caption, for the GIF frames
  const overlay = (x, y, down) => evaluate(`(() => {
    let c = document.getElementById('__cursor'); if (!c) { c = document.createElement('div'); c.id = '__cursor'; c.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #000;pointer-events:none'; document.documentElement.append(c); }
    c.style.left = '${x}px'; c.style.top = '${y}px'; c.style.background = '${down ? 'rgba(255,90,60,.9)' : 'rgba(255,255,255,.25)'}';
    let l = document.getElementById('__caption'); if (!l) { l = document.createElement('div'); l.id = '__caption'; l.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;max-width:70vw;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.82);color:#fff;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none'; document.documentElement.append(l); }
    l.textContent = ${JSON.stringify(caption)}; l.style.display = ${JSON.stringify(caption)} ? '' : 'none';
  })()`);
  const clearOverlay = () => evaluate(`document.getElementById('__cursor')?.remove(); document.getElementById('__caption')?.remove()`);
  let at = { x: 0, y: 0 };

  async function mouse(type, x, y, { down = false, modifiers = [], clickCount = 1 } = {}) {
    at = { x, y };
    await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: down || type === 'mousePressed' ? 1 : 0, clickCount, modifiers: mods(modifiers) });
  }
  /** A frame of the workflow (kept for the GIF), with the cursor and caption drawn in. */
  async function frame(pressed = false) {
    await overlay(at.x, at.y, pressed);
    frames.push(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await clearOverlay();
  }

  return {
    problems,
    evaluate, waitFor, rect, sleep,
    async goto(url, ready) {
      await send('Page.navigate', { url });
      await sleep(600);
      if (ready) await waitFor(ready, `${url} to show ${ready}`);
      await sleep(500);
    },
    /** Say what the next frames show. */
    step(text) { caption = text; console.log(`  · ${text}`); },
    frame,
    /** A clean screenshot (no cursor, no caption) written to a file. */
    async shot(file, { full = false } = {}) {
      let clip;
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        clip = { x: 0, y: 0, width: m.cssContentSize.width, height: m.cssContentSize.height, scale: 1 };
      }
      writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: full })).data, 'base64'));
    },
    async click(target, { modifiers = [], settle = 350 } = {}) {
      const p = typeof target === 'string' ? await rect(target) : { cx: target.x, cy: target.y };
      await mouse('mouseMoved', p.cx, p.cy);
      await mouse('mousePressed', p.cx, p.cy, { modifiers });
      await mouse('mouseReleased', p.cx, p.cy, { modifiers });
      await sleep(settle);
      await frame();
    },
    /**
     * Press at `from`, move to `to` in steps, release. `during` runs with the button still down.
     * @param {{ x: number, y: number }} from @param {{ x: number, y: number }} to
     * @param {{ steps?: number, modifiers?: string[], during?: () => Promise<any> }} [o]
     */
    async drag(from, to, { steps = 12, modifiers = [], during } = {}) {
      await mouse('mouseMoved', from.x, from.y);
      await frame();
      await mouse('mousePressed', from.x, from.y, { modifiers });
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await mouse('mouseMoved', from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, { down: true, modifiers });
        await sleep(40);
        if (i === Math.ceil(steps / 2) || i === steps) { await sleep(120); await frame(true); }
      }
      const seen = during ? await during() : undefined;
      await mouse('mouseReleased', to.x, to.y, { modifiers });
      await sleep(450);
      await frame();
      return seen;
    },
    async key(key, { modifiers = [] } = {}) {
      const code = KEYS[key] ?? key.toUpperCase().charCodeAt(0);
      const base = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: mods(modifiers) };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(350);
    },
    /** Type into the focused field. */
    async type(text) { await send('Input.insertText', { text }); await sleep(150); },
    /** Files dragged from outside the browser and dropped at a point. */
    async dropFiles(point, files) {
      const data = { items: [], files, dragOperationsMask: 1 };
      at = point;
      await send('Input.dispatchDragEvent', { type: 'dragEnter', x: point.x, y: point.y, data });
      await send('Input.dispatchDragEvent', { type: 'dragOver', x: point.x, y: point.y, data });
      await sleep(250);
      await frame(true);
      await send('Input.dispatchDragEvent', { type: 'drop', x: point.x, y: point.y, data });
      await sleep(400);
    },
    /** Write the frames collected so far as a GIF (about one frame a second) and start again. */
    async gif(file, { width: w = 1080, seconds = 1.1 } = {}) {
      const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'workflow-frames-'));
      frames.forEach((f, i) => writeFileSync(join(tmp, `f${String(i).padStart(3, '0')}.png`), f));
      mkdirSync(join(file, '..'), { recursive: true });
      const r = await run(ffmpegPath(), ['-y', '-v', 'error', '-framerate', String(1 / seconds), '-i', join(tmp, 'f%03d.png'), '-vf', `scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', file]);
      rmSync(tmp, { recursive: true, force: true });
      if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
      const n = frames.length;
      frames.length = 0;
      caption = '';
      return n;
    },
    async close() {
      try { ws.close(); } catch { /* already closed */ }
      chrome.kill('SIGKILL');
      await sleep(200);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Chrome may still hold it */ }
    },
  };
}
