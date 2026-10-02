// Lineage: which clip produced which asset, and which later clips reused it. This is the
// "compounding" view of the library, as data for the studio and as a text report.

import { makeRef } from '../core/engine.js';

export function createLineage(ctx, library, clips) {
  const { db } = ctx;

  /** The clip an asset ultimately came from: its own origin, or (for a fork) its source's. */
  function rootOrigin(assetId, seen = new Set()) {
    const a = db.prepare('SELECT a.id, a.origin_clip, a.forked_from, fv.asset_id AS parent FROM assets a LEFT JOIN asset_versions fv ON fv.id = a.forked_from WHERE a.id = ?').get(assetId);
    if (!a) return null;
    if (a.parent && !seen.has(a.parent)) { seen.add(assetId); return rootOrigin(a.parent, seen) ?? a.origin_clip; }
    return a.origin_clip;
  }

  /** { clips: [...], assets: [...] } for the lineage view. Clips are in creation order. */
  function graph() {
    const clipRows = db.prepare('SELECT * FROM clips ORDER BY id').all();
    const order = new Map(clipRows.map((c, i) => [c.id, i + 1]));
    const slugOf = new Map(clipRows.map((c) => [c.id, c.slug]));
    const outClips = clipRows.map((c) => {
      const assets = clips.clipAssets(c.slug).filter((a) => a.type !== 'font').map((a) => {
        const row = library.versionRow(a.ref);
        const root = rootOrigin(row.asset_id);
        // a reused version counts for the clip that version was made for (else the asset's first clip)
        const from = a.relation === 'created' ? (a.forkedFrom && root !== c.id ? slugOf.get(root) ?? null : null) : a.relation === 'reused' ? a.versionMadeFor ?? a.originClip : a.originClip;
        const how = a.relation === 'created' ? (from ? 'fork' : 'created') : a.relation === 'new-version' ? 'new-version' : a.originClip === null ? 'library' : 'as-is';
        return { ref: a.ref, slug: a.slug, version: a.version, type: a.type, kind: a.kind, direct: a.direct, depth: a.depth, how, from, forkedFrom: a.forkedFrom, title: a.title };
      });
      const count = (how) => assets.filter((a) => a.how === how).length;
      return {
        slug: c.slug, title: c.title, order: order.get(c.id), format: c.format, width: c.width, height: c.height, duration: c.duration,
        remixedFrom: slugOf.get(c.remixed_from) ?? null, createdAt: c.created_at,
        assets,
        counts: { total: assets.length, created: count('created'), asIs: count('as-is'), newVersion: count('new-version'), fork: count('fork'), reused: assets.filter((a) => a.from && a.from !== c.slug).length },
      };
    });
    const assetRows = db.prepare("SELECT a.*, v.kind, v.title, v.description, v.thumb FROM assets a JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version WHERE a.type != 'font' ORDER BY a.id").all();
    const outAssets = assetRows.map((a) => {
      const versions = db.prepare('SELECT version, clip_id, author, note FROM asset_versions WHERE asset_id = ? ORDER BY version').all(a.id);
      const usedBy = db.prepare('SELECT DISTINCT ca.clip_id, v.version, ca.direct FROM clip_assets ca JOIN asset_versions v ON v.id = ca.version_id WHERE v.asset_id = ? ORDER BY ca.clip_id').all(a.id);
      return {
        slug: a.slug, type: a.type, kind: a.kind, title: a.title ?? a.slug, description: a.description, thumb: a.thumb, latestVersion: a.latest_version,
        originClip: slugOf.get(a.origin_clip) ?? null,
        rootOriginClip: slugOf.get(rootOrigin(a.id)) ?? null,
        forkedFrom: library.refOfVersionId(a.forked_from),
        versions: versions.map((v) => ({ version: v.version, ref: makeRef(a.slug, v.version), madeForClip: slugOf.get(v.clip_id) ?? null, author: v.author, note: v.note })),
        usedBy: usedBy.map((u) => ({ clip: slugOf.get(u.clip_id), version: u.version, direct: !!u.direct })),
        reuseCount: new Set(usedBy.map((u) => u.clip_id).filter((id) => id !== a.origin_clip)).size,
      };
    });
    return { clips: outClips, assets: outAssets };
  }

  /** The reuse report as text: for every clip, what it created and what it took from earlier clips. */
  function report() {
    const g = graph();
    const lines = [`Reuse report: ${g.clips.length} clip(s), ${g.assets.length} asset(s) in the library (fonts not counted)`, ''];
    for (const c of g.clips) {
      lines.push(`Clip ${c.order} · ${c.slug} — "${c.title}" (${c.format} ${c.width}×${c.height}, ${c.duration}s)${c.remixedFrom ? ` · remix of ${c.remixedFrom}` : ''}`);
      lines.push(`  uses ${c.counts.total} assets: ${c.counts.created} created for this clip, ${c.counts.reused} reused from earlier clips (${c.counts.asIs} as-is, ${c.counts.newVersion} as a new version, ${c.counts.fork} as a fork)`);
      const groups = new Map();
      for (const a of c.assets) if (a.from && a.from !== c.slug) groups.set(a.from, [...(groups.get(a.from) ?? []), a]);
      for (const [from, list] of groups) {
        lines.push(`  from ${from} (${list.length}): ${list.map((a) => a.ref + (a.how === 'new-version' ? ' [new version]' : a.how === 'fork' ? ` [fork of ${a.forkedFrom}]` : '')).join(', ')}`);
      }
      const created = c.assets.filter((a) => a.how === 'created');
      if (created.length) lines.push(`  created (${created.length}): ${created.map((a) => a.ref).join(', ')}`);
      lines.push('');
    }
    const top = [...g.assets].sort((a, b) => b.reuseCount - a.reuseCount).filter((a) => a.reuseCount > 0).slice(0, 10);
    if (top.length) lines.push(`Most reused: ${top.map((a) => `${a.slug} (${a.reuseCount} later clip${a.reuseCount > 1 ? 's' : ''})`).join(', ')}`);
    return lines.join('\n').trimEnd();
  }

  return { graph, report };
}
