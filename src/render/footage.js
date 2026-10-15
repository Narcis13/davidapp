// Footage: video files as frames. Probing (size, rate, rotation, colour, audio, the frame table) when
// a file is imported, and a decoder that hands out exact frames by index, shared by everything in one
// process: the render workers ask for frames through the pool, the preview through the HTTP server.
//
// Why one shared decoder per process: render workers draw frames in any order, one worker per frame,
// so a decoder per worker would decode every frame once per worker. Here one FFmpeg process per file
// decodes forward, frames go into a bounded memory cache, and each worker gets the frame it asked for.
// A request far from where the decoder is restarts it with a seek; which frame came out is known from
// its timestamp (FFmpeg's showinfo filter, with -copyts), never assumed, so a seek that lands early or
// late cannot shift the picture by a frame. Colour conversion is explicit (matrix, range, bit-exact
// scaler flags), so the RGBA of a frame is the same every time on this machine.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { ffmpegPath, ffprobePath, run } from './ffmpeg.js';
import { frameAt } from '../core/footage.js';

export const FOOTAGE_LIMITS = { side: 4096, seconds: 20 * 60, fps: 120 };

export class FootageError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = 'FootageError'; }
}

const num = (v) => (v === undefined || v === null || v === 'N/A' ? null : Number(v));
const ratio = (s) => { const [n, d] = String(s ?? '0/1').split('/').map(Number); return d ? n / d : 0; };

/** SHA-256 of a file, streamed. */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * The matrix and range FFmpeg converts this stream's YUV with. Explicit, never the scaler's default
 * (which is BT.601 whatever the file says): unknown HD material is BT.709, unknown SD BT.601.
 */
function colourOf(v) {
  const space = v.color_space ?? null;
  const rgb = /^(rgb|bgr|gbr|argb|abgr|rgba|bgra|pal8|gray|ya)/.test(v.pix_fmt ?? '');
  const matrix = rgb ? null : space === 'bt709' ? 'bt709' : ['smpte170m', 'bt470bg', 'fcc'].includes(space) ? 'bt601' : space === 'bt2020nc' || space === 'bt2020c' ? 'bt2020' : (v.height ?? 0) >= 720 ? 'bt709' : 'bt601';
  const range = rgb ? 'pc' : v.color_range === 'pc' || /^yuvj/.test(v.pix_fmt ?? '') ? 'pc' : 'tv';
  return { matrix, range, primaries: v.color_primaries ?? null, transfer: v.color_transfer ?? null, space, assumed: !rgb && !space };
}

/**
 * Everything the studio needs to know about a video file:
 * { width, height (as displayed, after rotation), codedWidth, codedHeight, rotation, fps, frames, duration, codec, pixFmt,
 *   colour, table: { tb: [num, den], pts: [ticks] }, keyframes, audio: { codec, sampleRate, channels, duration } | null, start }.
 * The frame table comes from decoding the whole file once. HDR (PQ, HLG) is refused: the studio draws in sRGB.
 */
export async function probeFootage(path) {
  const r = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]);
  if (r.code !== 0) throw new FootageError(`This file could not be read as a video: ${r.stderr.trim().split('\n').pop() || 'ffprobe failed'}`);
  let p;
  try { p = JSON.parse(r.stdout.toString('utf8')); } catch { throw new FootageError('This file could not be read as a video'); }
  const v = (p.streams ?? []).find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!v) throw new FootageError('The file has no video stream');
  const a = (p.streams ?? []).find((s) => s.codec_type === 'audio');
  const colour = colourOf(v);
  if (['smpte2084', 'arib-std-b67'].includes(colour.transfer)) throw new FootageError(`The video is HDR (${colour.transfer === 'smpte2084' ? 'PQ' : 'HLG'}); the studio draws in SDR. Convert it to SDR BT.709 first (for example with FFmpeg's zscale and tonemap filters).`);
  const rot = (v.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation ?? num(v.tags?.rotate) ?? 0;
  const rotation = ((Math.round(-rot / 90) * 90) % 360 + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const codedWidth = v.width, codedHeight = v.height;
  if (!(codedWidth > 0 && codedHeight > 0)) throw new FootageError('The video stream has no picture size');
  if (Math.max(codedWidth, codedHeight) > FOOTAGE_LIMITS.side) throw new FootageError(`The video is ${codedWidth}×${codedHeight}; footage is at most ${FOOTAGE_LIMITS.side} pixels a side (scale it down first)`);
  const tb = String(v.time_base ?? '1/1000').split('/').map(Number);
  // the frame table: every decoded frame's presentation time, in the stream's time base
  const t = await run(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp,pts,key_frame', '-of', 'csv=p=0', path]);
  if (t.code !== 0) throw new FootageError(`The video could not be decoded: ${t.stderr.trim().split('\n').pop()}`);
  const pts = [], keyframes = [];
  for (const line of t.stdout.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [key, framePts, best] = line.split(',');
    const ticks = num(best) ?? num(framePts);
    if (ticks === null || !Number.isFinite(ticks)) continue;
    // a repeated or backwards timestamp would make two frames share a time: the later one is unreachable, so it is not listed
    if (pts.length && ticks <= pts[pts.length - 1]) continue;
    if (key === '1') keyframes.push(pts.length);
    pts.push(ticks);
  }
  if (!pts.length) throw new FootageError('The video has no frames that decode');
  const span = ((pts[pts.length - 1] - pts[0]) * tb[0]) / tb[1];
  const avg = ratio(v.avg_frame_rate) || ratio(v.r_frame_rate) || (pts.length > 1 ? (pts.length - 1) / span : 30);
  const fps = Math.round(avg * 1000) / 1000;
  if (!(fps > 0 && fps <= FOOTAGE_LIMITS.fps)) throw new FootageError(`The video's frame rate (${fps}) is outside 0–${FOOTAGE_LIMITS.fps} fps`);
  const duration = Math.round((span + 1 / fps) * 1e6) / 1e6;
  if (duration > FOOTAGE_LIMITS.seconds) throw new FootageError(`The video is ${Math.round(duration)} s long; footage is at most ${FOOTAGE_LIMITS.seconds / 60} minutes (trim it first)`);
  const steps = new Set();
  for (let i = 1; i < pts.length && steps.size < 3; i++) steps.add(pts[i] - pts[i - 1]);
  return {
    width: turned ? codedHeight : codedWidth, height: turned ? codedWidth : codedHeight, codedWidth, codedHeight, rotation,
    fps, frames: pts.length, duration, constantRate: steps.size <= 1, codec: v.codec_name, pixFmt: v.pix_fmt, colour,
    start: num(p.format?.start_time) ?? 0,
    table: { tb, pts }, keyframes,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels, duration: num(a.duration) ?? num(p.format?.duration) } : null,
    container: p.format?.format_name ?? null,
  };
}

let checksumOption = null;
/** showinfo's checksum option (FFmpeg 5+); older builds compute the checksums anyway. */
function showinfo() {
  if (checksumOption === null) {
    const r = spawnSync(ffmpegPath(), ['-hide_banner', '-h', 'filter=showinfo'], { encoding: 'utf8', windowsHide: true });
    checksumOption = /checksum/.test(r.stdout ?? '');
  }
  return checksumOption ? 'showinfo=checksum=0' : 'showinfo';
}

/** The filter chain after showinfo: the display size, the stream's own matrix and range, full-range RGBA, bit-exact. */
function convertChain(meta) {
  const c = meta.colour ?? {};
  const matrix = c.matrix ? `:in_color_matrix=${c.matrix}` : '';
  return `scale=w=${meta.width}:h=${meta.height}${matrix}:in_range=${c.range === 'pc' ? 'full' : 'limited'}:out_range=full:flags=bicubic+accurate_rnd+full_chroma_int+bitexact,format=rgba`;
}

/**
 * One FFmpeg decoding forward from a frame. next() → { pts, data } in presentation order, or null at the end.
 * The k-th picture on stdout is the k-th frame showinfo reported on stderr.
 */
class Decode {
  constructor(path, meta, fromIndex) {
    const size = meta.width * meta.height * 4;
    this.size = size;
    const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-copyts'];
    if (fromIndex > 0) {
      // halfway between the frame before and this one: the first frame at or after it is this one
      const { tb, pts } = meta.table;
      const mid = ((pts[fromIndex - 1] + pts[fromIndex]) / 2) * tb[0] / tb[1];
      // -ss counts from the file's start time
      args.push('-ss', (mid - (meta.start ?? 0)).toFixed(6));
    }
    args.push('-i', meta.path, '-map', '0:v:0', '-an', '-sn', '-dn', '-fps_mode', 'passthrough', '-vf', `${showinfo()},${convertChain(meta)}`, '-f', 'rawvideo', 'pipe:1');
    this.proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.chunks = []; this.have = 0; this.frames = []; this.times = []; this.ended = false; this.err = ''; this.last = -Infinity;
    /** @type {((v?: any) => void) | null} */
    this.waiter = null;
    this.proc.stdout.on('data', (d) => {
      this.chunks.push(d); this.have += d.length;
      while (this.have >= size) this.frames.push(this.take(size));
      // back-pressure: at most a few decoded frames wait in memory
      if (this.frames.length > 4) this.proc.stdout.pause();
      this.wake();
    });
    let line = '';
    this.proc.stderr.on('data', (d) => {
      line += d.toString('utf8');
      let i;
      while ((i = line.indexOf('\n')) >= 0) {
        const l = line.slice(0, i); line = line.slice(i + 1);
        const m = /Parsed_showinfo.*\bpts:\s*(-?\d+)/.exec(l);
        if (m) this.times.push(Number(m[1]));
        else if (/error|invalid/i.test(l) && this.err.length < 2000) this.err += `${l}\n`;
      }
      this.wake();
    });
    this.proc.on('close', () => { this.ended = true; this.wake(); });
    this.proc.on('error', (e) => { this.err += e.message; this.ended = true; this.wake(); });
  }

  take(n) {
    const out = Buffer.allocUnsafeSlow(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k);
      off += k;
      if (k === c.length) this.chunks.shift(); else this.chunks[0] = c.subarray(k);
    }
    this.have -= n;
    return out;
  }

  wake() { const w = this.waiter; this.waiter = null; w?.(); }

  async next() {
    for (;;) {
      if (this.frames.length && this.times.length) {
        const data = this.frames.shift();
        if (this.frames.length <= 2) this.proc.stdout.resume();
        return { pts: this.times.shift(), data };
      }
      if (this.ended && !this.frames.length) return null;
      if (this.ended && this.frames.length && !this.times.length) throw new FootageError('The decoder lost track of the frame times');
      await new Promise((r) => { this.waiter = r; });
    }
  }

  /** Stop decoding; resolves once FFmpeg has exited (on Windows the file stays locked until then). */
  close() {
    // 'exit', not 'close': a paused stdout with frames in it would hold 'close' back
    const gone = this.proc.exitCode !== null || this.proc.signalCode !== null ? Promise.resolve() : new Promise((r) => this.proc.once('exit', r));
    this.proc.stdout.destroy();
    try { this.proc.kill(); } catch { /* gone already */ }
    return gone;
  }
}

/** How far ahead (in frames) a reader decodes forward instead of seeking. */
const AHEAD = 90;

/** A file's decoder: serves frames by index, decoding forward or seeking, one request at a time. */
class Reader {
  constructor(meta, cache) {
    this.meta = meta; this.cache = cache;
    this.index = new Map(meta.table.pts.map((p, i) => [p, i]));
    this.decode = null; this.next = 0; this.queue = Promise.resolve(); this.used = Date.now();
  }

  get(i) {
    const job = this.queue.then(() => this.read(i));
    this.queue = job.catch(() => {});
    return job;
  }

  async read(i) {
    this.used = Date.now();
    const key = `${this.meta.path}#${i}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    let from = i, tries = 0;
    const spent = this.decode?.ended && !this.decode.frames.length;
    if (!this.decode || spent || i < this.next || i - this.next > AHEAD) this.restart(from);
    for (;;) {
      const f = await this.decode.next();
      if (!f) {
        const err = this.decode.err.trim();
        this.close();
        throw new FootageError(`Frame ${i} of ${this.meta.path} could not be decoded${err ? `: ${err.split('\n').pop()}` : ' (the file ended first)'}`);
      }
      // a frame with a time the decoder already passed (a duplicate timestamp) is not in the table twice: skip it
      if (f.pts <= this.decode.last) continue;
      this.decode.last = f.pts;
      const at = this.index.get(f.pts);
      if (at === undefined) {
        // a frame the table does not know: the decoder and the table disagree about this file
        this.close();
        throw new FootageError(`The decoder returned a frame at ${f.pts} ticks that the frame table of ${this.meta.path} does not list; import the file again`);
      }
      this.next = at + 1;
      this.cache.set(`${this.meta.path}#${at}`, f.data);
      if (at === i) return f.data;
      if (at > i) {
        // the seek landed past the frame: start again further back (a keyframe before it), then from the top
        if (++tries > 2) throw new FootageError(`Frame ${i} of ${this.meta.path} could not be reached by seeking`);
        from = tries === 1 ? Math.max(0, i - Math.ceil(this.meta.fps * 3)) : 0;
        this.restart(from);
      }
    }
  }

  restart(from) {
    this.decode?.close();
    this.decode = new Decode(this.meta.path, this.meta, from);
    this.next = from;
  }

  close() { const done = this.decode?.close() ?? Promise.resolve(); this.decode = null; return done; }
}

/** A map with a byte budget: the least recently used entries go first. */
class ByteCache {
  constructor(limit) { this.limit = limit; this.bytes = 0; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) {
    if (this.map.has(k)) { this.bytes -= this.map.get(k).length; this.map.delete(k); }
    this.map.set(k, v); this.bytes += v.length;
    while (this.bytes > this.limit && this.map.size > 1) { const [k0, v0] = this.map.entries().next().value; this.map.delete(k0); this.bytes -= v0.length; }
  }
  clear() { this.map.clear(); this.bytes = 0; }
}

const MB = 1024 * 1024;
const envMB = (name, fallback) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n * MB : fallback * MB; };

/**
 * The process's footage service: decoded frames (RGBA) by file and index, from a bounded cache
 * (STUDIO_FOOTAGE_CACHE_MB, default 512) and at most four live decoders, closed when idle.
 */
export function createFootageService({ cacheBytes = envMB('STUDIO_FOOTAGE_CACHE_MB', 512), maxReaders = 4, idleMs = 20000 } = {}) {
  const cache = new ByteCache(cacheBytes);
  const readers = new Map();
  const timer = setInterval(() => {
    for (const [k, r] of readers) if (Date.now() - r.used > idleMs) { r.close(); readers.delete(k); }
  }, 5000);
  timer.unref();

  /** meta: the footage meta with `path` (the file) added. → Buffer of width × height × 4 bytes. */
  function frame(meta, index) {
    if (!(index >= 0 && index < meta.table.pts.length)) return Promise.reject(new FootageError(`Frame ${index} is outside ${meta.path} (0–${meta.table.pts.length - 1})`));
    let r = readers.get(meta.path);
    if (!r) {
      if (readers.size >= maxReaders) {
        const [k, oldest] = [...readers].sort((x, y) => x[1].used - y[1].used)[0];
        oldest.close(); readers.delete(k);
      }
      readers.set(meta.path, (r = new Reader(meta, cache)));
    }
    return r.get(index);
  }

  /** The frame shown at source time s (seconds after the first frame). */
  const frameAtTime = (meta, s) => frame(meta, frameAt(meta.table, s));

  /** Forget a file: its decoder stops (resolved once the file is no longer open) and its frames leave the cache. */
  async function release(path) {
    const r = readers.get(path);
    readers.delete(path);
    for (const k of [...cache.map.keys()]) if (k.startsWith(`${path}#`)) { cache.bytes -= cache.map.get(k).length; cache.map.delete(k); }
    if (r) await r.close();
  }

  const stats = () => ({ cacheBytes: cache.bytes, cacheLimit: cache.limit, frames: cache.map.size, readers: readers.size });
  function close() { for (const r of readers.values()) r.close(); readers.clear(); cache.clear(); }
  return { frame, frameAtTime, release, stats, close };
}

let shared = null;
/** The one footage service of this process (the pool and the HTTP server share it). */
export const footageService = () => (shared ??= createFootageService());

/**
 * Peaks of the file's sound, 100 per second, as 0–255 (for the waveform image), or null without audio.
 * @param {string} path @param {number} seconds
 */
export async function soundPeaks(path, seconds) {
  const rate = 8000, per = rate / 100;
  const r = await run(ffmpegPath(), ['-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-t', String(Math.min(seconds, FOOTAGE_LIMITS.seconds)), '-f', 'f32le', 'pipe:1']);
  if (r.code !== 0 || !r.stdout.length) return null;
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  const n = Math.ceil(s.length / per);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * per, end = Math.min(s.length, j + per); j < end; j++) { const v = Math.abs(s[j]); if (v > m) m = v; }
    out[i] = Math.min(255, Math.round(m * 255));
  }
  return out;
}
