// Locating and running FFmpeg. FFMPEG_PATH / FFPROBE_PATH win; then PATH; then the winget links
// folder, where `winget install ffmpeg` puts the shims on Windows.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const found = {};
function locate(name) {
  if (found[name]) return found[name];
  const env = process.env[`${name.toUpperCase()}_PATH`];
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [env, name];
  if (name === 'ffprobe' && process.env.FFMPEG_PATH) candidates.unshift(join(dirname(process.env.FFMPEG_PATH), exe));
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe));
  for (const c of candidates) {
    if (!c) continue;
    if (c !== name && !existsSync(c)) continue;
    const r = spawnSync(c, ['-version'], { stdio: 'ignore', windowsHide: true });
    if (!r.error && r.status === 0) return (found[name] = c);
  }
  throw new Error(`${name} was not found. Install FFmpeg, or set ${name.toUpperCase()}_PATH to the executable.`);
}

export const ffmpegPath = () => locate('ffmpeg');
export const ffprobePath = () => locate('ffprobe');

/**
 * Run a command to completion → { code, stdout (Buffer), stderr (string) }.
 * @param {string} cmd @param {string[]} args @param {{ input?: any, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ code: number, stdout: Buffer, stderr: string }>}
 */
export function run(cmd, args, { input, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, signal });
    const out = [], err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** ffprobe → { format, streams } (parsed JSON). */
export async function probe(file) {
  const r = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout.toString('utf8'));
}

/** The facts the studio checks about a rendered file. */
export async function probeSummary(file) {
  const p = await probe(file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: Number(p.format.duration),
    size: Number(p.format.size),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: d ? n / d : 0, pixFmt: v.pix_fmt, frames: Number(v.nb_frames) } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : null,
  };
}
