// Push asset sources from assets/ into the studio library through its MCP server: a missing asset
// is created, a changed one gets a new version, an unchanged one is left alone. Dependencies named
// in an asset's `uses` (and the defaults of its asset params) are synced first. "name.v2.js" is version 2 of "name"; the highest wins.
//
// The sync never undoes a change made in the studio. When the library's newest version of an asset did
// not come from assets/ (a proposal accepted in the studio, a save in the playground), syncing the older
// file would make a new version that throws that change away: the sync stops before writing anything and
// names the conflicts. --pull writes the library's version into assets/ (as name.v<N>.js), so the file
// and the library agree again; --force makes the new version from the file anyway. <data dir>/sync-state.json
// remembers the hashes of the sources the files and the library agreed on, so a pulled file can be edited
// and synced again.
//
//   node scripts/sync-assets.mjs                          every asset in assets/
//   node scripts/sync-assets.mjs sketch-chapter bg-paper  these (and what they use)
//   node scripts/sync-assets.mjs --clip history-of-ai ... record new versions as made for that clip
//   node scripts/sync-assets.mjs --pull [names]           bring studio changes into assets/
//   node scripts/sync-assets.mjs --force [names]          sync the files even over studio changes

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool } from './mcp.mjs';

export const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
/** The note every version the sync makes carries: how the sync recognises its own versions. */
export const SYNC_NOTE = 'Synced from assets/';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
/**
 * Where the agreed hashes live: next to the library they describe (the data dir's sync-state.json) when syncing the
 * repo's assets/, so two data dirs never share one record and nothing machine-local lands in git; inside the folder
 * itself for any other folder of sources (tests).
 */
// the data dir as the studio resolves it (src/studio/studio.js defaultDataDir)
const dataDir = () => resolve(process.env.STUDIO_DATA ?? join(ASSETS_DIR, '..', 'data'));
const stateFile = (dir) => (resolve(dir) === resolve(ASSETS_DIR) ? join(dataDir(), 'sync-state.json') : join(dir, '.sync-state.json'));
/** name → hashes of the sources the files and the library agreed on. */
const readState = (dir) => { try { return existsSync(stateFile(dir)) ? JSON.parse(readFileSync(stateFile(dir), 'utf8')) : {}; } catch { return {}; } };
function remember(dir, state, name, source) {
  const h = sha1(source);
  if ((state[name] ??= []).includes(h)) return;
  state[name].push(h);
  try { writeFileSync(stateFile(dir), `${JSON.stringify(Object.fromEntries(Object.entries(state).sort()), null, 1)}\n`); } catch { /* no data dir yet: the next sync records it */ }
}

/** name → { path, v } of every source file in assets/, all versions. */
function filesByName(dir) {
  const all = new Map();
  for (const f of readdirSync(dir)) {
    const m = /^([a-z0-9-]+?)(?:\.v(\d+))?\.js$/.exec(f);
    if (!m) continue;
    if (!all.has(m[1])) all.set(m[1], []);
    all.get(m[1]).push({ v: Number(m[2] ?? 1), path: join(dir, f) });
  }
  return all;
}

/** name → path of its latest source file in assets/. */
export function assetFiles(dir = ASSETS_DIR) {
  return new Map([...filesByName(dir)].map(([name, list]) => [name, list.reduce((a, b) => (b.v > a.v ? b : a)).path]));
}

/** Assets this source needs: its `uses`, and the defaults of its asset-typed params. */
const usesOf = (source) => {
  const m = /\buses:\s*\[([^\]]*)\]/.exec(source);
  const uses = m ? [...m[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((x) => x[1]) : [];
  const defaults = [...source.matchAll(/type:\s*['"]asset['"][^}]*?default:\s*['"]([a-z0-9-]+)['"]/g)].map((x) => x[1]);
  return [...uses, ...defaults];
};

/** A sync that would undo studio changes: what they are and how to resolve them. */
export class SyncConflict extends Error {
  constructor(conflicts) {
    super(`The sync stopped: ${conflicts.length === 1 ? 'one asset was' : `${conflicts.length} assets were`} changed in the studio since the files in assets/, and syncing would undo ${conflicts.length === 1 ? 'that change' : 'those changes'}:\n${conflicts.map((c) => `- ${c.name}: the library is at v${c.version} (${c.author}${c.note ? `, "${c.note}"` : ''}), which did not come from ${c.file}`).join('\n')}\nRun with --pull to write the library's versions into assets/, or --force to make new versions from the files anyway.`);
    this.name = 'SyncConflict';
    this.conflicts = conflicts;
  }
}

/**
 * Sync the named assets (all of assets/ when empty) and their dependencies, dependencies first.
 * Returns { created, updated, unchanged, pulled }; throws SyncConflict (before writing anything) when the library holds
 * studio changes the files do not have, unless pull (write them into assets/) or force (sync over them).
 * @param {any} client @param {string[]} [names] @param {{ forClip?: string, log?: (s: string) => void, dir?: string, pull?: boolean, force?: boolean }} [o]
 */
export async function syncAssets(client, names = [], { forClip, log = console.log, dir = ASSETS_DIR, pull = false, force = false } = {}) {
  const byName = filesByName(dir);
  const state = readState(dir);
  const files = assetFiles(dir);
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

  // first look: what each asset needs, and whether the library holds a change the files do not
  const plan = [], conflicts = [];
  for (const name of order) {
    const source = readFileSync(files.get(name), 'utf8');
    const current = await callTool(client, 'get_asset', { ref: name });
    if (current.isError) { plan.push({ name, source, kind: 'created' }); continue; }
    const lib = current.json;
    if (lib.source === source) { plan.push({ name, source, kind: 'unchanged' }); continue; }
    // the newest version came from a file if the sync made it, or if it is one of the files' contents (versions made by the showcase plan)
    const fromFile = lib.note === SYNC_NOTE || (state[name] ?? []).includes(sha1(lib.source)) || byName.get(name).some((f) => readFileSync(f.path, 'utf8') === lib.source);
    if (fromFile || force) { plan.push({ name, source, kind: 'updated' }); continue; }
    conflicts.push({ name, version: lib.version, author: lib.author, note: lib.note, source: lib.source, file: files.get(name).slice(dir.length + 1) });
  }

  const result = { created: [], updated: [], unchanged: [], pulled: [] };
  if (conflicts.length && !pull) throw new SyncConflict(conflicts);
  for (const c of conflicts) {
    // the library's version becomes the newest file: name.v<library version>.js, or the next number up
    const highest = Math.max(...byName.get(c.name).map((f) => f.v));
    const v = c.version > highest ? c.version : highest + 1;
    const path = join(dir, `${c.name}.v${v}.js`);
    writeFileSync(path, c.source);
    remember(dir, state, c.name, c.source);
    result.pulled.push(c.name);
    log(`✓ pulled    ${c.name}@${c.version} → assets/${c.name}.v${v}.js`);
  }
  for (const { name, source, kind } of plan) {
    let r;
    if (kind === 'created') r = await callTool(client, 'create_asset', { name, source, for_clip: forClip, note: SYNC_NOTE });
    else if (kind === 'updated') r = await callTool(client, 'update_asset', { name, source, for_clip: forClip, note: SYNC_NOTE });
    if (r?.isError) throw new Error(`${kind === 'created' ? 'create_asset' : 'update_asset'} ${name}: ${r.text}`);
    if (kind !== 'unchanged') remember(dir, state, name, source);
    result[kind].push(name);
    if (kind !== 'unchanged') log(`✓ ${kind.padEnd(9)} ${r.json?.[kind] ?? name}`);
  }
  log(`assets: ${result.created.length} created, ${result.updated.length} updated, ${result.unchanged.length} unchanged${result.pulled.length ? `, ${result.pulled.length} pulled into assets/` : ''}`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--clip');
  const forClip = ci >= 0 ? argv[ci + 1] : undefined;
  const names = argv.filter((a, i) => !a.startsWith('--') && (ci < 0 || i !== ci + 1));
  const client = await connect({});
  try {
    await syncAssets(client, names, { forClip, pull: argv.includes('--pull'), force: argv.includes('--force') });
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exitCode = e instanceof SyncConflict ? 2 : 1;
  } finally {
    await client.close();
  }
}
