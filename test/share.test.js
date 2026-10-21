// Share links: a clip exported as one folder that plays from any static server (relative URLs only, its own player
// and runtime, only the media it shows), the studio's /share/<slug> page and bundle, and the share_clip MCP tool.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'acorn';
import { tempStudio, seedAssets, smallComposition, AUTHOR } from './helpers.js';
import { createStudioServer } from '../src/server/http.js';
import { shareOf, SHARE_DIR } from '../src/studio/share.js';
import { ffmpegPath, run, probeSummary } from '../src/render/ffmpeg.js';
import { createCanvas, loadImage } from '../src/render/host.js';
import { connect, callTool } from '../scripts/mcp.mjs';

let t, studio, out;
const TITLE = 'A tiny clip';
const DESCRIPTION = 'Dots & "quotes" <b>stay text</b>.';

before(async () => {
  t = tempStudio();
  studio = t.studio;
  await seedAssets(studio);
  await studio.clips.createClip({ slug: 'tiny', title: TITLE, description: DESCRIPTION, author: AUTHOR, composition: smallComposition() });
  out = join(t.dataDir, 'share-out');
});
after(() => t.cleanup());

/** Every file under dir, as paths relative to it with forward slashes. */
const walk = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name)).split('\\').join('/')]));
/** Every URL a bundle.json names: [key path, url]. */
function urlsOf(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => urlsOf(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => (['url', 'audio', 'poster'].includes(k) && typeof v === 'string' ? [[`${path}.${k}`, v]] : urlsOf(v, `${path}.${k}`)));
  return [];
}
const relativeOnly = (u) => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/') && !u.startsWith('\\') && !u.split('/').includes('..');

test('an export is one folder that plays from anywhere: relative URLs, its own player and runtime, the media it uses', async () => {
  const r = await shareOf(studio).exportClip('tiny', { out, baseUrl: 'https://example.com/clips/tiny' });
  assert.equal(r.dir, resolve(out));
  assert.equal(r.url, 'https://example.com/clips/tiny/');
  assert.equal(r.bytes, walk(out).reduce((n, f) => n + statSync(join(out, f)).size, 0));

  // the page: link-preview tags (escaped), only relative references
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const meta = (k, name) => new RegExp(`<meta ${k}="${name.replace(/[:.]/g, '\\$&')}" content="([^"]*)">`).exec(html)?.[1];
  assert.equal(meta('property', 'og:title'), TITLE);
  assert.equal(meta('property', 'og:description'), 'Dots &amp; &quot;quotes&quot; &lt;b&gt;stay text&lt;/b&gt;.');
  assert.equal(meta('property', 'og:type'), 'website');
  assert.equal(meta('property', 'og:image'), 'https://example.com/clips/tiny/og.jpg');
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
  assert.equal(meta('property', 'og:url'), 'https://example.com/clips/tiny/');
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.match(html, /<title>A tiny clip<\/title>/);
  assert.doesNotMatch(html, /<b>stay text/, 'the description is text, never markup');
  // the clip is drawn on a canvas by its own asset code: no video element, no embedded player
  assert.match(html, /<canvas/);
  assert.doesNotMatch(html, /<video|<iframe|<embed|<object/i);
  const refs = [...html.matchAll(/\s(?:src|href|data-bundle)="([^"]*)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('https://github.com/'));
  assert.ok(refs.length >= 5);
  for (const u of refs) assert.ok(relativeOnly(u) && existsSync(join(out, u)), `the page refers to ${u}, which must be relative and in the folder`);

  // the bundle: the clip's composition as saved, every URL relative and present
  const data = JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8'));
  assert.deepEqual(data.composition, studio.clips.getClip('tiny').composition);
  assert.deepEqual(Object.keys(data.bundle.assets).sort(), ['badge@1', 'dot@1', 'easing@1', 'label@1', 'scene@1']);
  const urls = urlsOf(data);
  assert.ok(urls.some(([k]) => k.startsWith('.fonts')) && urls.some(([k]) => k === '.audio'));
  for (const [key, u] of urls) assert.ok(relativeOnly(u) && existsSync(join(out, u)), `${key} = ${u}`);
  assert.ok(data.fonts.some((f) => f.family === 'Inter'), 'Inter, every text\'s default, always goes');
  assert.ok(!data.fonts.some((f) => f.ext), 'no Latin Extended text, no Latin Extended files');

  // the player and the runtime, every import of every module resolving inside the folder; no rendered video in it
  const files = walk(out);
  assert.deepEqual(files.filter((f) => /\.(mp4|mov|webm|m4v)$/i.test(f)), []);
  for (const f of ['player/player.js', 'player/engine.js', 'player/worker.js', 'player/player.css', 'core/runtime.js', 'core/lib/text.js', 'core/interactive.js']) assert.ok(files.includes(f), `${f} is exported`);
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    const ast = parse(readFileSync(join(out, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    for (const node of ast.body) {
      const spec = /** @type {any} */ (node).source?.value;
      if (typeof spec !== 'string') continue;
      assert.ok(spec.startsWith('.'), `${f} imports "${spec}": only relative imports play anywhere`);
      assert.ok(existsSync(resolve(dirname(join(out, f)), spec)), `${f} imports ${spec}, which is exported`);
    }
  }

  // the sound as AAC, the poster and the 1200×630 card
  const sound = await probeSummary(join(out, data.audio));
  assert.equal(sound.audio.codec, 'aac');
  assert.ok(Math.abs(sound.duration - 2) < 0.1, `the mix lasts the clip (${sound.duration} s)`);
  const card = await loadImage(readFileSync(join(out, 'og.jpg')));
  assert.deepEqual([card.width, card.height], [1200, 630]);
  const poster = await loadImage(readFileSync(join(out, 'poster.jpg')));
  assert.deepEqual([poster.width, poster.height], [320, 180]);

  // without a base URL the preview tags are relative and there is no og:url
  await shareOf(studio).exportClip('tiny', { out });
  const again = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(again, /<meta property="og:image" content="og\.jpg">/);
  assert.doesNotMatch(again, /og:url/);
});

test('an export never overwrites a folder that is not one', async () => {
  const other = join(t.dataDir, 'not-an-export');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'notes.txt'), 'mine');
  await assert.rejects(shareOf(studio).exportClip('tiny', { out: other }), /not empty and holds no earlier share export/);
  assert.equal(readFileSync(join(other, 'notes.txt'), 'utf8'), 'mine');
  await assert.rejects(shareOf(studio).exportClip('tiny', { out: join(t.dataDir, 'x'), baseUrl: 'ftp://example.com/' }), /http or https/);
  await assert.rejects(shareOf(studio).exportClip('nope', { out: join(t.dataDir, 'y') }), /No clip named "nope"/);
});

test('footage, sequences and images: only the frames the clip shows, as WebP, a repeated frame once', async () => {
  const dir = join(t.dataDir, 'media-src');
  mkdirSync(dir, { recursive: true });
  // one second of a single colour: ten frames, all the same picture
  const mp4 = join(dir, 'solid.mp4');
  const ff = await run(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3366ff:size=160x90:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
  assert.equal(ff.code, 0, ff.stderr);
  await studio.library.addFootage({ slug: 'solid', path: mp4, description: 'One second of one blue, made by FFmpeg.', author: AUTHOR });
  await studio.bakeSequence({ ref: 'dot', slug: 'dot-seq', params: { radius: 10 }, width: 96, height: 54, fps: 10, duration: 2, author: AUTHOR });
  const c = createCanvas(32, 16);
  const g = c.getContext('2d');
  g.fillStyle = '#ffd166'; g.fillRect(0, 0, 32, 16);
  await studio.library.addFileAsset({ slug: 'tile', type: 'image', data: c.toBuffer('image/png'), ext: '.png', description: 'A yellow tile (test image).', tags: ['test'], author: AUTHOR });
  await studio.clips.createClip({
    slug: 'media', title: 'Media', author: AUTHOR, composition: {
      width: 320, height: 180, fps: 10, duration: 2, background: '#000000',
      tracks: [{ id: 'v', type: 'visual', items: [
        // the footage plays its first half second only; the sequence its first second (clip frames 5 to 14)
        { id: 'f', asset: 'solid', start: 0, duration: 0.5, params: { fit: 'fill' } },
        { id: 's', asset: 'dot-seq', start: 0.5, duration: 1 },
        { id: 'i', asset: 'tile', start: 1.5, duration: 0.5, transform: { width: 0.2, height: 0.2 } },
      ] }],
    },
  });
  const media = join(t.dataDir, 'share-media');
  const r = await shareOf(studio).exportClip('media', { out: media });
  const data = JSON.parse(readFileSync(join(media, 'bundle.json'), 'utf8'));
  const v = data.bundle.footage['solid@1'], s = data.bundle.sequences['dot-seq@1'];
  assert.deepEqual(Object.keys(v.files).map(Number), [0, 1, 2, 3, 4], 'the footage frames shown');
  assert.equal(new Set(Object.values(v.files)).size, 1, 'identical frames are one file');
  assert.deepEqual(Object.keys(s.files).map(Number), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const x of [v, s]) for (const f of Object.values(x.files)) assert.ok(f.endsWith('.webp') && existsSync(join(media, x.url, f)), `${x.url}${f}`);
  assert.equal(readdirSync(join(media, s.url)).length, new Set(Object.values(s.files)).size, 'no frame it never shows');
  assert.ok(existsSync(join(media, data.bundle.images['tile@1'].url)));
  assert.equal(data.audio, null, 'no audio track, no sound file');
  assert.deepEqual(r.frames.map((f) => [f.kind, f.ref, f.shown, f.unique]), [['footage', 'solid@1', 5, 1], ['sequences', 'dot-seq@1', 10, new Set(Object.values(s.files)).size]]);
  // the sequence keeps its transparency
  const frame = await loadImage(readFileSync(join(media, s.url, s.files[5])));
  const fc = createCanvas(frame.width, frame.height);
  fc.getContext('2d').drawImage(frame, 0, 0);
  assert.equal(fc.getContext('2d').getImageData(0, 0, 1, 1).data[3], 0);
});

test('the studio serves /share/<clip>, its bundle with the studio\'s media URLs, and the player', async () => {
  const server = /** @type {any} */ (createStudioServer(studio, { env: { PATH: '' } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const slug = `share-test-${process.pid}`;
  try {
    const page = await fetch(`${base}/share/tiny`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /data-bundle="\/share\/tiny\/bundle\.json"/);
    assert.match(html, /src="\/player\/player\.js"/);
    assert.match(html, /src="\/api\/clips\/tiny\/frame\.png\?t=/);
    const data = await (await fetch(`${base}/share/tiny/bundle.json`)).json();
    assert.deepEqual(data.composition, studio.clips.getClip('tiny').composition);
    assert.equal(data.audio, '/api/clips/tiny/audio.wav');
    assert.ok(data.fonts[0].files[0].url.startsWith('/fonts/'));
    const poster = await fetch(`${base}${/src="(\/api\/clips\/tiny\/frame\.png[^"]+)"/.exec(html)[1].replace(/&amp;/g, '&')}`);
    assert.equal(poster.status, 200);
    for (const f of ['player.js', 'engine.js', 'worker.js', 'player.css']) assert.equal((await fetch(`${base}/player/${f}`)).status, 200, f);
    assert.ok([403, 404].includes((await fetch(`${base}/player/..%2F..%2Fpackage.json`)).status));
    assert.equal((await fetch(`${base}/share/nope`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/clips/tiny/share`)).json()).path, '/share/tiny');

    // POST exports to output/share/<clip>
    await studio.clips.createClip({ slug, title: 'Share route', author: AUTHOR, composition: smallComposition({ tracks: smallComposition().tracks.slice(0, 1) }) });
    const res = await fetch(`${base}/api/clips/${slug}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const r = await res.json();
    assert.equal(res.status, 200, JSON.stringify(r));
    assert.equal(r.dir, join(SHARE_DIR, slug));
    assert.ok(existsSync(join(r.dir, 'index.html')));
    assert.equal((await (await fetch(`${base}/api/clips/${slug}/share`)).json()).exported.dir, r.dir);
  } finally {
    rmSync(join(SHARE_DIR, slug), { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('share_clip over MCP: the folder and its weight, and errors that say what to do', async () => {
  const client = await connect({ dataDir: t.dataDir, author: 'share-test' });
  try {
    const dir = join(t.dataDir, 'mcp-share');
    const r = await callTool(client, 'share_clip', { clip: 'tiny', out: dir, base_url: 'https://example.com/tiny/' });
    assert.ok(!r.isError, r.text);
    assert.equal(r.json.dir, dir);
    assert.equal(r.json.url, 'https://example.com/tiny/');
    assert.match(r.json.studioUrl, /^http:\/\/127\.0\.0\.1:\d+\/share\/tiny$/);
    assert.ok(r.json.bytes > 100_000 && r.json.files > 20 && r.json.breakdown.core > 0);
    assert.match(r.json.next, /serve-static\.mjs/);
    assert.ok(existsSync(join(dir, 'index.html')));
    const missing = await callTool(client, 'share_clip', { clip: 'nope' });
    assert.ok(missing.isError);
    assert.match(missing.text, /No clip named "nope"\. Use list_clips/);
    const notEmpty = await callTool(client, 'share_clip', { clip: 'tiny', out: join(t.dataDir, 'media-src') });
    assert.ok(notEmpty.isError);
    assert.match(notEmpty.text, /give an empty or new folder/);
  } finally {
    await client.close();
  }
});
