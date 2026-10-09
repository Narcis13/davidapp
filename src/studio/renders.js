// The render queue. Jobs live in SQLite, so the studio server and the MCP server see the same
// queue; whichever process has a runner claims the next job atomically. Progress, cancellation and
// the results (MP4, poster, SRT, ffprobe facts, sampled frame hashes) are all rows and files.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ENGINE_VERSION, FORMATS, makeRef } from '../core/engine.js';
import { toSrt, reformat } from '../core/composition.js';
import { renderVideo, replaceAudio } from '../render/video.js';
import { analyseFile, encodedSheets } from '../render/report.js';
import { toSrt as pagesToSrt, toVtt as pagesToVtt } from '../core/captions.js';
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

const r2 = (v) => Math.round(v * 100) / 100;

/** Clip words grouped by narration item, as the render report wants them. */
const narrationOf = (words) => {
  const by = new Map();
  for (const w of words ?? []) { if (!by.has(w.item)) by.set(w.item, []); by.get(w.item).push({ text: w.text, start: w.start, end: w.end }); }
  return [...by].map(([item, list]) => ({ item, words: list }));
};

export function createRenders(ctx, library, clips, sound) {
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
    const own = row.format ? FORMATS[row.format] : null;
    return {
      id: row.id, clip: clip.slug, clipTitle: clip.title, clipRevision: row.clip_revision,
      format: row.format ?? clip.format, width: own?.width ?? clip.width, height: own?.height ?? clip.height,
      status: row.status, progress: row.progress, framesDone: row.frames_done, framesTotal: row.frames_total,
      output: row.output, poster: row.poster, srt: row.srt, error: row.error, log: row.log,
      stats: json(row.stats, {}), engine: row.engine, requestedBy: row.requested_by, runner: row.runner,
      createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
      outputPath: row.output ? join(dataDir, row.output) : null,
      posterPath: row.poster ? join(dataDir, row.poster) : null,
    };
  }

  /**
   * Queue a render of the clip as it is now. The composition is copied, so later edits don't change it.
   * format: render it in another format (vertical, horizontal, square); each item's overrides for that format apply.
   * @param {{ clip: string, requestedBy?: string, format?: string }} o
   */
  function enqueue({ clip, requestedBy = 'studio', format }) {
    const row = clips.clipRow(clip);
    if (format && !FORMATS[format]) throw new StudioError(`Unknown format "${format}"; use ${Object.keys(FORMATS).join(', ')}`);
    const other = format && format !== row.format ? format : null;
    const comp = other ? reformat(json(row.composition), other) : json(row.composition);
    const visual = comp.tracks.some((t) => t.type !== 'audio' && t.items.length);
    if (!visual) throw new StudioError(`Clip "${clip}" has nothing on its visual tracks yet; add items before rendering.`);
    const total = Math.round(comp.duration * comp.fps);
    if (total < 1) throw new StudioError(`Clip "${clip}" is shorter than one frame.`);
    const id = transaction(db, () => {
      const rid = q(`INSERT INTO renders (clip_id, clip_revision, composition, status, frames_total, engine, requested_by, created_at, format) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`)
        .run(row.id, row.revision, other ? JSON.stringify(comp) : row.composition, total, ENGINE_VERSION, requestedBy, now(), other).lastInsertRowid;
      q('INSERT OR IGNORE INTO render_assets (render_id, version_id) SELECT ?, version_id FROM clip_assets WHERE clip_id = ?').run(rid, row.id);
      ctx.events?.emit('render', rid, 'queued', { clip, format: other });
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
    const dequeued = transaction(db, () => {
      const n = q("UPDATE renders SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'").run(now(), id).changes;
      if (n) ctx.events?.emit('render', id, 'status', { status: 'cancelled' });
      return n;
    });
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
    const base = `renders/${clip.slug}-r${row.id}${row.format ? `-${row.format}` : ''}`;
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
    // a cancel is also honoured between the passes after the frames (report, loudness correction, sheets)
    const halt = () => { if (abort.signal.aborted) throw Object.assign(new Error('Render cancelled'), { cancelled: true }); };
    try {
      const prep0 = performance.now();
      const { bundle, audio } = await clips.bundleFor(comp);
      const prepSeconds = (performance.now() - prep0) / 1000;
      // the mix: the same WAV the preview plays (the loudness target, if any, is reached here)
      const mix0 = performance.now();
      const mixPath = await sound.mixFile(comp);
      const mixSeconds = (performance.now() - mix0) / 1000;
      // the preview plays this very file: its hash is kept with the render
      const mixSha1 = createHash('sha1').update(readFileSync(mixPath)).digest('hex');
      const total = row.frames_total;
      const result = await renderVideo({
        bundle, mixPath, outPath, signal: abort.signal, hashFrames: sampleFrames(total),
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
      // subtitles: the caption pages (built from the words) when the clip has captions, else the cues of caption items
      const pages = bundle.captions ?? null;
      const srtText = pages?.length ? pagesToSrt(pages) : toSrt(comp);
      if (srtText) writeFileSync(join(dataDir, `${base}.srt`), srtText);
      const files = {};
      if (pages?.length) { writeFileSync(join(dataDir, `${base}.vtt`), pagesToVtt(pages)); files.vtt = `${base}.vtt`; }
      if (bundle.words?.length) { writeFileSync(join(dataDir, `${base}.words.json`), JSON.stringify({ clip: clip.slug, fps: comp.fps, words: bundle.words }, null, 1)); files.words = `${base}.words.json`; }
      // the report, from the encoded file: probe facts, loudness (EBU R128), black, freezes, jumps, flashes, silences, narration
      const report0 = performance.now();
      const reportOpts = { fps: comp.fps, duration: comp.duration, width: comp.width, height: comp.height, markers: (comp.markers ?? []).map((m) => ({ ...m, type: m.type ?? 'note' })), narration: narrationOf(bundle.words) };
      halt();
      let report = await analyseFile(outPath, reportOpts);
      let loudnessSeconds = 0;
      const loud = { measured: report.loudness, master: await sound.masterInfo(comp) };
      if (comp.loudness) {
        // AAC moves the peaks a little: a file that misses the target is corrected (at most twice) with a fixed gain, and the
        // limiter if it must, each time from the mix that was just encoded and against the overshoot that encoding showed.
        // A silent mix has no integrated loudness: there is nothing to correct.
        const l0 = performance.now();
        const misses = (m) => typeof m.integrated === 'number' && Number.isFinite(m.integrated) && (Math.abs(comp.loudness.target - m.integrated) > 0.5 || m.truePeak > comp.loudness.truePeak);
        let base2 = mixPath;
        const notes = [];
        for (let round = 0; round < 2 && misses(report.loudness); round++) {
          halt();
          const fixed = await sound.correctedMix(base2, comp.loudness, report.loudness);
          await replaceAudio(outPath, fixed.path);
          notes.push(fixed.note);
          base2 = fixed.path;
          report = await analyseFile(outPath, reportOpts);
          loud.measured = report.loudness;
        }
        if (notes.length) loud.correction = notes.join(' ');
        loud.target = comp.loudness;
        loud.met = Math.abs(comp.loudness.target - report.loudness.integrated) <= 1 && report.loudness.truePeak <= comp.loudness.truePeak;
        loudnessSeconds = (performance.now() - l0) / 1000;
      }
      writeFileSync(join(dataDir, `${base}.report.json`), JSON.stringify(report, null, 1));
      files.report = `${base}.report.json`;
      files.sheets = [];
      halt();
      for (const [i, s] of (await encodedSheets(outPath, { fps: comp.fps, duration: comp.duration, markers: reportOpts.markers })).entries()) {
        writeFileSync(join(dataDir, `${base}.sheet-${i + 1}.png`), s.png);
        files.sheets.push(`${base}.sheet-${i + 1}.png`);
      }
      const reportSeconds = (performance.now() - report0) / 1000 - loudnessSeconds;
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
        mixSeconds: r2(mixSeconds), mixSha1, reportSeconds: r2(reportSeconds), loudnessSeconds: r2(loudnessSeconds),
        loudness: loud, problems: report.problems, files,
      };
      const done = transaction(db, () => {
        const d = q(`UPDATE renders SET status = 'done', progress = 1, frames_done = ?, output = ?, poster = ?, srt = ?, error = NULL, log = ?, stats = ?, finished_at = ?, heartbeat = ? WHERE ${mine}`)
          .run(total, `${base}.mp4`, `${base}.png`, srtText ? `${base}.srt` : null, lines.join('\n'), JSON.stringify(stats), now(), now(), row.id, runnerId);
        if (d.changes) ctx.events?.emit('render', row.id, 'status', { status: 'done', clip: clip.slug });
        return d;
      });
      if (!done.changes) for (const f of [`${base}.mp4`, `${base}.png`, `${base}.srt`, ...Object.values(files).flat()]) rmSync(join(dataDir, f), { force: true });
    } catch (e) {
      // everything this job wrote: the MP4, poster, subtitles, words, report, sheets and any half-made audio swap
      const prefix = `${basename(base)}.`;
      try { for (const f of readdirSync(dirname(outPath))) if (f.startsWith(prefix)) rmSync(join(dirname(outPath), f), { force: true }); } catch { rmSync(outPath, { force: true }); }
      // stopping the runner puts its job back in the queue; a cancel or a failure ends it
      const cancelled = e.cancelled || abort.signal.aborted;
      if (cancelled && stopping) q(`UPDATE renders SET status = 'queued', runner = NULL, progress = 0, frames_done = 0 WHERE ${mine} AND cancel_requested = 0`).run(row.id, runnerId);
      transaction(db, () => {
        const ended = q(`UPDATE renders SET status = ?, error = ?, log = ?, finished_at = ? WHERE ${mine}`)
          .run(cancelled ? 'cancelled' : 'failed', cancelled ? null : String(e.message ?? e), lines.join('\n'), now(), row.id, runnerId);
        if (ended.changes) ctx.events?.emit('render', row.id, 'status', { status: cancelled ? 'cancelled' : 'failed', clip: clip.slug });
      });
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
        const row = transaction(db, () => {
          const r = q(`UPDATE renders SET status = 'running', runner = ?, started_at = ?, heartbeat = ? WHERE id = (SELECT id FROM renders WHERE status = 'queued' ORDER BY id LIMIT 1) RETURNING *`).get(runnerId, now(), now());
          if (r) ctx.events?.emit('render', r.id, 'status', { status: 'running' });
          return r;
        });
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
