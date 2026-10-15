// Repo and library agree. A clip is exported to a folder of the repo (clips/<slug>/clip.json) together with everything
// it needs, kept once for every clip in a content store (library/): every asset version by its ref (library/versions/
// <slug>@<n>.json, function sources in library/sources/ so diffs read well) and every file by its SHA-256 (library/files/).
// A clean checkout imports the folder into any library, an empty data dir typically, and gets the same refs (even the
// same sparse version numbers: a clip that pins foo@3 gets foo@3 without foo@1 and foo@2) and the same frames.
//
//   exportClip(slug, { root })        write the folder and add what the store lacks (never delete: other clips share it)
//   status(slug, { root })            what an export would write, and whether the folder is up to date (a dry run)
//   importClip(folder, { files, replace, verify })   create every version of the closure with its exact number, then the clip
//
// Files that may not be redistributed (meta.provenance.redistributable === false) and files over 50 MB stay out of git:
// the export lists them by SHA-256 with their licence and source, and an import finds them in the folders it is given.
// Baked frame sequences are exported as their recipe and baked again on import (baking is deterministic). The bundled
// fonts (fonts/) are listed, never copied: every checkout has them.

import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { ENGINE_VERSION, makeRef, parseRef } from '../core/engine.js';
import { walkParams } from '../core/schema.js';
import { ROOT, loadImage } from '../render/host.js';
import { footageService, sha256File } from '../render/footage.js';
import { json, now, transaction } from '../db/db.js';
import { SLUG_RE, StudioError, footageStills, imageThumbPng, renameRetry, tempOf } from './library.js';

/** Files larger than this stay out of git (listed by SHA-256, like the ones that may not be redistributed). */
export const MAX_REPO_FILE = 50e6;
/** The frames hashed at export, at most, so an import can check itself. */
export const CHECK_FRAMES = 48;
const TYPES = ['function', 'image', 'sound', 'font', 'sequence', 'video'];

/** The repo the store lives in: the checkout this code runs from, or STUDIO_REPO (tests, scratch clones). */
export const repoRoot = () => resolve(process.env.STUDIO_REPO ?? ROOT);
/** What differs between machines that draw the same frames (emoji come from the system's font). */
export const machineId = () => `${process.platform}-${process.arch}`;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const sha1 = (data) => createHash('sha1').update(data).digest('hex');

/** The same value with every object's keys sorted (for hashing and comparing: the order of keys is not content). */
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sorted(v[k])])) : v);
const canon = (v) => JSON.stringify(sorted(v));

/** A value on one line, with spaces after the commas and colons. */
const flat = (v) => (Array.isArray(v) ? `[${v.map(flat).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${flat(x)}`).join(', ')}}`
  : JSON.stringify(v) ?? 'null');

/**
 * JSON for files in git: two-space indent, what fits a line (100 characters) on one line, and so do arrays of plain values
 * and very large values (a frame table, a logo's vector model): lines a person reads stay short, diffs stay small.
 */
function pretty(v, ind = '') {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  const one = flat(v);
  if (one.length <= 100 || one.length > 20000 || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'))) return one;
  const inner = `${ind}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${ind}]`;
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(',\n')}\n${ind}}`;
}
const text = (v) => `${pretty(v)}\n`;

/** Refs in the order a reader expects: by name, then version number. */
const refCompare = (a, b) => { const x = parseRef(a), y = parseRef(b); return x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : x.version - y.version; };

const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e5 ? 3 : 1)} MB`;
const same = (a, b) => canon(a) === canon(b);

/** The parts of a version that decide what it draws or sounds like: its hash. `source`, `main` and `extras` are SHA-256s. */
function materialOf({ type, kind, deps, source, main, extras, meta }) {
  const m = meta ?? {};
  const base = { type, kind: kind ?? null, deps: deps ?? {} };
  if (type === 'function') return { ...base, source };
  if (type === 'image') return { ...base, file: main, extras: extras ?? {}, vector: m.vector ?? null };
  if (type === 'sound') return { ...base, file: main, narration: m.narration ?? null };
  if (type === 'video') return { ...base, file: main };
  if (type === 'font') return { ...base, file: main, extras: extras ?? {}, family: m.family ?? null, weight: m.weight ?? null, style: m.style ?? null };
  // a sequence is its recipe
  return { ...base, recipe: { bakedFrom: m.bakedFrom ?? null, params: m.params ?? {}, width: m.width, height: m.height, fps: m.fps, duration: m.duration, frames: m.frames } };
}
const hashOf = (material) => sha256(canon(material));

/** @param {any} ctx @param {{ library: any, clips: any, fonts: any }} services @param {{ rebake: (o: any) => Promise<any> }} hooks */
export function createExchange(ctx, { library, clips, fonts }, { rebake }) {
  const { db, dataDir, pool } = ctx;

  // ── reading a library version as an export record ────────────────────────────────────────

  const shaCache = new Map();
  /** SHA-256 of a file of the data dir (remembered while it does not change). */
  async function fileSha(abs) {
    const st = statSync(abs);
    const key = `${abs}|${st.size}|${st.mtimeMs}`;
    let s = shaCache.get(key);
    if (!s) shaCache.set(key, (s = await sha256File(abs)));
    return s;
  }

  /**
   * The files a version keeps in the data dir: the main one, and the ones its meta names next to it (an uploaded SVG's
   * sidecar, a font's licence text).
   * @returns {{ role: string, key: string | null, rel: string, abs: string, suffix: string }[]}
   */
  function filesOf(row) {
    if (!['image', 'sound', 'video', 'font'].includes(row.type)) return [];
    const out = [{ role: 'main', key: null, rel: row.file, abs: library.absFile(row), suffix: extname(row.file) }];
    const own = `files/${row.slug}@${row.version}.`;
    for (const [key, val] of Object.entries(json(row.meta, {}))) {
      if (typeof val === 'string' && val.startsWith(own)) out.push({ role: key, key, rel: val, abs: join(dataDir, val), suffix: val.slice(own.length - 1) });
    }
    return out;
  }

  /** The hash material of a row of this library, reading its files. */
  async function materialOfRow(row) {
    let main = null;
    const extras = {};
    for (const f of filesOf(row)) {
      if (!existsSync(f.abs)) throw new StudioError(`${makeRef(row.slug, row.version)}: its file ${f.rel} is missing from the data dir`, 'not_found');
      const sha = await fileSha(f.abs);
      if (f.role === 'main') main = sha; else extras[f.role] = sha;
    }
    return materialOf({ type: row.type, kind: row.kind, deps: json(row.deps, {}), source: row.type === 'function' ? sha256(row.source ?? '') : null, main, extras, meta: json(row.meta, {}) });
  }

  /** The licence, source and creator a file's provenance gives (meta.provenance, else the older meta.license). */
  function provenanceOf(meta) {
    const p = meta.provenance ?? {};
    return { license: p.license ?? meta.license ?? null, sourceUrl: p.sourceUrl ?? meta.source ?? meta.sourceUrl ?? null, creator: p.creator ?? meta.creator ?? null, redistributable: p.redistributable !== false };
  }

  /** The export record of one version: everything needed to create it again (files over `limit` bytes are not for git). */
  async function recordOf(row, limit = MAX_REPO_FILE) {
    const ref = makeRef(row.slug, row.version);
    const meta = json(row.meta, {});
    const files = filesOf(row);
    const items = [];
    for (const f of files) {
      if (!existsSync(f.abs)) throw new StudioError(`${ref}: its file ${f.rel} is missing from the data dir`, 'not_found');
      items.push({ role: f.role, suffix: f.suffix, sha256: await fileSha(f.abs), bytes: statSync(f.abs).size });
    }
    const prov = provenanceOf(meta);
    const big = items.find((i) => i.bytes > limit);
    const store = !prov.redistributable || big ? 'external' : 'repo';
    const why = store === 'repo' ? undefined : !prov.redistributable ? 'may not be redistributed' : `larger than ${limit / 1e6} MB`;
    const isFn = row.type === 'function';
    const edit = row.meta_by ? { title: row.meta_title ?? undefined, description: row.meta_description ?? undefined, tags: row.meta_tags ? json(row.meta_tags, []) : undefined, uses: row.meta_uses ? json(row.meta_uses, []) : undefined, by: row.meta_by, at: row.meta_at } : undefined;
    const clean = isFn ? undefined : structuredClone(meta);
    if (clean) {
      // thumbnails, filmstrips and waveforms are made again on import; a bake's seconds belong to the machine
      for (const k of ['strip', 'wave', 'bakeSeconds', 'path']) delete clean[k];
      for (const f of files) if (f.key) delete clean[f.key];
    }
    const material = materialOf({ type: row.type, kind: row.kind, deps: json(row.deps, {}), source: isFn ? sha256(row.source ?? '') : null, main: items.find((i) => i.role === 'main')?.sha256 ?? null, extras: Object.fromEntries(items.filter((i) => i.role !== 'main').map((i) => [i.role, i.sha256])), meta });
    return {
      ref, type: row.type, kind: row.kind ?? undefined,
      title: row.title ?? null, description: row.description, tags: json(row.tags, []), duration: row.duration ?? null, formats: json(row.formats, []),
      schema: isFn ? json(row.schema, {}) : undefined, uses: isFn ? json(row.uses, {}) : undefined,
      deps: json(row.deps, {}),
      author: row.author, note: row.note ?? null, created: row.version_created_at, engine: row.engine,
      madeForClip: library.clipSlug(row.clip_id), parent: library.refOfVersionId(row.parent_version),
      asset: { created: row.created_at, originClip: library.clipSlug(row.origin_clip), forkedFrom: library.refOfVersionId(row.forked_from), derivation: row.derivation ?? undefined, edit },
      source: isFn ? { file: `sources/${ref}.js`, sha1: row.source_hash } : undefined,
      mime: row.mime ?? undefined,
      files: items.length ? { store, why, items } : undefined,
      meta: clean,
      hash: hashOf(material),
      // not part of the record: what the clip's file list needs
      _provenance: prov,
    };
  }

  /** The versions a clip needs, as rows: its pinned closure from the library, plus what a baked sequence is baked from. */
  function closureRows(clip) {
    const rows = new Map();
    const queue = db.prepare('SELECT version_id FROM clip_assets WHERE clip_id = (SELECT id FROM clips WHERE slug = ?)').all(clip).map((r) => library.refOfVersionId(r.version_id));
    while (queue.length) {
      const ref = queue.shift();
      if (rows.has(ref)) continue;
      const row = library.requireVersion(ref);
      rows.set(ref, row);
      if (row.type === 'function') queue.push(...Object.values(json(row.deps, {})));
      if (row.type === 'sequence') {
        const m = json(row.meta, {});
        if (m.bakedFrom) {
          queue.push(m.bakedFrom);
          // the recipe's own pinned assets and images
          walkParams(json(library.requireVersion(m.bakedFrom).schema, {}), m.params ?? {}, ['asset', 'image'], (v) => queue.push(v));
        }
      }
    }
    return rows;
  }

  // ── export ───────────────────────────────────────────────────────────────────────────────

  const dirs = (root) => ({ versions: join(root, 'library', 'versions'), sources: join(root, 'library', 'sources'), files: join(root, 'library', 'files') });
  const readIf = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  const extOf = (suffix) => suffix.slice(suffix.lastIndexOf('.') + 1).toLowerCase() || 'bin';

  /** The frames hashed for the check: up to CHECK_FRAMES, spread over the clip. */
  function checkFrames(c) {
    const total = Math.max(1, Math.round(c.duration * c.fps));
    const n = Math.min(CHECK_FRAMES, total);
    return [...new Set(Array.from({ length: n }, (_, i) => Math.min(total - 1, Math.floor(((i + 0.5) * total) / n))))];
  }

  /** SHA-256 of the raw RGBA of some frames of a clip → { <frame>: hash }, drawn in parallel by the render workers. */
  async function drawHashes(slug, frames) {
    const { bundle } = await clips.bundleFor(clips.getClip(slug).composition);
    const out = {};
    const done = await Promise.all(frames.map((frame) => pool.run('clipFrame', { frame, output: 'none', hash: true }, { bundle, timeout: 120000 }).then((r) => [frame, r.hash])));
    for (const [frame, hash] of done) out[frame] = hash;
    return out;
  }

  /**
   * What exporting the clip would write, and the clip.json it leads to (without its check).
   * @param {string} slug @param {{ root: string, force: boolean, limit: number }} o
   */
  async function plan(slug, { root, force, limit }) {
    const clip = clips.getClip(slug);
    const rows = closureRows(slug);
    const store = dirs(root);
    const writes = [], conflicts = [], external = [], filesList = [], closure = [];
    const records = new Map();
    for (const [ref, row] of [...rows].sort(([a], [b]) => refCompare(a, b))) {
      closure.push(ref);
      if (row.type === 'font' && !library.isUploadedFont(row)) {
        const m = json(row.meta, {});
        filesList.push({ ref, store: 'bundled', family: m.family ?? null, license: m.license ?? null });
        continue;
      }
      const rec = await recordOf(row, limit);
      records.set(ref, rec);
      const { _provenance: prov, ...record } = rec;
      // the record: a version file that says something else under the same ref is another library's version
      const versionPath = join(store.versions, `${ref}.json`);
      const old = readIf(versionPath);
      let oldRecord = null;
      try { oldRecord = old === null ? null : JSON.parse(old); } catch { /* unreadable: a conflict below */ }
      // a version's history never changes, so the store's record of the same content wins: a library imported from the repo
      // lacks what a version continues from, or was made for (sparse versions, other clips) and would say less
      if (oldRecord?.hash === record.hash) {
        for (const k of ['author', 'note', 'created', 'engine', 'madeForClip', 'parent']) if (oldRecord[k] !== undefined) record[k] = oldRecord[k];
        for (const k of ['created', 'originClip', 'forkedFrom', 'derivation']) if (oldRecord.asset?.[k] !== undefined) record.asset[k] = oldRecord.asset[k];
      }
      const body = text(record);
      let state = old === null ? 'new' : old === body ? 'same' : 'changed';
      if (old !== null && state === 'changed') {
        const oldHash = oldRecord?.hash ?? null;
        if (oldHash !== record.hash && !force) {
          conflicts.push({ ref, message: `${ref} is in the store with different content (the library's ${ref} was made by ${record.author}${record.note ? `, "${record.note}"` : ''}). Version numbers must agree between the library and the repo: export from a library that was imported from the repo, or pass force to replace the store's ${ref}.` });
          state = 'conflict';
        }
      }
      const versionWrite = { rel: `library/versions/${ref}.json`, path: versionPath, data: body, state, kind: 'version' };
      if (rec.source) {
        const srcPath = join(store.sources, `${ref}.js`);
        const old = readIf(srcPath);
        writes.push({ rel: `library/sources/${ref}.js`, path: srcPath, data: row.source, state: old === null ? 'new' : old === row.source ? 'same' : 'changed', kind: 'source' });
      }
      for (const item of rec.files?.items ?? []) {
        const ext = extOf(item.suffix);
        const entry = { ref, ...(item.role === 'main' ? {} : { role: item.role }), sha256: item.sha256, bytes: item.bytes, ext, store: rec.files.store, license: prov.license, sourceUrl: prov.sourceUrl, creator: prov.creator, ...(rec.files.why ? { why: rec.files.why } : {}) };
        filesList.push(entry);
        if (rec.files.store === 'external') { external.push(entry); continue; }
        const path = join(store.files, `${item.sha256}.${ext}`);
        const have = existsSync(path);
        if (have && statSync(path).size !== item.bytes) { conflicts.push({ ref, message: `library/files/${item.sha256}.${ext} in the store is ${statSync(path).size} bytes, not ${item.bytes}: it is damaged; delete it and export again.` }); continue; }
        const source = filesOf(rows.get(ref)).find((f) => f.role === item.role).abs;
        writes.push({ rel: `library/files/${item.sha256}.${ext}`, path, copyFrom: source, state: have ? 'same' : 'new', kind: 'file' });
      }
      // the record last: it never names a file or a source that is not in the store yet
      writes.push(versionWrite);
    }
    filesList.sort((a, b) => refCompare(a.ref, b.ref) || String(a.role ?? '').localeCompare(String(b.role ?? '')));
    const doc = {
      slug: clip.slug, title: clip.title, description: clip.description,
      format: clip.format, width: clip.width, height: clip.height, fps: clip.fps, duration: clip.duration,
      composition: clip.composition,
      closure, files: filesList,
    };
    return { clip, doc, writes, conflicts, external, records };
  }

  /**
   * Export a clip: write clips/<slug>/clip.json and add to library/ what the store lacks. Nothing in the store is deleted
   * or replaced by something else (another clip may use it): a ref the store has with different content is a conflict that
   * stops the export before anything is written, unless force. The frame hashes are drawn again only when something that
   * decides them changed (frames: false never draws).
   * @param {string} slug @param {{ root?: string, frames?: boolean, force?: boolean, dryRun?: boolean, maxFileBytes?: number }} [o]
   */
  async function exportClip(slug, { root = repoRoot(), frames = true, force = false, dryRun = false, maxFileBytes = MAX_REPO_FILE } = {}) {
    root = resolve(root);
    const p = await plan(slug, { root, force, limit: maxFileBytes });
    const folder = join(root, 'clips', slug);
    const clipPath = join(folder, 'clip.json');
    if (p.conflicts.length && !dryRun) throw new StudioError(`Nothing was written. The store already has other content under these refs:\n- ${p.conflicts.map((c) => c.message).join('\n- ')}`, 'conflict', { conflicts: p.conflicts });

    // the check: frames hashed on this machine, reused while nothing that draws them has changed
    let old = null;
    try { old = JSON.parse(readIf(clipPath) ?? 'null'); } catch { /* damaged: written again */ }
    const wanted = checkFrames(p.doc);
    const core = (d) => canon({ ...d, check: undefined });
    const current = old && old.check && old.check.machine === machineId() && old.check.engine === ENGINE_VERSION && core(old) === core(p.doc) && same(Object.keys(old.check.frames ?? {}).map(Number).sort((a, b) => a - b), wanted);
    let check;
    if (current) check = old.check;
    else if (frames && !dryRun) check = { machine: machineId(), engine: ENGINE_VERSION, frames: await drawHashes(slug, wanted) };
    else check = { machine: machineId(), engine: ENGINE_VERSION, frames: {} };
    const doc = { ...p.doc, check };
    const body = text(doc);
    const clipState = old === null ? 'new' : readIf(clipPath) === body ? 'same' : 'changed';
    const writes = [...p.writes, { rel: `clips/${slug}/clip.json`, path: clipPath, data: body, state: clipState, kind: 'clip' }];
    const changes = writes.filter((w) => w.state !== 'same' && w.state !== 'conflict');

    if (!dryRun) {
      // the store first, the clip's file last: a clip.json never points at what is not there yet
      for (const w of writes) {
        if (w.state === 'same' || w.state === 'conflict') continue;
        mkdirSync(dirname(w.path), { recursive: true });
        const tmp = `${w.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
        if (w.copyFrom) copyFileSync(w.copyFrom, tmp); else writeFileSync(tmp, w.data);
        renameRetry(tmp, w.path);
      }
    }
    const list = (state) => writes.filter((w) => w.state === state).map((w) => w.rel);
    return {
      clip: slug, root, folder,
      upToDate: !changes.length && !p.conflicts.length,
      versions: p.records.size, closure: p.doc.closure.length,
      wrote: dryRun ? [] : changes.map((w) => w.rel),
      new: list('new'), changed: list('changed'), unchanged: writes.filter((w) => w.state === 'same').length,
      conflicts: p.conflicts,
      external: p.external.map(({ ref, role, sha256: sha, bytes, ext, store, license, sourceUrl, creator, why }) => ({ ref, role, sha256: sha, bytes, ext, store, license, sourceUrl, creator, why })),
      check: { state: current ? 'current' : dryRun || !frames ? (old?.check ? 'stale' : 'missing') : 'drawn', machine: check.machine, frames: Object.keys(check.frames).length },
    };
  }

  /** What an export would write and whether the clip's folder is up to date, without writing or drawing anything. @param {string} slug @param {{ root?: string, force?: boolean }} [o] */
  const status = (slug, { root, force } = {}) => exportClip(slug, { root, force, dryRun: true });

  // ── import ───────────────────────────────────────────────────────────────────────────────

  /** Where the store is for a clip folder: the given root, the folder's repo (clips/<slug> under a root with library/), or this checkout. */
  function storeRootFor(folder, root) {
    const candidates = [root, dirname(dirname(folder)), repoRoot()].filter(Boolean).map((r) => resolve(r));
    const found = candidates.find((r) => existsSync(join(r, 'library', 'versions')));
    if (!found) throw new StudioError(`No library/ folder next to the clip's folder (looked in ${[...new Set(candidates)].join(', ')}). The folder must sit in clips/ of a repo that has library/ (or give root).`, 'not_found');
    return found;
  }

  /** Find files by SHA-256 in some folders (a few levels down): the ones of a size we are looking for are hashed. → Map(sha256 → path) */
  async function findFiles(searchDirs, wanted) {
    const found = new Map();
    const bySize = new Map();
    for (const w of wanted) bySize.set(w.bytes, [...(bySize.get(w.bytes) ?? []), w.sha256]);
    const seen = new Set();
    const walk = async (dir, depth) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const path = join(dir, e.name);
        if (e.isDirectory()) { if (depth < 4 && e.name !== 'node_modules' && e.name !== '.git') await walk(path, depth + 1); continue; }
        if (!e.isFile() || seen.has(path)) continue;
        seen.add(path);
        const shas = bySize.get(statSync(path).size);
        if (!shas || shas.every((s) => found.has(s))) continue;
        const sha = await sha256File(path);
        if (shas.includes(sha) && !found.has(sha)) found.set(sha, path);
      }
    };
    for (const d of searchDirs) await walk(resolve(d), 0);
    return found;
  }

  const versionId = (ref) => db.prepare('SELECT v.id FROM asset_versions v JOIN assets a ON a.id = v.asset_id WHERE a.slug = ? AND v.version = ?').get(parseRef(ref).slug, parseRef(ref).version)?.id ?? null;

  /**
   * Create the exported clip in this library, with every version of its closure at its exact number, in dependency order.
   * Everything is checked first (a different version under a number, a file that is missing, a clip of that name): when
   * anything is wrong the problems are all listed and nothing is written. Then the files are copied under temp names, the
   * function versions are compiled and drawn by the render workers (the engine must read them as the export says), and
   * all rows are written in one transaction; baked sequences are baked again from their recipe afterwards, one by one;
   * the clip comes last. Versions the library already has with the same content are reused.
   * @param {string} folder @param {{ files?: string[] | string, replace?: boolean, verify?: boolean, author?: string, root?: string }} [o]
   */
  async function importClip(folder, { files: searchIn = [], replace = false, verify = false, author = 'import', root } = {}) {
    const dir = resolve(folder);
    const docPath = join(dir, 'clip.json');
    if (!existsSync(docPath)) throw new StudioError(`No clip.json in ${dir}: give a clip's folder (clips/<name>).`, 'not_found');
    let doc;
    try { doc = JSON.parse(readFileSync(docPath, 'utf8')); } catch (e) { throw new StudioError(`${docPath} is not valid JSON: ${e.message}`); }
    if (!doc || !SLUG_RE.test(doc.slug ?? '') || !doc.composition || typeof doc.composition !== 'object' || !Array.isArray(doc.closure)) throw new StudioError(`${docPath} is not a clip export: it needs slug, composition and closure`);
    const store = dirs(storeRootFor(dir, root));
    const searchDirs = (Array.isArray(searchIn) ? searchIn : [searchIn]).filter(Boolean);
    const bundled = new Set((doc.files ?? []).filter((f) => f.store === 'bundled').map((f) => f.ref));

    // 1. read the records of the store
    const problems = [], conflicts = [];
    /** @type {Map<string, any>} */
    const incoming = new Map();
    for (const ref of [...doc.closure].sort(refCompare)) {
      try { parseRef(ref); } catch (e) { problems.push(e.message); continue; }
      if (bundled.has(ref)) {
        if (!library.versionRow(ref)) problems.push(`${ref} is a font bundled with the studio, and this checkout does not have it (fonts/).`);
        continue;
      }
      const recPath = join(store.versions, `${ref}.json`);
      const raw = readIf(recPath);
      if (raw === null) { problems.push(`The store has no record of ${ref} (library/versions/${ref}.json). Was the clip exported from a library the repo has since lost, or is the store incomplete?`); continue; }
      let rec;
      try { rec = JSON.parse(raw); } catch (e) { problems.push(`library/versions/${ref}.json is not valid JSON: ${e.message}`); continue; }
      // a record names files by SHA-256 and suffix, which become names in the data dir: nothing else may get through
      const items0 = rec.files?.items ?? [];
      const wrong = rec.ref !== ref ? `it says it is ${rec.ref}`
        : !TYPES.includes(rec.type) ? `type "${rec.type}" is not one of ${TYPES.join(', ')}`
          : !Array.isArray(items0) || items0.some((i) => !/^[0-9a-f]{64}$/.test(i?.sha256) || !/^(\.[a-z0-9]+)+$/i.test(i?.suffix) || !/^[A-Za-z][A-Za-z0-9]*$/.test(i?.role) || !Number.isInteger(i?.bytes)) ? 'its files are listed wrongly'
            : items0.length && !['repo', 'external'].includes(rec.files.store) ? `its files are in "${rec.files.store}", not repo or external`
              : null;
      if (wrong) { problems.push(`library/versions/${ref}.json is not a version record: ${wrong}.`); continue; }
      let sourceText = null;
      if (rec.type === 'function') {
        sourceText = readIf(join(store.sources, `${ref}.js`));
        if (sourceText === null) { problems.push(`The store has no source for ${ref} (library/sources/${ref}.js).`); continue; }
        if (sha1(sourceText) !== rec.source?.sha1) { problems.push(`library/sources/${ref}.js does not match its record (the record says ${rec.source?.sha1}, the file is ${sha1(sourceText)}): it was edited by hand.`); continue; }
      }
      const items = rec.files?.items ?? [];
      const material = materialOf({ type: rec.type, kind: rec.kind, deps: rec.deps, source: sourceText === null ? null : sha256(sourceText), main: items.find((i) => i.role === 'main')?.sha256 ?? null, extras: Object.fromEntries(items.filter((i) => i.role !== 'main').map((i) => [i.role, i.sha256])), meta: rec.meta });
      if (hashOf(material) !== rec.hash) { problems.push(`${ref}: its record does not match its content hash (${rec.hash}): the file in library/versions/ was edited by hand.`); continue; }
      incoming.set(ref, { ref, rec, source: sourceText, items });
    }

    // 2. what the library has: reuse the same, name the different
    for (const [ref, item] of incoming) {
      const { slug } = parseRef(ref);
      const asset = db.prepare('SELECT type FROM assets WHERE slug = ?').get(slug);
      if (asset && asset.type !== item.rec.type) { conflicts.push(`${ref} is a ${item.rec.type} asset in the export, but this library has "${slug}" as a ${asset.type} asset.`); continue; }
      const row = library.versionRow(ref);
      if (!row) { item.create = true; continue; }
      let h;
      try { h = hashOf(await materialOfRow(row)); } catch (e) { conflicts.push(`${ref} is in this library but cannot be compared: ${e.message}`); continue; }
      if (h === item.rec.hash) item.reuse = true;
      else conflicts.push(`${ref} is already in this library with different content (this library's ${ref}: ${row.author}${row.note ? `, "${row.note}"` : ''}, ${row.version_created_at}; the export's: ${item.rec.author}${item.rec.note ? `, "${item.rec.note}"` : ''}, ${item.rec.created}). Version numbers must agree: import into an empty data dir, or into a library made from the same repo.`);
    }
    const existingClip = db.prepare('SELECT id FROM clips WHERE slug = ?').get(doc.slug);
    if (existingClip && !replace) conflicts.push(`A clip named "${doc.slug}" already exists in this library. Pass replace to update it from the export.`);

    // 3. the files the versions to create need: the store has them, or the folders given, or they are missing
    const need = [];
    for (const item of incoming.values()) if (item.create) for (const f of item.items) need.push({ item, f });
    const external = need.filter(({ item }) => item.rec.files.store === 'external');
    const located = external.length ? await findFiles(searchDirs, external.map(({ f }) => f)) : new Map();
    for (const { item, f } of need) {
      const ext = extOf(f.suffix);
      f.from = null;
      if (item.rec.files.store === 'repo') {
        const path = join(store.files, `${f.sha256}.${ext}`);
        if (existsSync(path)) f.from = path;
        else problems.push(`${item.ref}: the store has no library/files/${f.sha256}.${ext} (${mb(f.bytes)}). Pull the repo again, or export the clip again from the library that has the file.`);
      } else {
        f.from = located.get(f.sha256) ?? null;
        if (!f.from) {
          const g = (doc.files ?? []).find((x) => x.ref === item.ref && x.sha256 === f.sha256) ?? {};
          problems.push(`${item.ref}: the file ${f.sha256} (${mb(f.bytes)}${g.license ? `, licence ${g.license}` : ''}${g.creator ? `, by ${g.creator}` : ''}) is not in the repo (${item.rec.files.why ?? 'external'}).${g.sourceUrl ? ` Source: ${g.sourceUrl}.` : ''} Put it in a folder and pass the folder as files (CLI: --files <folder>); it is found by its SHA-256, whatever it is called.`);
        }
      }
    }
    if (conflicts.length || problems.length) {
      const all = [...conflicts, ...problems];
      throw new StudioError(`Nothing was imported. ${all.length === 1 ? 'One problem' : `${all.length} problems`}:\n- ${all.join('\n- ')}`, conflicts.length ? 'conflict' : 'not_found', { conflicts, missing: problems });
    }

    // 4. the order: dependencies, then what a version continues from
    const create = [...incoming.values()].filter((i) => i.create);
    const toCreate = new Set(create.map((i) => i.ref));
    const sequences = create.filter((i) => i.rec.type === 'sequence').map((i) => i.ref).sort(refCompare);
    const others = new Set(create.filter((i) => i.rec.type !== 'sequence').map((i) => i.ref));
    const ordered = [];
    const state = new Map();
    const visit = (ref, path) => {
      if (state.get(ref) === 2 || !others.has(ref)) return;
      if (state.get(ref) === 1) throw new StudioError(`The export has a dependency cycle: ${[...path, ref].join(' → ')}`);
      state.set(ref, 1);
      const r = incoming.get(ref).rec;
      for (const d of [...Object.values(r.deps ?? {}), r.parent, r.asset?.forkedFrom]) if (d) visit(d, [...path, ref]);
      state.set(ref, 2);
      ordered.push(ref);
    };
    [...others].sort(refCompare).forEach((r) => visit(r, []));

    // 5. stage the files under temp names, then compile and draw
    const temps = [];
    const tmpPath = (rel) => { const t = join(dataDir, tempOf(rel)); temps.push(t); return t; };
    const derived = new Map();   // ref → { files: [{ rel, tmp }], thumb: { rel, tmp }|null, row: columns }
    const rowInfo = (ref) => {
      if (!ref) return null;
      const i = incoming.get(ref);
      if (i) return { slug: parseRef(ref).slug, version: parseRef(ref).version, type: i.rec.type, kind: i.rec.kind ?? null };
      return library.versionRow(ref);
    };
    /** What a draw of a function version being created needs: the sources and images of its closure, from the export or from this library. */
    const gather = (refs) => {
      const assets = {}, images = {};
      const seen = new Set();
      const walk = (ref) => {
        if (seen.has(ref)) return;
        seen.add(ref);
        const i = incoming.get(ref);
        if (i && toCreate.has(ref)) {
          if (i.rec.type === 'function') { assets[ref] = { source: i.source, deps: i.rec.deps }; for (const d of new Set(Object.values(i.rec.deps))) walk(d); }
          else if (i.rec.type === 'image') images[ref] = { path: derived.get(ref).files.find((f) => f.role === 'main').tmp, vector: i.rec.meta?.vector ?? null };
        } else {
          const c = library.closure([ref]);
          Object.assign(assets, c.assets);
          Object.assign(images, c.images);
        }
      };
      refs.forEach(walk);
      return { assets, images };
    };
    // one transaction for every row (below); the files move in afterwards, as the library's own writes do
    const newAssets = new Map();   // slug → the clip it began with
    const insertVersion = (ref, d) => {
      const { rec } = incoming.get(ref);
      const { slug, version } = parseRef(ref);
      const at = rec.created ?? now();
      let asset = db.prepare('SELECT id FROM assets WHERE slug = ?').get(slug);
      if (!asset) {
        const e = rec.asset?.edit ?? {};
        const forkedFrom = rec.asset?.forkedFrom ? versionId(rec.asset.forkedFrom) : null;
        newAssets.set(slug, rec.asset?.originClip ?? null);
        asset = { id: db.prepare('INSERT INTO assets (slug, type, latest_version, forked_from, created_at, derivation, meta_title, meta_description, meta_tags, meta_by, meta_at, meta_uses) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(slug, rec.type, forkedFrom, rec.asset?.created ?? at, rec.asset?.derivation ?? null, e.title ?? null, e.description ?? null, e.tags ? JSON.stringify(e.tags) : null, e.by ?? null, e.at ?? null, e.uses ? JSON.stringify(e.uses) : null).lastInsertRowid };
      }
      const r = d.row;
      const parent = rec.parent ? versionId(rec.parent) : null;
      const vid = db.prepare(`INSERT INTO asset_versions (asset_id, version, kind, title, description, tags, duration, formats, schema, uses, deps, source, source_hash, file, mime, meta, thumb, author, note, parent_version, clip_id, engine, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
        asset.id, version, r.kind ?? null, r.title ?? null, r.description, JSON.stringify(r.tags ?? []), r.duration ?? null, JSON.stringify(r.formats ?? []), JSON.stringify(r.schema ?? {}), JSON.stringify(r.uses ?? {}), JSON.stringify(r.deps ?? {}),
        r.source ?? null, r.source_hash ?? null, r.file ?? null, rec.mime ?? null, JSON.stringify(r.meta ?? {}), d.thumb?.rel ?? null, rec.author, rec.note ?? null, parent, rec.engine ?? ENGINE_VERSION, at).lastInsertRowid;
      for (const [alias, dep] of Object.entries(r.deps ?? {})) db.prepare('INSERT INTO asset_deps (version_id, dep_version_id, alias) VALUES (?, ?, ?)').run(vid, versionId(dep), alias);
      db.prepare('UPDATE assets SET latest_version = MAX(latest_version, ?) WHERE id = ?').run(version, asset.id);
      library.reindexLatest(asset.id);
      ctx.events?.emit('asset', slug, version === 1 ? 'created' : 'version', { ref, author: rec.author, type: rec.type, imported: doc.slug });
    };
    try {
      for (const ref of [...ordered]) {
        const { slug, version } = parseRef(ref);
        const d = { files: [], thumb: null, strip: null, wave: null, row: {} };
        derived.set(ref, d);
        for (const f of incoming.get(ref).items) {
          const rel = `files/${slug}@${version}${f.suffix}`;
          const tmp = tmpPath(rel);
          copyFileSync(f.from, tmp);
          if ((await sha256File(tmp)) !== f.sha256) throw new StudioError(`${ref}: ${f.from} does not hold the file the export lists (SHA-256 ${f.sha256}); it is damaged or another file.`, 'rejected');
          d.files.push({ role: f.role, rel, tmp, key: f.role === 'main' ? null : f.role });
        }
      }
      for (const ref of ordered) {
        const { rec, source } = incoming.get(ref);
        const { slug, version } = parseRef(ref);
        const d = derived.get(ref);
        const main = d.files.find((f) => f.role === 'main');
        const thumbRel = `thumbs/${slug}@${version}.png`;
        if (rec.type === 'function') {
          const v = await library.validate({ slug, version, source, exact: { deps: rec.deps, row: rowInfo, closure: gather } });
          const differ = [['kind', v.meta.kind, rec.kind], ['schema', v.meta.schema, rec.schema], ['uses', v.meta.uses, rec.uses], ['dependencies', v.deps, rec.deps]].filter(([, a, b]) => !same(a, b)).map(([n]) => n);
          if (differ.length) throw new StudioError(`${ref} compiles differently here than in the library that exported it (${differ.join(', ')}): this engine reads the source another way. Nothing was imported. Export the clip again with this build, or use the build that exported it.`, 'rejected');
          d.thumb = { rel: thumbRel, tmp: tmpPath(thumbRel) };
          writeFileSync(d.thumb.tmp, v.thumb);
          let meta = { test: v.frames, warnings: v.warnings };
          if (v.strip) {
            const stripRel = `thumbs/${slug}@${version}.strip.png`;
            d.strip = { rel: stripRel, tmp: tmpPath(stripRel) };
            writeFileSync(d.strip.tmp, v.strip);
            meta = { ...meta, strip: { file: stripRel, frames: 8 } };
          }
          d.row = { kind: v.meta.kind, title: v.meta.title, description: v.meta.description, tags: v.meta.tags, duration: v.meta.duration, formats: v.meta.formats, schema: v.meta.schema, uses: v.meta.uses, deps: v.deps, source, source_hash: sha1(source), meta };
        } else {
          const meta = { ...rec.meta };
          for (const f of d.files) if (f.key) meta[f.key] = f.rel;
          d.row = { kind: null, title: rec.title, description: rec.description, tags: rec.tags, duration: rec.duration, formats: rec.formats, schema: {}, uses: {}, deps: {}, source: null, source_hash: null, file: main.rel, meta };
          if (rec.type === 'image') {
            d.thumb = { rel: thumbRel, tmp: tmpPath(thumbRel) };
            writeFileSync(d.thumb.tmp, imageThumbPng(await loadImage(main.tmp)));
          } else if (rec.type === 'video') {
            const out = { thumb: tmpPath(thumbRel), strip: tmpPath(`thumbs/${slug}@${version}.strip.png`), wave: tmpPath(`thumbs/${slug}@${version}.wave.png`) };
            const hasWave = await footageStills(rec.meta, main.tmp, out);
            await footageService().release(main.tmp);
            d.thumb = { rel: thumbRel, tmp: out.thumb };
            d.strip = { rel: `thumbs/${slug}@${version}.strip.png`, tmp: out.strip };
            if (hasWave) d.wave = { rel: `thumbs/${slug}@${version}.wave.png`, tmp: out.wave };
            d.row.meta = { ...meta, strip: { file: d.strip.rel, frames: 8 }, wave: hasWave ? { file: d.wave.rel } : undefined };
          } else if (rec.type === 'font') {
            d.thumb = { rel: thumbRel, tmp: tmpPath(thumbRel) };
            writeFileSync(d.thumb.tmp, fonts.specimen(main.tmp, rec.meta.sha256 ?? main.sha256 ?? sha256(readFileSync(main.tmp)), { family: rec.meta.family, weight: rec.meta.weight, style: rec.meta.style, license: rec.meta.license, covers: rec.meta.coverage?.romanian }));
          }
        }
      }

      if (ordered.length) {
        transaction(db, () => { for (const ref of ordered) insertVersion(ref, derived.get(ref)); });
        // committed: the staged files take their names (nobody has seen them under these names before)
        for (const ref of ordered) {
          const d = derived.get(ref);
          for (const f of d.files) renameRetry(f.tmp, join(dataDir, f.rel));
          for (const t of [d.thumb, d.strip, d.wave]) if (t) renameRetry(t.tmp, join(dataDir, t.rel));
        }
      }
      temps.length = 0;
    } catch (e) {
      for (const t of temps) rmSync(t, { force: true, recursive: true });
      throw e;
    }

    // 7. baked sequences: baked again from the recipe, now that what they bake is in the library
    const rebaked = [];
    for (const ref of sequences) {
      const { rec } = incoming.get(ref);
      const { slug, version } = parseRef(ref);
      const m = rec.meta;
      const baked = await rebake({ ref: m.bakedFrom, params: m.params ?? {}, width: m.width, height: m.height, fps: m.fps, duration: m.duration });
      const file = `files/${slug}@${version}`, thumb = `thumbs/${slug}@${version}.png`;
      const thumbTmp = join(dataDir, tempOf(thumb));
      try {
        const count = readdirSync(baked.dir).length;
        if (count !== m.frames) throw new StudioError(`${ref}: baking ${m.bakedFrom} gave ${count} frames, the export has ${m.frames}: this engine does not draw it as the exporting one did.`, 'rejected');
        writeFileSync(thumbTmp, baked.thumb);
        const d = { files: [], thumb: { rel: thumb }, row: { kind: null, title: rec.title, description: rec.description, tags: rec.tags, duration: rec.duration, formats: [], schema: {}, uses: {}, deps: {}, source: null, source_hash: null, file, meta: { ...m, bakeSeconds: baked.seconds } } };
        transaction(db, () => {
          insertVersion(ref, d);
          renameRetry(thumbTmp, join(dataDir, thumb));
          renameRetry(baked.dir, join(dataDir, file));
        });
        rebaked.push(ref);
      } catch (e) {
        rmSync(thumbTmp, { force: true });
        rmSync(baked.dir, { recursive: true, force: true });
        throw e;
      }
    }

    // 8. the clip: the composition as exported, pinned to the versions just made
    // (the studio's own save pins and normalises it once more; it must come out as it went in, and is kept exactly as exported)
    if (!same(clips.prepare(doc.composition).composition, doc.composition)) throw new StudioError(`The composition of ${doc.slug} does not come back the same from this library (the versions were imported; the clip was not): the engine reads it differently than the library that exported it.`, 'rejected');
    let result;
    const fields = { title: doc.title, description: doc.description ?? '', composition: doc.composition, check: false };
    if (existingClip) result = await clips.updateClip(doc.slug, { ...fields, by: 'import' });
    else result = await clips.createClip({ slug: doc.slug, author, ...fields });
    db.prepare('UPDATE clips SET composition = ? WHERE slug = ?').run(JSON.stringify(doc.composition), doc.slug);
    // what was made for this clip, or began with it, says so again
    transaction(db, () => {
      for (const ref of toCreate) {
        const { rec } = incoming.get(ref);
        const made = rec.madeForClip && db.prepare('SELECT id FROM clips WHERE slug = ?').get(rec.madeForClip);
        if (made) db.prepare('UPDATE asset_versions SET clip_id = ? WHERE id = ? AND clip_id IS NULL').run(made.id, versionId(ref));
      }
      for (const [slug, originClip] of newAssets) {
        const origin = originClip && db.prepare('SELECT id FROM clips WHERE slug = ?').get(originClip);
        if (origin) db.prepare('UPDATE assets SET origin_clip = ? WHERE slug = ?').run(origin.id, slug);
      }
    });

    const out = {
      clip: doc.slug, replaced: !!existingClip, revision: result.clip.revision,
      versions: { created: [...toCreate].sort(refCompare), reused: [...incoming.values()].filter((i) => i.reuse).map((i) => i.ref).sort(refCompare), bundled: [...bundled].sort(refCompare) },
      rebaked, copied: need.length, external: external.length,
    };
    if (verify) out.verify = await verifyClip(doc.slug, doc.check);
    return out;
  }

  /**
   * Draw the frames an export hashed and compare. → { checked, same, differ: [{ frame, expected, got }], machine: { exported, here, same } }.
   * @param {string} slug @param {{ machine?: string, frames?: Record<string, string> } | undefined} check
   */
  async function verifyClip(slug, check) {
    const expected = check?.frames ?? {};
    const frames = Object.keys(expected).map(Number).sort((a, b) => a - b);
    const got = frames.length ? await drawHashes(slug, frames) : {};
    const differ = frames.filter((f) => got[f] !== expected[f]).map((f) => ({ frame: f, expected: expected[f], got: got[f] }));
    return { checked: frames.length, same: frames.length - differ.length, differ, machine: { exported: check?.machine ?? null, here: machineId(), same: check?.machine === machineId() } };
  }

  return { exportClip, status, importClip, verifyClip, repoRoot };
}
