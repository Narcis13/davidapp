// Provenance: every file asset carries where it came from and what may be done with it; a clip's credits come from its
// closure; a final render refuses a placeholder and an unlicensed file and writes the credits next to the MP4.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { tempStudio, seedAssets, AUTHOR } from './helpers.js';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';
import { encodeWav } from '../src/render/wav.js';
import { createStudio } from '../src/studio/studio.js';
import { createStudioServer } from '../src/server/http.js';
import { normalizeOptions } from '../src/studio/renders.js';
import { parseProvenance, buildProvenance, defaultRedistributable, isUnknownLicense, provenanceOf, fromQuery } from '../src/studio/provenance.js';
import { connect, callTool } from '../scripts/mcp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = (name) => join(here, 'fixtures', 'fonts', name);
const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'provenance-src-'));
const png = (color, w = 40, h = 20) => {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  return c.toBuffer('image/png');
};
const MP4 = join(tmp, 'tour.mp4');
const WAV = join(tmp, 'voice.wav');
const SR = 48000;

// an asset that shows a picture given as a parameter, and one that uses it: the picture is a dependency of a dependency
const FRAMED = `asset({
  description: 'A picture inset in a frame, for provenance tests.',
  tags: ['frame', 'test'],
  params: { picture: { type: 'image', default: 'nested-photo' } },
  render(f, p) {
    f.ctx.fillStyle = '#334455'; f.ctx.fillRect(0, 0, f.width, f.height);
    if (p.picture) f.ctx.drawImage(f.image(p.picture), 10, 10, f.width - 20, f.height - 20);
  },
});`;
const WRAPPER = `asset({
  description: 'A framed picture inside a scene, for provenance tests.',
  tags: ['scene', 'test'],
  uses: ['framed'],
  render(f) { f.use('framed'); },
});`;

let t, studio, library, server, base;
/** @param {string} path @param {RequestInit} [init] @returns {Promise<{ status: number, body: any, headers: Headers }>} */
const call = async (path, init) => {
  const r = await fetch(`${base}${path}`, init);
  const text = await r.text();
  /** @type {any} */
  let body = text;
  try { body = JSON.parse(text); } catch { /* markdown */ }
  return { status: r.status, body, headers: r.headers };
};
const up = (/** @type {string} */ query, /** @type {any} */ body = png('#cc2244')) => call(`/api/uploads?${query}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body });

before(async () => {
  const ff = async (args) => { const r = await run(ffmpegPath(), ['-v', 'error', '-y', ...args]); assert.equal(r.code, 0, r.stderr); };
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', MP4]);
  const n = SR * 2, l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / SR);
  writeFileSync(WAV, encodeWav(l, l, SR));
  t = tempStudio({ runner: true });
  studio = t.studio;
  library = studio.library;
  await seedAssets(studio);
  server = /** @type {any} */ (createStudioServer(studio));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- the shape ------------------------------------------------------------------------------------

test('the shape: names, defaults, redistributable by licence, validation with useful messages', () => {
  assert.deepEqual(Object.keys(buildProvenance({ license: 'CC-BY-4.0' })).sort(), ['aiGenerated', 'contentId', 'credit', 'creator', 'date', 'license', 'licenseUrl', 'placeholder', 'redistributable', 'restrictions', 'sourceUrl'].sort());
  const unknown = buildProvenance(null);
  assert.deepEqual([unknown.license, unknown.redistributable, unknown.aiGenerated, unknown.contentId, unknown.placeholder, unknown.restrictions], [null, false, false, false, false, null]);
  assert.match(unknown.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const l of ['original', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'OFL-1.1', 'MIT', 'ISC', 'Apache-2.0']) assert.equal(defaultRedistributable(l), true, l);
  for (const l of [null, '', 'unknown', 'all rights reserved', 'commercial, licensed to us']) assert.equal(defaultRedistributable(l), false, String(l));
  for (const l of [null, undefined, '', '  ', 'unknown', 'Unknown']) assert.equal(isUnknownLicense(l), true);
  // an unknown licence is never redistributable, even when the caller says so (and it stays out of git on export)
  assert.equal(buildProvenance({ redistributable: true }).redistributable, false);
  assert.equal(buildProvenance({ license: 'unknown', redistributable: true }).redistributable, false);
  assert.equal(provenanceOf({ type: 'image', meta: JSON.stringify({ provenance: { license: null, redistributable: true } }) }).redistributable, false);
  assert.equal(buildProvenance({ license: 'CC-BY-4.0', redistributable: false }).redistributable, false);
  assert.equal(isUnknownLicense('original'), false);
  // snake_case spellings are accepted, text is trimmed, "" is null
  assert.deepEqual(parseProvenance({ source_url: ' https://example.test/a ', ai_generated: true, creator: '', date: '2025-03-14' }), { sourceUrl: 'https://example.test/a', aiGenerated: true, creator: null, date: '2025-03-14' });
  const bad = (input, re) => assert.throws(() => parseProvenance(input), re);
  bad({ sourceUrl: 'example.test/photo' }, /sourceUrl must be a web address starting with http/);
  bad({ licenseUrl: 'ftp://example.test/x' }, /licenseUrl must be a web address/);
  bad({ date: '2025-02-30' }, /date must be an ISO date/);
  bad({ date: 'yesterday' }, /date must be an ISO date/);
  bad({ aiGenerated: 'yes' }, /aiGenerated must be true or false/);
  bad({ placeholder: null }, /placeholder must be true or false/);
  bad({ licence: 'CC0' }, /unknown field "licence" \(the fields are license, licenseUrl/);
  bad({ credit: 'x'.repeat(301) }, /credit is at most 300 characters/);
  bad({ license: 7 }, /license must be text or null/);
  bad('CC0', /is an object of/);
  assert.deepEqual(fromQuery(new URLSearchParams('license=CC0-1.0&ai_generated=yes&placeholder=0&content_id=maybe&name=x')), { license: 'CC0-1.0', aiGenerated: true, placeholder: false, contentId: 'maybe' });
  assert.throws(() => parseProvenance(fromQuery(new URLSearchParams('content_id=maybe'))), /contentId must be true or false/);
});

// ---- set on creation --------------------------------------------------------------------------------

test('add_file_asset records what it is told, and an image with no licence is recorded as unknown', async () => {
  const path = join(tmp, 'photo.png');
  writeFileSync(path, png('#2244cc'));
  const a = (await library.addFileAsset({
    slug: 'sky-photo', type: 'image', path, description: 'A blue test photo from a stock site.', author: AUTHOR,
    provenance: { license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://example.test/photos/1', creator: 'Jane Doe', credit: 'Photo: Jane Doe / Unsplash', date: '2025-03-14', restrictions: 'editorial use only', contentId: true },
  })).asset;
  assert.deepEqual(a.provenance, {
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://example.test/photos/1', creator: 'Jane Doe', credit: 'Photo: Jane Doe / Unsplash',
    date: '2025-03-14', aiGenerated: false, contentId: true, restrictions: 'editorial use only', placeholder: false, redistributable: true,
  });
  assert.equal(a.meta.license, 'CC-BY-4.0', 'meta.license follows provenance.license');
  assert.deepEqual(a.meta.provenance, a.provenance);
  // nothing said: unknown, not a guess
  const blank = (await library.addFileAsset({ slug: 'no-idea', type: 'image', data: png('#888888'), ext: '.png', description: 'An image nobody said anything about.', author: AUTHOR })).asset;
  assert.equal(blank.provenance.license, null);
  assert.equal(blank.meta.license, null);
  assert.equal(blank.provenance.redistributable, false);
  // the old license argument still works, and a bad value is refused before anything is stored
  const old = (await library.addFileAsset({ slug: 'old-way', type: 'image', data: png('#aaaaaa'), ext: '.png', description: 'Added with the license argument alone.', author: AUTHOR, license: 'CC0-1.0' })).asset;
  assert.deepEqual([old.provenance.license, old.meta.license, old.provenance.redistributable], ['CC0-1.0', 'CC0-1.0', true]);
  await assert.rejects(library.addFileAsset({ slug: 'bad-url', type: 'image', data: png('#aaaaaa'), ext: '.png', description: 'Added with a bad source address.', author: AUTHOR, provenance: { sourceUrl: 'not a url' } }), /sourceUrl must be a web address/);
  assert.equal(library.versionRow('bad-url'), undefined);
  // made assets are original and remember what they were made from
  const baked = (await library.addFileAsset({ slug: 'dot-still', type: 'image', data: png('#ff3366'), ext: '.png', description: 'A still of the dot asset, baked.', author: AUTHOR, derivedFrom: 'dot@1' })).asset;
  assert.deepEqual([baked.provenance.license, baked.provenance.derivedFrom, baked.provenance.redistributable], ['original', 'dot@1', true]);
  // a sequence baked from an asset is original too
  const dir = join(tmp, 'seq');
  mkdirSync(dir);
  writeFileSync(join(dir, '000000.png'), png('#ffffff'));
  const seq = library.addSequence({ slug: 'dot-seq', dir, author: AUTHOR, derivedFrom: 'dot@1', thumb: png('#ffffff'), description: 'One frame of the dot asset, baked to a sequence.', meta: { frames: 1, fps: 10, width: 40, height: 20, duration: 0.1, key: 'k1', bakedFrom: 'dot@1' } }).asset;
  assert.deepEqual([seq.provenance.license, seq.provenance.derivedFrom], ['original', 'dot@1']);
  // a function asset is code written in the studio: no provenance
  assert.equal(library.getAsset('dot', { includeSource: false }).provenance, null);
});

test('a narration is original, and a voice with a model is recorded as AI-generated; the voice is kept', async () => {
  const r = await studio.audio.addNarration({
    slug: 'vo', path: WAV, script: 'Two words', timings: [{ word: 'Two', start: 0.2, end: 0.6 }, { word: 'words', start: 0.7, end: 1.2 }], author: AUTHOR,
    voice: { name: 'af_heart', model: 'Kokoro-82M', license: 'Apache-2.0', source: 'https://huggingface.co/hexgrad/Kokoro-82M' },
  });
  const p = r.asset.provenance;
  assert.deepEqual([p.license, p.aiGenerated, p.redistributable], ['original', true, true]);
  assert.equal(r.asset.meta.narration.voice.model, 'Kokoro-82M');
  // said otherwise
  const human = await studio.audio.addNarration({ slug: 'vo-human', path: WAV, script: 'Two words', timings: [{ word: 'Two', start: 0.2, end: 0.6 }, { word: 'words', start: 0.7, end: 1.2 }], author: AUTHOR, voice: { name: 'Ana' }, provenance: { creator: 'Ana Pop', credit: 'Voice: Ana Pop', aiGenerated: false } });
  assert.deepEqual([human.asset.provenance.aiGenerated, human.asset.provenance.creator, human.asset.provenance.license], [false, 'Ana Pop', 'original']);
});

test('add_footage and add_font take provenance; a font keeps its licence and a URL source as the source address', async () => {
  const f = (await library.addFootage({ slug: 'tour', path: MP4, description: 'A one second test pattern from FFmpeg.', author: AUTHOR, provenance: { license: 'original', creator: 'The studio' } })).asset;
  assert.deepEqual([f.provenance.license, f.provenance.creator, f.meta.license], ['original', 'The studio', 'original']);
  const unlicensed = (await library.addFootage({ slug: 'tour-unknown', path: MP4, description: 'The same test pattern, nothing said about it.', author: AUTHOR })).asset;
  assert.equal(unlicensed.provenance.license, null);
  const font = (await studio.fonts.addFont({ name: 'fixture-blocks', path: FIX('fixture-blocks-regular.ttf'), license: 'CC0-1.0', source: 'https://example.test/fixture', author: AUTHOR, provenance: { creator: 'Test Foundry', credit: 'Font: Fixture Blocks by Test Foundry' } })).asset;
  assert.deepEqual([font.provenance.license, font.provenance.sourceUrl, font.provenance.creator, font.provenance.redistributable, font.meta.license], ['CC0-1.0', 'https://example.test/fixture', 'Test Foundry', true, 'CC0-1.0']);
  assert.equal(font.meta.source, 'https://example.test/fixture', 'the old field stays');
  // a licence given as text is kept as it is
  const wide = (await studio.fonts.addFont({ name: 'fixture-wide', path: FIX('fixture-wide.otf'), license: 'commercial, licensed to us', source: 'a type foundry in Bucharest', author: AUTHOR })).asset;
  assert.deepEqual([wide.provenance.license, wide.provenance.sourceUrl, wide.provenance.redistributable], ['commercial, licensed to us', null, false]);
  await assert.rejects(studio.fonts.addFont({ name: 'fixture-slant', path: FIX('fixture-slant.woff2'), license: 'OFL-1.1', author: AUTHOR, provenance: { date: 'soon' } }), /date must be an ISO date/);
});

test('uploads over HTTP: provenance in the query, an unlicensed upload is unknown, mistakes are refused', async () => {
  const full = await up('name=beach.png&license=CC0-1.0&creator=Ion%20Popescu&source_url=https%3A%2F%2Fexample.test%2Fbeach&credit=Beach%20by%20Ion&ai_generated=true&content_id=false&date=2024-08-01');
  assert.equal(full.status, 200, JSON.stringify(full.body));
  const p = full.body.asset.provenance;
  assert.deepEqual([p.license, p.creator, p.sourceUrl, p.credit, p.aiGenerated, p.contentId, p.date, p.redistributable], ['CC0-1.0', 'Ion Popescu', 'https://example.test/beach', 'Beach by Ion', true, false, '2024-08-01', true]);
  assert.equal(full.body.asset.meta.license, 'CC0-1.0');
  const bare = await up('name=mystery.png', png('#116644'));
  assert.equal(bare.status, 200, JSON.stringify(bare.body));
  assert.equal(bare.body.asset.provenance.license, null, 'not "uploaded by the user"');
  assert.equal(bare.body.asset.meta.license, null);
  assert.equal(bare.body.asset.needsDescription, true);
  /** @type {[string, RegExp][]} */
  const mistakes = [['name=x.png&source_url=nope', /sourceUrl must be a web address/], ['name=x.png&ai_generated=maybe', /aiGenerated must be true or false/], ['name=x.png&date=13-13-2020', /date must be an ISO date/]];
  for (const [query, re] of mistakes) {
    const r = await up(query, png('#010203'));
    assert.equal(r.status, 400, query);
    assert.match(r.body.error, re);
  }
  // a font over HTTP, and footage over HTTP, take the same query
  const font = await call('/api/fonts?name=http-slant&license=OFL-1.1&creator=Someone&source_url=https%3A%2F%2Fexample.test%2Ff', { method: 'POST', headers: { 'content-type': 'font/woff2' }, body: readFileSync(FIX('fixture-slant.woff2')) });
  assert.equal(font.status, 200, JSON.stringify(font.body));
  assert.deepEqual([font.body.asset.provenance.creator, font.body.asset.provenance.sourceUrl, font.body.asset.provenance.license], ['Someone', 'https://example.test/f', 'OFL-1.1']);
  const footage = await call('/api/footage?name=http-tour.mp4&license=CC-BY-4.0&creator=Maria&description=A%20test%20pattern%20uploaded%20over%20HTTP.', { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: readFileSync(MP4) });
  assert.equal(footage.status, 200, JSON.stringify(footage.body));
  assert.deepEqual([footage.body.asset.provenance.license, footage.body.asset.provenance.creator], ['CC-BY-4.0', 'Maria']);
  const noLic = await call('/api/footage?name=http-tour-2.mp4&description=A%20test%20pattern%20uploaded%20without%20a%20licence.', { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: readFileSync(MP4) });
  assert.equal(noLic.body.asset.provenance.license, null);
  const badFootage = await call('/api/footage?name=http-tour-3.mp4&ai_generated=2', { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: readFileSync(MP4) });
  assert.equal(badFootage.status, 400);
});

// ---- editing --------------------------------------------------------------------------------------------

test('provenance is editable as metadata: a partial update on a version, no new version, recorded, validated', async () => {
  const before = library.getAsset('no-idea', { includeSource: false });
  assert.equal(before.provenance.license, null);
  const r = library.setMetadata({ slug: 'no-idea', author: 'editor-model', provenance: { license: 'CC-BY-4.0', creator: 'Mara', sourceUrl: 'https://example.test/m' } });
  assert.equal(r.latestVersion, 1, 'no new version');
  assert.equal(library.getAsset('no-idea').versions.length, 1);
  assert.deepEqual([r.provenance.license, r.provenance.creator, r.provenance.contentId, r.provenance.date], ['CC-BY-4.0', 'Mara', false, before.provenance.date], 'the other fields are left alone');
  assert.equal(r.provenance.redistributable, true, 'redistributable followed the licence, which it only defaulted from');
  assert.equal(r.meta.license, 'CC-BY-4.0');
  assert.equal(r.provenance.edit.by, 'editor-model');
  assert.match(r.provenance.edit.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(library.getAsset('no-idea').provenance.edit.by, 'editor-model', 'get_asset shows it');
  assert.equal(r.metadataEdit, null, 'the title and tags edit marker is not touched');
  // an explicit redistributable is kept when the licence changes
  library.setMetadata({ slug: 'no-idea', author: AUTHOR, provenance: { redistributable: false } });
  assert.equal(library.setMetadata({ slug: 'no-idea', author: AUTHOR, provenance: { license: 'CC0-1.0' } }).provenance.redistributable, false);
  // null clears a text field; the flags
  const cleared = library.setMetadata({ slug: 'no-idea', author: AUTHOR, provenance: { creator: null, placeholder: true, aiGenerated: true } });
  assert.deepEqual([cleared.provenance.creator, cleared.provenance.placeholder, cleared.provenance.aiGenerated], [null, true, true]);
  library.setMetadata({ slug: 'no-idea', author: AUTHOR, provenance: { placeholder: false } });
  // a version of its own
  const v2 = (await library.addFileAsset({ slug: 'no-idea', type: 'image', data: png('#999999'), ext: '.png', description: 'A second take of the unlabelled image.', author: AUTHOR })).asset;
  assert.equal(v2.provenance.license, null, 'a new version starts from what it is told, not from the last one');
  const v1 = library.setMetadata({ slug: 'no-idea', author: AUTHOR, version: 1, provenance: { credit: 'v1 credit' } });
  assert.deepEqual([v1.version, v1.provenance.credit, library.getAsset('no-idea@2').provenance.credit], [1, 'v1 credit', null]);
  assert.equal(library.getAsset('no-idea').version, 2, 'the default is the latest');
  library.setMetadata({ slug: 'no-idea', author: AUTHOR, provenance: { license: 'original' } });
  assert.equal(library.getAsset('no-idea@2').provenance.license, 'original');
  assert.equal(library.getAsset('no-idea@1').provenance.license, 'CC0-1.0');
  // errors
  const bad = (o, re) => assert.throws(() => library.setMetadata({ author: AUTHOR, ...o }), re);
  bad({ slug: 'no-idea', provenance: { licenseUrl: 'nope' } }, /licenseUrl must be a web address/);
  bad({ slug: 'no-idea', provenance: {} }, /Give at least one of license/);
  bad({ slug: 'no-idea', provenance: { color: 'red' } }, /unknown field "color"/);
  bad({ slug: 'no-idea', version: 9, provenance: { credit: 'x' } }, /no version 9/);
  bad({ slug: 'no-idea', version: 1, title: 'x' }, /version applies to provenance only/);
  bad({ slug: 'dot', provenance: { license: 'original' } }, /function asset.*carries no provenance/);
  bad({ slug: 'font-inter', provenance: { license: 'MIT' } }, /bundled with the studio/);
  bad({ slug: 'nothing-here', provenance: { license: 'MIT' } }, /No asset named/);
  // the source, file and the rest stay what they were: the immutability trigger is untouched
  assert.throws(() => studio.db.prepare("UPDATE asset_versions SET file = 'x' WHERE id = (SELECT id FROM asset_versions LIMIT 1)").run(), /immutable/);
  // over HTTP
  const put = await call('/api/assets/no-idea/metadata', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provenance: { credit: 'Via HTTP' }, version: 2 }) });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual([put.body.version, put.body.provenance.credit], [2, 'Via HTTP']);
  const putBad = await call('/api/assets/no-idea/metadata', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provenance: { date: 'tomorrow' } }) });
  assert.equal(putBad.status, 400);
  const got = await call('/api/assets/no-idea?version=2');
  assert.equal(got.body.provenance.credit, 'Via HTTP');
});

test('rows written before provenance existed read sensibly and are never rewritten', async () => {
  const set = (slug, meta) => {
    const row = library.versionRow(slug);
    studio.db.prepare('UPDATE asset_versions SET meta = ? WHERE id = ?').run(JSON.stringify(meta), row.version_id);
  };
  await library.addFileAsset({ slug: 'legacy-upload', type: 'image', data: png('#102030'), ext: '.png', description: 'An upload from before provenance existed.', author: AUTHOR });
  set('legacy-upload', { width: 40, height: 20, license: 'uploaded by the user', hash: 'abc' });
  const a = library.getAsset('legacy-upload', { includeSource: false });
  assert.equal(a.provenance.license, null);
  assert.equal(a.provenance.recorded, 'uploaded by the user');
  assert.equal(a.provenance.redistributable, false);
  assert.equal(a.meta.license, 'uploaded by the user', 'the stored row is as it was');
  assert.equal(a.meta.provenance, undefined);
  await library.addFileAsset({ slug: 'legacy-made', type: 'image', data: png('#304050'), ext: '.png', description: 'A baked image from before provenance existed.', author: AUTHOR });
  set('legacy-made', { width: 40, height: 20, license: 'original', bakedFrom: 'dot@1' });
  const m = library.getAsset('legacy-made', { includeSource: false });
  assert.deepEqual([m.provenance.license, m.provenance.recorded, m.provenance.redistributable], ['original', undefined, true]);
  // a legacy uploaded font: licence and a URL source
  const f = provenanceOf({ type: 'font', meta: JSON.stringify({ family: 'X', license: 'OFL-1.1', source: 'https://example.test/x', uploaded: true }) });
  assert.deepEqual([f.license, f.sourceUrl, f.redistributable], ['OFL-1.1', 'https://example.test/x', true]);
  // a legacy sequence never recorded a licence: it was baked by the studio
  assert.equal(provenanceOf({ type: 'sequence', meta: JSON.stringify({ frames: 3, bakedFrom: 'dot@1' }) }).license, 'original');
  // editing one gives it the full record and drops the note
  const edited = library.setMetadata({ slug: 'legacy-upload', author: AUTHOR, provenance: { license: 'CC0-1.0' } });
  assert.deepEqual([edited.provenance.license, edited.provenance.recorded], ['CC0-1.0', undefined]);
  // the bundled fonts read from their record
  assert.deepEqual([library.getAsset('font-inter', { includeSource: false }).provenance.license], ['OFL-1.1']);
});

// ---- credits --------------------------------------------------------------------------------------------

async function creditsClip() {
  // clip → wrapper → framed → nested-photo: the picture is a dependency of a dependency
  await library.addFileAsset({ slug: 'nested-photo', type: 'image', data: png('#aa5500'), ext: '.png', description: 'The picture inside the frame asset.', author: AUTHOR, provenance: { license: 'CC-BY-4.0', creator: 'Nested Nick', credit: 'Picture: Nested Nick (CC BY 4.0)', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' } });
  await library.createAsset({ slug: 'framed', source: FRAMED, author: AUTHOR });
  await library.createAsset({ slug: 'wrapper', source: WRAPPER, author: AUTHOR });
  const comp = {
    width: 320, height: 180, fps: 10, duration: 2, background: '#000000',
    tracks: [
      { id: 'v', type: 'visual', items: [
        { id: 'pic', asset: 'sky-photo', start: 0, duration: 2, transform: { x: 0, y: 0, width: 0.3, height: 0.3 } },
        { id: 'vid', asset: 'tour', start: 0, duration: 1, params: { fit: 'fill' }, transform: { x: 0.3, y: 0, width: 0.3, height: 0.3 } },
        { id: 'scene', asset: 'wrapper', start: 0, duration: 2, transform: { x: 0.6, y: 0, width: 0.3, height: 0.3 } },
        { id: 'dots', asset: 'dot', start: 0, duration: 2, transform: { x: 0, y: 0.5, width: 0.4, height: 0.3 } },
      ] },
      { id: 'text', type: 'text', items: [
        { id: 'a', asset: 'label', start: 0, duration: 2, params: { text: 'Blocks', font: 'Fixture Blocks' }, transform: { x: 0.4, y: 0.5, width: 0.3, height: 0.2 } },
        { id: 'b', asset: 'label', start: 0, duration: 2, params: { text: 'Anton', font: 'Anton' }, transform: { x: 0.4, y: 0.7, width: 0.3, height: 0.2 } },
        { id: 'c', asset: 'label', start: 0, duration: 2, params: { text: 'Inter', font: 'Inter' }, transform: { x: 0.7, y: 0.7, width: 0.3, height: 0.2 } },
      ] },
      { id: 'voice', type: 'audio', role: 'narration', items: [{ id: 'vo', asset: 'vo', start: 0, duration: 2 }] },
    ],
  };
  return studio.clips.createClip({ slug: 'credited', title: 'Credited', author: AUTHOR, composition: comp });
}

test('credits come from the closure: footage, image, nested dependency, narration and its voice, uploaded and bundled fonts', async () => {
  await creditsClip();
  const r = studio.provenance.credits({ clip: 'credited' });
  const by = Object.fromEntries(r.sources.map((s) => [s.ref, s]));
  // every pinned version of the closure, deps of deps included
  for (const ref of ['sky-photo@1', 'tour@1', 'nested-photo@1', 'vo@1', 'fixture-blocks@1']) assert.ok(by[ref], `${ref} is a source`);
  assert.ok(by['font-inter@1'] && by['font-anton@1'], 'the bundled fonts are named');
  assert.ok(by['font-inter@1'].bundled && by['font-anton@1'].bundled);
  assert.equal(by['nested-photo@1'].license, 'CC-BY-4.0');
  assert.equal(by['nested-photo@1'].creator, 'Nested Nick');
  assert.deepEqual(Object.keys(by['sky-photo@1']).sort(), ['aiGenerated', 'contentId', 'creator', 'credit', 'date', 'group', 'license', 'licenseUrl', 'placeholder', 'redistributable', 'ref', 'restrictions', 'sourceUrl', 'title', 'type']);
  assert.deepEqual([by['sky-photo@1'].contentId, by['sky-photo@1'].restrictions, by['sky-photo@1'].group], [true, 'editorial use only', 'images']);
  assert.equal(by['tour@1'].group, 'footage');
  assert.equal(by['vo@1'].group, 'voice');
  assert.equal(by['vo@1'].voice.model, 'Kokoro-82M');
  assert.equal(by['fixture-blocks@1'].group, 'fonts');
  // the studio's own code appears once, briefly
  assert.equal(r.sources.filter((s) => s.type === 'function').length, 1);
  assert.equal(r.sources.find((s) => s.type === 'function').credit, 'Motion graphics: original, made in Fablecut');
  assert.ok(!r.sources.some((s) => ['dot@1', 'framed@1', 'wrapper@1'].includes(s.ref)));
  // the credit lines
  assert.ok(r.credits.includes('Motion graphics: original, made in Fablecut'));
  assert.ok(r.credits.includes('Photo: Jane Doe / Unsplash'), 'a credit as given');
  assert.ok(r.credits.includes('Picture: Nested Nick (CC BY 4.0)'));
  assert.ok(r.credits.includes('Font: Fixture Blocks by Test Foundry'));
  assert.ok(r.credits.some((l) => /^Voice: af_heart \(Kokoro-82M\), Apache-2\.0$/.test(l)), r.credits.join(' | '));
  assert.ok(r.credits.some((l) => /^Fonts: Anton, Inter \(OFL-1\.1\)$/.test(l)), r.credits.join(' | '));
  assert.ok(!r.sources.some((s) => s.ref === 'font-inter@1' && !s.bundled));
  assert.ok(r.credits.includes('Footage: tour by The studio'), 'no credit given: built from the creator');
  // the unlicensed files of other tests are not in this clip
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings.sort(), ['sky-photo@1: registered with a content-ID system, so a platform may claim a video that uses it', 'sky-photo@1: restriction: editorial use only'].sort());
});

test('the Markdown groups by kind and lists AI-generated and content-ID material separately', async () => {
  const { markdown } = studio.provenance.credits({ clip: 'credited', format: 'markdown' });
  const heads = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['Credits', 'Footage', 'Images', 'Voice', 'Fonts', 'Motion graphics', 'AI-generated material', 'Registered with a content-ID system', 'Notes']);
  assert.match(markdown, /^# Credits and sources: credited$/m);
  assert.match(markdown, /- \*\*tour\*\* \(`tour@1`\); by The studio; original/);
  assert.match(markdown, /\[CC-BY-4\.0\]\(https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\)/);
  assert.match(markdown, /source: <https:\/\/example\.test\/photos\/1>/);
  assert.match(markdown, /voice af_heart, Kokoro-82M \(Apache-2\.0\)/);
  assert.ok(markdown.includes('Photo: Jane Doe / Unsplash'));
  assert.match(markdown, /Original, made in Fablecut \(\d+ assets?\)\./);
  assert.match(markdown, /- \*\*Anton\*\* \(bundled with Fablecut\)/);
  const ai = markdown.split('## AI-generated material')[1].split('## ')[0];
  assert.match(ai, /Vo|vo@1/);
  assert.ok(!/sky-photo/.test(ai));
  const cid = markdown.split('## Registered with a content-ID system')[1].split('## ')[0];
  assert.match(cid, /sky-photo@1/);
  assert.ok(markdown.endsWith('\n') && !markdown.endsWith('\n\n'));
  // a clip with nothing to credit says so
  await studio.clips.createClip({ slug: 'plain', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 1, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'd', asset: 'dot', start: 0, duration: 1 }] }] } });
  const plain = studio.provenance.credits({ clip: 'plain', format: 'markdown' });
  assert.deepEqual(plain.credits, ['Motion graphics: original, made in Fablecut']);
  assert.throws(() => studio.provenance.credits({ clip: 'no-such-clip' }), /No clip named "no-such-clip"/);
  // over HTTP
  const j = await call('/api/clips/credited/credits');
  assert.equal(j.status, 200);
  assert.ok(Array.isArray(j.body.credits) && Array.isArray(j.body.sources) && Array.isArray(j.body.problems));
  assert.equal(j.body.markdown, undefined);
  const m = await call('/api/clips/credited/credits?format=markdown');
  assert.equal(m.body.markdown, markdown);
  const raw = await call('/api/clips/credited/credits?format=md');
  assert.equal(raw.body, markdown);
  assert.match(raw.headers.get('content-type'), /text\/markdown/);
  assert.equal((await call('/api/clips/credited/credits?format=pdf')).status, 400);
  assert.equal((await call('/api/clips/ghost/credits')).status, 404);
  assert.deepEqual((await call('/api/clips/credited/provenance')).body.ready, true);
});

test('a baked file brings what it was drawn from into the credits', async () => {
  await library.addFileAsset({ slug: 'baked-frame', type: 'image', data: png('#223344'), ext: '.png', description: 'A frame of the framed asset, baked to an image.', author: AUTHOR, derivedFrom: 'framed@1' });
  await studio.clips.createClip({ slug: 'baked-clip', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 1, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'i', asset: 'baked-frame', start: 0, duration: 1 }] }] } });
  const r = studio.provenance.credits({ clip: 'baked-clip' });
  const refs = r.sources.map((s) => s.ref);
  assert.ok(refs.includes('baked-frame@1') && refs.includes('nested-photo@1'), refs.join());
  assert.equal(r.sources.find((s) => s.ref === 'nested-photo@1').via, 'baked-frame@1');
});

test('a bundled font an asset draws without a font parameter naming it is in the credits (the save check saw it drawn)', async () => {
  const MONO = `asset({
  description: 'A label drawn in a fixed family, for provenance tests.',
  tags: ['label', 'test'],
  params: { text: { type: 'string', default: 'v1.0' } },
  render(f, p) {
    const L = f.lib.text.layout(f.ctx, p.text, { font: 'JetBrains Mono', weight: 400, size: f.height * 0.3 });
    f.lib.text.fill(f.ctx, L, (f.width - L.width) / 2, (f.height - L.height) / 2);
  },
})`;
  await library.createAsset({ slug: 'mono-label', source: MONO, author: AUTHOR });
  const { checked } = await studio.clips.createClip({ slug: 'drawn-fonts', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 1, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'm', asset: 'mono-label', start: 0, duration: 1 }] }] } });
  assert.deepEqual(checked.fontsDrawn, ['JetBrains Mono']);
  const r = studio.provenance.credits({ clip: 'drawn-fonts' });
  assert.ok(r.credits.some((c) => /^Fonts: JetBrains Mono \(OFL-1\.1\)$/.test(c)), r.credits.join(' | '));
  // a save without the check keeps what the parameters name only
  await studio.clips.updateClip('drawn-fonts', { composition: studio.clips.getClip('drawn-fonts').composition, check: false });
  assert.ok(!studio.provenance.credits({ clip: 'drawn-fonts' }).credits.some((c) => c.startsWith('Fonts:')));
});

// ---- final renders -------------------------------------------------------------------------------------

async function fresh(slug, assets, extra = {}) {
  const items = assets.map((asset, i) => ({ id: `i${i}`, asset, start: 0, duration: 1, transform: { x: 0, y: i * 0.3, width: 0.3, height: 0.3 } }));
  return studio.clips.createClip({ slug, author: AUTHOR, composition: { width: 240, height: 136, fps: 10, duration: 1, background: '#000000', tracks: [{ id: 'v', type: 'visual', items }], ...extra } });
}

test('render options: final is checked, stored, and cannot be a draft', () => {
  const comp = { width: 160, height: 90, duration: 1, fps: 10 };
  assert.deepEqual(normalizeOptions({ final: true }, comp), { final: true });
  assert.deepEqual(normalizeOptions({ final: false }, comp), {});
  assert.throws(() => normalizeOptions({ final: 'yes' }, comp), /final must be true or false/);
  assert.throws(() => normalizeOptions({ final: true, draft: true }, comp), /both a draft and final/);
  assert.deepEqual(normalizeOptions({ final: true, draft: false }, comp), { final: true });
  assert.throws(() => normalizeOptions({ finale: true }, comp), /Unknown render option "finale"; the options are draft, workers, poster, final/);
});

test('a final render is refused for a placeholder (flag and tag) and for an unlicensed upload, naming each; drafts and normal renders go ahead', async () => {
  const bare = await up('name=unlicensed.png', png('#445566'));
  assert.equal(bare.status, 200);
  await library.addFileAsset({ slug: 'stand-in', type: 'image', data: png('#667788'), ext: '.png', description: 'A stand-in image to be replaced later.', author: AUTHOR, provenance: { license: 'original', placeholder: true } });
  await library.addFileAsset({ slug: 'tagged-stand-in', type: 'image', data: png('#778899'), ext: '.png', description: 'An image tagged as a placeholder.', author: AUTHOR, provenance: { license: 'original' }, tags: ['placeholder'] });
  await library.addFileAsset({ slug: 'good-pic', type: 'image', data: png('#889900'), ext: '.png', description: 'An image with a proper licence.', author: AUTHOR, provenance: { license: 'CC0-1.0' } });
  await fresh('refused', ['stand-in', 'tagged-stand-in', 'unlicensed', 'good-pic', 'dot']);

  const refused = async (options) => assert.rejects(Promise.resolve().then(() => studio.renders.enqueue({ clip: 'refused', options })), (/** @type {any} */ e) => { assert.equal(e.code, 'rejected'); return true; });
  await refused({ final: true });
  let message = '';
  try { studio.renders.enqueue({ clip: 'refused', options: { final: true } }); } catch (e) { message = e.message; }
  assert.match(message, /A final render of "refused" is refused: 3 assets in it are not ready\./);
  assert.match(message, /stand-in@1 \(image\) is marked as a placeholder: replace it .*placeholder: false/);
  assert.match(message, /tagged-stand-in@1 \(image\) is tagged "placeholder": replace it.*remove_tags: \["placeholder"\]/);
  assert.match(message, /unlicensed@1 \(image\) has no licence: say what it is under with set_asset_metadata \{ name: "unlicensed", version: 1, provenance: \{ license:/);
  assert.ok(!/good-pic|dot@1/.test(message), 'what is fine is not named');
  assert.match(message, /Drafts and normal renders are not checked/);
  // the same through HTTP: 422 with the message
  const http = await call('/api/clips/refused/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ final: true }) });
  assert.equal(http.status, 422);
  assert.match(http.body.error, /unlicensed@1 \(image\) has no licence/);
  assert.equal(studio.renders.list({ clip: 'refused' }).length, 0, 'nothing was queued');
  // draft and final together
  const both = await call('/api/clips/refused/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ final: true, draft: true }) });
  assert.equal(both.status, 400);
  assert.match(both.body.error, /both a draft and final/);
  // check_provenance lists them without rendering
  const check = studio.provenance.check({ clip: 'refused' });
  assert.equal(check.ready, false);
  assert.deepEqual(check.problems.map((p) => `${p.ref}:${p.problem}`).sort(), ['stand-in@1:placeholder', 'tagged-stand-in@1:placeholder', 'unlicensed@1:no-license']);

  // a draft and a normal render are not checked (an animatic may use placeholders)
  const draft = await studio.renders.wait(studio.renders.enqueue({ clip: 'refused', options: { draft: true } }).id, 120000);
  assert.equal(draft.status, 'done', draft.error);
  const normal = await studio.renders.wait(studio.renders.enqueue({ clip: 'refused' }).id, 120000);
  assert.equal(normal.status, 'done', normal.error);
  assert.equal(normal.options.final, undefined);
  assert.equal(normal.stats.files.credits, undefined, 'only a final render writes the credits');

  // fix them one by one: each reason is cleared by what the message says
  library.setMetadata({ slug: 'stand-in', author: AUTHOR, provenance: { placeholder: false } });
  library.bulk({ slugs: ['tagged-stand-in'], removeTags: ['placeholder'], addTags: ['stand-in'], author: AUTHOR });
  assert.deepEqual(studio.provenance.check({ clip: 'refused' }).problems.map((p) => p.ref), ['unlicensed@1']);
  library.setMetadata({ slug: 'unlicensed', author: AUTHOR, provenance: { license: 'original', creator: 'The studio' } });
  assert.equal(studio.provenance.check({ clip: 'refused' }).ready, true);
});

test('a final render that passes writes the credits next to the MP4 and keeps final in its options', async () => {
  const r = await studio.renders.wait(studio.renders.enqueue({ clip: 'credited', options: { final: true } }).id, 180000);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.options.final, true);
  assert.equal(r.stats.files.credits, r.output.replace(/\.mp4$/, '.credits.md'));
  const file = join(t.dataDir, r.stats.files.credits);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8'), studio.provenance.credits({ clip: 'credited', format: 'markdown' }).markdown);
  // served like the other files of a render
  const served = await call(`/media/${r.stats.files.credits}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /text\/markdown/);
  // a later change to the clip does not change what the render credits: it reads the assets the render was queued with
  const again = studio.provenance.credits({ clip: 'credited', renderId: r.id });
  assert.deepEqual(again.credits, studio.provenance.credits({ clip: 'credited' }).credits);
  // a render queued final and flagged before it starts fails with the message, without drawing a frame
  const queued = studio.renders.enqueue({ clip: 'credited', options: { final: true } });
  library.setMetadata({ slug: 'tour', author: AUTHOR, provenance: { placeholder: true } });
  const failed = await studio.renders.wait(queued.id, 120000);
  library.setMetadata({ slug: 'tour', author: AUTHOR, provenance: { placeholder: false } });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /tour@1 \(video\) is marked as a placeholder/);
});

// ---- MCP over stdio ---------------------------------------------------------------------------------------

test('MCP over stdio: provenance on the file tools, set_asset_metadata, clip_credits, check_provenance and start_render { final: true }', async () => {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-provenance-mcp-'));
  const seed = createStudio({ dataDir, role: 'test' });
  await seedAssets(seed);
  await seed.close();
  const client = await connect({ dataDir, author: 'provenance-test' });
  const call = (name, args) => callTool(client, name, args);
  const photo = join(tmp, 'mcp-photo.png');
  writeFileSync(photo, png('#3366cc'));
  try {
    const { tools } = await client.listTools();
    for (const n of ['clip_credits', 'check_provenance']) assert.ok(tools.some((x) => x.name === n), `missing ${n}`);
    const props = (n) => Object.keys(tools.find((x) => x.name === n).inputSchema.properties);
    for (const n of ['add_file_asset', 'upload_image', 'add_narration', 'add_footage', 'add_font']) {
      for (const k of ['license', 'license_url', 'source_url', 'creator', 'credit', 'date', 'ai_generated', 'content_id', 'restrictions', 'placeholder', 'redistributable']) assert.ok(props(n).includes(k), `${n} takes ${k}`);
    }
    assert.ok(props('set_asset_metadata').includes('provenance') && props('set_asset_metadata').includes('version'));
    assert.ok(props('start_render').includes('final'));
    assert.deepEqual(tools.find((x) => x.name === 'add_font').inputSchema.required.sort(), ['license', 'name', 'path']);

    const added = await call('add_file_asset', { name: 'mcp-photo', type: 'image', path: photo, description: 'A blue photo added over MCP.', creator: 'Jane Doe', source_url: 'https://example.test/p', ai_generated: true });
    assert.ok(!added.isError, added.text);
    assert.deepEqual([added.json.provenance.license, added.json.provenance.creator, added.json.provenance.aiGenerated], [null, 'Jane Doe', true]);
    const badAdd = await call('add_file_asset', { name: 'mcp-bad', type: 'image', path: photo, description: 'A photo with a bad source address.', source_url: 'ftp://nope' });
    assert.ok(badAdd.isError);
    assert.match(badAdd.text, /sourceUrl must be a web address/);
    const upl = await call('upload_image', { path: photo, name: 'other.png', license: 'CC0-1.0', credit: 'Blue by nobody' });
    assert.ok(!upl.isError, upl.text);
    assert.equal(upl.json.duplicate, false);
    assert.equal(upl.json.provenance.license, 'CC0-1.0');

    const clip = await call('create_clip', { name: 'mcp-credits', format: 'horizontal', fps: 10, duration: 1, composition: { width: 240, height: 136, fps: 10, duration: 1, background: '#000000', tracks: [{ id: 'v', type: 'visual', items: [{ id: 'p', asset: 'mcp-photo', start: 0, duration: 1 }, { id: 'o', asset: 'other', start: 0, duration: 1, transform: { x: 0.5, y: 0, width: 0.3, height: 0.3 } }] }] } });
    assert.ok(!clip.isError, clip.text);

    const check = await call('check_provenance', { clip: 'mcp-credits' });
    assert.equal(check.json.ready, false);
    assert.deepEqual(check.json.problems.map((p) => `${p.ref}:${p.problem}`), ['mcp-photo@1:no-license']);
    const refused = await call('start_render', { clip: 'mcp-credits', final: true });
    assert.ok(refused.isError);
    assert.match(refused.text, /A final render of "mcp-credits" is refused: 1 asset in it is not ready\./);
    assert.match(refused.text, /mcp-photo@1 \(image\) has no licence/);
    const both = await call('start_render', { clip: 'mcp-credits', final: true, draft: true });
    assert.ok(both.isError);
    assert.match(both.text, /both a draft and final/);
    const draft = await call('start_render', { clip: 'mcp-credits', draft: true, wait_seconds: 120 });
    assert.ok(!draft.isError, draft.text);
    assert.equal(draft.json.status, 'done');

    const fixed = await call('set_asset_metadata', { name: 'mcp-photo', provenance: { license: 'CC-BY-4.0', credit: 'Photo: Jane Doe', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' } });
    assert.ok(!fixed.isError, fixed.text);
    assert.equal(fixed.json.provenance.license, 'CC-BY-4.0');
    assert.equal(fixed.json.provenanceEdit.by, 'provenance-test');
    const got = await call('get_asset', { ref: 'mcp-photo', include_source: false });
    assert.equal(got.json.provenance.edit.by, 'provenance-test');
    assert.equal(got.json.versions.length, 1);
    const badEdit = await call('set_asset_metadata', { name: 'mcp-photo', provenance: { date: 'whenever' } });
    assert.ok(badEdit.isError);
    assert.match(badEdit.text, /date must be an ISO date/);
    assert.ok((await call('set_asset_metadata', { name: 'dot', provenance: { license: 'original' } })).isError);

    const credits = await call('clip_credits', { clip: 'mcp-credits', format: 'markdown' });
    assert.ok(!credits.isError, credits.text);
    assert.match(credits.text, /^# Credits and sources: mcp-credits$/m);
    assert.deepEqual(credits.json.problems, []);
    assert.ok(credits.json.credits.includes('Photo: Jane Doe'));
    assert.ok(credits.json.sources.some((s) => s.ref === 'mcp-photo@1' && s.aiGenerated === true && s.license === 'CC-BY-4.0'));
    const plain = await call('clip_credits', { clip: 'mcp-credits' });
    assert.deepEqual(Object.keys(plain.json).sort(), ['credits', 'problems', 'sources', 'warnings']);
    assert.ok((await call('clip_credits', { clip: 'nope' })).isError);

    const ok = await call('check_provenance', { clip: 'mcp-credits' });
    assert.equal(ok.json.ready, true);
    const final = await call('start_render', { clip: 'mcp-credits', final: true, wait_seconds: 180 });
    assert.ok(!final.isError, final.text);
    assert.equal(final.json.status, 'done', final.json.error);
    assert.equal(final.json.options.final, true);
    assert.match(final.json.stats.files.credits, /^renders\/mcp-credits-r\d+\.credits\.md$/);
    const md = readFileSync(join(dataDir, final.json.stats.files.credits), 'utf8');
    assert.match(md, /Photo: Jane Doe/);
    assert.match(md, /## AI-generated material/);
  } finally {
    await client.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
