// What footage costs: disk (the file, its stills, and that no frame cache is written to disk) and render time
// (a clip with a footage layer against the same clip with a still of it in its place), on a throwaway data dir.
//
//   node scripts/footage-cost.mjs <video.mp4> [out.md] [--runs 3] [--seconds 10]
//
// The footage layer plays the file at 1:1 in a 1920×1080 clip at 30 fps (a screen recording in a browser frame is the
// usual case), the still clip draws the file's first frame as an image the same size. Both render at the default
// worker count. The decoded-frame cache is memory only and bounded (STUDIO_FOOTAGE_CACHE_MB, default 512).

import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { footageService } from '../src/render/footage.js';

const argv = process.argv.slice(2);
const file = argv[0];
if (!file) { console.error('usage: node scripts/footage-cost.mjs <video.mp4> [out.md] [--runs 3] [--seconds 10]'); process.exit(2); }
const out = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const opt = (k, d) => (argv.includes(k) ? Number(argv[argv.indexOf(k) + 1]) : d);
const runs = opt('--runs', 3), seconds = opt('--seconds', 10);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const du = (dir) => { let n = 0; for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? du(join(dir, e.name)) : statSync(join(dir, e.name)).size; return n; };

const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'footage-cost-'));
const studio = createStudio({ dataDir, role: 'cost', runner: true });
const lines = [];
try {
  const before = du(dataDir);
  const t0 = performance.now();
  const { asset } = await studio.library.addFootage({ slug: 'cost-footage', path: file, description: `${basename(file)}, for measuring what footage costs.`, author: 'footage-cost' });
  const importSeconds = (performance.now() - t0) / 1000;
  const m = asset.meta;
  const files = (rel) => (rel ? statSync(join(dataDir, rel)).size : 0);
  const stills = files(asset.thumb) + files(m.strip?.file) + files(m.wave?.file);
  // a still of the first frame, the same size, for the comparison clip
  const first = await footageService().frame({ ...studio.library.footageMeta(studio.library.requireVersion(asset.ref)), path: studio.library.absFile(studio.library.requireVersion(asset.ref)) }, 0);
  const png = studio.library.canvasOf(first, m.width, m.height).toBuffer('image/png');
  await studio.library.addFileAsset({ slug: 'cost-still', type: 'image', data: png, ext: '.png', description: 'The first frame of the footage as a still.', author: 'footage-cost' });
  const box = { x: 0.5, y: 0.5, width: m.width / 1920, height: m.height / 1080 };
  const comp = (asset2, params) => ({ width: 1920, height: 1080, fps: 30, duration: Math.min(seconds, m.duration), background: '#101018', tracks: [{ id: 'v', type: 'visual', items: [{ id: 'a', asset: asset2, start: 0, duration: Math.min(seconds, m.duration), params, transform: box }] }] });
  /** @type {[string, any][]} */
  const both = [['with-footage', comp('cost-footage', { fit: 'fill' })], ['with-still', comp('cost-still', { fit: 'fill' })]];
  for (const [slug, c] of both) {
    await studio.clips.createClip({ slug, title: slug, author: 'footage-cost', width: 1920, height: 1080, fps: 30, duration: c.duration });
    await studio.clips.updateClip(slug, { composition: c });
  }
  const times = { 'with-footage': [], 'with-still': [] };
  for (let i = 0; i < runs; i++) {
    // interleaved, so a busy moment hurts both
    for (const slug of Object.keys(times)) {
      const r = await studio.renders.wait(studio.renders.enqueue({ clip: slug }).id, 600000);
      if (r.status !== 'done') throw new Error(`${slug}: ${r.error}`);
      times[slug].push(r.stats.renderSeconds);
    }
  }
  const f = median(times['with-footage']), s = median(times['with-still']);
  const frames = Math.round(Math.min(seconds, m.duration) * 30);
  const after = du(dataDir);
  lines.push(
    `# What footage costs`,
    ``,
    `Measured by \`scripts/footage-cost.mjs\` on ${process.platform} (${new Date().toISOString().slice(0, 10)}), ${runs} interleaved runs, medians.`,
    ``,
    `File: \`${basename(file)}\`, ${m.width}×${m.height}, ${m.fps} fps, ${m.frames} frames, ${m.duration} s, ${m.codec}, ${mb(m.bytes)}.`,
    ``,
    `## Disk`,
    ``,
    `| what | size |`,
    `|---|---|`,
    `| the file (kept as it is) | ${mb(m.bytes)} |`,
    `| thumbnail + 8-frame filmstrip + waveform | ${mb(stills)} |`,
    `| the frame table in the version's meta | ${m.frames} timestamps |`,
    `| decoded frames on disk | none: the decoder's cache is memory only, ${mb(footageService().stats().cacheLimit)} at most, least recently used first |`,
    `| preview frames on disk | none: encoded frames are cached in the server's memory (128 MB at most) and by the browser (immutable URLs) |`,
    `| the data dir grew by (both clips, ${runs} render${runs > 1 ? "s" : ""} each, the still) | ${mb(after - before)} |`,
    ``,
    `Import (probe, frame table by decoding the whole file once, stills, SHA-256): ${importSeconds.toFixed(2)} s.`,
    ``,
    `## Render time`,
    ``,
    `| clip (${frames} frames, 1920×1080) | runs (s) | median |`,
    `|---|---|---|`,
    `| footage layer at 1:1 | ${times['with-footage'].join(' / ')} | ${f} s |`,
    `| a still in its place | ${times['with-still'].join(' / ')} | ${s} s |`,
    ``,
    `Footage adds ${(f - s).toFixed(2)} s over ${frames} frames: ${(((f - s) / frames) * 1000).toFixed(1)} ms a frame (decoding, the copy to the worker, the upload to a canvas), ${s > 0 ? `${Math.round(((f - s) / s) * 100)} %` : 'n/a'} on this clip. A clip without footage pays nothing: the runtime asks for no frames.`,
  );
} finally {
  await studio.close();
  await footageService().close();
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.error(`could not remove ${dataDir}: ${e.message}`); }
}
const md = `${lines.join('\n')}\n`;
console.log(md);
if (out) writeFileSync(out, md);
