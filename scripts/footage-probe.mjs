// What the studio reads from video files (contract item D2): MP4, MOV, WebM made by FFmpeg's test sources, the
// committed screen recordings, and the files it refuses (HDR, no video, broken) with the message it gives.
//
//   node scripts/footage-probe.mjs [out.json]      default out: docs/showcase/v4/reports/footage-probe.json

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';
import { probeFootage } from '../src/render/footage.js';
import { ROOT } from '../src/render/host.js';

const out = process.argv[2] ?? join(ROOT, 'docs', 'showcase', 'v4', 'reports', 'footage-probe.json');
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'footage-probe-'));
const ff = async (args) => { const r = await run(ffmpegPath(), ['-v', 'error', '-y', ...args]); if (r.code !== 0) throw new Error(r.stderr); };
const file = (name) => join(dir, name);
try {
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-bf', '2', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file('testsrc-25fps.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30000/1001', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file('testsrc-29.97fps.mov')]);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=24000/1001', '-t', '1', '-c:v', 'libvpx-vp9', '-b:v', '200k', file('vp9.webm')]);
  await ff(['-display_rotation', '90', '-i', file('testsrc-25fps.mp4'), '-c', 'copy', file('rotated.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-t', '0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc', file('hdr.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:a', 'aac', file('tone-only.mp4')]);
  writeFileSync(file('broken.mp4'), Buffer.from('not a video at all'));
  const inputs = [
    ['testsrc2, 25 fps, H.264 with B-frames, a 440 Hz tone (MP4)', file('testsrc-25fps.mp4')],
    ['testsrc2, 29.97 fps, H.264 (MOV)', file('testsrc-29.97fps.mov')],
    ['testsrc2, 23.976 fps, VP9 (WebM)', file('vp9.webm')],
    ['rotated by a display matrix (90°)', file('rotated.mp4')],
    ['screen recording of the studio (scripts/record-studio.mjs)', join(ROOT, 'showcase', 'footage', 'library-search.mp4')],
    ['screen recording for clip 9 (1920×1200 at 0.75)', join(ROOT, 'showcase', 'footage', 'clip-9', 'editor-place.mp4')],
    ['HDR (PQ, BT.2020)', file('hdr.mp4')],
    ['sound only', file('tone-only.mp4')],
    ['not a video', file('broken.mp4')],
  ];
  const rows = [];
  for (const [what, path] of inputs) {
    try {
      const p = await probeFootage(path);
      const { frames, table, keyframes, ...rest } = p; // the frame table is long: its size is kept
      rows.push({ what, file: path.startsWith(ROOT) ? path.slice(ROOT.length + 1).replace(/\\/g, '/') : path.replace(/.*[\\/]/, ''), ok: true, probe: { ...rest, frames: Array.isArray(frames) ? frames.length : frames, tableEntries: Array.isArray(table) ? table.length : null, keyframes: Array.isArray(keyframes) ? keyframes.length : keyframes } });
    } catch (e) {
      const name = path.replace(/.*[\\/]/, '');
      rows.push({ what, file: name, ok: false, error: e.message.split(path).join(name) });
    }
  }
  writeFileSync(out, `${JSON.stringify({ written: 'scripts/footage-probe.mjs', files: rows }, null, 1)}\n`);
  for (const r of rows) console.log(`${r.ok ? '✓' : '✖'} ${r.what}: ${r.ok ? `${r.probe.width}×${r.probe.height}, ${r.probe.fps} fps, ${r.probe.duration} s, ${r.probe.frames} frames${r.probe.audio ? ', audio' : ''}${r.probe.rotation ? `, rotation ${r.probe.rotation}` : ''}` : r.error}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
