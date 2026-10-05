// Push asset sources from assets/ into the studio library through its MCP server: a missing asset
// is created, a changed one gets a new version, an unchanged one is left alone. Dependencies named
// in an asset's `uses` (and the defaults of its asset params) are synced first. "name.v2.js" is version 2 of "name"; the highest wins.
//
//   node scripts/sync-assets.mjs                          every asset in assets/
//   node scripts/sync-assets.mjs sketch-chapter bg-paper  these (and what they use)
//   node scripts/sync-assets.mjs --clip history-of-ai ... record new versions as made for that clip

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool } from './mcp.mjs';

export const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** name → path of its latest source file in assets/. */
export function assetFiles(dir = ASSETS_DIR) {
  const best = new Map();
  for (const f of readdirSync(dir)) {
    const m = /^([a-z0-9-]+?)(?:\.v(\d+))?\.js$/.exec(f);
    if (!m) continue;
    const v = Number(m[2] ?? 1);
    if (!best.has(m[1]) || best.get(m[1]).v < v) best.set(m[1], { v, path: join(dir, f) });
  }
  return new Map([...best].map(([name, { path }]) => [name, path]));
}

/** Assets this source needs: its `uses`, and the defaults of its asset-typed params. */
const usesOf = (source) => {
  const m = /\buses:\s*\[([^\]]*)\]/.exec(source);
  const uses = m ? [...m[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((x) => x[1]) : [];
  const defaults = [...source.matchAll(/type:\s*['"]asset['"][^}]*?default:\s*['"]([a-z0-9-]+)['"]/g)].map((x) => x[1]);
  return [...uses, ...defaults];
};

/**
 * Sync the named assets (all of assets/ when empty) and their dependencies, dependencies first.
 * @param {any} client @param {string[]} [names] @param {{ forClip?: string, log?: (s: string) => void }} [o]
 */
export async function syncAssets(client, names = [], { forClip, log = console.log } = {}) {
  const files = assetFiles();
  const order = [];
  const visit = (name, path = []) => {
    if (order.includes(name)) return;
    if (path.includes(name)) throw new Error(`Dependency cycle: ${[...path, name].join(' → ')}`);
    const file = files.get(name);
    if (!file) throw new Error(`No source for "${name}" in assets/`);
    for (const dep of usesOf(readFileSync(file, 'utf8'))) if (files.has(dep)) visit(dep, [...path, name]);
    order.push(name);
  };
  for (const n of names.length ? names : [...files.keys()].sort()) visit(n);

  const result = { created: [], updated: [], unchanged: [] };
  for (const name of order) {
    const source = readFileSync(files.get(name), 'utf8');
    const current = await callTool(client, 'get_asset', { ref: name });
    let r, kind;
    if (current.isError) [r, kind] = [await callTool(client, 'create_asset', { name, source, for_clip: forClip }), 'created'];
    else if (current.json?.source !== source) [r, kind] = [await callTool(client, 'update_asset', { name, source, for_clip: forClip, note: 'Synced from assets/' }), 'updated'];
    else kind = 'unchanged';
    if (r?.isError) throw new Error(`${kind === 'created' ? 'create_asset' : 'update_asset'} ${name}: ${r.text}`);
    result[kind].push(name);
    if (kind !== 'unchanged') log(`✓ ${kind.padEnd(9)} ${r.json?.[kind] ?? name}`);
  }
  log(`assets: ${result.created.length} created, ${result.updated.length} updated, ${result.unchanged.length} unchanged`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--clip');
  const forClip = ci >= 0 ? argv[ci + 1] : undefined;
  const names = argv.filter((_, i) => ci < 0 || (i !== ci && i !== ci + 1));
  const client = await connect({});
  try {
    await syncAssets(client, names, { forClip });
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
