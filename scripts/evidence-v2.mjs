// Evidence for clips 4, 5 and 6 (iteration 2): every finished render (clip 4 in all three formats),
// checked with ffprobe (H.264, AAC, yuv420p, faststart, size, fps, duration within one frame),
// audio levels (volumedetect), the render log, and FFmpeg contact sheets to read frame by frame.
// The compounding table is written next to them.
//
//   STUDIO_DATA=<dir> node scripts/evidence-v2.mjs [out-dir]     (default docs/showcase/v2)

import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { ffmpegPath, ffprobePath, run } from '../src/render/ffmpeg.js';
import { ROOT } from '../src/render/host.js';

const CLIPS = ['clip-4-direct-the-studio', 'clip-5-a-library-in-3d', 'clip-6-what-the-library-holds'];
const out = process.argv[2] ?? join(ROOT, 'docs', 'showcase', 'v2');
for (const d of ['reports', 'sheets']) mkdirSync(join(out, d), { recursive: true });
const studio = createStudio({ role: 'evidence' });
const summary = [];
let failed = false;
try {
  for (const clip of CLIPS) {
    const comp = studio.clips.getClip(clip).composition;
    const seen = new Set();
    for (const r of studio.renders.list({ clip, status: 'done', limit: 20 })) {
      if (seen.has(r.format)) continue;
      seen.add(r.format);
      const name = `${clip}${r.format !== comp.format ? `-${r.format}` : ''}`;
      const mp4 = r.outputPath;
      const probe = JSON.parse((await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4])).stdout.toString('utf8'));
      const v = probe.streams.find((s) => s.codec_type === 'video'), a = probe.streams.find((s) => s.codec_type === 'audio');
      const head = readFileSync(mp4).subarray(0, 4096);
      const faststart = head.indexOf('moov') >= 0 && (head.indexOf('mdat') < 0 || head.indexOf('moov') < head.indexOf('mdat'));
      const frames = Number(v.nb_frames), expected = Math.round(comp.duration * comp.fps);
      const vol = await run(ffmpegPath(), ['-hide_banner', '-nostats', '-i', mp4, '-map', '0:a', '-af', 'volumedetect', '-f', 'null', '-']);
      const mean = Number(/mean_volume: (-?[\d.]+)/.exec(vol.stderr)?.[1]), max = Number(/max_volume: (-?[\d.]+)/.exec(vol.stderr)?.[1]);
      const checks = {
        h264: v.codec_name === 'h264', aac: a?.codec_name === 'aac', yuv420p: v.pix_fmt === 'yuv420p', faststart,
        size: `${v.width}×${v.height}` === `${r.width}×${r.height}`, fps: v.r_frame_rate === `${comp.fps}/1`,
        duration: Math.abs(frames - expected) <= 1, audible: mean > -40, logClean: !r.log,
      };
      const ok = Object.values(checks).every(Boolean);
      if (!ok) failed = true;
      writeFileSync(join(out, 'reports', `${name}.ffprobe.json`), `${JSON.stringify({ render: r.id, checks, frames, expected, duration: Number(probe.format.duration), video: { codec: v.codec_name, profile: v.profile, width: v.width, height: v.height, pix_fmt: v.pix_fmt, fps: v.r_frame_rate }, audio: { codec: a?.codec_name, sample_rate: a?.sample_rate, channels: a?.channels }, bytes: Number(probe.format.size), renderSeconds: r.stats.renderSeconds, meanVolume: mean, maxVolume: max }, null, 1)}\n`);
      // contact sheet: 4×4 frames spread over the clip
      const sheet = join(out, 'sheets', `${name}.png`);
      const fps = 16 / comp.duration;
      const cell = r.width >= r.height ? 480 : 270;
      await run(ffmpegPath(), ['-y', '-v', 'error', '-i', mp4, '-vf', `fps=${fps},scale=${cell}:-2,tile=4x4:padding=6:color=0x16161d`, '-frames:v', '1', sheet]);
      copyFileSync(r.posterPath, join(out, 'sheets', `${name}.poster.png`));
      summary.push({ name, render: r.id, ok, checks, frames, meanVolume: mean, mb: Math.round(Number(probe.format.size) / 1e5) / 10, file: mp4 });
      console.log(`${ok ? '✓' : '✖'} ${name}: ${v.width}×${v.height} ${frames} frames (expected ${expected}), ${v.codec_name}/${a?.codec_name}, ${v.pix_fmt}, faststart ${faststart}, mean ${mean} dB, ${summary.at(-1).mb} MB${ok ? '' : ` ${JSON.stringify(checks)}`}`);
    }
  }
  writeFileSync(join(out, 'reports', 'renders.json'), `${JSON.stringify(summary.map(({ file: _f, ...x }) => x), null, 1)}\n`);
  writeFileSync(join(out, 'reports', 'compounding.txt'), `${studio.compounding.table()}\n`);
  writeFileSync(join(out, 'reports', 'compounding.json'), `${JSON.stringify(studio.clips.listClips().map((c) => studio.compounding.metrics(c.slug)), null, 1)}\n`);
  writeFileSync(join(out, 'reports', 'reuse.txt'), `${studio.lineage.report()}\n`);
} finally {
  await studio.close();
}
process.exit(failed ? 1 : 0);
