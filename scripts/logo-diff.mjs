// Pixel diff of an SVG logo: the original drawn by headless Chrome (an <img> at a fixed size on a fixed
// background) against the studio's vector model drawn by f.svg in Node at the same size and background.
//
//   node scripts/logo-diff.mjs <svg>... [size] [--out dir] [--json file]
//
// Prints, per file, the mean absolute difference per channel and the share of pixels within 8 and 32 levels,
// for the model (the pass criterion: mean <= 2 levels and >= 99 % within 32) and, for information, for the raster
// the studio stores (the sanitised SVG drawn by Skia). Writes <name>-chrome.png, <name>-model.png and
// <name>-diff.png (the difference, x4) to --out (default docs/showcase/v4/studio, as logo-<name>-*.png), and the
// numbers to --json. Needs Chrome (CHROME=/path/to/chrome). Exits 1 when a file fails.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '../src/render/host.js';
import { sanitizeSvg, vectorModel } from '../src/studio/svg.js';
import { draw } from '../src/core/lib/svg.js';
import { chromePath } from './lib/parity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKGROUND = '#d9d9d9';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const [, v] = args.splice(i, 2); return v; };
const outDir = resolve(flag('--out') ?? join(ROOT, 'docs', 'showcase', 'v4', 'studio'));
const jsonFile = flag('--json');
const size = Number(args.find((a) => /^\d+$/.test(a)) ?? 512);
const files = args.filter((a) => !/^\d+$/.test(a));
if (!files.length) { console.error('usage: node scripts/logo-diff.mjs <svg>... [size] [--out dir] [--json file]'); process.exit(2); }
const bin = chromePath();
if (!bin) { console.error('Chrome not found; set CHROME=/path/to/chrome'); process.exit(2); }

/** The SVG as Chrome draws it: an <img> in a size x size page, contain-fitted on the background. */
async function chromePixels(file, work) {
  const page = join(work, 'page.html');
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${BACKGROUND}"><img src="${pathToFileURL(resolve(file)).href}" style="display:block;width:${size}px;height:${size}px;object-fit:contain"></body>`);
  const shot = join(work, 'chrome.png');
  execFileSync(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size},${size}`, `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=3000', `--screenshot=${shot}`, pathToFileURL(page).href], { stdio: 'ignore', timeout: 60_000 });
  return pixels(await loadImage(readFileSync(shot)));
}
function pixels(img) {
  const c = createCanvas(size, size), g = c.getContext('2d');
  g.fillStyle = BACKGROUND; g.fillRect(0, 0, size, size);
  g.drawImage(img, 0, 0);   // a screenshot a few pixels off is cropped, not scaled
  return g.getImageData(0, 0, size, size).data;
}
const png = (data) => {
  const c = createCanvas(size, size), g = c.getContext('2d'), im = g.createImageData(size, size);
  im.data.set(data);
  g.putImageData(im, 0, 0);
  return c.toBuffer('image/png');
};

/** Mean absolute difference per channel and the share of pixels whose largest channel difference is within 8 / 32 levels. */
function compare(a, b) {
  const sum = [0, 0, 0];
  let within8 = 0, within32 = 0;
  const diff = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    let worst = 0;
    for (let ch = 0; ch < 3; ch++) { const d = Math.abs(a[i + ch] - b[i + ch]); sum[ch] += d; worst = Math.max(worst, d); diff[i + ch] = Math.min(255, d * 4); }
    diff[i + 3] = 255;
    if (worst <= 8) within8++;
    if (worst <= 32) within32++;
  }
  const n = a.length / 4, r = (v) => Math.round(v * 1e4) / 1e4;
  const mean = sum.map((s) => r(s / n));
  return { mean, meanAll: r((mean[0] + mean[1] + mean[2]) / 3), within8: r(within8 / n), within32: r(within32 / n), diff };
}
const passes = (m) => Math.max(...m.mean) <= 2 && m.within32 >= 0.99;

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'logo-diff-'));
const results = [];
try {
  for (const file of files) {
    const name = basename(file).replace(/\.svg$/i, '');
    const text = readFileSync(file, 'utf8');
    const clean = sanitizeSvg(text, { styles: true });
    const model = vectorModel(clean.tree, { gradients: true, report: clean.report });
    const chrome = await chromePixels(file, work);
    // the model: f.svg at the same size on the same background
    const c = createCanvas(size, size), g = c.getContext('2d');
    g.fillStyle = BACKGROUND; g.fillRect(0, 0, size, size);
    draw(g, model, { x: 0, y: 0, width: size, height: size });
    const mine = g.getImageData(0, 0, size, size).data;
    // the raster the studio keeps: the sanitised document drawn by the rasteriser, contain-fitted
    const img = await loadImage(Buffer.from(clean.svg));
    const r = createCanvas(size, size), rg = r.getContext('2d');
    rg.fillStyle = BACKGROUND; rg.fillRect(0, 0, size, size);
    const k = Math.min(size / img.width, size / img.height);
    rg.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
    const raster = rg.getImageData(0, 0, size, size).data;
    const m = compare(chrome, mine), rm = compare(chrome, raster);
    const prefix = join(outDir, `logo-${name}`);
    writeFileSync(`${prefix}-chrome.png`, png(chrome));
    writeFileSync(`${prefix}-model.png`, png(mine));
    writeFileSync(`${prefix}-diff.png`, png(m.diff));
    const result = {
      file: basename(file), size, background: BACKGROUND, pass: passes(m),
      model: { mean: m.mean, within8: m.within8, within32: m.within32 },
      raster: { mean: rm.mean, within8: rm.within8, within32: rm.within32 },
      svg: clean.report,
    };
    results.push(result);
    console.log(`${result.pass ? 'pass' : 'FAIL'} ${basename(file)} @${size}: model mean abs diff R/G/B ${m.mean.join(' / ')}, within 8 ${(m.within8 * 100).toFixed(2)} %, within 32 ${(m.within32 * 100).toFixed(2)} %; raster mean ${rm.mean.join(' / ')}, within 32 ${(rm.within32 * 100).toFixed(2)} %`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (jsonFile) { mkdirSync(dirname(resolve(jsonFile)), { recursive: true }); writeFileSync(resolve(jsonFile), `${JSON.stringify({ criterion: 'mean abs diff <= 2 levels per channel and >= 99 % of pixels within 32 levels', size, results }, null, 2)}\n`); }
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
