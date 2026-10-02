// The MCP server end to end, over stdio, the way Claude Code talks to it: search, create, edit
// into a new version, render a frame to PNG, render a clip to MP4, and reject a broken asset.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, callTool, inlineFiles } from '../scripts/mcp.mjs';
import { EASING, DOT, LABEL, TONE } from './helpers.js';

let client, dataDir;
const call = (name, args) => callTool(client, name, args);

before(async () => {
  dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-mcp-'));
  client = await connect({ dataDir, author: 'mcp-test-model' });
});
after(async () => {
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
});

test('the server lists its tools with schemas', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['studio_guide', 'search_assets', 'get_asset', 'validate_asset', 'create_asset', 'update_asset', 'fork_asset', 'create_clip', 'update_clip', 'edit_clip', 'render_asset_frame', 'render_clip_frame', 'start_render', 'get_render', 'cancel_render', 'list_clip_assets', 'frame_hashes', 'reuse_report']) assert.ok(names.includes(n), `missing tool ${n}`);
  const create = tools.find((t) => t.name === 'create_asset');
  assert.deepEqual(create.inputSchema.required, ['name', 'source']);
  assert.match((await call('studio_guide')).text, /The frame object `f`[\s\S]*Library now/);
});

test('create → search → inspect → edit into a new version → render a frame', async () => {
  const clip = await call('create_clip', { name: 'mcp-demo', title: 'MCP demo', width: undefined, format: 'horizontal', fps: 10, duration: 2 });
  assert.ok(!clip.isError, clip.text);
  for (const [name, source] of [['easing', EASING], ['dot', DOT], ['label', LABEL]]) {
    const r = await call('create_asset', { name, source, for_clip: 'mcp-demo' });
    assert.ok(!r.isError, r.text);
    assert.equal(r.json.created, `${name}@1`);
    assert.equal(r.images.length, 1, 'the thumbnail comes back as an image');
    assert.ok(existsSync(r.json.png));
  }
  const found = await call('search_assets', { query: 'dot slides' });
  assert.equal(found.json.assets[0].ref, 'dot@1');
  assert.equal(found.json.assets[0].author, 'mcp-test-model');
  assert.equal(found.json.assets[0].originClip, 'mcp-demo');
  assert.deepEqual((await call('search_assets', { kind: 'value' })).json.assets.map((a) => a.ref), ['easing@1']);

  const detail = await call('get_asset', { ref: 'dot' });
  assert.match(detail.json.source, /slides from left to right/);
  assert.deepEqual(detail.json.deps, { easing: 'easing@1' });
  assert.equal(detail.json.schema.radius.max, 200);

  const frame1 = await call('render_asset_frame', { ref: 'dot', t: 1, params: { color: '#00ff00' } });
  assert.equal(frame1.images[0].subarray(1, 4).toString(), 'PNG');

  const edited = await call('update_asset', { name: 'dot', note: 'bigger default', source: DOT.replace('default: 20', 'default: 80') });
  assert.equal(edited.json.updated, 'dot@2');
  const frame2 = await call('render_asset_frame', { ref: 'dot@2', t: 1, params: { color: '#00ff00' } });
  const frame1again = await call('render_asset_frame', { ref: 'dot@1', t: 1, params: { color: '#00ff00' } });
  assert.notEqual(frame2.json.sha256, frame1.json.sha256, 'the new version draws differently');
  assert.equal(frame1again.json.sha256, frame1.json.sha256, 'the old version still draws the same');

  const fork = await call('fork_asset', { ref: 'dot@1', name: 'dot-fork' });
  assert.equal(fork.json.forkedFrom, 'dot@1');

  const draft = await call('validate_asset', { source: LABEL.replace("default: 'Hello'", "default: 'Draft'"), name: 'label', frames: 4 });
  assert.ok(!draft.isError, draft.text);
  assert.equal(draft.json.wouldBe, 'label@2');
  assert.equal(draft.images.length, 1);
  assert.equal((await call('get_asset', { ref: 'label' })).json.version, 1, 'validate_asset saves nothing');
});

test('a deliberately broken asset is rejected with a useful error, and the server keeps working', async () => {
  const typo = await call('create_asset', { name: 'broken', source: `asset({ description: 'Calls a canvas method that does not exist.', tags: ['test'],\n  render(f) {\n    f.ctx.fillCircle(10, 10, 5);\n  } });` });
  assert.ok(typo.isError);
  assert.match(typo.text, /rejected[\s\S]*broken@1[\s\S]*fillCircle is not a function[\s\S]*broken@1\.js:3/);
  const loop = await call('create_asset', { name: 'broken', source: `asset({ description: 'Spins forever in render.', tags: ['test'], render() { while (true) {} } });` });
  assert.ok(loop.isError);
  assert.match(loop.text, /Timed out/);
  const impure = await call('create_asset', { name: 'broken', source: `asset({ description: 'Uses wall-clock time.', tags: ['test'], render(f) { f.ctx.globalAlpha = Date.now() % 2; } });` });
  assert.match(impure.text, /line 1: Wall-clock time is not allowed/);
  const badArgs = await client.callTool({ name: 'create_asset', arguments: { name: 'x' } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
  assert.ok(badArgs.isError, 'missing required arguments are refused');
  assert.equal((await call('search_assets', { query: 'broken' })).json.total, 0);
  assert.ok(!(await call('get_asset', { ref: 'dot' })).isError, 'the server still answers');
});

test('compose a clip, look at it, render it to MP4 and list what it used', async () => {
  const composition = {
    width: 320, height: 180, fps: 10, duration: 2, background: '#101018',
    tracks: [
      { id: 'main', type: 'visual', items: [{ id: 'dot', asset: 'dot@1', start: 0, duration: 2 }] },
      { id: 'titles', type: 'text', items: [{ id: 'label', asset: 'label', start: 0.2, duration: 1.8, params: { text: 'From MCP' } }] },
    ],
  };
  const saved = await call('update_clip', { clip: 'mcp-demo', composition });
  assert.ok(!saved.isError, saved.text);
  assert.ok(saved.json.checked.framesChecked >= 3);

  const bad = await call('edit_clip', { clip: 'mcp-demo', operations: [{ op: 'update_item', id: 'dot', patch: { params: { radius: 5000 } } }] });
  assert.ok(bad.isError);
  assert.match(bad.text, /item "dot": params\.radius: 5000 is above the maximum 200/);

  const frame = await call('render_clip_frame', { clip: 'mcp-demo', t: 1 });
  assert.equal(frame.images.length, 1);
  assert.ok(existsSync(frame.json.png));
  const sheet = await call('render_clip_frame', { clip: 'mcp-demo', sheet: true, frames: 6 });
  assert.equal(sheet.json.frames.length, 6);

  const hashes = await call('frame_hashes', { clip: 'mcp-demo', times: [0.5, 1.5] });
  assert.equal(hashes.json.frames.length, 2);

  const started = await call('start_render', { clip: 'mcp-demo' });
  assert.ok(['queued', 'running'].includes(started.json.status), started.text);
  let status;
  for (let i = 0; i < 300; i++) {
    status = (await call('get_render', { id: started.json.id })).json;
    if (['done', 'failed', 'cancelled'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(status.status, 'done', status.error ?? '');
  assert.ok(existsSync(status.output));
  assert.equal(status.stats.probe.video.codec, 'h264');
  assert.equal(status.stats.probe.audio.codec, 'aac');

  // pinning held: the clip uses dot@1 although dot@2 exists
  const used = await call('list_clip_assets', { clip: 'mcp-demo' });
  const refs = used.json.assets.map((a) => a.ref);
  assert.ok(refs.includes('dot@1') && !refs.includes('dot@2'));
  assert.ok(refs.includes('easing@1'), 'nested dependencies are listed');

  const moved = await call('repin_clip', { clip: 'mcp-demo', name: 'mcp-demo-latest' });
  assert.ok(moved.json.assets.includes('dot@2'));
  const after = await call('frame_hashes', { clip: 'mcp-demo', times: [0.5, 1.5] });
  assert.deepEqual(after.json.frames, hashes.json.frames, 'the original clip is unchanged');
  const changed = await call('frame_hashes', { clip: 'mcp-demo-latest', times: [0.5, 1.5] });
  assert.notDeepEqual(changed.json.frames.map((f) => f.hash), hashes.json.frames.map((f) => f.hash));

  assert.match((await call('reuse_report')).text, /Clip 1 · mcp-demo[\s\S]*Clip 2 · mcp-demo-latest[\s\S]*from mcp-demo/);
});

test('bake a frame into an image asset and an audio asset into a sound, and use the sound in a clip', async () => {
  const img = await call('bake_asset', { ref: 'dot@1', name: 'dot-still', description: 'A still of the dot asset, baked to a PNG.', width: 64, height: 64, t: 1 });
  assert.ok(!img.isError, img.text);
  assert.equal(img.json.added.type, 'image');
  assert.equal(img.json.added.forkedFrom, 'dot@1');
  assert.equal(img.images.length, 1);

  assert.ok(!(await call('create_asset', { name: 'kick', source: TONE })).isError);
  const snd = await call('bake_asset', { ref: 'kick', name: 'kick-baked', description: 'One second of the kick pattern, baked to a WAV.', duration: 1 });
  assert.ok(!snd.isError, snd.text);
  assert.equal(snd.json.added.type, 'sound');
  assert.equal(snd.json.added.forkedFrom, 'kick@1');
  assert.ok(Math.abs(snd.json.duration - 1) < 0.05);

  const edited = await call('edit_clip', { clip: 'mcp-demo', operations: [{ op: 'add_track', track: { id: 'sound', type: 'audio' } }, { op: 'add_item', track: 'sound', item: { id: 'hit', asset: 'kick-baked', start: 0.5, duration: 1, gain: 0.8 } }] });
  assert.ok(!edited.isError, edited.text);
  const render = await call('start_render', { clip: 'mcp-demo', wait_seconds: 60 });
  assert.equal(render.json.status, 'done', render.json.error ?? '');
  assert.equal(render.json.log, undefined, 'ffmpeg wrote warnings');
  const used = (await call('list_clip_assets', { clip: 'mcp-demo' })).json.assets;
  assert.ok(used.some((a) => a.ref === 'kick-baked@1' && a.type === 'sound'));
});

test('the CLI helper inlines @file: arguments', () => {
  const out = inlineFiles({ name: 'x', nested: [{ source: '@file:package.json' }] });
  assert.match(out.nested[0].source, /"name": "fablecut"/);
});
