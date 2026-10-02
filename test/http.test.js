// The studio's HTTP server: the JSON API the UI uses, media with Range requests, static files,
// and the errors a client can cause.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempStudio, seedAssets, smallComposition, AUTHOR, DOT } from './helpers.js';
import { createStudioServer } from '../src/server/http.js';

let t, server, base;
const get = (path, init) => fetch(base + path, init);
const json = async (path, init) => (await get(path, init)).json();
const post = (path, body, method = 'POST') => get(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  t = tempStudio({ runner: true });
  await t.studio.clips.createClip({ slug: 'demo', title: 'Demo', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  await seedAssets(t.studio, 'demo');
  await t.studio.clips.updateClip('demo', { composition: smallComposition() });
  server = createStudioServer(t.studio);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

test('status, search and asset detail', async () => {
  const status = await json('/api/status');
  assert.equal(status.fonts.length, 5);
  assert.ok(status.formats.vertical.safe.bottom > 0);
  assert.ok(status.counts.assets >= 11);
  const found = await json('/api/assets?query=badge&type=function');
  assert.equal(found.assets[0].slug, 'badge');
  assert.equal((await json('/api/assets?kind=audio')).assets.length, 1);
  assert.deepEqual((await json('/api/assets?tag=text,test')).assets.map((a) => a.slug), ['label']);
  const scene = await json('/api/assets/scene');
  assert.equal(scene.ref, 'scene@1');
  assert.match(scene.source, /A test scene/);
  assert.equal((await get('/api/assets/nope')).status, 404);
});

test('an asset bundle carries the pinned closure for the browser preview', async () => {
  const b = await json('/api/assets/scene/bundle');
  assert.equal(b.ref, 'scene@1');
  assert.deepEqual(Object.keys(b.bundle.assets).sort(), ['badge@1', 'dot@1', 'easing@1', 'label@1', 'scene@1']);
  assert.deepEqual(b.bundle.assets['scene@1'].deps, { dot: 'dot@1', badge: 'badge@1' });
});

test('validating a draft returns its schema, or a 422 with the reason', async () => {
  const ok = await post('/api/assets/validate', { name: 'dot', source: DOT.replace('default: 20', 'default: 33') });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ref, 'dot@2');
  assert.equal(body.schema.radius.default, 33);
  assert.ok(body.bundle.assets['dot@2']);
  const bad = await post('/api/assets/validate', { name: 'dot', source: 'asset({ description: "A broken draft for the test.", tags: ["t"], render(f) { f.nope(); } });' });
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).error, /f\.nope is not a function/);
  assert.equal((await json('/api/assets/dot')).version, 1, 'nothing was saved');
});

test('saving a new version through the API, then forking it', async () => {
  const r = await post('/api/assets/dot/versions', { source: DOT.replace('default: 20', 'default: 30'), note: 'from the playground' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).asset.ref, 'dot@2');
  const f = await post('/api/assets/dot/fork', { name: 'dot-two', version: 1 });
  assert.equal((await f.json()).asset.forkedFrom, 'dot@1');
  assert.equal((await post('/api/assets', { name: 'dot', source: DOT })).status, 409);
});

test('a clip comes with its pinned composition, bundle, beats and asset schemas', async () => {
  const clip = await json('/api/clips/demo');
  assert.equal(clip.composition.tracks[0].items[0].asset, 'scene@1');
  assert.ok(clip.bundle.assets['scene@1']);
  assert.equal(clip.beats.length, 4);
  assert.equal(clip.assets['label@1'].schema.text.type, 'string');
  assert.ok(!clip.bundle.assets['kick@1'], 'audio assets are not shipped to the preview');
  const draft = structuredClone(clip.composition);
  draft.tracks[1].items[0].params.text = 'Draft';
  draft.tracks[1].items[0].asset = 'dot';
  const bundled = await post('/api/clips/demo/bundle', { composition: draft });
  assert.equal(bundled.status, 400, 'label params on a dot are invalid');
  draft.tracks[1].items[0].params = {};
  const ok = await (await post('/api/clips/demo/bundle', { composition: draft })).json();
  assert.equal(ok.composition.tracks[1].items[0].asset, 'dot@2', 'draft references are pinned to the latest version');
  assert.equal((await json('/api/clips/demo')).revision, 2, 'bundling a draft saves nothing');
});

test('frames, audio and saving a composition', async () => {
  const png = await get('/api/clips/demo/frame.png?t=1&maxSize=160');
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  const exact = await post('/api/frame/asset', { ref: 'dot@1', t: 1, width: 320, height: 180 });
  assert.equal(exact.headers.get('content-type'), 'image/png');
  const wav = await get('/api/clips/demo/audio.wav');
  assert.equal(wav.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await wav.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  const clip = await json('/api/clips/demo');
  clip.composition.tracks[1].items[0].params.text = 'Saved';
  const saved = await post('/api/clips/demo', { composition: clip.composition }, 'PUT');
  assert.equal(saved.status, 200);
  assert.equal((await json('/api/clips/demo')).composition.tracks[1].items[0].params.text, 'Saved');
});

test('rendering from the API: queue, progress, gallery, and a video that seeks', async () => {
  const started = await (await post('/api/clips/demo/render', {})).json();
  assert.ok(['queued', 'running'].includes(started.status));
  let r;
  for (let i = 0; i < 300; i++) {
    r = await json(`/api/renders/${started.id}`);
    if (['done', 'failed', 'cancelled'].includes(r.status)) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(r.status, 'done', r.error ?? '');
  assert.equal(r.log, '');
  const gallery = await json('/api/gallery');
  const item = gallery.renders.find((g) => g.id === started.id);
  assert.ok(item.assets.some((a) => a.slug === 'scene'));
  const full = await get(`/media/${item.output}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const size = Number(full.headers.get('content-length'));
  await full.arrayBuffer();
  const part = await get(`/media/${item.output}`, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await get(`/media/${item.output}`, { headers: { range: 'bytes=-50' } });
  assert.equal(tail.headers.get('content-range'), `bytes ${size - 50}-${size - 1}/${size}`);
  await tail.arrayBuffer();
  assert.equal((await get(`/media/${item.output}`, { headers: { range: `bytes=${size + 10}-` } })).status, 416);
  const lineage = await json('/api/lineage');
  assert.equal(lineage.clips[0].slug, 'demo');
  assert.match(lineage.report, /Clip 1 · demo/);
});

test('static files, the app shell, and requests that must be refused', async () => {
  const core = await get('/core/runtime.js');
  assert.match(core.headers.get('content-type'), /javascript/);
  assert.match(await core.text(), /export function createRuntime/);
  assert.equal((await get('/fonts/inter-latin-400-normal.woff2')).headers.get('content-type'), 'font/woff2');
  const shell = await get('/clips/anything/at/all');
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-type'), /text\/html/);
  for (const path of ['/media/studio.db', '/media/cache/audio/x.wav', '/media/renders/%2e%2e/studio.db', '/media/thumbs/..%2f..%2fpackage.json', '/core/..%2f..%2fpackage.json', '/media/renders/..%5cstudio.db', '/ui/..%2fserver/http.js']) {
    const res = await get(path);
    assert.ok([403, 404].includes(res.status), `${path} → ${res.status}`);
    assert.doesNotMatch(await res.text(), /"dependencies"|SQLite format|createStudioServer/);
  }
  // a URL the client normalizes out of /media is just another app path: the shell, never a file
  assert.match(await (await get('/media/../studio.db')).text(), /<title>Fablecut<\/title>/);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })).status, 400);
  assert.equal((await get('/somewhere', { method: 'DELETE' })).status, 405);
});
