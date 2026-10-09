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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, callTool, inlineFiles } from '../scripts/mcp.mjs';
import { readFileSync } from 'node:fs';
import { steps, AUTHOR, JOURNALS, JOURNAL_AUTHOR } from './plan.mjs';
import { createStudio } from '../src/studio/studio.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const noRender = argv.includes('--no-render');
const until = argv.includes('--until') ? Number(argv[argv.indexOf('--until') + 1]) : Infinity;

// clips 4 to 6 were built step by step with scripts/act.mjs: replay their journals after the plan
// (tool calls through MCP, the user's studio actions in-process; read-only calls are skipped)
for (const clip of JOURNALS) {
  const entries = readFileSync(join(here, 'journal', `${clip}.jsonl`), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((e) => e.kind !== 'read' && e.ok);
  // a render a later render of the same clip and format replaced (the first try at a gate) is not made again
  const lastRender = new Map();
  entries.forEach((e, i) => { if (e.name === 'start_render') lastRender.set(`${e.args.clip}|${e.args.format ?? ''}`, i); });
  // an update_clip with "@module:<file>" inlines that file as it is now, so every such save of a clip is the final
  // composition: an earlier one is the same input as a later one, and it can name asset versions the replay has not made
  // yet. It is skipped when a later save of the same clip and module follows with nothing in between that edits the clip.
  const moduleSave = (e) => e.kind !== 'user' && e.name === 'update_clip' && typeof e.args.composition === 'string' && e.args.composition.startsWith('@module:');
  const edits = (e, c) => e.kind === 'user' || (e.name !== 'start_render' && !moduleSave(e) && (e.args?.clip === c || e.args?.slug === c));
  const superseded = (i) => {
    const e = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      const x = entries[j];
      if (moduleSave(x) && x.args.clip === e.args.clip && x.args.composition === e.args.composition) return true;
      if (edits(x, e.args.clip)) return false;
    }
    return false;
  };
  entries.forEach((e, i) => {
    if (e.kind === 'user') steps.push({ user: e.name, args: e.args, clip });
    else if (moduleSave(e) && superseded(i)) return;
    else if (e.name !== 'start_render' || lastRender.get(`${e.args.clip}|${e.args.format ?? ''}`) === i) steps.push({ tool: e.name, args: e.args, render: e.name === 'start_render', journal: true });
  });
}

async function modules(v) {
  if (typeof v === 'string' && v.startsWith('@module:')) return JSON.parse(JSON.stringify((await import(pathToFileURL(join(here, '..', v.slice(8))).href)).default));
  if (Array.isArray(v)) return Promise.all(v.map(modules));
  if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await modules(x)])));
  return v;
}

/** What the user did in the studio (uploads, requests, accepting a proposal), done through the studio services. */
async function userStep({ user, args, clip }) {
  const studio = createStudio({ role: 'server' });
  try {
    const pending = (id) => studio.requests.get(id).proposals.find((p) => p.status === 'pending')?.id;
    if (user === 'upload') return (await studio.uploads.upload({ name: args.name, data: readFileSync(join(here, '..', args.file)), author: 'studio-user', forClip: clip })).asset.ref;
    if (user === 'create_request') return `request #${studio.requests.create({ ...args, author: 'studio-user' }).id}`;
    if (user === 'accept') return (await studio.requests.accept({ proposal: args.proposal ?? pending(args.request), author: 'studio-user', force: !!args.force })).result;
    if (user === 'reject') return studio.requests.reject({ proposal: args.proposal ?? pending(args.request), author: 'studio-user', reason: args.reason }).status;
    if (user === 'reply') return studio.requests.reply({ id: args.request, author: 'studio-user', body: args.body }).status;
    throw new Error(`unknown user step ${user}`);
  } finally {
    await studio.close();
  }
}

const client = await connect({ author: AUTHOR });
// the journalled clips were built by another model; their calls are made as that author
const journalClient = await connect({ author: JOURNAL_AUTHOR });
const results = [];
let failed = false;
try {
  for (const [i, step] of steps.entries()) {
    if (i + 1 > until) break;
    if (step.render && noRender) continue;
    const t0 = performance.now();
    if (step.user) {
      try {
        const out = await userStep(step);
        console.log(`✓ ${String(i + 1).padStart(2)} user: ${step.user.padEnd(8)} ${step.clip.padEnd(24)} ${out ?? ''} (${Math.round(performance.now() - t0)}ms)`);
      } catch (e) { console.error(`✖ ${String(i + 1).padStart(2)} user: ${step.user}\n${e.message}`); failed = true; break; }
      continue;
    }
    const r = step.journal
      ? await callTool(journalClient, step.tool, inlineFiles(await modules(step.args), join(here, '..')))
      : await callTool(client, step.tool, inlineFiles(step.args, here));
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
  await journalClient.close();
}
if (process.env.STUDIO_DATA) writeFileSync(join(process.env.STUDIO_DATA, 'showcase-build.json'), JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
