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
import { presetSource, rewriteDefaults } from './generate.js';
import { diffLines, unified } from '../core/diff.js';
import { resolveParams } from '../core/schema.js';

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
  a.id AS asset_id, a.slug, a.type, a.latest_version, a.forked_from, a.origin_clip, a.created_at,
  a.meta_title, a.meta_description, a.meta_tags, a.meta_by, a.meta_at, a.derivation, a.needs_description, a.featured, a.meta_uses`;

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
      // metadata edited in the studio wins over what the source declares
      title: row.meta_title ?? row.title ?? row.slug,
      description: row.meta_description ?? row.description,
      tags: row.meta_tags ? json(row.meta_tags, []) : json(row.tags, []),
      edited: !!(row.meta_title || row.meta_description || row.meta_tags),
      derivation: row.derivation ?? (row.forked_from ? (row.type === 'function' ? 'fork' : 'bake') : null),
      needsDescription: !!row.needs_description,
      featured: !!row.featured,
      suggestedUses: json(row.meta_uses, []),
      formats: json(row.formats, []),
      duration: row.duration,
      author: row.author,
      params: Object.keys(json(row.schema, {})),
      originClip: clipSlug(row.origin_clip),
      forkedFrom: refOfVersionId(row.forked_from),
      thumb: row.thumb,
      strip: json(row.meta, {}).strip?.file ?? null,
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
      favorite: !!q('SELECT 1 FROM favorites WHERE asset_id = ?').get(row.asset_id),
      declared: { title: row.title, description: row.description, tags: json(row.tags, []) },
      metadataEdit: row.meta_by ? { by: row.meta_by, at: row.meta_at } : null,
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

  const SORTS = ['relevance', 'newest', 'used', 'name'];

  /**
   * The WHERE clause for a set of filters, leaving out the facet named in `except` (so each facet
   * counts what the other filters allow).
   */
  function filterSql(f, except = null) {
    const where = [], args = [];
    const on = (name) => except !== name;
    if (f.match) { where.push('a.id IN (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?)'); args.push(f.match); }
    if (f.type && on('type')) { where.push('a.type = ?'); args.push(f.type); }
    if (f.kind && on('kind')) { where.push('v.kind = ?'); args.push(f.kind); }
    // set filters are IN (subquery): computed once, not once per row
    if (on('tag')) for (const tag of f.tags ?? []) { where.push('a.id IN (SELECT asset_id FROM asset_tags WHERE tag = ?)'); args.push(tag); }
    // formats is a small JSON array of known names: a string match is exact and far cheaper than json_each per row
    if (f.format && on('format')) { where.push("(v.formats = '[]' OR v.formats LIKE ?)"); args.push(`%"${String(f.format).replace(/[^a-z]/g, '')}"%`); }
    if (f.originClip && on('origin')) { where.push('a.origin_clip = (SELECT id FROM clips WHERE slug = ?)'); args.push(f.originClip); }
    if (f.usedByClip && on('usedBy')) { where.push('a.id IN (SELECT cv.asset_id FROM clip_assets ca JOIN asset_versions cv ON cv.id = ca.version_id WHERE ca.clip_id = (SELECT id FROM clips WHERE slug = ?))'); args.push(f.usedByClip); }
    if (f.derivedFrom) { where.push('a.forked_from IN (SELECT fv.id FROM asset_versions fv JOIN assets fa ON fa.id = fv.asset_id WHERE fa.slug = ?)'); args.push(f.derivedFrom); }
    if (f.author && on('author')) { where.push('v.author = ?'); args.push(f.author); }
    if (f.needsDescription !== undefined && on('needsDescription')) { where.push('a.needs_description = ?'); args.push(f.needsDescription ? 1 : 0); }
    if (f.favorite && on('favorite')) where.push('a.id IN (SELECT asset_id FROM favorites)');
    if (f.featured && on('featured')) where.push('a.featured = 1');
    if (f.collection && on('collection')) { where.push('a.id IN (SELECT cl.asset_id FROM collection_assets cl JOIN collections co ON co.id = cl.collection_id WHERE co.slug = ?)'); args.push(f.collection); }
    if (f.recent) where.push('a.id IN (SELECT asset_id FROM asset_recent)');
    if (f.derivation) { where.push('a.derivation = ?'); args.push(f.derivation); }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
  }

  const BASE = 'FROM assets a JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version';

  /** Counts per facet value, each under every filter except its own. */
  function facetsFor(f) {
    const count = (sql, args) => db.prepare(sql).all(...args).map((r) => ({ value: r.k, count: r.n }));
    const by = (facet, expr, extra = '') => { const w = filterSql(f, facet); return count(`SELECT ${expr} AS k, COUNT(DISTINCT a.id) AS n ${BASE} ${extra} ${w.sql}${w.sql ? ' AND' : ' WHERE'} ${expr} IS NOT NULL GROUP BY k ORDER BY n DESC, k LIMIT 60`, w.args); };
    const flag = (facet, cond) => { const w = filterSql(f, facet); return db.prepare(`SELECT COUNT(*) AS n ${BASE} ${w.sql}${w.sql ? ' AND' : ' WHERE'} ${cond}`).get(...w.args).n; };
    const all = filterSql(f);
    return {
      type: by('type', 'a.type'),
      kind: by('kind', 'v.kind'),
      // tags narrow each other, so their counts are under the full filter
      tag: count(`SELECT t.tag AS k, COUNT(*) AS n ${BASE} JOIN asset_tags t ON t.asset_id = a.id ${all.sql} GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 40`, all.args),
      format: (() => {
        const w = filterSql(f, 'format');
        const r = db.prepare(`SELECT ${['vertical', 'horizontal', 'square'].map((x) => `SUM(v.formats = '[]' OR v.formats LIKE '%"${x}"%') AS ${x}`).join(', ')} ${BASE} ${w.sql}`).get(...w.args);
        return ['vertical', 'horizontal', 'square'].map((x) => ({ value: x, count: r[x] ?? 0 })).filter((x) => x.count).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      })(),
      author: by('author', 'v.author'),
      origin: by('origin', '(SELECT slug FROM clips WHERE id = a.origin_clip)'),
      usedBy: (() => { const w = filterSql(f, 'usedBy'); return count(`SELECT c.slug AS k, COUNT(DISTINCT a.id) AS n ${BASE} JOIN asset_versions uv ON uv.asset_id = a.id JOIN clip_assets ca ON ca.version_id = uv.id JOIN clips c ON c.id = ca.clip_id ${w.sql} GROUP BY c.slug ORDER BY n DESC, k LIMIT 60`, w.args); })(),
      collection: (() => { const w = filterSql(f, 'collection'); return count(`SELECT co.slug AS k, COUNT(DISTINCT a.id) AS n ${BASE} JOIN collection_assets cl ON cl.asset_id = a.id JOIN collections co ON co.id = cl.collection_id ${w.sql} GROUP BY co.slug ORDER BY n DESC, k`, w.args); })(),
      needsDescription: flag('needsDescription', 'a.needs_description = 1'),
      favorite: flag('favorite', 'a.id IN (SELECT asset_id FROM favorites)'),
      featured: flag('featured', 'a.featured = 1'),
    };
  }

  /**
   * Search the library. Every filter is optional: query (full text, ranked), type, kind, tags (all
   * must match), format, originClip, usedByClip, derivedFrom, author, needsDescription, favorite,
   * featured, collection, recent, derivation. sort: relevance (default; text rank boosted by
   * featured, favourites and use; without a query: featured, favourites, use, newest), newest, used,
   * name. facets: also return counts per facet value. Returns { total, assets, facets? }.
   * @param {any} [o]
   */
  function search({ query, type, kind, tags, format, originClip, usedByClip, derivedFrom, author, needsDescription, favorite, featured, collection, recent, derivation, sort = 'relevance', facets = false, limit = 50, offset = 0 } = {}) {
    const tokens = typeof query === 'string' ? query.toLowerCase().match(/[\p{L}\p{N}]+/gu) : null;
    const match = tokens?.length ? tokens.slice(0, 12).map((t) => `"${t}"*`).join(' ') : null;
    const f = { match, type, kind, tags, format, originClip, usedByClip, derivedFrom, author, needsDescription, favorite, featured, collection, recent, derivation };
    const w = filterSql(f);
    const total = db.prepare(`SELECT COUNT(*) AS n ${BASE} ${w.sql}`).get(...w.args).n;
    if (!SORTS.includes(sort)) sort = 'relevance';
    // usage and favourites joined once as aggregates, not looked up per row
    let from = `${BASE} LEFT JOIN (SELECT uv.asset_id AS id, COUNT(DISTINCT ca.clip_id) AS n FROM clip_assets ca JOIN asset_versions uv ON uv.id = ca.version_id GROUP BY uv.asset_id) u ON u.id = a.id LEFT JOIN favorites fa ON fa.asset_id = a.id`;
    let order, args = w.args;
    const used = 'COALESCE(u.n, 0)', fav = '(fa.asset_id IS NOT NULL)';
    if (sort === 'newest') order = 'v.created_at DESC, a.id DESC';
    else if (sort === 'used') order = `${used} DESC, a.id DESC`;
    else if (sort === 'name') order = 'LOWER(COALESCE(a.meta_title, v.title, a.slug)), a.id';
    else if (recent) { from += ' JOIN asset_recent rr ON rr.asset_id = a.id'; order = 'rr.at DESC, a.id DESC'; }
    else if (match) {
      // text rank first (bm25: lower is better), nudged by what the studio knows is good
      from += ' JOIN (SELECT rowid AS id, bm25(assets_fts, 10.0, 6.0, 3.0, 6.0, 0.5) AS rank FROM assets_fts WHERE assets_fts MATCH ?) m ON m.id = a.id';
      args = [match, ...w.args];
      // bm25 is negative (more negative is better), so the boosts multiply it
      order = `m.rank * (1 + 0.6 * a.featured + 0.4 * ${fav} + 0.15 * MIN(${used}, 5)), a.id DESC`;
    } else order = `a.featured DESC, ${fav} DESC, ${used} DESC, a.id DESC`;
    // the page's ids first (narrow rows sort fast), then their details
    const ids = db.prepare(`SELECT a.id ${from} ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, Math.min(Math.max(1, limit), 200), Math.max(0, offset)).map((r) => r.id);
    const byId = new Map(ids.length ? db.prepare(`SELECT ${VERSION_COLS} ${BASE} WHERE a.id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => [r.asset_id, r]) : []);
    const rows = ids.map((id) => byId.get(id));
    const favs = new Set(rows.length ? db.prepare(`SELECT asset_id FROM favorites WHERE asset_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map((r) => r.asset_id)).map((r) => r.asset_id) : []);
    const out = { total, assets: rows.map((r) => ({ ...summary(r), favorite: favs.has(r.asset_id) })) };
    if (facets) out.facets = facetsFor(f);
    return out;
  }

  // ── favourites, collections, featured, recently used ──────────────────────────────────────

  const assetIdOf = (slug) => {
    const r = q('SELECT id FROM assets WHERE slug = ?').get(parseRef(slug).slug);
    if (!r) throw new StudioError(`No asset named "${slug}" in the library.`, 'not_found');
    return r.id;
  };

  function setFavorite(slug, on = true) {
    const id = assetIdOf(slug);
    if (on) q('INSERT OR IGNORE INTO favorites (asset_id, created_at) VALUES (?, ?)').run(id, now());
    else q('DELETE FROM favorites WHERE asset_id = ?').run(id);
    ctx.events?.emit('asset', parseRef(slug).slug, 'favorite', { on: !!on });
  }

  function setFeatured(slug, on = true) {
    q('UPDATE assets SET featured = ? WHERE id = ?').run(on ? 1 : 0, assetIdOf(slug));
    ctx.events?.emit('asset', parseRef(slug).slug, 'featured', { on: !!on });
  }

  /** Remember that an asset was opened, used in a clip or created (for "recently used"). */
  function touch(slug, how = 'opened') {
    const r = q('SELECT id FROM assets WHERE slug = ?').get(parseRef(slug).slug);
    if (r) q('INSERT INTO asset_recent (asset_id, at, how) VALUES (?, ?, ?) ON CONFLICT(asset_id) DO UPDATE SET at = excluded.at, how = excluded.how').run(r.id, now(), how);
  }

  const listCollections = () => q('SELECT c.slug, c.name, c.created_at, (SELECT COUNT(*) FROM collection_assets ca WHERE ca.collection_id = c.id) AS n FROM collections c ORDER BY c.name').all().map((c) => ({ slug: c.slug, name: c.name, count: c.n, createdAt: c.created_at }));

  /** Put assets in a collection (made when it does not exist yet). */
  function addToCollection(name, slugs) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    if (!SLUG_RE.test(slug)) throw new StudioError(`"${name}" is not a usable collection name`);
    const ids = slugs.map(assetIdOf);
    transaction(db, () => {
      q('INSERT OR IGNORE INTO collections (slug, name, created_at) VALUES (?, ?, ?)').run(slug, String(name).trim(), now());
      const cid = q('SELECT id FROM collections WHERE slug = ?').get(slug).id;
      for (const id of ids) q('INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, added_at) VALUES (?, ?, ?)').run(cid, id, now());
    });
    ctx.events?.emit('library', slug, 'collection', { added: slugs.length });
    return listCollections().find((c) => c.slug === slug);
  }

  function removeFromCollection(collection, slugs) {
    const c = q('SELECT id FROM collections WHERE slug = ?').get(collection);
    if (!c) throw new StudioError(`No collection "${collection}"`, 'not_found');
    for (const id of slugs.map(assetIdOf)) q('DELETE FROM collection_assets WHERE collection_id = ? AND asset_id = ?').run(c.id, id);
    ctx.events?.emit('library', collection, 'collection', { removed: slugs.length });
  }

  /**
   * Change many assets at once: tags added or removed (a metadata edit, no new versions),
   * favourite, featured, a collection.
   * @param {{ slugs: string[], addTags?: string[], removeTags?: string[], favorite?: boolean, featured?: boolean, collection?: string, author: string }} o
   */
  function bulk({ slugs, addTags = [], removeTags = [], favorite, featured, collection, author }) {
    if (!Array.isArray(slugs) || !slugs.length || slugs.length > 500) throw new StudioError('slugs: 1–500 asset names');
    for (const t of [...addTags, ...removeTags]) if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) throw new StudioError(`"${t}" is not a lowercase-kebab tag`);
    const changed = [];
    for (const slug of slugs) {
      if (addTags.length || removeTags.length) {
        const a = getAsset(slug, { includeSource: false });
        const next = [...new Set([...a.tags.filter((t) => !removeTags.includes(t)), ...addTags])];
        if (next.join() !== a.tags.join()) setMetadata({ slug: a.slug, tags: next.length ? next : [a.type], author, keepFlag: true });
      }
      if (favorite !== undefined) setFavorite(slug, favorite);
      if (featured !== undefined) setFeatured(slug, featured);
      changed.push(parseRef(slug).slug);
    }
    if (collection) addToCollection(collection, slugs);
    return { changed };
  }

  const allTags = () => q('SELECT tag, COUNT(*) AS n FROM asset_tags GROUP BY tag ORDER BY n DESC, tag').all();

  // ── closure and bundles ──────────────────────────────────────────────────────────────────

  /**
   * Everything the given pinned refs need at run time, walking pinned deps.
   * Returns { versions: Map(ref → { row, depth, direct }), assets, images, sounds }.
   */
  function closure(refs) {
    const versions = new Map();
    const assets = {}, images = {}, sounds = {}, sequences = {};
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
      } else if (row.type === 'image') images[pinned] = { path: absFile(row), vector: json(row.meta, {}).vector ?? null };
      else if (row.type === 'sound') sounds[pinned] = { path: absFile(row) };
      else if (row.type === 'sequence') { const m = json(row.meta, {}); sequences[pinned] = { dir: absFile(row), file: row.file, frames: m.frames, fps: m.fps, width: m.width, height: m.height }; }
    }
    return { versions, assets, images, sounds, sequences };
  }

  /** A worker bundle for rendering the given refs (and optionally a composition). */
  function bundle(refs, extra = {}) {
    const c = closure(refs);
    const key = sha1(JSON.stringify([Object.keys(c.assets).sort(), Object.keys(c.images).sort(), Object.keys(c.sequences).sort(), extra.composition ?? null, extra.beats ?? null]));
    return { key, assets: c.assets, images: c.images, sounds: c.sounds, sequences: c.sequences, ...extra };
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
    return { ...result, deps, thumb: Buffer.from(result.thumb), strip: result.strip ? Buffer.from(result.strip) : null };
  }

  /** @param {{ slug: string, source: string, author: string, forClip?: string, note?: string, params?: any, mode: string, forkOf?: any, derivation?: string }} o */
  async function saveFunction({ slug, source, author, forClip, note, params, mode, forkOf, derivation }) {
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
    // the hover filmstrip: written now, it is only ever read for a version that exists
    const strip = v.strip ? `thumbs/${slug}@${version}.strip.png` : null;
    if (strip) writeFileSync(join(dataDir, strip), v.strip);
    const at = now();
    try {
      transaction(db, () => {
      let assetId = existing?.id;
      if (!assetId) {
        assetId = q('INSERT INTO assets (slug, type, latest_version, forked_from, origin_clip, created_at, derivation) VALUES (?, ?, 0, ?, ?, ?, ?)')
          .run(slug, 'function', forkOf?.version_id ?? null, clip?.id ?? null, at, derivation ?? (forkOf ? 'fork' : null)).lastInsertRowid;
      }
      // someone else may have saved a version while we were validating
      const current = q('SELECT latest_version FROM assets WHERE id = ?').get(assetId).latest_version;
      if (current !== version - 1) throw new StudioError(`"${slug}" changed while this version was being validated (now v${current}); try again.`, 'conflict');
      const m = v.meta;
      const versionId = q(`INSERT INTO asset_versions (asset_id, version, kind, title, description, tags, duration, formats, schema, uses, deps, source, source_hash, meta, thumb, author, note, parent_version, clip_id, engine, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        assetId, version, m.kind, m.title, m.description, JSON.stringify(m.tags), m.duration, JSON.stringify(m.formats), JSON.stringify(m.schema), JSON.stringify(m.uses), JSON.stringify(v.deps),
        source, hash, JSON.stringify({ test: v.frames, warnings: v.warnings, strip: strip ? { file: strip, frames: 8 } : undefined }), thumb, author, note ?? null, prev?.version_id ?? forkOf?.version_id ?? null, clip?.id ?? null, ENGINE_VERSION, at).lastInsertRowid;
      for (const [alias, dep] of Object.entries(v.deps)) q('INSERT INTO asset_deps (version_id, dep_version_id, alias) VALUES (?, ?, ?)').run(versionId, versionRow(dep).version_id, alias);
      q('UPDATE assets SET latest_version = ? WHERE id = ?').run(version, assetId);
      reindex(assetId, { slug, title: m.title, description: m.description, tags: m.tags, source });
      });
      renameSync(thumbTmp, join(dataDir, thumb));
    } catch (e) {
      rmSync(thumbTmp, { force: true });
      throw raceOf(e, slug);
    }
    touch(slug, 'created');
    ctx.events?.emit('asset', slug, version === 1 ? 'created' : 'version', { ref: makeRef(slug, version), author, clip: forClip ?? null, fork: forkOf ? makeRef(forkOf.slug, forkOf.version) : null });
    return { asset: getAsset(makeRef(slug, version), { includeSource: false }), warnings: v.warnings, logs: v.logs, frames: v.frames, thumbPath: join(dataDir, thumb), thumb: v.thumb };
  }

  function reindex(assetId, { slug, title, description, tags, source }) {
    const o = q('SELECT meta_title, meta_description, meta_tags FROM assets WHERE id = ?').get(assetId);
    if (o?.meta_title) title = o.meta_title;
    if (o?.meta_description) description = o.meta_description;
    if (o?.meta_tags) tags = json(o.meta_tags, tags);
    q('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
    for (const tag of tags) q('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)').run(assetId, tag);
    q('DELETE FROM assets_fts WHERE rowid = ?').run(assetId);
    q('INSERT INTO assets_fts (rowid, slug, title, description, tags, source) VALUES (?, ?, ?, ?, ?, ?)').run(assetId, slug, title ?? slug, description, tags.join(' '), source ?? '');
  }

  /** Search index and tags for an asset, from its latest version (and any metadata edits). */
  function reindexLatest(assetId) {
    const r = q('SELECT a.slug, v.title, v.description, v.tags, v.source FROM assets a JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version WHERE a.id = ?').get(assetId);
    if (r) reindex(assetId, { slug: r.slug, title: r.title, description: r.description, tags: json(r.tags, []), source: r.source ?? '' });
  }

  /**
   * Edit an asset's title, description or tags without a new code version. The edit applies to
   * every version and to search; null for a field goes back to what the source declares.
   * uses: suggested uses (short phrases), for images the agent describes.
   * @param {{ slug: string, title?: string | null, description?: string | null, tags?: string[] | null, uses?: string[] | null, author: string, keepFlag?: boolean }} o
   */
  function setMetadata({ slug, title, description, tags, uses, author, keepFlag = false }) {
    if (!author) throw new StudioError('author is required');
    const a = q('SELECT * FROM assets WHERE slug = ?').get(slug);
    if (!a) throw new StudioError(`No asset named "${slug}" in the library.`, 'not_found');
    const sets = [], args = [];
    if (title !== undefined) {
      if (title !== null && (typeof title !== 'string' || !title.trim() || title.length > 120)) throw new StudioError('title is a short name (1–120 characters)');
      sets.push('meta_title = ?'); args.push(title === null ? null : title.trim());
    }
    if (description !== undefined) {
      if (description !== null && (typeof description !== 'string' || description.trim().length < 12 || description.length > 2000)) throw new StudioError('description is one or two sentences (12–2000 characters) saying what it is and when to use it');
      sets.push('meta_description = ?'); args.push(description === null ? null : description.trim());
    }
    if (tags !== undefined) {
      if (tags !== null && (!Array.isArray(tags) || !tags.length || tags.length > 24 || !tags.every((t) => typeof t === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(t)))) throw new StudioError('tags is a list of 1–24 lowercase-kebab strings such as ["logo", "brand"]');
      sets.push('meta_tags = ?'); args.push(tags === null ? null : JSON.stringify([...new Set(tags)]));
    }
    if (uses !== undefined) {
      if (uses !== null && (!Array.isArray(uses) || uses.length > 12 || !uses.every((u) => typeof u === 'string' && u.trim() && u.length <= 160))) throw new StudioError('uses is a list of up to 12 short phrases (how the asset could be used)');
      sets.push('meta_uses = ?'); args.push(uses === null ? null : JSON.stringify(uses.map((u) => u.trim())));
    }
    if (!sets.length) throw new StudioError('Give a title, description, tags or uses to change');
    // describing an upload is what takes it off the "needs description" list
    if (!keepFlag && description) sets.push('needs_description = 0');
    transaction(db, () => {
      q(`UPDATE assets SET ${sets.join(', ')}, meta_by = ?, meta_at = ? WHERE id = ?`).run(...args, author, now(), a.id);
      reindexLatest(a.id);
    });
    ctx.events?.emit('asset', slug, 'metadata', { author });
    return getAsset(slug, { includeSource: false });
  }

  /**
   * A preset: a named asset that is another asset plus a chosen parameter set (its new defaults).
   * It pins the base version, has its own thumbnail, and is searchable and usable like any asset.
   * @param {{ base: string, slug: string, params: any, title?: string, description?: string, tags?: string[], author: string, forClip?: string }} o
   */
  async function createPreset({ base, slug, params, title, description, tags, author, forClip }) {
    const row = requireVersion(base);
    if (row.type !== 'function') throw new StudioError(`${base} is a ${row.type} asset; presets are made from function assets`);
    const schema = json(row.schema, {});
    if (!params || typeof params !== 'object' || !Object.keys(params).length) throw new StudioError('params is the parameter set the preset keeps (at least one)');
    const { values, errors } = resolveParams(schema, params, { strict: true });
    if (errors.length) throw new StudioError(`The preset's params do not fit ${makeRef(row.slug, row.version)}:\n- ${errors.map((e) => `${e.path}: ${e.message}`).join('\n- ')}`);
    const chosen = Object.fromEntries(Object.keys(params).map((k) => [k, values[k]]));
    const baseRef = makeRef(row.slug, row.version);
    const baseTitle = summary(row).title;
    const name = title ?? `${baseTitle} · ${slug}`;
    const shown = Object.entries(chosen).filter(([, v]) => typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k} ${typeof v === 'string' ? `"${v.length > 24 ? `${v.slice(0, 24)}…` : v}"` : v}`).join(', ');
    const source = presetSource({
      base: baseRef, kind: row.kind, title: name,
      description: description ?? `A preset of ${baseTitle} (${baseRef})${shown ? ` with ${shown}` : ''}. Same parameters, these values as defaults.`,
      tags: [...new Set([...(tags ?? summary(row).tags), 'preset'])].slice(0, 24),
      duration: row.duration, formats: json(row.formats, []), schema, params: chosen,
    });
    return saveFunction({ slug, source, author, forClip, note: `Preset of ${baseRef}`, mode: 'create', forkOf: row, derivation: 'preset' });
  }

  /**
   * Save parameter values as an asset's new defaults: the next version is the same source with
   * those `default:` values rewritten in place.
   * @param {{ slug: string, params: any, author: string, note?: string, forClip?: string }} o
   */
  async function saveDefaults({ slug, params, author, note, forClip }) {
    const row = requireVersion(slug);
    if (row.type !== 'function') throw new StudioError(`"${slug}" is a ${row.type} asset; only function assets have parameters`);
    const schema = json(row.schema, {});
    const { values, errors } = resolveParams(schema, params ?? {}, { strict: true });
    if (errors.length) throw new StudioError(`These params do not fit ${makeRef(row.slug, row.version)}:\n- ${errors.map((e) => `${e.path}: ${e.message}`).join('\n- ')}`);
    const changed = Object.fromEntries(Object.keys(params).filter((k) => JSON.stringify(values[k]) !== JSON.stringify(schema[k].default)).map((k) => [k, values[k]]));
    if (!Object.keys(changed).length) throw new StudioError('These are already the defaults; nothing to save', 'conflict');
    let source;
    try { source = rewriteDefaults(row.source, changed); } catch (e) { throw new StudioError(`Could not rewrite the defaults in the source (${e.message}); edit the source instead`); }
    const list = Object.entries(changed).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
    return saveFunction({ slug: row.slug, source, author, forClip, note: note ?? `New defaults: ${list.length > 160 ? `${list.slice(0, 160)}…` : list}`, mode: 'update' });
  }

  /** Two versions of an asset, line by line. */
  function diffVersions(slug, a, b) {
    const A = requireVersion(makeRef(parseRef(slug).slug, a)), B = requireVersion(makeRef(parseRef(slug).slug, b));
    if (A.type !== 'function') throw new StudioError(`"${A.slug}" is a ${A.type} asset; its versions are files, not source`);
    const lines = diffLines(A.source, B.source);
    const ra = makeRef(A.slug, A.version), rb = makeRef(B.slug, B.version);
    return {
      a: { ref: ra, note: A.note, author: A.author, schema: json(A.schema, {}) }, b: { ref: rb, note: B.note, author: B.author, schema: json(B.schema, {}) },
      added: lines.filter((l) => l.op === 'add').length, removed: lines.filter((l) => l.op === 'del').length,
      lines, unified: unified(lines, { from: ra, to: rb }),
    };
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
  /** @param {{ slug: string, type: string, path?: string, data?: Buffer, ext?: string, description: string, tags?: string[], title?: string, author: string, forClip?: string, note?: string, license?: string, derivedFrom?: string, meta?: any, needsDescription?: boolean, sidecar?: { ext: string, data: Buffer } }} o */
  async function addFileAsset({ slug, type, path, data, ext, description, tags = [], title, author, forClip, note, license, derivedFrom, meta = {}, needsDescription = false, sidecar }) {
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
    // a file kept next to the asset's own (an uploaded SVG next to its raster)
    const side = sidecar ? `files/${slug}@${version}${sidecar.ext}` : null;
    if (side) { meta = { ...meta, sidecar: side }; writeFileSync(join(dataDir, side), sidecar.data); }
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
      const assetId = existing?.id ?? q('INSERT INTO assets (slug, type, latest_version, forked_from, origin_clip, created_at, derivation) VALUES (?, ?, 0, ?, ?, ?, ?)').run(slug, type, from?.version_id ?? null, clip?.id ?? null, at, from ? 'bake' : null).lastInsertRowid;
      if (needsDescription) q('UPDATE assets SET needs_description = 1 WHERE id = ?').run(assetId);
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
      if (side) rmSync(join(dataDir, side), { force: true });
      throw raceOf(err, slug);
    }
    ctx.events?.emit('asset', slug, version === 1 ? 'created' : 'version', { ref: makeRef(slug, version), author, type, clip: forClip ?? null });
    return { asset: getAsset(makeRef(slug, version)) };
  }

  /**
   * Add a frame sequence (PNG frames with alpha, 000000.png …) from a directory, moved into the data
   * dir. meta: { frames, fps, width, height, duration, key, bakedFrom, params }.
   * @param {{ slug: string, dir: string, meta: any, description: string, tags?: string[], title?: string, author: string, forClip?: string, derivedFrom?: string, thumb: Buffer }} o
   */
  function addSequence({ slug, dir, meta, description, tags = [], title, author, forClip, derivedFrom, thumb: thumbPng }) {
    if (!SLUG_RE.test(slug ?? '')) throw new StudioError(`"${slug}" is not a valid asset name`);
    if (!author) throw new StudioError('author is required');
    if (typeof description !== 'string' || description.trim().length < 12) throw new StudioError('description is required: what the sequence shows and what it was baked from');
    if (!Array.isArray(tags) || !tags.every((t) => /^[a-z0-9][a-z0-9-]*$/.test(t))) throw new StudioError('tags must be lowercase-kebab strings');
    const existing = q('SELECT * FROM assets WHERE slug = ?').get(slug);
    if (existing && existing.type !== 'sequence') throw new StudioError(`"${slug}" already exists as a ${existing.type} asset`, 'conflict');
    const clip = forClip ? clipBySlug(forClip) : null;
    if (forClip && !clip) throw new StudioError(`for_clip: no clip named "${forClip}"`, 'not_found');
    const from = derivedFrom ? requireVersion(derivedFrom) : null;
    const version = (existing?.latest_version ?? 0) + 1;
    const file = `files/${slug}@${version}`;
    const thumb = `thumbs/${slug}@${version}.png`;
    const at = now();
    const prev = existing ? versionRow(slug) : null;
    try {
      transaction(db, () => {
        const assetId = existing?.id ?? q('INSERT INTO assets (slug, type, latest_version, forked_from, origin_clip, created_at, derivation) VALUES (?, ?, 0, ?, ?, ?, ?)').run(slug, 'sequence', from?.version_id ?? null, clip?.id ?? null, at, from ? 'bake' : null).lastInsertRowid;
        q(`INSERT INTO asset_versions (asset_id, version, title, description, tags, duration, file, mime, meta, thumb, author, note, parent_version, clip_id, engine, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(assetId, version, title ?? null, description.trim(), JSON.stringify(tags), meta.duration, file, 'image/png', JSON.stringify(meta), thumb, author, derivedFrom ? `Baked from ${derivedFrom}` : null, prev?.version_id ?? from?.version_id ?? null, clip?.id ?? null, ENGINE_VERSION, at);
        q('UPDATE assets SET latest_version = ? WHERE id = ?').run(version, assetId);
        reindex(assetId, { slug, title, description: description.trim(), tags, source: '' });
        writeFileSync(join(dataDir, thumb), thumbPng);
        renameSync(dir, join(dataDir, file));
      });
    } catch (e) {
      rmSync(join(dataDir, thumb), { force: true });
      throw raceOf(e, slug);
    }
    ctx.events?.emit('asset', slug, version === 1 ? 'created' : 'version', { ref: makeRef(slug, version), author, type: 'sequence', clip: forClip ?? null });
    return { asset: getAsset(makeRef(slug, version), { includeSource: false }) };
  }

  /** A sequence already baked with this key (same asset version, params, size, fps and duration). */
  const sequenceByKey = (key) => {
    const r = q("SELECT a.slug, v.version FROM assets a JOIN asset_versions v ON v.asset_id = a.id WHERE a.type = 'sequence' AND json_extract(v.meta, '$.key') = ? ORDER BY v.id LIMIT 1").get(key);
    return r ? getAsset(makeRef(r.slug, r.version), { includeSource: false }) : null;
  };

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

  return { versionRow, requireVersion, getAsset, search, allTags, closure, bundle, validate, createAsset, updateAsset, forkAsset, addFileAsset, setMetadata, reindexLatest, createPreset, saveDefaults, diffVersions, addSequence, sequenceByKey, setFavorite, setFeatured, touch, listCollections, addToCollection, removeFromCollection, bulk, seedFonts, fontFamilies, fontRef, absFile, summary, clipSlug, refOfVersionId, saveFunction, FORMATS };
}

