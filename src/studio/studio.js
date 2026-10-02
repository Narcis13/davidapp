// The studio: one object that owns the database, the render workers and the services built on
// them. The HTTP server, the MCP server, the CLI and the tests all go through this.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORMATS, makeRef } from '../core/engine.js';
import { openDb, json } from '../db/db.js';
import { WorkerPool } from '../render/pool.js';
import { ROOT } from '../render/host.js';
import { mixToWav } from '../render/video.js';
import { createLibrary, StudioError } from './library.js';
import { createClips } from './clips.js';
import { createRenders } from './renders.js';
import { createLineage } from './lineage.js';

export { StudioError };

export const defaultDataDir = () => resolve(process.env.STUDIO_DATA ?? join(ROOT, 'data'));

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export function createStudio({ dataDir = defaultDataDir(), role = 'studio', poolSize = 2, runner = false } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'studio.db'));
  const pool = new WorkerPool({ size: poolSize });
  const ctx = { db, dataDir, pool, role };
  const library = createLibrary(ctx);
  const clips = createClips(ctx, library);
  const renders = createRenders(ctx, library, clips);
  const lineage = createLineage(ctx, library, clips);
  library.seedFonts();
  if (runner) renders.startRunner();
  const framesDir = join(dataDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  function sizeOf({ format, width, height }, formats) {
    if (width && height) return { width, height };
    const name = format ?? (formats?.includes('horizontal') || !formats?.length ? 'horizontal' : formats[0]);
    const f = FORMATS[name];
    if (!f) throw new StudioError(`Unknown format "${name}"; use ${Object.keys(FORMATS).join(', ')} or give width and height`);
    return { width: f.width, height: f.height };
  }

  const fail = (e) => { throw e instanceof StudioError ? e : new StudioError(e.message, 'rejected', { logs: e.logs }); };

  /** A bundle holding saved assets plus one unsaved draft (validated first). */
  async function draftBundle({ slug = 'draft', source, params }) {
    const existing = library.versionRow(slug);
    const version = (existing?.latest_version ?? 0) + 1;
    const v = await library.validate({ slug, version, source, params });
    const ref = makeRef(slug, version);
    const b = library.bundle([...new Set(Object.values(v.deps))]);
    return { ref, validation: v, bundle: { ...b, key: sha1(`draft|${source}|${b.key}`), assets: { ...b.assets, [ref]: { source, deps: v.deps } } } };
  }

  /**
   * One frame of one asset as PNG. Give `ref` for a saved version or `source` for a draft.
   * → { png (Buffer), width, height, hash?, ref }
   */
  async function assetFrame({ ref, source, slug, params = {}, t, duration, format, width, height, background, maxSize, hash, fps = 30, seed = 1 }) {
    let bundle, target, formats, natural;
    if (source !== undefined) {
      const d = await draftBundle({ slug, source, params });
      bundle = d.bundle; target = d.ref; formats = d.validation.meta.formats; natural = d.validation.meta.duration;
    } else {
      const row = library.requireVersion(ref);
      if (row.type !== 'function') throw new StudioError(`${ref} is a ${row.type} asset; only function assets render frames`);
      target = makeRef(row.slug, row.version); formats = json(row.formats, []); natural = row.duration;
      bundle = library.bundle([target]);
    }
    const size = sizeOf({ format, width, height }, formats);
    const d = duration ?? natural ?? 3;
    const r = await pool.run('assetFrame', { ref: target, params, t: t ?? Math.round(d * 0.6 * fps) / fps, duration: d, ...size, fps, seed, background: background ?? '#101018', output: 'png', maxSize, hash }, { bundle, timeout: 20000 }).catch(fail);
    return { ...r, png: Buffer.from(r.png), ref: target };
  }

  /** A filmstrip of one asset across its duration → { png, width, height, times, ref }. */
  async function assetSheet({ ref, source, slug, params = {}, count = 8, cols, duration, format, width, height, cellWidth, fps = 30, seed = 1 }) {
    let bundle, target, formats, natural;
    if (source !== undefined) {
      const d = await draftBundle({ slug, source, params });
      bundle = d.bundle; target = d.ref; formats = d.validation.meta.formats; natural = d.validation.meta.duration;
    } else {
      const row = library.requireVersion(ref);
      if (row.type !== 'function') throw new StudioError(`${ref} is a ${row.type} asset; only function assets render frames`);
      target = makeRef(row.slug, row.version); formats = json(row.formats, []); natural = row.duration;
      bundle = library.bundle([target]);
    }
    const size = sizeOf({ format, width, height }, formats);
    const d = duration ?? natural ?? 3;
    const n = Math.max(1, Math.min(24, count));
    const times = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) / n) * d * fps) / fps);
    const r = await pool.run('assetSheet', { ref: target, params, times, duration: d, ...size, fps, seed, cols: cols ?? Math.min(n, size.width > size.height ? 4 : 6), cellWidth: cellWidth ?? (size.width > size.height ? 480 : 270) }, { bundle, timeout: 40000 }).catch(fail);
    return { ...r, png: Buffer.from(r.png), times, ref: target };
  }

  async function compositionOf({ clip, composition }) {
    if (composition) return clips.prepare(composition).composition;
    return clips.getClip(clip).composition;
  }

  /** One frame of a clip (saved, or a draft composition) → { png, width, height, hash?, frame, t }. */
  async function clipFrame({ clip, composition, t = 0, frame, maxSize, hash }) {
    const comp = await compositionOf({ clip, composition });
    const total = Math.round(comp.duration * comp.fps);
    const n = Math.max(0, Math.min(total - 1, frame ?? Math.round(t * comp.fps)));
    const { bundle } = await clips.bundleFor(comp);
    const r = await pool.run('clipFrame', { frame: n, output: 'png', maxSize, hash }, { bundle, timeout: 30000 }).catch(fail);
    return { ...r, png: Buffer.from(r.png), frame: n, t: n / comp.fps };
  }

  /** A contact sheet of a clip drawn straight from its composition (no encode) → { png, frames }. */
  async function clipSheet({ clip, composition, count = 12, cols, cellWidth, from, to }) {
    const comp = await compositionOf({ clip, composition });
    const total = Math.round(comp.duration * comp.fps);
    const a = Math.max(0, Math.round((from ?? 0) * comp.fps)), b = Math.min(total, Math.round((to ?? comp.duration) * comp.fps));
    const n = Math.max(1, Math.min(48, count));
    const frames = Array.from({ length: n }, (_, i) => Math.min(total - 1, a + Math.floor(((i + 0.5) / n) * (b - a))));
    const wide = comp.width > comp.height;
    const { bundle } = await clips.bundleFor(comp);
    const r = await pool.run('clipSheet', { frames, cols: cols ?? (wide ? 4 : 6), cellWidth: cellWidth ?? (wide ? 480 : 270) }, { bundle, timeout: 120000 }).catch(fail);
    return { ...r, png: Buffer.from(r.png), frames };
  }

  /** SHA-256 of the raw RGBA of frames at the given times → [{ t, frame, hash }]. */
  async function frameHashes({ clip, composition, times }) {
    const comp = await compositionOf({ clip, composition });
    const total = Math.round(comp.duration * comp.fps);
    const { bundle } = await clips.bundleFor(comp);
    const out = [];
    for (const t of times) {
      const frame = Math.max(0, Math.min(total - 1, Math.round(t * comp.fps)));
      const r = await pool.run('clipFrame', { frame, output: 'none', hash: true }, { bundle, timeout: 30000 }).catch(fail);
      out.push({ t, frame, hash: r.hash });
    }
    return out;
  }

  /** The clip's audio mixed to a WAV file (cached) → path. */
  async function clipAudio({ clip, composition }) {
    const comp = await compositionOf({ clip, composition });
    const { audio } = await clips.bundleFor(comp);
    const file = join(dataDir, 'cache', 'audio', `mix-${sha1(JSON.stringify([audio.inputs, comp.duration]))}.wav`);
    if (!existsSync(file)) await mixToWav(audio.inputs, comp.duration, file);
    return file;
  }

  /** Write a PNG under the data dir's frames/ folder and return its path. */
  function saveFrame(name, png) {
    const file = join(framesDir, `${name.replace(/[^a-z0-9@._-]+/gi, '_')}.png`);
    writeFileSync(file, png);
    return file;
  }

  async function close() {
    await renders.stopRunner();
    await pool.destroy();
    db.close();
  }

  return { dataDir, db, pool, library, clips, renders, lineage, assetFrame, assetSheet, clipFrame, clipSheet, frameHashes, clipAudio, draftBundle, saveFrame, close };
}
