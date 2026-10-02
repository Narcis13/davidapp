// The render queue. Jobs live in SQLite, so the studio server and the MCP server see the same
// queue; whichever process has a runner claims the next job atomically. Progress, cancellation and
// the results (MP4, poster, SRT, ffprobe facts, sampled frame hashes) are all rows and files.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, makeRef } from '../core/engine.js';
import { toSrt } from '../core/composition.js';
import { renderVideo } from '../render/video.js';
import { probeSummary } from '../render/ffmpeg.js';
import { json, now, transaction } from '../db/db.js';
import { StudioError } from './library.js';

const STALE_MS = 45000;

/** Frame numbers hashed during every render: 16 spread across the clip, plus the first and last. */
export function sampleFrames(total, count = 16) {
  const out = new Set([0, total - 1]);
  for (let i = 0; i < count; i++) out.add(Math.min(total - 1, Math.round(((i + 0.5) / count) * total)));
  return [...out].filter((f) => f >= 0).sort((a, b) => a - b);
}

export function createRenders(ctx, library, clips) {
  const { db, dataDir, pool } = ctx;
  const dir = join(dataDir, 'renders');
  mkdirSync(dir, { recursive: true });
  const runnerId = `${ctx.role ?? 'studio'}-${process.pid}`;
  const stmts = new Map();
  const q = (sql) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };
  let timer = null, busy = false, current = null, stopping = false;

  function shape(row) {
    if (!row) return null;
    const clip = q('SELECT slug, title, format, width, height, fps, duration FROM clips WHERE id = ?').get(row.clip_id);
    return {
      id: row.id, clip: clip.slug, clipTitle: clip.title, clipRevision: row.clip_revision,
      format: clip.format, width: clip.width, height: clip.height,
      status: row.status, progress: row.progress, framesDone: row.frames_done, framesTotal: row.frames_total,
      output: row.output, poster: row.poster, srt: row.srt, error: row.error, log: row.log,
      stats: json(row.stats, {}), engine: row.engine, requestedBy: row.requested_by, runner: row.runner,
      createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
      outputPath: row.output ? join(dataDir, row.output) : null,
      posterPath: row.poster ? join(dataDir, row.poster) : null,
    };
  }

  /** Queue a render of the clip as it is now. The composition is copied, so later edits don't change it. */
  function enqueue({ clip, requestedBy = 'studio' }) {
    const row = clips.clipRow(clip);
    const comp = json(row.composition);
    const visual = comp.tracks.some((t) => t.type !== 'audio' && t.items.length);
    if (!visual) throw new StudioError(`Clip "${clip}" has nothing on its visual tracks yet; add items before rendering.`);
    const total = Math.round(comp.duration * comp.fps);
    if (total < 1) throw new StudioError(`Clip "${clip}" is shorter than one frame.`);
    const id = transaction(db, () => {
      const rid = q(`INSERT INTO renders (clip_id, clip_revision, composition, status, frames_total, engine, requested_by, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`)
        .run(row.id, row.revision, row.composition, total, ENGINE_VERSION, requestedBy, now()).lastInsertRowid;
      q('INSERT OR IGNORE INTO render_assets (render_id, version_id) SELECT ?, version_id FROM clip_assets WHERE clip_id = ?').run(rid, row.id);
      return rid;
    });
    if (timer) setImmediate(() => { tick().catch(() => {}); });
    return get(id);
  }

  const get = (id) => {
    const r = shape(q('SELECT * FROM renders WHERE id = ?').get(id));
    if (!r) throw new StudioError(`No render with id ${id}`, 'not_found');
    return r;
  };

  /** @param {{ status?: string, clip?: string, limit?: number }} [o] */
  function list({ status, clip, limit = 50 } = {}) {
    const where = [], args = [];
    if (status) { where.push('r.status = ?'); args.push(status); }
    if (clip) { where.push('r.clip_id = (SELECT id FROM clips WHERE slug = ?)'); args.push(clip); }
    return db.prepare(`SELECT r.* FROM renders r ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`).all(...args, limit).map(shape);
  }

  /** Ask for a render to stop. A queued job is cancelled at once; a running one stops within a second. */
  function cancel(id) {
    get(id);
    // a job claimed between the two statements is no longer queued, so the second one catches it
    const dequeued = q("UPDATE renders SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'").run(now(), id).changes;
    if (!dequeued && q("UPDATE renders SET cancel_requested = 1 WHERE id = ? AND status = 'running'").run(id).changes && current?.id === id) current.abort.abort();
    return get(id);
  }

  /** The pinned versions a render used. */
  function assetsOf(id) {
    return q(`SELECT a.slug, a.type, v.version, v.kind, v.title, v.thumb, a.origin_clip FROM render_assets ra JOIN asset_versions v ON v.id = ra.version_id JOIN assets a ON a.id = v.asset_id
      WHERE ra.render_id = ? ORDER BY a.type, a.slug`).all(id).map((r) => ({ ref: makeRef(r.slug, r.version), slug: r.slug, version: r.version, type: r.type, kind: r.kind, title: r.title ?? r.slug, thumb: r.thumb, originClip: library.clipSlug(r.origin_clip) }));
  }

  /** Finished renders, newest first, each with the assets it used. */
  const gallery = () => list({ status: 'done', limit: 200 }).map((r) => ({ ...r, log: undefined, assets: assetsOf(r.id) }));

  async function runJob(row) {
    const abort = new AbortController();
    current = { id: row.id, abort };
    const comp = json(row.composition);
    const clip = q('SELECT slug FROM clips WHERE id = ?').get(row.clip_id);
    const base = `renders/${clip.slug}-r${row.id}`;
    const outPath = join(dataDir, `${base}.mp4`);
    let lastWrite = 0;
    const lines = [];
    // Every write is guarded by "still running, still mine": if another runner declared this job
    // dead, or it was cancelled from another process, this one stops instead of overwriting that.
    const mine = "id = ? AND status = 'running' AND runner = ?";
    const beat = () => {
      const r = q(`UPDATE renders SET heartbeat = ? WHERE ${mine} RETURNING cancel_requested`).get(now(), row.id, runnerId);
      if (!r || r.cancel_requested) abort.abort();
    };
    // the heartbeat runs for the whole job: audio synthesis and worker start-up report no progress
    const pulse = setInterval(() => { try { beat(); } catch { /* the database was busy; the next beat will do */ } }, 2000);
    try {
      const prep0 = performance.now();
      const { bundle, audio } = await clips.bundleFor(comp);
      const prepSeconds = (performance.now() - prep0) / 1000;
      const total = row.frames_total;
      const result = await renderVideo({
        bundle, audio: audio.inputs, outPath, signal: abort.signal, hashFrames: sampleFrames(total),
        onProgress: (done) => {
          const t = Date.now();
          if (t - lastWrite < 400 && done < total) return;
          lastWrite = t;
          const r = q(`UPDATE renders SET frames_done = ?, progress = ?, heartbeat = ? WHERE ${mine} RETURNING cancel_requested`).get(done, done / total, now(), row.id, runnerId);
          if (!r || r.cancel_requested) abort.abort();
        },
      });
      if (result.log) lines.push(`ffmpeg: ${result.log}`);
      const posterFrame = Math.min(total - 1, Math.round(total * 0.4));
      const poster = await pool.run('clipFrame', { frame: posterFrame, output: 'png' }, { bundle, timeout: 60000 });
      writeFileSync(join(dataDir, `${base}.png`), Buffer.from(poster.png));
      const srtText = toSrt(comp);
      if (srtText) writeFileSync(join(dataDir, `${base}.srt`), srtText);
      const probe = await probeSummary(outPath);
      const problems = [];
      if (probe.video?.codec !== 'h264') problems.push(`video codec is ${probe.video?.codec}`);
      if (probe.video?.pixFmt !== 'yuv420p') problems.push(`pixel format is ${probe.video?.pixFmt}`);
      if (probe.audio?.codec !== 'aac') problems.push(`audio codec is ${probe.audio?.codec}`);
      if (probe.video?.width !== comp.width || probe.video?.height !== comp.height) problems.push(`size is ${probe.video?.width}x${probe.video?.height}`);
      if (Math.abs(probe.duration - comp.duration) > 0.25) problems.push(`duration is ${probe.duration}s, expected ${comp.duration}s`);
      if (problems.length) throw new Error(`The encoded file is not what was asked for: ${problems.join('; ')}`);
      const stats = {
        renderSeconds: result.seconds, prepareSeconds: Math.round(prepSeconds * 100) / 100, framesPerSecond: result.fps, workers: result.workers,
        realtimeFactor: Math.round((comp.duration / result.seconds) * 100) / 100,
        probe, frameHashes: result.hashes, audioInputs: audio.inputs.length, beats: audio.beats.length, posterFrame,
      };
      const done = q(`UPDATE renders SET status = 'done', progress = 1, frames_done = ?, output = ?, poster = ?, srt = ?, error = NULL, log = ?, stats = ?, finished_at = ?, heartbeat = ? WHERE ${mine}`)
        .run(total, `${base}.mp4`, `${base}.png`, srtText ? `${base}.srt` : null, lines.join('\n'), JSON.stringify(stats), now(), now(), row.id, runnerId);
      if (!done.changes) for (const ext of ['mp4', 'png', 'srt']) rmSync(join(dataDir, `${base}.${ext}`), { force: true });
    } catch (e) {
      rmSync(outPath, { force: true });
      // stopping the runner puts its job back in the queue; a cancel or a failure ends it
      const cancelled = e.cancelled || abort.signal.aborted;
      if (cancelled && stopping) q(`UPDATE renders SET status = 'queued', runner = NULL, progress = 0, frames_done = 0 WHERE ${mine} AND cancel_requested = 0`).run(row.id, runnerId);
      q(`UPDATE renders SET status = ?, error = ?, log = ?, finished_at = ? WHERE ${mine}`)
        .run(cancelled ? 'cancelled' : 'failed', cancelled ? null : String(e.message ?? e), lines.join('\n'), now(), row.id, runnerId);
    } finally {
      clearInterval(pulse);
      current = null;
    }
  }

  async function tick() {
    if (busy || stopping) return;
    busy = true;
    try {
      while (!stopping) {
        // a runner that died mid-render leaves a job "running" with an old heartbeat
        const stale = new Date(Date.now() - STALE_MS).toISOString();
        q("UPDATE renders SET status = 'failed', error = 'The process rendering this clip stopped before it finished.', finished_at = ? WHERE status = 'running' AND (heartbeat IS NULL OR heartbeat < ?)").run(now(), stale);
        const row = q(`UPDATE renders SET status = 'running', runner = ?, started_at = ?, heartbeat = ? WHERE id = (SELECT id FROM renders WHERE status = 'queued' ORDER BY id LIMIT 1) RETURNING *`).get(runnerId, now(), now());
        if (!row) break;
        await runJob(row);
      }
    } finally {
      busy = false;
    }
  }

  /** Start claiming queued jobs in this process. */
  function startRunner() {
    stopping = false;
    if (timer) return;
    timer = setInterval(() => { tick().catch(() => {}); }, 700);
    timer.unref();
    setImmediate(() => { tick().catch(() => {}); });
  }

  async function stopRunner() {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    current?.abort.abort();
    while (busy) await new Promise((r) => setTimeout(r, 50));
  }

  /** Resolve when the render reaches a final state (or after timeoutMs, with whatever state it is in). */
  async function wait(id, timeoutMs = 600000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const r = get(id);
      if (['done', 'failed', 'cancelled'].includes(r.status) || Date.now() > end) return r;
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  return { enqueue, get, list, cancel, gallery, assetsOf, startRunner, stopRunner, wait, tick };
}
