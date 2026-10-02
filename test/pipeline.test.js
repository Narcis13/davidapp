// Composition → frames → MP4: the render pipeline end to end, at a small size so it stays fast.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tempStudio, seedAssets, smallComposition, AUTHOR } from './helpers.js';
import { probeSummary } from '../src/render/ffmpeg.js';
import { detectBeats } from '../src/render/wav.js';
import { toSrt } from '../src/core/composition.js';
import { createAudio } from '../src/core/lib/audio.js';

let t;
before(async () => {
  t = tempStudio();
  await t.studio.clips.createClip({ slug: 'demo', title: 'Demo', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  await seedAssets(t.studio, 'demo');
  await t.studio.clips.updateClip('demo', { composition: smallComposition() });
});
after(() => t.cleanup());

test('a clip frame is drawn from the composition and differs over time', async () => {
  const a = await t.studio.clipFrame({ clip: 'demo', t: 0.2, hash: true });
  const b = await t.studio.clipFrame({ clip: 'demo', t: 1.2, hash: true });
  assert.equal(a.width, 320);
  assert.equal(a.height, 180);
  assert.equal(a.png.subarray(1, 4).toString(), 'PNG');
  assert.notEqual(a.hash, b.hash);
});

test('the same frame hashes the same on every draw, in any order', async () => {
  const times = [0, 0.5, 1.0, 1.9];
  const first = await t.studio.frameHashes({ clip: 'demo', times });
  const second = await t.studio.frameHashes({ clip: 'demo', times: [...times].reverse() });
  assert.deepEqual(first.map((x) => x.hash), second.reverse().map((x) => x.hash));
});

test('rendering produces a playable H.264/AAC MP4 with poster, stats and sampled hashes', async () => {
  const job = t.studio.renders.enqueue({ clip: 'demo', requestedBy: 'test' });
  assert.equal(job.status, 'queued');
  t.studio.renders.startRunner();
  const done = await t.studio.renders.wait(job.id, 60000);
  assert.equal(done.status, 'done', done.error ?? '');
  assert.equal(done.framesDone, 20);
  assert.ok(existsSync(done.outputPath));
  assert.ok(existsSync(done.posterPath));
  const p = await probeSummary(done.outputPath);
  assert.equal(p.video.codec, 'h264');
  assert.equal(p.video.pixFmt, 'yuv420p');
  assert.equal(p.video.width, 320);
  assert.equal(p.video.height, 180);
  assert.equal(p.video.fps, 10);
  assert.equal(p.audio.codec, 'aac');
  assert.ok(Math.abs(p.duration - 2) < 0.15, `duration ${p.duration}`);
  assert.equal(done.log, '', 'ffmpeg wrote warnings');
  // faststart: the moov atom comes before mdat
  const head = readFileSync(done.outputPath).subarray(0, 4096).toString('latin1');
  assert.ok(head.includes('moov'), 'moov atom is not at the start of the file');
  assert.ok(Object.keys(done.stats.frameHashes).length >= 3);
  assert.ok(t.studio.renders.gallery().some((g) => g.id === done.id && g.assets.some((a) => a.slug === 'scene')));

  // a second render of the same clip gives the same sampled frames
  const again = await t.studio.renders.wait(t.studio.renders.enqueue({ clip: 'demo' }).id, 60000);
  assert.equal(again.status, 'done', again.error ?? '');
  assert.deepEqual(again.stats.frameHashes, done.stats.frameHashes);
});

test('a queued render can be cancelled, and a running one stops', async () => {
  await t.studio.renders.stopRunner();
  const queued = t.studio.renders.enqueue({ clip: 'demo' });
  assert.equal(t.studio.renders.cancel(queued.id).status, 'cancelled');

  await t.studio.clips.createClip({ slug: 'long', title: 'Long', author: AUTHOR, check: false, composition: { format: 'horizontal', fps: 30, duration: 120, tracks: [{ id: 'main', type: 'visual', items: [{ id: 'scene', asset: 'scene', start: 0, duration: 120 }] }] } });
  const job = t.studio.renders.enqueue({ clip: 'long' });
  t.studio.renders.startRunner();
  // 3600 full-HD frames take long enough that the cancel always lands mid-render
  for (let i = 0; i < 400 && t.studio.renders.get(job.id).framesDone < 5; i++) await new Promise((r) => setTimeout(r, 25));
  t.studio.renders.cancel(job.id);
  const end = await t.studio.renders.wait(job.id, 30000);
  assert.equal(end.status, 'cancelled');
  assert.equal(end.outputPath, null);
});

test('a clip whose asset throws fails the render with the asset named, and the queue carries on', async () => {
  await t.studio.library.createAsset({
    slug: 'late-bomb', author: AUTHOR,
    source: `asset({ description: 'Draws fine at first, then throws late in its life.', tags: ['test'], duration: 1,
      render(f) { if (f.t > 1.5) throw new Error('boom at ' + f.t.toFixed(1)); f.ctx.fillStyle = '#fff'; f.ctx.fillRect(0, 0, 10, 10); } });`,
  });
  await t.studio.clips.createClip({ slug: 'bomb', title: 'Bomb', author: AUTHOR, check: false, composition: { width: 320, height: 180, fps: 10, duration: 2, tracks: [{ type: 'visual', items: [{ id: 'b', asset: 'late-bomb', start: 0, duration: 2 }] }] } });
  const bad = await t.studio.renders.wait(t.studio.renders.enqueue({ clip: 'bomb' }).id, 60000);
  assert.equal(bad.status, 'failed');
  assert.match(bad.error, /late-bomb@1/);
  assert.match(bad.error, /boom at/);
  const ok = await t.studio.renders.wait(t.studio.renders.enqueue({ clip: 'demo' }).id, 60000);
  assert.equal(ok.status, 'done');
});

test('audio is synthesized, analysed for beats, and the beats reach the frame', async () => {
  const comp = t.studio.clips.getClip('demo').composition;
  const { audio } = await t.studio.clips.bundleFor(comp);
  assert.equal(audio.inputs.length, 1);
  assert.ok(existsSync(audio.inputs[0].path));
  // 120 bpm for 2 s → kicks at 0, 0.5, 1.0, 1.5
  assert.equal(audio.beats.length, 4, JSON.stringify(audio.beats));
  for (const [i, b] of audio.beats.entries()) assert.ok(Math.abs(b - i * 0.5) < 0.03, `beat ${i} at ${b}`);
  const wav = await t.studio.clipAudio({ clip: 'demo' });
  assert.ok(existsSync(wav));
});

test('detectBeats finds a regular pulse', () => {
  const A = createAudio(48000);
  const out = A.buffer(4);
  for (let s = 0; s < 4; s += 0.4) A.mix(out, A.tone({ freq: (x) => 50 + 100 * Math.exp(-x * 30), dur: 0.25, decay: 0.08 }), s);
  const beats = detectBeats(out, 48000);
  assert.equal(beats.length, 10);
  assert.ok(beats.every((b, i) => Math.abs(b - i * 0.4) < 0.03));
});

test('captions export as SRT with clip-relative times', () => {
  const srt = toSrt({ tracks: [{ type: 'text', items: [{ id: 'c', start: 10, duration: 5, params: { cues: [{ start: 0.5, end: 2, text: 'First *line*' }, { start: 2, end: 9, text: 'Second' }] } }] }] });
  assert.equal(srt, '1\n00:00:10,500 --> 00:00:12,000\nFirst line\n\n2\n00:00:12,000 --> 00:00:15,000\nSecond\n');
});
