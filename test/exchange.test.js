// Repo and library agree: a clip is exported to a folder with its closure (every pinned version at its number, presets,
// precomps, uploads, a narration, footage, an uploaded font, a baked sequence) and imported into an empty library with
// the same refs, the same sparse version numbers and the same frames. Conflicts and missing files stop an import before
// anything is written. See src/studio/exchange.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { tempStudio, EASING, DOT, LABEL } from './helpers.js';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';
import { encodeWav } from '../src/render/wav.js';
import { createStudioServer } from '../src/server/http.js';
import { connect, callTool } from '../scripts/mcp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUTHOR = 'exchange-test';
const tmp = (prefix) => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const COLORS = { 1: '#ff3366', 2: '#33aaff', 3: '#99dd33' };

/** The same square with a colour that depends on the version: three versions of one asset, the clip pins the middle one. */
const FOO = (n) => `asset({
  description: 'A rectangle that grows across the frame, version ${n}, for the exchange tests.',
  tags: ['exchange', 'test'],
  duration: 2,
  uses: ['easing'],
  params: { color: { type: 'color', default: '${COLORS[n]}' } },
  render(f, p) {
    const k = f.use('easing').outCubic(f.progress);
    f.ctx.fillStyle = p.color;
    f.ctx.fillRect(0, 0, f.width * (0.2 + 0.6 * k), f.height);
  },
});`;

const TEXT = `asset({
  description: 'A line of text in the chosen font, for the exchange tests.',
  tags: ['text', 'test'],
  duration: 2,
  params: { text: { type: 'string', default: 'Hello' }, font: { type: 'font', default: 'Inter' } },
  render(f, p) {
    const L = f.lib.text.layout(f.ctx, p.text, { font: p.font, weight: 400, size: f.height * 0.4, maxWidth: f.safe.width, fit: true, align: 'center' });
    f.ctx.fillStyle = '#ffffff';
    f.lib.text.fill(f.ctx, L, f.safe.x, (f.height - L.height) / 2);
  },
});`;

const WORDS = ['Both', 'sides', 'agree'];
const TIMES = [[0.2, 0.5], [0.6, 1.0], [1.1, 1.6]];

/** Every file under a folder with a hash of its content and its modification time: what an export must not disturb. */
function snapshot(root) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(root, p).replace(/\\/g, '/')] = `${sha(readFileSync(p))} ${statSync(p).mtimeMs}`;
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** The studio's own view of a library: refs of every version, so two libraries can be compared. */
const versionsOf = (studio) => studio.db.prepare('SELECT a.slug, v.version FROM asset_versions v JOIN assets a ON a.id = v.asset_id ORDER BY a.slug, v.version').all().map((r) => `${r.slug}@${r.version}`);
/** The fonts every library starts with: they are in a closure as listings only. */
const notBundled = (ref) => !/^font-(anton|inter|jetbrains-mono|playfair-display|space-grotesk)@/.test(ref);
const refused = (promise, re) => assert.rejects(promise, (/** @type {any} */ e) => { assert.equal(e.name, 'StudioError'); assert.match(e.message, re); return true; });

let A, root, comp, extComp, secretPng, footagePath, clipFolder;
const toClean = [];

before(async () => {
  A = tempStudio();
  const { studio } = A;
  const lib = studio.library;
  const work = tmp('exchange-src-');
  toClean.push(work);
  await studio.clips.createClip({ slug: 'exch-clip', title: 'Exchange', description: 'A clip that uses everything a clip can use.', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  await studio.clips.createClip({ slug: 'exch-src', title: 'Source of a precomp', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  const forClip = 'exch-clip';
  await lib.createAsset({ slug: 'easing', source: EASING, author: AUTHOR, forClip });
  // three versions of foo: the clip pins the middle one, so an import has foo@2 and neither of its neighbours
  await lib.createAsset({ slug: 'foo', source: FOO(1), author: AUTHOR, forClip });
  await lib.updateAsset({ slug: 'foo', source: FOO(2), author: AUTHOR, forClip, note: 'the one the clip pins' });
  await lib.updateAsset({ slug: 'foo', source: FOO(3), author: AUTHOR, note: 'newer than the clip' });
  await lib.createAsset({ slug: 'exch-text', source: TEXT, author: AUTHOR, forClip });
  // a preset (of foo@2) and a precomp (made from another clip's layers)
  await lib.createPreset({ base: 'foo@2', slug: 'foo-warm', params: { color: '#ff8800' }, author: AUTHOR, forClip });
  await studio.clips.updateClip('exch-src', { composition: { width: 320, height: 180, fps: 10, duration: 2, background: '#000000', tracks: [{ id: 'v', type: 'visual', items: [
    { id: 'pc1', asset: 'foo@2', start: 0, duration: 2, transform: { x: 0, y: 0, width: 0.5, height: 1 } },
    { id: 'pc2', asset: 'foo@2', start: 0, duration: 2, params: { color: '#ffffff' }, transform: { x: 0.5, y: 0, width: 0.5, height: 1 } },
  ] }] } });
  await studio.clips.savePrecomp({ clip: 'exch-src', items: ['pc1', 'pc2'], slug: 'pair-card', author: AUTHOR });
  // an image upload (with an uploaded SVG's sidecar next to it), and one that may not be redistributed
  const png = (color) => { const c = createCanvas(48, 32); const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 48, 32); g.fillStyle = '#ffffff'; g.fillRect(4, 4, 20, 8); return c.toBuffer('image/png'); };
  await lib.addFileAsset({ slug: 'exch-logo', type: 'image', data: png('#aa2255'), ext: '.png', description: 'A small test logo made of two rectangles.', tags: ['logo'], author: AUTHOR, forClip, license: 'original', sidecar: { ext: '.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="#aa2255"/></svg>') } });
  secretPng = png('#2255aa');
  await lib.addFileAsset({ slug: 'exch-secret', type: 'image', data: secretPng, ext: '.png', description: 'A licensed picture that may not be redistributed.', tags: ['photo'], author: AUTHOR, provenance: { license: 'CC-BY-4.0', sourceUrl: 'https://example.com/photos/secret', creator: 'A. Photographer', redistributable: false } });
  // a narration: a recording, its script and its word times
  const SR = 48000, left = new Float32Array(SR * 2);
  for (const [a, b] of TIMES) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) left[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / SR);
  writeFileSync(join(work, 'voice.wav'), encodeWav(left, left, SR));
  await studio.audio.addNarration({ slug: 'exch-vo', path: join(work, 'voice.wav'), script: WORDS.join(' '), timings: WORDS.map((text, i) => ({ text, start: TIMES[i][0], end: TIMES[i][1] })), author: AUTHOR, forClip, license: 'original', voice: { name: 'test tone', license: 'original' } });
  // footage: FFmpeg's test pattern with a tone
  footagePath = join(work, 'testsrc.mp4');
  const r = await run(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', footagePath]);
  assert.equal(r.code, 0, r.stderr);
  await lib.addFootage({ slug: 'exch-footage', path: footagePath, description: 'One second of testsrc2 with a 440 Hz tone, made by FFmpeg.', author: AUTHOR, forClip, license: 'original' });
  // an uploaded font
  await studio.fonts.addFont({ name: 'fixture-blocks', path: join(here, 'fixtures', 'fonts', 'fixture-blocks-regular.ttf'), license: 'CC0-1.0', author: AUTHOR });
  // a baked sequence of foo@2
  await studio.bakeSequence({ ref: 'foo@2', slug: 'exch-seq', width: 64, height: 36, fps: 5, duration: 1, author: AUTHOR, forClip });

  comp = {
    width: 320, height: 180, fps: 10, duration: 2, background: '#101018',
    tracks: [
      { id: 'bg', type: 'visual', items: [
        { id: 'a', asset: 'foo@2', start: 0, duration: 2, transform: { x: 0, y: 0, width: 0.5, height: 0.5 } },
        { id: 'warm', asset: 'foo-warm', start: 0, duration: 2, transform: { x: 0.5, y: 0, width: 0.5, height: 0.5 } },
        { id: 'pair', asset: 'pair-card', start: 0, duration: 2, transform: { x: 0, y: 0.5, width: 0.3, height: 0.5 } },
        { id: 'logo', asset: 'exch-logo', start: 0, duration: 2, transform: { x: 0.3, y: 0.5, width: 0.2, height: 0.25 } },
        { id: 'seq', asset: 'exch-seq', start: 0, duration: 2, params: { loop: true }, transform: { x: 0.5, y: 0.5, width: 0.2, height: 0.25 } },
        { id: 'vid', asset: 'exch-footage', start: 0, duration: 1, params: { fit: 'cover' }, transform: { x: 0.7, y: 0.5, width: 0.3, height: 0.5 } },
      ] },
      { id: 'txt', type: 'text', items: [
        { id: 'title', asset: 'exch-text', start: 0, duration: 2, params: { text: 'Hello ăș', font: 'Fixture Blocks' }, transform: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 } },
        { id: 'sub', asset: 'exch-text', start: 0, duration: 2, params: { text: 'Inter', font: 'Inter' }, transform: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 } },
      ] },
      { id: 'voice', type: 'audio', role: 'narration', items: [{ id: 'vo', asset: 'exch-vo', start: 0, duration: 2 }] },
    ],
  };
  await studio.clips.updateClip('exch-clip', { composition: comp });
  extComp = { width: 320, height: 180, fps: 10, duration: 2, background: '#000000', tracks: [{ id: 'v', type: 'visual', items: [{ id: 'photo', asset: 'exch-secret', start: 0, duration: 2, params: { fit: 'cover' } }] }] };
  await studio.clips.createClip({ slug: 'exch-ext', title: 'Exchange, an external file', author: AUTHOR, composition: extComp });

  root = tmp('exchange-repo-');
  toClean.push(root);
  process.env.STUDIO_REPO = root;
  clipFolder = join(root, 'clips', 'exch-clip');
});
after(async () => {
  delete process.env.STUDIO_REPO;
  await A.cleanup();
  for (const d of toClean) try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold a file */ }
});

/** A new empty library: its studio and data dir are cleaned up at the end. */
function emptyLibrary() {
  const t = tempStudio();
  toClean.push(t.dataDir);
  after(() => t.cleanup());
  return t.studio;
}

test('an export writes the clip folder and a content store: versions by ref, sources, files by SHA-256', async () => {
  const dry = await A.studio.exchange.status('exch-clip');
  assert.equal(dry.upToDate, false);
  assert.ok(dry.new.includes('clips/exch-clip/clip.json'));
  assert.deepEqual(snapshot(root), {}, 'a dry run writes nothing');

  const r = await A.studio.exchange.exportClip('exch-clip', { root });
  assert.equal(r.folder, clipFolder);
  assert.deepEqual(r.conflicts, []);
  const doc = JSON.parse(readFileSync(join(clipFolder, 'clip.json'), 'utf8'));
  assert.deepEqual(Object.keys(doc), ['slug', 'title', 'description', 'format', 'width', 'height', 'fps', 'duration', 'composition', 'closure', 'files', 'check']);
  assert.deepEqual(doc.composition, A.studio.clips.getClip('exch-clip').composition, 'the composition is the one saved, refs pinned');
  assert.equal(doc.composition.tracks[0].items[0].asset, 'foo@2');
  // the closure: what the clip pins, its dependencies, the font it names (the bundled Inter is the default of the text asset's other uses)
  for (const ref of ['foo@2', 'easing@1', 'foo-warm@1', 'pair-card@1', 'exch-logo@1', 'exch-seq@1', 'exch-footage@1', 'exch-vo@1', 'exch-text@1', 'fixture-blocks@1']) assert.ok(doc.closure.includes(ref), `closure has ${ref}`);
  assert.ok(!doc.closure.includes('foo@1') && !doc.closure.includes('foo@3'), 'the versions the clip does not pin stay out');
  // a baked sequence goes as its recipe: no frames in the store
  assert.ok(!doc.files.some((f) => f.ref === 'exch-seq@1'));
  const seq = JSON.parse(readFileSync(join(root, 'library', 'versions', 'exch-seq@1.json'), 'utf8'));
  assert.deepEqual([seq.meta.bakedFrom, seq.meta.frames, seq.meta.fps, seq.meta.width], ['foo@2', 5, 5, 64]);
  assert.equal(seq.meta.bakeSeconds, undefined, 'nothing machine-dependent in the record');
  // function sources are files of their own; files are kept by SHA-256
  assert.equal(readFileSync(join(root, 'library', 'sources', 'foo@2.js'), 'utf8'), FOO(2));
  assert.ok(!existsSync(join(root, 'library', 'versions', 'foo@1.json')));
  for (const f of doc.files.filter((x) => x.store === 'repo')) {
    const p = join(root, 'library', 'files', `${f.sha256}.${f.ext}`);
    assert.equal(sha(readFileSync(p)), f.sha256);
    assert.equal(statSync(p).size, f.bytes);
  }
  const kinds = new Set(doc.files.filter((x) => x.store === 'repo').map((x) => x.ext));
  for (const ext of ['png', 'svg', 'wav', 'mp4', 'ttf']) assert.ok(kinds.has(ext), `a .${ext} file is kept`);
  assert.equal(doc.check.machine, `${process.platform}-${process.arch}`);
  assert.equal(Object.keys(doc.check.frames).length, 20, 'every frame of a 2 s clip at 10 fps (at most 48)');
  const inter = doc.files.find((f) => f.store === 'bundled');
  assert.ok(inter && doc.closure.includes(inter.ref) && inter.family === 'Inter', 'a bundled font is listed, never copied');
  assert.ok(!existsSync(join(root, 'library', 'versions', `${inter.ref}.json`)));
  assert.ok(!JSON.stringify(doc).match(/\d{4}-\d{2}-\d{2}T/), 'no timestamps in clip.json');
  // the version record says what is needed to make it again
  const foo = JSON.parse(readFileSync(join(root, 'library', 'versions', 'foo@2.json'), 'utf8'));
  assert.deepEqual([foo.ref, foo.type, foo.kind, foo.author, foo.note, foo.parent, foo.madeForClip], ['foo@2', 'function', 'visual', AUTHOR, 'the one the clip pins', 'foo@1', 'exch-clip']);
  assert.deepEqual(foo.deps, { easing: 'easing@1' });
  assert.match(foo.hash, /^[0-9a-f]{64}$/);
  const warm = JSON.parse(readFileSync(join(root, 'library', 'versions', 'foo-warm@1.json'), 'utf8'));
  assert.deepEqual([warm.asset.derivation, warm.asset.forkedFrom, warm.parent], ['preset', 'foo@2', 'foo@2']);
});

test('importing into an empty library gives the same refs, sparse version numbers, thumbnails and the same frames', async () => {
  const B = emptyLibrary();
  const r = await B.exchange.importClip(clipFolder, { verify: true });
  assert.equal(r.clip, 'exch-clip');
  assert.equal(r.verify.checked, 20);
  assert.deepEqual(r.verify.differ, [], 'the frames hash the same');
  assert.deepEqual(r.verify.machine.same, true);
  assert.deepEqual(r.rebaked, ['exch-seq@1']);
  // same composition JSON, so the same refs
  assert.deepEqual(B.clips.getClip('exch-clip').composition, A.studio.clips.getClip('exch-clip').composition);
  assert.equal(B.clips.getClip('exch-clip').title, 'Exchange');
  // sparse: foo@2 without foo@1 and foo@3; latest is the highest present
  const foo = B.library.getAsset('foo');
  assert.deepEqual(foo.versions.map((v) => v.version), [2]);
  assert.equal(foo.latestVersion, 2);
  assert.equal(foo.parentVersion, null, 'foo@1 is not here to be the parent');
  assert.equal(foo.madeForClip, 'exch-clip');
  assert.equal(foo.note, 'the one the clip pins');
  assert.equal(foo.source, FOO(2));
  // lineage survives where both ends are here
  const warm = B.library.getAsset('foo-warm');
  assert.deepEqual([warm.derivation, warm.forkedFrom], ['preset', 'foo@2']);
  assert.equal(B.library.getAsset('exch-seq').forkedFrom, 'foo@2');
  // every version of the source's closure is there with its number, and nothing else
  const want = new Set(JSON.parse(readFileSync(join(clipFolder, 'clip.json'), 'utf8')).closure);
  assert.deepEqual(versionsOf(B).filter(notBundled).sort(), [...want].filter(notBundled).sort());
  // the files, thumbnails, filmstrips and waveform are made
  for (const ref of ['foo@2', 'easing@1', 'foo-warm@1', 'pair-card@1', 'exch-text@1', 'exch-logo@1', 'exch-footage@1', 'fixture-blocks@1', 'exch-seq@1']) {
    const a = B.library.getAsset(ref);
    assert.ok(a.thumb && existsSync(join(B.dataDir, a.thumb)), `${ref} has a thumbnail`);
  }
  const vid = B.library.getAsset('exch-footage');
  assert.ok(existsSync(join(B.dataDir, vid.meta.strip.file)) && existsSync(join(B.dataDir, vid.meta.wave.file)), 'filmstrip and waveform');
  assert.ok(existsSync(join(B.dataDir, B.library.getAsset('foo').strip)), 'the hover filmstrip of a function');
  assert.equal(sha(readFileSync(join(B.dataDir, vid.file))), A.studio.library.getAsset('exch-footage').meta.sha256, 'the footage is the same file');
  const logo = B.library.getAsset('exch-logo');
  assert.ok(logo.meta.sidecar && existsSync(join(B.dataDir, logo.meta.sidecar)), 'the SVG next to its raster');
  assert.equal(B.library.getAsset('fixture-blocks').meta.family, 'Fixture Blocks');
  assert.equal(readdirSync(join(B.dataDir, B.library.getAsset('exch-seq').file)).length, 5, 'the baked frames');
  assert.deepEqual(B.library.getAsset('exch-vo').meta.narration.words.map((w) => w.text), WORDS);
  // used by the clip as usual
  assert.ok(B.clips.clipAssets('exch-clip').some((x) => x.ref === 'foo@2'));
  // the frames drawn here are the frames drawn there, whatever the library
  const times = [0, 0.5, 1.1, 1.9];
  assert.deepEqual((await B.frameHashes({ clip: 'exch-clip', times })).map((h) => h.hash), (await A.studio.frameHashes({ clip: 'exch-clip', times })).map((h) => h.hash));
  // an export of the imported clip into a new store has the same content: the same hashes, the same composition and frames
  // (what a version continues from, or was made for, is history the importing library does not have: the store keeps it)
  const root2 = tmp('exchange-again-');
  toClean.push(root2);
  await B.exchange.exportClip('exch-clip', { root: root2 });
  const all = (r) => Object.fromEntries(readdirSync(join(r, 'library', 'versions')).map((n) => [n, JSON.parse(readFileSync(join(r, 'library', 'versions', n), 'utf8')).hash]));
  assert.deepEqual(all(root2), all(root));
  assert.deepEqual(JSON.parse(readFileSync(join(root2, 'clips', 'exch-clip', 'clip.json'), 'utf8')), JSON.parse(readFileSync(join(clipFolder, 'clip.json'), 'utf8')));
  // and into the store it came from, it changes nothing at all
  assert.deepEqual((await B.exchange.exportClip('exch-clip', { root })).wrote, []);
});

test('importing again reuses what is there; replace updates the clip', async () => {
  const B = emptyLibrary();
  await B.exchange.importClip(clipFolder);
  await refused(B.exchange.importClip(clipFolder), /A clip named "exch-clip" already exists[\s\S]*replace/);
  const again = await B.exchange.importClip(clipFolder, { replace: true });
  assert.equal(again.replaced, true);
  assert.deepEqual(again.versions.created, []);
  assert.ok(again.versions.reused.includes('foo@2') && again.versions.reused.includes('exch-seq@1'));
  assert.equal(B.clips.getClip('exch-clip').revision, 2);
});

test('exporting an unchanged clip changes no file; an edit in the studio is written back by the next export', async () => {
  const before = snapshot(root);
  const again = await A.studio.exchange.exportClip('exch-clip', { root });
  assert.deepEqual(again.wrote, []);
  assert.equal(again.upToDate, true);
  assert.equal(again.check.state, 'current', 'the frames are not drawn again while nothing changed');
  assert.deepEqual(snapshot(root), before, 'no file was touched');
  assert.equal((await A.studio.exchange.status('exch-clip', { root })).upToDate, true);

  // an edit in the studio (the editor, or an accepted proposal, saves like this)
  await A.studio.clips.editClip('exch-clip', [{ op: 'update_item', id: 'title', patch: { params: { text: 'Edited ăș' } } }, { op: 'set', duration: 2.5 }], { by: 'test' });
  const dry = await A.studio.exchange.status('exch-clip', { root });
  assert.equal(dry.upToDate, false);
  assert.deepEqual(dry.new.concat(dry.changed), ['clips/exch-clip/clip.json']);
  assert.deepEqual(snapshot(root), before, 'a dry run still writes nothing');
  const written = await A.studio.exchange.exportClip('exch-clip', { root });
  assert.deepEqual(written.wrote, ['clips/exch-clip/clip.json']);
  const doc = JSON.parse(readFileSync(join(clipFolder, 'clip.json'), 'utf8'));
  assert.equal(doc.composition.tracks[1].items[0].params.text, 'Edited ăș');
  assert.equal(doc.duration, 2.5);
  assert.equal(Object.keys(doc.check.frames).length, 25, 'the check follows the new length');
  // and an import of the edited folder draws the edited frames
  const B = emptyLibrary();
  const r = await B.exchange.importClip(clipFolder, { verify: true });
  assert.deepEqual(r.verify.differ, []);
  assert.equal(B.clips.getClip('exch-clip').composition.tracks[1].items[0].params.text, 'Edited ăș');
});

test('an import into a library with a different foo@2 stops before writing anything and names it', async () => {
  const C = emptyLibrary();
  await C.library.createAsset({ slug: 'easing', source: EASING, author: 'someone-else' });
  await C.library.createAsset({ slug: 'foo', source: FOO(1), author: 'someone-else' });
  await C.library.updateAsset({ slug: 'foo', source: `${FOO(2)}\n// another foo@2`, author: 'someone-else', note: 'a different second version' });
  const before = versionsOf(C);
  await refused(C.exchange.importClip(clipFolder, { verify: true }), /Nothing was imported[\s\S]*foo@2 is already in this library with different content[\s\S]*someone-else[\s\S]*a different second version/);
  assert.deepEqual(versionsOf(C), before, 'no version was added');
  assert.equal(C.db.prepare('SELECT COUNT(*) AS n FROM clips').get().n, 0, 'no clip was made');
  assert.deepEqual(readdirSync(join(C.dataDir, 'files')).filter((f) => f.includes('exch')), [], 'no file was copied');
  assert.equal(C.library.search({ query: 'exch-logo' }).total, 0);
  // the same foo@2, and an asset of another type under a name the export uses
  const D = emptyLibrary();
  await D.library.addFileAsset({ slug: 'foo', type: 'image', data: secretPng, ext: '.png', description: 'An image where the export has a function.', author: AUTHOR, license: 'original' });
  await refused(D.exchange.importClip(clipFolder), /"foo" as a image asset/);
});

test('an external file that is missing is named; the import succeeds when files points at it', async () => {
  const exported = await A.studio.exchange.exportClip('exch-ext', { root });
  assert.equal(exported.external.length, 1);
  const doc = JSON.parse(readFileSync(join(root, 'clips', 'exch-ext', 'clip.json'), 'utf8'));
  const f = doc.files.find((x) => x.ref === 'exch-secret@1');
  assert.deepEqual([f.store, f.sha256, f.bytes, f.license, f.sourceUrl, f.creator], ['external', sha(secretPng), secretPng.length, 'CC-BY-4.0', 'https://example.com/photos/secret', 'A. Photographer']);
  assert.ok(!existsSync(join(root, 'library', 'files', `${f.sha256}.png`)), 'the file is not copied');
  assert.ok(existsSync(join(root, 'library', 'versions', 'exch-secret@1.json')), 'but its record is');

  const E = emptyLibrary();
  await refused(E.exchange.importClip(join(root, 'clips', 'exch-ext')), new RegExp(`exch-secret@1[\\s\\S]*${f.sha256}[\\s\\S]*CC-BY-4\\.0[\\s\\S]*A\\. Photographer[\\s\\S]*https://example\\.com/photos/secret[\\s\\S]*files`));
  assert.equal(E.library.search({ query: 'exch-secret' }).total, 0, 'nothing was written');
  // a folder that holds the file under another name, among others of the same size
  const stash = tmp('exchange-stash-');
  toClean.push(stash);
  mkdirSync(join(stash, 'deeper'), { recursive: true });
  writeFileSync(join(stash, 'deeper', 'renamed-photo.png'), secretPng);
  writeFileSync(join(stash, 'decoy.png'), Buffer.alloc(secretPng.length, 1));
  const ok = await E.exchange.importClip(join(root, 'clips', 'exch-ext'), { files: [stash], verify: true });
  assert.deepEqual(ok.verify.differ, []);
  assert.equal(ok.external, 1);
  assert.equal(sha(readFileSync(join(E.dataDir, E.library.getAsset('exch-secret').file))), sha(secretPng));
  // a file that is not the one listed is refused (the SHA-256 decides, not the name)
  const F = emptyLibrary();
  const wrong = tmp('exchange-wrong-');
  toClean.push(wrong);
  writeFileSync(join(wrong, `${f.sha256}.png`), Buffer.alloc(secretPng.length, 2));
  await refused(F.exchange.importClip(join(root, 'clips', 'exch-ext'), { files: [wrong] }), /is not in the repo/);
});

test('an upload with no licence is external ("licence unknown"); provenance, edited or not, comes back unchanged', async () => {
  const png = (() => { const c = createCanvas(40, 30); const g = c.getContext('2d'); g.fillStyle = '#44aa66'; g.fillRect(0, 0, 40, 30); return c.toBuffer('image/png'); })();
  await A.studio.library.addFileAsset({ slug: 'exch-nolicence', type: 'image', data: png, ext: '.png', description: 'A picture nobody said the licence of.', author: AUTHOR });
  assert.equal(A.studio.library.getAsset('exch-nolicence').meta.provenance.redistributable, false);
  // provenance is mutable metadata of the version: an edit must travel with it
  A.studio.library.setMetadata({ slug: 'exch-nolicence', provenance: { creator: 'Unknown painter', credit: 'Picture: unknown' }, author: AUTHOR });
  await A.studio.clips.createClip({ slug: 'exch-nolicence-clip', title: 'No licence', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 1, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'pic', asset: 'exch-nolicence', start: 0, duration: 1 }] }] } });
  const own = tmp('exchange-nolicence-');
  toClean.push(own);
  const r = await A.studio.exchange.exportClip('exch-nolicence-clip', { root: own });
  assert.equal(r.external.length, 1);
  assert.deepEqual([r.external[0].store, r.external[0].why, r.external[0].license], ['external', 'licence unknown', null]);
  assert.ok(!existsSync(join(own, 'library', 'files', `${r.external[0].sha256}.png`)));
  const rec = JSON.parse(readFileSync(join(own, 'library', 'versions', 'exch-nolicence@1.json'), 'utf8'));
  assert.deepEqual(rec.meta.provenance, A.studio.library.getAsset('exch-nolicence').meta.provenance, 'provenance is in the record as it is');
  assert.equal(rec.files.why, 'licence unknown');
  // the import names it, and with the file it brings the provenance back as it was, edit and all
  const E = emptyLibrary();
  await refused(E.exchange.importClip(join(own, 'clips', 'exch-nolicence-clip')), /exch-nolicence@1[\s\S]*licence unknown/);
  const stash = tmp('exchange-nolicence-files-');
  toClean.push(stash);
  writeFileSync(join(stash, 'x.png'), png);
  await E.exchange.importClip(join(own, 'clips', 'exch-nolicence-clip'), { files: [stash] });
  const back = E.library.getAsset('exch-nolicence').meta, was = A.studio.library.getAsset('exch-nolicence').meta;
  assert.deepEqual(back.provenance, was.provenance);
  assert.deepEqual(back.provenanceEdit, was.provenanceEdit);
  assert.equal(back.provenance.creator, 'Unknown painter');
  // the provenance of the other fixtures survives too (a licence given, a source, a creator)
  const secret = JSON.parse(readFileSync(join(root, 'library', 'versions', 'exch-secret@1.json'), 'utf8'));
  assert.deepEqual(secret.meta.provenance, A.studio.library.getAsset('exch-secret').meta.provenance);
});

test('files over the size limit stay out of the store (listed by SHA-256, like the ones that may not be redistributed)', async () => {
  await A.studio.clips.createClip({ slug: 'exch-limit', title: 'Footage', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 1, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'vid', asset: 'exch-footage', start: 0, duration: 1 }] }] } });
  // 50 MB by default: the footage (a few kilobytes) is kept; with a limit of 1 KB it is listed instead
  const small = tmp('exchange-limit-');
  toClean.push(small);
  const r = await A.studio.exchange.exportClip('exch-limit', { root: small, frames: false, maxFileBytes: 1000 });
  assert.equal(r.external.length, 1);
  assert.deepEqual([r.external[0].ref, r.external[0].ext, r.external[0].store], ['exch-footage@1', 'mp4', 'external']);
  assert.match(r.external[0].why, /larger than/);
  assert.ok(!existsSync(join(small, 'library', 'files', `${r.external[0].sha256}.mp4`)), 'the file is not copied');
  const doc = JSON.parse(readFileSync(join(small, 'clips', 'exch-limit', 'clip.json'), 'utf8'));
  assert.equal(doc.files.find((x) => x.store === 'external').sha256, r.external[0].sha256);
  assert.equal((await A.studio.exchange.status('exch-limit', { root: small })).external.length, 0, 'the default limit is 50 MB');
});

test('a store that lost a record or a file, a hand-edited record and a bad folder are named', async () => {
  const copy = tmp('exchange-broken-');
  toClean.push(copy);
  cpSync(root, copy, { recursive: true });
  const folder = join(copy, 'clips', 'exch-clip');
  // a record gone
  rmSync(join(copy, 'library', 'versions', 'easing@1.json'));
  // a file gone
  const doc = JSON.parse(readFileSync(join(folder, 'clip.json'), 'utf8'));
  const png = doc.files.find((x) => x.ref === 'exch-logo@1' && x.ext === 'png');
  rmSync(join(copy, 'library', 'files', `${png.sha256}.png`));
  // a record edited by hand
  const rec = JSON.parse(readFileSync(join(copy, 'library', 'versions', 'foo@2.json'), 'utf8'));
  writeFileSync(join(copy, 'library', 'versions', 'foo@2.json'), JSON.stringify({ ...rec, deps: { easing: 'easing@9' } }));
  const H = emptyLibrary();
  await refused(H.exchange.importClip(folder), /3 problems[\s\S]*no record of easing@1[\s\S]*foo@2: its record does not match its content hash[\s\S]*no library\/files\/[0-9a-f]{64}\.png/);
  assert.equal(versionsOf(H).filter(notBundled).length, 0);
  await refused(H.exchange.importClip(join(copy, 'clips', 'nope')), /No clip\.json/);
  mkdirSync(join(copy, 'clips', 'empty'));
  writeFileSync(join(copy, 'clips', 'empty', 'clip.json'), '{ nope');
  await refused(H.exchange.importClip(join(copy, 'clips', 'empty')), /not valid JSON/);
  writeFileSync(join(copy, 'clips', 'empty', 'clip.json'), '{"slug":"x"}');
  await refused(H.exchange.importClip(join(copy, 'clips', 'empty')), /not a clip export/);
  // a folder outside any repo with a library/
  const loose = tmp('exchange-loose-');
  toClean.push(loose);
  mkdirSync(join(loose, 'somewhere'));
  writeFileSync(join(loose, 'somewhere', 'clip.json'), JSON.stringify(doc));
  process.env.STUDIO_REPO = loose;
  try { await refused(H.exchange.importClip(join(loose, 'somewhere'), { root: loose }), /No library\/ folder/); } finally { process.env.STUDIO_REPO = root; }
  // the store the folder sits in wins over STUDIO_REPO, and the export refuses a ref the store has with other content
  const other = tmp('exchange-conflict-');
  toClean.push(other);
  const lib = join(other, 'library', 'versions');
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, 'foo@2.json'), JSON.stringify({ ref: 'foo@2', hash: 'f'.repeat(64) }));
  await refused(A.studio.exchange.exportClip('exch-clip', { root: other, frames: false }), /Nothing was written[\s\S]*foo@2 is in the store with different content/);
  assert.ok(!existsSync(join(other, 'clips')), 'nothing was written');
  const forced = await A.studio.exchange.exportClip('exch-clip', { root: other, frames: false, force: true });
  assert.ok(forced.wrote.includes('library/versions/foo@2.json'));
});

test('a version the engine reads differently, and a file that is not the one listed, stop an import with nothing written', async () => {
  const copy = tmp('exchange-engine-');
  toClean.push(copy);
  cpSync(root, copy, { recursive: true });
  const folder = join(copy, 'clips', 'exch-clip');
  // the record says another schema than the source compiles to: the engine of the exporting library read it another way
  const recPath = join(copy, 'library', 'versions', 'foo@2.json');
  const rec = JSON.parse(readFileSync(recPath, 'utf8'));
  rec.schema.color.default = '#000000';
  writeFileSync(recPath, JSON.stringify(rec));
  const H = emptyLibrary();
  await refused(H.exchange.importClip(folder), /foo@2 compiles differently here than in the library that exported it \(schema\)[\s\S]*Nothing was imported/);
  assert.equal(versionsOf(H).filter(notBundled).length, 0, 'nothing was written');
  assert.deepEqual(readdirSync(join(H.dataDir, 'files')), [], 'and no file was left behind');
  assert.deepEqual(readdirSync(join(H.dataDir, 'thumbs')).filter((n) => !n.startsWith('font-')), [], 'nor a thumbnail');
  // a file in the store that is not the file its name says
  rec.schema.color.default = COLORS[2];
  writeFileSync(recPath, JSON.stringify(rec));
  const doc = JSON.parse(readFileSync(join(folder, 'clip.json'), 'utf8'));
  const wav = doc.files.find((x) => x.ref === 'exch-vo@1');
  writeFileSync(join(copy, 'library', 'files', `${wav.sha256}.wav`), Buffer.alloc(wav.bytes, 7));
  await refused(H.exchange.importClip(folder), /exch-vo@1: .* does not hold the file the export lists/);
  assert.equal(versionsOf(H).filter(notBundled).length, 0, 'nothing was written');
  assert.deepEqual(readdirSync(join(H.dataDir, 'files')), [], 'the staged copies were removed');
});

test('HTTP: GET says what an export would write, POST writes it', async () => {
  const server = /** @type {any} */ (createStudioServer(A.studio, { env: { PATH: '' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root3 = tmp('exchange-http-');
  toClean.push(root3);
  const saved = process.env.STUDIO_REPO;
  process.env.STUDIO_REPO = root3;
  try {
    const dry = await (await fetch(`${base}/api/clips/exch-clip/export`)).json();
    assert.equal(dry.upToDate, false);
    assert.ok(dry.new.includes('clips/exch-clip/clip.json'));
    assert.ok(!existsSync(join(root3, 'clips')));
    const done = await fetch(`${base}/api/clips/exch-clip/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frames: false }) });
    assert.equal(done.status, 200);
    const out = await done.json();
    assert.ok(out.wrote.includes('clips/exch-clip/clip.json'));
    assert.ok(existsSync(join(root3, 'clips', 'exch-clip', 'clip.json')));
    const missing = await fetch(`${base}/api/clips/nope-clip/export`, { method: 'POST' });
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /No clip named "nope-clip"/);
  } finally {
    process.env.STUDIO_REPO = saved;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the CLI refuses to run without STUDIO_DATA, and exports and imports with it', () => {
  const script = join(here, '..', 'scripts', 'library.mjs');
  /** @type {Record<string, any>} */
  const env = { ...process.env, STUDIO_REPO: root };
  delete env.STUDIO_DATA;
  const bare = spawnSync(process.execPath, [script, 'export', 'exch-clip'], { env, encoding: 'utf8' });
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /Set STUDIO_DATA/);
  const usage = spawnSync(process.execPath, [script], { env: { ...env, STUDIO_DATA: A.dataDir }, encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage:/);
  const root4 = tmp('exchange-cli-');
  toClean.push(root4);
  const exported = spawnSync(process.execPath, [script, 'export', 'exch-clip', '--data', A.dataDir, '--no-frames'], { env: { ...env, STUDIO_REPO: root4 }, encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok(existsSync(join(root4, 'clips', 'exch-clip', 'clip.json')));
  const dataDir = tmp('exchange-cli-data-');
  toClean.push(dataDir);
  const imported = spawnSync(process.execPath, [script, 'import', join(root4, 'clips', 'exch-clip'), '--verify'], { env: { ...env, STUDIO_DATA: dataDir }, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  const out = JSON.parse(imported.stdout);
  assert.equal(out.clip, 'exch-clip');
  assert.equal(out.verify.checked, 0, 'an export made with --no-frames has no check to verify');
  const failed = spawnSync(process.execPath, [script, 'import', join(root4, 'clips', 'exch-clip')], { env: { ...env, STUDIO_DATA: dataDir }, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /already exists/);
});

test('MCP: export_clip and import_clip over stdio', async () => {
  const mcpRepo = tmp('exchange-mcp-repo-');
  const dataA = tmp('exchange-mcp-a-'), dataB = tmp('exchange-mcp-b-');
  toClean.push(mcpRepo, dataA, dataB);
  const saved = process.env.STUDIO_REPO;
  process.env.STUDIO_REPO = mcpRepo;
  const a = await connect({ dataDir: dataA, author: 'mcp-exchange' });
  const b = await connect({ dataDir: dataB, author: 'mcp-importer' });
  try {
    const tools = (await a.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('export_clip') && tools.includes('import_clip'));
    assert.deepEqual((await a.listTools()).tools.find((t) => t.name === 'import_clip').inputSchema.required, ['folder']);
    assert.ok(!(await callTool(a, 'create_clip', { name: 'mcp-exch', format: 'horizontal', fps: 10, duration: 2 })).isError);
    for (const [name, source] of [['easing', EASING], ['dot', DOT], ['label', LABEL]]) assert.ok(!(await callTool(a, 'create_asset', { name, source, for_clip: 'mcp-exch' })).isError);
    assert.ok(!(await callTool(a, 'update_asset', { name: 'dot', source: DOT.replace('default: 20', 'default: 60'), note: 'bigger' })).isError);
    const saved1 = await callTool(a, 'update_clip', { clip: 'mcp-exch', composition: { width: 320, height: 180, fps: 10, duration: 2, tracks: [
      { id: 'main', type: 'visual', items: [{ id: 'dot', asset: 'dot@2', start: 0, duration: 2 }] },
      { id: 'titles', type: 'text', items: [{ id: 'label', asset: 'label', start: 0.2, duration: 1.8, params: { text: 'Exchanged' } }] },
    ] } });
    assert.ok(!saved1.isError, saved1.text);

    const dry = await callTool(a, 'export_clip', { clip: 'mcp-exch', dry_run: true });
    assert.ok(!dry.isError, dry.text);
    assert.equal(dry.json.upToDate, false);
    assert.ok(!existsSync(join(mcpRepo, 'clips')));
    const out = await callTool(a, 'export_clip', { clip: 'mcp-exch' });
    assert.ok(!out.isError, out.text);
    assert.ok(out.json.wrote.includes('clips/mcp-exch/clip.json') && out.json.wrote.includes('library/sources/dot@2.js'));
    assert.equal(out.json.check.frames, 20);
    assert.equal((await callTool(a, 'export_clip', { clip: 'mcp-exch' })).json.wrote.length, 0, 'unchanged: nothing written');
    assert.ok((await callTool(a, 'export_clip', { clip: 'no-such-clip' })).isError);

    const folder = join(mcpRepo, 'clips', 'mcp-exch');
    const imported = await callTool(b, 'import_clip', { folder, verify: true });
    assert.ok(!imported.isError, imported.text);
    assert.deepEqual(imported.json.verify.differ, []);
    assert.equal(imported.json.verify.checked, 20);
    assert.deepEqual(imported.json.versions.created, ['dot@2', 'easing@1', 'label@1']);
    const got = await callTool(b, 'get_asset', { ref: 'dot' });
    assert.equal(got.json.version, 2);
    assert.equal(got.json.versions.length, 1, 'dot@1 is not in the importing library');
    const hashesA = (await callTool(a, 'frame_hashes', { clip: 'mcp-exch', times: [0.5, 1.5] })).json.frames;
    const hashesB = (await callTool(b, 'frame_hashes', { clip: 'mcp-exch', times: [0.5, 1.5] })).json.frames;
    assert.deepEqual(hashesB, hashesA);
    const twice = await callTool(b, 'import_clip', { folder });
    assert.ok(twice.isError);
    assert.match(twice.text, /already exists/);
    assert.ok((await callTool(b, 'import_clip', { folder: join(mcpRepo, 'clips', 'nothing-here') })).isError);
    assert.ok(!(await callTool(b, 'import_clip', { folder, replace: true })).isError);
  } finally {
    process.env.STUDIO_REPO = saved;
    await a.close();
    await b.close();
    await new Promise((r) => setTimeout(r, 300));
  }
});
