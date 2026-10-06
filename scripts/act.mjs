// Build a showcase clip one step at a time, keeping a journal the showcase can replay.
//
//   node scripts/act.mjs <clip> <tool> '<json args>' [--out file.png]       an MCP tool call (as Claude Code)
//   node scripts/act.mjs <clip> --user <action> '<json>'                    what the user does in the studio:
//        upload { file, name }   create_request { scope, asset, clip, items, at, params, message }
//        accept { proposal | request, force }   reject { proposal | request, reason }   reply { request, body }
//
// String values "@file:path" are read from the repo (and kept as references in the journal). Every
// step is appended to showcase/journal/<clip>.jsonl with its kind; read-only tool calls are kept too
// (they are part of how the clip was built) and marked so the replay can skip them. STUDIO_DATA
// selects the data dir; MCP calls are made as STUDIO_AUTHOR (default claude-opus-5-5).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool, inlineFiles } from './mcp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [clip, a1, a2, a3, ...rest] = process.argv.slice(2);
if (!clip || !a1) { console.error("usage: node scripts/act.mjs <clip> <tool> '<json>' | <clip> --user <action> '<json>'"); process.exit(2); }
const user = a1 === '--user';
const name = user ? a2 : a1;
const raw = JSON.parse((user ? a3 : a2) ?? '{}');
const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : (!user && a3 === '--out' ? rest[0] : null);
const author = process.env.STUDIO_AUTHOR ?? 'claude-opus-5-5';
const journal = join(root, 'showcase', 'journal', `${clip}.jsonl`);
mkdirSync(dirname(journal), { recursive: true });
const t0 = Date.now();
let result, ok = true, readOnly = false;

if (user) {
  const { createStudio } = await import('../src/studio/studio.js');
  const studio = createStudio({ role: 'server' });
  try {
    const args = inlineFiles(raw, root);
    const pendingOf = (requestId) => studio.requests.get(requestId).proposals.find((p) => p.status === 'pending')?.id;
    if (name === 'upload') result = await studio.uploads.upload({ name: args.name, data: readFileSync(join(root, raw.file)), author: 'studio-user', forClip: clip });
    else if (name === 'create_request') result = studio.requests.create({ ...args, author: 'studio-user' });
    else if (name === 'accept') result = await studio.requests.accept({ proposal: args.proposal ?? pendingOf(args.request), author: 'studio-user', force: !!args.force });
    else if (name === 'reject') result = studio.requests.reject({ proposal: args.proposal ?? pendingOf(args.request), author: 'studio-user', reason: args.reason });
    else if (name === 'reply') result = studio.requests.reply({ id: args.request, author: 'studio-user', body: args.body });
    else throw new Error(`unknown user action ${name}`);
    const r = result.asset ?? result.request ?? result;
    console.log(JSON.stringify({ ok: true, id: r.id, ref: r.ref, status: r.status, result: result.result, duplicate: result.duplicate, removed: result.removed }, null, 1));
  } catch (e) {
    ok = false;
    console.error(e.message);
  } finally {
    await studio.close();
  }
} else {
  const client = await connect({ author });
  try {
    const { tools } = await client.listTools();
    readOnly = !!tools.find((t) => t.name === name)?.annotations?.readOnlyHint;
    result = await callTool(client, name, inlineFiles(raw, root));
    ok = !result.isError;
    console.log(result.text);
    if (out && result.images[0]) { writeFileSync(out, result.images[0]); console.log(`image → ${out}`); }
  } finally {
    await client.close();
  }
}
appendFileSync(journal, `${JSON.stringify({ at: new Date(t0).toISOString(), ms: Date.now() - t0, kind: user ? 'user' : readOnly ? 'read' : 'tool', name, args: raw, ok })}\n`);
process.exit(ok ? 0 : 1);
