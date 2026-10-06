// Preview/render parity for everything iteration 2 draws: transforms and keyframes, motions,
// transitions, effects, masks, a precomp and an image layer. The same frames are drawn by the
// studio's preview worker in headless Chrome and by the Node renderer; they must match within a
// small threshold (text and edges are antialiased a little differently by the two canvases).
// Skipped when Chrome is not installed. scripts/parity.mjs writes the same comparison as evidence.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempStudio, AUTHOR } from './helpers.js';
import { createStudioServer } from '../src/server/http.js';
import { chromePath, openBrowser, previewFrames, renderFrame, compare } from '../scripts/lib/parity.mjs';
import { CASES, LIMIT, seedParity } from '../scripts/lib/parity-cases.mjs';

const skip = chromePath() ? false : 'Chrome is not installed';
let t, server, base, browser;
before(async () => {
  if (skip) return;
  t = tempStudio();
  await seedParity(t.studio, AUTHOR);
  server = /** @type {any} */ (createStudioServer(t.studio, { env: { PATH: '' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await openBrowser(`${base}/`);
});
after(async () => {
  if (skip) return;
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

for (const [name, [composition, frames]] of Object.entries(CASES)) {
  test(`parity: ${name} draws the same in the browser preview and in Node`, { skip }, async () => {
    const preview = await previewFrames(browser, composition, frames);
    for (const [i, frame] of frames.entries()) {
      const node = await renderFrame(base, composition, frame);
      const m = compare(preview[i], node);
      assert.ok(m.meanDiff <= LIMIT.meanDiff && m.over64 <= LIMIT.over64, `${name} frame ${frame}: ${JSON.stringify(m)}`);
      assert.ok(m.distinct > 8, `${name} frame ${frame} has something on it (${m.distinct} distinct colours)`);
    }
    assert.deepEqual(browser.problems, []);
  });
}
