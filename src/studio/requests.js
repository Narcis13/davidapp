// Requests to the agent and the proposals that answer them.
//
// The user asks from the studio ("a neon lower third", "make this one slower", "add a stat scene at
// 0:12"), scoped to an asset, a clip (optionally a selection of its items) or the whole library.
// Claude Code works the queue over MCP: it claims a request, reads its context (source, schema,
// rendered frames), and answers with a proposal or a reply. A proposal changes nothing until the
// user accepts it; then it becomes a version, a new asset or a clip revision.
//
//   open ──claim──▶ working ──propose──▶ review ──accept──▶ done
//    ▲                 │                   │ reject (no reason) ─▶ done
//    └── user reply ◀──┴───────────────────┘ reject with a reason, or reply ─▶ open
//   a claim holds a lease; an expired lease puts the request back to open. cancel ─▶ cancelled
//
// Concurrent edits: a proposal remembers the base it was made against (asset version or clip
// revision). Accepting an asset proposal whose asset has moved on is a conflict unless forced
// (nothing is lost either way: versions are immutable). A clip proposal is a list of edit
// operations, re-applied to the clip as it is now, so it rebases cleanly when the items it touches
// still exist and conflicts otherwise.

import { randomBytes } from 'node:crypto';
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRef } from '../core/engine.js';
import { json, now, transaction } from '../db/db.js';
import { StudioError, SLUG_RE } from './library.js';

export const LEASE_SECONDS = 900;
const KINDS = ['asset-version', 'new-asset', 'clip-edit'];

export function createRequests(ctx, library, clips, frames) {
  const { db, dataDir } = ctx;
  const stmts = new Map();
  const q = (sql) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };
  const emit = (key, action, data = {}) => ctx.events?.emit('request', key, action, data);
  const leaseUntil = (seconds = LEASE_SECONDS) => new Date(Date.now() + seconds * 1000).toISOString();

  // ── shapes ───────────────────────────────────────────────────────────────────────────────

  function shape(row) {
    const asset = row.asset_id ? q('SELECT slug FROM assets WHERE id = ?').get(row.asset_id)?.slug : null;
    return {
      id: row.id, scope: row.scope, title: row.title, status: row.status,
      asset, assetVersion: row.asset_version, assetRef: asset && row.asset_version ? makeRef(asset, row.asset_version) : null,
      clip: library.clipSlug(row.clip_id), clipRevision: row.clip_revision,
      items: json(row.items, []), at: row.at, params: json(row.params, null),
      claimedBy: row.claimed_by, leaseUntil: row.lease_until, run: json(row.run, null),
      author: row.author, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function proposalShape(p, { payload = true } = {}) {
    return {
      id: p.id, request: p.request_id, kind: p.kind, target: p.target, base: p.base, summary: p.summary, status: p.status,
      thumb: p.thumb, meta: json(p.meta, {}), result: p.result, author: p.author,
      createdAt: p.created_at, decidedAt: p.decided_at, decidedBy: p.decided_by,
      payload: payload ? json(p.payload, {}) : undefined,
    };
  }

  const row = (id) => {
    const r = q('SELECT * FROM requests WHERE id = ?').get(Number(id));
    if (!r) throw new StudioError(`No request #${id}. Use list_requests to see the queue.`, 'not_found');
    return r;
  };
  const proposalRow = (id) => {
    const p = q('SELECT * FROM proposals WHERE id = ?').get(Number(id));
    if (!p) throw new StudioError(`No proposal #${id}`, 'not_found');
    return p;
  };

  /** A request with its thread and proposals. */
  function get(id) {
    const r = row(id);
    return {
      ...shape(r),
      messages: q('SELECT * FROM request_messages WHERE request_id = ? ORDER BY id').all(r.id).map((m) => ({ id: m.id, author: m.author, role: m.role, body: m.body, proposal: m.proposal_id, at: m.created_at })),
      proposals: q('SELECT * FROM proposals WHERE request_id = ? ORDER BY id').all(r.id).map((p) => proposalShape(p)),
    };
  }

  /** @param {{ status?: string | string[], scope?: string, asset?: string, clip?: string, limit?: number }} [o] */
  function list({ status, scope, asset, clip, limit = 50 } = {}) {
    expireLeases();
    const where = [], args = [];
    const statuses = Array.isArray(status) ? status : status ? [status] : [];
    if (statuses.length) { where.push(`status IN (${statuses.map(() => '?').join(', ')})`); args.push(...statuses); }
    if (scope) { where.push('scope = ?'); args.push(scope); }
    if (asset) { where.push('asset_id = (SELECT id FROM assets WHERE slug = ?)'); args.push(asset); }
    if (clip) { where.push('clip_id = (SELECT id FROM clips WHERE slug = ?)'); args.push(clip); }
    const rows = db.prepare(`SELECT * FROM requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(200, Math.max(1, limit)));
    return rows.map((r) => ({ ...shape(r), messages: q('SELECT COUNT(*) AS n FROM request_messages WHERE request_id = ?').get(r.id).n, pending: q("SELECT COUNT(*) AS n FROM proposals WHERE request_id = ? AND status = 'pending'").get(r.id).n }));
  }

  function message(requestId, author, role, body, proposalId = null) {
    return q('INSERT INTO request_messages (request_id, author, role, body, proposal_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(requestId, author, role, body, proposalId, now()).lastInsertRowid;
  }

  const setStatus = (id, status, extra = '') => q(`UPDATE requests SET status = ?, updated_at = ?${extra} WHERE id = ?`).run(status, now(), id);

  /** Claims whose agent went quiet go back to the queue. */
  function expireLeases() {
    const stale = q("SELECT id, claimed_by FROM requests WHERE status = 'working' AND lease_until < ?").all(now());
    for (const r of stale) {
      transaction(db, () => {
        if (!q("UPDATE requests SET status = 'open', claimed_by = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'working' AND lease_until < ?").run(now(), r.id, now()).changes) return;
        message(r.id, 'studio', 'system', `${r.claimed_by}'s claim expired; the request is back in the queue.`);
      });
      emit(r.id, 'status', { status: 'open' });
    }
  }

  // ── the user's side ──────────────────────────────────────────────────────────────────────

  /**
   * Ask the agent for something.
   * @param {{ scope?: string, asset?: string, version?: number, clip?: string, items?: string[], at?: number, params?: any, message: string, author: string }} o
   */
  function create({ scope, asset, version, clip, items = [], at, params, message: body, author }) {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new StudioError('Write what you would like the agent to do');
    if (text.length > 4000) throw new StudioError('A request is at most 4000 characters');
    if (!author) throw new StudioError('author is required');
    const s = scope ?? (asset ? 'asset' : clip ? 'clip' : 'library');
    if (!['asset', 'clip', 'library'].includes(s)) throw new StudioError('scope must be asset, clip or library');
    let assetRow = null, clipRow = null;
    if (s === 'asset') {
      if (!asset) throw new StudioError('An asset request names the asset');
      assetRow = library.requireVersion(version ? makeRef(asset, version) : asset);
    }
    if (s === 'clip') {
      if (!clip) throw new StudioError('A clip request names the clip');
      clipRow = clips.clipRow(clip);
      if (!Array.isArray(items) || !items.every((x) => typeof x === 'string')) throw new StudioError('items is a list of item ids');
      const ids = new Set(json(clipRow.composition).tracks.flatMap((t) => t.items.map((i) => i.id)));
      const unknown = items.filter((x) => !ids.has(x));
      if (unknown.length) throw new StudioError(`No item ${unknown.map((x) => `"${x}"`).join(', ')} in clip "${clip}"`);
    }
    if (at !== undefined && at !== null && !(typeof at === 'number' && at >= 0)) throw new StudioError('at is the playhead time in seconds');
    const title = text.split('\n')[0].slice(0, 90);
    const id = transaction(db, () => {
      const rid = q(`INSERT INTO requests (scope, asset_id, asset_version, clip_id, clip_revision, items, at, params, title, status, author, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(s, assetRow?.asset_id ?? null, assetRow?.version ?? null, clipRow?.id ?? null, clipRow?.revision ?? null,
        JSON.stringify(s === 'clip' ? items : []), at ?? null, params ? JSON.stringify(params) : null, title, author, now(), now()).lastInsertRowid;
      message(rid, author, 'user', text);
      return rid;
    });
    emit(id, 'created', { scope: s, asset: assetRow?.slug ?? null, clip: clipRow?.slug ?? null });
    return get(id);
  }

  /** The user writes in the thread: the request goes back to the agent. */
  function reply({ id, author, body, role = 'user' }) {
    const r = row(id);
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new StudioError('The message is empty');
    if (r.status === 'cancelled') throw new StudioError(`Request #${r.id} was cancelled`, 'conflict');
    transaction(db, () => {
      message(r.id, author, role, text);
      if (role === 'agent') q('UPDATE requests SET lease_until = ?, updated_at = ? WHERE id = ? AND status = ?').run(leaseUntil(), now(), r.id, 'working');
      // a user who writes while the agent holds the claim is heard when it next reads the thread
      else if (r.status !== 'working') setStatus(r.id, 'open', ', claimed_by = NULL, lease_until = NULL');
      else q('UPDATE requests SET updated_at = ? WHERE id = ?').run(now(), r.id);
    });
    emit(r.id, 'message', { role });
    return get(r.id);
  }

  function cancel({ id, author }) {
    const r = row(id);
    if (r.status === 'cancelled' || r.status === 'done') return get(r.id);
    transaction(db, () => {
      setStatus(r.id, 'cancelled', ', claimed_by = NULL, lease_until = NULL');
      q("UPDATE proposals SET status = 'superseded' WHERE request_id = ? AND status = 'pending'").run(r.id);
      message(r.id, author, 'system', 'Cancelled.');
    });
    emit(r.id, 'status', { status: 'cancelled' });
    return get(r.id);
  }

  /**
   * Accept a proposal: it becomes a version, a new asset or a clip revision.
   * force: save an asset proposal even though the asset moved on since it was made.
   * @param {{ proposal: number, author: string, force?: boolean }} o
   */
  async function accept({ proposal: pid, author, force = false }) {
    const p = proposalRow(pid);
    if (p.status !== 'pending') throw new StudioError(`Proposal #${p.id} is ${p.status}; only a pending proposal can be accepted`, 'conflict');
    const r = row(p.request_id);
    const payload = json(p.payload, {});
    const note = `${payload.note || p.summary || 'Proposed by the agent'} (accepted from request #${r.id})`;
    const forClip = r.clip_id ? library.clipSlug(r.clip_id) : undefined;
    let result;
    if (p.kind === 'asset-version') {
      const latest = library.requireVersion(p.target);
      if (latest.version !== Number(p.base.split('@')[1]) && !force) {
        throw new StudioError(`"${p.target}" moved to v${latest.version} after this proposal was made against ${p.base}. Accept it anyway to save it as v${latest.version + 1}, or reply to ask the agent to start from v${latest.version}.`, 'conflict', { latest: makeRef(latest.slug, latest.version), base: p.base });
      }
      result = (await library.updateAsset({ slug: p.target, source: payload.source, note, author: p.author, forClip })).asset.ref;
    } else if (p.kind === 'new-asset') {
      result = (await library.createAsset({ slug: p.target, source: payload.source, note, author: p.author, forClip })).asset.ref;
    } else if (p.kind === 'clip-edit') {
      let out;
      try {
        out = await clips.editClip(p.target, payload.operations, { by: `request #${r.id}` });
      } catch (e) {
        if (e instanceof StudioError && e.code !== 'rejected') throw new StudioError(`The clip changed since this proposal was made (${p.base}) and its edits no longer apply: ${e.message}. Reply to ask the agent to redo it on the current clip.`, 'conflict');
        throw e;
      }
      result = `${p.target}#${out.clip.revision}`;
    } else throw new StudioError(`Unknown proposal kind ${p.kind}`);
    transaction(db, () => {
      q("UPDATE proposals SET status = 'accepted', result = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(result, now(), author, p.id);
      setStatus(r.id, 'done', ', claimed_by = NULL, lease_until = NULL');
      message(r.id, author, 'system', `Accepted proposal #${p.id}: it is now ${result}.`, p.id);
    });
    emit(r.id, 'proposal', { proposal: p.id, status: 'accepted', result });
    return { request: get(r.id), result };
  }

  /** Reject a proposal. With a reason the request goes back to the agent; without one it closes. */
  function reject({ proposal: pid, author, reason }) {
    const p = proposalRow(pid);
    if (p.status !== 'pending') throw new StudioError(`Proposal #${p.id} is ${p.status}; only a pending proposal can be rejected`, 'conflict');
    const text = typeof reason === 'string' ? reason.trim() : '';
    transaction(db, () => {
      q("UPDATE proposals SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?").run(now(), author, p.id);
      message(p.request_id, author, 'system', `Rejected proposal #${p.id}.`, p.id);
      if (text) { message(p.request_id, author, 'user', text); setStatus(p.request_id, 'open', ', claimed_by = NULL, lease_until = NULL'); }
      else setStatus(p.request_id, 'done', ', claimed_by = NULL, lease_until = NULL');
    });
    emit(p.request_id, 'proposal', { proposal: p.id, status: 'rejected' });
    return get(p.request_id);
  }

  // ── the agent's side ─────────────────────────────────────────────────────────────────────

  /**
   * Claim a request (the given one, or the oldest open one). Returns null when the queue is empty.
   * @param {{ id?: number, agent: string }} o
   */
  function claim({ id, agent }) {
    if (!agent) throw new StudioError('agent is required: who is working the request');
    expireLeases();
    const target = id !== undefined && id !== null ? row(id) : q("SELECT * FROM requests WHERE status = 'open' ORDER BY id LIMIT 1").get();
    if (!target) return null;
    if (target.status === 'working' && target.claimed_by !== agent) throw new StudioError(`Request #${target.id} is being worked by ${target.claimed_by} (until ${target.lease_until})`, 'conflict');
    if (['done', 'cancelled'].includes(target.status)) throw new StudioError(`Request #${target.id} is ${target.status}`, 'conflict');
    const claimed = transaction(db, () => {
      const ok = q("UPDATE requests SET status = 'working', claimed_by = ?, lease_until = ?, updated_at = ? WHERE id = ? AND status IN ('open', 'review', 'working')").run(agent, leaseUntil(), now(), target.id).changes;
      if (ok && target.claimed_by !== agent) message(target.id, agent, 'system', `${agent} is working on it.`);
      return ok;
    });
    if (!claimed) throw new StudioError(`Request #${target.id} was taken by someone else; try again`, 'conflict');
    emit(target.id, 'status', { status: 'working', agent });
    return get(target.id);
  }

  /** Everything an agent needs to work a request: the thread, the scope's source/composition, and frames. */
  async function context(id) {
    const r = get(id);
    const out = { request: r, scope: null, images: [] };
    if (r.scope === 'asset') {
      const latest = library.requireVersion(r.asset);
      const a = library.getAsset(makeRef(latest.slug, latest.version));
      out.scope = { asset: a.ref, askedOn: r.assetRef, movedOn: r.assetRef !== a.ref, kind: a.kind, title: a.title, description: a.description, tags: a.tags, schema: a.schema, deps: a.deps, params: r.params ?? {}, duration: a.duration, formats: a.formats, source: a.source };
      if (a.type === 'function' && a.kind === 'visual') {
        const sheet = await frames.assetSheet({ ref: a.ref, params: r.params ?? {}, count: 8 });
        out.images.push({ name: `request-${r.id}-${a.ref}-sheet`, png: sheet.png, caption: `${a.ref} with the params on screen, at ${sheet.times.map((t) => `${t}s`).join(', ')}` });
      }
    } else if (r.scope === 'clip') {
      const c = clips.getClip(r.clip);
      const selected = c.composition.tracks.flatMap((t) => t.items.map((i) => ({ ...i, track: t.id }))).filter((i) => r.items.includes(i.id));
      out.scope = { clip: c.slug, revision: c.revision, askedOnRevision: r.clipRevision, format: c.format, duration: c.duration, at: r.at, selected, composition: c.composition, assets: c.assets.filter((x) => x.direct).map((x) => `${x.ref} (${x.relation})`) };
      const t = r.at ?? (selected[0] ? selected[0].start + selected[0].duration / 2 : c.duration / 2);
      const frame = await frames.clipFrame({ clip: c.slug, t, maxSize: 960 });
      out.images.push({ name: `request-${r.id}-${c.slug}-t${t.toFixed(2)}`, png: frame.png, caption: `${c.slug} at ${t.toFixed(2)}s` });
      const sheet = await frames.clipSheet({ clip: c.slug, count: 12 });
      out.images.push({ name: `request-${r.id}-${c.slug}-sheet`, png: sheet.png, caption: `${c.slug}: 12 frames across the clip` });
    } else {
      out.scope = { library: { assets: library.search({ limit: 1 }).total, tags: library.allTags().slice(0, 30).map((x) => x.tag), clips: clips.listClips().map((c) => c.slug) } };
    }
    return out;
  }

  /** The request must be one this agent may answer: claim it on the way if it is open. */
  function answering(id, agent) {
    const r = row(id);
    if (['done', 'cancelled'].includes(r.status)) throw new StudioError(`Request #${r.id} is ${r.status}; there is nothing to answer`, 'conflict');
    if (r.status === 'working' && r.claimed_by && r.claimed_by !== agent && r.lease_until > now()) throw new StudioError(`Request #${r.id} is being worked by ${r.claimed_by}`, 'conflict');
    return r;
  }

  function writeThumb(png) {
    const rel = `thumbs/proposal-${randomBytes(8).toString('hex')}.png`;
    const tmp = join(dataDir, `${rel}.tmp`);
    writeFileSync(tmp, png);
    renameSync(tmp, join(dataDir, rel));
    return rel;
  }

  /**
   * Answer a request with a proposal. Nothing in the library or the clip changes until the user
   * accepts it. A newer proposal supersedes a pending one.
   *   asset-version: { name?, source, note }   new-asset: { name, source, note }   clip-edit: { clip?, operations }
   * @param {{ id: number, agent: string, kind: string, name?: string, source?: string, note?: string, clip?: string, operations?: any[], summary?: string }} o
   */
  async function propose({ id, agent, kind, name, source, note, clip, operations, summary = '' }) {
    if (!KINDS.includes(kind)) throw new StudioError(`kind must be one of ${KINDS.join(', ')}`);
    const r = answering(id, agent);
    const req = shape(r);
    let target, base, payload, meta = {}, thumbPng;
    if (kind === 'asset-version' || kind === 'new-asset') {
      if (typeof source !== 'string' || !source.trim()) throw new StudioError('source is required: the complete asset source');
      if (kind === 'asset-version') {
        target = name ?? req.asset;
        if (!target) throw new StudioError('name is required: which asset this is a new version of');
        const latest = library.requireVersion(target);
        if (latest.type !== 'function') throw new StudioError(`"${target}" is a ${latest.type} asset; propose a new function asset instead`);
        if (latest.source === source) throw new StudioError(`The source is identical to ${makeRef(latest.slug, latest.version)}; nothing to propose`, 'conflict');
        base = makeRef(latest.slug, latest.version);
        // validated with its own defaults: the params on screen may name parameters the new version dropped
        const v = await library.validate({ slug: target, version: latest.version + 1, source });
        meta = { kind: v.meta.kind, warnings: v.warnings, testFrames: v.frames, wouldBe: makeRef(target, latest.version + 1), schema: v.meta.schema };
        thumbPng = v.thumb;
      } else {
        target = name;
        if (!SLUG_RE.test(target ?? '')) throw new StudioError(`"${target}" is not a valid asset name: use lowercase letters, digits and dashes`);
        if (library.versionRow(target)) throw new StudioError(`An asset named "${target}" already exists; propose an asset-version of it, or pick another name`, 'conflict');
        const v = await library.validate({ slug: target, version: 1, source });
        meta = { kind: v.meta.kind, warnings: v.warnings, testFrames: v.frames, wouldBe: makeRef(target, 1), schema: v.meta.schema };
        thumbPng = v.thumb;
      }
      payload = { source, note: note ?? null };
    } else {
      target = clip ?? req.clip;
      if (!target) throw new StudioError('clip is required: which clip the edit is for');
      if (!Array.isArray(operations) || !operations.length) throw new StudioError('operations is a non-empty list of edit_clip operations');
      const current = clips.clipRow(target);
      const edited = clips.applyOps(json(current.composition), operations);
      const prepared = clips.prepare(edited).composition;
      const checked = await clips.check(prepared);
      base = `${target}#${current.revision}`;
      const t = req.at ?? prepared.duration / 2;
      thumbPng = (await frames.clipFrame({ composition: prepared, t, maxSize: 640 })).png;
      meta = { framesChecked: checked.framesChecked, at: t };
      payload = { operations };
    }
    const thumb = thumbPng ? writeThumb(Buffer.from(thumbPng)) : null;
    let pid;
    try {
      pid = transaction(db, () => {
        q("UPDATE proposals SET status = 'superseded' WHERE request_id = ? AND status = 'pending'").run(r.id);
        const newId = q(`INSERT INTO proposals (request_id, kind, target, base, payload, summary, status, thumb, meta, author, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
          .run(r.id, kind, target, base ?? null, JSON.stringify(payload), summary, thumb, JSON.stringify(meta), agent, now()).lastInsertRowid;
        message(r.id, agent, 'agent', summary || `Proposed ${kind === 'clip-edit' ? `an edit of ${target}` : kind === 'new-asset' ? `a new asset, ${target}` : `a new version of ${target}`}.`, newId);
        setStatus(r.id, 'review', ', lease_until = NULL');
        return newId;
      });
    } catch (e) {
      if (thumb) rmSync(join(dataDir, thumb), { force: true });
      throw e;
    }
    emit(r.id, 'proposal', { proposal: pid, status: 'pending', kind, target });
    return { request: get(r.id), proposal: proposalShape(proposalRow(pid)) };
  }

  /** The agent finishes without a proposal (a question answered, nothing to change). */
  function complete({ id, agent, body }) {
    const r = answering(id, agent);
    transaction(db, () => {
      if (body?.trim()) message(r.id, agent, 'agent', body.trim());
      setStatus(r.id, 'done', ', claimed_by = NULL, lease_until = NULL');
    });
    emit(r.id, 'status', { status: 'done' });
    return get(r.id);
  }

  /** Record the state of a "Run now" session on the request (JSON), and tell the studio. */
  function setRun(id, run) {
    q('UPDATE requests SET run = ?, updated_at = ? WHERE id = ?').run(run ? JSON.stringify(run) : null, now(), Number(id));
    emit(id, 'run', { status: run?.status ?? null });
  }

  /** Give a claim back (a session that ended without answering): the request returns to the queue. */
  function release(id, agent) {
    const done = q("UPDATE requests SET status = 'open', claimed_by = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'working' AND claimed_by = ?").run(now(), Number(id), agent).changes;
    if (done) { message(Number(id), 'studio', 'system', `${agent} stopped without an answer; the request is back in the queue.`); emit(id, 'status', { status: 'open' }); }
    return !!done;
  }

  /** A progress or system line in the thread (from a "Run now" session). */
  function note(id, author, role, body) {
    message(Number(id), author, role, body);
    emit(id, 'message', { role });
  }

  return { create, list, get, reply, cancel, accept, reject, claim, context, propose, complete, setRun, note, release, proposal: (id) => proposalShape(proposalRow(id)), expireLeases };
}
