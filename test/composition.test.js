// Composition v2: transforms, keyframes, per-format overrides, image layers and the layer
// operations, checked on the structure and on the pixels the renderer draws.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComposition } from '../src/core/composition.js';
import { layerGeometry, corners, invert, apply, sampleKeys, forFormat } from '../src/core/transform.js';
import { createCanvas, loadImage } from '../src/render/host.js';
import { tempStudio, seedAssets, AUTHOR, smallComposition } from './helpers.js';
import clip1 from '../clips/clip-1-every-frame/compose.mjs';
import clip2 from '../clips/clip-2-compounding/compose.mjs';
import clip3 from '../clips/clip-3-release-notes/compose.mjs';

// a solid block that fills its box: easy to find in the pixels
const BLOCK = `asset({
  description: 'A solid block that fills its whole box, for layout tests.',
  tags: ['shape', 'test'],
  duration: 2,
  params: { color: { type: 'color', default: '#ff0000' }, size: { type: 'number', default: 1, min: 0, max: 1 } },
  render(f, p) {
    f.ctx.fillStyle = p.color;
    f.ctx.fillRect(0, 0, f.width * p.size, f.height * p.size);
  },
});`;

// draws its own time as a bar width, so a split item can be checked for continuity
const CLOCK = `asset({
  description: 'A bar whose width is the asset time over its duration, for split tests.',
  tags: ['test'],
  duration: 2,
  render(f) {
    f.ctx.fillStyle = '#ffffff';
    f.ctx.fillRect(0, 0, f.width * f.progress, f.height);
  },
});`;

let env, studio;
before(async () => {
  env = tempStudio();
  studio = env.studio;
  await seedAssets(studio);
  await studio.library.createAsset({ slug: 'block', source: BLOCK, author: AUTHOR });
  await studio.library.createAsset({ slug: 'clock', source: CLOCK, author: AUTHOR });
  const c = createCanvas(40, 20);
  const g = c.getContext('2d');
  g.fillStyle = '#00ff00'; g.fillRect(0, 0, 20, 20);
  g.fillStyle = '#0000ff'; g.fillRect(20, 0, 20, 20);
  await studio.library.addFileAsset({ slug: 'two-squares', type: 'image', data: c.toBuffer('image/png'), ext: '.png', description: 'Two squares, green and blue, side by side (test image).', tags: ['test'], author: AUTHOR });
});
after(() => env.cleanup());

const base = (tracks, extra = {}) => ({ width: 320, height: 180, fps: 10, duration: 2, background: '#000000', tracks, ...extra });
const block = (id, extra = {}) => ({ id, asset: 'block', start: 0, duration: 2, ...extra });

async function pixels(composition, t = 0) {
  const r = await studio.clipFrame({ composition, t });
  const img = await loadImage(r.png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  return { width: img.width, at: (x, y) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; }, hash: (await studio.clipFrame({ composition, t, hash: true })).hash };
}
const isRed = (/** @type {number[]} */ [r, g, b]) => r > 200 && g < 60 && b < 60;
const isBlue = (/** @type {number[]} */ [r, g, b]) => b > 200 && r < 60 && g < 60;
const isGreen = (/** @type {number[]} */ [r, g, b]) => g > 200 && r < 60 && b < 60;
const isBlack = (/** @type {number[]} */ [r, g, b]) => r < 30 && g < 30 && b < 30;

test('composition v1 shapes normalize to exactly what they were (no v2 fields appear)', () => {
  for (const comp of [clip1, clip2, clip3, smallComposition()]) {
    const { composition, errors } = normalizeComposition(comp);
    assert.deepEqual(errors, []);
    for (const tr of composition.tracks) {
      for (const k of ['locked', 'solo', 'muted']) assert.equal(tr[k], undefined);
      for (const it of tr.items) for (const k of ['transform', 'keyframes', 'formats', 'offset', 'assetDuration']) assert.equal(it[k], undefined, `${it.id}.${k}`);
    }
    assert.equal(composition.easing, undefined);
    assert.deepEqual(normalizeComposition(composition).composition, composition, 'normalizing twice changes nothing');
  }
});

test('transforms, keyframes and overrides are validated with paths', () => {
  const bad = normalizeComposition(base([{ id: 'v', items: [block('b', {
    transform: { x: 'left', width: 0, wobble: 1, space: 'page' },
    keyframes: { x: [{ t: -1, v: 0 }], colour: [{ t: 0, v: 1 }], rotation: [] },
    formats: { portrait: {}, vertical: { transform: { scale: 'big' }, nope: 1 } },
  })] }]));
  const paths = bad.errors.map((e) => e.path);
  for (const p of ['tracks[0].items[0].transform.x', 'tracks[0].items[0].transform.width', 'tracks[0].items[0].transform.wobble', 'tracks[0].items[0].transform.space',
    'tracks[0].items[0].keyframes.x[0].t', 'tracks[0].items[0].keyframes.colour', 'tracks[0].items[0].keyframes.rotation',
    'tracks[0].items[0].formats.portrait', 'tracks[0].items[0].formats.vertical.transform.scale', 'tracks[0].items[0].formats.vertical.nope']) {
    assert.ok(paths.includes(p), `expected a problem at ${p}; got ${paths.join(', ')}`);
  }
  // a legacy box becomes the transform's starting geometry
  const ok = normalizeComposition(base([{ id: 'v', items: [block('b', { box: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }, transform: { rotation: 10 } })] }]));
  assert.deepEqual(ok.errors, []);
  const it = ok.composition.tracks[0].items[0];
  assert.equal(it.box, undefined);
  assert.deepEqual(it.transform, { x: 0.30000000000000004, y: 0.45, width: 0.4, height: 0.5, rotation: 10 });
});

test('a keyframe colour must parse to a colour, and seedId is a non-empty string kept on the item', () => {
  const keyed = (v) => normalizeComposition(base([{ id: 'v', items: [block('b', { keyframes: { 'params.color': [{ t: 0, v: '#ff0000' }, { t: 1, v }] } })] }]));
  for (const bad of ['#zzzzzz', '#12345', 'rgb(a, b, c)', 'rgb(1, 2)', 'reddish']) {
    const r = keyed(bad);
    assert.deepEqual(r.errors.map((e) => e.path), ['tracks[0].items[0].keyframes.params.color[1].v'], bad);
    assert.match(r.errors[0].message, /is not a colour/);
  }
  for (const ok of ['#0f0', '#00FF0080', 'rgba(0, 0, 255, 0.5)', 'hsl(120, 100%, 50%)', 'transparent']) assert.deepEqual(keyed(ok).errors, [], ok);
  const seeded = (seedId) => normalizeComposition(base([{ id: 'v', items: [block('b', { seedId })] }, { id: 'a', type: 'audio', items: [{ id: 'k-b', asset: 'kick', start: 0, duration: 2, seedId: 'k' }] }]));
  assert.equal(seeded('a').composition.tracks[0].items[0].seedId, 'a');
  assert.equal(seeded('a').composition.tracks[1].items[0].seedId, 'k', 'audio items too');
  for (const bad of ['', 7, null]) assert.deepEqual(seeded(bad).errors.map((e) => e.path), ['tracks[0].items[0].seedId'], JSON.stringify(bad));
  assert.equal('seedId' in normalizeComposition(base([{ id: 'v', items: [block('b')] }])).composition.tracks[0].items[0], false, 'not added to an item that has none');
});

test('geometry: the anchor sits at (x, y); scale and rotation turn about it; inverse maps back', () => {
  const g = layerGeometry({ x: 0.5, y: 0.5, width: 0.5, height: 0.5, rotation: 90 }, 400, 200);
  assert.equal(g.width, 200); assert.equal(g.height, 100);
  const [tl] = corners(g);
  assert.ok(Math.abs(tl.x - 250) < 1e-9 && Math.abs(tl.y - 0) < 1e-9, `top-left after 90° is (250, 0), got ${JSON.stringify(tl)}`);
  const back = apply(invert(g.matrix), tl.x, tl.y);
  assert.ok(Math.abs(back.x) < 1e-9 && Math.abs(back.y) < 1e-9);
  const safe = layerGeometry({ space: 'safe', x: 0, y: 0, anchorX: 0, anchorY: 0, width: 1, height: 1 }, 1080, 1920);
  assert.deepEqual(corners(safe)[0], { x: 72, y: 250 });
  assert.equal(safe.width, 1080 - 144);
  assert.equal(layerGeometry({}, 640, 360).full, true);
});

test('keyframes: hold before and after, linear and eased segments, colours', () => {
  const keys = [{ t: 1, v: 0 }, { t: 2, v: 10, ease: 'hold' }, { t: 3, v: 20 }];
  const ease = () => (x) => x * x;
  assert.equal(sampleKeys(keys, 0, ease), 0);
  assert.equal(sampleKeys(keys, 1.5, ease), 5);
  assert.equal(sampleKeys(keys, 2.5, ease), 10);
  assert.equal(sampleKeys(keys, 9, ease), 20);
  assert.equal(sampleKeys([{ t: 0, v: 0, ease: 'in' }, { t: 1, v: 100 }], 0.5, ease), 25);
  assert.equal(sampleKeys([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff' }], 0.5, ease), 'rgba(128,128,128,1)');
  const it = forFormat({ id: 'a', params: { a: 1, b: 2 }, transform: { x: 0.1, y: 0.2 }, formats: { vertical: { transform: { x: 0.9 }, params: { b: 3 } } } }, 'vertical');
  assert.deepEqual(it.transform, { x: 0.9, y: 0.2 });
  assert.deepEqual(it.params, { a: 1, b: 3 });
});

test('an identity transform draws the same pixels as a v1 full-frame item', async () => {
  const v1 = await pixels(base([{ id: 'v', items: [{ id: 's', asset: 'scene', start: 0, duration: 2, params: { title: 'Same' } }] }]), 0.7);
  const v2 = await pixels(base([{ id: 'v', items: [{ id: 's', asset: 'scene', start: 0, duration: 2, params: { title: 'Same' }, transform: {} }] }]), 0.7);
  assert.equal(v2.hash, v1.hash);
  const b1 = await pixels(base([{ id: 'v', items: [{ id: 'l', asset: 'label', start: 0, duration: 2, params: { text: 'Box' }, box: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } }] }]), 1);
  const b2 = await pixels(base([{ id: 'v', items: [{ id: 'l', asset: 'label', start: 0, duration: 2, params: { text: 'Box' }, box: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, transform: {} }] }]), 1);
  assert.equal(b2.hash, b1.hash, 'a box read as a transform lands on the same pixels');
});

test('position, scale and rotation move the pixels where the geometry says', async () => {
  // a 0.25 × 0.5 block, anchored at its centre on (0.25, 0.5), turned 90°: it lies flat
  const p = await pixels(base([{ id: 'v', items: [block('b', { transform: { x: 0.25, y: 0.5, width: 0.25, height: 0.5, rotation: 90 } })] }]));
  // unrotated it is 80×90 (x 40..120, y 45..135); turned, it is 90×80 (x 35..125, y 50..130)
  assert.ok(isRed(p.at(36, 90)) && isRed(p.at(124, 90)) && isBlack(p.at(32, 90)) && isBlack(p.at(128, 90)), 'wide after rotation');
  assert.ok(isRed(p.at(80, 52)) && isRed(p.at(80, 128)) && isBlack(p.at(80, 47)) && isBlack(p.at(80, 133)), 'and short');
  const s = await pixels(base([{ id: 'v', items: [block('b', { transform: { x: 0.5, y: 0.5, width: 0.5, height: 0.5, scale: 0.5 } })] }]));
  assert.ok(isRed(s.at(160, 90)) && isBlack(s.at(110, 90)) && isRed(s.at(125, 90)), 'scaled to a quarter of the frame width about its centre');
});

test('keyframes drive the transform and params, with curves from the pinned easing asset', async () => {
  const comp = base([{ id: 'v', items: [block('b', {
    transform: { width: 0.1, height: 0.1 },
    keyframes: { x: [{ t: 0, v: 0.1 }, { t: 2, v: 0.9 }], 'params.color': [{ t: 0, v: '#ff0000' }, { t: 1, v: '#0000ff', ease: 'outCubic' }, { t: 2, v: '#0000ff' }] },
  })] }]);
  const pinned = studio.clips.prepare(comp).composition;
  assert.equal(pinned.easing, 'easing@1', 'an eased keyframe pins the easing asset');
  const p0 = await pixels(comp, 0), p1 = await pixels(comp, 1);
  assert.ok(isRed(p0.at(32, 90)), 'starts red on the left');
  assert.ok(isBlue(p1.at(160, 90)) && isBlack(p1.at(32, 90)), 'half way it is in the middle, blue');
  const curve = normalizeComposition(base([{ id: 'v', items: [block('b', { keyframes: { rotation: [{ t: 0, v: 0, ease: 'outBounceX' }, { t: 1, v: 90 }] } })] }])).composition;
  await assert.rejects(studio.clipFrame({ composition: curve, t: 0.5 }), /unknown easing "outBounceX" in easing@1/);
  assert.throws(() => studio.clips.prepare(base([{ id: 'v', items: [block('b', { keyframes: { 'params.nope': [{ t: 0, v: 1 }] } })] }])), /block@1 has no parameter "nope"/);
  assert.throws(() => studio.clips.prepare(base([{ id: 'v', items: [block('b', { keyframes: { 'params.size': [{ t: 0, v: 3 }] } })] }])), /keyframes.params.size at 0s: 3 is above the maximum 1/);
});

test('per-format overrides: one composition, a layout for each format', async () => {
  const comp = { format: 'horizontal', fps: 10, duration: 2, background: '#000000', tracks: [{ id: 'v', items: [block('b', {
    transform: { x: 0.25, y: 0.5, width: 0.2, height: 0.2 },
    formats: { vertical: { transform: { x: 0.5, y: 0.25 }, params: { color: '#0000ff' } }, square: { hidden: true } },
  })] }] };
  const h = await pixels(comp, 0.5);
  assert.ok(isRed(h.at(480, 540)) && isBlack(h.at(960, 540)), 'horizontal: left of centre, red');
  const v = await pixels({ ...comp, format: 'vertical' }, 0.5);
  assert.ok(isBlue(v.at(540, 480)) && isBlack(v.at(270, 960)), 'vertical: top centre, blue');
  const s = await pixels({ ...comp, format: 'square' }, 0.5);
  assert.ok(isBlack(s.at(270, 540)) && isBlack(s.at(540, 540)), 'square: hidden');
});

test('a format override on a v1 item with a box keeps the box: the override changes only what it names', async () => {
  const box = { x: 0.5, y: 0.25, width: 0.25, height: 0.25 };
  const item = block('b', { box, formats: { vertical: { transform: { scale: 1.1 } } } });
  assert.deepEqual(forFormat(item, 'vertical').transform, { x: 0.625, y: 0.375, width: 0.25, height: 0.25, scale: 1.1 });
  assert.equal(forFormat(item, 'square'), item, 'no override, no change');
  // a different anchor keeps the box where it is, as a box with a transform does when the composition is normalized
  assert.deepEqual(forFormat({ ...item, formats: { vertical: { transform: { anchorX: 0, anchorY: 1 } } } }, 'vertical').transform, { x: 0.5, y: 0.5, width: 0.25, height: 0.25, anchorX: 0, anchorY: 1 });
  const comp = { format: 'vertical', fps: 10, duration: 2, background: '#000000', tracks: [{ id: 'v', items: [item] }] };
  const v = await pixels(comp, 0.5);
  // the box is x 540..810, y 480..960 of 1080 × 1920; scaled by 1.1 about its centre it is x 526.5..823.5, y 456..984
  assert.ok(isRed(v.at(675, 720)) && isRed(v.at(532, 720)) && isRed(v.at(675, 462)), 'the block is where its box puts it, a little larger');
  assert.ok(isBlack(v.at(520, 720)) && isBlack(v.at(830, 720)) && isBlack(v.at(675, 450)) && isBlack(v.at(675, 990)) && isBlack(v.at(270, 1440)), 'and nowhere else (not the full frame)');
  const plain = await pixels({ ...comp, tracks: [{ id: 'v', items: [block('b', { box })] }] }, 0.5);
  assert.ok(isRed(plain.at(545, 720)) && isBlack(plain.at(532, 720)), 'without the override it is the box itself');
});

test('z-order follows the track order; move_track and move_item change what is in front', async () => {
  const comp = base([
    { id: 'shape', items: [block('red', { transform: { width: 0.5, height: 0.5 } })] },
    { id: 'title', items: [block('blue', { params: { color: '#0000ff' }, transform: { width: 0.2, height: 0.2 } })] },
  ]);
  assert.ok(isBlue((await pixels(comp)).at(160, 90)), 'the title is in front');
  const behind = studio.clips.applyOps(comp, [{ op: 'move_track', id: 'title', index: 0 }]);
  assert.deepEqual(behind.tracks.map((t) => t.id), ['title', 'shape']);
  assert.ok(isRed((await pixels(behind)).at(160, 90)), 'after move_track the title is behind the shape');
  const moved = studio.clips.applyOps(comp, [{ op: 'move_item', id: 'blue', track: 'shape', index: 0 }]);
  assert.deepEqual(moved.tracks[0].items.map((i) => i.id), ['blue', 'red']);
  assert.ok(isRed((await pixels(moved)).at(160, 90)), 'moved under the red block on its track');
});

test('solo, hide, lock and mute are track flags; solo draws only soloed tracks', async () => {
  const comp = base([
    { id: 'a', items: [block('red', { transform: { x: 0.25, width: 0.2, height: 0.2 } })] },
    { id: 'b', items: [block('blue', { params: { color: '#0000ff' }, transform: { x: 0.75, width: 0.2, height: 0.2 } })] },
  ]);
  const solo = studio.clips.applyOps(comp, [{ op: 'update_track', id: 'b', patch: { solo: true, locked: true, name: 'Blue' } }]);
  assert.deepEqual({ ...solo.tracks[1], items: undefined }, { id: 'b', items: undefined, solo: true, locked: true, name: 'Blue' });
  const p = await pixels(solo);
  assert.ok(isBlack(p.at(80, 90)) && isBlue(p.at(240, 90)));
  const off = studio.clips.applyOps(solo, [{ op: 'update_track', id: 'b', patch: { solo: false } }]);
  assert.equal(off.tracks[1].solo, undefined);
  assert.throws(() => studio.clips.applyOps(comp, [{ op: 'update_track', id: 'a', patch: { items: [] } }]), /update_track can change name, hidden, locked, solo, muted/);
});

test('image assets are layers: contain, cover and fill inside a transformed box', async () => {
  const contain = await pixels(base([{ id: 'v', items: [{ id: 'img', asset: 'two-squares', start: 0, duration: 2, transform: { width: 0.5, height: 0.5 } }] }]));
  // a 2:1 image contained in a 160×90 box centred in the frame: 160×80, from x 80 to 240
  assert.ok(isGreen(contain.at(100, 90)) && isBlue(contain.at(220, 90)));
  assert.ok(isBlack(contain.at(160, 48)), 'letterboxed above');
  const cover = await pixels(base([{ id: 'v', items: [{ id: 'img', asset: 'two-squares', start: 0, duration: 2, params: { fit: 'cover' }, transform: { width: 0.25, height: 0.5 } }] }]));
  // covering an 80×90 box: 180×90 scaled, cropped to the box (x 120..200)
  assert.ok(isGreen(cover.at(150, 90)) && isBlue(cover.at(170, 90)) && isBlack(cover.at(110, 90)) && isBlack(cover.at(210, 90)));
  assert.throws(() => studio.clips.prepare(base([{ id: 'v', items: [{ id: 'img', asset: 'two-squares', start: 0, duration: 2, params: { fit: 'stretch' } }] }])), /params.fit: expected one of contain, cover, fill/);
});

test('split_item keeps playing where the first part stopped (same pixels on both sides of the cut)', async () => {
  const comp = base([{ id: 'v', items: [{ id: 'c', asset: 'clock', start: 0, duration: 2 }] }]);
  const split = studio.clips.applyOps(comp, [{ op: 'split_item', id: 'c', at: 0.8 }]);
  assert.deepEqual(split.tracks[0].items.map(({ id, start, duration, offset, assetDuration, seedId }) => ({ id, start, duration, offset, assetDuration, seedId })),
    [{ id: 'c', start: 0, duration: 0.8, offset: undefined, assetDuration: 2, seedId: undefined }, { id: 'c-b', start: 0.8, duration: 1.2, offset: 0.8, assetDuration: 2, seedId: 'c' }]);
  for (const t of [0.3, 0.8, 1.5]) assert.equal((await pixels(split, t)).hash, (await pixels(comp, t)).hash, `t=${t}`);
  // a part split again still takes its seed from the item it all started as; the pieces normalize as they are
  const twice = studio.clips.applyOps(split, [{ op: 'split_item', id: 'c-b', at: 1.4 }]);
  assert.deepEqual(twice.tracks[0].items.map(({ id, offset, seedId }) => ({ id, offset, seedId })), [{ id: 'c', offset: undefined, seedId: undefined }, { id: 'c-b', offset: 0.8, seedId: 'c' }, { id: 'c-b-b', offset: 1.4, seedId: 'c' }]);
  assert.deepEqual(normalizeComposition(twice).composition.tracks[0].items.map((i) => i.seedId), [undefined, 'c', 'c']);
  for (const t of [1.3, 1.4, 1.9]) assert.equal((await pixels(twice, t)).hash, (await pixels(comp, t)).hash, `split twice, t=${t}`);
  assert.throws(() => studio.clips.applyOps(comp, [{ op: 'split_item', id: 'c', at: 2 }]), /not inside item "c"/);
});

test('edit ops: transforms and keyframes per format, overrides, duplicates; empty overrides disappear', () => {
  const comp = base([{ id: 'v', items: [block('b')] }]);
  let c = studio.clips.applyOps(comp, [
    { op: 'set_transform', id: 'b', transform: { x: 0.2, rotation: 15 } },
    { op: 'set_transform', id: 'b', format: 'vertical', transform: { x: 0.7 } },
    { op: 'add_keyframe', id: 'b', prop: 'scale', t: 0, v: 0.5 },
    { op: 'add_keyframe', id: 'b', prop: 'scale', t: 1, v: 1, ease: 'outBack' },
    { op: 'add_keyframe', id: 'b', prop: 'scale', t: 0, v: 0.6 },
    { op: 'duplicate_item', id: 'b' },
  ]);
  const b = c.tracks[0].items[0];
  assert.deepEqual(b.transform, { x: 0.2, rotation: 15 });
  assert.deepEqual(b.formats, { vertical: { transform: { x: 0.7 } } });
  assert.deepEqual(b.keyframes.scale, [{ t: 0, v: 0.6 }, { t: 1, v: 1, ease: 'outBack' }]);
  assert.equal(c.tracks[0].items[1].id, 'b-copy');
  c = studio.clips.applyOps(c, [
    { op: 'set_transform', id: 'b', format: 'vertical', transform: { x: null } },
    { op: 'remove_keyframe', id: 'b', prop: 'scale', t: 0 },
    { op: 'remove_keyframe', id: 'b', prop: 'scale', t: 1 },
  ]);
  assert.equal(c.tracks[0].items[0].formats, undefined);
  assert.equal(c.tracks[0].items[0].keyframes, undefined);
});

test('a clip renders in another format from one composition, with that format\'s overrides', async () => {
  await studio.clips.createClip({ slug: 'formats', author: AUTHOR, composition: { format: 'square', fps: 5, duration: 1, background: '#000000', tracks: [{ id: 'v', items: [block('b', { duration: 1, transform: { width: 0.2, height: 0.2 }, formats: { vertical: { params: { color: '#0000ff' } } } })] }] } });
  const r = studio.renders.enqueue({ clip: 'formats', format: 'vertical' });
  assert.equal(r.format, 'vertical');
  assert.equal(r.width, 1080); assert.equal(r.height, 1920);
  const comp = JSON.parse(studio.db.prepare('SELECT composition FROM renders WHERE id = ?').get(r.id).composition);
  assert.equal(comp.format, 'vertical');
  const frame = await pixels(comp, 0.5);
  assert.ok(isBlue(frame.at(540, 960)));
  assert.throws(() => studio.renders.enqueue({ clip: 'formats', format: 'portrait' }), /Unknown format "portrait"/);
});
