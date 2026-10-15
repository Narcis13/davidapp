// SVG logos keep their colours: an internal style sheet is inlined (simple selectors, the cascade, !important),
// linear and radial gradients are kept in the vector model and drawn by f.svg, what could not be kept is
// reported, a model made before this change draws the same pixels, and a hostile style sheet is neutralised.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../src/render/host.js';
import { sanitizeSvg, vectorModel } from '../src/studio/svg.js';
import { draw } from '../src/core/lib/svg.js';
import { createStudioServer } from '../src/server/http.js';
import { connect, callTool } from '../scripts/mcp.mjs';
import { tempStudio, AUTHOR } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/logos/${name}`, import.meta.url), 'utf8');
const WRAP = (body, size = 100) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

/** Sanitise the way an upload does and build the model. */
function made(svg) {
  const clean = sanitizeSvg(svg, { styles: true });
  return { clean, model: vectorModel(clean.tree, { gradients: true, report: clean.report }) };
}
/** The model drawn at `width` x `height` on a background → a pixel getter. */
function pixels(model, width = 100, height = width, background = '#ffffff', opts = {}) {
  const c = createCanvas(width, height), g = c.getContext('2d');
  g.fillStyle = background; g.fillRect(0, 0, width, height);
  draw(g, model, { width, height, ...opts });
  return (x, y) => [...g.getImageData(x, y, 1, 1).data];
}
const near = (got, want, tol, what) => assert.ok(want.every((v, i) => Math.abs(got[i] - v) <= tol), `${what}: got ${got.slice(0, 3)}, wanted ${want} (±${tol})`);

let t, studio, tmp;
before(() => {
  t = tempStudio();
  studio = t.studio;
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'svg-logos-'));
});
after(async () => {
  await t.cleanup();
  rmSync(tmp, { recursive: true, force: true });
});

// ── style sheets ──────────────────────────────────────────────────────────────────────────────

test('style sheets: type, class, id and compound selectors, lists and *, by specificity and then order', () => {
  const { clean, model } = made(WRAP(`<style>
    rect { fill: #0000ff }
    .a { fill: #00ff00 }
    rect.a { fill: #ff0000 }
    #x { fill: #ffff00 }
    .b, .c { stroke: #123456 }
    * { stroke-width: 3 }
    .o1 { fill: #010101 } .o2 { fill: #020202 }
  </style>
  <rect id="r1" class="a" width="10" height="10"/>
  <rect id="r2" width="10" height="10"/>
  <rect id="x" class="a" width="10" height="10"/>
  <circle id="r4" fill="#ffffff" r="5"/>
  <rect id="r5" class="b" width="10" height="10"/>
  <circle id="r6" class="c" r="5"/>
  <circle id="r7" class="o2 o1" r="5"/>`));
  assert.doesNotMatch(clean.svg, /<style/, 'the style element is gone');
  const fills = model.paths.map((p) => p.fill);
  assert.deepEqual(fills, ['#ff0000', '#0000ff', '#ffff00', '#ffffff', '#0000ff', '#000000', '#020202']);
  assert.equal(model.paths[3].fill, '#ffffff', 'no rule matches the circle: its own attribute stays');
  assert.deepEqual(model.paths.map((p) => p.stroke), ['none', 'none', 'none', 'none', '#123456', '#123456', 'none']);
  assert.ok(model.paths.every((p) => p.strokeWidth === 3), '* reaches every element');
  assert.match(clean.svg, /<rect id="r1" class="a" width="10" height="10" fill="#ff0000" stroke-width="3"\/>/, 'applied as a presentation attribute');
});

test('style sheets: the style attribute beats rules, rules beat presentation attributes, !important beats specificity', () => {
  const { model } = made(WRAP(`<style>
    .a { fill: #00ff00 }
    .imp { fill: #0a0a0a !important }
    #y { fill: #0b0b0b }
    .k { stroke: #111111 !important }
  </style>
  <rect class="a" fill="#999999" width="10" height="10"/>
  <rect class="a" style="fill: #abcdef" width="10" height="10"/>
  <rect id="y" class="imp" width="10" height="10"/>
  <rect class="imp" style="fill: #fedcba" width="10" height="10"/>
  <rect class="imp" style="fill: #fedcba !important" width="10" height="10"/>
  <rect class="k" style="stroke: #222222" width="10" height="10"/>`));
  assert.deepEqual(model.paths.map((p) => p.fill), ['#00ff00', '#abcdef', '#0a0a0a', '#0a0a0a', '#fedcba', '#000000']);
  assert.equal(model.paths[5].stroke, '#111111', 'an important rule beats a plain style attribute');
});

test('style sheets: what cannot be applied is dropped and reported with the reason', () => {
  const { clean, model } = made(fixture('unsupported.svg'));
  const report = clean.report;
  const has = (what, why) => report.dropped.some((d) => d.what.includes(what) && (!why || d.why.includes(why)));
  assert.ok(has('@media rule', 'at-rules'), JSON.stringify(report.dropped));
  assert.ok(has('selector "g .a"', 'combinators'));
  assert.ok(has('.a:hover', 'pseudo-classes'));
  assert.ok(has('property "mix-blend-mode" in rect.a, circle.b'));
  assert.ok(has('property "foo"'));
  assert.ok(has('spreadMethod="reflect" on #refl', 'pad'));
  assert.ok(has('<pattern> #p'));
  assert.ok(has('<filter> #blur'));
  assert.ok(report.dropped.every((d) => d.what && d.why), 'every entry says what and why');
  assert.ok(report.kept.some((k) => /style sheet: 4 of 4 rules/.test(k)) && report.kept.some((k) => /linear gradient #refl/.test(k)), report.kept.join(' | '));
  // the rules that were fine were applied; the simple selector of a partly dropped list too
  assert.deepEqual(model.paths.slice(0, 2).map((p) => p.fill), ['#2a6f97', '#2a6f97']);
  assert.equal(model.paths[2].fill, 'none', 'a pattern fill is not drawn');
  assert.deepEqual(model.paths[4].dash, [8, 4], 'a dash pattern is drawn');
});

// ── gradients in the model ────────────────────────────────────────────────────────────────────

test('gradients in the model: stops, units, transform, geometry and href inheritance', () => {
  const { model, clean } = made(fixture('gradient-href.svg'));
  assert.equal(model.v, 2);
  const { sky, wide, glow } = model.gradients;
  assert.deepEqual(sky.stops, [[0, '#ff0000'], [0.5, 'rgba(0, 255, 0, 0.8)'], [1, '#0000ff']], 'stops (and stop-opacity) come through xlink:href');
  assert.deepEqual([sky.type, sky.units, sky.x1, sky.y1, sky.x2, sky.y2], ['linear', 'box', 0, 0, 0, 1]);
  const rot = (30 * Math.PI) / 180;
  assert.deepEqual(sky.m, [Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), 0.5 - 0.5 * Math.cos(rot) + 0.5 * Math.sin(rot), 0.5 - 0.5 * Math.sin(rot) - 0.5 * Math.cos(rot)].map((v) => Math.round(v * 1e6) / 1e6), 'gradientTransform');
  assert.deepEqual([wide.units, wide.x1, wide.x2, wide.stops.length], ['user', 100, 190, 3], 'href (plain) and userSpaceOnUse');
  assert.deepEqual([glow.type, glow.cx, glow.r, glow.fx, glow.fy, glow.m], ['radial', 0.5, 0.5, 0.35, 0.35, [0.8, 0, 0, 1, 0.1, 0]]);
  assert.deepEqual(model.paths.map((p) => p.fill), ['url(#sky)', 'url(#wide)', 'url(#glow)']);
  assert.deepEqual(model.paths[0].bb, [10, 10, 90, 110], 'a path with a gradient carries its bounding box');
  assert.deepEqual(model.paths[2].bb, [100, 60, 190, 110]);
  assert.doesNotMatch(clean.svg, /href=/, 'the stored image gets plain gradients (its rasteriser does not follow href)');
});

test('gradients in the model: percentages, stop colours from classes, a single stop, no stops, and a loop of hrefs', () => {
  const { model } = made(WRAP(`<style>.s0 { stop-color: #123456 } .s1 { stop-color: #abcdef; stop-opacity: 0.5 }</style>
    <defs>
      <linearGradient id="p" gradientUnits="userSpaceOnUse" x2="100%"><stop class="s0" offset="0"/><stop class="s1" offset="100%"/></linearGradient>
      <linearGradient id="one"><stop offset="0.3" stop-color="#ff00ff"/></linearGradient>
      <linearGradient id="none"/>
      <linearGradient id="loop1" href="#loop2"/><linearGradient id="loop2" href="#loop1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    </defs>
    <rect width="10" height="10" fill="url(#p)"/><rect width="10" height="10" fill="url(#one)"/><rect width="10" height="10" fill="url(#none) #00ff00"/>
    <rect width="10" height="10" fill="url(#nothing)"/><rect width="10" height="10" fill="url(#loop1)"/>`, 200));
  assert.deepEqual(model.gradients.p.stops, [[0, '#123456'], [1, 'rgba(171, 205, 239, 0.5)']]);
  assert.equal(model.gradients.p.x2, 200, '100% of the viewport in user units');
  assert.equal(model.paths[1].fill, '#ff00ff', 'one stop is a flat colour');
  assert.equal(model.paths[2].fill, 'none', 'no stops paint nothing (the fallback colour is for a reference that does not resolve)');
  assert.equal(model.paths[3].fill, 'none', 'a missing reference paints nothing');
  assert.equal(model.paths[4].fill, 'url(#loop1)');
  assert.equal(model.gradients.loop1.stops.length, 2);
});

// ── gradients drawn ───────────────────────────────────────────────────────────────────────────

test('f.svg draws linear gradients: user space, box units, a transform, strokes', () => {
  const user = made(WRAP('<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="100"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>')).model;
  const u = pixels(user);
  near(u(1, 50), [253, 0, 2], 6, 'start');
  near(u(50, 50), [127, 0, 127], 6, 'middle');
  near(u(98, 50), [5, 0, 250], 6, 'end');
  // box units are relative to the shape, not the picture
  const box = made(WRAP('<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="0.5" stop-color="#00ff00"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect x="20" y="40" width="60" height="20" fill="url(#g)"/>')).model;
  const b = pixels(box);
  near(b(21, 50), [250, 5, 0], 12, 'box start');
  near(b(50, 50), [0, 255, 0], 12, 'box middle');
  near(b(78, 50), [5, 0, 250], 16, 'box end');
  assert.deepEqual(b(10, 50).slice(0, 3), [255, 255, 255], 'outside the shape the background');
  // a gradientTransform turns it a quarter: red at the top, blue at the bottom
  const turned = made(WRAP('<defs><linearGradient id="g" gradientTransform="rotate(90 0.5 0.5)"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>')).model;
  const r = pixels(turned);
  near(r(50, 2), [250, 0, 5], 8, 'top');
  near(r(50, 97), [5, 0, 250], 8, 'bottom');
  near(r(5, 50), [127, 0, 127], 8, 'the left edge is the middle now');
  // a stroke with a gradient (user space, the shape has no area to lay a box on)
  const line = made(WRAP('<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" x2="90"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><line x1="10" y1="50" x2="90" y2="50" stroke="url(#g)" stroke-width="10"/>')).model;
  const l = pixels(line);
  near(l(14, 50), [241, 0, 14], 10, 'stroke start');
  near(l(86, 50), [11, 0, 244], 10, 'stroke end');
});

test('f.svg draws radial gradients: an ellipse in box units, a focal point, stop-opacity', () => {
  const ell = made(WRAP('<defs><radialGradient id="g"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></radialGradient></defs><rect x="10" y="30" width="80" height="40" fill="url(#g)"/>')).model;
  const e = pixels(ell);
  near(e(50, 50), [255, 255, 255], 8, 'centre');
  near(e(50, 31), [13, 13, 13], 16, 'near the top edge: the gradient is as tall as the shape');
  near(e(88, 50), [13, 13, 13], 16, 'near the right edge: and as wide');
  const half = e(70, 50)[0];
  assert.ok(half > 100 && half < 160, `half way out along the long axis (${half})`);
  const focal = made(WRAP('<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.5" fx="0.25" fy="0.5"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/>')).model;
  const f = pixels(focal);
  near(f(25, 50), [255, 255, 255], 12, 'the focal point is the first stop');
  assert.ok(f(40, 50)[0] > f(70, 50)[0], 'darker away from the focal point');
  const fade = made(WRAP('<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x2="100"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="1"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>')).model;
  const a = pixels(fade);
  near(a(2, 50), [250, 250, 250], 8, 'transparent at the start shows the background');
  near(a(97, 50), [8, 8, 8], 8, 'opaque at the end');
});

test('f.svg draws an Illustrator-style export in its own colours', () => {
  const { model, clean } = made(fixture('illustrator.svg'));
  assert.match(clean.svg, /class="st0" fill="url\(#SVGID_1_\)"/, 'the class became the fill');
  assert.deepEqual([model.paths[0].miter, model.paths[2].miter], [4, 10], 'the SVG default miter limit, and one from a class');
  const p = pixels(model, 240, 160);
  near(p(25, 25), [123, 92, 255], 20, 'first stop of the square');
  near(p(75, 86), [255, 92, 138], 14, 'the middle stop');
  near(p(115, 135), [255, 209, 102], 24, 'last stop');
  near(p(180, 80), [255, 255, 255], 10, 'radial centre');
  near(p(180, 120), [85, 140, 172], 18, 'towards the radial edge');
  near(p(172, 14), [255, 92, 138], 26, 'a gradient stroke starts pink');
  near(p(228, 14), [123, 92, 255], 26, 'and ends violet');
  near(p(145, 30), [6, 214, 160].map((v) => Math.round(v * 0.6 + 255 * 0.4)), 10, 'opacity from a class');
  near(p(70, 48), [255, 255, 255], 2, 'white from a class');
});

test('f.svg: recolouring, drawing on and the colour map work with gradients', () => {
  const { model } = made(fixture('illustrator.svg'));
  near(pixels(model, 240, 160, '#000000', { fill: '#00ff00' })(75, 86), [0, 255, 0], 2, 'fill replaces a gradient');
  const swapped = pixels(model, 240, 160, '#000000', { colors: { '#7b5cff': '#00ffff' } })(25, 25);
  assert.ok(swapped[2] > 200 && swapped[0] < 60, `a stop recoloured through colors (${swapped})`);
  assert.doesNotThrow(() => pixels(model, 240, 160, '#000000', { progress: 0.5 }));
  const late = pixels(model, 240, 160, '#000000', { progress: 0.95 });
  assert.ok(late(75, 86)[0] > 20, 'the gradient fill fades in at the end of a draw-on');
});

// ── models made before gradients were kept ────────────────────────────────────────────────────

test('a vector model stored before this change draws the same pixels', () => {
  const old = JSON.parse(readFileSync(new URL('./fixtures/logos/old-model.json', import.meta.url), 'utf8'));
  assert.equal(old.v, undefined, 'an old model has no version');
  const hash = (opts) => {
    const c = createCanvas(240, 160), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 240, 160);
    draw(g, old, { width: 240, height: 160, ...opts });
    return createHash('sha256').update(g.getImageData(0, 0, 240, 160).data).digest('hex').slice(0, 16);
  };
  // hashes taken from the drawing code as it was before gradients were kept
  assert.equal(hash({}), '27bab32da93e0115');
  assert.equal(hash({ progress: 0.5 }), '5083b6ff3bee7dce');
  assert.equal(hash({ progress: 0.8, outline: false }), '7e4498966b94ede0');
  assert.equal(hash({ fill: '#112233', stroke: '#445566' }), '763c74c72cb2d650');
  assert.equal(hash({ colors: { '#ffd166': '#00ff00' }, strokeWidth: 2 }), 'd7d8ee644a644976');
  assert.equal(hash({ x: 5, y: 3, width: 100, height: 100 }), 'f14d9ef476d39ff1');
  // and a document asking for the old model (no options) still gets one: a gradient is its first stop
  const legacy = vectorModel(sanitizeSvg(fixture('illustrator.svg')).tree);
  assert.equal(legacy.v, undefined);
  assert.equal(legacy.gradients, undefined);
});

// ── hostile style sheets ──────────────────────────────────────────────────────────────────────

test('a hostile style sheet is neutralised: no fetch, no escape, no script survives; the fine rules still apply', () => {
  const { clean, model } = made(fixture('hostile-style.svg'));
  assert.doesNotMatch(clean.svg, /evil\.example|\\|@import|@font-face|<style|expression|javascript|image-set|var\(/i);
  assert.doesNotMatch(clean.svg, /url\((?!#)/, 'no url() that is not a reference inside the file');
  assert.equal(model.paths[1].fill, 'red', 'the safe declaration of a rule with an unsafe one stays');
  assert.equal(model.paths[4].fill, '#00ff00');
  for (const i of [0, 2, 3, 5, 6, 7]) assert.equal(model.paths[i].fill, '#000000', `rect ${i} got no colour from an unsafe declaration`);
  const reasons = clean.report.dropped.map((d) => `${d.what}: ${d.why}`).join('\n');
  for (const what of ['@import rule', 'fill in .a', 'stroke in .a', 'property "background" in .b', 'fill in .c', 'fill in .d', '@font-face rule', 'fill in .f', 'fill in .g', 'fill in .h']) assert.ok(reasons.includes(what), `reports ${what}\n${reasons}`);
});

test('hostile style sheets that are only big or malformed cost little and break nothing', () => {
  const time = (svg) => { const t0 = performance.now(); const r = made(svg); return { ...r, ms: performance.now() - t0 }; };
  // thousands of rules and elements: read up to a limit, the rest reported
  const rules = Array.from({ length: 30000 }, (_, i) => `.c${i} { fill: #${(i % 4096).toString(16).padStart(3, '0')} }`).join('\n');
  const rects = Array.from({ length: 3000 }, (_, i) => `<rect class="c${i % 1500}" width="1" height="1"/>`).join('');
  const big = time(WRAP(`<style>${rules}</style>${rects}`));
  assert.ok(big.ms < 4000, `${Math.round(big.ms)} ms`);
  assert.ok(big.clean.report.dropped.some((d) => /rules past the first 1000|style sheet text past/.test(d.what)), JSON.stringify(big.clean.report.dropped));
  assert.equal(big.model.paths[0].fill, '#000', 'the first rules apply');
  // nesting, unclosed blocks and strings
  for (const css of ['{'.repeat(150000), '@media{'.repeat(20000), '.a{'.repeat(20000), `.a{fill:"${'x'.repeat(100000)}`, '.a{fill:url(' + '('.repeat(50000), '/*'.repeat(1000), `.a{fill:red}${'}'.repeat(50000)}`, '@import', '.a { fill: red; ;;; : ; fill }', '\\'.repeat(1000)]) {
    const r = time(WRAP(`<style>${css}</style><rect class="a" width="1" height="1"/>`));
    assert.ok(r.ms < 2000, `${Math.round(r.ms)} ms for ${css.slice(0, 20)}`);
    assert.doesNotMatch(r.clean.svg, /<style|url\(http/);
  }
  assert.equal(made(WRAP('<style>.a{fill:red}}} .a{fill:#00f} </style><rect class="a" width="1" height="1"/>')).model.paths[0].fill, '#00f', 'a stray } does not stop the sheet');
  // only CSS, and only for screens
  const { clean } = made(WRAP('<style type="text/javascript">.a{fill:red}</style><style media="print">.a{fill:green}</style><rect class="a" width="1" height="1"/>'));
  assert.ok(clean.report.dropped.some((d) => /type="text\/javascript"/.test(d.what)) && clean.report.dropped.some((d) => /media="print"/.test(d.what)));
  assert.match(clean.svg, /<rect class="a" width="1" height="1"\/>/, 'neither sheet was applied');
});

test('without the styles option the sanitiser drops <style> as before', () => {
  const clean = sanitizeSvg(WRAP('<style>.a{fill:red}</style><rect class="a" width="1" height="1"/>'));
  assert.ok(clean.removed.includes('<style>'));
  assert.equal(clean.report, undefined);
});

// ── through the studio ────────────────────────────────────────────────────────────────────────

test('an uploaded logo keeps its colours in the image, the vector model and the report', async () => {
  const r = await studio.uploads.upload({ name: 'Studio mark.svg', data: Buffer.from(fixture('illustrator.svg')), author: 'user' });
  assert.equal(r.asset.meta.vector.v, 2);
  assert.deepEqual(Object.keys(r.asset.meta.vector.gradients), ['SVGID_1_', 'SVGID_2_', 'SVGID_3_']);
  assert.deepEqual(r.asset.meta.svg, r.svg, 'the asset meta carries the report');
  assert.ok(r.svg.kept.some((k) => /radial gradient #SVGID_2_/.test(k)));
  assert.ok(r.svg.dropped.every((d) => typeof d.what === 'string' && typeof d.why === 'string'));
  await studio.library.createAsset({ slug: 'mark-both', author: AUTHOR, source: `asset({
    description: 'Draws an uploaded logo twice: the stored image on the left half, the vector model on the right half.',
    tags: ['logo', 'test'],
    duration: 1,
    params: { logo: { type: 'image', default: '${r.asset.ref}' } },
    render(f, p) {
      const img = f.image(p.logo);
      f.ctx.drawImage(img, 0, 0, f.width / 2, f.height / 2);
      f.svg(p.logo).draw(f.ctx, { x: f.width / 2, y: 0, width: f.width / 2, height: f.height / 2 });
    },
  });` });
  const frame = await studio.assetFrame({ ref: 'mark-both', t: 0, width: 480, height: 320, background: '#000000' });
  const c = createCanvas(480, 320), g = c.getContext('2d');
  g.drawImage(await loadImage(frame.png), 0, 0);
  const at = (x, y) => [...g.getImageData(x, y, 1, 1).data];
  // each half is 240x160 showing the 240x160 logo at 1:1
  for (const { dx, which } of [{ dx: 0, which: 'image' }, { dx: 240, which: 'f.svg' }]) {
    near(at(dx + 25, 25), [123, 92, 255], 24, `${which}: first stop`);
    near(at(dx + 75, 86), [255, 92, 138], 18, `${which}: middle stop`);
    near(at(dx + 180, 80), [255, 255, 255], 12, `${which}: radial centre`);
  }
});

test('the HTTP upload and a repeated upload return the report too', async () => {
  const server = /** @type {any} */ (createStudioServer(studio, { env: { PATH: '' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/uploads?name=${encodeURIComponent('Unsupported bits.svg')}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'image/svg+xml' }, body: fixture('unsupported.svg') });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.svg.dropped.some((d) => d.what === '@media rule'), JSON.stringify(body.svg));
    const again = await (await fetch(url.replace('Unsupported', 'Same'), { method: 'POST', headers: { 'content-type': 'image/svg+xml' }, body: fixture('unsupported.svg') })).json();
    assert.equal(again.duplicate, true);
    assert.deepEqual(again.svg, body.svg);
    const png = await (await fetch(`${url.replace('.svg', '.png')}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(createCanvas(4, 4).toBuffer('image/png')) })).json();
    assert.equal(png.svg, null, 'a photo has no SVG report');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('upload_image over MCP stdio returns what could not be kept', async () => {
  const dataDir = mkdtempSync(join(tmp, 'mcp-'));
  const client = await connect({ dataDir, author: 'logo-test-model' });
  try {
    const up = await callTool(client, 'upload_image', { name: 'Unsupported bits.svg', data_base64: Buffer.from(fixture('unsupported.svg')).toString('base64') });
    assert.ok(!up.isError, up.text);
    assert.ok(up.json.svg.kept.length > 0);
    const dropped = up.json.svg.dropped;
    for (const what of ['@media rule', 'selector "g .a"', '<pattern> #p', '<filter> #blur']) assert.ok(dropped.some((d) => d.what === what && d.why), `${what} in ${JSON.stringify(dropped)}`);
    const hostile = await callTool(client, 'upload_image', { name: 'Hostile.svg', data_base64: Buffer.from(fixture('hostile-style.svg')).toString('base64') });
    assert.ok(!hostile.isError, hostile.text);
    assert.ok(hostile.json.svg.dropped.some((d) => d.what === '@import rule'));
    assert.doesNotMatch(JSON.stringify(hostile.json), /<style/);
    const logo = await callTool(client, 'upload_image', { name: 'Illustrator.svg', data_base64: Buffer.from(fixture('illustrator.svg')).toString('base64') });
    assert.ok(logo.json.svg.kept.some((k) => /gradient #SVGID_1_/.test(k)));
    const photo = await callTool(client, 'upload_image', { name: 'dot.png', data_base64: createCanvas(8, 8).toBuffer('image/png').toString('base64') });
    assert.equal(photo.json.svg, null);
  } finally {
    await client.close();
    await new Promise((r) => setTimeout(r, 300));
  }
});
