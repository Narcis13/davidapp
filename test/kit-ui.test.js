// The UI half of the motion-graphics kit: cursor, spotlight, camera, arrow, callout and the UI frame. They show a
// screen recording (or any picture): coordinates are in the picture's pixels, drawing is in the item's box.
// A test footage is made with FFmpeg's testsrc2, so nothing large lives in the repo; the contact sheets of the
// kit are written to docs/showcase/v4/studio/.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStudio, AUTHOR } from './helpers.js';
import { createRuntime } from '../src/core/runtime.js';
import { layerGeometry } from '../src/core/transform.js';
import { frameAt } from '../src/core/footage.js';
import { nodeHost, createCanvas, loadImage, registerFonts, ROOT } from '../src/render/host.js';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';
import { createFootageService } from '../src/render/footage.js';
import { connect, callTool } from '../scripts/mcp.mjs';

registerFonts();

const src = (name) => readFileSync(join(ROOT, 'assets', `${name}.js`), 'utf8');
const KIT = ['kit-cursor', 'kit-spotlight', 'kit-camera', 'kit-arrow', 'kit-callout', 'kit-ui-frame'];
const THEMES = ['theme-tide', 'theme-ember', 'theme-sketchbook'];
const SIDECAR = JSON.parse(readFileSync(join(ROOT, 'showcase', 'footage', 'library-search.mp4.json'), 'utf8'));
const RECORDING = join(ROOT, 'showcase', 'footage', 'library-search.mp4');
const SHEETS = join(ROOT, 'docs', 'showcase', 'v4', 'studio');

const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'kit-ui-'));
const TINY = join(scratch, 'tiny.mp4');
let t;

before(async () => {
  const r = await run(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x200:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', TINY]);
  assert.equal(r.code, 0, r.stderr);
  t = tempStudio();
  const { library } = t.studio;
  for (const name of ['easing', ...THEMES, ...KIT]) await library.createAsset({ slug: name, source: src(name), author: AUTHOR });
  await library.addFootage({ slug: 'tiny', path: TINY, description: 'testsrc2 at 25 fps, 320 by 200, made by FFmpeg for the UI frame tests.', author: AUTHOR });
  await library.addFootage({ slug: 'recording', path: RECORDING, description: 'The committed screen recording of the library search, for the kit sheets.', author: AUTHOR });
});
after(async () => {
  await t.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

const FULL = { width: 1, height: 1 };
const item = (id, asset, params = {}, extra = {}) => ({ id, asset, start: 0, duration: 6, transform: FULL, params, ...extra });
const comp = (items, extra = {}) => ({ width: 640, height: 360, fps: 30, duration: 6, background: '#808080', theme: 'theme-tide', tracks: [{ id: 'o', type: 'visual', items }], ...extra });
const plain = (v) => JSON.parse(JSON.stringify(v));
const hashes = async (c, times) => (await t.studio.frameHashes({ composition: c, times })).map((h) => h.hash);

/** RGBA of a frame of a composition. */
async function pixels(c, tm) {
  const r = await t.studio.clipFrame({ composition: c, t: tm });
  const img = await loadImage(r.png);
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height, png: r.png };
}

test('the six kit assets are created and validated: described, tagged kit, with a usage example in the source', () => {
  const { library } = t.studio;
  for (const name of KIT) {
    const a = library.getAsset(name);
    assert.equal(a.ref, `${name}@1`);
    assert.ok(a.declared.tags.includes('kit'), `${name} is tagged kit`);
    assert.ok(a.declared.description.length > 120, `${name} says when to use it`);
    assert.ok(a.source.includes('Usage.'), `${name} has a usage example in its header`);
    assert.match(a.source, /"(asset|motions|params)": /, `${name} shows a JSON item`);
  }
  assert.equal(library.getAsset('kit-camera').kind, 'motion');
});

test('the visuals draw under three themes with different pixels, and the same theme gives the same pixels', async () => {
  const cases = {
    'kit-cursor': { asset: 'kit-cursor', params: { to: { x: 700, y: 400 }, clickTimes: [1.3] }, times: [0.6, 1.35, 3] },
    'kit-spotlight': { asset: 'kit-spotlight', params: { shape: 'rounded' }, times: [0.3, 1.5, 5.8] },
    'kit-arrow': { asset: 'kit-arrow', params: { label: 'Open it' }, times: [0.5, 1.2, 3] },
    'kit-callout': { asset: 'kit-callout', params: { text: 'A short *callout*', point: { x: 500, y: 400 } }, times: [0.2, 1, 3] },
    'kit-ui-frame': { asset: 'kit-ui-frame', params: { content: 'tiny' }, times: [0.5, 3] },
  };
  for (const [name, c] of Object.entries(cases)) {
    const per = [];
    for (const theme of THEMES) per.push(await hashes(comp([item('x', c.asset, c.params)], { theme }), c.times));
    for (let i = 0; i < c.times.length; i++) {
      assert.equal(new Set(per.map((h) => h[i])).size, THEMES.length, `${name} at ${c.times[i]} s looks different under each theme`);
    }
    assert.deepEqual(await hashes(comp([item('x', c.asset, c.params)], { theme: THEMES[0] }), c.times), per[0], `${name} is deterministic`);
    // time changes the picture (it animates, or it holds: at least one of the times differs from the first)
    assert.ok(new Set(per[0]).size > 1, `${name} changes over time`);
  }
});

test('text is in the layout report with its size floor: callout, arrow label, tab title and URL', async () => {
  const c = comp([
    item('frame', 'kit-ui-frame', { title: 'Library', url: 'fablecut.studio/library' }),
    item('call', 'kit-callout', { text: 'Filter by *kind*', point: { x: 138, y: 539 } }),
    item('arrow', 'kit-arrow', { label: 'Open it' }),
  ]);
  const r = await t.studio.inspect.layoutReport({ composition: c, t: 3 });
  const by = (id) => r.texts.filter((x) => x.item === id);
  assert.deepEqual(by('frame').map((x) => x.text).sort(), ['Library', 'fablecut.studio/library']);
  assert.deepEqual(by('call').map((x) => x.text), ['Filter by kind']);
  assert.deepEqual(by('arrow').map((x) => x.text), ['Open it']);
  for (const x of r.texts) {
    assert.equal(x.floor, 2.6, `${x.item}: ${x.text} carries the floor`);
    assert.ok(x.screenPct >= 2.6 - 0.05, `${x.item}: ${x.text} is ${x.screenPct}% of the short side`);
  }
});

test('a callout stays inside the safe area and flips to the other side when its first choice would leave it', async () => {
  const at = async (point, side = 'auto') => {
    const r = await t.studio.inspect.layoutReport({ composition: comp([item('call', 'kit-callout', { text: 'Points at *this*', point, side, outDur: 0 })]), t: 3 });
    const x = r.texts[0].box;
    return { box: x, safe: r.zones.titleSafe };
  };
  const inside = (b, s) => b.x >= s.x - 1 && b.y >= s.y - 1 && b.x + b.width <= s.x + s.width + 1 && b.y + b.height <= s.y + s.height + 1;
  // the point in the box: contain-fit of 1440 x 900 into 640 x 360 (scale 0.4, 32 px of margin each side)
  const map = (p) => ({ x: 32 + p.x * 0.4, y: p.y * 0.4 });
  for (const point of [{ x: 20, y: 20 }, { x: 1420, y: 20 }, { x: 20, y: 880 }, { x: 1420, y: 880 }, { x: 720, y: 450 }]) {
    for (const side of ['auto', 'top', 'bottom', 'left', 'right']) {
      const { box, safe } = await at(point, side);
      assert.ok(inside(box, safe), `point ${JSON.stringify(point)} side ${side}: the text ${JSON.stringify(box)} is inside the safe area ${JSON.stringify(safe)}`);
    }
  }
  // asked for the top, with a point at the top edge: it goes under the point instead
  const top = await at({ x: 720, y: 30 }, 'top');
  assert.ok(top.box.y > map({ x: 720, y: 30 }).y, 'flipped to the bottom');
  // asked for the top, with room: it stays there
  const room = await at({ x: 720, y: 700 }, 'top');
  assert.ok(room.box.y + room.box.height < map({ x: 720, y: 700 }).y, 'stays on top');
});

// ---- the camera --------------------------------------------------------------------------------------------

const camera = () => {
  const rt = createRuntime(nodeHost);
  rt.load({ 'easing@1': { source: src('easing') }, 'kit-camera@1': { source: src('kit-camera'), deps: { easing: 'easing@1' } } });
  return rt;
};

/** Where the point q of an item's box lands in the frame, with the camera's delta applied the way the runtime applies a motion. */
function landed(transform, delta, W, H, q) {
  const tr = { x: 0.5, y: 0.5, width: 1, height: 1, anchorX: 0.5, anchorY: 0.5, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, space: 'frame', ...transform };
  const R = { width: W, height: H };
  const moved = { ...tr, x: tr.x + (delta.x ?? 0) / R.width, y: tr.y + (delta.y ?? 0) / R.height, scale: tr.scale * (delta.scale ?? 1) };
  const m = layerGeometry(moved, W, H).matrix;
  return { x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] };
}

test('camera: the region ends up centred in the item box and fills `fill` of it, wherever the anchor is', () => {
  const rt = camera();
  const W = 1280, H = 720;
  const region = { x: 300, y: 200, width: 400, height: 150 };
  for (const transform of [
    { width: 1, height: 1 },
    { x: 0.3, y: 0.6, width: 0.5, height: 0.5, anchorX: 0, anchorY: 0 },
    { x: 0.7, y: 0.4, width: 0.6, height: 0.7, anchorX: 1, anchorY: 1 },
    { x: 0.5, y: 0.5, width: 0.8, height: 0.8, anchorX: 0.25, anchorY: 0.9, scale: 1.3 },
    { width: 0.9, height: 0.6 },
  ]) {
    const t2 = { x: 0.5, y: 0.5, anchorX: 0.5, anchorY: 0.5, scale: 1, ...transform };
    const geo = layerGeometry({ ...t2 }, W, H);
    const bw = geo.width, bh = geo.height;
    for (const fill of [0.5, 0.8, 1]) {
      const delta = rt.callMotion('kit-camera@1', { region, fill, anchorX: t2.anchorX, anchorY: t2.anchorY, itemScale: t2.scale }, { phase: 'emphasis', t: 1.2, duration: 2.4, width: bw, height: bh });
      // the box of 1440 x 900 contain-fitted: k = min(bw / 1440, bh / 900)
      const k = Math.min(bw / 1440, bh / 900), ox = (bw - 1440 * k) / 2, oy = (bh - 900 * k) / 2;
      const corner = (cx, cy) => landed(t2, delta, W, H, { x: ox + cx * k, y: oy + cy * k });
      const tl = corner(region.x, region.y), br = corner(region.x + region.width, region.y + region.height);
      // where the middle of the item's box is at rest
      const mid = landed(t2, {}, W, H, { x: bw / 2, y: bh / 2 });
      const S = t2.scale;
      assert.ok(Math.abs((tl.x + br.x) / 2 - mid.x) <= 1 && Math.abs((tl.y + br.y) / 2 - mid.y) <= 1, `centred (${JSON.stringify(transform)}, fill ${fill}): ${(tl.x + br.x) / 2},${(tl.y + br.y) / 2} vs ${mid.x},${mid.y}`);
      // the longer side of the region against the box fills `fill` (the box on screen is bw * S by bh * S)
      const sw = br.x - tl.x, sh = br.y - tl.y;
      const want = fill * Math.min((bw * S) / (region.width * k), (bh * S) / (region.height * k)) * region.width * k;
      assert.ok(Math.abs(sw - want) <= 1, `width ${sw} vs ${want}`);
      assert.ok(Math.abs(sw / sh - region.width / region.height) <= 0.01, 'the region keeps its shape');
      assert.ok(Math.max(sw / (bw * S), sh / (bh * S)) <= fill + 1e-6 && Math.max(sw / (bw * S), sh / (bh * S)) >= fill - 1e-3, `fills ${fill} of the box`);
    }
  }
});

test('camera: rest at both ends, eased and monotone between, and in / out end at rest', () => {
  const rt = camera();
  const p = { region: { x: 300, y: 200, width: 400, height: 150 }, fill: 0.8 };
  const at = (phase, tm, duration = 2.4) => rt.callMotion('kit-camera@1', p, { phase, t: tm, duration, width: 640, height: 400 });
  assert.deepEqual(plain(at('emphasis', 0)), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(plain(at('emphasis', 2.4)), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(plain(at('in', 0.6, 0.6)), { x: 0, y: 0, scale: 1 }, 'in ends at rest');
  assert.deepEqual(plain(at('out', 0, 0.6)), { x: 0, y: 0, scale: 1 }, 'out starts at rest');
  assert.ok(at('in', 0, 0.6).scale > 1, 'in starts on the region');
  assert.ok(at('out', 0.6, 0.6).scale > 1, 'out ends on the region');
  let last = 1;
  for (let i = 0; i <= 24; i++) {
    const s = at('emphasis', (i / 24) * 0.8).scale;
    assert.ok(s >= last - 1e-9, 'zooming in never steps back');
    last = s;
  }
  const hold = at('emphasis', 1.2);
  assert.equal(hold.scale, at('emphasis', 1.0).scale, 'it holds between the zooms');
  // a region too small to see is not blown up past maxZoom; a region of no size leaves the item alone
  assert.equal(rt.callMotion('kit-camera@1', { region: { x: 5, y: 5, width: 2, height: 2 } }, { phase: 'emphasis', t: 1.2, duration: 2.4, width: 640, height: 400 }).scale, 8);
  assert.deepEqual(plain(rt.callMotion('kit-camera@1', { region: { x: 5, y: 5, width: 0, height: 10 } }, { phase: 'emphasis', t: 1.2, duration: 2.4, width: 640, height: 400 })), {});
});

test('camera: through the real renderer the region lands on the expected pixels (anchor and scale included)', async () => {
  // a 1440 x 900 picture with a red square at the region's top left and a blue one at its bottom right
  const pic = createCanvas(1440, 900);
  const g = pic.getContext('2d');
  g.fillStyle = '#303030';
  g.fillRect(0, 0, 1440, 900);
  const region = { x: 400, y: 300, width: 480, height: 300 };
  g.fillStyle = '#ff0000'; g.fillRect(region.x, region.y, 24, 24);
  g.fillStyle = '#0000ff'; g.fillRect(region.x + region.width - 24, region.y + region.height - 24, 24, 24);
  await t.studio.library.addFileAsset({ slug: 'kit-camera-test', type: 'image', data: pic.toBuffer('image/png'), ext: '.png', description: 'A grey picture with a red and a blue marker, for the camera test.', author: AUTHOR });
  const W = 1280, H = 720;
  const transform = { x: 0.35, y: 0.7, width: 0.6, height: 0.6, anchorX: 0, anchorY: 1, scale: 1.25 };
  const geo = layerGeometry({ x: 0.5, y: 0.5, anchorX: 0.5, anchorY: 0.5, scale: 1, ...transform }, W, H);
  const k = Math.min(geo.width / 1440, geo.height / 900), ox = (geo.width - 1440 * k) / 2, oy = (geo.height - 900 * k) / 2;
  const c = {
    width: W, height: H, fps: 30, duration: 4, background: '#000000',
    tracks: [{ id: 'v', type: 'visual', items: [{
      id: 'pic', asset: 'kit-camera-test', start: 0, duration: 4, transform, params: { fit: 'contain' },
      motions: [{ asset: 'kit-camera', phase: 'emphasis', at: 0.5, duration: 3, params: { region, fill: 0.8, anchorX: 0, anchorY: 1, itemScale: 1.25 } }],
    }] }],
  };
  const { data, width } = await pixels(c, 2);
  const delta = camera().callMotion('kit-camera@1', { region, fill: 0.8, anchorX: 0, anchorY: 1, itemScale: 1.25 }, { phase: 'emphasis', t: 1.5, duration: 3, width: geo.width, height: geo.height });
  const at = (cx, cy) => landed({ x: 0.5, y: 0.5, anchorX: 0.5, anchorY: 0.5, scale: 1, ...transform }, delta, W, H, { x: ox + cx * k, y: oy + cy * k });
  const tl = at(region.x, region.y), br = at(region.x + region.width, region.y + region.height);
  const px = (x, y) => { const i = (Math.round(y) * width + Math.round(x)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const s = (br.x - tl.x) / region.width;
  // just inside the corners of the region: the markers; just outside: the grey picture
  assert.deepEqual(px(tl.x + 6 * s, tl.y + 6 * s), [255, 0, 0], 'the red marker is at the top left of the region');
  assert.deepEqual(px(br.x - 6 * s, br.y - 6 * s), [0, 0, 255], 'the blue marker is at the bottom right');
  assert.deepEqual(px(tl.x - 4, tl.y - 4), [48, 48, 48], 'outside the region is the picture');
  // and the markers' edges are within a pixel of where the maths says
  const redRow = []; for (let x = Math.floor(tl.x) - 4; x < tl.x + 30 * s; x++) redRow.push([x, px(x, tl.y + 6 * s)]);
  const firstRed = redRow.find(([, v]) => v[0] > 200 && v[2] < 60)[0];
  assert.ok(Math.abs(firstRed - tl.x) <= 1.5, `the region's left edge is at ${firstRed}, expected ${tl.x.toFixed(1)}`);
  // the region is centred where the item's box centre was
  const mid = landed({ x: 0.5, y: 0.5, anchorX: 0.5, anchorY: 0.5, scale: 1, ...transform }, {}, W, H, { x: geo.width / 2, y: geo.height / 2 });
  assert.ok(Math.abs((tl.x + br.x) / 2 - mid.x) <= 1 && Math.abs((tl.y + br.y) / 2 - mid.y) <= 1);
});

// ---- the cursor --------------------------------------------------------------------------------------------

/** The centre of the white ring a cursor with an invisible pointer draws (only the click ripple shows). */
async function ringCentre(params, tm, W = 1280, H = 720) {
  const c = { width: W, height: H, fps: 60, duration: 20, background: '#000000', theme: 'theme-tide', tracks: [{ id: 'o', type: 'visual', items: [{ id: 'cur', asset: 'kit-cursor', start: 0.5, duration: 19, transform: FULL, params: { color: 'transparent', outline: 'transparent', ring: '#ffffff', shadow: 0, size: 6, fadeIn: 0, fadeOut: 0, ...params } }] }] };
  const { data, width, height } = await pixels(c, tm);
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = data[(y * width + x) * 4]; if (v > 8) { sum += v; sx += v * (x + 0.5); sy += v * (y + 0.5); } }
  return sum ? { x: sx / sum, y: sy / sum, ink: sum } : null;
}

test('cursor: following a sidecar path, the pointer is on the click point (mapped into the box) at every click time', async () => {
  // 1280 x 720 box, 1440 x 900 picture contain-fitted: scale 0.8, 64 px of margin left and right
  const map = (x, y) => ({ x: 64 + x * 0.8, y: y * 0.8 });
  for (const click of SIDECAR.clicks) {
    // item time 1.0 is frame 90 of the clip (item start 0.5, 60 fps): `at` makes that the click's time exactly
    const found = await ringCentre({ path: SIDECAR.cursor, clicks: SIDECAR.clicks, at: click.t - 1.0 }, 1.5);
    assert.ok(found, `a ring is drawn at the click ${click.t}`);
    const want = map(click.x, click.y);
    assert.ok(Math.abs(found.x - want.x) <= 1 && Math.abs(found.y - want.y) <= 1, `click at ${click.t}: ring centre ${found.x.toFixed(2)},${found.y.toFixed(2)}; click point mapped ${want.x.toFixed(2)},${want.y.toFixed(2)}`);
  }
  // the same through the simple move: it rests on `to`
  const rest = await ringCentre({ to: { x: 612, y: 132 }, clickTimes: [3.0], arrive: 0.5, delay: 0 }, 3.5);
  const want = map(612, 132);
  assert.ok(rest && Math.abs(rest.x - want.x) <= 1 && Math.abs(rest.y - want.y) <= 1, `a simple move rests on its target: ${JSON.stringify(rest)} vs ${JSON.stringify(want)}`);
});

test('cursor: between samples the motion is smooth: it stays between the samples and never steps back', async () => {
  // a rest, a quick move and a rest, as a recording makes them: a path that is easy to overshoot
  const path = [{ t: 0, x: 100, y: 100 }, { t: 1, x: 100, y: 100 }, { t: 1.1, x: 220, y: 160 }, { t: 1.25, x: 500, y: 300 }, { t: 1.4, x: 560, y: 320 }, { t: 3, x: 560, y: 320 }];
  const xs = [];
  for (let i = 0; i <= 20; i++) {
    // click times at the sampled moments would show rings, so the pointer itself is drawn: the centroid of a white arrow
    const tm = 0.5 + 0.9 + (i / 20) * 0.6; // clip time; item time = tm - 0.5 = 0.9 .. 1.5
    const c = { width: 640, height: 400, fps: 60, duration: 20, background: '#000000', theme: 'theme-tide', tracks: [{ id: 'o', type: 'visual', items: [{ id: 'cur', asset: 'kit-cursor', start: 0.5, duration: 19, transform: FULL, params: { path, space: { width: 640, height: 400 }, color: '#ffffff', outline: 'transparent', shadow: 0, size: 5, fadeIn: 0, fadeOut: 0 } }] }] };
    const { data, width, height } = await pixels(c, Math.round(tm * 60) / 60);
    // the pointer's tip: the top-left-most white pixel
    let tip = null;
    for (let y = 0; y < height && !tip; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] > 200) { tip = { x, y }; break; }
    xs.push(tip);
  }
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i].x >= xs[i - 1].x - 1 && xs[i].y >= xs[i - 1].y - 1, `the pointer never steps back (${JSON.stringify(xs[i - 1])} then ${JSON.stringify(xs[i])})`);
  }
  assert.ok(xs[0].x >= 99 && xs[xs.length - 1].x <= 562, 'and never overshoots the samples');
});

test('cursor: a recording\'s sidecar is accepted as it is (a click without a selector, a drag, extra fields)', async () => {
  const side = JSON.parse(readFileSync(join(ROOT, 'showcase', 'footage', 'playground-param.mp4.json'), 'utf8'));
  assert.ok(side.clicks.some((c) => c.selector === null && c.drag), 'the sidecar has clicks with a null selector');
  const hs = await hashes(comp([item('cur', 'kit-cursor', { path: side.cursor, clicks: side.clicks, at: 1.4 })], { duration: 20 }), [0.2, 1.0, 2.0]);
  assert.equal(new Set(hs).size, 3);
  // the boxes of a sidecar work as regions
  const spot = await hashes(comp([item('sp', 'kit-spotlight', { regions: SIDECAR.boxes.slice(0, 3) })]), [1, 2]);
  assert.equal(spot.length, 2);
});

// ---- the UI frame ------------------------------------------------------------------------------------------

test('ui frame: footage in the viewport changes with time, and at scale 1 it is a one-to-one copy of the decoded frame', async () => {
  const W = 1280, H = 720;
  const c = comp([item('f', 'kit-ui-frame', { content: 'tiny', scale: 1, shadow: 0, url: 'fablecut.app', title: 'Home' })], { width: W, height: H, background: '#000000' });
  const [a, b] = await hashes(c, [0.1, 1.5]);
  assert.notEqual(a, b, 'two times give different pixels');
  // the viewport: chrome is 2 rows of round(2.1 * 2.6% of 720) px, the window 320 x 200 plus chrome, centred
  const S = 0.026 * 720, bar = Math.round(S * 2.1);
  const vw = 320, vh = 200;
  const vx = Math.round((W - vw) / 2), vy = Math.round((H - (vh + bar * 2)) / 2) + bar * 2;
  const library = t.studio.library;
  const v = library.requireVersion('tiny@1');
  const meta = { ...library.footageMeta(v), path: library.absFile(v) };
  const svc = createFootageService();
  try {
    for (const tm of [0.1, 0.7, 1.5]) {
      const index = frameAt(meta.table, Math.min(tm, meta.duration - 1e-6));
      const want = await svc.frame(meta, index);
      const { data, width } = await pixels(c, tm);
      let wrong = 0;
      // the last rows have the window's rounded corners; everything above them must be exact
      for (let y = 0; y < vh - 16; y++) for (let x = 0; x < vw; x++) {
        const i = ((vy + y) * width + vx + x) * 4, j = (y * vw + x) * 4;
        if (data[i] !== want[j] || data[i + 1] !== want[j + 1] || data[i + 2] !== want[j + 2]) wrong++;
      }
      assert.equal(wrong, 0, `at ${tm} s (source frame ${index}) the viewport is the decoded frame, pixel for pixel`);
    }
  } finally { svc.close(); }
});

test('ui frame: phone and tablet show the capture inside a rounded screen, in either orientation', async () => {
  const hs = [];
  for (const params of [{ device: 'phone' }, { device: 'phone', orientation: 'landscape', notch: 'notch' }, { device: 'phone', notch: 'none' }, { device: 'tablet' }, { device: 'tablet', orientation: 'portrait' }]) {
    hs.push((await hashes(comp([item('d', 'kit-ui-frame', { content: 'tiny', ...params })]), [1]))[0]);
  }
  assert.equal(new Set(hs).size, hs.length, 'every device and orientation draws its own picture');
  // the corners of the box stay clear of the device (a transparent layer around it): the frame's background shows
  const { data, width } = await pixels(comp([item('d', 'kit-ui-frame', { content: 'tiny', device: 'phone' })], { background: '#ff00ff' }), 1);
  assert.deepEqual([...data.slice(0, 3)], [255, 0, 255]);
  assert.deepEqual([...data.slice((width * 4 * 5) + 10 * 4, (width * 4 * 5) + 10 * 4 + 3)], [255, 0, 255]);
});

test('bad input gives a useful error and crashes nothing', async () => {
  // text that cannot be drawn at its floor fails loudly with the item and the time (no ellipsis, no tiny text)
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('call', 'kit-callout', { text: 'Supercalifragilisticexpialidocious '.repeat(8), maxWidth: 8 })]), t: 1 }), /size floor/);
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('f', 'kit-ui-frame', { url: 'https://an.address.that.is.far.too.long.for.the.bar/at/this/size/and/more/and/more/and/more/and/more/and/more/and/more' })]), t: 1 }), /size floor/);
  // numbers out of range and unknown parameters are refused by name
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('cam', 'kit-callout', { size: 1 })]), t: 1 }), /size: .*minimum/);
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('c', 'kit-cursor', { path: [{ t: 0, x: 'left', y: 0 }] })]), t: 1 }), /path\[0\]\.x/);
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('c', 'kit-cursor', { colour: '#fff' })]), t: 1 }), /colour: unknown parameter/);
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('pic', 'kit-ui-frame', { content: 'no-such-picture' })]), t: 1 }), /no-such-picture/);
  // odd but valid data never throws: unsorted and duplicate path times, an empty region, a point far outside the picture, a long drag
  const odd = comp([
    item('c', 'kit-cursor', { path: [{ t: 2, x: 5, y: 5 }, { t: 1, x: 100, y: 100 }, { t: 1, x: 200, y: 200 }, { t: 3, x: 5000, y: -4000 }], clickTimes: [1, 1, 1.01] }),
    item('s', 'kit-spotlight', { region: { x: 10, y: 10, width: 0, height: 0 }, shape: 'circle' }),
    item('a', 'kit-arrow', { from: { x: 300, y: 300 }, to: { x: 300, y: 300 } }),
    item('b', 'kit-callout', { text: 'Far away', point: { x: -9000, y: 9000 } }),
  ]);
  for (const tm of [0, 1, 1.5, 5.9]) assert.equal((await hashes(odd, [tm])).length, 1);
  // a camera item with an empty region and a path of one point
  const cam = comp([item('p', 'kit-ui-frame', {}, { motions: [{ asset: 'kit-camera', phase: 'emphasis', at: 0.5, duration: 2, params: { region: { x: 0, y: 0, width: 0, height: 0 } } }] })]);
  assert.equal((await hashes(cam, [1])).length, 1);
  await assert.rejects(t.studio.clipFrame({ composition: comp([item('p', 'kit-ui-frame', {}, { motions: [{ asset: 'kit-camera', phase: 'emphasis', at: 0.5, duration: 2, params: { fill: 9 } }] })]), t: 1 }), /fill/);
});

test('MCP over stdio: the kit assets are created, drawn over a clip and their text is in the layout report', async () => {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-kit-mcp-'));
  const client = await connect({ dataDir, author: 'kit-test-model' });
  const call = (name, args) => callTool(client, name, args);
  try {
    for (const name of ['easing', 'theme-tide', ...KIT]) {
      const r = await call('create_asset', { name, source: src(name) });
      assert.ok(!r.isError, `${name}: ${r.text}`);
      assert.equal(r.json.created, `${name}@1`);
    }
    const found = await call('search_assets', { query: 'zoom pan region camera' });
    assert.equal(found.json.assets[0].ref, 'kit-camera@1');
    const clip = await call('create_clip', { name: 'kit-demo', title: 'Kit demo', format: 'horizontal', fps: 10, duration: 4 });
    assert.ok(!clip.isError, clip.text);
    const comp2 = { format: 'horizontal', fps: 10, duration: 4, theme: 'theme-tide', background: '#202428', tracks: [{ id: 'o', type: 'visual', items: [item('call', 'kit-callout', { text: 'Click here', point: { x: 700, y: 400 } }, { duration: 4 }), item('cur', 'kit-cursor', { to: { x: 700, y: 400 }, clickTimes: [1.2] }, { duration: 4 })] }] };
    const up = await call('update_clip', { clip: 'kit-demo', composition: comp2 });
    assert.ok(!up.isError, up.text);
    const frame = await call('render_clip_frame', { clip: 'kit-demo', t: 2 });
    assert.ok(!frame.isError, frame.text);
    assert.equal(frame.images.length, 1);
    const lay = await call('layout_report', { clip: 'kit-demo', t: 2 });
    assert.ok(!lay.isError, lay.text);
    assert.deepEqual(lay.json.texts.map((x) => [x.item, x.text, x.floor]), [['call', 'Click here', 2.6]]);
    const bad = await call('create_asset', { name: 'kit-broken', source: src('kit-callout').replace("'*Asterisks* mark", "'") .replace('render(f, p) {', 'render(f, p) { Math.random();') });
    assert.ok(bad.isError, 'an asset with Math.random is refused');
  } finally {
    await client.close();
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
  }
});

// ---- the contact sheets ------------------------------------------------------------------------------------

/** Cells (a PNG each, a label) laid out in a grid on a dark sheet, with the label under each cell. */
async function sheet(cells, cols, cellW, cellH, file) {
  const gap = 16, label = 30, rows = Math.ceil(cells.length / cols);
  const cv = createCanvas(cols * cellW + (cols + 1) * gap, rows * (cellH + label) + (rows + 1) * gap);
  const g = cv.getContext('2d');
  g.fillStyle = '#05080e';
  g.fillRect(0, 0, cv.width, cv.height);
  for (const [i, c] of cells.entries()) {
    const x = gap + (i % cols) * (cellW + gap), y = gap + Math.floor(i / cols) * (cellH + label + gap);
    const img = await loadImage(c.png);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x, y, cellW, cellH);
    g.fillStyle = '#aab6c8';
    g.font = '600 15px Inter';
    g.fillText(c.label, x + 2, y + cellH + 21);
  }
  mkdirSync(SHEETS, { recursive: true });
  writeFileSync(join(SHEETS, file), cv.toBuffer('image/png'));
  return cv;
}

test('contact sheet: one frame of each kit asset under theme-tide, on a 1920 x 1080 frame', async () => {
  const W = 1920, H = 1080;
  const big = (items, extra = {}) => ({ width: W, height: H, fps: 30, duration: 12, background: '#05080e', theme: 'theme-tide', tracks: [{ id: 'o', type: 'visual', items }], ...extra });
  const rec = item('rec', 'recording', { fit: 'contain' }, { duration: 12 });
  const cam = { asset: 'kit-camera', phase: 'emphasis', at: 0.2, duration: 3, params: { region: SIDECAR.clicks[2].box, fill: 0.7 } };
  const frames = [
    { label: 'kit-cursor: follows a recording path and clicks', c: big([rec, item('cur', 'kit-cursor', { path: SIDECAR.cursor, clicks: SIDECAR.clicks, size: 4.2 }, { duration: 12 })]), t: 1.55 },
    { label: 'kit-spotlight: dims all but a region', c: big([rec, item('sp', 'kit-spotlight', { region: SIDECAR.boxes[2], padding: 10 }, { duration: 6 })]), t: 3 },
    { label: 'kit-camera: zoom to a region, centred, filling 70 %', c: big([{ ...rec, params: { fit: 'contain', in: 7 }, motions: [cam] }]), t: 1 },
    { label: 'kit-arrow: draws on, a label at its tail', c: big([rec, item('ar', 'kit-arrow', { from: { x: 360, y: 760 }, to: { x: 720, y: 440 }, label: 'Open the *card*' }, { duration: 6 })]), t: 2 },
    { label: 'kit-callout: a bubble that points (tail and leader)', c: big([rec, item('c1', 'kit-callout', { text: 'Filter by *kind*', point: { x: 138, y: 539 }, side: 'right' }), item('c2', 'kit-callout', { text: 'Search the library', point: { x: 612, y: 132 }, style: 'leader' })]), t: 2 },
    { label: 'kit-ui-frame: a browser around the recording', c: big([item('fr', 'kit-ui-frame', { content: 'recording', url: 'fablecut.studio/library', title: 'Library' }, { duration: 12 })]), t: 3.2 },
  ];
  const cells = [];
  for (const f of frames) cells.push({ label: f.label, png: (await t.studio.clipFrame({ composition: f.c, t: f.t })).png });
  const cv = await sheet(cells, 2, 940, 529, 'kit-ui.png');
  assert.ok(cv.width > 1800 && cv.height > 1600);
});

test('contact sheet: cursor, spotlight and camera over the committed recording, at a few times', async () => {
  const side = SIDECAR;
  const box = side.clicks[2].box; // the card that was opened
  const camMove = { asset: 'kit-camera', phase: 'emphasis', at: 7, duration: 3.4, params: { region: box, fill: 0.7 } };
  const full = { width: 1, height: 1 };
  const c = {
    width: 1440, height: 900, fps: 30, duration: 13.5, background: '#000000', theme: 'theme-tide',
    tracks: [
      { id: 'v', type: 'visual', items: [{ id: 'rec', asset: 'recording', start: 0, duration: 13.5, transform: full, params: { fit: 'contain' }, motions: [camMove] }] },
      { id: 's', type: 'visual', items: [
        { id: 'spot', asset: 'kit-spotlight', start: 3.2, duration: 2.6, transform: full, params: { region: side.boxes[2], padding: 8 } },
        { id: 'spot2', asset: 'kit-spotlight', start: 7, duration: 3.4, transform: full, params: { region: box, padding: 10 }, motions: [{ ...camMove, at: 0 }] },
      ] },
      { id: 'o', type: 'visual', items: [{ id: 'cur', asset: 'kit-cursor', start: 0, duration: 13.5, transform: full, params: { path: side.cursor, clicks: side.clicks }, motions: [camMove] }] },
    ],
  };
  /** @type {[number, string][]} */
  const times = [[0.5, 'arriving'], [1.52, 'click on the search'], [3.9, 'spotlight on the filter'], [4.05, 'click'], [7.7, 'camera zooming to the card'], [8.2, 'click on the card, camera holding']];
  const cells = [];
  for (const [tm, label] of times) cells.push({ label: `${tm.toFixed(2)} s: ${label}`, png: (await t.studio.clipFrame({ composition: c, t: tm })).png });
  const cv = await sheet(cells, 3, 720, 450, 'kit-ui-over-footage.png');
  assert.ok(cv.width > 2000);
});
