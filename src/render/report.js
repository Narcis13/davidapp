// What the studio checks about a finished render, from the encoded MP4 and nothing else: probe facts,
// loudness, black frames, frozen stretches, jumps, flashing, silences, and where the narration sits.
// Also the frame sheets drawn from the encoded file (what a viewer will see, not what the composition says).
//
// Only filters every FFmpeg build has: no drawtext, no libass, no whisper. Labels on the sheets are drawn
// here, in Skia.

import { spawn } from 'node:child_process';
import { open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath, probe as ffprobe, probeSummary } from './ffmpeg.js';
import { registerFonts, createCanvas } from './host.js';

// ---------------------------------------------------------------------------------------------------
// plumbing

/**
 * Run FFmpeg and hand its stdout to `onChunk` as it arrives (awaited, so a slow consumer slows FFmpeg
 * down). Resolves with the exit code and everything written to stderr.
 * @param {string[]} args @param {(chunk: Buffer) => any} onChunk
 * @returns {Promise<{ code: number | null, stderr: string }>}
 */
async function streamFfmpeg(args, onChunk) {
  const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const err = [];
  child.stderr.on('data', (d) => err.push(d));
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  closed.catch(() => {});
  try {
    for await (const chunk of child.stdout) await onChunk(chunk);
  } catch (e) {
    child.kill();
    throw e;
  }
  const code = await closed;
  return { code, stderr: Buffer.concat(err).toString('utf8') };
}

/**
 * Cut a byte stream into frames of `size` bytes. `onFrame` may be async; the buffer it gets is a view that
 * is only valid until it returns.
 * @param {number} size @param {(frame: Buffer) => any} onFrame
 */
function framer(size, onFrame) {
  let rest = Buffer.alloc(0);
  return async (/** @type {Buffer} */ chunk) => {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let off = 0;
    while (buf.length - off >= size) {
      const r = onFrame(buf.subarray(off, off + size));
      if (r && typeof r.then === 'function') await r;
      off += size;
    }
    rest = off < buf.length ? Buffer.from(buf.subarray(off)) : Buffer.alloc(0);
  };
}

const tail = (s, n = 800) => s.trim().split('\n').slice(-12).join('\n').slice(-n);
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;
const finite = (x) => (Number.isFinite(x) ? x : null);

/** m:ss.cc, the way the sheets and the problem lines write a time. */
export function clock(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000), r = cs % 6000;
  return `${m}:${String(Math.floor(r / 100)).padStart(2, '0')}.${String(r % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------
// the container: is the moov atom in front of mdat?

/** The top-level atoms of an MP4 in file order, up to and including the first of moov / mdat. */
async function leadingAtoms(path) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const hdr = Buffer.alloc(16);
    const atoms = [];
    let pos = 0;
    while (pos + 8 <= size && atoms.length < 64) {
      await fh.read(hdr, 0, 16, pos);
      let len = hdr.readUInt32BE(0);
      const type = hdr.toString('latin1', 4, 8);
      if (len === 1) len = Number(hdr.readBigUInt64BE(8));
      else if (len === 0) len = size - pos;
      atoms.push({ type, pos, len });
      if (type === 'moov' || type === 'mdat') break;
      if (len < 8) break;
      pos += len;
    }
    return atoms;
  } finally {
    await fh.close();
  }
}

/** True when the first of moov / mdat in the file is moov: playback and seeking can start before the download ends. */
export async function isFaststart(path) {
  const atoms = await leadingAtoms(path);
  const last = atoms[atoms.length - 1];
  return last?.type === 'moov';
}

// ---------------------------------------------------------------------------------------------------
// reading the FFmpeg log

function parseBlack(log, fps) {
  const out = [];
  for (const m of log.matchAll(/black_start:(\S+) black_end:(\S+) black_duration:(\S+)/g)) {
    const [start, end, duration] = [Number(m[1]), Number(m[2]), Number(m[3])];
    out.push({ start: r3(start), end: r3(end), duration: r3(duration), frames: Math.round(duration * fps) });
  }
  return out;
}

/** freeze_start / freeze_duration / freeze_end come in that order; a freeze that runs to the end of the file has no end. */
function parseFreezes(log, videoEnd) {
  const out = [];
  let open = null;
  for (const m of log.matchAll(/lavfi\.freezedetect\.freeze_(start|duration|end): (\S+)/g)) {
    const v = Number(m[2]);
    if (m[1] === 'start') {
      if (open) out.push(open);
      open = { start: v, end: null };
    } else if (m[1] === 'end' && open) {
      open.end = v;
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out.map((f) => {
    const end = f.end ?? videoEnd;
    return { start: r3(f.start), end: r3(end), duration: r3(end - f.start) };
  });
}

function parseSilences(log, audioEnd) {
  const out = [];
  let start = null;
  for (const m of log.matchAll(/silence_(start|end): (\S+)(?: \| silence_duration: (\S+))?/g)) {
    if (m[1] === 'start') {
      if (start !== null) out.push({ start, end: audioEnd });
      start = Math.max(0, Number(m[2]));
    } else if (start !== null) {
      out.push({ start, end: Number(m[2]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: audioEnd });
  return out.filter((s) => s.end > s.start).map((s) => ({ start: r3(s.start), end: r3(s.end), duration: r3(s.end - s.start) }));
}

/** The Summary block that ebur128 prints when the stream ends. */
function parseLoudness(log) {
  const at = log.lastIndexOf('Summary:');
  if (at < 0) return { integrated: null, range: null, truePeak: null };
  const s = log.slice(at);
  const num = (re) => {
    const m = re.exec(s);
    return m ? finite(Number(m[1])) : null;
  };
  return {
    integrated: num(/\bI:\s+(-?[\d.]+|-?inf)\s+LUFS/),
    range: num(/\bLRA:\s+(-?[\d.]+)\s+LU/),
    truePeak: num(/\bPeak:\s+(-?[\d.]+|-?inf)\s+dBFS/),
  };
}

// ---------------------------------------------------------------------------------------------------
// the picture: one small decode feeds the jump and the flash checks

const W = 32, H = 18, PIX = W * H, FRAME_BYTES = PIX * 3;

// 8-bit sRGB → linear light × BT.709 weight (relative luminance), and → gamma-coded × weight (luma Y')
const LIN_R = new Float64Array(256), LIN_G = new Float64Array(256), LIN_B = new Float64Array(256);
const Y_R = new Float64Array(256), Y_G = new Float64Array(256), Y_B = new Float64Array(256);
for (let v = 0; v < 256; v++) {
  const c = v / 255;
  const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  LIN_R[v] = 0.2126 * lin; LIN_G[v] = 0.7152 * lin; LIN_B[v] = 0.0722 * lin;
  Y_R[v] = 0.2126 * c; Y_G[v] = 0.7152 * c; Y_B[v] = 0.0722 * c;
}

const REGIONS = ['frame', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** Collects, per frame, the mean luma and the mean relative luminance of the whole frame and of each quarter. */
function pictureStats() {
  const luma = [];
  const lum = REGIONS.map(() => []);
  const quarter = PIX / 4;
  const q = [0, 0, 0, 0];
  return {
    luma, lum,
    /** @param {Buffer} b one 32×18 rgb24 frame */
    add(b) {
      q[0] = q[1] = q[2] = q[3] = 0;
      let y = 0;
      for (let py = 0; py < H; py++) {
        const row = py < H / 2 ? 0 : 2;
        for (let px = 0; px < W; px++) {
          const i = (py * W + px) * 3;
          const r = b[i], g = b[i + 1], bl = b[i + 2];
          q[row + (px < W / 2 ? 0 : 1)] += LIN_R[r] + LIN_G[g] + LIN_B[bl];
          y += Y_R[r] + Y_G[g] + Y_B[bl];
        }
      }
      luma.push(y / PIX);
      lum[0].push((q[0] + q[1] + q[2] + q[3]) / PIX);
      for (let k = 0; k < 4; k++) lum[k + 1].push(q[k] / quarter);
    },
  };
}

const FLASH_STEP = 0.1;      // WCAG 2.3.1: a change of at least 0.1 in relative luminance
const FLASH_DARK_BELOW = 0.8; // ...where the darker state is below 0.8
const FLASH_LIMIT = 3;       // more than 3 flashes in any 1-second period fails

/**
 * The swings of a luminance series: the turning points are found with a hysteresis of FLASH_STEP, so noise
 * smaller than a step is not a swing. A swing counts when the darker end is below FLASH_DARK_BELOW.
 * @param {number[]} L @param {number} fps
 * @returns {{ from: number, to: number }[]} times of the turning points
 */
export function luminanceSwings(L, fps) {
  const n = L.length;
  if (n < 2) return [];
  const pivots = [];
  let dir = 0;
  let lo = { i: 0, v: L[0] }, hi = { i: 0, v: L[0] };
  let ext = { i: 0, v: L[0] };
  for (let i = 1; i < n; i++) {
    const v = L[i];
    if (dir === 0) {
      if (v < lo.v) lo = { i, v };
      if (v > hi.v) hi = { i, v };
      if (hi.v - lo.v >= FLASH_STEP) {
        // the sample that just arrived is the new high or the new low, so it is the extreme of the new direction
        if (lo.i < hi.i) { pivots.push(lo); dir = 1; ext = hi; } else { pivots.push(hi); dir = -1; ext = lo; }
      }
    } else if (dir === 1) {
      if (v >= ext.v) ext = { i, v };
      else if (ext.v - v >= FLASH_STEP) { pivots.push(ext); dir = -1; ext = { i, v }; }
    } else if (v <= ext.v) ext = { i, v };
    else if (v - ext.v >= FLASH_STEP) { pivots.push(ext); dir = 1; ext = { i, v }; }
  }
  if (dir !== 0) pivots.push(ext);
  const swings = [];
  for (let k = 1; k < pivots.length; k++) {
    const a = pivots[k - 1], b = pivots[k];
    if (Math.min(a.v, b.v) < FLASH_DARK_BELOW) swings.push({ from: a.i / fps, to: b.i / fps });
  }
  return swings;
}

/**
 * Flashes per second of one series: a flash is a pair of opposing swings, so a window that holds c swings
 * holds floor(c / 2) flashes. Windows start at every swing and last one second.
 * @returns {{ max: number, failing: { start: number, end: number, count: number }[] }}
 */
export function flashWindows(L, fps) {
  const sw = luminanceSwings(L, fps);
  let max = 0;
  const failing = [];
  let j = 0;
  for (let k = 0; k < sw.length; k++) {
    if (j < k) j = k;
    while (j < sw.length && sw[j].to - sw[k].to < 1 - 1e-9) j++;
    const count = Math.floor((j - k) / 2);
    if (count > max) max = count;
    if (count > FLASH_LIMIT) {
      const span = { start: sw[k].from, end: sw[j - 1].to, count };
      const prev = failing[failing.length - 1];
      if (prev && span.start <= prev.end) { prev.end = Math.max(prev.end, span.end); prev.count = Math.max(prev.count, count); } else failing.push(span);
    }
  }
  return { max, failing };
}

function flashReport(lum, fps) {
  let maxPerSecond = 0;
  const failing = [];
  lum.forEach((series, k) => {
    const w = flashWindows(series, fps);
    if (w.max > maxPerSecond) maxPerSecond = w.max;
    for (const f of w.failing) failing.push({ start: r3(f.start), end: r3(f.end), count: f.count, region: REGIONS[k] });
  });
  failing.sort((a, b) => a.start - b.start || REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region));
  return { maxPerSecond, failing };
}

function jumpReport(luma, fps, cuts) {
  const out = [];
  for (let i = 1; i < luma.length; i++) {
    const d = luma[i] - luma[i - 1];
    if (Math.abs(d) <= 0.25) continue;
    const t = i / fps;
    if (cuts.some((c) => Math.abs(t - c) <= 1 / fps + 1e-6)) continue;
    out.push({ t: r3(t), frame: i, from: r4(luma[i - 1]), to: r4(luma[i]), delta: r4(Math.abs(d)) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// narration

function narrationReport(items, fps, end, cuts) {
  return (items ?? []).map((it) => {
    const words = [...(it.words ?? [])].sort((a, b) => a.start - b.start);
    if (!words.length) return { item: it.item, first: null, last: null, head: null, tail: null, overCuts: [], outside: [] };
    const first = words[0];
    const last = words.reduce((m, w) => (w.end > m.end ? w : m), words[0]);
    const overCuts = [];
    for (const w of words) for (const c of cuts) if (w.start + 1e-6 < c && c < w.end - 1e-6) overCuts.push({ word: w.text, t: w.start, end: w.end, cut: c });
    return {
      item: it.item,
      first: { t: first.start, frame: Math.round(first.start * fps) },
      last: { t: last.end, frame: Math.round(last.end * fps) },
      head: r3(first.start),
      tail: r3(end - last.end),
      overCuts,
      outside: words.filter((w) => w.end > end + 1e-6).map((w) => ({ text: w.text, start: w.start, end: w.end })),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// the report

/**
 * @typedef {{ t: number, type: 'cut' | 'hold' | 'beat' | 'word' | 'note', duration?: number, label?: string }} Marker
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {{ fps: number, duration: number, width?: number, height?: number, markers?: Marker[], narration?: { item: string, words: Word[] }[], silence?: { threshold?: number, minDuration?: number }, loudness?: (path: string) => Promise<{ integrated: number, range: number, truePeak: number }> }} ReportOptions
 */

/**
 * Analyse an encoded MP4. One FFmpeg pass decodes the video (black and freeze detection at full size, then a
 * 32×18 rgb24 copy to a pipe for the luma and flash checks) and the audio (silence detection and, unless a
 * loudness function is injected, EBU R128).
 * @param {string} path @param {ReportOptions} o
 */
export async function analyseFile(path, o) {
  const markers = o.markers ?? [];
  const cuts = markers.filter((m) => m.type === 'cut').map((m) => m.t);
  const holds = mergeHolds(markers.filter((m) => m.type === 'hold' && m.duration > 0), 1 / o.fps);
  const silence = { threshold: o.silence?.threshold ?? -50, minDuration: o.silence?.minDuration ?? 1.0 };

  const [summary, raw, faststart] = await Promise.all([probeSummary(path), ffprobe(path), isFaststart(path)]);
  const vs = raw.streams.find((s) => s.codec_type === 'video');
  if (!vs || !summary.video) throw new Error(`${path} has no video stream`);
  const hasAudio = !!summary.audio;

  const graph = [
    `[0:v:0]blackdetect=d=${0.9 / o.fps}:pix_th=0.10:pic_th=0.98,freezedetect=n=-60dB:d=0.5,scale=${W}:${H}:flags=area:in_color_matrix=bt709,format=rgb24[v]`,
  ];
  if (hasAudio) graph.push(`[0:a:0]silencedetect=n=${silence.threshold}dB:d=${silence.minDuration}${o.loudness ? '' : ',ebur128=peak=true:framelog=quiet'}[a]`);
  const args = ['-hide_banner', '-nostdin', '-nostats', '-v', 'info', '-i', path, '-filter_complex', graph.join(';'), '-map', '[v]', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'];
  if (hasAudio) args.push('-map', '[a]', '-f', 'null', '-');

  const pic = pictureStats();
  const [pass, injected] = await Promise.all([
    streamFfmpeg(args, framer(FRAME_BYTES, (b) => pic.add(b))),
    o.loudness && hasAudio ? o.loudness(path) : null,
  ]);
  if (pass.code !== 0) throw new Error(`ffmpeg failed analysing ${path}: ${tail(pass.stderr)}`);

  const counted = pic.luma.length;
  const declared = Number.isFinite(summary.video.frames) && summary.video.frames > 0 ? summary.video.frames : null;
  const frames = declared ?? counted;
  const videoEnd = counted / o.fps;
  const log = pass.stderr;

  const probeFacts = {
    ...summary,
    color: { primaries: vs.color_primaries ?? null, transfer: vs.color_transfer ?? null, space: vs.color_space ?? null, range: vs.color_range ?? null },
    faststart,
    frames,
  };
  const loudness = injected
    ? { integrated: finite(injected.integrated), range: finite(injected.range), truePeak: finite(injected.truePeak) }
    : hasAudio ? parseLoudness(log) : { integrated: null, range: null, truePeak: null };

  const black = parseBlack(log, o.fps);
  const freezes = parseFreezes(log, videoEnd).map((f) => ({ ...f, excused: excusedByHold(f, holds, 1 / o.fps) ? 'hold' : null }));
  const jumps = jumpReport(pic.luma, o.fps, cuts);
  const flashes = flashReport(pic.lum, o.fps);
  const silences = hasAudio ? parseSilences(log, summary.duration) : [];
  const narration = narrationReport(o.narration, o.fps, o.duration ?? summary.duration, cuts);

  const problems = [
    ...probeProblems(probeFacts, o, counted, declared),
    ...black.map((b) => `black frames at ${clock(b.start)}-${clock(b.end)} (${b.frames} frame${b.frames === 1 ? '' : 's'})`),
    ...freezes.filter((f) => !f.excused).map((f) => `frozen picture at ${clock(f.start)}-${clock(f.end)} (${f.duration.toFixed(2)} s) outside any hold`),
    ...jumpProblems(jumps),
    ...flashProblems(flashes),
    ...silences.map((s) => `silence at ${clock(s.start)}-${clock(s.end)} (${s.duration.toFixed(2)} s, below ${silence.threshold} dBFS)`),
    ...narration.flatMap((n) => n.outside.map((w) => `narration "${n.item}": word "${w.text}" (${clock(w.start)}-${clock(w.end)}) runs past the end of the clip`)),
  ];

  return { probe: probeFacts, loudness, black, freezes, jumps, flashes, silences, narration, problems };
}

/** Holds that touch or overlap become one stretch, so a freeze across two of them is still excused. */
function mergeHolds(holds, tol) {
  const spans = holds.map((h) => ({ a: h.t, b: h.t + h.duration })).sort((x, y) => x.a - y.a);
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.a <= last.b + tol) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out;
}

function excusedByHold(f, holds, tol) {
  return holds.some((h) => f.start >= h.a - tol - 1e-6 && f.end <= h.b + tol + 1e-6);
}

function probeProblems(p, o, counted, declared) {
  const out = [];
  const v = p.video;
  if (v.codec !== 'h264') out.push(`video codec is ${v.codec}, expected h264`);
  if (v.pixFmt !== 'yuv420p') out.push(`pixel format is ${v.pixFmt}, expected yuv420p`);
  const { primaries, transfer, space } = p.color;
  if (primaries !== 'bt709' || transfer !== 'bt709' || space !== 'bt709') out.push(`colour tags are ${primaries ?? 'none'}/${transfer ?? 'none'}/${space ?? 'none'} (primaries/transfer/matrix), expected bt709 for all three`);
  if (!p.audio) out.push('no audio stream');
  else {
    if (p.audio.codec !== 'aac') out.push(`audio codec is ${p.audio.codec}, expected aac`);
    if (p.audio.sampleRate !== 48000) out.push(`audio sample rate is ${p.audio.sampleRate} Hz, expected 48000 Hz`);
  }
  if (!p.faststart) out.push('moov atom is not in front of the media data (not faststart): the video cannot start playing before it is fully downloaded');
  if (o.width && o.height && (v.width !== o.width || v.height !== o.height)) out.push(`size is ${v.width}x${v.height}, expected ${o.width}x${o.height}`);
  if (Math.abs(v.fps - o.fps) > 0.01) out.push(`frame rate is ${r3(v.fps)} fps, expected ${o.fps} fps`);
  if (o.duration !== undefined && Math.abs(p.duration - o.duration) > 1 / o.fps + 1e-6) out.push(`duration is ${p.duration.toFixed(3)} s, expected ${o.duration} s (more than one frame off)`);
  if (declared !== null && declared !== counted) out.push(`the container says ${declared} frames but ${counted} decode`);
  return out;
}

function jumpProblems(jumps) {
  const line = (j) => `jump in brightness at ${clock(j.t)} (f${j.frame}): mean luma ${j.from} to ${j.to} with no cut marker`;
  if (jumps.length <= 5) return jumps.map(line);
  return [...jumps.slice(0, 3).map(line), `${jumps.length - 3} more jumps in brightness, the last at ${clock(jumps[jumps.length - 1].t)} (f${jumps[jumps.length - 1].frame})`];
}

/** One line per stretch, with the regions that fail in it. */
function flashProblems(flashes) {
  const spans = [];
  for (const f of flashes.failing) {
    const s = spans.find((x) => f.start <= x.end && f.end >= x.start);
    if (s) { s.start = Math.min(s.start, f.start); s.end = Math.max(s.end, f.end); s.count = Math.max(s.count, f.count); s.regions.push(f.region); } else spans.push({ start: f.start, end: f.end, count: f.count, regions: [f.region] });
  }
  return spans.map((s) => `flashing at ${clock(s.start)}-${clock(s.end)}: up to ${s.count} flashes in one second (limit ${FLASH_LIMIT}) in ${s.regions.includes('frame') ? 'the whole frame' : s.regions.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------
// sheets from the encoded file

/** The frame numbers a sheet set shows: every whole second, and the middle of every cut segment. */
export function sheetFrames({ fps, duration, markers = [] }) {
  const total = Math.round(duration * fps);
  const set = new Set();
  for (let s = 0; ; s++) {
    const f = Math.round(s * fps);
    if (f >= total) break;
    set.add(f);
  }
  const cuts = [...new Set(markers.filter((m) => m.type === 'cut' && m.t > 0 && m.t < duration).map((m) => m.t))].sort((a, b) => a - b);
  const edges = [0, ...cuts, duration];
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = Math.round(edges[i] * fps), b = Math.round(edges[i + 1] * fps);
    if (b > a) set.add(Math.min(total - 1, Math.floor((a + b - 1) / 2)));
  }
  return [...set].filter((f) => f >= 0 && f < total).sort((a, b) => a - b);
}

/** A balanced if() tree over the sorted frame numbers: select cost per frame is log(N), not N. */
function pickExpr(list, lo = 0, hi = list.length) {
  if (hi - lo <= 0) return '0';
  if (hi - lo === 1) return `eq(n,${list[lo]})`;
  const m = (lo + hi) >> 1;
  return `if(lt(n,${list[m]}),${pickExpr(list, lo, m)},${pickExpr(list, m, hi)})`;
}

const SHEET_PAD = 8, SHEET_GAP = 6;
const INLINE_FILTER_MAX = 8000;

/** Draw one sheet, as frame-worker's sheet() does: dark ground, cells in a grid, a dark pill with the label top left. */
function drawSheet(cells, { cols, cw, ch, fps }) {
  const n = cells.length;
  const c = Math.min(cols, n);
  const rows = Math.ceil(n / c);
  const out = createCanvas(SHEET_PAD * 2 + c * cw + (c - 1) * SHEET_GAP, SHEET_PAD * 2 + rows * ch + (rows - 1) * SHEET_GAP);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#16161d';
  ctx.fillRect(0, 0, out.width, out.height);
  cells.forEach((cell, i) => {
    const x = SHEET_PAD + (i % c) * (cw + SHEET_GAP), y = SHEET_PAD + Math.floor(i / c) * (ch + SHEET_GAP);
    const img = ctx.createImageData(cw, ch);
    img.data.set(cell.rgba);
    ctx.putImageData(img, x, y);
    const label = `${clock(cell.n / fps)} · f${cell.n}`;
    ctx.font = '600 13px "JetBrains Mono"';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x, y, tw + 10, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x + 5, y + 15);
  });
  return { png: out.toBuffer('image/png'), width: out.width, height: out.height };
}

/**
 * Frames from the encoded file, in contact sheets with the time and frame number on each cell. The frames are
 * decoded in one FFmpeg pass (a select filter on frame numbers, passthrough timing, scaled to the cell,
 * rgba to a pipe) and each sheet is drawn as soon as its cells have arrived.
 * @param {string} path
 * @param {{ fps: number, duration: number, markers?: Marker[], cellWidth?: number, cols?: number, perSheet?: number }} o
 * @returns {Promise<{ png: Buffer, frames: number[], width: number, height: number }[]>}
 */
export async function encodedSheets(path, o) {
  const { fps, duration, markers = [], cellWidth = 320, cols = 6, perSheet = 36 } = o;
  registerFonts();
  const wanted = sheetFrames({ fps, duration, markers });
  if (!wanted.length) return [];
  const raw = await ffprobe(path);
  const vs = raw.streams.find((s) => s.codec_type === 'video');
  if (!vs) throw new Error(`${path} has no video stream`);
  const cw = Math.round(cellWidth), ch = Math.max(1, Math.round((cw * vs.height) / vs.width));

  const filter = `select='${pickExpr(wanted)}',scale=${cw}:${ch}:flags=lanczos:in_color_matrix=bt709,format=rgba`;
  const out = ['-fps_mode', 'passthrough', '-frames:v', String(wanted.length), '-f', 'rawvideo', 'pipe:1'];

  /** One decode; `filterArgs` is how the filter reaches FFmpeg. */
  const decode = async (filterArgs) => {
    const sheets = [];
    let pending = [];
    let got = 0;
    const flush = () => {
      if (!pending.length) return;
      const drawn = drawSheet(pending, { cols, cw, ch, fps });
      sheets.push({ png: drawn.png, frames: pending.map((p) => p.n), width: drawn.width, height: drawn.height });
      pending = [];
    };
    const res = await streamFfmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-an', ...filterArgs, ...out], framer(cw * ch * 4, (b) => {
      pending.push({ n: wanted[got++], rgba: Buffer.from(b) });
      if (pending.length >= perSheet) flush();
    }));
    if (res.code === 0) flush();
    return { res, sheets };
  };
  const fail = (res) => new Error(`ffmpeg failed drawing sheets from ${path}: ${tail(res.stderr)}`);

  // A short filter goes on the command line. A long one (hundreds of frames) goes in a file, which
  // FFmpeg 7+ reads with -/filter:v and older builds with -filter_script:v.
  if (filter.length <= INLINE_FILTER_MAX) {
    const { res, sheets } = await decode(['-vf', filter]);
    if (res.code !== 0) throw fail(res);
    return sheets;
  }
  const dir = await mkdtemp(join(tmpdir(), 'fablecut-sheets-'));
  try {
    const script = join(dir, 'select.ffscript');
    await writeFile(script, filter);
    let run = await decode(['-/filter:v', script]);
    if (run.res.code !== 0 && /Unrecognized option|Option not found/i.test(run.res.stderr)) run = await decode(['-filter_script:v', script]);
    if (run.res.code !== 0) throw fail(run.res);
    return run.sheets;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
