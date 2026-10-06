// The compounding loop: what makes clip N+1 cheaper than clip N, and the numbers that show it.
//
// - Every MCP call is logged with the clip it served (named in its arguments, or the clip this
//   author was last working on), so a clip's build can be measured: how many calls, and how long
//   from its first call (or studio request) to its render request.
// - suggest_assets ranks the library against a brief, so an agent starts from what exists.
// - Agents leave notes on assets for the next agent; each asset shows real usage examples.

import { makeRef } from '../core/engine.js';
import { json, now, transaction } from '../db/db.js';
import { StudioError } from './library.js';

const STOP = new Set('a an and are as at be by for from has in into is it its of on or that the this to was with we you your our make made need want some any show shows use using clip scene video about over under like'.split(' '));
const GENERATED = new Set(['preset', 'precomp']);
const SESSION = `${process.pid}-${Date.now().toString(36)}`;

export function createCompounding(ctx, library, clips) {
  const { db } = ctx;
  const q = (sql) => db.prepare(sql);
  let lastClip = null;

  /** Which clip a tool call is for: named in its arguments, or the one its author was last working on. */
  function clipOf(tool, args, author) {
    let slug = args?.clip ?? args?.for_clip ?? (tool === 'create_clip' ? args?.name : null);
    if (!slug && args?.request !== undefined) slug = q('SELECT c.slug FROM requests r JOIN clips c ON c.id = r.clip_id WHERE r.id = ?').get(Number(args.request))?.slug;
    if (!slug && args?.id !== undefined && /request/.test(tool)) slug = q('SELECT c.slug FROM requests r JOIN clips c ON c.id = r.clip_id WHERE r.id = ?').get(Number(args.id))?.slug;
    let id = slug ? q('SELECT id FROM clips WHERE slug = ?').get(slug)?.id ?? null : null;
    if (!id) id = lastClip ?? q("SELECT clip_id FROM mcp_calls WHERE author = ? AND clip_id IS NOT NULL AND at > ? ORDER BY id DESC LIMIT 1").get(author, new Date(Date.now() - 3 * 3600e3).toISOString())?.clip_id ?? null;
    if (id) lastClip = id;
    return id;
  }

  /** Record one MCP tool call (after it ran, so a create_clip call is attributed to its clip). */
  function logCall({ tool, args, author, ms, ok }) {
    try {
      q('INSERT INTO mcp_calls (at, session, author, tool, clip_id, ms, ok) VALUES (?, ?, ?, ?, ?, ?, ?)').run(new Date(Date.now() - ms).toISOString(), SESSION, author, tool, clipOf(tool, args, author), Math.round(ms), ok ? 1 : 0);
    } catch { /* the log must never break a tool */ }
  }

  /**
   * How a clip was built. Build time runs from its first MCP call or studio request to its first
   * render request (the render itself is not counted). New asset code counts the lines of source
   * written for the clip; presets and precomps the studio generated are counted apart.
   */
  function metrics(slug) {
    const clip = clips.clipRow(slug);
    const comp = json(clip.composition);
    const calls = q('SELECT * FROM mcp_calls WHERE clip_id = ? ORDER BY id').all(clip.id);
    const firstRequest = q('SELECT MIN(created_at) AS at FROM requests WHERE clip_id = ?').get(clip.id)?.at ?? null;
    const renderCall = calls.find((c) => c.tool === 'start_render');
    const firstRender = q('SELECT MIN(created_at) AS at FROM renders WHERE clip_id = ?').get(clip.id)?.at ?? null;
    const startAt = [calls[0]?.at, firstRequest, clip.created_at].filter(Boolean).sort()[0];
    const endAt = renderCall?.at ?? firstRender ?? null;
    const inWindow = renderCall ? calls.filter((c) => c.id <= renderCall.id) : calls.filter((c) => !endAt || c.at <= endAt);
    const versions = q(`SELECT a.slug, a.type, a.derivation, v.version, v.source FROM asset_versions v JOIN assets a ON a.id = v.asset_id WHERE v.clip_id = ? AND a.type = 'function'`).all(clip.id);
    const lines = (src) => (src ? src.split('\n').filter((l) => l.trim()).length : 0);
    const written = versions.filter((v) => !GENERATED.has(v.derivation));
    const generated = versions.filter((v) => GENERATED.has(v.derivation));
    // every timeline item: does it use an asset version made before (for another clip)?
    const items = comp.tracks.flatMap((t) => t.items);
    const existed = items.filter((it) => { const row = library.versionRow(it.asset); return row && row.clip_id !== clip.id; });
    const reusedFrom = new Map();
    for (const it of existed) { const row = library.versionRow(it.asset); const from = library.clipSlug(row.clip_id ?? row.origin_clip) ?? 'library'; reusedFrom.set(from, (reusedFrom.get(from) ?? 0) + 1); }
    const seconds = startAt && endAt ? Math.round((Date.parse(endAt) - Date.parse(startAt)) / 100) / 10 : null;
    return {
      clip: slug, title: clip.title, duration: comp.duration, format: comp.format,
      mcpCalls: inWindow.length, mcpCallsByTool: Object.fromEntries([...inWindow.reduce((m, c) => m.set(c.tool, (m.get(c.tool) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])),
      newAssets: written.map((v) => makeRef(v.slug, v.version)), newCodeLines: written.reduce((s, v) => s + lines(v.source), 0),
      generatedAssets: generated.map((v) => makeRef(v.slug, v.version)), generatedLines: generated.reduce((s, v) => s + lines(v.source), 0),
      items: items.length, itemsUsingExisting: existed.length, reuseShare: items.length ? Math.round((existed.length / items.length) * 1000) / 1000 : 0,
      reusedFrom: Object.fromEntries(reusedFrom),
      buildStart: startAt, buildEnd: endAt, buildSeconds: seconds, buildSecondsPerOutputSecond: seconds !== null ? Math.round((seconds / comp.duration) * 100) / 100 : null,
    };
  }

  /** The compounding table for every clip (or the given ones), as text. */
  function table(slugs) {
    const list = (slugs ?? clips.listClips().map((c) => c.slug)).map(metrics);
    const pad = (s, n) => String(s).padEnd(n);
    const rows = list.map((m, i) => `${pad(i + 1, 3)}${pad(m.clip, 26)}${pad(`${m.duration}s`, 6)}${pad(m.mcpCalls, 7)}${pad(m.newCodeLines, 8)}${pad(`${Math.round(m.reuseShare * 100)}%`, 7)}${pad(m.buildSeconds ?? '–', 9)}${m.buildSecondsPerOutputSecond ?? '–'}`);
    return [`${pad('#', 3)}${pad('clip', 26)}${pad('len', 6)}${pad('calls', 7)}${pad('lines', 8)}${pad('reuse', 7)}${pad('build s', 9)}s per s`, ...rows].join('\n');
  }

  /**
   * Rank the library against a brief: words of the brief matched against names, descriptions, tags
   * and source (any word, ranked by bm25), boosted by featured, favourites and use, at most `perKind`
   * of a kind so the list covers what a clip needs.
   */
  function suggest({ brief, kinds, limit = 10, perKind = 4 }) {
    const words = [...new Set(String(brief ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 24);
    if (!words.length) throw new StudioError('brief: describe what the clip or scene needs, in a sentence or two');
    const match = words.map((w) => `"${w}"*`).join(' OR ');
    const rows = q(`SELECT a.id, a.slug, v.version, v.kind, a.type, a.featured, a.derivation, m.rank,
        (SELECT COUNT(DISTINCT ca.clip_id) FROM clip_assets ca JOIN asset_versions uv ON uv.id = ca.version_id WHERE uv.asset_id = a.id) AS used,
        EXISTS (SELECT 1 FROM favorites fa WHERE fa.asset_id = a.id) AS fav
      FROM (SELECT rowid AS id, bm25(assets_fts, 10.0, 6.0, 3.0, 6.0, 0.5) AS rank FROM assets_fts WHERE assets_fts MATCH ?) m
      JOIN assets a ON a.id = m.id JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version
      WHERE a.type != 'font' ORDER BY m.rank * (1 + 0.6 * a.featured + 0.4 * fav + 0.15 * MIN(used, 5)) LIMIT 200`).all(match);
    const per = new Map(), out = [];
    for (const r of rows) {
      const k = r.kind ?? r.type;
      if (kinds?.length && !kinds.includes(k)) continue;
      if ((per.get(k) ?? 0) >= perKind) continue;
      per.set(k, (per.get(k) ?? 0) + 1);
      const a = library.getAsset(makeRef(r.slug, r.version), { includeSource: false });
      const text = `${a.slug} ${a.title} ${a.description} ${a.tags.join(' ')}`.toLowerCase();
      out.push({ ref: a.ref, kind: k, title: a.title, description: a.description, tags: a.tags, params: Object.keys(a.schema), usedByClips: a.usedByClips, featured: a.featured, derivation: a.derivation, matched: words.filter((w) => text.includes(w)), thumb: a.thumb, notes: notesOf(a.slug).slice(-2).map((n) => n.body) });
      if (out.length >= limit) break;
    }
    return { words, suggestions: out };
  }

  /** A note on an asset for the next agent. */
  function addNote({ slug, body, author }) {
    const a = q('SELECT id FROM assets WHERE slug = ?').get(slug);
    if (!a) throw new StudioError(`No asset named "${slug}" in the library.`, 'not_found');
    const text = String(body ?? '').trim();
    if (text.length < 4 || text.length > 1000) throw new StudioError('A note is 4–1000 characters');
    transaction(db, () => {
      q('INSERT INTO asset_notes (asset_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(a.id, author, text, now());
      ctx.events?.emit('asset', slug, 'note', { author });
    });
    return notesOf(slug);
  }

  const notesOf = (slug) => q('SELECT n.author, n.body, n.created_at FROM asset_notes n JOIN assets a ON a.id = n.asset_id WHERE a.slug = ? ORDER BY n.id').all(slug).map((n) => ({ author: n.author, body: n.body, at: n.created_at }));

  /** Real uses of an asset in clips: the item's params and layout, as examples for the next one. */
  function examples(slug, limit = 3) {
    const out = [];
    for (const c of q('SELECT DISTINCT c.slug, c.composition FROM clips c JOIN clip_assets ca ON ca.clip_id = c.id JOIN asset_versions v ON v.id = ca.version_id JOIN assets a ON a.id = v.asset_id WHERE a.slug = ? AND ca.direct = 1 ORDER BY c.id DESC').all(slug)) {
      for (const t of json(c.composition).tracks) {
        for (const it of t.items) {
          if (it.asset.split('@')[0] !== slug || out.length >= limit) continue;
          const ex = { clip: c.slug, item: it.id, asset: it.asset, start: it.start, duration: it.duration, params: it.params };
          for (const k of ['transform', 'box', 'motions', 'effects', 'keyframes']) if (it[k]) ex[k] = it[k];
          out.push(ex);
        }
      }
    }
    return out;
  }

  return { logCall, metrics, table, suggest, addNote, notesOf, examples, session: SESSION };
}
