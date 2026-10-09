// check_clip on a clip built to break every rule once: each check finds its issue (with item, time, numbers and a
// still), and a clean clip passes. Plus the overlays in render_clip_frame.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav } from '../src/render/wav.js';
import { tempStudio, seedAssets, AUTHOR } from './helpers.js';
import { CHECKS } from '../src/studio/checks.js';
import { createTools } from '../src/mcp/tools.js';

const TEXT = `asset({
  description: 'A line of text in the middle of its box at a size relative to the box, for check tests.',
  tags: ['text', 'test'],
  params: { text: { type: 'string', default: 'Text' }, size: { type: 'number', default: 0.5, min: 0.01, max: 2 }, color: { type: 'color', default: '#ffffff' } },
  render(f, p) {
    const L = f.lib.text.layout(f.ctx, p.text, { font: 'Inter', weight: 800, size: f.height * p.size });
    f.ctx.fillStyle = p.color;
    f.lib.text.fill(f.ctx, L, (f.width - L.width) / 2, (f.height - L.height) / 2);
  },
});`;
const SPIN = `asset({
  description: 'A box that pulses all the time, so no frame holds still, for check tests.',
  tags: ['test'],
  render(f) { const b = Math.round(128 + 100 * Math.sin(f.t * 8)); f.ctx.fillStyle = 'rgb(' + b + ',' + b + ',' + b + ')'; f.ctx.fillRect(0, 0, f.width, f.height); },
});`;

let env, studio;
before(async () => {
  env = tempStudio();
  studio = env.studio;
  await seedAssets(studio);
  await studio.library.createAsset({ slug: 'text-line', source: TEXT, author: AUTHOR });
  await studio.library.createAsset({ slug: 'spin', source: SPIN, author: AUTHOR });
  await studio.library.updateAsset({ slug: 'easing', source: readFileSync(new URL('../assets/easing.js', import.meta.url), 'utf8'), author: AUTHOR });
  await studio.library.createAsset({ slug: 'text-captions', source: readFileSync(new URL('../assets/text-captions.v2.js', import.meta.url), 'utf8'), author: AUTHOR });
  // a narration whose words come too fast for a page to last 0.8 s
  const SR = 48000, l = new Float32Array(6 * SR);
  for (let i = Math.round(2 * SR); i < Math.round(2.6 * SR); i++) l[i] = 0.2 * Math.sin(i / 20);
  writeFileSync(join(env.dataDir, 'v.wav'), encodeWav(l, l, SR));
  await studio.audio.addNarration({ slug: 'quick', path: join(env.dataDir, 'v.wav'), script: 'Go now. Stop.', timings: [{ word: 'Go', start: 2.0, end: 2.1 }, { word: 'now.', start: 2.12, end: 2.3 }, { word: 'Stop.', start: 4.4, end: 4.6 }], author: AUTHOR });
});
after(() => env.cleanup());

const W = 640, H = 360;
const txt = (id, text, tf, extra = {}) => ({ id, asset: 'text-line', start: extra.start ?? 0.5, duration: extra.duration ?? 5.5, params: { text, size: extra.size ?? 0.5, color: extra.color ?? '#ffffff' }, transform: tf });

const bad = () => ({
  width: W, height: H, fps: 10, duration: 6, background: '#000000',
  // one page, one line, for words that need two at 8 characters a line: a caption rule break
  captions: { maxChars: 8, pages: [{ start: 'vo:0', lines: [] }] },
  tracks: [
    { id: 'motion', type: 'visual', items: [{ id: 'spinner', asset: 'spin', start: 0.5, duration: 5.5, transform: { x: 0.12, y: 0.5, width: 0.2, height: 0.3 } }] },
    { id: 'titles', type: 'text', items: [
      txt('edge', 'Edge', { x: 0.2, y: 0.04, width: 0.2, height: 0.08 }),
      txt('off', 'Offscreen', { x: 0.98, y: 0.3, width: 0.3, height: 0.1 }),
      txt('a', 'Overlap', { x: 0.3, y: 0.35, width: 0.25, height: 0.1 }),
      txt('b', 'Overlap', { x: 0.35, y: 0.37, width: 0.25, height: 0.1 }),
      txt('lane', 'Laner', { x: 0.75, y: 0.84, width: 0.2, height: 0.08 }),
      txt('tiny', 'tiny text here', { x: 0.5, y: 0.6, width: 0.3, height: 0.04 }, { size: 0.5 }),
      txt('dim', 'Dark', { x: 0.75, y: 0.6, width: 0.2, height: 0.1 }, { color: '#222222' }),
      txt('quick', 'six words are far too quick', { x: 0.25, y: 0.7, width: 0.4, height: 0.08 }, { start: 2, duration: 0.8 }),
      txt('han', '漢字', { x: 0.75, y: 0.25, width: 0.15, height: 0.1 }),
    ] },
    { id: 'caps', type: 'text', role: 'captions', items: [{ id: 'cap', asset: 'text-captions', start: 0, duration: 6 }] },
    { id: 'voice', type: 'audio', role: 'narration', items: [{ id: 'vo', asset: 'quick', start: 0, duration: 6 }] },
  ],
});

test('check_clip finds every class of issue on a clip built to break each rule, each with item, time, numbers and a still', async () => {
  await studio.clips.createClip({ slug: 'bad', author: AUTHOR, composition: bad() });
  const r = await studio.checks.checkClip({ clip: 'bad' });
  const by = (check) => r.issues.filter((i) => i.check === check);
  for (const check of CHECKS) assert.ok(by(check).length >= 1, `check "${check}" found nothing (counts: ${JSON.stringify(r.counts)})`);
  const item = (check, id) => assert.ok(by(check).some((i) => i.item === id), `${check} names ${id}: ${JSON.stringify(by(check).map((i) => i.item))}`);
  item('safe-zone', 'edge');
  item('clipped', 'off');
  item('overlap', 'a');
  item('caption-lane', 'lane');
  item('size', 'tiny');
  item('contrast', 'dim');
  item('hold', 'quick');
  item('glyphs', 'han');
  assert.ok(by('contrast').find((i) => i.item === 'dim').numbers.ratio < 2);
  assert.ok(by('size').find((i) => i.item === 'tiny').numbers.screenPct < 2.5);
  assert.ok(by('captions').some((i) => /short|lines|chars/.test(i.numbers.rule)));
  for (const i of r.issues.slice(0, 40)) {
    assert.ok(Number.isFinite(i.t) && Number.isInteger(i.frame) && i.message && i.numbers, `${i.check} has time, frame, message and numbers`);
    assert.ok(i.still && existsSync(i.still), `${i.check} has a still`);
  }
  // the items that are fine are not named
  for (const i of r.issues) assert.notEqual(i.item, 'spinner');
});

test('check_clip: a clean clip passes; a time range and a subset of checks narrow it', async () => {
  const clean = {
    width: W, height: H, fps: 10, duration: 6, background: '#000000',
    tracks: [{ id: 't', type: 'text', items: [txt('ok', 'Readable', { x: 0.5, y: 0.45, width: 0.5, height: 0.15 }, { start: 0, duration: 6 })] }],
  };
  await studio.clips.createClip({ slug: 'clean', author: AUTHOR, composition: clean });
  const r = await studio.checks.checkClip({ clip: 'clean', stills: false });
  assert.deepEqual(r.issues.map((i) => `${i.check}: ${i.message}`), []);
  const part = await studio.checks.checkClip({ clip: 'bad', from: 1, to: 3, only: ['contrast', 'hold'], stills: false });
  assert.ok(part.issues.every((i) => ['contrast', 'hold'].includes(i.check)));
  assert.ok(part.issues.every((i) => i.t >= 1 && i.t <= 3));
});

test('render_clip_frame overlays: the guides and the measured boxes are drawn on a copy; the frame hash is the frame\'s own', async () => {
  const tools = createTools(studio);
  const call = async (name, args) => { const r = await tools.call(name, args); assert.ok(!r.isError, r.content?.[0]?.text); return JSON.parse(r.content.find((c) => c.type === 'text').text); };
  const plain = await call('render_clip_frame', { clip: 'bad', t: 3 });
  const over = await call('render_clip_frame', { clip: 'bad', t: 3, overlays: true });
  assert.equal(plain.sha256, over.sha256);
  assert.notEqual(readFileSync(plain.png).toString('base64'), readFileSync(over.png).toString('base64'));
  assert.ok(over.texts > 0 && over.zones.lane);
  const some = await call('render_clip_frame', { clip: 'bad', t: 3, overlays: ['lane'] });
  assert.deepEqual(some.overlays, ['lane']);
});

test('contrast: text nearly the colour of its background is measured from its recorded fill, not skipped', async () => {
  const { boxContrast, parseColor } = await import('../src/render/contrast.js');
  const w = 20, h = 10;
  const frame = (v) => { const p = new Uint8Array(w * h * 4); for (let i = 0; i < p.length; i += 4) { p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; } return p; };
  const bg = frame(0x7a), withText = frame(0x7a);
  for (let x = 5; x < 15; x++) { const i = (5 * w + x) * 4; withText[i] = withText[i + 1] = withText[i + 2] = 0x80; }
  const box = { x: 2, y: 2, width: 16, height: 6 };
  assert.equal(boxContrast(withText, bg, w, h, box), null, 'without a fill the change is too small to judge');
  const r = boxContrast(withText, bg, w, h, box, { fill: '#808080' });
  assert.ok(r && r.fromFill && r.ratio < 1.2, `measured from the fill: ${JSON.stringify(r)}`);
  assert.equal(boxContrast(withText, bg, w, h, box, { fill: 'rgba(128, 128, 128, 0.5)' }), null, 'a translucent fill is not a solid colour');
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.equal(parseColor('gradient'), null);
});
