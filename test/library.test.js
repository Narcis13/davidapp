// The asset contract and the database layer, through the studio services: validation before a
// version is accepted, pinned composition, immutability, search, lineage and usage.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tempStudio, seedAssets, smallComposition, AUTHOR, DOT, LABEL } from './helpers.js';
import { StudioError } from '../src/studio/studio.js';

let t;
before(async () => {
  t = tempStudio();
  await t.studio.clips.createClip({ slug: 'first', title: 'First clip', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  await seedAssets(t.studio, 'first');
  await t.studio.clips.updateClip('first', { composition: smallComposition() });
});
after(() => t.cleanup());

const rejects = (promise, re) => assert.rejects(promise, (/** @type {any} */ e) => e instanceof StudioError && re.test(e.message) ? true : assert.fail(`unexpected error: ${e.message}`));

test('a created asset stores source, schema, pinned deps, metadata and a thumbnail', () => {
  const a = t.studio.library.getAsset('scene');
  assert.equal(a.ref, 'scene@1');
  assert.equal(a.type, 'function');
  assert.equal(a.kind, 'visual');
  assert.equal(a.author, AUTHOR);
  assert.equal(a.duration, 2);
  assert.deepEqual(a.tags, ['scene', 'test']);
  assert.deepEqual(a.deps, { dot: 'dot@1', badge: 'badge@1' });
  assert.deepEqual(Object.keys(a.schema), ['title', 'seedJitter']);
  assert.equal(a.originClip, 'first');
  assert.match(a.source, /A test scene/);
  assert.ok(existsSync(`${t.dataDir}/${a.thumb}`));
  assert.ok(a.meta.test.length >= 3, 'test frames were drawn before it was accepted');
});

test('broken assets are rejected with a useful error and nothing is saved', async () => {
  const L = t.studio.library;
  const base = (render) => `asset({ description: 'A broken asset for the tests.', tags: ['test'], duration: 1, render(f, p) { ${render} } });`;
  await rejects(L.createAsset({ slug: 'bad-syntax', author: AUTHOR, source: 'asset({ description: "x" ' }), /rejected.*SyntaxError|rejected[\s\S]*Unexpected|rejected[\s\S]*missing/i);
  await rejects(L.createAsset({ slug: 'bad-throw', author: AUTHOR, source: base('f.ctx.fillRectangle(0, 0, 1, 1);') }), /bad-throw@1[\s\S]*fillRectangle is not a function[\s\S]*bad-throw@1\.js:1/);
  await rejects(L.createAsset({ slug: 'bad-random', author: AUTHOR, source: base('f.ctx.globalAlpha = Math.random();') }), /line 1: Math\.random\(\) is not allowed/);
  await rejects(L.createAsset({ slug: 'bad-clock', author: AUTHOR, source: base('const D = Date; f.ctx.globalAlpha = (D.now() % 2) / 2;') }), /Date\.now\(\) is not available inside an asset/);
  await rejects(L.createAsset({ slug: 'bad-state', author: AUTHOR, source: `let n = 0;\n${base('n++; f.ctx.fillStyle = "#fff"; f.ctx.fillRect(0, 0, n, n);')}` }), /Not deterministic/);
  await rejects(L.createAsset({ slug: 'bad-uses', author: AUTHOR, source: `asset({ description: 'Uses something missing.', tags: ['test'], uses: ['no-such-thing'], render() {} });` }), /uses refers to "no-such-thing", which is not in the library/);
  await rejects(L.createAsset({ slug: 'bad-undeclared', author: AUTHOR, source: base('f.use("dot");') }), /"dot" is not declared: add it to uses/);
  await rejects(L.createAsset({ slug: 'bad-meta', author: AUTHOR, source: 'asset({ render() {} });' }), /description is required/);
  await rejects(L.createAsset({ slug: 'bad-schema', author: AUTHOR, source: `asset({ description: 'Has a bad schema.', tags: ['test'], params: { size: { type: 'float' } }, render() {} });` }), /params\.size: unknown type "float"/);
  await rejects(L.createAsset({ slug: 'bad-child-params', author: AUTHOR, source: `asset({ description: 'Passes a wrong param down.', tags: ['test'], uses: ['dot'], render(f) { f.use('dot', { colour: '#fff' }); } });` }), /bad-child-params@1 > dot@1[\s\S]*colour: unknown parameter/);
  await rejects(L.createAsset({ slug: 'Bad Name', author: AUTHOR, source: DOT }), /not a valid asset name/);
  await rejects(L.createAsset({ slug: 'dot', author: AUTHOR, source: DOT }), /already exists/);
  for (const slug of ['bad-syntax', 'bad-throw', 'bad-random', 'bad-clock', 'bad-state', 'bad-uses', 'bad-undeclared', 'bad-meta', 'bad-schema', 'bad-child-params']) assert.equal(L.versionRow(slug), undefined, `${slug} was saved`);
});

test('an endless loop is stopped by the watchdog and the studio keeps working', async () => {
  const source = `asset({ description: 'Never returns from render.', tags: ['test'], render() { for (;;) {} } });`;
  const t0 = Date.now();
  await rejects(t.studio.library.createAsset({ slug: 'bad-loop', author: AUTHOR, source }), /Timed out[\s\S]*taking too long/);
  assert.ok(Date.now() - t0 < 40000);
  const frame = await t.studio.assetFrame({ ref: 'dot', width: 320, height: 180 });
  assert.equal(frame.width, 320);
});

test('editing creates a new immutable version; old versions and their pins stay as they were', async () => {
  const L = t.studio.library;
  const v2 = await L.updateAsset({ slug: 'dot', author: 'someone-else', note: 'square instead of a circle', source: DOT.replace('f.ctx.arc(p.radius + k * (f.width - 2 * p.radius), f.height / 2, p.radius, 0, Math.PI * 2);', 'f.ctx.rect(k * (f.width - 2 * p.radius), f.height / 2 - p.radius, 2 * p.radius, 2 * p.radius);') });
  assert.equal(v2.asset.ref, 'dot@2');
  assert.equal(v2.asset.parentVersion, 'dot@1');
  assert.equal(L.getAsset('dot').version, 2);
  assert.equal(L.getAsset('dot@1').version, 1);
  assert.notEqual(L.getAsset('dot@1').source, L.getAsset('dot@2').source);
  assert.deepEqual(L.getAsset('dot').versions.map((v) => [v.ref, v.author]), [['dot@1', AUTHOR], ['dot@2', 'someone-else']]);
  // scene@1 still pins dot@1, and so does the clip
  assert.equal(L.getAsset('scene').deps.dot, 'dot@1');
  assert.ok(t.studio.clips.clipAssets('first').some((a) => a.ref === 'dot@1'));
  assert.ok(!t.studio.clips.clipAssets('first').some((a) => a.ref === 'dot@2'));
  await rejects(L.updateAsset({ slug: 'dot', author: AUTHOR, source: L.getAsset('dot@2').source }), /identical to dot@2/);
  // the database itself refuses to change or delete a version
  assert.throws(() => t.studio.db.prepare("UPDATE asset_versions SET source = 'x' WHERE version = 1").run(), /immutable/);
  assert.throws(() => t.studio.db.prepare('DELETE FROM asset_versions WHERE version = 1').run(), /immutable/);
});

test('version pinning: the old clip draws the same pixels after the edit; a re-pinned clip changes', async () => {
  const times = [0.3, 1.0, 1.7];
  const before = await t.studio.frameHashes({ clip: 'first', times });
  // a new version of a nested dependency, then of the asset that uses it
  await t.studio.library.updateAsset({ slug: 'label', author: AUTHOR, source: LABEL.replace('weight: 800', 'weight: 400') });
  const after = await t.studio.frameHashes({ clip: 'first', times });
  assert.deepEqual(after, before);
  const { clip } = await t.studio.clips.repinClip({ slug: 'first', newSlug: 'first-latest', author: AUTHOR });
  assert.equal(clip.remixedFrom, 'first');
  assert.ok(clip.assets.some((a) => a.ref === 'label@2'));
  const moved = await t.studio.frameHashes({ clip: 'first-latest', times });
  assert.notDeepEqual(moved.map((x) => x.hash), before.map((x) => x.hash));
  // badge@1 still pins label@1, so only the direct label item changed: frames before it starts are equal
  const early = await t.studio.frameHashes({ clip: 'first-latest', times: [0.3] });
  assert.equal(early[0].hash, before[0].hash);
});

test('composition is real: three levels deep, each instance with its own stable seed', async () => {
  const assets = t.studio.clips.clipAssets('first');
  const depth = Object.fromEntries(assets.map((a) => [a.slug, a.depth]));
  assert.equal(depth.scene, 0);
  assert.equal(depth.badge, 1);
  assert.equal(depth.easing, 2);
  assert.ok(assets.find((a) => a.slug === 'font-inter'), 'fonts used through font params are recorded');
  const a = await t.studio.assetFrame({ ref: 'scene', params: { seedJitter: true }, width: 320, height: 180, t: 1, hash: true });
  const b = await t.studio.assetFrame({ ref: 'scene', params: { seedJitter: true }, width: 320, height: 180, t: 1, hash: true });
  const c = await t.studio.assetFrame({ ref: 'scene', params: { seedJitter: true }, width: 320, height: 180, t: 1, hash: true, seed: 2 });
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
});

test('forks keep their lineage', async () => {
  const f = await t.studio.library.forkAsset({ ref: 'dot@1', slug: 'dot-big', author: AUTHOR, source: DOT.replace('default: 20', 'default: 60') });
  assert.equal(f.asset.forkedFrom, 'dot@1');
  assert.deepEqual(t.studio.library.getAsset('dot').forks, ['dot-big']);
  assert.deepEqual(t.studio.library.search({ derivedFrom: 'dot' }).assets.map((a) => a.slug), ['dot-big']);
});

test('search: full text, type, kind, tags, format, origin and usage filters', () => {
  const S = (o) => t.studio.library.search(o).assets.map((a) => a.slug);
  assert.deepEqual(S({ query: 'slides left to right' })[0], 'dot');
  assert.ok(S({ query: 'badg' }).includes('badge'), 'prefix match');
  assert.deepEqual(S({ kind: 'value' }), ['easing']);
  assert.deepEqual(S({ kind: 'audio' }), ['kick']);
  assert.equal(S({ type: 'font' }).length, 5);
  assert.deepEqual(S({ tags: ['text', 'test'] }).sort(), ['label']);
  assert.ok(S({ originClip: 'first' }).includes('scene'));
  assert.ok(!S({ originClip: 'first' }).includes('dot-big'));
  assert.ok(S({ usedByClip: 'first' }).includes('easing'));
  assert.ok(!S({ usedByClip: 'first' }).includes('dot-big'));
  assert.ok(S({ format: 'vertical', type: 'function' }).includes('scene'));
  assert.deepEqual(S({ query: 'zzzzqqq' }), []);
  assert.ok(t.studio.library.allTags().some((x) => x.tag === 'test' && x.n >= 4));
  assert.equal(t.studio.library.search({ type: 'function', limit: 2 }).assets.length, 2);
  assert.ok(t.studio.library.search({ type: 'function', limit: 2 }).total > 2);
});

test('clips validate their items against the pinned schemas', async () => {
  const C = t.studio.clips;
  const comp = (items, type = 'visual') => ({ width: 320, height: 180, fps: 10, duration: 2, tracks: [{ type, items }] });
  await rejects(C.createClip({ slug: 'bad-1', author: AUTHOR, composition: comp([{ asset: 'nope', start: 0, duration: 1 }]) }), /no asset "nope" in the library/);
  await rejects(C.createClip({ slug: 'bad-2', author: AUTHOR, composition: comp([{ id: 'x', asset: 'dot', start: 0, duration: 1, params: { radius: 9000, colr: '#fff' } }]) }), /item "x": params\.colr: unknown parameter[\s\S]*params\.radius: 9000 is above the maximum 200/);
  await rejects(C.createClip({ slug: 'bad-3', author: AUTHOR, composition: comp([{ asset: 'easing', start: 0, duration: 1 }]) }), /easing@1 is a value asset; a visual track takes visual assets/);
  await rejects(C.createClip({ slug: 'bad-4', author: AUTHOR, composition: comp([{ asset: 'dot', start: 0, duration: 1 }], 'audio') }), /an audio track takes audio or sound assets/);
  await rejects(C.createClip({ slug: 'bad-5', author: AUTHOR, composition: comp([{ asset: 'label', start: 0, duration: 1, params: { font: 'Comic Sans' } }]) }), /unknown font family "Comic Sans" \(available: Inter/);
  assert.equal(C.listClips().filter((c) => c.slug.startsWith('bad-')).length, 0);
  // unpinned references are pinned to the latest version when the clip is saved
  const { clip, checked } = await C.createClip({ slug: 'second', title: 'Second', author: AUTHOR, composition: comp([{ id: 'd', asset: 'dot', start: 0, duration: 2 }, { id: 'old', asset: 'dot@1', start: 0, duration: 2 }]) });
  assert.deepEqual(clip.composition.tracks[0].items.map((i) => i.asset), ['dot@2', 'dot@1']);
  assert.ok(checked.framesChecked >= 3);
  // edit operations
  const edited = await C.editClip('second', [{ op: 'update_item', id: 'd', patch: { params: { radius: 50 }, start: 0.5, duration: 1.5 } }, { op: 'remove_item', id: 'old' }, { op: 'add_track', track: { id: 'top', type: 'text' } }, { op: 'add_item', track: 'top', item: { id: 'l', asset: 'label', start: 0, duration: 2, params: { text: 'Edited' } } }]);
  assert.equal(edited.clip.revision, 2);
  assert.deepEqual(edited.clip.composition.tracks.map((tr) => tr.items.map((i) => i.id)), [['d'], ['l']]);
  assert.deepEqual(edited.clip.composition.tracks[0].items[0].params, { radius: 50 });
  await rejects(C.editClip('second', [{ op: 'remove_item', id: 'ghost' }]), /no item with id "ghost"/);
});

test('lineage records what each clip created and reused, and the report says so', async () => {
  const g = t.studio.lineage.graph();
  const second = g.clips.find((c) => c.slug === 'second');
  const dot = second.assets.find((a) => a.slug === 'dot');
  assert.equal(dot.from, 'first');
  assert.equal(dot.how, 'as-is');
  assert.ok(second.counts.reused >= 2);
  const first = g.clips.find((c) => c.slug === 'first');
  assert.equal(first.counts.created, first.counts.total);
  const asset = g.assets.find((a) => a.slug === 'easing');
  assert.equal(asset.originClip, 'first');
  assert.ok(asset.usedBy.some((u) => u.clip === 'second'));
  const report = t.studio.lineage.report();
  assert.match(report, /Clip 1 · first/);
  assert.match(report, /from first \(\d+\): .*dot@2/);
  assert.match(report, /Most reused: /);
});

test('a remix re-flows the same composition into another format', async () => {
  await t.studio.clips.createClip({ slug: 'wide', title: 'Wide', author: AUTHOR, composition: { format: 'horizontal', fps: 10, duration: 1, tracks: [{ type: 'text', items: [{ asset: 'label', start: 0, duration: 1, params: { text: 'Re-flow' } }] }] } });
  const { clip } = await t.studio.clips.remixClip({ slug: 'wide', newSlug: 'wide-vertical', format: 'vertical', author: AUTHOR });
  assert.equal(clip.width, 1080); assert.equal(clip.height, 1920);
  assert.equal(clip.remixedFrom, 'wide');
  const frame = await t.studio.clipFrame({ clip: 'wide-vertical', t: 0.9, maxSize: 200 });
  assert.equal(frame.width, 1080);
});

test('image assets: bake-style import, use from code through f.image, and closure', async () => {
  const frame = await t.studio.assetFrame({ ref: 'dot@1', width: 64, height: 64, t: 1 });
  const img = await t.studio.library.addFileAsset({ slug: 'dot-still', type: 'image', data: frame.png, ext: '.png', description: 'A still of the dot asset, baked to PNG.', tags: ['still'], author: AUTHOR, derivedFrom: 'dot@1' });
  assert.equal(img.asset.type, 'image');
  assert.equal(img.asset.meta.width, 64);
  assert.equal(img.asset.forkedFrom, 'dot@1');
  const user = await t.studio.library.createAsset({ slug: 'stamp', author: AUTHOR, source: `asset({ description: 'Draws an image asset in the middle of the frame.', tags: ['image', 'test'], uses: ['dot-still'],
    params: { picture: { type: 'image', default: 'dot-still' } },
    render(f, p) { const img = f.image(p.picture); f.ctx.drawImage(img, (f.width - img.width) / 2, (f.height - img.height) / 2); } });` });
  assert.deepEqual(user.asset.deps, { 'dot-still': 'dot-still@1' });
  assert.deepEqual(user.warnings, []);
});

test('a scratch layer starts clean on every frame, whatever the previous frame left on it', async () => {
  // the asset leaves a clip region and a fill style on its layer without save/restore
  await t.studio.library.createAsset({ slug: 'leaky-layer', author: AUTHOR, source: `asset({ description: 'Draws through a scratch layer and leaves its state dirty.', tags: ['test'], duration: 2,
    render(f) {
      const L = f.offscreen(f.width, f.height);
      L.ctx.fillRect(0, 0, 40, 40);
      L.ctx.beginPath(); L.ctx.rect(f.t * 100, 0, 60, f.height); L.ctx.clip();
      L.ctx.fillStyle = f.t > 1 ? '#ff0000' : '#00ff00';
      L.ctx.fillRect(0, 0, f.width, f.height);
      f.ctx.drawImage(L.canvas, 0, 0);
    } });` });
  const comp = { width: 320, height: 180, fps: 10, duration: 2, tracks: [{ type: 'visual', items: [{ id: 'x', asset: 'leaky-layer', start: 0, duration: 2 }] }] };
  const forward = await t.studio.frameHashes({ composition: comp, times: [0.2, 1.5] });
  const backward = await t.studio.frameHashes({ composition: comp, times: [1.5, 0.2] });
  assert.equal(forward[1].hash, backward[0].hash);
  assert.equal(forward[0].hash, backward[1].hash);
});

test('cached layouts and schema defaults cannot be changed by an asset', async () => {
  const mutate = (body) => `asset({ description: 'Tries to change shared data it was handed.', tags: ['test'], duration: 1,
    params: { items: { type: 'array', of: { type: 'number' }, default: [3, 1, 2] } },
    render(f, p) { ${body} } });`;
  await rejects(t.studio.library.createAsset({ slug: 'sorts-default', author: AUTHOR, source: mutate('p.items.sort(); f.ctx.fillRect(0, 0, p.items[0], 5);') }), /rejected[\s\S]*(read.only|frozen|Cannot assign)/i);
  const layout = `'use strict'; const L = f.lib.text.layout(f.ctx, 'shared', { size: 40 }); L.words[0].x += 8; f.lib.text.fill(f.ctx, L, 0, 0);`;
  await rejects(t.studio.library.createAsset({ slug: 'moves-layout', author: AUTHOR, source: mutate(layout) }), /rejected[\s\S]*(read.only|frozen|Cannot assign)/i);
});

test('one alias cannot be pinned to two versions', async () => {
  const src = `asset({ description: 'Pins dot twice, differently.', tags: ['test'], uses: ['dot@1'], params: { shape: { type: 'asset', default: 'dot' } }, render(f, p) { f.use(p.shape); } });`;
  await rejects(t.studio.library.createAsset({ slug: 'double-pin', author: AUTHOR, source: src }), /"dot" is already pinned to dot@1, but the default of parameter "shape" asks for dot@2/);
});

test('two edits of the same clip at once: one is saved, the other is told to retry', async () => {
  const C = t.studio.clips;
  await C.createClip({ slug: 'contended', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 2, tracks: [{ id: 'a', type: 'visual', items: [] }] } });
  const add = (id) => C.editClip('contended', [{ op: 'add_item', track: 'a', item: { id, asset: 'dot', start: 0, duration: 1 } }]);
  const results = await Promise.allSettled([add('one'), add('two')]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /changed by someone else/);
  assert.equal(C.getClip('contended').composition.tracks[0].items.length, 1);
  await rejects(C.createClip({ slug: 'tiny', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 0.01, tracks: [] } }), /shorter than one frame/);
  await rejects(C.remixClip({ slug: 'contended', newSlug: 'contended-wide', format: 'cinema', author: AUTHOR }), /Unknown format "cinema"/);
  await rejects(C.createClip({ slug: 'bad-param-type', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 1, tracks: [{ type: 'visual', items: [{ id: 'b', asset: 'badge', start: 0, duration: 1, params: { text: 5 } }] }] } }), /item "b": params\.text: expected a string/);
});
