// Frame hashes of the iteration-1 showcase clips, through the MCP server: the sampled hashes of
// each clip's first render plus a dense set drawn now (every 8th frame). With --compare, check them
// against a baseline written earlier on the same machine; every hash must be identical.
//
//   STUDIO_DATA=<dir with the showcase> node scripts/hashes.mjs out.json [--compare baseline.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { connect, callTool } from './mcp.mjs';

const CLIPS = ['clip-1-every-frame', 'clip-2-compounding', 'clip-3-release-notes'];
const STEP = 8;
const argv = process.argv.slice(2);
const out = argv[0];
const against = argv.includes('--compare') ? JSON.parse(readFileSync(argv[argv.indexOf('--compare') + 1], 'utf8')) : null;

const client = await connect({ author: 'hash-script' });
const call = async (name, args) => {
  const r = await callTool(client, name, args);
  if (r.isError) throw new Error(`${name}: ${r.text}`);
  return r.json;
};
const result = { machine: `${process.platform} ${process.arch}`, node: process.version, step: STEP, clips: {} };
let failed = false;
try {
  for (const clip of CLIPS) {
    const comp = (await call('get_clip', { clip })).composition;
    const total = Math.round(comp.duration * comp.fps);
    const times = [];
    for (let f = 0; f < total; f += STEP) times.push(f / comp.fps);
    const dense = {};
    for (let i = 0; i < times.length; i += 64) {
      for (const x of (await call('frame_hashes', { clip, times: times.slice(i, i + 64) })).frames) dense[x.frame] = x.hash;
    }
    const done = (await call('list_renders', { clip, status: 'done', limit: 100 })).renders;
    const first = done[done.length - 1];
    result.clips[clip] = { render: first?.stats?.frameHashes ?? null, dense };
    if (against) {
      const base = against.clips[clip];
      const diff = Object.keys(base.dense).filter((k) => base.dense[k] !== dense[k]);
      const rdiff = base.render && first ? Object.keys(base.render).filter((k) => base.render[k] !== first.stats.frameHashes[k]) : [];
      const ok = !diff.length && !rdiff.length && Object.keys(dense).length === Object.keys(base.dense).length;
      console.log(`${ok ? '✓' : '✖'} ${clip}: ${Object.keys(base.dense).length} dense frames, ${Object.keys(base.render ?? {}).length} render samples${ok ? ' identical' : `; differ at ${[...diff, ...rdiff.map((k) => `render:${k}`)].join(', ')}`}`);
      if (!ok) failed = true;
    } else {
      console.log(`${clip}: ${Object.keys(dense).length} dense frames, ${Object.keys(result.clips[clip].render ?? {}).length} render samples`);
    }
  }
} finally {
  await client.close();
}
if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
process.exit(failed ? 1 : 0);
