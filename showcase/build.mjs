// Rebuild the showcase from the repo, through the studio's MCP server: create each clip, the
// assets it needs (in the order they were made), its composition, and render it. This is the
// same sequence of MCP tool calls that produced the showcase the first time.
//
//   node showcase/build.mjs                 build everything into STUDIO_DATA (default ./data) and render
//   node showcase/build.mjs --no-render     library and clips only
//   node showcase/build.mjs --until 12      stop after step 12 (while authoring)
//
// The data directory must not already contain the showcase (start from an empty one).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool, inlineFiles } from '../scripts/mcp.mjs';
import { steps, AUTHOR } from './plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const noRender = argv.includes('--no-render');
const until = argv.includes('--until') ? Number(argv[argv.indexOf('--until') + 1]) : Infinity;

const client = await connect({ author: AUTHOR });
const results = [];
let failed = false;
try {
  for (const [i, step] of steps.entries()) {
    if (i + 1 > until) break;
    if (step.render && noRender) continue;
    const t0 = performance.now();
    const r = await callTool(client, step.tool, inlineFiles(step.args, here));
    const ms = Math.round(performance.now() - t0);
    const what = step.args.name ?? step.args.clip ?? '';
    if (r.isError) {
      console.error(`✖ ${String(i + 1).padStart(2)} ${step.tool} ${what}\n${r.text}`);
      failed = true;
      break;
    }
    const j = r.json ?? {};
    let note = j.created ?? j.updated ?? j.added?.ref ?? '';
    if (step.render) {
      if (j.status !== 'done') { console.error(`✖ render of ${what}: ${j.status} ${j.error ?? ''}`); failed = true; break; }
      note = `render #${j.id} done in ${j.stats.renderSeconds}s (${j.stats.framesPerSecond} fps, ${j.stats.realtimeFactor}× realtime) → ${j.output}`;
      if (j.log) { console.error(`✖ render of ${what} logged: ${j.log}`); failed = true; break; }
    }
    console.log(`✓ ${String(i + 1).padStart(2)} ${step.tool.padEnd(14)} ${what.padEnd(24)} ${note} (${ms}ms)`);
    for (const w of j.warnings ?? []) console.log(`     warning: ${w}`);
    for (const line of j.console ?? []) console.log(`     console: ${line}`);
    results.push({ step: i + 1, tool: step.tool, target: what, result: j });
  }
  if (!failed) {
    const report = await callTool(client, 'reuse_report');
    console.log(`\n${report.text}`);
  }
} finally {
  await client.close();
}
if (process.env.STUDIO_DATA) writeFileSync(join(process.env.STUDIO_DATA, 'showcase-build.json'), JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
