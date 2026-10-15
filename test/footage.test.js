// Footage: video files as assets, drawn frame-exactly. Test videos are made with FFmpeg's test sources (testsrc2 at
// 25 fps with a tone, VP9 at 23.976 fps, a rotated file, an HDR-tagged file) so nothing large lives in the repo.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStudio, AUTHOR } from './helpers.js';
import { ffmpegPath, run, probeSummary } from '../src/render/ffmpeg.js';
import { createFootageService, probeFootage } from '../src/render/footage.js';
import { footageTime, frameAt, footageIndex, trimRange, naturalDuration } from '../src/core/footage.js';
import { createStudio } from '../src/studio/studio.js';
import { createStudioServer } from '../src/server/http.js';
import { createCanvas } from '../src/render/host.js';
import { connect, callTool } from '../scripts/mcp.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'footage-src-'));
const ff = async (args) => {
  const r = await run(ffmpegPath(), ['-v', 'error', '-y', ...args]);
  assert.equal(r.code, 0, r.stderr);
};
const T25 = join(dir, 'testsrc-25fps.mp4'), VP9 = join(dir, 'vp9.webm'), ROT = join(dir, 'rotated.mp4'), HDR = join(dir, 'hdr.mp4'), TONE = join(dir, 'tone-only.mp4'), JUNK = join(dir, 'junk.mp4');

let t;
before(async () => {
  // 2 s of testsrc2 at 25 fps with a 440 Hz tone, H.264 with B-frames and a keyframe every second: seeks land between keyframes
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-bf', '2', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', T25]);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=24000/1001', '-t', '1', '-c:v', 'libvpx-vp9', '-b:v', '200k', VP9]);
  await ff(['-display_rotation', '90', '-i', T25, '-c', 'copy', ROT]);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-t', '0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc', HDR]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '0.5', '-c:a', 'aac', TONE]);
  writeFileSync(JUNK, 'not a video at all');
  t = tempStudio({ runner: true });
});
after(async () => {
  await t.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

test('the frame rule: clip time → trim, speed, loop, hold → the last source frame at or before it', () => {
  // 25 fps, 50 frames, 2 s
  const meta = { duration: 2, fps: 25, table: { tb: [1, 12800], pts: Array.from({ length: 50 }, (_, i) => i * 512) } };
  // a 30 fps clip: frame f shows source frame floor(f * 25 / 30) (sample and hold, no blending)
  for (let f = 0; f < 60; f++) assert.equal(footageIndex(meta, {}, f / 30), Math.min(49, Math.floor((f * 25) / 30 + 1e-9)), `clip frame ${f}`);
  // a time computed as k / 25 lands on frame k, not on the one before (floating point)
  for (let k = 0; k < 50; k++) assert.equal(frameAt(meta.table, k / 25), k);
  // trim in 0.4 s, out 1.2 s (exclusive), speed 2: 0.4 s of clip plays it, then the frame before the out point holds
  assert.equal(footageIndex(meta, { in: 0.4, out: 1.2, speed: 2 }, 0), 10);
  assert.equal(footageIndex(meta, { in: 0.4, out: 1.2, speed: 2 }, 0.2), 20);
  assert.equal(footageIndex(meta, { in: 0.4, out: 1.2, speed: 2 }, 5), 29);
  // loop: the range starts again
  assert.equal(footageIndex(meta, { in: 0.4, out: 1.2, loop: true }, 0.8), 10);
  assert.equal(footageIndex(meta, { in: 0.4, out: 1.2, loop: true }, 0.84), 11);
  // hold: one frame for the whole item, whatever the time
  assert.equal(footageIndex(meta, { hold: 1.5 }, 0), 37);
  assert.equal(footageIndex(meta, { hold: 1.5 }, 9), 37);
  // past the end of the file without loop: the last frame
  assert.equal(footageIndex(meta, {}, 10), 49);
  assert.deepEqual(trimRange({ in: 3 }, meta).a, 2);
  assert.equal(footageTime({ out: 0 }, 1, meta), 1);
  assert.equal(naturalDuration({ in: 0.5, speed: 0.5 }, meta), 3);
});

test('probing: size, rate, frames, duration, colour, sound; rotation applied; VFR time bases', async () => {
  const m = await probeFootage(T25);
  assert.equal(m.width, 320); assert.equal(m.height, 180);
  assert.equal(m.fps, 25); assert.equal(m.frames, 50); assert.equal(m.duration, 2);
  assert.equal(m.constantRate, true);
  assert.equal(m.audio.codec, 'aac'); assert.equal(m.audio.sampleRate, 48000);
  assert.equal(m.colour.matrix, 'bt601'); // untagged SD: BT.601, as players assume
  assert.equal(m.table.pts.length, 50);
  const r = await probeFootage(ROT);
  assert.equal(r.rotation, 270);
  assert.deepEqual([r.width, r.height, r.codedWidth, r.codedHeight], [180, 320, 320, 180]);
  const v = await probeFootage(VP9);
  assert.equal(v.codec, 'vp9'); assert.equal(v.audio, null);
  assert.equal(v.frames, 24); assert.equal(Math.round(v.fps * 1000), 23976);
});

test('frames by seeking equal frames decoded in order, and the cache keeps to its budget', async () => {
  for (const file of [T25, VP9, ROT]) {
    const meta = { ...(await probeFootage(file)), path: file };
    const forward = createFootageService();
    const want = [];
    for (let i = 0; i < meta.frames; i++) want.push(sha(await forward.frame(meta, i)));
    forward.close();
    assert.equal(new Set(want).size, meta.frames, `${file}: every frame differs`);
    // a one-byte cache: every request seeks (or decodes from a keyframe) again
    const random = createFootageService({ cacheBytes: 1 });
    const order = [...want.keys()].sort((a, b) => ((a * 7919) % 31) - ((b * 7919) % 31));
    for (const i of order) assert.equal(sha(await random.frame(meta, i)), want[i], `${file}: frame ${i} by seek`);
    assert.ok(random.stats().cacheBytes <= meta.width * meta.height * 4, 'one frame at most over a one-byte budget');
    random.close();
  }
  const meta = { ...(await probeFootage(T25)), path: T25 };
  const svc = createFootageService({ cacheBytes: 320 * 180 * 4 * 5 });
  for (let i = 0; i < 50; i++) await svc.frame(meta, i);
  assert.ok(svc.stats().cacheBytes <= 320 * 180 * 4 * 5);
  await assert.rejects(svc.frame(meta, 50), /outside/);
  svc.close();
});

test('footage as a layer: the drawn frame is the source frame the rule picks, in the preview bundle and the render alike', async () => {
  const { studio } = t;
  const r = await studio.library.addFootage({ slug: 'testsrc', path: T25, description: 'testsrc2 at 25 fps with a 440 Hz tone, made by FFmpeg.', author: AUTHOR });
  assert.equal(r.asset.type, 'video');
  assert.equal(r.asset.meta.frames, 50);
  assert.match(r.asset.meta.sha256, /^[0-9a-f]{64}$/);
  assert.ok(r.asset.thumb && r.asset.meta.strip.file && r.asset.meta.wave.file, 'thumbnail, filmstrip and waveform');
  await studio.clips.createClip({ slug: 'cut', title: 'Cut', author: AUTHOR, width: 320, height: 180, fps: 30, duration: 2 });
  const comp = {
    width: 320, height: 180, fps: 30, duration: 2, background: '#000000',
    tracks: [
      { id: 'v', type: 'visual', items: [
        { id: 'a', asset: 'testsrc', start: 0, duration: 1, params: { fit: 'fill', in: 0.4, speed: 1.5 } },
        { id: 'b', asset: 'testsrc', start: 1, duration: 1, params: { fit: 'fill', in: 1.2, out: 1.6, loop: true } },
      ] },
      { id: 'snd', type: 'audio', items: [{ id: 'tone', asset: 'testsrc', start: 0, duration: 2, gain: 0.5 }] },
    ],
  };
  await studio.clips.updateClip('cut', { composition: comp });
  const meta = { ...studio.library.footageMeta(studio.library.requireVersion('testsrc@1')), path: studio.library.absFile(studio.library.requireVersion('testsrc@1')) };
  const svc = createFootageService();
  const times = [0, 0.1, 0.5, 0.97, 1, 1.4, 1.43, 1.9];
  const hashes = await studio.frameHashes({ clip: 'cut', times });
  for (const h of hashes) {
    const item = h.t < 1 ? comp.tracks[0].items[0] : comp.tracks[0].items[1];
    const index = footageIndex(meta, item.params, h.frame / 30 - item.start);
    // a 1:1 fill on a black frame is a copy of the decoded frame
    assert.equal(h.hash, sha(await svc.frame(meta, index)), `clip frame ${h.frame} shows source frame ${index}`);
  }
  svc.close();
  // the browser bundle names the frame URLs and the table, so the preview picks the same frames
  const server = /** @type {any} */ (createStudioServer(studio, { env: { PATH: '' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const b = await (await fetch(`${base}/api/clips/cut/bundle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ composition: comp }) })).json();
    assert.equal(b.bundle.footage['testsrc@1'].url, '/api/footage/testsrc/1/');
    assert.equal(b.bundle.footage['testsrc@1'].meta.table.pts.length, 50);
    const png = await fetch(`${base}/api/footage/testsrc/1/7.png`);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('cache-control'), /immutable/);
    const jpg = await fetch(`${base}/api/footage/testsrc/1/7.jpg`);
    assert.equal(jpg.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${base}/api/footage/testsrc/1/99.png`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  // two renders (two worker counts) give identical frame hashes, and the footage's sound is in the mix
  const one = await studio.renders.wait(studio.renders.enqueue({ clip: 'cut', options: { workers: 1 } }).id, 120000);
  const two = await studio.renders.wait(studio.renders.enqueue({ clip: 'cut', options: { workers: 3 } }).id, 120000);
  assert.equal(one.status, 'done', one.error ?? '');
  assert.equal(two.status, 'done', two.error ?? '');
  assert.deepEqual(one.stats.frameHashes, two.stats.frameHashes);
  const p = await probeSummary(one.outputPath);
  assert.equal(p.audio.codec, 'aac');
  assert.ok(one.stats.loudness.measured.integrated > -40, `the tone is heard (${one.stats.loudness.measured.integrated} LUFS)`);
});

test('footage in an image parameter: a visual asset sees the frame at its own time', async () => {
  const { studio } = t;
  // the default is an image (footage is set on the item: a default is drawn when the asset is validated, without footage)
  const still = createCanvas(32, 18);
  still.getContext('2d').fillStyle = '#ff8800';
  still.getContext('2d').fillRect(0, 0, 32, 18);
  await studio.library.addFileAsset({ slug: 'still', type: 'image', data: still.toBuffer('image/png'), ext: '.png', description: 'An orange still for the default picture.', author: AUTHOR });
  await studio.library.createAsset({ slug: 'framed', author: AUTHOR, source: `asset({
  description: 'Draws an image parameter inset by a margin: a frame around a picture.',
  tags: ['frame', 'test'],
  params: { picture: { type: 'image', default: 'still' }, margin: { type: 'number', default: 20 } },
  render(f, p) {
    f.ctx.fillStyle = '#334455'; f.ctx.fillRect(0, 0, f.width, f.height);
    if (p.picture) f.ctx.drawImage(f.image(p.picture), p.margin, p.margin, f.width - 2 * p.margin, f.height - 2 * p.margin);
  },
});` });
  const comp = { width: 320, height: 180, fps: 30, duration: 1, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'f', asset: 'framed', start: 0, duration: 1, params: { picture: 'testsrc' } }] }] };
  const [a, b] = await studio.frameHashes({ composition: comp, times: [0.2, 0.6] });
  assert.notEqual(a.hash, b.hash, 'the picture moves with the asset\'s time');
  const c = await studio.clipFrame({ composition: comp, t: 0.6 });
  assert.equal(c.width, 320);
});

test('bad footage gets useful errors and crashes nothing', async () => {
  const { library, clips } = t.studio;
  await assert.rejects(library.addFootage({ slug: 'junk', path: JUNK, description: 'A text file that pretends to be a video.', author: AUTHOR }), /could not be read as a video/);
  await assert.rejects(library.addFootage({ slug: 'tone', path: TONE, description: 'Only a tone, no picture at all.', author: AUTHOR }), /no video stream/);
  await assert.rejects(library.addFootage({ slug: 'hdr', path: HDR, description: 'A file tagged as PQ HDR.', author: AUTHOR }), /HDR/);
  await assert.rejects(library.addFootage({ slug: 'nope', path: join(dir, 'missing.mp4'), description: 'A file that is not there.', author: AUTHOR }), /not found/);
  await assert.rejects(library.addFootage({ slug: 'txt', path: join(dir, 'x.txt'), description: 'Not a video extension.', author: AUTHOR }), /Unsupported video file type/);
  await library.addFootage({ slug: 'silent', path: VP9, description: 'VP9 at 23.976 fps, no sound.', author: AUTHOR });
  const base = { width: 320, height: 180, fps: 30, duration: 1 };
  assert.throws(() => clips.prepare({ ...base, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'x', asset: 'silent', start: 0, duration: 1, params: { in: 5 } }] }] }), /params\.in is 5 s, but the footage is/);
  assert.throws(() => clips.prepare({ ...base, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'x', asset: 'silent', start: 0, duration: 1, params: { in: 0.5, out: 0.2 } }] }] }), /must come after params\.in/);
  assert.throws(() => clips.prepare({ ...base, tracks: [{ id: 'a', type: 'audio', items: [{ id: 'x', asset: 'silent', start: 0, duration: 1 }] }] }), /footage without sound/);
  // no stray files are left behind by the refused imports
  assert.deepEqual(readdirSync(join(t.dataDir, 'files')).filter((x) => x.startsWith('.tmp-')), []);
});

test('MCP over stdio: add_footage and footage_frames', async () => {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-footage-mcp-'));
  await createStudio({ dataDir, role: 'test' }).close();
  const client = await connect({ dataDir, author: 'footage-test' });
  const call = (name, args) => callTool(client, name, args);
  try {
    const added = await call('add_footage', { path: T25, name: 'test-25', description: 'testsrc2 at 25 fps with a tone, made by FFmpeg.' });
    assert.ok(!added.isError, added.text);
    assert.equal(added.json.footage, 'test-25@1');
    assert.equal(added.json.frames, 50);
    assert.equal(added.json.audio.codec, 'aac');
    const sheet = await call('footage_frames', { ref: 'test-25', times: [0, 0.5, 1.99] });
    assert.ok(!sheet.isError, sheet.text);
    assert.deepEqual(sheet.json.frames.map((f) => f.index), [0, 12, 49]);
    const bad = await call('footage_frames', { ref: 'test-25', from: 1.5, to: 1 });
    assert.ok(bad.isError);
    const junk = await call('add_footage', { path: JUNK, name: 'junk', description: 'Not a video, on purpose.' });
    assert.ok(junk.isError);
    assert.match(junk.text, /could not be read as a video/);
    const found = await call('search_assets', { type: 'video' });
    assert.ok(!found.isError, found.text);
  } finally {
    await client.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('review fixes: a zero-length loop holds its frame; keyframed params preload the frame they draw; a busy decoder closes cleanly; eight frames in one clip frame', async () => {
  const meta = { duration: 2, fps: 25, table: { tb: [1, 12800], pts: Array.from({ length: 50 }, (_, i) => i * 512) } };
  // in at the very end with loop: the one frame left holds (it used to be NaN, and frame 0)
  assert.equal(footageIndex(meta, { in: 2, loop: true }, 0.5), 49);
  // a keyframed hold: the frame preloaded for a clip frame is the frame the draw picks
  const { studio } = t;
  if (!studio.library.versionRow('testsrc@1')) await studio.library.addFootage({ slug: 'testsrc', path: T25, description: 'testsrc2 at 25 fps with a 440 Hz tone, made by FFmpeg.', author: AUTHOR });
  const ramp = { width: 320, height: 180, fps: 30, duration: 2, background: '#000000', tracks: [{ id: 'v', type: 'visual', items: [
    { id: 'a', asset: 'testsrc', start: 0, duration: 2, params: { fit: 'fill', hold: 0 }, keyframes: { 'params.hold': [{ t: 0, v: 0 }, { t: 2, v: 1.9 }] } }] }] };
  const fmeta = { ...studio.library.footageMeta(studio.library.requireVersion('testsrc@1')), path: studio.library.absFile(studio.library.requireVersion('testsrc@1')) };
  const svc = createFootageService();
  for (const h of await studio.frameHashes({ composition: ramp, times: [0.5, 1, 1.5] })) {
    assert.equal(h.hash, sha(await svc.frame(fmeta, footageIndex(fmeta, { hold: (h.frame / 30) * 0.95 }, 0))), `clip frame ${h.frame}`);
  }
  await svc.close();
  // eight footage items, each on another frame: more than the worker keeps, all drawn
  const wall = { width: 320, height: 180, fps: 30, duration: 1, background: '#000000', tracks: [{ id: 'v', type: 'visual', items: Array.from({ length: 8 }, (_, k) => ({
    id: `w${k}`, asset: 'testsrc', start: 0, duration: 1, params: { fit: 'fill', hold: k * 0.2 }, transform: { x: 0.125 + (k % 4) * 0.25, y: k < 4 ? 0.25 : 0.75, width: 0.25, height: 0.5 } })) }] };
  const [w1] = await studio.frameHashes({ composition: wall, times: [0.5] });
  const [w2] = await studio.frameHashes({ composition: wall, times: [0.5] });
  assert.equal(w1.hash, w2.hash);
  // one decoder at most: a second file evicts the first while it is reading, and its queued reads still finish
  const a = { ...(await probeFootage(T25)), path: T25 }, b = { ...(await probeFootage(VP9)), path: VP9 };
  const one = createFootageService({ maxReaders: 1 });
  const reads = [one.frame(a, 40), one.frame(a, 45)];
  await new Promise((resolve) => setTimeout(resolve, 20));
  reads.push(one.frame(b, 10), one.frame(a, 3));
  const got = await Promise.allSettled(reads);
  assert.deepEqual(got.map((g) => g.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'], JSON.stringify(got.map((g) => g.status === 'rejected' ? g.reason.message : '')));
  await one.close();
  // the files are free again: nothing still holds them open
  for (const f of [T25, VP9]) { const copy = `${f}.moved`; const { renameSync } = await import('node:fs'); renameSync(f, copy); renameSync(copy, f); }
});
