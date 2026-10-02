// The asset library: versioned, immutable assets in SQLite. Function assets are validated in a
// render worker (compiled, test frames drawn, determinism checked) before a version is accepted.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ENGINE_VERSION, FORMATS, makeRef, parseRef } from '../core/engine.js';
import { staticCheck } from '../core/static-check.js';
import { walkParams } from '../core/schema.js';
import { createCanvas, fontManifest, loadImage, registerFonts, FONTS_DIR } from '../render/host.js';
import { probeSummary } from '../render/ffmpeg.js';
import { json, now, transaction } from '../db/db.js';

export class StudioError extends Error {
  /** code: invalid | not_found | conflict | rejected */
  /** @param {string} message @param {string} [code] @param {any} [details] */
  constructor(message, code = 'invalid', details = undefined) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.details = details;
  }
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** A sibling temp name for a data-relative path: files are written there and renamed once the row exists. */
const tempOf = (rel) => { const i = rel.lastIndexOf('/'); return `${rel.slice(0, i + 1)}.tmp-${randomBytes(6).toString('hex')}-${rel.slice(i + 1)}`; };

/** Two writers racing for the same name or version: say so, instead of a raw SQLite error. */
const raceOf = (e, slug) => (/UNIQUE constraint/i.test(String(e?.message)) ? new StudioError(`"${slug}" was saved by someone else at the same moment; try again.`, 'conflict') : e);

const VERSION_COLS = `v.id AS version_id, v.version, v.kind, v.title, v.description, v.tags, v.duration, v.formats, v.schema, v.uses, v.deps,
  v.source, v.source_hash, v.file, v.mime, v.meta, v.thumb, v.author, v.note, v.parent_version, v.clip_id, v.engine, v.created_at AS version_created_at,
  a.id AS asset_id, a.slug, a.type, a.latest_version, a.forked_from, a.origin_clip, a.created_at`;

export function createLibrary(ctx) {
  const { db, dataDir, pool } = ctx;
  const stmts = new Map();
  const q = (sql) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };
  for (const d of ['files', 'thumbs']) mkdirSync(join(dataDir, d), { recursive: true });

  // ── lookups ──────────────────────────────────────────────────────────────────────────────

  const clipBySlug = (slug) => q('SELECT * FROM clips WHERE slug = ?').get(slug);
  const clipSlug = (id) => (id ? q('SELECT slug FROM clips WHERE id = ?').get(id)?.slug ?? null : null);
  const refOfVersionId = (id) => {
    if (!id) return null;
    const r = q('SELECT a.slug, v.version FROM asset_versions v JOIN assets a ON a.id = v.asset_id WHERE v.id = ?').get(id);
    return r ? makeRef(r.slug, r.version) : null;
  };

  /** The version row for "slug" (latest) or "slug@n". Returns undefined when missing. */
  function versionRow(ref) {
    const { slug, version } = parseRef(ref);
    return version === null
      ? q(`SELECT ${VERSION_COLS} FROM assets a JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version WHERE a.slug = ?`).get(slug)
      : q(`SELECT ${VERSION_COLS} FROM assets a JOIN asset_versions v ON v.asset_id = a.id WHERE a.slug = ? AND v.version = ?`).get(slug, version);
  }

  function requireVersion(ref) {
    let row;
    try { row = versionRow(ref); } catch (e) { throw new StudioError(e.message); }
    if (!row) {
      const { slug, version } = parseRef(ref);
      const asset = q('SELECT latest_version FROM assets WHERE slug = ?').get(slug);
      throw new StudioError(asset ? `Asset "${slug}" has no version ${version} (latest is ${asset.latest_version})` : `No asset named "${slug}" in the library. Use search_assets to find what exists.`, 'not_found');
    }
    return row;
  }

  const absFile = (row) => (row.type === 'font' ? join(FONTS_DIR, row.file) : join(dataDir, row.file));

  function summary(row) {
    return {
      slug: row.slug,
      ref: makeRef(row.slug, row.version),
      type: row.type,
      kind: row.kind,
      version: row.version,
      latestVersion: row.latest_version,
      title: row.title ?? row.slug,
      description: row.description,
      tags: json(row.tags, []),
      formats: json(row.formats, []),
      duration: row.duration,
      author: row.author,
      params: Object.keys(json(row.schema, {})),
      originClip: clipSlug(row.origin_clip),
      forkedFrom: refOfVersionId(row.forked_from),
      thumb: row.thumb,
      createdAt: row.created_at,
      versionCreatedAt: row.version_created_at,
      usedByClips: q('SELECT COUNT(DISTINCT ca.clip_id) AS n FROM clip_assets ca JOIN asset_versions v ON v.id = ca.version_id WHERE v.asset_id = ?').get(row.asset_id).n,
    };
  }

  /** Everything about one version: source, schema, pinned deps, history, lineage and usage. */
  /** @param {string} ref @param {{ includeSource?: boolean }} [o] */
  function getAsset(ref, { includeSource = true } = {}) {
    const row = requireVersion(ref);
    const versions = q('SELECT v.version, v.author, v.note, v.created_at, v.clip_id, v.source_hash FROM asset_versions v WHERE v.asset_id = ? ORDER BY v.version').all(row.asset_id);
    const usedBy = q(`SELECT c.slug AS clip, c.title, v.version, ca.direct, ca.depth FROM clip_assets ca
      JOIN asset_versions v ON v.id = ca.version_id JOIN clips c ON c.id = ca.clip_id WHERE v.asset_id = ? ORDER BY c.id, v.version`).all(row.asset_id);
    const dependents = q(`SELECT DISTINCT a.slug, v.version FROM asset_deps d JOIN asset_versions v ON v.id = d.version_id JOIN assets a ON a.id = v.asset_id
      JOIN asset_versions dv ON dv.id = d.dep_version_id WHERE dv.asset_id = ? ORDER BY a.slug, v.version`).all(row.asset_id);
    const forks = q('SELECT a.slug FROM assets a JOIN asset_versions fv ON fv.id = a.forked_from WHERE fv.asset_id = ? ORDER BY a.id').all(row.asset_id);
    return {
      ...summary(row),
      schema: json(row.schema, {}),
      uses: json(row.uses, {}),
      deps: json(row.deps, {}),
      meta: json(row.meta, {}),
      note: row.note,
      engine: row.engine,
      madeForClip: clipSlug(row.clip_id),
      parentVersion: refOfVersionId(row.parent_version),
      source: includeSource ? row.source : undefined,
      sourceHash: row.source_hash,
      file: row.file,
      mime: row.mime,
      versions: versions.map((v) => ({ version: v.version, ref: makeRef(row.slug, v.version), author: v.author, note: v.note, createdAt: v.created_at, madeForClip: clipSlug(v.clip_id), sourceHash: v.source_hash })),
      usedBy: usedBy.map((u) => ({ clip: u.clip, title: u.title, version: u.version, direct: !!u.direct, depth: u.depth })),
      dependents: dependents.map((d) => makeRef(d.slug, d.version)),
      forks: forks.map((x) => x.slug),
    };
  }

  /**
   * Search the library. Every filter is optional:
   * query (full text), type, kind, tags (all must match), format, originClip, usedByClip, derivedFrom, author.
   * @param {any} [o]
   */
  function search({ query, type, kind, tags, format, originClip, usedByClip, derivedFrom, author, limit = 50, offset = 0 } = {}) {
    const where = [], args = [];
    let from = 'assets a JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version';
    let order = 'a.id DESC';
    const tokens = typeof query === 'string' ? query.toLowerCase().match(/[\p{L}\p{N}]+/gu) : null;
    if (tokens?.length) {
      from += ' JOIN assets_fts ON assets_fts.rowid = a.id';
      where.push('assets_fts MATCH ?');
      args.push(tokens.map((t) => `"${t}"*`).join(' '));
      order = 'bm25(assets_fts, 10.0, 6.0, 3.0, 6.0, 0.5), a.id DESC';
    }
    if (type) { where.push('a.type = ?'); args.push(type); }
    if (kind) { where.push('v.kind = ?'); args.push(kind); }
    for (const tag of tags ?? []) { where.push('EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)'); args.push(tag); }
    if (format) { where.push("(v.formats = '[]' OR EXISTS (SELECT 1 FROM json_each(v.formats) WHERE value = ?))"); args.push(format); }
    if (originClip) { where.push('a.origin_clip = (SELECT id FROM clips WHERE slug = ?)'); args.push(originClip); }
    if (usedByClip) { where.push('EXISTS (SELECT 1 FROM clip_assets ca JOIN asset_versions cv ON cv.id = ca.version_id WHERE cv.asset_id = a.id AND ca.clip_id = (SELECT id FROM clips WHERE slug = ?))'); args.push(usedByClip); }
    if (derivedFrom) { where.push('a.forked_from IN (SELECT fv.id FROM asset_versions fv JOIN assets fa ON fa.id = fv.asset_id WHERE fa.slug = ?)'); args.push(derivedFrom); }
    if (author) { where.push('v.author = ?'); args.push(author); }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${sqlWhere}`).get(...args).n;
    const rows = db.prepare(`SELECT ${VERSION_COLS} FROM ${from} ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, Math.min(Math.max(1, limit), 200), Math.max(0, offset));
    return { total, assets: rows.map(summary) };
  }

  const allTags = () => q('SELECT tag, COUNT(*) AS n FROM asset_tags GROUP BY tag ORDER BY n DESC, tag').all();

  // ── closure and bundles ──────────────────────────────────────────────────────────────────

  /**
   * Everything the given pinned refs need at run time, walking pinned deps.
   * Returns { versions: Map(ref → { row, depth, direct }), assets, images, sounds }.
   */
  function closure(refs) {
    const versions = new Map();
    const assets = {}, images = {}, sounds = {};
    const queue = refs.map((ref) => ({ ref, depth: 0 }));
    while (queue.length) {
      const { ref, depth } = queue.shift();
      const seen = versions.get(ref);
      if (seen) { seen.depth = Math.min(seen.depth, depth); continue; }
      const row = requireVersion(ref);
      const pinned = makeRef(row.slug, row.version);
      versions.set(pinned, { row, depth, direct: depth === 0 });
      if (row.type === 'function') {
        const deps = json(row.deps, {});
        assets[pinned] = { source: row.source, deps };
        for (const dep of new Set(Object.values(deps))) queue.push({ ref: dep, depth: depth + 1 });
      } else if (row.type === 'image') images[pinned] = { path: absFile(row) };
      else if (row.type === 'sound') sounds[pinned] = { path: absFile(row) };
    }
    return { versions, assets, images, sounds };
  }

  /** A worker bundle for rendering the given refs (and optionally a composition). */
  function bundle(refs, extra = {}) {
    const c = closure(refs);
    const key = sha1(JSON.stringify([Object.keys(c.assets).sort(), Object.keys(c.images).sort(), extra.composition ?? null, extra.beats ?? null]));
    return { key, assets: c.assets, images: c.images, sounds: c.sounds, ...extra };
  }

  // ── writing function assets ──────────────────────────────────────────────────────────────

  function reject(problems) {
    const lines = problems.map((p) => (p.line ? `line ${p.line}: ${p.message}` : p.message));
    throw new StudioError(`The asset was rejected:\n- ${lines.join('\n- ')}`, 'rejected', { problems });
  }

  /**
   * Compile, pin and test unsaved source. Nothing is written.
   * Returns { meta, deps, warnings, frames, thumb (PNG Buffer), logs }.
   * @param {{ slug: string, version: number, source: string, params?: any }} o
   */
  async function validate({ slug, version, source, params }) {
    const problems = staticCheck(source);
    if (problems.length) reject(problems);
    const ref = `${slug}@${version}`;
    let inspected;
    try {
      inspected = await pool.run('validate', { ref, source, deps: {}, assets: {}, inspectOnly: true }, { timeout: 8000 });
    } catch (e) {
      throw new StudioError(`The asset was rejected: ${e.message}`, 'rejected', { logs: e.logs });
    }
    const meta = inspected.meta;
    // pin everything this version refers to: `uses`, and asset/image defaults in its schema
    const deps = {};
    const pin = (alias, spec, what) => {
      const { slug: depSlug } = parseRef(spec);
      if (depSlug === slug) throw new StudioError(`The asset was rejected: ${what} refers to "${spec}", which is this asset itself`, 'rejected');
      const row = versionRow(spec);
      if (!row) throw new StudioError(`The asset was rejected: ${what} refers to "${spec}", which is not in the library. Create it first, or use search_assets to find the right name.`, 'rejected');
      const pinned = makeRef(row.slug, row.version);
      if (deps[alias] && deps[alias] !== pinned) throw new StudioError(`The asset was rejected: "${alias}" is already pinned to ${deps[alias]}, but ${what} asks for ${pinned}. Use the same reference in both places.`, 'rejected');
      deps[alias] = pinned;
      return row;
    };
    for (const [alias, spec] of Object.entries(meta.uses)) {
      const row = pin(alias, spec, 'uses');
      if (row.type !== 'function' && row.type !== 'image') throw new StudioError(`The asset was rejected: uses "${spec}" is a ${row.type} asset; only function and image assets can be used from code`, 'rejected');
    }
    walkParams(meta.schema, {}, ['asset', 'image'], (value, def, path) => {
      const row = pin(value, value, `the default of parameter "${path}"`);
      if (def.type === 'image' && row.type !== 'image') throw new StudioError(`The asset was rejected: the default of parameter "${path}" must be an image asset; "${value}" is a ${row.type} asset`, 'rejected');
      if (def.type === 'asset' && (row.type !== 'function' || (def.kind && row.kind !== def.kind))) throw new StudioError(`The asset was rejected: the default of parameter "${path}" must be a ${def.kind ?? 'function'} asset; "${value}" is a ${row.kind ?? row.type} asset`, 'rejected');
    });
    const c = closure([...new Set(Object.values(deps))]);
    let result;
    try {
      result = await pool.run('validate', { ref, source, deps, assets: c.assets, images: c.images, params }, { timeout: 12000 });
    } catch (e) {
      throw new StudioError(`The asset was rejected: ${e.message}${e.logs?.length ? `\nconsole output:\n${e.logs.join('\n')}` : ''}`, 'rejected', { logs: e.logs });
    }
    return { ...result, deps, thumb: Buffer.from(result.thumb) };
  }

  async function saveFunction({ slug, source, author, forClip, note, params, mode, forkOf }) {
    if (!SLUG_RE.test(slug ?? '')) throw new StudioError(`"${slug}" is not a valid asset name: use lowercase letters, digits and dashes (2–64 characters), e.g. "text-word-reveal"`);
    if (!author) throw new StudioError('author is required: which model or person wrote this asset');
    const existing = q('SELECT * FROM assets WHERE slug = ?').get(slug);
    if (mode === 'create' && existing) throw new StudioError(`An asset named "${slug}" already exists (v${existing.latest_version}). Use update_asset to add a version, or pick another name.`, 'conflict');
    if (mode === 'update' && !existing) throw new StudioError(`No asset named "${slug}" in the library. Use create_asset to add it.`, 'not_found');
    if (existing && existing.type !== 'function') throw new StudioError(`"${slug}" is a ${existing.type} asset; its versions are files, not source`);
    const clip = forClip ? clipBySlug(forClip) : null;
    if (forClip && !clip) throw new StudioError(`for_clip: no clip named "${forClip}". Create the clip first (create_clip), then its assets.`, 'not_found');
    const hash = sha1(source ?? '');
    const prev = existing ? versionRow(slug) : null;
    if (prev && prev.source_hash === hash) throw new StudioError(`The source is identical to ${makeRef(slug, prev.version)}; nothing to save.`, 'conflict');
    const version = (existing?.latest_version ?? 0) + 1;
    const v = await validate({ slug, version, source, params });
    // an immutable version's files must never be overwritten by a save that then loses the race:
    // write under a temp name, rename once the transaction has claimed the version
    const thumb = `thumbs/${slug}@${version}.png`;
    const thumbTmp = join(dataDir, tempOf(thumb));
    writeFileSync(thumbTmp, v.thumb);
    const at = now();
    try {
      transaction(db, () => {
      let assetId = existing?.id;
      if (!assetId) {
        assetId = q('INSERT INTO assets (slug, type, latest_version, forked_from, origin_clip, created_at) VALUES (?, ?, 0, ?, ?, ?)')
          .run(slug, 'function', forkOf?.version_id ?? null, clip?.id ?? null, at).lastInsertRowid;
      }
      // someone else may have saved a version while we were validating
      const current = q('SELECT latest_version FROM assets WHERE id = ?').get(assetId).latest_version;
      if (current !== version - 1) throw new StudioError(`"${slug}" changed while this version was being validated (now v${current}); try again.`, 'conflict');
      const m = v.meta;
      const versionId = q(`INSERT INTO asset_versions (asset_id, version, kind, title, description, tags, duration, formats, schema, uses, deps, source, source_hash, meta, thumb, author, note, parent_version, clip_id, engine, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        assetId, version, m.kind, m.title, m.description, JSON.stringify(m.tags), m.duration, JSON.stringify(m.formats), JSON.stringify(m.schema), JSON.stringify(m.uses), JSON.stringify(v.deps),
        source, hash, JSON.stringify({ test: v.frames, warnings: v.warnings }), thumb, author, note ?? null, prev?.version_id ?? forkOf?.version_id ?? null, clip?.id ?? null, ENGINE_VERSION, at).lastInsertRowid;
      for (const [alias, dep] of Object.entries(v.deps)) q('INSERT INTO asset_deps (version_id, dep_version_id, alias) VALUES (?, ?, ?)').run(versionId, versionRow(dep).version_id, alias);
      q('UPDATE assets SET latest_version = ? WHERE id = ?').run(version, assetId);
      reindex(assetId, { slug, title: m.title, description: m.description, tags: m.tags, source });
      });
      renameSync(thumbTmp, join(dataDir, thumb));
    } catch (e) {
      rmSync(thumbTmp, { force: true });
      throw raceOf(e, slug);
    }
    return { asset: getAsset(makeRef(slug, version), { includeSource: false }), warnings: v.warnings, logs: v.logs, frames: v.frames, thumbPath: join(dataDir, thumb), thumb: v.thumb };
  }

  function reindex(assetId, { slug, title, description, tags, source }) {
    q('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
    for (const tag of tags) q('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)').run(assetId, tag);
    q('DELETE FROM assets_fts WHERE rowid = ?').run(assetId);
    q('INSERT INTO assets_fts (rowid, slug, title, description, tags, source) VALUES (?, ?, ?, ?, ?, ?)').run(assetId, slug, title ?? slug, description, tags.join(' '), source ?? '');
  }

  const createAsset = (o) => saveFunction({ ...o, mode: 'create' });
  const updateAsset = (o) => saveFunction({ ...o, mode: 'update' });

  /** A new asset that starts from another one's source (optionally changed). Lineage is kept. @param {any} o */
  async function forkAsset({ ref, slug, source, author, forClip, note, params }) {
    const from = requireVersion(ref);
    if (from.type !== 'function') throw new StudioError(`${ref} is a ${from.type} asset; only function assets can be forked`);
    return saveFunction({ slug, source: source ?? from.source, author, forClip, note: note ?? `Forked from ${makeRef(from.slug, from.version)}`, params, mode: 'create', forkOf: from });
  }

  // ── file assets: images, sounds, fonts ───────────────────────────────────────────────────

  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };

  /**
   * Add an image or sound from a file path or a Buffer (with ext). An existing slug gets a new version.
   * derivedFrom: a ref this file was baked from (kept as lineage).
   * @param {any} o
   */
  async function addFileAsset({ slug, type, path, data, ext, description, tags = [], title, author, forClip, note, license, derivedFrom, meta = {} }) {
    if (!SLUG_RE.test(slug ?? '')) throw new StudioError(`"${slug}" is not a valid asset name`);
    if (!['image', 'sound'].includes(type)) throw new StudioError('type must be image or sound');
    if (!author) throw new StudioError('author is required');
    if (typeof description !== 'string' || description.trim().length < 12) throw new StudioError('description is required: what the file is, and where it came from');
    if (!Array.isArray(tags) || !tags.every((t) => /^[a-z0-9][a-z0-9-]*$/.test(t))) throw new StudioError('tags must be lowercase-kebab strings');
    const e = (ext ?? extname(path ?? '')).toLowerCase();
    const mime = MIME[e];
    if (!mime || !mime.startsWith(type === 'image' ? 'image/' : 'audio/')) throw new StudioError(`Unsupported ${type} file type "${e}"`);
    const bytes = data ?? (path && existsSync(path) ? readFileSync(path) : null);
    if (!bytes) throw new StudioError(`File not found: ${path}`, 'not_found');
    const existing = q('SELECT * FROM assets WHERE slug = ?').get(slug);
    if (existing && existing.type !== type) throw new StudioError(`"${slug}" already exists as a ${existing.type} asset`, 'conflict');
    const clip = forClip ? clipBySlug(forClip) : null;
    if (forClip && !clip) throw new StudioError(`for_clip: no clip named "${forClip}"`, 'not_found');
    const from = derivedFrom ? requireVersion(derivedFrom) : null;
    const version = (existing?.latest_version ?? 0) + 1;
    const file = `files/${slug}@${version}${e}`;
    const fileTmp = join(dataDir, tempOf(file));
    let thumbTmp = null;
    writeFileSync(fileTmp, bytes);
    try {
    const info = { ...meta, license: license ?? meta.license ?? 'original', bytes: bytes.length };
    let thumb = null, duration = null;
    if (type === 'image') {
      const img = await loadImage(fileTmp);
      info.width = img.width; info.height = img.height;
      const k = Math.min(1, 640 / Math.max(img.width, img.height));
      const c = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      thumb = `thumbs/${slug}@${version}.png`;
      thumbTmp = join(dataDir, tempOf(thumb));
      writeFileSync(thumbTmp, c.toBuffer('image/png'));
    } else {
      const p = await probeSummary(fileTmp);
      if (!p.audio) throw new StudioError('The file has no audio stream');
      duration = p.duration; info.sampleRate = p.audio.sampleRate; info.channels = p.audio.channels;
    }
    const at = now();
    const prev = existing ? versionRow(slug) : null;
    transaction(db, () => {
      const assetId = existing?.id ?? q('INSERT INTO assets (slug, type, latest_version, forked_from, origin_clip, created_at) VALUES (?, ?, 0, ?, ?, ?)').run(slug, type, from?.version_id ?? null, clip?.id ?? null, at).lastInsertRowid;
      q(`INSERT INTO asset_versions (asset_id, version, title, description, tags, duration, file, mime, meta, thumb, author, note, parent_version, clip_id, engine, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(assetId, version, title ?? null, description.trim(), JSON.stringify(tags), duration, file, mime, JSON.stringify(info), thumb, author, note ?? null, prev?.version_id ?? from?.version_id ?? null, clip?.id ?? null, ENGINE_VERSION, at);
      q('UPDATE assets SET latest_version = ? WHERE id = ?').run(version, assetId);
      reindex(assetId, { slug, title, description: description.trim(), tags, source: '' });
    });
    renameSync(fileTmp, join(dataDir, file));
    if (thumbTmp) renameSync(thumbTmp, join(dataDir, thumb));
    } catch (err) {
      rmSync(fileTmp, { force: true });
      if (thumbTmp) rmSync(thumbTmp, { force: true });
      throw raceOf(err, slug);
    }
    return { asset: getAsset(makeRef(slug, version)) };
  }

  /** Register the bundled fonts as library assets (idempotent). */
  function seedFonts() {
    registerFonts();
    for (const fam of fontManifest()) {
      if (q('SELECT 1 FROM assets WHERE slug = ?').get(fam.slug)) continue;
      const weights = fam.files.map((f) => `${f.weight}${f.style === 'italic' ? ' italic' : ''}`).join(', ');
      const c = createCanvas(640, 360);
      const g = c.getContext('2d');
      g.fillStyle = '#101018'; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
      const heavy = fam.files[fam.files.length - 1];
      g.font = `${heavy.style === 'italic' ? 'italic ' : ''}${heavy.weight} 120px "${fam.family}"`; g.fillText('Aa', 40, 170);
      g.font = `${fam.files[0].weight} 44px "${fam.family}"`; g.fillText(fam.family, 40, 250);
      g.fillStyle = '#8b93b0'; g.font = `${fam.files[0].weight} 26px "${fam.family}"`; g.fillText(`0123456789 — ${weights}`, 40, 300);
      const thumb = `thumbs/${fam.slug}@1.png`;
      writeFileSync(join(dataDir, thumb), c.toBuffer('image/png'));
      const at = now();
      const description = `${fam.family}: an open-licensed (${fam.license}) typeface bundled with the studio. Weights: ${weights}. Use it by family name in any parameter of type "font".`;
      const tags = ['font', ...fam.tags];
      // two processes can start on an empty database at once: the loser's insert is simply not needed
      try { transaction(db, () => {
        const assetId = q('INSERT INTO assets (slug, type, latest_version, created_at) VALUES (?, ?, 1, ?)').run(fam.slug, 'font', at).lastInsertRowid;
        q(`INSERT INTO asset_versions (asset_id, version, title, description, tags, file, mime, meta, thumb, author, engine, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(assetId, fam.family, description, JSON.stringify(tags), fam.files[0].file, 'font/woff2', JSON.stringify({ family: fam.family, files: fam.files, license: fam.license, licenseFile: `fonts/${fam.licenseFile}`, source: fam.source }), thumb, 'library', ENGINE_VERSION, at);
        reindex(assetId, { slug: fam.slug, title: fam.family, description, tags, source: '' });
      }); } catch (e) { if (!/UNIQUE constraint/i.test(String(e?.message))) throw e; }
    }
  }

  const fontFamilies = () => fontManifest().map((f) => f.family);
  /** The font asset for a family name, if the library has it. */
  const fontRef = (family) => {
    const fam = fontManifest().find((f) => f.family.toLowerCase() === String(family).toLowerCase());
    return fam ? makeRef(fam.slug, 1) : null;
  };

  return { versionRow, requireVersion, getAsset, search, allTags, closure, bundle, validate, createAsset, updateAsset, forkAsset, addFileAsset, seedFonts, fontFamilies, fontRef, absFile, summary, clipSlug, refOfVersionId, FORMATS };
}

