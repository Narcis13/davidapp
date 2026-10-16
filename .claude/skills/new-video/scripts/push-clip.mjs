// Push clips/<slug>/compose.mjs into the studio through its MCP server: create the clip if it is missing, sync the
// function assets the composition names from assets/ (new versions recorded as made for this clip), then save the
// composition (update_clip). Run from the repo root.
//
//   node .claude/skills/new-video/scripts/push-clip.mjs <slug> [--draft | --render] [--no-sync] [--formats a,b]
//
// compose.mjs exports the composition as `default` (or as `composition`), and may export `assets` (names to sync
// besides the ones found in the composition) and `title`. STUDIO_DATA selects the data dir (default ./data).

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
if (!existsSync(join(root, 'scripts/mcp.mjs'))) { console.error('Run from the repo root (scripts/mcp.mjs not found).'); process.exit(2); }
const { connect, callTool } = await import(pathToFileURL(join(root, 'scripts/mcp.mjs')).href);
const { syncAssets } = await import(pathToFileURL(join(root, 'scripts/sync-assets.mjs')).href);

const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
if (!slug) { console.error('usage: node push-clip.mjs <slug> [--draft | --render] [--no-sync] [--formats a,b]'); process.exit(2); }
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);

const file = join(root, 'clips', slug, 'compose.mjs');
if (!existsSync(file)) { console.error(`No ${file}`); process.exit(2); }
const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
const composition = JSON.parse(JSON.stringify(mod.default ?? mod.composition));
if (!composition?.tracks) { console.error('compose.mjs must export a composition (default or `composition`) with tracks'); process.exit(2); }

/** Every asset name the composition refers to (items, motions, effects, transitions, masks, theme, clip effects). */
function refs(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => refs(v, out));
  else if (value && typeof value === 'object') {
    if (typeof value.asset === 'string') out.add(value.asset.split('@')[0]);
    for (const v of Object.values(value)) refs(v, out);
  }
  return out;
}
const named = refs(composition.tracks);
refs(composition.effects ?? [], named);
if (typeof composition.theme === 'string') named.add(composition.theme.split('@')[0]);
for (const n of mod.assets ?? []) named.add(n);
// only what has a source in assets/ is synced; uploads, footage, narrations and baked sequences live in the library alone
const inRepo = new Set(readdirSync(join(root, 'assets')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.v\d+\.js$|\.js$/, '')));
const toSync = [...named].filter((n) => inRepo.has(n)).sort();

const client = await connect({});
const must = (r, what) => { if (r.isError) throw new Error(`${what}: ${r.text}`); return r; };
try {
  if ((await callTool(client, 'get_clip', { clip: slug })).isError) {
    const { format, fps, duration, width, height } = composition;
    must(await callTool(client, 'create_clip', { name: slug, title: mod.title ?? slug, ...(format ? { format } : {}), fps, duration }), 'create_clip');
    console.log(`✓ created clip ${slug}${width && height ? ' (custom size: set on the composition)' : ''}`);
  }
  if (!argv.includes('--no-sync') && toSync.length) await syncAssets(client, toSync, { forClip: slug });
  const r = must(await callTool(client, 'update_clip', { clip: slug, composition, ...(mod.title ? { title: mod.title } : {}) }), 'update_clip');
  console.log(r.text.slice(0, 2500));
  console.log(`→ http://127.0.0.1:8787/clips/${slug}`);
  if (argv.includes('--draft') || argv.includes('--render')) {
    const formats = opt('--formats')?.split(',');
    const args = { clip: slug, wait_seconds: 900, ...(argv.includes('--draft') ? { draft: true } : {}), ...(formats ? { formats } : {}) };
    const job = must(await callTool(client, 'start_render', args), 'start_render').json;
    const out = join(root, 'work', slug, 'render.json');
    if (existsSync(join(root, 'work', slug))) writeFileSync(out, JSON.stringify(job, null, 2));
    console.log(JSON.stringify(job, null, 2).slice(0, 2500));
  }
} finally { await client.close(); }
