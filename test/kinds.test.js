// The asset kinds added in iteration 2 (motion, transition, effect), masks, precomps and presets,
// plus the tweak-and-keep services: metadata edits, new defaults, version diffs. Contract tests:
// validation, determinism and what each one does to the rendered pixels.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCanvas, loadImage, nodeHost, FRAME_CONTEXT, ROOT } from '../src/render/host.js';
import { createRuntime } from '../src/core/runtime.js';
import { openDb } from '../src/db/db.js';
import { tempStudio, AUTHOR, EASING, LABEL } from './helpers.js';
import * as K from './fixtures/kinds.js';

const BLOCK = `asset({
  description: 'A solid block that fills its whole box, for tests.',
  tags: ['shape', 'test'],
  duration: 2,
  params: { color: { type: 'color', default: '#ff0000' } },
  render(f, p) { f.ctx.fillStyle = p.color; f.ctx.fillRect(0, 0, f.width, f.height); },
});`;

let t, studio;
before(async () => {
  t = tempStudio();
  studio = t.studio;
  await studio.clips.createClip({ slug: 'kinds', title: 'Kinds', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 3 });
  for (const [slug, source] of [['easing', EASING], ['label', LABEL], ['block', BLOCK], ['pop', K.MOTION_POP], ['slide', K.MOTION_SLIDE], ['wiggle', K.MOTION_WIGGLE], ['bounce', K.MOTION_BOUNCE],
    ['wipe', K.TRANSITION_WIPE], ['push', K.TRANSITION_PUSH], ['iris', K.TRANSITION_IRIS], ['glow', K.EFFECT_GLOW], ['grain', K.EFFECT_GRAIN], ['duotone', K.EFFECT_DUOTONE], ['blur', K.EFFECT_BLUR], ['circle', K.MASK_CIRCLE], ['bar', K.BAR], ['scatter', K.SCATTER]]) {
    await studio.library.createAsset({ slug, source, author: AUTHOR, forClip: 'kinds' });
  }
});
after(() => t.cleanup());

const base = (tracks, extra = {}) => ({ width: 320, height: 180, fps: 10, duration: 3, background: '#000000', tracks, ...extra });
const block = (id, extra = {}) => ({ id, asset: 'block', start: 0, duration: 3, ...extra });
async function frame(composition, time) {
  const r = await studio.clipFrame({ composition, t: time, hash: true });
  const img = await loadImage(r.png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  return { hash: r.hash, at: (x, y) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; } };
}
const isRed = (/** @type {number[]} */ [r, g, b]) => r > 200 && g < 60 && b < 60;
const isBlue = (/** @type {number[]} */ [r, g, b]) => b > 200 && r < 60 && g < 60;
const isBlack = (/** @type {number[]} */ [r, g, b]) => r < 30 && g < 30 && b < 30;

test('every new kind validates, with a demo thumbnail and its kind recorded', () => {
  for (const [slug, kind] of [['pop', 'motion'], ['wiggle', 'motion'], ['wipe', 'transition'], ['glow', 'effect'], ['grain', 'effect']]) {
    const a = studio.library.getAsset(slug);
    assert.equal(a.kind, kind, slug);
    assert.ok(a.thumb, `${slug} has a thumbnail`);
    assert.ok(a.meta.test.length >= 3, `${slug} was test-drawn`);
  }
  assert.ok(studio.library.getAsset('pop').meta.test.some((x) => x.format === 'in' && x.delta.scale === 0.3), 'a motion is checked per phase');
  const kinds = studio.library.search({ kind: 'effect' }).assets.map((a) => a.slug).sort();
  assert.deepEqual(kinds, ['blur', 'duotone', 'glow', 'grain']);
});

test('a broken asset of each new kind is rejected with a useful error, and nothing crashes', async () => {
  for (const [what, [source, expected]] of Object.entries(K.BROKEN)) {
    await assert.rejects(studio.library.createAsset({ slug: 'broken', source, author: AUTHOR }), (/** @type {any} */ e) => expected.test(e.message) || assert.fail(`${what}: ${e.message}`));
  }
  assert.equal(studio.library.versionRow('broken'), undefined);
  assert.ok((await studio.assetFrame({ ref: 'glow', t: 0.5 })).png.length > 100, 'the pool still renders');
});

test('motions: in, out, emphasis and loop move the item; at rest it is exactly where it was', async () => {
  const still = base([{ id: 'v', items: [block('b', { transform: { width: 0.2, height: 0.2 } })] }]);
  const moving = base([{ id: 'v', items: [block('b', { transform: { width: 0.2, height: 0.2 }, motions: [
    { asset: 'slide', phase: 'in', duration: 1, params: { from: 'left', distance: 0.5 } },
    { asset: 'pop', phase: 'out', duration: 0.5 },
    { asset: 'bounce', phase: 'emphasis', at: 1.5, duration: 0.5 },
  ] })] }]);
  const start = await frame(moving, 0);
  assert.ok(isBlack(start.at(160, 90)) && isRed(start.at(160 - 160, 90)), 'starts half a frame to the left');
  assert.equal((await frame(moving, 1.2)).hash, (await frame(still, 1.2)).hash, 'between motions it rests where its transform puts it');
  const bounce = await frame(moving, 1.75);
  assert.ok(isRed(bounce.at(160, 60)) && isBlack(bounce.at(160, 105)), 'the emphasis lifts it');
  const out = await frame(moving, 2.9);
  assert.ok(isBlack(out.at(135, 90)) && !isBlack(out.at(160, 90)), 'popping out: smaller');
  const wiggle = base([{ id: 'v', items: [block('b', { transform: { width: 0.5, height: 0.1 }, motions: [{ asset: 'wiggle', phase: 'loop', params: { angle: 30, speed: 1 } }] })] }]);
  assert.notEqual((await frame(wiggle, 0.25)).hash, (await frame(still, 0.25)).hash);
  assert.equal((await frame(wiggle, 0.5)).hash, (await frame(wiggle, 0.5)).hash, 'deterministic');
  assert.throws(() => studio.clips.prepare(base([{ id: 'v', items: [block('b', { motions: [{ asset: 'glow' }] })] }])), /motions\[0\]: glow@1 is a effect asset; this takes motion assets/);
  assert.throws(() => studio.clips.prepare(base([{ id: 'v', items: [block('b', { motions: [{ asset: 'pop', phase: 'sideways' }] })] }])), /phase must be one of in, out, emphasis, loop/);
});

test('transitions hand over from the item before (held on its last frame) to the next', async () => {
  const comp = base([{ id: 'v', items: [block('a', { duration: 1 }), block('b', { start: 1, duration: 2, params: { color: '#0000ff' }, transition: { asset: 'wipe', duration: 1 } })] }]);
  const before = await frame(comp, 0.5);
  assert.ok(isRed(before.at(160, 90)));
  const mid = await frame(comp, 1.5);
  assert.ok(isBlue(mid.at(60, 90)) && isRed(mid.at(260, 90)), 'half wiped: the next on the left, the held previous on the right');
  const after = await frame(comp, 2.5);
  assert.ok(isBlue(after.at(260, 90)));
  const push = base([{ id: 'v', items: [block('a', { duration: 1.5 }), block('b', { start: 1, duration: 2, params: { color: '#0000ff' }, transition: { asset: 'push', duration: 1 } })] }]);
  const p = await frame(push, 1.5);
  assert.ok(isRed(p.at(60, 90)) && isBlue(p.at(260, 90)), 'pushing: the previous moves left, the next comes in from the right');
  const first = base([{ id: 'v', items: [block('b', { params: { color: '#0000ff' }, transition: { asset: 'iris', duration: 1 } })] }]);
  const iris = await frame(first, 0.5);
  assert.ok(isBlue(iris.at(160, 90)) && isBlack(iris.at(5, 5)), 'with nothing before it, an iris reveals the item from black');
});

test('effects on an item, on a track and on the whole clip; deterministic frame to frame', async () => {
  const plain = base([{ id: 'v', items: [block('b', { transform: { width: 0.5, height: 0.5 } })] }]);
  const duo = base([{ id: 'v', items: [block('b', { transform: { width: 0.5, height: 0.5 }, effects: [{ asset: 'duotone', params: { dark: '#00ff00', light: '#ffffff' } }] })] }]);
  const d = await frame(duo, 1);
  const [r, g, b] = d.at(160, 90);
  assert.ok(g > r && g > b, `the red block is mapped onto green..white (got ${r},${g},${b})`);
  assert.ok(isBlack(d.at(20, 20)), 'clear pixels stay clear');
  const white = block('b', { params: { color: '#ffffff' }, transform: { width: 0.2, height: 0.2 } });
  const glow = base([{ id: 'v', items: [white], effects: [{ asset: 'glow', params: { radius: 20, strength: 1.5 } }] }]);
  const gl = await frame(glow, 1), pl = await frame(base([{ id: 'v', items: [white] }]), 1);
  assert.ok(gl.at(160 + 40, 90)[0] > pl.at(160 + 40, 90)[0] + 10, 'a track effect glows past the block edge');
  const grain = { ...plain, effects: [{ asset: 'grain', params: { amount: 0.3 } }] };
  const g1 = await frame(grain, 1), g2 = await frame(grain, 1), g3 = await frame(grain, 1.1);
  assert.equal(g1.hash, g2.hash, 'the same frame twice is the same');
  assert.notEqual(g1.hash, g3.hash, 'grain changes from frame to frame');
  assert.notEqual(g1.hash, (await frame(plain, 1)).hash);
});

test('every context that is read back (effects, luma masks) is made with willReadFrequently, the frame\'s own included', () => {
  // a host whose canvases note the options their context was made with, and every getImageData on it
  const options = new WeakMap(), reads = [];
  const watch = (canvas) => {
    const get = canvas.getContext.bind(canvas);
    canvas.getContext = (type, o) => {
      const ctx = get(type, o);
      if (options.has(ctx)) return ctx;
      options.set(ctx, o);
      const read = ctx.getImageData.bind(ctx);
      ctx.getImageData = (...args) => { reads.push(options.get(ctx)?.willReadFrequently === true); return read(...args); };
      return ctx;
    };
    return canvas;
  };
  const rt = createRuntime({ ...nodeHost, createCanvas: (w, h) => watch(createCanvas(w, h)) });
  rt.load({ 'block@1': { source: BLOCK }, 'grain@1': { source: K.EFFECT_GRAIN }, 'circle@1': { source: K.MASK_CIRCLE } });
  const fx = [{ asset: 'grain@1', params: {} }];
  const comp = { width: 64, height: 36, fps: 10, duration: 1, background: '#000000', effects: fx, tracks: [{ id: 'v', type: 'visual', effects: fx,
    items: [{ id: 'b', asset: 'block@1', start: 0, duration: 1, params: {}, effects: fx, mask: { asset: 'circle@1', params: {}, mode: 'luma' } }] }] };
  // the frame's context is made by the host, as the render worker makes it
  rt.renderClipFrame(watch(createCanvas(64, 36)).getContext('2d', FRAME_CONTEXT), comp, 5);
  assert.equal(reads.length, 4, 'the item effect, the luma mask, the track effect and the clip effect each read a layer back');
  assert.deepEqual(reads, [true, true, true, true]);
  // the clip effect is the one that reads the frame itself: without the option on the frame's context a browser warns
  reads.length = 0;
  rt.renderClipFrame(watch(createCanvas(64, 36)).getContext('2d'), comp, 5);
  assert.deepEqual(reads, [true, true, true, false]);
  // so both hosts ask for it wherever they hand the runtime a frame to draw on
  for (const file of ['src/render/frame-worker.js', 'src/ui/preview-worker.js']) {
    const calls = readFileSync(join(ROOT, file), 'utf8').split('\n').filter((line) => /\.render(ClipFrame|Asset)\(/.test(line));
    assert.ok(calls.length >= 2 && calls.every((line) => /getContext\('2d', (FRAME_CONTEXT|\{ willReadFrequently: true \})\)/.test(line)), `${file}: ${calls.join(' | ')}`);
  }
});

test('masks: alpha, inverted and luma; the mask moves with the layer unless it has its own transform', async () => {
  const masked = (mode, extra = {}) => base([{ id: 'v', items: [block('b', { mask: { asset: 'circle', mode, params: { radius: 0.5 }, ...extra } })] }]);
  const a = await frame(masked('alpha'), 1);
  assert.ok(isRed(a.at(160, 90)) && isBlack(a.at(10, 10)), 'inside the disc only');
  const inv = await frame(masked('alpha-inverted'), 1);
  assert.ok(isBlack(inv.at(160, 90)) && isRed(inv.at(10, 10)));
  const luma = await frame(masked('luma'), 1);
  assert.ok(isRed(luma.at(160, 90)));
  const own = await frame(masked('alpha', { transform: { x: 0.2, y: 0.5, width: 0.3, height: 0.5 } }), 1);
  assert.ok(isRed(own.at(64, 90)) && isBlack(own.at(160, 90)), 'a mask with its own transform stays where it is put');
});

test('presets: a named asset that is a base plus params; it pins the base and draws the same', async () => {
  const r = await studio.library.createPreset({ base: 'label', slug: 'label-shout', params: { text: 'SHOUT', color: '#ffcc00' }, author: AUTHOR });
  const p = r.asset;
  assert.equal(p.ref, 'label-shout@1');
  assert.equal(p.derivation, 'preset');
  assert.equal(p.forkedFrom, 'label@1');
  assert.deepEqual(p.deps, { base: 'label@1' });
  assert.ok(p.tags.includes('preset'));
  assert.equal(p.schema.text.default, 'SHOUT');
  assert.match(studio.library.getAsset('label-shout').source, /return f\.use\('base', p\);/);
  const viaPreset = await studio.assetFrame({ ref: 'label-shout', t: 1, hash: true, format: 'square' });
  const viaBase = await studio.assetFrame({ ref: 'label', params: { text: 'SHOUT', color: '#ffcc00' }, t: 1, hash: true, format: 'square' });
  assert.equal(viaPreset.hash, viaBase.hash, 'the preset draws exactly what the base draws with those params');
  // the base moves on; the preset keeps its pinned version
  await studio.library.updateAsset({ slug: 'label', source: LABEL.replace("weight: 800", "weight: 400"), author: AUTHOR });
  assert.equal((await studio.assetFrame({ ref: 'label-shout', t: 1, hash: true, format: 'square' })).hash, viaPreset.hash);
  // used in a clip like any asset, with its params still adjustable per item
  await studio.clips.editClip('kinds', [{ op: 'add_track', track: { id: 'titles', type: 'text' } }, { op: 'add_item', track: 'titles', item: { id: 'shout', asset: 'label-shout', start: 0, duration: 2, params: { text: 'Hello' } } }]);
  assert.ok(studio.clips.clipAssets('kinds').some((x) => x.ref === 'label-shout@1' && x.direct));
  assert.ok(studio.library.search({ query: 'shout' }).assets.some((x) => x.slug === 'label-shout'));
  await assert.rejects(studio.library.createPreset({ base: 'label', slug: 'label-bad', params: { size: 3 }, author: AUTHOR }), /size: unknown parameter/);
});

test('a preset pins the assets named in its params: a theme preset resolves, and keeps that version', async () => {
  const ink = (c) => `asset({ kind: 'value', description: 'An ink colour as a value asset, for tests.', tags: ['test'], render() { return { ink: '${c}' }; } });`;
  await studio.library.createAsset({ slug: 'ink-red', source: ink('#ff0000'), author: AUTHOR });
  await studio.library.createAsset({ slug: 'ink-blue', source: ink('#0000ff'), author: AUTHOR });
  await studio.library.createAsset({ slug: 'swatch', author: AUTHOR, source: `asset({
  description: 'A block filled with the ink of the theme it is given, for tests.',
  tags: ['shape', 'test'],
  duration: 2,
  params: { theme: { type: 'asset', kind: 'value', default: 'ink-red' } },
  render(f, p) { f.ctx.fillStyle = f.use(p.theme).ink; f.ctx.fillRect(0, 0, f.width, f.height); },
});` });
  const p = (await studio.library.createPreset({ base: 'swatch', slug: 'swatch-blue', params: { theme: 'ink-blue' }, author: AUTHOR })).asset;
  assert.equal(p.schema.theme.default, 'ink-blue@1', 'the bare name became a pinned ref');
  const shot = (ref, params) => studio.assetFrame({ ref, params, t: 1, hash: true, format: 'square' });
  const viaPreset = await shot('swatch-blue');
  assert.equal(viaPreset.hash, (await shot('swatch', { theme: 'ink-blue' })).hash, 'the preset draws the base with the blue ink');
  assert.notEqual(viaPreset.hash, (await shot('swatch')).hash);
  // the theme moves on; the preset keeps the version it pinned
  await studio.library.updateAsset({ slug: 'ink-blue', source: ink('#00ff00'), author: AUTHOR });
  assert.equal((await shot('swatch-blue')).hash, viaPreset.hash);
  assert.notEqual((await shot('swatch', { theme: 'ink-blue' })).hash, viaPreset.hash);
  await assert.rejects(studio.library.createPreset({ base: 'swatch', slug: 'swatch-none', params: { theme: 'no-such-ink' }, author: AUTHOR }), /no-such-ink/);
});

test('precomps: layers saved as one asset with exposed params; replacing them keeps the picture', async () => {
  await studio.clips.updateClip('kinds', { composition: base([
    { id: 'bg', items: [block('back', { params: { color: '#202060' } })] },
    { id: 'fg', items: [
      { id: 'title', asset: 'label', start: 0.5, duration: 2, params: { text: 'Precomp', color: '#ffffff' }, transform: { y: 0.3, height: 0.4 }, motions: [{ asset: 'pop', phase: 'in' }] },
      block('bar', { start: 0.5, duration: 2, transform: { y: 0.8, width: 0.6, height: 0.08 }, params: { color: '#ffcc00' }, effects: [{ asset: 'blur', params: { radius: 2 } }] }),
    ] },
  ]) });
  const before = await frame(studio.clips.getClip('kinds').composition, 1.5);
  const r = await studio.clips.savePrecomp({ clip: 'kinds', items: ['title', 'bar'], slug: 'title-card', expose: [{ item: 'title', param: 'text', name: 'headline' }, { item: 'bar', param: 'color', name: 'accent' }], replace: true, author: AUTHOR });
  assert.equal(r.asset.ref, 'title-card@1');
  assert.equal(r.asset.derivation, 'precomp');
  assert.equal(r.asset.originClip, 'kinds');
  assert.deepEqual(Object.keys(r.asset.schema), ['headline', 'accent']);
  assert.equal(r.asset.schema.headline.default, 'Precomp');
  assert.deepEqual(Object.keys(r.asset.deps).sort(), ['block', 'blur', 'label', 'pop']);
  assert.equal(r.asset.duration, 2);
  const comp = r.clip.composition;
  assert.deepEqual(comp.tracks[1].items.map((i) => [i.id, i.asset, i.start, i.duration]), [['title-card', 'title-card@1', 0.5, 2]]);
  const after = await frame(comp, 1.5);
  for (const [x, y] of [[160, 54], [160, 144], [20, 20], [100, 144]]) {
    const A = before.at(x, y), B = after.at(x, y);
    assert.ok(A.every((v, i) => Math.abs(v - B[i]) <= 3), `(${x}, ${y}) ${A} vs ${B}`);
  }
  const yellow = await frame({ ...comp, tracks: [comp.tracks[0], { ...comp.tracks[1], items: [{ ...comp.tracks[1].items[0], params: { accent: '#00ff00' } }] }] }, 1.5);
  const [rr, gg] = yellow.at(160, 144);
  assert.ok(gg > 150 && rr < 100, 'an exposed param reaches the layer inside');
  await assert.rejects(studio.clips.savePrecomp({ clip: 'kinds', items: ['nope'], slug: 'x-card', author: AUTHOR }), /No item "nope"/);
});

test('split_item is a continuation: the seed, the transition, the motions, the effects and the mask carry on over the cut', async () => {
  const item = (asset, extra = {}) => ({ id: 's', asset, start: 0, duration: 3, ...extra });
  const motions = [
    { asset: 'slide', phase: 'in', duration: 1, params: { from: 'left', distance: 0.3 } },
    { asset: 'pop', phase: 'out', duration: 1 },
    { asset: 'bounce', phase: 'emphasis', at: 1.6, duration: 0.5 },
    { asset: 'wiggle', phase: 'loop', params: { angle: 20, speed: 0.4 } },
  ];
  // [composition, where "s" is cut, the times to compare: before the cut, on it and after it]
  /** @type {Record<string, [any, number, number[]]>} */
  const cases = {
    'an rng-driven asset': [base([{ id: 'v', items: [item('scatter')] }]), 1.5, [0.7, 1.4, 1.5, 2.3]],
    'a transition into the item': [base([{ id: 'v', items: [block('a', { duration: 1 }), item('bar', { start: 1, duration: 2, transition: { asset: 'wipe', duration: 0.6 } })] }]), 2, [1.3, 1.9, 2, 2.3, 2.9]],
    'in, out, emphasis and loop motions': [base([{ id: 'v', items: [item('bar', { transform: { width: 0.5, height: 0.3 }, motions })] }]), 1.5, [0.5, 1.2, 1.4, 1.5, 1.7, 2.5, 2.9]],
    'an animated, seeded effect': [base([{ id: 'v', items: [item('bar', { effects: [{ asset: 'grain', params: { amount: 0.6 } }] })] }]), 1.5, [0.7, 1.4, 1.5, 2.3]],
    'an rng-driven mask': [base([{ id: 'v', items: [item('bar', { mask: { asset: 'scatter' } })] }]), 1.5, [0.7, 1.5, 2.3]],
    'all of it at once': [base([{ id: 'v', items: [block('a', { duration: 1 }), item('scatter', { start: 1, duration: 2, transform: { width: 0.8, height: 0.8 }, transition: { asset: 'wipe', duration: 0.6 },
      motions: [{ asset: 'pop', phase: 'in', duration: 0.5 }, { asset: 'pop', phase: 'out', duration: 0.5 }], effects: [{ asset: 'grain', params: { amount: 0.6 } }], mask: { asset: 'scatter' } })] }]), 2, [1.3, 1.9, 2, 2.3, 2.8]],
  };
  for (const [name, [comp, at, times]] of Object.entries(cases)) {
    const split = studio.clips.applyOps(comp, [{ op: 'split_item', id: 's', at }]);
    const [first, second] = split.tracks[0].items.slice(-2);
    assert.deepEqual([first.id, second.id, second.seedId, second.transition], ['s', 's-b', 's', undefined], name);
    assert.deepEqual(first.transition, comp.tracks[0].items.at(-1).transition, `${name}: the transition stays on the first part`);
    assert.deepEqual(studio.clips.prepare(split).composition.tracks[0].items.at(-1).seedId, 's', `${name}: the saved clip keeps the seed id`);
    for (const t of times) assert.equal((await frame(split, t)).hash, (await frame(comp, t)).hash, `${name}: t=${t} of the split clip is the frame of the whole one`);
  }
  // the checks above compare with the whole item; these say the whole item shows what the parts must not repeat
  const [rng, , moving] = Object.values(cases).map((c) => c[0]);
  assert.notEqual((await frame(rng, 1.5)).hash, (await frame({ ...rng, seed: 2 }, 1.5)).hash, 'the scatter depends on its seed');
  assert.notEqual((await frame(moving, 2.5)).hash, (await frame(base([{ id: 'v', items: [item('bar', { transform: { width: 0.5, height: 0.3 } })] }]), 2.5)).hash, 'the out motion is running at 2.5 s');
});

test('a transition without a duration runs for its asset\'s own, else 0.5 s, and never for longer than its item', async () => {
  await studio.library.createAsset({ slug: 'wipe-any', source: K.TRANSITION_WIPE.replace("  duration: 1,\n", ''), author: AUTHOR });
  assert.equal(studio.library.getAsset('wipe-any').duration, null);
  const comp = (transition, duration = 2) => base([{ id: 'v', items: [block('a', { duration: 1 }), block('b', { start: 1, duration, params: { color: '#0000ff' }, transition })] }]);
  const same = async (a, b, times) => { for (const t of times) assert.equal((await frame(a, t)).hash, (await frame(b, t)).hash, `t=${t}`); };
  // the wipe declares duration: 1
  const mid = await frame(comp({ asset: 'wipe' }), 1.5);
  assert.ok(isBlue(mid.at(60, 90)) && isRed(mid.at(260, 90)), 'half wiped half a second in');
  await same(comp({ asset: 'wipe' }), comp({ asset: 'wipe', duration: 1 }), [1, 1.5, 1.9, 2, 2.5]);
  // one that declares none
  await same(comp({ asset: 'wipe-any' }), comp({ asset: 'wipe-any', duration: 0.5 }), [1, 1.2, 1.4, 1.5, 2]);
  const quarter = await frame(comp({ asset: 'wipe-any' }), 1.2);
  assert.ok(isBlue(quarter.at(100, 90)) && isRed(quarter.at(160, 90)), '0.2 s into 0.5 s: wiped to 40 % of the width');
  assert.ok(isBlue((await frame(comp({ asset: 'wipe-any' }), 1.6)).at(310, 90)), 'over after 0.5 s');
  // an item shorter than the transition's own second
  await same(comp({ asset: 'wipe' }, 0.4), comp({ asset: 'wipe', duration: 0.4 }, 0.4), [1, 1.2, 1.3]);
  assert.deepEqual(studio.clips.prepare(comp({ asset: 'wipe' })).composition.tracks[0].items[1].transition, { asset: 'wipe@1', params: {} }, 'the default is not written into the composition');
});

test('precomps: a transition between saved layers still plays, within its track; a layer without a duration lasts as long as the precomp', async () => {
  // two items joined by a wipe, saved as one asset: the same frames as the clip, before, during and after the handover
  const joined = base([{ id: 'bg', items: [block('back', { params: { color: '#003300' } })] }, { id: 'fg', items: [
    block('a', { duration: 1, transform: { width: 0.6, height: 0.6 } }),
    block('b', { start: 1, duration: 2, params: { color: '#0000ff' }, transform: { width: 0.6, height: 0.6 }, transition: { asset: 'wipe', duration: 1 } }),
  ] }]);
  await studio.clips.createClip({ slug: 'handover', title: 'Handover', author: AUTHOR, composition: joined });
  const r = await studio.clips.savePrecomp({ clip: 'handover', items: ['a', 'b'], slug: 'handover-card', replace: true, author: AUTHOR });
  assert.deepEqual(r.clip.composition.tracks[1].items.map((i) => i.asset), ['handover-card@1']);
  for (const t of [0.5, 1.2, 1.5, 1.9, 2.5]) assert.equal((await frame(r.clip.composition, t)).hash, (await frame(joined, t)).hash, `t=${t}`);
  const mid = await frame(r.clip.composition, 1.5);
  assert.ok(isBlue(mid.at(100, 90)) && isRed(mid.at(220, 90)) && !isRed(mid.at(20, 90)), 'half wiped inside the precomp: the next on the left, the held previous on the right');

  // layers of two tracks in one precomp: the wipe hands over from the layer before it on its own track, not from the backdrop
  await studio.library.createAsset({ slug: 'two-tracks', author: AUTHOR, source: `asset({
  description: 'A backdrop under two blocks joined by a wipe, as layers of two tracks, for precomp tests.',
  tags: ['precomp', 'test'],
  duration: 3,
  uses: ['block', 'wipe'],
  render(f) {
    f.layers([
      { id: 'back', track: 'bg', asset: 'block', start: 0, duration: 3, params: { color: '#003300' } },
      { id: 'a', track: 'fg', asset: 'block', start: 0, duration: 1, transform: { width: 0.6, height: 0.6 } },
      { id: 'b', track: 'fg', asset: 'block', start: 1, duration: 2, params: { color: '#0000ff' }, transform: { width: 0.6, height: 0.6 }, transition: { asset: 'wipe', duration: 1 } },
    ]);
  },
});` });
  const both = base([{ id: 'v', items: [{ id: 'p', asset: 'two-tracks', start: 0, duration: 3 }] }]);
  for (const t of [0.5, 1.5, 2.5]) assert.equal((await frame(both, t)).hash, (await frame(joined, t)).hash, `two tracks, t=${t}`);

  // layers without a duration: they end with the precomp, so their progress and their out motions run
  await studio.library.createAsset({ slug: 'open-ended', author: AUTHOR, source: `asset({
  description: 'Layers without a duration: two time bars and a block that pops out, for precomp tests.',
  tags: ['precomp', 'test'],
  duration: 3,
  uses: ['bar', 'block', 'pop'],
  render(f) {
    f.layers([
      { asset: 'bar', transform: { y: 0.2, height: 0.3 } },
      { asset: 'bar', start: 1, transform: { y: 0.8, height: 0.3 } },
      { asset: 'block', transform: { x: 0.9, y: 0.5, width: 0.1, height: 0.1 }, motions: [{ asset: 'pop', phase: 'out', duration: 1 }] },
    ]);
  },
});` });
  const open = base([{ id: 'v', items: [{ id: 'p', asset: 'open-ended', start: 0, duration: 3 }] }]);
  const early = await frame(open, 0.5), half = await frame(open, 1.5), late = await frame(open, 2.9);
  const isWhite = (/** @type {number[]} */ [red, green, blue]) => red > 200 && green > 200 && blue > 200;
  assert.ok(isWhite(half.at(100, 36)) && isBlack(half.at(220, 36)), 'the first bar is half way through 3 s at 1.5 s');
  assert.ok(isBlack(early.at(10, 144)), 'the second has not started at 0.5 s');
  assert.ok(isWhite(half.at(40, 144)) && isBlack(half.at(120, 144)), 'and is a quarter through its 2 s at 1.5 s');
  assert.ok(isRed(half.at(288, 90)), 'the block rests until its out motion');
  assert.ok(late.at(288, 90)[0] < 120, `and is popping out at 2.9 s (${late.at(288, 90)})`);
});

test('metadata is edited without a new code version; search follows; null goes back to the source', () => {
  const before = studio.library.getAsset('block');
  const edited = studio.library.setMetadata({ slug: 'block', title: 'Solid block', description: 'A flat colour rectangle that fills its box; good as a backdrop.', tags: ['backdrop', 'flat'], author: 'editor' });
  assert.equal(edited.version, before.version, 'no new version');
  assert.equal(edited.title, 'Solid block');
  assert.deepEqual(edited.tags, ['backdrop', 'flat']);
  assert.equal(edited.declared.title, null);
  assert.equal(edited.edited, true);
  assert.ok(studio.library.search({ tags: ['backdrop'] }).assets.some((a) => a.slug === 'block'));
  assert.ok(!studio.library.search({ tags: ['shape'] }).assets.some((a) => a.slug === 'block'), 'the old tags are gone from search');
  assert.ok(studio.library.search({ query: 'backdrop' }).assets.some((a) => a.slug === 'block'));
  assert.throws(() => studio.library.setMetadata({ slug: 'block', tags: ['Bad Tag'], author: 'editor' }), /lowercase-kebab/);
  const reset = studio.library.setMetadata({ slug: 'block', title: null, tags: null, author: 'editor' });
  assert.equal(reset.title, 'block');
  assert.deepEqual(reset.tags, ['shape', 'test']);
  assert.equal(reset.description, 'A flat colour rectangle that fills its box; good as a backdrop.');
});

test('params saved as the new defaults: the source is rewritten in place, the old version is untouched', async () => {
  const v = studio.library.versionRow('circle').version;
  const r = await studio.library.saveDefaults({ slug: 'circle', params: { radius: 0.8 }, author: AUTHOR });
  assert.equal(r.asset.version, v + 1);
  assert.equal(r.asset.schema.radius.default, 0.8);
  assert.match(r.asset.note, /New defaults: radius 0.8/);
  const d = studio.library.diffVersions('circle', v, v + 1);
  assert.equal(d.added, 1); assert.equal(d.removed, 1);
  assert.match(d.unified, /- {2}params: \{ radius: \{ type: 'number', default: 0\.5, min: 0, max: 1 \} \},\n\+ {2}params: \{ radius: \{ type: 'number', default: 0\.8, min: 0, max: 1 \} \},/);
  await assert.rejects(studio.library.saveDefaults({ slug: 'circle', params: { radius: 0.8 }, author: AUTHOR }), /already the defaults/);
  await assert.rejects(studio.library.saveDefaults({ slug: 'circle', params: { radius: 7 }, author: AUTHOR }), /radius: 7 is above the maximum 1/);
  // a param declared without a default gets one
  await studio.library.createAsset({ slug: 'nodefault', source: "asset({ description: 'A test asset whose param has no default.', tags: ['t'], params: { n: { type: 'number' } }, render(f, p) { f.ctx.fillRect(0, 0, p.n, 1); } });", author: AUTHOR });
  const nd = await studio.library.saveDefaults({ slug: 'nodefault', params: { n: 4 }, author: AUTHOR });
  assert.match(studio.library.getAsset(nd.asset.ref).source, /n: \{ type: 'number', default: 4 \}/);
});

test('a v1 database (three kinds only) is migrated on open, keeping every row and the triggers', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-migrate-'));
  try {
    const file = join(dir, 'studio.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE assets (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, type TEXT NOT NULL, latest_version INTEGER NOT NULL DEFAULT 0, forked_from INTEGER, origin_clip INTEGER, created_at TEXT NOT NULL);
      CREATE TABLE asset_versions (id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES assets(id), version INTEGER NOT NULL, kind TEXT CHECK (kind IN ('visual', 'value', 'audio')), title TEXT, description TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]', duration REAL, formats TEXT NOT NULL DEFAULT '[]', schema TEXT NOT NULL DEFAULT '{}', uses TEXT NOT NULL DEFAULT '{}', deps TEXT NOT NULL DEFAULT '{}', source TEXT, source_hash TEXT,
        file TEXT, mime TEXT, meta TEXT NOT NULL DEFAULT '{}', thumb TEXT, author TEXT NOT NULL, note TEXT, parent_version INTEGER REFERENCES asset_versions(id), clip_id INTEGER, engine INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (asset_id, version));
      CREATE TABLE asset_deps (version_id INTEGER NOT NULL REFERENCES asset_versions(id), dep_version_id INTEGER NOT NULL REFERENCES asset_versions(id), alias TEXT NOT NULL, PRIMARY KEY (version_id, alias));
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');
      INSERT INTO assets VALUES (1, 'a', 'function', 1, NULL, NULL, '2026-01-01'), (2, 'b', 'function', 1, NULL, NULL, '2026-01-01');
      INSERT INTO asset_versions (id, asset_id, version, kind, description, author, engine, created_at) VALUES (1, 1, 1, 'visual', 'first', 'x', 1, '2026'), (2, 2, 1, 'value', 'second', 'x', 1, '2026');
      INSERT INTO asset_deps VALUES (1, 2, 'b');`);
    old.close();
    const db = openDb(file);
    assert.match(String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'asset_versions'").get().sql), /'motion', 'transition', 'effect'/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asset_versions').get().n, 2);
    assert.deepEqual(db.prepare('SELECT dep_version_id FROM asset_deps').all().map((r) => r.dep_version_id), [2]);
    assert.throws(() => db.prepare("UPDATE asset_versions SET source = 'x' WHERE id = 1").run(), /immutable/);
    db.prepare("INSERT INTO asset_versions (asset_id, version, kind, description, author, engine, created_at) VALUES (1, 2, 'motion', 'a motion', 'x', 1, '2026')").run();
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '2');
    assert.ok(db.prepare('PRAGMA table_info(assets)').all().some((c) => c.name === 'meta_title'));
    db.close();
    openDb(file).close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
