// Procedural 3D (f.lib.solid) and baked frame sequences: mesh generators, the rasterizer's depth
// test, culling and clipping, determinism, 3D between 2D layers, and a bake that is cached and
// reused by a second clip.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage, nodeHost } from '../src/render/host.js';
import { createRuntime } from '../src/core/runtime.js';
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

test('every generator winds its triangles counter-clockwise seen from outside (the normals point away from the inside)', () => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  /** Triangles whose geometric normal points away from inside(centre of the triangle), towards it, or that have no area. */
  const facing = (m, inside) => {
    const P = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const n = { out: 0, in: 0, flat: 0 };
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = P(m.indices[t]), b = P(m.indices[t + 1]), c = P(m.indices[t + 2]);
      const normal = cross(sub(b, a), sub(c, a));
      const centre = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
      const away = sub(centre, inside(centre));
      const d = normal[0] * away[0] + normal[1] * away[1] + normal[2] * away[2];
      if (Math.hypot(...normal) < 1e-12) n.flat++; else if (d > 0) n.out++; else n.in++;
    }
    return n;
  };
  const origin = () => [0, 0, 0];
  const axis = (/** @type {number[]} */ c) => [0, c[1], 0];
  // the nearest point of the circle the tube is wrapped around
  const ring = (R) => (/** @type {number[]} */ c) => { const l = Math.hypot(c[0], c[2]); return [(c[0] / l) * R, 0, (c[2] / l) * R]; };
  const triangle = [[-0.5, -0.4], [0.5, -0.4], [0, 0.6]];
  const dot = S.text('.');
  const middle = [0, 1].map((k) => dot.positions.reduce((s, v, i) => (i % 3 === k ? s + v : s), 0) / (dot.positions.length / 3));
  // [mesh, the inside nearest to a point, triangles without area]
  /** @type {Record<string, [any, (c: number[]) => number[], number]>} */
  const cases = {
    box: [S.box(1, 2, 3), origin, 0],
    icosphere: [S.icosphere(2, 1), origin, 0],
    torus: [S.torus(1, 0.3, 16, 8), ring(1), 0],
    'lathe (a wall)': [S.lathe([[1, -1], [1, 1]], 12), axis, 0],
    'lathe (a vase)': [S.lathe([[0.5, -1], [1, 0], [0.4, 1]], 12), axis, 0],
    // the caps are fans from the axis: one triangle of each quad there has no area
    cylinder: [S.cylinder(0.5, 0.5, 1, 12), origin, 24],
    cone: [S.cylinder(0, 0.5, 1, 12), origin, 48],
    'extrude (counter-clockwise shape)': [S.extrude(triangle, 0.5), origin, 0],
    'extrude (clockwise shape)': [S.extrude([...triangle].reverse(), 0.5), origin, 0],
    text: [dot, () => [middle[0], middle[1], 0], 0],
    // a sheet, not a solid: its outside is up
    terrain: [S.terrain({ cols: 4, rows: 4, height: (x, z) => Math.sin(x) * 0.2 + z * 0.1 }), (/** @type {number[]} */ c) => [c[0], c[1] - 1, c[2]], 0],
  };
  for (const [name, [m, inside, flat]] of Object.entries(cases)) {
    assert.deepEqual(facing(m, inside), { out: m.indices.length / 3 - flat, in: 0, flat }, name);
  }
  // and so the renderer shows the near side, lit from where the light is: a cylinder lit from the right is bright on the right
  const lit = (mesh, shading, dx) => {
    const f = frame();
    S.render(f, { camera: { position: [0, 0, 5] }, lights: [{ type: 'directional', direction: [-1, 0, 0], intensity: 1 }], objects: [{ mesh, color: '#ffffff', shading }] });
    return { left: f.px(100 - dx, 100), right: f.px(100 + dx, 100) };
  };
  for (const shading of ['flat', 'smooth']) {
    for (const [name, mesh, dx] of /** @type {[string, any, number][]} */ ([['cylinder', S.cylinder(1, 1, 2, 24), 40], ['torus', S.torus(1, 0.3, 32, 12), 60]])) {
      const p = lit(mesh, shading, dx);
      assert.ok(p.right[3] === 255 && p.left[3] === 255, `${name} (${shading}) is drawn on both sides of the centre`);
      assert.ok(p.right[0] > 120 && p.left[0] < 20, `${name} (${shading}): lit on the right ${p.right}, dark on the left ${p.left}`);
    }
  }
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

test('sequence frames are preloaded with the loop flag the draw path reads: the format\'s params for an item, its own params for a mask', () => {
  const rt = createRuntime(nodeHost);
  rt.load({ 'block@1': { source: "asset({ description: 'A white block that fills its box, for tests.', tags: ['test'], render(f) { f.ctx.fillStyle = '#ffffff'; f.ctx.fillRect(0, 0, f.width, f.height); } });" } });
  // a 2 s sequence (60 frames at 30 fps) that only holds the frames that were asked for, like a worker with an empty cache
  const tile = createCanvas(8, 8);
  tile.getContext('2d').fillRect(0, 0, 8, 8);
  const loaded = new Set();
  rt.setSequence('spin@1', { frames: 60, fps: 30, width: 8, height: 8, get: (i) => (loaded.has(i) ? tile : null) });
  const comp = (item) => ({ width: 1920, height: 1080, fps: 10, duration: 6, background: '#000000', tracks: [{ id: 'v', type: 'visual', items: [{ id: 'x', start: 0, duration: 6, params: {}, ...item }] }] });
  // at 3 s a sequence that loops is on frame 90 % 60 = 30, one that holds is on its last frame, 59
  /** @type {Record<string, [any, number[]]>} */
  const cases = {
    'a looping mask on an item that does not loop': [{ asset: 'block@1', mask: { asset: 'spin@1', params: { loop: true } } }, [30]],
    'a mask that holds on an item that loops': [{ asset: 'spin@1', params: { loop: true }, mask: { asset: 'spin@1', params: {} } }, [30, 59]],
    'a format override that loops': [{ asset: 'spin@1', formats: { horizontal: { params: { loop: true } } } }, [30]],
    'a format override that stops the loop': [{ asset: 'spin@1', params: { loop: true }, formats: { horizontal: { params: { loop: false } } } }, [59]],
    'an override for another format': [{ asset: 'spin@1', formats: { vertical: { params: { loop: true } } } }, [59]],
  };
  const canvas = createCanvas(1920, 1080);
  for (const [name, [item, expected]] of Object.entries(cases)) {
    const wanted = rt.sequenceFramesAt(comp(item), 30);
    assert.deepEqual(wanted.map((w) => [w.ref, w.index]), expected.map((i) => ['spin@1', i]), name);
    loaded.clear();
    for (const w of wanted) loaded.add(w.index);
    assert.doesNotThrow(() => rt.renderClipFrame(canvas.getContext('2d'), comp(item), 30), `${name}: the frame it draws is the frame that was loaded`);
  }
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
