// The compounding loop: MCP calls logged against the clip they served, build metrics per clip
// (calls, new code, reuse share, build time), suggest_assets, notes and usage examples, and the
// clip theme every asset reads as f.theme.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/mcp/tools.js';
import { createCanvas, loadImage } from '../src/render/host.js';
import { tempStudio, EASING, DOT, LABEL } from './helpers.js';

let t, studio, tools;
const call = async (name, args = {}) => {
  const r = await tools.call(name, args);
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(text);
  let json = null;
  for (const c of r.content) if (c.type === 'text') { try { json = JSON.parse(c.text); } catch { /* prose */ } }
  return { json, text, images: r.content.filter((c) => c.type === 'image') };
};

const THEME = `asset({ kind: 'value', description: 'A theme for tests: an accent colour every asset can read.', tags: ['theme', 'test'], render() { return { accent: '#00ff00', font: 'Inter' }; } });`;
const THEMED = `asset({ description: 'Fills its box with the clip theme accent, or red without a theme.', tags: ['test'], render(f) { f.ctx.fillStyle = f.theme?.accent ?? '#ff0000'; f.ctx.fillRect(0, 0, f.width, f.height); } });`;

before(async () => {
  t = tempStudio();
  studio = t.studio;
  tools = createTools(studio, { author: 'builder' });
});
after(() => t.cleanup());

test('every MCP call is logged against the clip it served; a clip build is measured from first call to render request', async () => {
  await call('create_clip', { name: 'first', format: 'horizontal', fps: 10, duration: 2 });
  for (const [name, source] of [['easing', EASING], ['dot', DOT]]) await call('create_asset', { name, source, for_clip: 'first' });
  await call('search_assets', { query: 'dot' });                       // no clip named: the author's current clip
  await call('update_clip', { clip: 'first', composition: { width: 320, height: 180, fps: 10, duration: 2, tracks: [{ id: 'v', items: [{ id: 'd', asset: 'dot', start: 0, duration: 2 }] }] } });
  await call('start_render', { clip: 'first' });
  await call('get_asset', { ref: 'dot' });                             // after the render request: not in the build window
  const m = studio.compounding.metrics('first');
  assert.equal(m.mcpCalls, 6, JSON.stringify(m.mcpCallsByTool));
  assert.deepEqual(m.newAssets.sort(), ['dot@1', 'easing@1']);
  assert.ok(m.newCodeLines > 20);
  assert.equal(m.reuseShare, 0);
  assert.ok(m.buildSeconds >= 0 && m.buildEnd >= m.buildStart);
  // a second clip reuses dot and adds a preset (generated, counted apart)
  await call('create_clip', { name: 'second', format: 'horizontal', fps: 10, duration: 2 });
  await call('create_preset', { base: 'dot', name: 'dot-big', params: { radius: 80 }, for_clip: 'second' });
  await call('create_asset', { name: 'label', source: LABEL, for_clip: 'second' });
  await call('update_clip', { clip: 'second', composition: { width: 320, height: 180, fps: 10, duration: 2, tracks: [{ id: 'v', items: [{ id: 'd', asset: 'dot', start: 0, duration: 2 }, { id: 'b', asset: 'dot-big', start: 0, duration: 1 }, { id: 'l', asset: 'label', start: 1, duration: 1 }] }] } });
  await call('start_render', { clip: 'second' });
  const n = studio.compounding.metrics('second');
  assert.deepEqual(n.newAssets, ['label@1']);
  assert.deepEqual(n.generatedAssets, ['dot-big@1']);
  assert.equal(n.items, 3);
  assert.equal(n.itemsUsingExisting, 1);
  assert.deepEqual(n.reusedFrom, { first: 1 });
  assert.equal(n.reuseShare, 0.333);
  const report = await call('compounding_report');
  assert.match(report.text, /1 {2}first[\s\S]*2 {2}second/);
});

test('suggest_assets ranks the library against a brief, with a numbered contact sheet', async () => {
  const r = await call('suggest_assets', { brief: 'a dot that slides across, with a label of text' });
  assert.ok(r.json.words.includes('slides') && !r.json.words.includes('that'));
  const refs = r.json.suggestions.map((s) => s.ref);
  assert.ok(refs.includes('dot@1') && refs.includes('label@1'), refs.join(', '));
  assert.ok(r.json.suggestions.find((s) => s.ref === 'dot@1').matched.includes('slides'));
  assert.equal(r.images.length, 1);
  const only = await call('suggest_assets', { brief: 'dot label easing', kinds: ['value'] });
  assert.deepEqual(only.json.suggestions.map((s) => s.ref), ['easing@1']);
  await assert.rejects(call('suggest_assets', { brief: 'the a of' }), /describe what the clip/);
});

test('notes for the next agent and real usage examples show in get_asset', async () => {
  await call('add_asset_note', { name: 'dot', note: 'Looks best with radius 30-60 on dark backgrounds.' });
  const a = await call('get_asset', { ref: 'dot' });
  assert.equal(a.json.notes[0].body, 'Looks best with radius 30-60 on dark backgrounds.');
  assert.equal(a.json.notes[0].author, 'builder');
  assert.ok(a.json.examples.some((x) => x.clip === 'second' && x.item === 'd'));
  assert.ok((await call('suggest_assets', { brief: 'dot radius' })).json.suggestions.find((s) => s.ref === 'dot@1').notes.length === 1);
});

test('a clip theme is pinned and every asset reads it as f.theme', async () => {
  await call('create_asset', { name: 'theme-test', source: THEME });
  await call('create_asset', { name: 'themed', source: THEMED });
  const comp = { width: 160, height: 90, fps: 10, duration: 1, tracks: [{ id: 'v', items: [{ id: 'x', asset: 'themed', start: 0, duration: 1 }] }] };
  const px = async (c) => {
    const img = await loadImage((await studio.clipFrame({ composition: c, t: 0.5 })).png);
    const cv = createCanvas(img.width, img.height);
    cv.getContext('2d').drawImage(img, 0, 0);
    return [...cv.getContext('2d').getImageData(80, 45, 1, 1).data.slice(0, 3)];
  };
  assert.deepEqual(await px(comp), [255, 0, 0], 'no theme: the asset falls back');
  assert.deepEqual(await px({ ...comp, theme: 'theme-test' }), [0, 255, 0], 'with a theme: its accent');
  assert.equal(studio.clips.prepare({ ...comp, theme: 'theme-test' }).composition.theme, 'theme-test@1');
  assert.throws(() => studio.clips.prepare({ ...comp, theme: 'themed' }), /a theme is a value asset/);
});
