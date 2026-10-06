// Preview/render parity: draw the same composition frame in the studio's preview worker (headless
// Chrome, the browser's canvas) and in the Node renderer (Skia), and measure how far apart the
// pixels are. Used by test/parity.test.js and scripts/parity.mjs.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../../src/render/host.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const chromePath = () => process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync) ?? null;

/** Start headless Chrome on a page; returns { evaluate(expression), problems, close() }. */
export async function openBrowser(url) {
  const bin = chromePath();
  if (!bin) throw new Error('Chrome not found; set CHROME=/path/to/chrome');
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'parity-chrome-'));
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
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
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) problems.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(1500);
  return {
    problems,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    async close() {
      try { ws.close(); } catch { /* already closed */ }
      chrome.kill('SIGKILL');
      await sleep(200);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Chrome may still hold it */ }
    },
  };
}

// Runs in the page: the preview worker draws the frames, exactly as the studio's preview does.
const PAGE_SCRIPT = `async (composition, frames) => {
  const status = await fetch('/api/status').then((r) => r.json());
  const res = await fetch('/api/clips/parity/bundle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ composition }) });
  if (!res.ok) throw new Error((await res.json()).error);
  const b = await res.json();
  const w = new Worker('/ui/preview-worker.js', { type: 'module' });
  let n = 0;
  const call = (msg) => new Promise((resolve, reject) => {
    const id = ++n;
    const on = (e) => { if (e.data.id !== id) return; w.removeEventListener('message', on); if (e.data.ok) resolve(e.data); else reject(new Error(e.data.error)); };
    w.addEventListener('message', on);
    w.postMessage({ ...msg, id });
  });
  try {
    await call({ op: 'fonts', fonts: status.fonts });
    await call({ op: 'load', bundle: b.bundle, composition: b.composition });
    const out = [];
    for (const frame of frames) {
      const r = await call({ op: 'clipFrame', frame });
      const c = new OffscreenCanvas(r.bitmap.width, r.bitmap.height);
      const g = c.getContext('2d');
      g.drawImage(r.bitmap, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = '';
      for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      out.push({ width: c.width, height: c.height, rgba: btoa(s) });
    }
    return out;
  } finally {
    w.terminate();
  }
}`;

/** Frames of a composition drawn by the browser preview → [{ width, height, data: Uint8Array RGBA }]. */
export async function previewFrames(browser, composition, frames) {
  const out = await browser.evaluate(`(${PAGE_SCRIPT})(${JSON.stringify(composition)}, ${JSON.stringify(frames)})`);
  return out.map((f) => ({ width: f.width, height: f.height, data: new Uint8Array(Buffer.from(f.rgba, 'base64')) }));
}

/** A frame drawn by the Node renderer through the studio's HTTP API → { width, height, data }. */
export async function renderFrame(base, composition, frame) {
  const res = await fetch(`${base}/api/frame/clip`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ composition, t: frame / (composition.fps ?? 30) }) });
  if (!res.ok) throw new Error(`render: ${res.status} ${await res.text()}`);
  return decode(Buffer.from(await res.arrayBuffer()));
}

export async function decode(png) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, data: new Uint8Array(g.getImageData(0, 0, img.width, img.height).data) };
}

/**
 * How far apart two frames are: mean absolute difference per channel (0–255), the largest one, the
 * share of pixels (%) where some channel differs by more than 16 and by more than 64, and how many
 * distinct colours the render has (a blank frame would match anything).
 */
export function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`sizes differ: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  let sum = 0, max = 0, over16 = 0, over64 = 0;
  const n = a.width * a.height;
  const colours = new Set();
  for (let i = 0; i < a.data.length; i += 4) {
    if (colours.size < 1000 && (i & 63) === 0) colours.add((b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2]);
    let px = 0;
    for (let k = 0; k < 3; k++) { const d = Math.abs(a.data[i + k] - b.data[i + k]); sum += d; if (d > px) px = d; }
    if (px > max) max = px;
    if (px > 16) over16++;
    if (px > 64) over64++;
  }
  return { meanDiff: Math.round((sum / (n * 3)) * 1000) / 1000, maxDiff: max, over16: Math.round((over16 / n) * 1e5) / 1e3, over64: Math.round((over64 / n) * 1e5) / 1e3, distinct: colours.size };
}

/** The preview, the render and their difference (×4, so small differences show) side by side, as PNG. */
export function diffImage(a, b) {
  const w = a.width, h = a.height, gap = 8;
  const c = createCanvas(w * 3 + gap * 2, h);
  const g = c.getContext('2d');
  g.fillStyle = '#16161d';
  g.fillRect(0, 0, c.width, c.height);
  const put = (data, x) => { const img = g.createImageData(w, h); img.data.set(data); g.putImageData(img, x, 0); };
  put(a.data, 0);
  put(b.data, w + gap);
  const d = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < d.length; i += 4) { for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.abs(a.data[i + k] - b.data[i + k]) * 4); d[i + 3] = 255; }
  put(d, (w + gap) * 2);
  return c.toBuffer('image/png');
}
