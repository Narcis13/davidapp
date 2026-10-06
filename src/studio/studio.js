// The studio: one object that owns the database, the render workers and the services built on
// them. The HTTP server, the MCP server, the CLI and the tests all go through this.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_VERSION, FORMATS, makeRef } from '../core/engine.js';
import { openDb, json } from '../db/db.js';
import { mapParams } from '../core/schema.js';
import { WorkerPool } from '../render/pool.js';
import { ROOT } from '../render/host.js';
import { mixToWav, defaultWorkers } from '../render/video.js';
import { createCanvas, loadImage } from '../render/host.js';
import { createLibrary, StudioError, SLUG_RE } from './library.js';
import { createClips } from './clips.js';
import { createRenders } from './renders.js';
import { createLineage } from './lineage.js';
import { createEvents } from './events.js';
import { createRequests } from './requests.js';
import { createUploads } from './uploads.js';
import { createCompounding } from './compounding.js';

export { StudioError };

export const defaultDataDir = () => resolve(process.env.STUDIO_DATA ?? join(ROOT, 'data'));

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export function createStudio({ dataDir = defaultDataDir(), role = 'studio', poolSize = 2, runner = false } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'studio.db'));
  const pool = new WorkerPool({ size: poolSize });
  const ctx = { db, dataDir, pool, role, events: null };
  const events = createEvents(ctx);
  ctx.events = events;
  const library = createLibrary(ctx);
  const clips = createClips(ctx, library);
  const renders = createRenders(ctx, library, clips);
  const lineage = createLineage(ctx, library, clips);
  // frame helpers below are function declarations, so they exist already
  const requests = createRequests(ctx, library, clips, { assetSheet, clipFrame, clipSheet });
  const uploads = createUploads(ctx, library);
  const compounding = createCompounding(ctx, library, clips);
  library.seedFonts();
  if (runner) renders.startRunner();
  const framesDir = join(dataDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  function sizeOf({ format, width, height }, formats) {
    if (width && height) {
      if (![width, height].every((v) => Number.isInteger(v) && v >= 16 && v <= 3840)) throw new StudioError('width and height must be integers between 16 and 3840');
      return { width, height };
    }
    const name = format ?? (formats?.includes('horizontal') || !formats?.length ? 'horizontal' : formats[0]);
    const f = FORMATS[name];
    if (!f) throw new StudioError(`Unknown format "${name}"; use ${Object.keys(FORMATS).join(', ')} or give width and height`);
    return { width: f.width, height: f.height };
  }

  const fail = (e) => { throw e instanceof StudioError ? e : new StudioError(e.message, 'rejected', { logs: e.logs }); };

  /** A bundle holding saved assets plus one unsaved draft (validated first, with its default parameters). */
  async function draftBundle({ slug = 'draft', source }) {
    if (!SLUG_RE.test(slug)) throw new StudioError(`"${slug}" is not a valid asset name: use lowercase letters, digits and dashes`);
    const existing = library.versionRow(slug);
    const version = (existing?.latest_version ?? 0) + 1;
    const v = await library.validate({ slug, version, source });
    const ref = makeRef(slug, version);
    const b = library.bundle([...new Set(Object.values(v.deps))]);
    return { ref, validation: v, bundle: { ...b, key: sha1(`draft|${source}|${b.key}`), assets: { ...b.assets, [ref]: { source, deps: v.deps } } } };
  }

  /**
   * What a worker needs to draw one asset: a saved version (ref) or a draft (source). Assets and
   * images named in the parameters are pinned and bundled too.
   */
  /** @param {{ ref?: string, source?: string, slug?: string, params?: any }} o */
  async function loadAsset({ ref, source, slug, params = {} }) {
    const extra = [];
    const pin = (schema) => mapParams(schema, params, ['asset', 'image'], (value) => {
      const row = library.requireVersion(value);
      extra.push(makeRef(row.slug, row.version));
      return extra[extra.length - 1];
    });
    if (source !== undefined) {
      const d = await draftBundle({ slug, source });
      const m = d.validation.meta;
      const pinned = pin(m.schema);
      const more = extra.length ? library.bundle(extra) : null;
      const bundle = more ? { ...d.bundle, key: sha1(d.bundle.key + more.key), assets: { ...more.assets, ...d.bundle.assets }, images: { ...more.images, ...d.bundle.images } } : d.bundle;
      return { bundle, target: d.ref, formats: m.formats, natural: m.duration, params: pinned };
    }
    const row = library.requireVersion(ref);
    if (row.type !== 'function') throw new StudioError(`${ref} is a ${row.type} asset; only function assets render frames`);
    const target = makeRef(row.slug, row.version);
    const pinned = pin(json(row.schema, {}));
    return { bundle: library.bundle([target, ...extra]), target, formats: json(row.formats, []), natural: row.duration, params: pinned };
  }

  /**
   * One frame of one asset as PNG. Give `ref` for a saved version or `source` for a draft.
   * → { png (Buffer), width, height, hash?, ref }
   */
  async function assetFrame({ ref, source, slug, params = {}, t, duration, format, width, height, background, maxSize, hash, fps = 30, seed = 1 }) {
    const a = await loadAsset({ ref, source, slug, params });
    const size = sizeOf({ format, width, height }, a.formats);
    const d = duration ?? a.natural ?? 3;
    const r = await pool.run('assetFrame', { ref: a.target, params: a.params, t: t ?? Math.round(d * 0.6 * fps) / fps, duration: d, ...size, fps, seed, background: background ?? '#101018', output: 'png', maxSize, hash }, { bundle: a.bundle, timeout: 20000 }).catch(fail);
    return { ...r, png: Buffer.from(r.png), ref: a.target };
  }

  /** A filmstrip of one asset across its duration → { png, width, height, times, ref }. */
  async function assetSheet({ ref, source, slug, params = {}, count = 8, cols, duration, format, width, height, cellWidth, fps = 30, seed = 1 }) {
    const a = await loadAsset({ ref, source, slug, params });
    const size = sizeOf({ format, width, height }, a.formats);
    const d = duration ?? a.natural ?? 3;
    const n = Math.max(1, Math.min(24, count));
    const times = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) / n) * d * fps) / fps);
    const r = await pool.run('assetSheet', { ref: a.target, params: a.params, times, duration: d, ...size, fps, seed, cols: cols ?? Math.min(n, size.width > size.height ? 4 : 6), cellWidth: cellWidth ?? (size.width > size.height ? 480 : 270) }, { bundle: a.bundle, timeout: 40000 }).catch(fail);
    return { ...r, png: Buffer.from(r.png), times, ref: a.target };
  }

  async function compositionOf({ clip, composition }) {
    if (composition) return clips.prepare(composition).composition;
    return clips.getClip(clip).composition;
  }

  /**
   * One frame of a clip (saved, or a draft composition) → { png, width, height, hash?, frame, t }.
   * @param {{ clip?: string, composition?: any, t?: number, frame?: number, maxSize?: number, hash?: boolean }} o
   */
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

  const mixing = new Map();
  /** The clip's audio mixed to a WAV file (cached) → path. */
  async function clipAudio({ clip, composition }) {
    const comp = await compositionOf({ clip, composition });
    const { audio } = await clips.bundleFor(comp);
    const file = join(dataDir, 'cache', 'audio', `mix-${sha1(JSON.stringify([audio.inputs, comp.duration]))}.wav`);
    if (existsSync(file)) return file;
    // one mix at a time per file, written under a temp name so a reader never gets half a WAV
    let job = mixing.get(file);
    if (!job) {
      const tmp = file.replace(/\.wav$/, `.${process.pid}.${Date.now()}.tmp.wav`);
      job = mixToWav(audio.inputs, comp.duration, tmp).then(() => { renameSync(tmp, file); return file; }).finally(() => mixing.delete(file));
      mixing.set(file, job);
    }
    return job;
  }

  /**
   * Bake a visual asset (a 3D scene, anything expensive) into a frame-sequence asset: PNG frames with
   * a transparent background, rendered in parallel. The bake is cached by asset version, params, size,
   * fps and duration: asking again returns the sequence already made (cached: true).
   * @param {{ ref: string, slug: string, params?: any, format?: string, width?: number, height?: number, fps?: number, duration?: number, description?: string, tags?: string[], title?: string, author: string, forClip?: string }} o
   */
  async function bakeSequence({ ref, slug, params = {}, format, width, height, fps = 30, duration, description, tags, title, author, forClip }) {
    const a = await loadAsset({ ref, params });
    const row = library.requireVersion(a.target);
    if (row.kind !== 'visual') throw new StudioError(`${a.target} is a ${row.kind} asset; only visual assets bake to frame sequences`);
    const size = sizeOf({ format, width, height }, a.formats);
    const d = duration ?? a.natural ?? 3;
    if (!(fps >= 1 && fps <= 60) || !(d > 0 && d <= 60)) throw new StudioError('fps must be 1–60 and duration 0–60 seconds');
    const frames = Math.max(1, Math.round(d * fps));
    const key = sha1(JSON.stringify([ENGINE_VERSION, a.target, a.params, size, fps, d]));
    const hit = library.sequenceByKey(key);
    if (hit) return { asset: hit, cached: true, frames };
    const dir = mkdtempSync(join(dataDir, 'files', '.bake-'));
    const bakePool = new WorkerPool({ size: defaultWorkers() });
    const t0 = performance.now();
    try {
      let mid = null;
      await Promise.all(Array.from({ length: frames }, (_, i) => bakePool.run('assetFrame', { ref: a.target, params: a.params, t: i / fps, duration: d, ...size, fps, seed: 1, background: 'rgba(0,0,0,0)', output: 'png' }, { bundle: a.bundle, timeout: 60000 }).then((r) => {
        const png = Buffer.from(r.png);
        writeFileSync(join(dir, `${String(i).padStart(6, '0')}.png`), png);
        if (i === Math.floor(frames / 2)) mid = png;
      }))).catch(fail);
      const img = await loadImage(mid);
      const k = Math.min(1, 640 / Math.max(img.width, img.height));
      const thumb = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
      const g = thumb.getContext('2d');
      g.fillStyle = '#101018';
      g.fillRect(0, 0, thumb.width, thumb.height);
      g.drawImage(img, 0, 0, thumb.width, thumb.height);
      const seconds = Math.round((performance.now() - t0) / 10) / 100;
      const r = library.addSequence({
        slug, dir, author, forClip, derivedFrom: a.target, title, thumb: thumb.toBuffer('image/png'),
        description: description ?? `${frames} frames of ${a.target} at ${size.width}×${size.height}, ${fps} fps, with a transparent background: a baked sequence to use as a layer.`,
        tags: tags ?? ['sequence', 'baked'],
        meta: { frames, fps, width: size.width, height: size.height, duration: d, key, bakedFrom: a.target, params: a.params, bakeSeconds: seconds },
      });
      return { asset: r.asset, cached: false, frames, seconds };
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    } finally {
      await bakePool.destroy();
    }
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

  return { dataDir, db, pool, events, library, clips, renders, lineage, requests, uploads, compounding, assetFrame, assetSheet, clipFrame, clipSheet, frameHashes, clipAudio, draftBundle, bakeSequence, saveFrame, close };
}
