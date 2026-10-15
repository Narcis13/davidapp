// The parts of scripts/record-studio.mjs that do not need a browser: turning the frames a screencast
// delivered (irregular, only when the page repainted) into a constant-frame-rate video, and the
// maths of the cursor's path. Unit-tested in test/record.test.js.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ffmpegPath } from '../../src/render/ffmpeg.js';

/**
 * What a workflow module's function receives (see the list in scripts/record-studio.mjs).
 * @typedef {Record<string, any>} Recorder
 */

/**
 * Which captured frame each output frame shows: output frame k (at time k/fps) shows the last
 * captured frame at or before that time, so a frame is held from its timestamp until the next one's.
 * @param {number[]} times seconds on the video's timeline (0 = first frame), ascending
 * @param {number} fps @param {number} duration seconds → how many output frames: ceil(duration × fps)
 * @returns {number[]} one index into `times` per output frame
 */
export function sampleFrames(times, fps, duration) {
  if (!times.length) throw new Error('no frames were captured');
  const n = Math.max(1, Math.ceil(duration * fps - 1e-9));
  const out = new Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = k / fps + 1e-9; // a frame stamped exactly on a tick belongs to that tick
    while (j + 1 < times.length && times[j + 1] <= t) j++;
    out[k] = j;
  }
  return out;
}

/** The same sampling as runs: [{ frame, count }], to write each captured frame once and say how often it repeats. */
export function runs(indices) {
  const out = [];
  for (const i of indices) {
    if (out.length && out[out.length - 1].frame === i) out[out.length - 1].count++;
    else out.push({ frame: i, count: 1 });
  }
  return out;
}

/** Ease in and out: slow start, fast middle, slow stop (the cursor of a person aiming at a target). */
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** How long the cursor takes to cross `distance` pixels: a few hundred ms, longer for longer trips. */
export const travelMs = (distance) => Math.round(Math.min(900, Math.max(320, 260 + distance * 0.45)));

/**
 * @param {{ file: string, time: number }[]} frames captured files and their times (seconds, 0 = first)
 * @param {{ out: string, fps: number, duration: number, width: number, height: number, format: 'png' | 'jpeg', crf?: number, preset?: string }} o
 *   width/height: the video size in pixels (the viewport times the scale factor)
 * @returns {Promise<{ frames: number, captured: number, bytes: number }>}
 */
export async function encode(frames, { out, fps, duration, width, height, format, crf = 20, preset = 'slow' }) {
  const plan = runs(sampleFrames(frames.map((f) => f.time), fps, duration));
  const args = [
    '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', format === 'png' ? 'png' : 'mjpeg', '-i', '-',
    // RGB → BT.709 limited range, 4:2:0, even sides; UI text keeps its edges with a high-quality scaler
    '-vf', `scale=w=${width}:h=${height}:in_range=full:out_range=tv:out_color_matrix=bt709:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', out,
  ];
  const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const err = [];
  child.stderr.on('data', (d) => err.push(d));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`ffmpeg failed: ${Buffer.concat(err).toString('utf8').trim()}`))));
  });
  done.catch(() => {}); // reported where it is awaited
  child.stdin.on('error', () => {}); // ffmpeg's own error is the useful one
  let bytes = 0;
  for (const { frame, count } of plan) {
    const data = readFileSync(frames[frame].file);
    for (let i = 0; i < count; i++) {
      if (!child.stdin.write(data)) await Promise.race([new Promise((r) => child.stdin.once('drain', r)), done]);
    }
    bytes += data.length;
  }
  child.stdin.end();
  await done;
  return { frames: plan.reduce((n, r) => n + r.count, 0), captured: frames.length, bytes };
}
