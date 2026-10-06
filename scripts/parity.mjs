// Evidence for preview/render parity: every case in scripts/lib/parity-cases.mjs drawn by the
// browser preview (headless Chrome) and by Node, with the numbers and a diff image per frame.
//
//   node scripts/parity.mjs [out-dir]     default: output/parity

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudio } from '../src/studio/studio.js';
import { createStudioServer } from '../src/server/http.js';
import { openBrowser, previewFrames, renderFrame, compare, diffImage } from './lib/parity.mjs';
import { CASES, LIMIT, seedParity } from './lib/parity-cases.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'output', 'parity');
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'parity-'));
const studio = createStudio({ dataDir, role: 'parity' });
await seedParity(studio);
const server = /** @type {any} */ (createStudioServer(studio, { env: { PATH: '' } }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await openBrowser(`${base}/`);
const report = { method: 'The same composition frame drawn by the studio preview worker in headless Chrome (OffscreenCanvas) and by the Node renderer (Skia, /api/frame/clip); per-channel absolute differences.', limit: LIMIT, cases: {} };
let failed = false;
try {
  for (const [name, [composition, frames]] of Object.entries(CASES)) {
    const preview = await previewFrames(browser, composition, frames);
    report.cases[name] = [];
    for (const [i, frame] of frames.entries()) {
      const node = await renderFrame(base, composition, frame);
      const m = compare(preview[i], node);
      const ok = m.meanDiff <= LIMIT.meanDiff && m.over64 <= LIMIT.over64 && m.distinct > 8;
      if (!ok) failed = true;
      const file = `parity-${name}-f${frame}.png`;
      writeFileSync(join(out, file), diffImage(preview[i], node));
      report.cases[name].push({ frame, ...m, ok, image: file });
      console.log(`${ok ? '✓' : '✖'} ${name.padEnd(10)} frame ${String(frame).padStart(2)}  mean ${m.meanDiff}  max ${m.maxDiff}  >16 ${m.over16}%  >64 ${m.over64}%  colours ${m.distinct}`);
    }
  }
  report.consoleProblems = browser.problems;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await studio.close();
  rmSync(dataDir, { recursive: true, force: true });
}
writeFileSync(join(out, 'parity.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log(`report: ${join(out, 'parity.json')}`);
process.exit(failed || report.consoleProblems.length ? 1 : 0);
