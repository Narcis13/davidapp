// Render options: drafts (an animatic), workers, several formats in one request, the poster time, and
// isolating items in frames, sheets and hashes. Small clips, so every render stays fast.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStudio, seedAssets, AUTHOR } from './helpers.js';
import { probeSummary } from '../src/render/ffmpeg.js';
import { draftSize, normalizeOptions } from '../src/studio/renders.js';
import { createStudio } from '../src/studio/studio.js';
import { createStudioServer } from '../src/server/http.js';
import { connect, callTool } from '../scripts/mcp.mjs';

// a second long, ten frames: a scene under a label, and a drum track
/** @returns {any} */
const composition = () => ({
  width: 320, height: 180, fps: 10, duration: 1, background: '#101018',
  tracks: [
    { id: 'main', type: 'visual', items: [{ id: 'scene', asset: 'scene', start: 0, duration: 1, params: { title: 'Hi' } }] },
    { id: 'titles', type: 'text', items: [{ id: 'label', asset: 'label', start: 0.2, duration: 0.8, params: { text: 'Over', color: '#00ffaa' }, box: { x: 0, y: 0.6, width: 1, height: 0.4 } }] },
    { id: 'music', type: 'audio', items: [{ id: 'kick', asset: 'kick', start: 0, duration: 1, gain: 0.8 }] },
  ],
});
/** The same composition with some visual items taken out. */
const without = (...ids) => {
  const c = composition();
  for (const t of c.tracks) if (t.type !== 'audio') t.items = t.items.filter((i) => !ids.includes(i.id));
  return c;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

let t;
before(async () => {
  t = tempStudio({ runner: true });
  await t.studio.clips.createClip({ slug: 'demo', title: 'Demo', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 1 });
  await seedAssets(t.studio, 'demo');
  await t.studio.clips.updateClip('demo', { composition: composition() });
});
after(() => t.cleanup());

const finished = async (id) => {
  const r = await t.studio.renders.wait(id, 120000);
  assert.equal(r.status, 'done', r.error ?? '');
  return r;
};

test('the default draft scale is the largest of 2/3, 1/2 and 1/3 that gives whole, even pixels', () => {
  assert.deepEqual(draftSize(1920, 1080), { scale: 0.66667, width: 1280, height: 720 });
  assert.deepEqual(draftSize(1080, 1920), { scale: 0.66667, width: 720, height: 1280 });
  assert.deepEqual(draftSize(1080, 1080), { scale: 0.66667, width: 720, height: 720 });
  assert.deepEqual(draftSize(320, 180), { scale: 0.5, width: 160, height: 90 });
  assert.deepEqual(draftSize(1920, 1080, 0.5), { scale: 0.5, width: 960, height: 540 });
  // 0.6667 is what a person types for 2/3
  assert.deepEqual(draftSize(1920, 1080, 0.6667), { scale: 0.66667, width: 1280, height: 720 });
  // no scale works for 100x100: 66.7, 50 (even, but 2/3 and 1/3 are not whole)... 1/2 does, 50x50
  assert.deepEqual(draftSize(100, 100), { scale: 0.5, width: 50, height: 50 });
  assert.throws(() => draftSize(100, 50), /would be .*no draft|has no draft size|Scales that work/);
});

test('a draft is encoded at the draft size, labelled, named and probed as one, and shows the final frames', async () => {
  const draft = await finished(t.studio.renders.enqueue({ clip: 'demo', options: { draft: { scale: 0.5 } } }).id);
  const full = await finished(t.studio.renders.enqueue({ clip: 'demo' }).id);
  assert.deepEqual(draft.options, { draft: { scale: 0.5, width: 160, height: 90 } });
  assert.deepEqual(full.options, {});
  assert.equal(draft.width, 160);
  assert.equal(draft.height, 90);
  assert.equal(full.width, 320);
  assert.deepEqual(draft.stats.draft, { scale: 0.5, width: 160, height: 90, preset: 'veryfast' });
  assert.equal(full.stats.draft, undefined);
  assert.match(draft.output, new RegExp(`^renders/demo-r${draft.id}-draft\\.mp4$`));
  assert.match(draft.poster, /-draft\.png$/);
  assert.match(draft.stats.files.report, /-draft\.report\.json$/);
  assert.ok(draft.stats.files.sheets.every((f) => /-draft\.sheet-\d+\.png$/.test(f) && existsSync(join(t.dataDir, f))));
  assert.match(full.output, new RegExp(`^renders/demo-r${full.id}\\.mp4$`));
  const p = await probeSummary(draft.outputPath);
  assert.equal(p.video.width, 160);
  assert.equal(p.video.height, 90);
  assert.equal(p.video.codec, 'h264');
  assert.equal(p.video.pixFmt, 'yuv420p');
  assert.equal(p.audio.codec, 'aac');
  assert.ok(Math.abs(p.duration - 1) < 0.15, `duration ${p.duration}`);
  assert.deepEqual(draft.stats.problems, [], 'the report ran on the draft file without finding the size wrong');
  const report = JSON.parse(readFileSync(join(t.dataDir, draft.stats.files.report), 'utf8'));
  assert.equal(report.probe.video.width, 160);
  // the frames were drawn at the clip's size: the sampled hashes are those of the full render
  assert.deepEqual(draft.stats.frameHashes, full.stats.frameHashes);
  // the poster is the draft's size
  const png = readFileSync(draft.posterPath);
  assert.equal(png.readUInt32BE(16), 160);
  assert.equal(png.readUInt32BE(20), 90);
  assert.ok(readFileSync(draft.outputPath).length < readFileSync(full.outputPath).length);
});

test('a draft scale that does not give whole, even pixels is refused with the scales that work, and nothing is queued', () => {
  const before = t.studio.renders.list({ limit: 200 }).length;
  assert.throws(() => t.studio.renders.enqueue({ clip: 'demo', options: { draft: { scale: 0.55 } } }), (/** @type {any} */ e) => {
    assert.equal(e.name, 'StudioError');
    assert.match(e.message, /scale 0\.55 of a 320x180 clip would be 176x99/);
    assert.match(e.message, /Scales that work for this clip: 1\/2 \(160x90\)/);
    return true;
  });
  for (const scale of [0, 1, 1.5, -1, '0.5', NaN]) assert.throws(() => t.studio.renders.enqueue({ clip: 'demo', options: { draft: { scale } } }), /scale must be a number above 0 and below 1/);
  assert.throws(() => t.studio.renders.enqueue({ clip: 'demo', options: { draft: 'yes' } }), /draft must be true or \{ scale \}/);
  assert.equal(t.studio.renders.list({ limit: 200 }).length, before);
});

test('workers: the same clip with 1 and with 3 workers gives identical frame hashes; bad counts are refused', async () => {
  const one = await finished(t.studio.renders.enqueue({ clip: 'demo', options: { workers: 1 } }).id);
  const three = await finished(t.studio.renders.enqueue({ clip: 'demo', options: { workers: 3 } }).id);
  assert.equal(one.stats.workers, 1);
  assert.equal(three.stats.workers, 3);
  assert.deepEqual(one.options, { workers: 1 });
  assert.deepEqual(one.stats.frameHashes, three.stats.frameHashes);
  assert.ok(Object.keys(one.stats.frameHashes).length >= 3);
  for (const workers of [0, 17, 2.5, '3', null]) assert.throws(() => t.studio.renders.enqueue({ clip: 'demo', options: { workers } }), /workers must be a whole number from 1 to 16/);
});

test('unknown options are refused by name', () => {
  assert.throws(() => t.studio.renders.enqueue({ clip: 'demo', options: { drft: true } }), /Unknown render option "drft"; the options are draft, workers, poster/);
  assert.throws(() => normalizeOptions('fast', { width: 320, height: 180, duration: 1, fps: 10 }), /options must be an object/);
});

test('three formats in one request: three renders sharing one batch, each in its own shape', async () => {
  const b = t.studio.renders.enqueueBatch({ clip: 'demo', formats: ['horizontal', 'vertical', 'square'], options: { draft: { scale: 0.5 } } });
  assert.equal(b.renders.length, 3);
  assert.equal(b.batch, b.renders[0].id);
  assert.deepEqual(b.renders.map((r) => r.format), ['horizontal', 'vertical', 'square']);
  assert.ok(b.renders.every((r) => r.options.batch === b.batch && r.options.draft.scale === 0.5));
  const done = [];
  for (const r of b.renders) done.push(await finished(r.id));
  assert.deepEqual(done.map((r) => [r.stats.probe.video.width, r.stats.probe.video.height]), [[960, 540], [540, 960], [540, 540]]);
  assert.deepEqual(done.map((r) => [r.width, r.height]), [[960, 540], [540, 960], [540, 540]]);
  assert.deepEqual(done.map((r) => r.output), ['horizontal', 'vertical', 'square'].map((f, i) => `renders/demo-r${b.batch + i}-${f}-draft.mp4`));
  // the same batch is what a listing shows
  assert.equal(t.studio.renders.list({ clip: 'demo', limit: 200 }).filter((r) => r.options.batch === b.batch).length, 3);
});

test('several formats: duplicates, too many, none and unknown names are refused before anything is queued', () => {
  const count = () => t.studio.renders.list({ limit: 200 }).length;
  const n = count();
  assert.throws(() => t.studio.renders.enqueueBatch({ clip: 'demo', formats: ['vertical', 'vertical'] }), /formats must be distinct/);
  assert.throws(() => t.studio.renders.enqueueBatch({ clip: 'demo', formats: [] }), /1 to 3 of vertical, horizontal, square/);
  assert.throws(() => t.studio.renders.enqueueBatch({ clip: 'demo', formats: ['vertical', 'horizontal', 'square', 'vertical'] }), /1 to 3/);
  assert.throws(() => t.studio.renders.enqueueBatch({ clip: 'demo', formats: ['vertical', 'wide'] }), /Unknown format "wide"/);
  // the second one is refused (a bad option), the first must not stay queued
  assert.throws(() => t.studio.renders.enqueueBatch({ clip: 'demo', formats: ['vertical', 'square'], options: { workers: 99 } }), /workers/);
  assert.equal(count(), n);
});

test('the poster is the frame at poster time (round(t * fps), clamped); the default is the frame at 40 %', async () => {
  const at = await finished(t.studio.renders.enqueue({ clip: 'demo', options: { poster: 0.3 } }).id);
  assert.equal(at.stats.posterFrame, 3);
  const still = await t.studio.clipFrame({ clip: 'demo', t: 0.3 });
  assert.equal(sha(readFileSync(at.posterPath)), sha(still.png));
  // the pixels of that frame, not just its encoding
  const hashed = await t.studio.clipFrame({ clip: 'demo', t: 0.3, hash: true });
  const rawOfPoster = await t.studio.clipFrame({ clip: 'demo', frame: at.stats.posterFrame, hash: true });
  assert.equal(rawOfPoster.hash, hashed.hash);
  assert.notEqual(sha(readFileSync(at.posterPath)), sha((await t.studio.clipFrame({ clip: 'demo', t: 0.8 })).png));
  // near the end it clamps to the last frame
  const late = await finished(t.studio.renders.enqueue({ clip: 'demo', options: { poster: 0.97 } }).id);
  assert.equal(late.stats.posterFrame, 9);
  const dflt = await finished(t.studio.renders.enqueue({ clip: 'demo' }).id);
  assert.equal(dflt.stats.posterFrame, 4);
  for (const poster of [-0.1, 1, 2, 'x']) assert.throws(() => t.studio.renders.enqueue({ clip: 'demo', options: { poster } }), /poster time must be from 0 up to the clip's duration \(1 s\)/);
});

test('isolate only / except draws what a composition with just / without those items draws', async () => {
  const times = [0.1, 0.5, 0.9];
  const whole = await t.studio.frameHashes({ clip: 'demo', times });
  for (const [isolate, expected] of [
    [{ only: ['label'] }, without('scene')],
    [{ only: ['scene'] }, without('label')],
    [{ except: ['label'] }, without('label')],
    [{ except: ['scene'] }, without('scene')],
    [{ except: ['scene', 'label'] }, without('scene', 'label')],
  ]) {
    const got = await t.studio.frameHashes({ clip: 'demo', isolate, times });
    const want = await t.studio.frameHashes({ composition: expected, times });
    assert.deepEqual(got.map((x) => x.hash), want.map((x) => x.hash), JSON.stringify(isolate));
    assert.notDeepEqual(got.map((x) => x.hash), whole.map((x) => x.hash), `${JSON.stringify(isolate)} must differ from the whole clip`);
  }
  // naming everything draws the clip as it is
  assert.deepEqual((await t.studio.frameHashes({ clip: 'demo', isolate: { only: ['scene', 'label'] }, times })).map((x) => x.hash), whole.map((x) => x.hash));
  // single frames and contact sheets go through the same composition
  const one = await t.studio.clipFrame({ clip: 'demo', isolate: { only: ['label'] }, t: 0.5, hash: true });
  assert.equal(one.hash, (await t.studio.clipFrame({ composition: without('scene'), t: 0.5, hash: true })).hash);
  const sheet = await t.studio.clipSheet({ clip: 'demo', isolate: { except: ['label'] }, count: 4 });
  assert.equal(sha(sheet.png), sha((await t.studio.clipSheet({ composition: without('label'), count: 4 })).png));
  assert.notEqual(sha(sheet.png), sha((await t.studio.clipSheet({ clip: 'demo', count: 4 })).png));
  // it works on another format and on a draft composition too, and the audio is left alone
  const vertical = await t.studio.frameHashes({ clip: 'demo', format: 'vertical', isolate: { only: ['scene'] }, times: [0.5] });
  assert.equal(vertical[0].hash, (await t.studio.frameHashes({ composition: without('label'), format: 'vertical', times: [0.5] }))[0].hash);
  assert.equal(await t.studio.clipAudio({ clip: 'demo' }), await t.studio.clipAudio({ composition: composition() }));
  assert.ok(t.studio.clips.getClip('demo').composition.tracks[1].items.length === 1, 'the saved clip is not changed');
});

test('isolate: both keys, an empty list, no key, odd shapes and unknown items are errors that say what is there', async () => {
  const bad = (isolate, re) => assert.rejects(() => t.studio.clipFrame({ clip: 'demo', isolate, t: 0 }), (/** @type {any} */ e) => { assert.equal(e.name, 'StudioError'); assert.match(e.message, re); return true; });
  await bad({ only: ['scene'], except: ['label'] }, /isolate: give only or except, not both/);
  await bad({ only: [] }, /isolate: only must be a non-empty list of item ids/);
  await bad({ except: [] }, /isolate: except must be a non-empty list of item ids/);
  await bad({}, /isolate: give only: \[item ids\] or except: \[item ids\]/);
  await bad({ only: 'scene' }, /non-empty list/);
  await bad({ only: [3] }, /non-empty list/);
  await bad({ some: ['scene'] }, /unknown key "some"/);
  await bad(['scene'], /give \{ only/);
  await bad({ only: ['scene', 'nope'] }, /unknown item "nope"\. The clip's visual items: scene, label/);
  await bad({ except: ['kick'] }, /unknown item "kick" \(kick: audio is never isolated\)\. The clip's visual items: scene, label/);
  // sheets and hashes check the same way
  await assert.rejects(() => t.studio.clipSheet({ clip: 'demo', isolate: { only: ['x'] } }), /unknown item "x"/);
  await assert.rejects(() => t.studio.frameHashes({ clip: 'demo', isolate: { only: [] }, times: [0] }), /non-empty/);
});

test('HTTP: the render route takes format, formats, draft, workers and posterAt; the frame route takes isolate', async () => {
  const server = /** @type {any} */ (createStudioServer(t.studio));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    // no body: as before
    const plain = await (await post('/api/clips/demo/render')).json();
    assert.equal(plain.status === 'queued' || plain.status === 'running' || plain.status === 'done', true);
    assert.deepEqual(plain.options, {});
    const one = await (await post('/api/clips/demo/render', { draft: true, workers: 2, posterAt: 0.5 })).json();
    assert.deepEqual(one.options, { draft: { scale: 0.5, width: 160, height: 90 }, workers: 2, poster: 0.5 });
    const done = await finished(one.id);
    assert.equal(done.stats.posterFrame, 5);
    const many = await (await post('/api/clips/demo/render', { formats: ['vertical', 'square'], draft: { scale: 0.5 } })).json();
    assert.equal(many.batch, many.renders[0].id);
    assert.equal(many.renders.length, 2);
    for (const r of many.renders) await finished(r.id);
    const refused = await post('/api/clips/demo/render', { draft: { scale: 0.55 } });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /Scales that work/);
    assert.equal((await post('/api/clips/demo/render', { format: 'square', formats: ['square'] })).status, 400);
    const png = Buffer.from(await (await post('/api/frame/clip', { clip: 'demo', t: 0.5, isolate: { only: ['label'] } })).arrayBuffer());
    assert.equal(sha(png), sha((await t.studio.clipFrame({ clip: 'demo', t: 0.5, isolate: { only: ['label'] }, maxSize: undefined })).png));
    assert.equal((await post('/api/frame/clip', { clip: 'demo', isolate: { only: ['nope'] } })).status, 400);
    const viaGet = Buffer.from(await (await fetch(`${base}/api/clips/demo/frame.png?t=0.5&except=label&maxSize=640`)).arrayBuffer());
    assert.equal(sha(viaGet), sha((await t.studio.clipFrame({ clip: 'demo', t: 0.5, isolate: { except: ['label'] }, maxSize: 640 })).png));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('MCP over stdio: start_render with options, several formats, and isolate on frames and hashes', async () => {
  // a data dir with the fixture assets and the clip, then the real server on top of it
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-render-options-'));
  const seed = createStudio({ dataDir, role: 'test' });
  await seed.clips.createClip({ slug: 'demo', title: 'Demo', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 1 });
  await seedAssets(seed, 'demo');
  await seed.clips.updateClip('demo', { composition: composition() });
  await seed.close();
  const client = await connect({ dataDir, author: 'render-options-test' });
  const call = (name, args) => callTool(client, name, args);
  try {
    const { tools } = await client.listTools();
    const start = tools.find((x) => x.name === 'start_render');
    for (const key of ['clip', 'format', 'formats', 'draft', 'workers', 'poster_at', 'wait_seconds']) assert.ok(key in start.inputSchema.properties, `start_render lacks ${key}`);
    for (const word of ['formats', 'draft', 'workers', 'poster_at']) assert.match(start.description, new RegExp(word));
    assert.ok('isolate' in tools.find((x) => x.name === 'frame_hashes').inputSchema.properties);
    assert.ok('isolate' in tools.find((x) => x.name === 'render_clip_frame').inputSchema.properties);

    const r = await call('start_render', { clip: 'demo', draft: { scale: 0.5 }, workers: 2, poster_at: 0.3, wait_seconds: 120 });
    assert.equal(r.json.status, 'done', r.text);
    assert.equal(r.json.width, 160);
    assert.deepEqual(r.json.options, { draft: { scale: 0.5, width: 160, height: 90 }, workers: 2, poster: 0.3 });
    assert.deepEqual(r.json.stats.draft, { scale: 0.5, width: 160, height: 90, preset: 'veryfast' });
    assert.equal(r.json.stats.workers, 2);
    assert.equal(r.json.stats.posterFrame, 3);
    assert.equal(r.json.stats.probe.video.width, 160);
    assert.match(r.json.output, /demo-r\d+-draft\.mp4$/);
    // draft: true takes the default scale; the old shape is kept when formats is not given
    const dflt = await call('start_render', { clip: 'demo', draft: true, wait_seconds: 120 });
    assert.equal(dflt.json.stats.draft.width, 160);
    assert.equal(dflt.json.batch, undefined);

    const many = await call('start_render', { clip: 'demo', formats: ['vertical', 'square'], draft: { scale: 0.5 }, wait_seconds: 120 });
    assert.ok(!many.isError, many.text);
    assert.equal(many.json.batch, many.json.renders[0].id);
    assert.deepEqual(many.json.renders.map((x) => x.format), ['vertical', 'square']);
    assert.deepEqual(many.json.renders.map((x) => x.status), ['done', 'done']);
    assert.ok(many.json.renders.every((x) => x.options.batch === many.json.batch));
    assert.deepEqual(many.json.renders.map((x) => [x.stats.probe.video.width, x.stats.probe.video.height]), [[540, 960], [540, 540]]);
    // without wait_seconds: queued at once
    const queued = await call('start_render', { clip: 'demo', formats: ['horizontal'] });
    assert.equal(queued.json.renders.length, 1);
    assert.ok(['queued', 'running', 'done'].includes(queued.json.renders[0].status));
    const got = await call('get_render', { id: queued.json.batch, wait_seconds: 120 });
    assert.equal(got.json.status, 'done', got.text);

    // bad inputs say what is wrong
    const badScale = await call('start_render', { clip: 'demo', draft: { scale: 0.55 } });
    assert.ok(badScale.isError);
    assert.match(badScale.text, /Scales that work for this clip: 1\/2 \(160x90\)/);
    for (const args of [{ workers: 0 }, { workers: 17 }, { workers: 1.5 }, { formats: [] }, { formats: ['vertical', 'square', 'horizontal', 'vertical'] }, { draft: { scale: 1 } }, { poster_at: -1 }]) {
      const bad = await call('start_render', { clip: 'demo', ...args });
      assert.ok(bad.isError, JSON.stringify(args));
    }
    assert.match((await call('start_render', { clip: 'demo', formats: ['vertical', 'vertical'] })).text, /distinct/);
    assert.match((await call('start_render', { clip: 'demo', format: 'square', formats: ['vertical'] })).text, /format or formats, not both/);
    assert.match((await call('start_render', { clip: 'demo', poster_at: 5 })).text, /poster time must be from 0 up to the clip's duration \(1 s\)/);

    // isolate through frame_hashes and render_clip_frame
    const times = [0.2, 0.6];
    const only = await call('frame_hashes', { clip: 'demo', isolate: { only: ['label'] }, times });
    const wholeHashes = await call('frame_hashes', { clip: 'demo', times });
    assert.deepEqual(only.json.isolate, { only: ['label'] });
    assert.notDeepEqual(only.json.frames.map((x) => x.hash), wholeHashes.json.frames.map((x) => x.hash));
    const viaComposition = await call('frame_hashes', { composition: without('scene'), times });
    assert.deepEqual(only.json.frames.map((x) => x.hash), viaComposition.json.frames.map((x) => x.hash));
    const except = await call('frame_hashes', { clip: 'demo', isolate: { except: ['label'] }, times });
    assert.deepEqual(except.json.frames.map((x) => x.hash), (await call('frame_hashes', { composition: without('label'), times })).json.frames.map((x) => x.hash));
    const frame = await call('render_clip_frame', { clip: 'demo', t: 0.6, isolate: { only: ['label'] } });
    assert.equal(frame.json.sha256, only.json.frames[1].hash);
    assert.equal(frame.images.length, 1);
    const sheet = await call('render_clip_frame', { clip: 'demo', sheet: true, frames: 4, isolate: { except: ['scene'] } });
    assert.equal(sheet.json.frames.length, 4);
    assert.equal(sheet.images.length, 1);
    // bad isolates over MCP
    for (const isolate of [{ only: ['scene'], except: ['label'] }, { only: [] }, { only: ['nope'] }]) {
      assert.ok((await call('frame_hashes', { clip: 'demo', isolate, times })).isError, JSON.stringify(isolate));
    }
    assert.match((await call('frame_hashes', { clip: 'demo', isolate: { only: ['nope'] }, times })).text, /The clip's visual items: scene, label/);
    assert.match((await call('render_clip_frame', { clip: 'demo', isolate: { only: ['label'] }, overlays: true })).text, /overlays measure the whole clip/);
  } finally {
    await client.close();
    await new Promise((res) => setTimeout(res, 300));
    try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
  }
});
