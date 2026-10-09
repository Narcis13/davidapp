// Composition → MP4. Worker threads draw frames in parallel (every frame is a pure function of
// its number, so order doesn't matter); the main thread writes them to FFmpeg's stdin in order as
// raw RGBA. FFmpeg encodes H.264 (yuv420p, faststart) and mixes the audio inputs into AAC.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { renameSync, rmSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { WorkerPool, RenderError } from './pool.js';
import { ffmpegPath, run } from './ffmpeg.js';

export function defaultWorkers() {
  const env = Number(process.env.STUDIO_RENDER_WORKERS);
  if (Number.isInteger(env) && env > 0) return env;
  return Math.max(1, Math.min(8, availableParallelism() - 2));
}

// FFmpeg 4.x–6.0 report back-pressure on a piped input ("Thread message queue blocking") as a
// warning whenever the encoder is slower than the frames arrive; it changes nothing in the output.
const BENIGN = /Thread message queue blocking/;

/** FFmpeg's stderr without the lines that only report back-pressure. */
export function quietLog(log) {
  return log.split(/\r?\n/).filter((line) => !BENIGN.test(line)).join('\n').trim();
}

/**
 * Replace the audio of an encoded MP4 with a WAV (a loudness correction): the video stream is copied, the audio
 * encoded as in a render (AAC 192 kb/s, 48 kHz stereo), faststart kept. Writes to a temp file, then over the MP4.
 */
export async function replaceAudio(mp4, wav) {
  const tmp = mp4.replace(/\.mp4$/, `.${process.pid}.audio.mp4`);
  const r = await run(ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-guess_layout_max', '0', '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', tmp]);
  if (r.code !== 0) { rmSync(tmp, { force: true }); throw new RenderError(`ffmpeg could not replace the audio: ${r.stderr.trim()}`); }
  renameSync(tmp, mp4);
}

/**
 * Render a composition to outPath.
 *   bundle: worker bundle with the composition and beats; mixPath: the clip's mixed audio (a WAV the length of the clip,
 *   made by studio/audio.js: the same file the preview plays), encoded as it is; without it the clip is silent
 *   onProgress(done, total); signal: AbortSignal; hashFrames: frame numbers to SHA-256 (raw RGBA).
 * Returns { frames, seconds, fps, hashes: { frame: sha256 }, log, workers }.
 * @param {any} o
 */
export async function renderVideo({ bundle, mixPath = null, outPath, workers = defaultWorkers(), signal, onProgress = () => {}, hashFrames = [], preset = 'medium', crf = 18 }) {
  const comp = bundle.composition;
  const total = Math.round(comp.duration * comp.fps);
  if (total < 1) throw new RenderError('The clip is shorter than one frame');
  const wantHash = new Set(hashFrames);
  const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-nostats',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${comp.width}x${comp.height}`, '-framerate', String(comp.fps), '-i', 'pipe:0'];
  // a WAV without a channel mask would make FFmpeg warn that it guessed the layout; aformat sets it
  if (mixPath) args.push('-guess_layout_max', '0', '-i', mixPath);
  else args.push('-f', 'lavfi', '-t', String(comp.duration), '-i', 'anullsrc=r=48000:cl=stereo');
  const graph = mixPath ? `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${+comp.duration.toFixed(3)}[aout]` : null;
  // setparams tags the frames BT.709: FFmpeg 9 ignores the -color_* output options for a raw input and writes
  // primaries and transfer as unknown (the pixels are the same either way)
  const video = '[0:v]scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709[vout]';
  args.push('-filter_complex', graph ? `${video};${graph}` : video, '-map', '[vout]', '-map', graph ? '[aout]' : '1:a',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(comp.fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', String(comp.duration), '-movflags', '+faststart', outPath);

  const started = performance.now();
  const pool = new WorkerPool({ size: workers });
  const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let log = '', closed = false;
  ff.on('close', () => { closed = true; });
  ff.stderr.on('data', (d) => { if (log.length < 20000) log += d.toString('utf8'); });
  const hashes = {};
  let failed = null;

  try {
    await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
      const fail = (e) => { if (!failed) { failed = e; reject(e); } };
      const ready = new Map();
      let next = 0, written = 0, inflight = 0, writing = false;
      const launch = () => {
        while (!failed && next < total && inflight < workers && next - written < workers * 3) {
          const frame = next++;
          inflight++;
          pool.run('clipFrame', { frame, output: 'raw', hash: wantHash.has(frame) }, { bundle, timeout: 60000 }).then((r) => {
            inflight--;
            ready.set(frame, r);
            flush();
            launch();
          }, fail);
        }
      };
      const flush = async () => {
        if (writing) return;
        writing = true;
        try {
          while (!failed && ready.has(written)) {
            const r = ready.get(written);
            ready.delete(written);
            if (r.hash) hashes[written] = r.hash;
            const ok = ff.stdin.write(Buffer.from(r.buffer));
            written++;
            onProgress(written, total);
            if (!ok) await once(ff.stdin, 'drain');
            launch();
          }
          if (written === total) ff.stdin.end();
        } catch (e) {
          fail(e);
        } finally {
          writing = false;
        }
      };
      ff.on('error', (e) => fail(new RenderError(`Could not run ffmpeg: ${e.message}`)));
      ff.stdin.on('error', (e) => fail(new RenderError(`ffmpeg closed its input early: ${e.message}\n${log}`)));
      ff.on('close', (code) => (code === 0 && written === total ? resolve() : fail(new RenderError(`ffmpeg exited with code ${code}\n${log}`))));
      signal?.addEventListener('abort', () => fail(new RenderError('Cancelled', { cancelled: true })), { once: true });
      if (signal?.aborted) fail(new RenderError('Cancelled', { cancelled: true }));
      launch();
    }));
  } catch (e) {
    ff.stdin.destroy();
    ff.kill();
    await pool.destroy();
    if (!closed) await once(ff, 'close').catch(() => {});
    rmSync(outPath, { force: true });
    throw e;
  }
  await pool.destroy();
  const seconds = (performance.now() - started) / 1000;
  return { frames: total, seconds: Math.round(seconds * 100) / 100, fps: Math.round((total / seconds) * 10) / 10, hashes, log: quietLog(log), workers };
}
