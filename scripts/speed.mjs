// Render speed of showcase clips, through the MCP server: render each clip N times (default 3) on a
// data dir that already holds it and report the median wall-clock render time. Run it on a quiet
// machine; nothing else should be rendering.
//
//   STUDIO_DATA=<dir> node scripts/speed.mjs out.json [--runs 3] [clip …]

import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { connect, callTool } from './mcp.mjs';

const argv = process.argv.slice(2);
const out = argv[0];
const runs = argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 3;
const named = argv.slice(1).filter((a, i, all) => a !== '--runs' && all[i - 1] !== '--runs');
const clips = named.length ? named : ['clip-1-every-frame', 'clip-2-compounding', 'clip-3-release-notes'];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const client = await connect({ author: 'speed-script' });
const result = { machine: `${cpus()[0].model} × ${cpus().length}`, node: process.version, runs, method: 'MCP start_render with wait; renderSeconds from the render stats (frames drawn by the worker pool + FFmpeg encode, audio mix excluded once cached); median of the runs', clips: {} };
try {
  for (const clip of clips) {
    const comp = (await callTool(client, 'get_clip', { clip })).json.composition;
    const times = [];
    for (let i = 0; i < runs; i++) {
      const r = await callTool(client, 'start_render', { clip, wait_seconds: 900 });
      if (r.isError || r.json.status !== 'done') throw new Error(`${clip}: ${r.text}`);
      times.push(r.json.stats.renderSeconds);
    }
    const m = median(times);
    result.clips[clip] = { size: `${comp.width}×${comp.height}`, seconds: comp.duration, frames: Math.round(comp.duration * comp.fps), runs: times, median: m, framesPerSecond: Math.round((comp.duration * comp.fps / m) * 10) / 10 };
    console.log(`${clip}: ${times.join(' / ')} s → median ${m} s`);
  }
} finally {
  await client.close();
}
if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
