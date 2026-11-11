// The forge: assets made ahead of the clips that use them. A candidate stays out of search and suggestions; check_asset
// runs the clip checks on the asset alone in every format and keeps the result on the version; promotion needs a passing
// check (or force and a reason); a rejection keeps its reason; a clip that uses a candidate promotes it; asset_variants
// draws one asset under several parameter sets as a grid. Through the studio, the MCP tools and the HTTP API.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tempStudio, seedAssets, AUTHOR, LABEL, DOT } from './helpers.js';
import { createTools } from '../src/mcp/tools.js';
import { createStudioServer } from '../src/server/http.js';
import { ASSET_CHECKS, MAX_VARIANTS } from '../src/studio/forge.js';

let env, studio, tools;
before(async () => {
  env = tempStudio();
  studio = env.studio;
  await seedAssets(studio);
  tools = createTools(studio, { author: AUTHOR });
});
after(() => env.cleanup());

const call = async (name, args) => {
  const r = await tools.call(name, args);
  return { error: r.isError ? r.content[0].text : null, json: r.isError ? null : JSON.parse(r.content.find((c) => c.type === 'text').text), images: r.content.filter((c) => c.type === 'image') };
};
const ok = async (name, args) => { const r = await call(name, args); assert.equal(r.error, null, `${name}: ${r.error}`); return r; };

test('a candidate stays out of search and suggestions until it is promoted', async () => {
  const made = await ok('create_asset', { name: 'forge-title', source: LABEL, candidate: true });
  assert.equal(made.json.stage, 'candidate');
  const names = (r) => r.assets.map((a) => a.slug);
  assert.ok(!names(studio.library.search({ query: 'line text fades' })).includes('forge-title'), 'not in the default search');
  assert.ok(names(studio.library.search({ stage: 'candidate' })).includes('forge-title'));
  assert.ok(names(studio.library.search({ stage: 'all', query: 'line text fades' })).includes('forge-title'));
  assert.equal(studio.library.search({ facets: true }).facets.candidates, 1);
  assert.ok(!studio.compounding.suggest({ brief: 'a line of text that fades in' }).suggestions.some((s) => s.ref.startsWith('forge-title')));
  assert.ok(studio.compounding.suggest({ brief: 'a line of text that fades in', candidates: true }).suggestions.some((s) => s.ref === 'forge-title@1' && s.stage === 'candidate'));
  // get_asset still finds it by name, with its stage
  assert.equal(studio.library.getAsset('forge-title').stage, 'candidate');
  // the flag is for a new asset only
  assert.match((await call('create_asset', { name: 'label', source: LABEL, candidate: true })).error, /exists/);
});

test('check_asset: the clip checks on the asset alone in each format, kept on the version', async () => {
  const pass = (await ok('check_asset', { ref: 'forge-title', stills: false })).json;
  assert.equal(pass.pass, true);
  assert.deepEqual(pass.formats.map((f) => f.format), ['vertical', 'horizontal', 'square']);
  assert.deepEqual(pass.checks, ASSET_CHECKS);
  assert.match(pass.next, /promote_asset/);
  assert.equal(studio.library.getAsset('forge-title').checked.pass, true);
  // dark text on the dark ground: a contrast error in every format, with a still
  const fail = (await ok('check_asset', { ref: 'forge-title', params: { color: '#16161f' } })).json;
  assert.equal(fail.pass, false);
  for (const f of fail.formats) {
    assert.ok(f.counts.contrast >= 1, `${f.format}: ${JSON.stringify(f.counts)}`);
    assert.ok(f.issues.every((i) => i.still && existsSync(i.still)));
  }
  // the last check is the one kept
  assert.equal(studio.library.getAsset('forge-title').checked.pass, false);
  // a subset of formats and checks
  const one = (await ok('check_asset', { ref: 'forge-title', formats: ['square'], only: ['contrast'], params: { color: '#16161f' }, stills: false })).json;
  assert.deepEqual(one.formats.map((f) => f.format), ['square']);
  assert.ok(one.formats[0].issues.every((i) => i.check === 'contrast'));
  // what draws nothing on its own is checked in a clip
  assert.match((await call('check_asset', { ref: 'easing' })).error, /value asset.*check_clip/s);
});

test('promotion needs a passing check of the latest version, or force and a reason', async () => {
  await ok('create_asset', { name: 'forge-dim', source: LABEL.replace("default: '#ffffff'", "default: '#17171f'"), candidate: true });
  assert.match((await call('promote_asset', { name: 'forge-dim' })).error, /has not been checked/);
  assert.equal((await ok('check_asset', { ref: 'forge-dim', stills: false })).json.pass, false);
  assert.match((await call('promote_asset', { name: 'forge-dim' })).error, /failed its check/);
  assert.match((await call('promote_asset', { name: 'forge-dim', force: true })).error, /reason/);
  // fixed in a new version: that version is unchecked until it is checked
  await ok('update_asset', { name: 'forge-dim', source: LABEL, note: 'light text' });
  assert.equal(studio.library.getAsset('forge-dim').stage, 'candidate', 'a new version keeps the stage');
  assert.match((await call('promote_asset', { name: 'forge-dim' })).error, /has not been checked/);
  await ok('check_asset', { ref: 'forge-dim', stills: false });
  const p = (await ok('promote_asset', { name: 'forge-dim', reason: 'readable now' })).json;
  assert.equal(p.from, 'candidate');
  assert.equal(p.promoted.stage, undefined, 'in the library');
  assert.ok(studio.library.search({ query: 'forge dim' }).assets.some((a) => a.slug === 'forge-dim'));
  assert.ok(studio.compounding.notesOf('forge-dim').some((n) => /readable now/.test(n.body)));
  assert.match((await call('promote_asset', { name: 'forge-dim' })).error, /in the library already/);
  // a forced promotion keeps why
  await ok('create_asset', { name: 'forge-forced', source: LABEL.replace('Hello', 'Forced'), candidate: true });
  await ok('promote_asset', { name: 'forge-forced', force: true, reason: 'checked by hand in the editor' });
  assert.ok(studio.compounding.notesOf('forge-forced').some((n) => /without a passing check: checked by hand/.test(n.body)));
});

test('a rejection keeps its reason; only a candidate is rejected', async () => {
  await ok('create_asset', { name: 'forge-meh', source: LABEL.replace('Hello', 'Meh'), candidate: true });
  assert.match((await call('reject_asset', { name: 'forge-meh', reason: 'no' })).error, /reason|4/);
  const r = (await ok('reject_asset', { name: 'forge-meh', reason: 'same as label, nothing new' })).json;
  assert.equal(r.rejected.stage, 'rejected');
  assert.ok(!studio.library.search({ stage: 'candidate' }).assets.some((a) => a.slug === 'forge-meh'));
  const listed = (await ok('list_candidates', { stage: 'rejected' })).json;
  assert.ok(listed.candidates.find((c) => c.ref === 'forge-meh@1').notes.some((n) => /nothing new/.test(n)));
  assert.match((await call('reject_asset', { name: 'label', reason: 'library assets are not rejected' })).error, /only a candidate/);
  assert.ok(!studio.compounding.suggest({ brief: 'a line of text that fades in', candidates: true }).suggestions.some((s) => s.ref.startsWith('forge-meh')), 'never suggested');
});

test('a clip that uses a candidate promotes it', async () => {
  await ok('create_asset', { name: 'forge-dot', source: DOT, candidate: true });
  await studio.clips.createClip({ slug: 'uses-forge', author: AUTHOR, composition: { width: 320, height: 180, fps: 10, duration: 2, tracks: [{ id: 'v', type: 'visual', items: [{ id: 'd', asset: 'forge-dot', start: 0, duration: 2 }] }] } });
  assert.equal(studio.library.getAsset('forge-dot').stage, 'library');
});

test('list_candidates: the queue with each one\'s last check and a contact sheet', async () => {
  await ok('create_asset', { name: 'forge-queue', source: LABEL.replace('Hello', 'Queue'), candidate: true });
  const r = await ok('list_candidates', {});
  const q = r.json.candidates.find((c) => c.ref === 'forge-queue@1');
  assert.equal(q.checked, null);
  assert.equal(r.json.candidates.find((c) => c.ref === 'forge-title@1').checked.pass, false);
  assert.equal(r.images.length, 1);
});

test('asset_variants: parameter sets × varied values × seeds, as one labelled grid', async () => {
  const combos = studio.forge.combinations({ variants: [{ text: 'A' }, { params: { text: 'B' }, seed: 3 }], vary: { color: ['#ffffff', '#ff3366'] } });
  assert.equal(combos.length, 4);
  assert.deepEqual(combos[3], { params: { text: 'B', color: '#ff3366' }, seed: 3 });
  assert.equal(studio.forge.combinations({ vary: { text: ['a', 'b'] }, seeds: [1, 2, 3] }).length, 6);
  assert.throws(() => studio.forge.combinations({ vary: { a: [1, 2, 3, 4, 5], b: [1, 2, 3, 4, 5] } }), new RegExp(`at most ${MAX_VARIANTS}`));
  const r = await ok('asset_variants', { ref: 'label', vary: { color: ['#ffffff', '#ff3366', '#00ffaa'] }, frames: 3 });
  assert.equal(r.json.variants.length, 3);
  assert.deepEqual(r.json.variants.map((v) => v.label), ['color #ffffff', 'color #ff3366', 'color #00ffaa']);
  assert.equal(r.json.times.length, 3);
  assert.equal(r.images.length, 1);
  assert.ok(existsSync(r.json.png));
  // one frame each, with seeds
  const one = await ok('asset_variants', { ref: 'dot', seeds: [1, 2], t: 1 });
  assert.deepEqual(one.json.variants.map((v) => v.seed), [1, 2]);
  assert.deepEqual(one.json.times, [1]);
  // a bad parameter names its variant
  assert.match((await call('asset_variants', { ref: 'dot', variants: [{}, { radius: 9999 }] })).error, /Variant 2/);
  assert.match((await call('asset_variants', { ref: 'kick' })).error, /visual assets/);
});

test('HTTP: candidates listed, checked, promoted and rejected', async () => {
  const server = /** @type {any} */ (createStudioServer(studio));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    const made = await post('/api/assets', { name: 'forge-http', source: LABEL.replace('Hello', 'Http'), candidate: true });
    assert.equal(made.status, 200);
    assert.equal(made.body.asset.stage, 'candidate');
    const list = await (await fetch(`${base}/api/assets?candidates=1`)).json();
    assert.ok(list.assets.some((a) => a.slug === 'forge-http'));
    assert.ok(!(await (await fetch(`${base}/api/assets?query=http`)).json()).assets.some((a) => a.slug === 'forge-http'));
    assert.equal((await post('/api/assets/forge-http/promote', {})).status, 400);
    const check = await post('/api/assets/forge-http@1/check', { formats: ['horizontal'], stills: false });
    assert.equal(check.status, 200);
    assert.equal(check.body.pass, true);
    const grid = await post('/api/assets/forge-http/variants', { vary: { text: ['One', 'Two'] }, t: 1 });
    assert.equal(grid.body.variants.length, 2);
    assert.match(grid.body.image, /^data:image\/png;base64,/);
    assert.equal((await post('/api/assets/forge-http/promote', {})).body.asset.stage, 'library');
    await post('/api/assets', { name: 'forge-http-2', source: LABEL.replace('Hello', 'Two'), candidate: true });
    assert.equal((await post('/api/assets/forge-http-2/reject', { reason: 'a duplicate of forge-http' })).body.asset.stage, 'rejected');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
