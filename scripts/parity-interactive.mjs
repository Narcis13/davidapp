// Parity of an interactive clip's share page: the states of a scripted playthrough drawn by the page's own player
// (headless Chrome, the exported folder or /share/<clip>) and by the studio's Node renderer (studio.play), frame by
// frame, with the limits of scripts/parity.mjs. Both replay the same input log through core/interactive.js, so they
// draw the same views; what is compared is how the browser and Skia draw them.
//
//   STUDIO_DATA=<dir> node scripts/parity-interactive.mjs <clip> <page url> <out dir> [--steps steps.json] [--times 1.9,2.5,…]
//
// Without --steps it plays clip 12's script: the title, the how-to dialog, the iris into the song, a few keys, results.
// Headless Chrome: set TMPDIR and CHROME only (not TEMP/TMP).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { openSession } from './lib/browser.mjs';
import { compare, decode, diffImage } from './lib/parity.mjs';
import { LIMIT } from './lib/parity-cases.mjs';

const argv = process.argv.slice(2);
const [clip, url, out] = argv;
if (!clip || !url || !out) { console.error('usage: STUDIO_DATA=<dir> node scripts/parity-interactive.mjs <clip> <page url> <out dir> [--steps file] [--times a,b,…]'); process.exit(2); }
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const steps = opt('--steps') ? JSON.parse(readFileSync(opt('--steps'), 'utf8')) : [
  { wait: 2 }, { tap: 'how' }, { wait: 0.6 }, { tap: { item: 'help', region: 'confirm' } }, { wait: 0.5 }, { tap: 'play' },
  { wait: 2.2 }, { key: 'd' }, { wait: 0.45 }, { key: 'f' }, { wait: 0.5 }, { key: 'k' }, { wait: 28 },
];
const times = (opt('--times') ?? '1.9,2.5,3.4,3.6,6.5,7.5,8.3,34.5,38').split(',').map(Number);
mkdirSync(out, { recursive: true });

const studio = createStudio({ dataDir: process.env.STUDIO_DATA, role: 'parity' });
const report = { method: 'A scripted playthrough of an interactive clip: each state drawn by the share page in headless Chrome (OffscreenCanvas in its worker) and by the Node renderer (Skia, studio.play); per-channel absolute differences.', clip, url, limit: LIMIT, frames: [] };
let failed = false;
try {
  const comp = (await studio.compositionOf({ clip }));
  const size = Math.max(comp.width, comp.height);
  const node = await studio.play({ clip, steps, times, stills: true, maxSize: size });
  const s = await openSession({ width: 1440, height: 900 });
  try {
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await s.goto(url, 'document.querySelector("[data-share]")?.dataset.state === "ready"');
    // the page replays the same log through the same fold, drawing with its own engine, and hands back each frame as PNG
    const shots = await s.evaluate(`(async () => {
      const f = window.fablecut, I = await import(new URL('core/interactive.js', document.baseURI).href);
      const copy = document.createElement('canvas'), g = copy.getContext('2d');
      const cv = document.querySelector('[data-testid=canvas]');
      const out = {};
      const draw = async (view) => (await f.engine.drawFrame(view.frame, { ui: view.ui, transition: view.transition ?? undefined })).regions ?? [];
      await I.replay(f.composition, ${JSON.stringify(node.log)}, { frames: ${JSON.stringify(node.frames.map((x) => x.frame))}, draw, onFrame: async (n, view) => {
        await draw(view);
        copy.width = cv.width; copy.height = cv.height;
        g.drawImage(cv, 0, 0);
        out[n] = copy.toDataURL('image/png').slice(22);
      } });
      return out;
    })()`);
    for (const x of node.frames) {
      const a = await decode(Buffer.from(shots[x.frame], 'base64'));
      const b = await decode(x.png);
      const m = compare(a, b);
      const ok = m.meanDiff <= LIMIT.meanDiff && m.over64 <= LIMIT.over64 && m.distinct > 8;
      if (!ok) failed = true;
      const file = `parity-${clip}-f${x.frame}.png`;
      writeFileSync(join(out, file), diffImage(a, b));
      report.frames.push({ frame: x.frame, t: x.t, scene: x.state.scene, ...m, ok, image: file });
      console.log(`${ok ? '✓' : '✖'} frame ${String(x.frame).padStart(4)} ${x.state.scene.padEnd(8)} mean ${m.meanDiff}  max ${m.maxDiff}  >16 ${m.over16}%  >64 ${m.over64}%  colours ${m.distinct}`);
    }
    report.problems = s.problems;
  } finally {
    await s.close();
  }
} finally {
  await studio.close();
}
writeFileSync(join(out, `parity-${clip}.json`), `${JSON.stringify(report, null, 1)}\n`);
process.exit(failed || report.problems?.length ? 1 : 0);
