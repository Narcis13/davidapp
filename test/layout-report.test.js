// What the studio can measure about text: the layout report (every f.lib.text draw with its box in frame
// pixels, after transforms, keyframes and motions), block letters in 3D, size floors, typed markers, and
// frames drawn in another format or from a draft composition.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/core/runtime.js';
import { normalizeComposition } from '../src/core/composition.js';
import { createText, TextFloorError, fontString } from '../src/core/lib/text.js';
import { nodeHost, registerFonts, createCanvas, FRAME_CONTEXT } from '../src/render/host.js';
import { tempStudio, seedAssets, AUTHOR, EASING, smallComposition } from './helpers.js';

registerFonts();

// one word, big, centred in its box: the drawn pixels are easy to find
const WORD = `asset({
  description: 'One word drawn with f.lib.text in the middle of its box, for layout tests.',
  tags: ['text', 'test'],
  duration: 2,
  params: { text: { type: 'string', default: 'Gravity' }, size: { type: 'number', default: 0.3, min: 0.01, max: 1 } },
  render(f, p) {
    const L = f.lib.text.layout(f.ctx, p.text, { font: 'Inter', weight: 800, size: f.height * p.size });
    f.ctx.fillStyle = '#ffffff';
    f.lib.text.fill(f.ctx, L, (f.width - L.width) / 2, (f.height - L.height) / 2);
  },
});`;

const NUDGE = `asset({
  kind: 'motion',
  description: 'Moves its item right by 40 px and turns it 10 degrees, for layout tests.',
  tags: ['motion', 'test'],
  duration: 2,
  render(f) { return { x: 40, rotation: 10 }; },
});`;

const BLOCKS = `asset({
  description: 'A word in 3D block letters, for layout tests.',
  tags: ['3d', 'text', 'test'],
  duration: 2,
  render(f) {
    const S = f.lib.solid;
    S.render(f, { camera: { position: [0, 0, 6], fov: 34 }, objects: [{ mesh: S.text('REUSE', { size: 1 }), color: '#ff8800', shading: 'flat' }] });
  },
});`;

const host = { ...nodeHost };
const W = 640, H = 360;
let rt;
before(() => {
  rt = createRuntime(host);
  rt.load({ 'word@1': { source: WORD }, 'nudge@1': { source: NUDGE }, 'blocks@1': { source: BLOCKS }, 'easing@1': { source: EASING } });
});

const comp = (items) => normalizeComposition({ width: W, height: H, fps: 30, duration: 2, background: '#000000', easing: 'easing@1', tracks: [{ id: 'v', type: 'visual', items }] }).composition;

/** Draw a frame twice (with and without text) and return the record and the box of the pixels that differ. */
function drawn(c, frame, itemId) {
  const a = createCanvas(W, H), b = createCanvas(W, H);
  const r = rt.renderClipFrame(a.getContext('2d', FRAME_CONTEXT), c, frame, { record: true });
  rt.renderClipFrame(b.getContext('2d', FRAME_CONTEXT), c, frame, { suppressText: true });
  const da = a.getContext('2d').getImageData(0, 0, W, H).data, db = b.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const recs = r.texts.filter((t) => t.item === itemId);
  assert.ok(recs.length, `item ${itemId} recorded text`);
  const box = recs.reduce((m, t) => ({ x0: Math.min(m.x0, t.box.x), y0: Math.min(m.y0, t.box.y), x1: Math.max(m.x1, t.box.x + t.box.width), y1: Math.max(m.y1, t.box.y + t.box.height) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  // the frame clips what is drawn; the record keeps the whole box (that is how text clipped by the frame is found)
  const clipped = { x0: Math.max(0, box.x0), y0: Math.max(0, box.y0), x1: Math.min(W, box.x1), y1: Math.min(H, box.y1) };
  return { recs, box: clipped, raw: box, px: { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
}

const near = (rec, px, tol, what) => {
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(rec[k] - px[k]) <= tol, `${what}: ${k} recorded ${rec[k].toFixed(1)}, drawn ${px[k]} (tolerance ${tol}px)`);
};

test('layout report: boxes match the drawn pixels within 2 px on plain, scaled, keyframed and moving items', () => {
  const cases = [
    { id: 'plain', params: {} },
    { id: 'scaled', params: {}, transform: { x: 0.3, y: 0.4, width: 0.5, height: 0.5, scale: 1.6 } },
    { id: 'keyed', params: {}, transform: { width: 0.6, height: 0.6 }, keyframes: { x: [{ t: 0, v: 0.2 }, { t: 1, v: 0.8, ease: 'outCubic' }], scale: [{ t: 0, v: 0.5 }, { t: 1, v: 1.2 }] } },
    { id: 'moving', params: {}, transform: { width: 0.5, height: 0.5 }, motions: [{ asset: 'nudge@1', phase: 'loop' }] },
  ];
  for (const c of cases) {
    const item = { id: c.id, asset: 'word@1', start: 0, duration: 2, params: c.params };
    if (c.transform) item.transform = c.transform;
    if (c.keyframes) item.keyframes = c.keyframes;
    if (c.motions) item.motions = c.motions;
    for (const frame of [0, 17, 40]) {
      const { box, px, recs } = drawn(comp([item]), frame, c.id);
      // a moving (rotated) item: the axis-aligned box of the rotated ink box is a little bigger than its pixels
      near(box, px, c.id === 'moving' ? 9 : 2, `${c.id} at frame ${frame}`);
      assert.equal(recs[0].family, 'Inter');
      assert.equal(recs[0].fill, '#ffffff');
      assert.ok(recs[0].screenSize > 0);
    }
  }
});

test('layout report: a rotated item\'s quad holds every drawn pixel within 2 px', () => {
  const item = { id: 'turned', asset: 'word@1', start: 0, duration: 2, params: {}, transform: { width: 0.6, height: 0.6, rotation: 30 } };
  const c = comp([item]);
  const a = createCanvas(W, H), b = createCanvas(W, H);
  const r = rt.renderClipFrame(a.getContext('2d', FRAME_CONTEXT), c, 10, { record: true });
  rt.renderClipFrame(b.getContext('2d', FRAME_CONTEXT), c, 10, { suppressText: true });
  const q = r.texts[0].quad;
  // map pixels into the quad's own axes (u along the top edge, v along the left edge)
  const [p0, p1, , p3] = q;
  const ux = [p1[0] - p0[0], p1[1] - p0[1]], vx = [p3[0] - p0[0], p3[1] - p0[1]];
  const lu = Math.hypot(...ux), lv = Math.hypot(...vx);
  const da = a.getContext('2d').getImageData(0, 0, W, H).data, db = b.getContext('2d').getImageData(0, 0, W, H).data;
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (Math.abs(da[i] - db[i]) < 60) continue;
    const dx = x + 0.5 - p0[0], dy = y + 0.5 - p0[1];
    const u = (dx * ux[0] + dy * ux[1]) / lu, v = (dx * vx[0] + dy * vx[1]) / lv;
    umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }
  for (const [got, want, k] of /** @type {[number, number, string][]} */ ([[umin, 0, 'left'], [umax, lu, 'right'], [vmin, 0, 'top'], [vmax, lv, 'bottom']])) assert.ok(Math.abs(got - want) <= 2, `rotated ${k}: pixels reach ${got.toFixed(1)}, quad edge ${want.toFixed(1)}`);
});

test('layout report: 3D block letters are recorded, and skipped when text is suppressed', () => {
  const c = comp([{ id: 'reuse', asset: 'blocks@1', start: 0, duration: 2, params: {} }]);
  const { recs, box, px } = drawn(c, 5, 'reuse');
  assert.equal(recs[0].kind, 'blocks3d');
  assert.equal(recs[0].text, 'REUSE');
  near(box, px, 2, '3D letters');
});

test('layout report: recording and suppressing change nothing when off', () => {
  const c = comp([{ id: 'plain', asset: 'word@1', start: 0, duration: 2, params: {}, transform: { width: 0.7, height: 0.7, rotation: 12 } }]);
  const a = createCanvas(W, H), b = createCanvas(W, H);
  rt.renderClipFrame(a.getContext('2d', FRAME_CONTEXT), c, 8);
  rt.renderClipFrame(b.getContext('2d', FRAME_CONTEXT), c, 8, { record: true });
  assert.ok(Buffer.from(a.data()).equals(Buffer.from(b.data())), 'a recorded frame has the same pixels');
});

test('size floors: fit stops at the floor; what still does not fit is an error, not an ellipsis', () => {
  const inspect = { record: null, suppress: false, frame: { width: 1920, height: 1080, short: 1080 }, floor: 0 };
  const T = createText(inspect);
  const ctx = createCanvas(8, 8).getContext('2d');
  const long = 'A sentence long enough that it will not fit in a narrow box at a readable size';
  // without a floor: shrinks as far as it needs
  const free = T.layout(ctx, long, { size: 80, maxWidth: 400, maxHeight: 40, fit: true });
  assert.ok(free.size < 20);
  // floor 2 % of 1080 = 21.6 px: fit stops there, and this text cannot fit at 21.6 px
  assert.throws(() => T.layout(ctx, long, { size: 80, maxWidth: 400, maxHeight: 40, fit: true, floor: 2 }), (e) => e instanceof TextFloorError && /size floor \(2% of the frame's short side, 21.6 px on screen\)/.test(e.message) && /too tall|lines/.test(e.message));
  // a floor it can meet: the fitted size never goes under it
  const ok = T.layout(ctx, 'Short title', { size: 120, maxWidth: 600, fit: true, floor: 2 });
  assert.ok(ok.size >= 21.6);
  // truncation at the floor is an error (no ellipsis)
  assert.throws(() => T.layout(ctx, long, { size: 30, maxWidth: 400, maxLines: 1, floor: 2 }), /more than 1 line/);
  // a word that would break in two
  assert.throws(() => T.layout(ctx, 'Supercalifragilisticexpialidocious', { size: 60, maxWidth: 200, fit: true, floor: 2.5 }), /break in two|too wide/);
  // the floor is on screen: a context scaled by 2 halves the size the floor allows
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  const scaled = T.layout(ctx, long, { size: 80, maxWidth: 400, maxHeight: 40, fit: true, floor: 2 });
  assert.ok(scaled.size >= 10.8 && scaled.size < 21.6);
});

test('size floors: the validator rejects an asset whose text cannot fit at its floor, and the render fails with item and time', async () => {
  const { studio, cleanup } = tempStudio();
  try {
    await seedAssets(studio);
    const bad = `asset({
      description: 'A caption that declares a size floor it cannot meet, for tests.',
      tags: ['text', 'test'],
      floor: 4,
      params: { text: { type: 'string', default: 'Short' } },
      render(f, p) {
        const L = f.lib.text.layout(f.ctx, p.text, { size: f.height * 0.1, maxWidth: f.width * 0.3, maxLines: 1, fit: true });
        f.lib.text.fill(f.ctx, L, 0, 0);
      },
    });`;
    // with its default text it fits; with a long one it cannot
    await studio.library.createAsset({ slug: 'floored', source: bad, author: AUTHOR });
    await assert.rejects(studio.library.validate({ slug: 'floored-long', version: 1, source: bad.replace("default: 'Short'", "default: 'A much longer caption than the box can hold at four percent'") }), /size floor \(4%/);
    /** @type {any} */
    const c = smallComposition();
    c.tracks[1].items.push({ id: 'cap', asset: 'floored', start: 0, duration: 2, params: { text: 'A much longer caption than the box can hold at four percent' } });
    await assert.rejects(studio.clips.createClip({ slug: 'floor-clip', author: AUTHOR, composition: c }), /item "cap" at .*size floor/);
  } finally { await cleanup(); }
});

test('fonts: the Latin Extended alias comes right after the family; Latin pixels are unchanged and ș is the family\'s own', () => {
  assert.match(fontString({ font: 'Inter', size: 40, weight: 800 }), /^800 40px "Inter", "Inter Ext", /);
  const c = createCanvas(400, 80);
  const g = c.getContext('2d');
  g.font = '400 40px "Inter", "Inter Ext", sans-serif';
  const withAlias = g.measureText('ăâîșț ĂÂÎȘȚ').width;
  g.font = '400 40px "Inter Ext"';
  const own = g.measureText('șțȘȚă').width;
  g.font = '400 40px "Inter", "Inter Ext", sans-serif';
  const mixed = g.measureText('șțȘȚă').width;
  assert.ok(Math.abs(own - mixed) < 0.01, 'ș, ț, ă come from Inter Ext');
  assert.ok(withAlias > 0);
  g.font = '400 40px "Inter", sans-serif';
  const latin = g.measureText('Hello world').width;
  g.font = '400 40px "Inter", "Inter Ext", sans-serif';
  assert.equal(g.measureText('Hello world').width, latin);
});

test('typed markers: the old shape normalizes to itself; types, holds and word anchors are checked; edit ops', async () => {
  const base = { width: 320, height: 180, fps: 30, duration: 4, tracks: [] };
  assert.deepEqual(normalizeComposition({ ...base, markers: [{ t: 1, label: 'old' }] }).composition.markers, [{ t: 1, label: 'old' }]);
  const typed = normalizeComposition({ ...base, markers: [{ t: 2, type: 'hold', duration: 1.5, label: 'still' }, { t: 0.5, type: 'cut' }, { t: 1, type: 'word', anchor: { item: 'vo', word: 3 } }] }).composition.markers;
  assert.deepEqual(typed[0], { t: 2, label: 'still', type: 'hold', duration: 1.5 });
  const bad = normalizeComposition({ ...base, markers: [{ t: 1, type: 'scene' }, { t: 1, type: 'hold', duration: -1 }, { t: 1, anchor: { item: 'vo' } }] });
  assert.ok(bad.errors.some((e) => e.path === 'markers[0].type'));
  assert.ok(bad.errors.some((e) => e.path === 'markers[1].duration'));
  assert.ok(bad.errors.some((e) => e.path === 'markers[2].anchor.word'));

  const { studio, cleanup } = tempStudio();
  try {
    await seedAssets(studio);
    await studio.clips.createClip({ slug: 'marked', author: AUTHOR, composition: smallComposition({ markers: [{ t: 1, label: 'legacy' }] }) });
    let r = await studio.clips.editClip('marked', [{ op: 'add_marker', marker: { t: 0.5, type: 'cut', label: 'shot 2' } }, { op: 'add_marker', marker: { t: 1.5, type: 'hold', duration: 0.5 } }]);
    assert.deepEqual(r.clip.composition.markers.map((m) => m.type ?? 'note'), ['cut', 'note', 'hold']);
    r = await studio.clips.editClip('marked', [{ op: 'update_marker', index: 1, patch: { type: 'beat' } }, { op: 'remove_marker', index: 0 }]);
    assert.deepEqual(r.clip.composition.markers, [{ t: 1, label: 'legacy', type: 'beat' }, { t: 1.5, label: '', type: 'hold', duration: 0.5 }]);
    await assert.rejects(studio.clips.editClip('marked', [{ op: 'remove_marker', index: 9 }]), /no marker at index 9/);
  } finally { await cleanup(); }
});

test('inspection: frames, hashes and sheets of a clip in another format and of an unsaved draft', async () => {
  const { studio, cleanup } = tempStudio();
  try {
    await seedAssets(studio);
    await studio.clips.createClip({ slug: 'insp', author: AUTHOR, composition: { ...smallComposition(), width: undefined, height: undefined, format: 'horizontal' } });
    const v = await studio.clipFrame({ clip: 'insp', format: 'vertical', t: 1, maxSize: 400 });
    assert.ok(v.height > v.width, 'drawn vertical');
    const draft = { ...smallComposition(), background: '#ff0000' };
    const [saved] = await studio.frameHashes({ clip: 'insp', times: [1] });
    const [drafted] = await studio.frameHashes({ composition: draft, times: [1] });
    assert.notEqual(saved.hash, drafted.hash);
    const sq = await studio.clipSheet({ clip: 'insp', format: 'square', count: 4 });
    assert.equal(sq.frames.length, 4);
    await assert.rejects(studio.clipFrame({ clip: 'insp', format: 'diagonal' }), /Unknown format/);
    await assert.rejects(studio.clipFrame({}), /Give clip/);
  } finally { await cleanup(); }
});
