// Procedural 3D (f.lib.solid) and baked frame sequences: mesh generators, the rasterizer's depth
// test, culling and clipping, determinism, 3D between 2D layers, and a bake that is cached and
// reused by a second clip.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../src/render/host.js';
import * as S from '../src/core/lib/solid.js';
import { tempStudio, AUTHOR, LABEL } from './helpers.js';
import { BALL, HILLS, LETTERS } from './fixtures/solid.js';

/** A minimal f for calling solid.render outside an asset. */
function frame(w = 200, h = 200) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  return { canvas: c, ctx, width: w, height: h, offscreen: (ww, hh) => { const o = createCanvas(ww, hh); return { canvas: o, ctx: o.getContext('2d'), width: ww, height: hh }; }, px: (x, y) => [...ctx.getImageData(x, y, 1, 1).data] };
}
const near = (/** @type {number[]} */ a, /** @type {number[]} */ b, d = 12) => a.every((v, i) => Math.abs(v - b[i]) <= d);

test('meshes: icosphere, box, lathe, torus, extrude, terrain, text and instances have the right shape', () => {
  const ico = S.icosphere(1, 2);
  assert.equal(ico.positions.length / 3, 42);
  assert.equal(ico.indices.length / 3, 80);
  assert.ok(ico.positions.every((v, i) => i % 3 || Math.abs(Math.hypot(ico.positions[i], ico.positions[i + 1], ico.positions[i + 2]) - 2) < 1e-9), 'on the sphere');
  assert.equal(S.box().indices.length / 3, 12);
  assert.equal(S.triangulate([[0, 0], [1, 0], [1, 1], [0, 1]]).length / 3, 2);
  assert.equal(S.triangulate([[0, 0], [2, 0], [2, 2], [1, 1], [0, 2]]).length / 3, 3, 'a concave pentagon');
  const ex = S.extrude([[0, 0], [1, 0], [0.5, 1]], 0.5);
  assert.equal(ex.indices.length / 3, 2 + 3 * 2);
  assert.equal(S.lathe([[0, 0], [1, 0], [1, 1], [0, 1]], 8).indices.length / 3, 8 * 3 * 2);
  assert.equal(S.torus(1, 0.3, 8, 6).indices.length / 3, 8 * 6 * 2);
  const land = S.terrain({ cols: 4, rows: 3, height: (x, z) => x + z, color: () => '#00ff00' });
  assert.equal(land.indices.length / 3, 4 * 3 * 2);
  assert.deepEqual(land.colors.slice(0, 3), [0, 255, 0]);
  const word = S.text('HI');
  assert.ok(word.indices.length > 0);
  assert.equal(S.text('  ').indices.length, 0);
  const parts = S.instances(S.box(0.1, 0.1, 0.1), [{ position: [0, 0, 0] }, { position: [1, 0, 0], color: '#ff0000' }]);
  assert.equal(parts.indices.length / 3, 24);
});

test('the rasterizer: the nearer surface wins whatever the order; back faces are culled; transparent elsewhere', () => {
  const red = { mesh: S.box(1, 1, 0.1), position: [0, 0, 0.5], color: '#ff0000' };
  const blue = { mesh: S.box(2, 2, 0.1), position: [0, 0, -0.5], color: '#0000ff' };
  const lights = [{ type: 'ambient', intensity: 1 }];
  const a = frame(), b = frame();
  S.render(a, { camera: { position: [0, 0, 5] }, lights, objects: [red, blue] });
  S.render(b, { camera: { position: [0, 0, 5] }, lights, objects: [blue, red] });
  assert.ok(near(a.px(100, 100), [255, 0, 0, 255]) && near(b.px(100, 100), [255, 0, 0, 255]), 'red is in front');
  assert.ok(near(a.px(100, 62), [0, 0, 255, 255]), 'blue around it');
  assert.equal(a.px(2, 2)[3], 0, 'nothing drawn: transparent');
  const ca = a.ctx.getImageData(0, 0, 200, 200).data, cb = b.ctx.getImageData(0, 0, 200, 200).data;
  assert.ok(ca.every((v, i) => v === cb[i]), 'the same bytes either way');
  // a single quad facing away is not drawn, unless double-sided
  const away = { mesh: S.mesh([-1, -1, 0, 1, -1, 0, 1, 1, 0], [0, 2, 1]), color: '#ffffff' };
  const c = frame();
  const r = S.render(c, { camera: { position: [0, 0, 5] }, lights, objects: [away] });
  assert.equal(r.drawn, 0);
  assert.equal(S.render(frame(), { camera: { position: [0, 0, 5] }, lights, objects: [{ ...away, doubleSided: true }] }).drawn, 1);
});

test('the rasterizer: a camera inside geometry clips at the near plane instead of failing', () => {
  const f = frame();
  const r = S.render(f, { camera: { position: [0, 0, 0], target: [0, 0, -1] }, lights: [{ type: 'ambient', intensity: 1 }], objects: [{ mesh: S.box(4, 4, 4), color: '#00ff00', doubleSided: true }] });
  assert.ok(r.drawn > 0);
  assert.ok(near(f.px(100, 100), [0, 255, 0, 255]));
});

let t, studio;
before(async () => {
  t = tempStudio();
  studio = t.studio;
  await studio.clips.createClip({ slug: 'three-d', title: '3D', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 1 });
  for (const [slug, source] of [['label', LABEL], ['ball', BALL], ['hills', HILLS], ['letters', LETTERS]]) await studio.library.createAsset({ slug, source, author: AUTHOR, forClip: 'three-d' });
});
after(() => t.cleanup());

const pixels = async (composition, time) => {
  const r = await studio.clipFrame({ composition, t: time, hash: true });
  const img = await loadImage(r.png);
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
  return { hash: r.hash, at: (x, y) => { const i = (y * img.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; } };
};

test('3D assets are deterministic, and sit between 2D layers: text behind and text in front', async () => {
  for (const ref of ['ball', 'hills', 'letters']) {
    const a = await studio.assetFrame({ ref, t: 0.7, hash: true, format: 'square', maxSize: 200 });
    const b = await studio.assetFrame({ ref, t: 0.7, hash: true, format: 'square', maxSize: 200 });
    assert.equal(a.hash, b.hash, `${ref}: same frame, same pixels`);
  }
  const comp = { width: 320, height: 180, fps: 10, duration: 1, background: '#000000', tracks: [
    { id: 'behind', items: [{ id: 'back', asset: 'label', start: 0, duration: 1, params: { text: 'BEHIND THE BALL', color: '#00ff00' }, transform: { height: 0.6 } }] },
    { id: '3d', items: [{ id: 'ball', asset: 'ball', start: 0, duration: 1, params: { color: '#ff0000' } }] },
    { id: 'front', items: [{ id: 'front', asset: 'label', start: 0, duration: 1, params: { text: 'FRONT', color: '#0000ff' }, transform: { y: 0.85, height: 0.25 } }] },
  ] };
  const p = await pixels(comp, 0.5);
  const centre = p.at(160, 60);
  assert.ok(centre[0] > 80 && centre[1] < 60, `the ball covers the text behind it at the centre (${centre})`);
  let green = 0, blue = 0;
  for (let x = 0; x < 320; x += 2) { for (let y = 0; y < 180; y += 2) { const [r, g, b] = p.at(x, y); if (g > 150 && r < 80) green++; if (b > 150 && r < 80) blue++; } }
  assert.ok(green > 20, 'the text behind still shows around the ball');
  assert.ok(blue > 20, 'the text in front is drawn over everything');
  // two renders of a clip with 3D give the same sampled frame hashes
  await studio.clips.updateClip('three-d', { composition: comp });
  const r1 = studio.renders.enqueue({ clip: 'three-d' }), r2 = studio.renders.enqueue({ clip: 'three-d' });
  studio.renders.startRunner();
  const [a, b] = [await studio.renders.wait(r1.id, 120000), await studio.renders.wait(r2.id, 120000)];
  await studio.renders.stopRunner();
  assert.equal(a.status, 'done', a.error ?? '');
  assert.equal(b.status, 'done', b.error ?? '');
  assert.deepEqual(a.stats.frameHashes, b.stats.frameHashes);
});

test('baking: a visual asset becomes a transparent frame sequence, cached, used as a layer in two clips', async () => {
  const bake = await studio.bakeSequence({ ref: 'ball', slug: 'ball-spin', params: { color: '#2dd4bf' }, width: 160, height: 160, fps: 10, duration: 1, author: AUTHOR, forClip: 'three-d' });
  assert.equal(bake.cached, false);
  assert.equal(bake.frames, 10);
  const seq = bake.asset;
  assert.equal(seq.type, 'sequence');
  assert.equal(seq.forkedFrom, 'ball@1');
  assert.equal(seq.derivation, 'bake');
  assert.equal(seq.meta.frames, 10);
  const dir = join(t.dataDir, seq.file);
  assert.deepEqual(readdirSync(dir).sort().slice(0, 2), ['000000.png', '000001.png']);
  assert.ok(existsSync(join(t.dataDir, seq.thumb)));
  const first = await loadImage(join(dir, '000000.png'));
  const fc = createCanvas(160, 160);
  fc.getContext('2d').drawImage(first, 0, 0);
  assert.equal(fc.getContext('2d').getImageData(2, 2, 1, 1).data[3], 0, 'transparent where the ball is not');
  const again = await studio.bakeSequence({ ref: 'ball', slug: 'ball-spin-2', params: { color: '#2dd4bf' }, width: 160, height: 160, fps: 10, duration: 1, author: AUTHOR });
  assert.equal(again.cached, true);
  assert.equal(again.asset.ref, 'ball-spin@1', 'the same bake is reused, not made twice');
  assert.equal(studio.library.versionRow('ball-spin-2'), undefined);
  // the sequence as a layer: the same picture as the live asset in the same box
  const live = { width: 320, height: 180, fps: 10, duration: 1, background: '#000000', tracks: [{ id: 'v', items: [{ id: 'x', asset: 'ball', start: 0, duration: 1, params: { color: '#2dd4bf' }, transform: { width: 0.5, height: 160 / 180 } }] }] };
  const baked = { ...live, tracks: [{ id: 'v', items: [{ id: 'x', asset: 'ball-spin', start: 0, duration: 1, transform: { width: 0.5, height: 160 / 180 } }] }] };
  const L = await pixels(live, 0.5), B = await pixels(baked, 0.5);
  for (const [x, y] of [[160, 90], [130, 70], [190, 110], [20, 20]]) assert.ok(near(L.at(x, y), B.at(x, y), 24), `(${x}, ${y}): live ${L.at(x, y)} vs baked ${B.at(x, y)}`);
  // a second clip reuses the baked sequence; lineage shows where it came from
  await studio.clips.createClip({ slug: 'reuse-bake', title: 'Reuse', author: AUTHOR, composition: { ...baked, tracks: [{ id: 'v', items: [{ id: 'spin', asset: 'ball-spin', start: 0, duration: 1, params: { loop: true } }] }] } });
  const used = studio.clips.clipAssets('reuse-bake');
  assert.ok(used.some((a) => a.ref === 'ball-spin@1' && a.relation === 'reused' && a.originClip === 'three-d'));
  const sheet = await studio.clipSheet({ clip: 'reuse-bake', count: 6 });
  assert.ok(sheet.png.length > 1000);
  await assert.rejects(studio.bakeSequence({ ref: 'label@1', slug: 'x-seq', width: 100, height: 100, fps: 70, duration: 1, author: AUTHOR }), /fps must be 1–60/);
});
