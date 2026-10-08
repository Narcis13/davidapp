// Render speed after iteration 2 against the code before it, on this machine, and what the new
// kinds of layer cost. Writes reports/baseline-speed.json, reports/speed.json and
// reports/render-speed.md.
//
//   node scripts/speed-compare.mjs <baseline-checkout> <baseline-data> <data> [out-dir] [--runs 5]
//
// baseline-checkout is a worktree of the commit before the iteration (6c9f8cf) sharing this
// checkout's node_modules; both data dirs hold the showcase (npm run showcase). The three 2D clips
// are rendered `runs` times on each side, one side after the other in turns so that whatever else
// the machine does falls on both, each render through scripts/speed.mjs (MCP start_render, the
// render's own renderSeconds). The medians are compared. Run it on a quiet machine.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { ROOT } from '../src/render/host.js';
import { defaultWorkers } from '../src/render/video.js';

const argv = process.argv.slice(2);
const runs = argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 5;
const [baseDir, baseData, headData, outArg] = argv.filter((a, i, all) => a !== '--runs' && all[i - 1] !== '--runs');
if (!baseDir || !baseData || !headData) { console.error('usage: node scripts/speed-compare.mjs <baseline-checkout> <baseline-data> <data> [out-dir] [--runs 5]'); process.exit(2); }
const out = outArg ?? join(ROOT, 'docs', 'showcase', 'v2');
mkdirSync(join(out, 'reports'), { recursive: true });
const CLIPS = ['clip-1-every-frame', 'clip-2-compounding', 'clip-3-release-notes'];
const LIMIT = 1.10;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'speed-'));

const sides = { baseline: { cwd: resolve(baseDir), data: resolve(baseData), runs: {}, info: null }, now: { cwd: ROOT, data: resolve(headData), runs: {}, info: null } };
for (let i = 0; i < runs; i++) {
  // alternate who goes first
  for (const name of i % 2 ? ['now', 'baseline'] : ['baseline', 'now']) {
    const side = sides[name];
    const file = join(tmp, `${name}-${i}.json`);
    const r = spawnSync(process.execPath, ['scripts/speed.mjs', file, '--runs', '1'], { cwd: side.cwd, env: { ...process.env, STUDIO_DATA: side.data }, encoding: 'utf8' });
    if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
    const j = JSON.parse(readFileSync(file, 'utf8'));
    side.info = j;
    for (const c of CLIPS) (side.runs[c] ??= []).push(j.clips[c].runs[0]);
    console.log(`run ${i + 1}/${runs} ${name.padEnd(8)} ${CLIPS.map((c) => `${j.clips[c].runs[0]} s`).join(' / ')}`);
  }
}
const summary = (side) => ({
  machine: `${cpus()[0].model.trim()} × ${cpus().length}`, platform: `${process.platform} ${process.arch}`, node: process.version, runs,
  method: 'MCP start_render with wait; renderSeconds from the render stats (frames drawn by the worker pool + FFmpeg encode, audio mix excluded once cached); median of the runs; baseline and current code rendered in turns (scripts/speed-compare.mjs)',
  clips: Object.fromEntries(CLIPS.map((c) => [c, { size: side.info.clips[c].size, seconds: side.info.clips[c].seconds, frames: side.info.clips[c].frames, runs: side.runs[c], median: round(median(side.runs[c])), framesPerSecond: round(side.info.clips[c].frames / median(side.runs[c]), 1) }])),
});
const base = summary(sides.baseline), now = summary(sides.now);
writeFileSync(join(out, 'reports', 'baseline-speed.json'), `${JSON.stringify({ code: 'the commit before iteration 2 (6c9f8cf: iteration-1 src)', ...base }, null, 1)}\n`);
const compare = CLIPS.map((c) => ({ clip: c, baseline: base.clips[c].median, now: now.clips[c].median, ratio: round(now.clips[c].median / base.clips[c].median, 3), ok: now.clips[c].median <= base.clips[c].median * LIMIT }));

// ---- what the new layers cost: the same frames drawn with and without them, one worker, no encode
const studio = createStudio({ dataDir: resolve(headData), role: 'evidence' });
const costs = [];
let v2 = [];
try {
  const strip = (comp, pick) => { const c = structuredClone(comp); pick(c); return c; };
  const items = (c) => c.tracks.flatMap((t) => t.items);
  const without = (ids) => (c) => { for (const t of c.tracks) t.items = t.items.filter((it) => !ids.includes(it.id)); };
  const hashes = (composition, times) => studio.frameHashes({ clip: undefined, composition, times });
  const timeIt = async (composition, times) => {
    await hashes(composition, times.slice(0, 2));
    let best = Infinity;
    for (let k = 0; k < 2; k++) { const t0 = performance.now(); await hashes(composition, times); best = Math.min(best, (performance.now() - t0) / times.length); }
    return best;
  };
  const span = (from, to, n = 16) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);
  /** @type {[string, string, number[] | null, (c: any) => void][]} */
  const cases = [
    ['clip-4-direct-the-studio', 'film grain on the whole clip (fx-grain)', [1, 29], (c) => { c.effects = []; }],
    ['clip-4-direct-the-studio', 'every effect: grain, a vignette on a track, duotone and glow on items', [1, 29], (c) => { c.effects = []; for (const t of c.tracks) { delete t.effects; for (const it of t.items) delete it.effects; } }],
    ['clip-4-direct-the-studio', 'glow on the numbers scene (fx-glow, 0:15 to 0:23)', [16, 22], (c) => { for (const it of items(c)) if (it.id === 'numbers') delete it.effects; }],
    ['clip-4-direct-the-studio', 'the 3D orb, rasterized every frame (orb-3d, 0:07 to 0:15)', [8, 14], without(['orb'])],
    ['clip-5-a-library-in-3d', 'the 3D terrain, rasterized every frame (terrain-3d)', null, without(['terrain'])],
    ['clip-5-a-library-in-3d', '3D block text, rasterized every frame (block-text-3d)', null, without(['grows'])],
    ['clip-5-a-library-in-3d', 'the orb as a baked sequence (orb-spin)', null, without(['orb'])],
  ];
  for (const [clip, what, window, cut] of cases) {
    const comp = studio.clips.getClip(clip).composition;
    const lean = strip(comp, cut);
    let w = window;
    if (!w) { const gone = items(comp).filter((it) => !items(lean).some((x) => x.id === it.id)); w = [Math.min(...gone.map((it) => it.start)) + 0.3, Math.max(...gone.map((it) => it.start + it.duration)) - 0.3]; }
    const times = span(w[0], w[1]);
    const withIt = await timeIt(comp, times), withoutIt = await timeIt(lean, times);
    costs.push({ clip, what, seconds: w.map((x) => round(x, 1)), size: `${comp.width}×${comp.height}`, msPerFrameWith: round(withIt, 1), msPerFrameWithout: round(withoutIt, 1), costMsPerFrame: round(withIt - withoutIt, 1) });
    console.log(`${clip}: ${what}: ${round(withIt, 1)} ms/frame with, ${round(withoutIt, 1)} without`);
  }
  for (const clip of ['clip-4-direct-the-studio', 'clip-5-a-library-in-3d', 'clip-6-what-the-library-holds']) {
    const comp = studio.clips.getClip(clip).composition;
    const seen = new Set();
    for (const r of studio.renders.list({ clip, status: 'done', limit: 20 })) {
      if (seen.has(r.format)) continue;
      seen.add(r.format);
      v2.push({ clip, format: r.format, size: `${r.width}×${r.height}`, seconds: comp.duration, frames: Math.round(comp.duration * comp.fps), renderSeconds: r.stats.renderSeconds, framesPerSecond: r.stats.framesPerSecond, realtime: r.stats.realtimeFactor });
    }
  }
  v2 = v2.reverse();
} finally {
  await studio.close();
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(out, 'reports', 'speed.json'), `${JSON.stringify({ ...now, comparedWithBaseline: compare, limit: `no more than ${Math.round((LIMIT - 1) * 100)} % slower`, clips4to6: v2, costs }, null, 1)}\n`);
const md = [
  '# Render speed after iteration 2',
  '',
  `Machine: ${now.machine}, ${now.platform}, Node ${now.node}. Written by \`scripts/speed-compare.mjs\`.`,
  '',
  '## The 2D clips against the code before the iteration',
  '',
  `Clips 1 to 3 (32 s each, 960 frames) rendered ${runs} times with the code before iteration 2 (a worktree of \`6c9f8cf\`, same \`node_modules\`) and ${runs} times with the current code, in turns, each through the MCP server (\`start_render\`); the time is the render's own \`renderSeconds\` (frames drawn by ${defaultWorkers()} worker threads and piped into FFmpeg, libx264 \`-preset medium -crf 18\`; the audio mix is cached and not counted). Medians:`,
  '',
  '| clip | size | before | now | now / before | runs before (s) | runs now (s) |',
  '|---|---|---|---|---|---|---|',
  ...compare.map((c) => `| ${c.clip} | ${base.clips[c.clip].size} | ${c.baseline} s | ${c.now} s | ${c.ratio} | ${base.clips[c.clip].runs.join(' / ')} | ${now.clips[c.clip].runs.join(' / ')} |`),
  '',
  `Limit: no clip more than 10 % slower. ${compare.every((c) => c.ok) ? 'All three are within it.' : `NOT MET: ${compare.filter((c) => !c.ok).map((c) => c.clip).join(', ')}.`} Items in the old shape still go through the iteration-1 drawing path, which is why the numbers barely move; a 30-second 1080p clip of that kind renders in ${round(Math.min(...compare.map((c) => c.now)) * 30 / 32, 1)} to ${round(Math.max(...compare.map((c) => c.now)) * 30 / 32, 1)} s.`,
  '',
  '## Clips 4 to 6',
  '',
  'The first finished render of each, from the showcase build (`stats` of the render):',
  '',
  '| clip | format | size | length | render time | frames/s | vs realtime |',
  '|---|---|---|---|---|---|---|',
  ...v2.map((r) => `| ${r.clip} | ${r.format} | ${r.size} | ${r.seconds} s (${r.frames} frames) | ${r.renderSeconds} s | ${r.framesPerSecond} | ${r.realtime}× |`),
  '',
  'These are slower than realtime because of what is on screen, not because of the new layout model: see below.',
  '',
  '## What 3D and effects cost',
  '',
  'The same 16 frames of a scene drawn with and without one thing, by one worker, with no encoding (`frame_hashes`; best of two passes). The difference is what that thing costs per 1080p frame.',
  '',
  '| clip | what | frames from | with | without | cost per frame |',
  '|---|---|---|---|---|---|',
  ...costs.map((c) => `| ${c.clip} (${c.size}) | ${c.what} | ${c.seconds[0]}–${c.seconds[1]} s | ${c.msPerFrameWith} ms | ${c.msPerFrameWithout} ms | ${c.costMsPerFrame} ms |`),
  '',
  'Effects are pixel loops in plain JavaScript over the whole frame (canvas `filter` is not used, so the preview and the render agree), and 3D is a software rasterizer: both cost tens of milliseconds a frame at 1080p, per worker, and they are what makes clips 4 to 6 slower than realtime. A baked sequence replaces the rasterizer with one PNG decode and draw per frame; what it saves depends on the scene it replaces (compare the two orb rows).',
  '',
].join('\n');
writeFileSync(join(out, 'reports', 'render-speed.md'), md);
console.log(`\n${compare.map((c) => `${c.clip}: ${c.baseline} → ${c.now} s (×${c.ratio})${c.ok ? '' : ' TOO SLOW'}`).join('\n')}`);
process.exit(compare.every((c) => c.ok) ? 0 : 1);
