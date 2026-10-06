// The MCP server end to end, over stdio, the way Claude Code talks to it: search, create, edit
// into a new version, render a frame to PNG, render a clip to MP4, and reject a broken asset.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, callTool, inlineFiles } from '../scripts/mcp.mjs';
import { EASING, DOT, LABEL, TONE } from './helpers.js';
import { createStudio } from '../src/studio/studio.js';
import { MOTION_POP, EFFECT_GRAIN, TRANSITION_WIPE, BROKEN } from './fixtures/kinds.js';
import { BALL } from './fixtures/solid.js';

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
  for (const n of ['studio_guide', 'search_assets', 'get_asset', 'validate_asset', 'create_asset', 'update_asset', 'fork_asset', 'create_clip', 'update_clip', 'edit_clip', 'render_asset_frame', 'render_clip_frame', 'start_render', 'get_render', 'cancel_render', 'list_clip_assets', 'frame_hashes', 'reuse_report',
    'list_requests', 'claim_request', 'get_request', 'reply_request', 'propose_asset_version', 'propose_new_asset', 'propose_clip_edit', 'complete_request',
    'save_defaults', 'create_preset', 'save_precomp', 'set_asset_metadata', 'diff_versions', 'bake_sequence', 'upload_image', 'list_undescribed', 'describe_asset']) assert.ok(names.includes(n), `missing tool ${n}`);
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

test('requests: list, claim with frames, reply, propose a version and a clip edit, complete; layout ops through edit_clip', async () => {
  // the user's side runs in the studio (another process on the same data dir)
  const studio = createStudio({ dataDir, role: 'server' });
  try {
    const ask = studio.requests.create({ asset: 'dot', params: { radius: 40 }, message: 'Make the dot cyan', author: 'user' });
    const listed = await call('list_requests', {});
    assert.ok(listed.json.requests.some((r) => r.id === ask.id && r.status === 'open' && r.asset === 'dot@2'));
    const claimed = await call('claim_request', { id: ask.id });
    assert.ok(!claimed.isError, claimed.text);
    assert.equal(claimed.json.request.status, 'working');
    assert.match(claimed.json.scope.source, /slides from left to right/);
    assert.deepEqual(claimed.json.scope.params, { radius: 40 });
    assert.equal(claimed.images.length, 1, 'a filmstrip of the asset with the params on screen');
    assert.ok(!(await call('reply_request', { id: ask.id, message: 'On it.' })).isError);
    const bad = await call('propose_asset_version', { request: ask.id, source: 'asset({ description: "Throws when it draws, on purpose.", tags: ["t"], render() { throw new Error("boom"); } });', summary: 'broken' });
    assert.ok(bad.isError);
    assert.match(bad.text, /rejected[\s\S]*boom/);
    const proposed = await call('propose_asset_version', { request: ask.id, source: DOT.replace("default: '#ff3366'", "default: '#22ccff'").replace('default: 20', 'default: 80'), summary: 'Cyan, as asked.' });
    assert.ok(!proposed.isError, proposed.text);
    assert.equal(proposed.json.wouldBe, 'dot@3');
    assert.equal(proposed.images.length, 1);
    assert.equal((await call('get_asset', { ref: 'dot' })).json.version, 2, 'a proposal saves nothing');
    const { result } = await studio.requests.accept({ proposal: proposed.json.proposal, author: 'user' });
    assert.equal(result, 'dot@3');
    assert.equal((await call('get_asset', { ref: 'dot@3' })).json.author, 'mcp-test-model');

    const clipAsk = studio.requests.create({ clip: 'mcp-demo', items: ['label'], at: 1, message: 'add a dot behind the label at 0:01', author: 'user' });
    const ctx = await call('claim_request', {});
    assert.equal(ctx.json.request.id, clipAsk.id, 'claims the oldest open request');
    assert.equal(ctx.images.length, 2);
    const edit = await call('propose_clip_edit', { request: clipAsk.id, operations: [{ op: 'add_item', track: 'main', item: { id: 'dot2', asset: 'dot', start: 1, duration: 1, transform: { x: 0.7, width: 0.5, height: 0.5, rotation: 20 } } }, { op: 'move_track', id: 'titles', index: 1 }], summary: 'A dot at 0:01, behind the title' });
    assert.ok(!edit.isError, edit.text);
    assert.ok(edit.json.framesChecked > 0);
    await studio.requests.accept({ proposal: edit.json.proposal, author: 'user' });
    const comp = (await call('get_clip', { clip: 'mcp-demo' })).json.composition;
    assert.deepEqual(comp.tracks.map((t) => t.id), ['main', 'titles', 'sound']);
    assert.deepEqual(comp.tracks[0].items.find((i) => i.id === 'dot2').transform, { x: 0.7, width: 0.5, height: 0.5, rotation: 20 });

    const layout = await call('edit_clip', { clip: 'mcp-demo', operations: [{ op: 'add_keyframe', id: 'dot2', prop: 'rotation', t: 0, v: 0 }, { op: 'add_keyframe', id: 'dot2', prop: 'rotation', t: 1, v: 90, ease: 'outCubic' }, { op: 'set_transform', id: 'dot2', format: 'vertical', transform: { y: 0.3 } }, { op: 'update_track', id: 'main', patch: { locked: true } }] });
    assert.ok(!layout.isError, layout.text);
    const vertical = await call('start_render', { clip: 'mcp-demo', format: 'vertical', wait_seconds: 120 });
    assert.equal(vertical.json.status, 'done', vertical.text);
    assert.equal(vertical.json.stats.probe.video.height, 1920);

    const q = studio.requests.create({ scope: 'library', message: 'Is there a confetti asset?', author: 'user' });
    const closed = await call('complete_request', { id: q.id, message: 'Not yet.' });
    assert.equal(closed.json.status, 'done');
    assert.equal((await call('claim_request', { wait_seconds: 1 })).json.claimed, null, 'an empty queue, after waiting');
  } finally {
    await studio.close();
  }
});

test('tweak and keep, and the new kinds, over MCP: defaults, presets, metadata, diff, precomps; broken kinds rejected', async () => {
  const defaults = await call('save_defaults', { name: 'label', params: { text: 'Kept', color: '#ffcc00' } });
  assert.ok(!defaults.isError, defaults.text);
  assert.equal(defaults.json.updated, 'label@2');
  const diff = await call('diff_versions', { name: 'label', a: 1, b: 2, t: 1 });
  assert.match(diff.text, /- {4}text: \{ type: 'string', default: 'Hello' \},[\s\S]*\+ {4}text: \{ type: 'string', default: 'Kept' \},/);
  assert.equal(diff.images.length, 1, 'the same frame of both versions, side by side');
  const preset = await call('create_preset', { base: 'dot@2', name: 'dot-big-teal', params: { radius: 90, color: '#14b8a6' }, title: 'Big teal dot' });
  assert.ok(!preset.isError, preset.text);
  assert.deepEqual(preset.json.deps, { base: 'dot@2' });
  const meta = await call('set_asset_metadata', { name: 'dot-big-teal', tags: ['dot', 'teal', 'preset'] });
  assert.deepEqual(meta.json.tags, ['dot', 'teal', 'preset']);
  assert.equal((await call('get_asset', { ref: 'dot-big-teal' })).json.version, 1, 'no new version');
  assert.ok((await call('search_assets', { tags: ['teal'] })).json.assets.some((a) => a.ref === 'dot-big-teal@1'));
  for (const [name, source] of [['pop', MOTION_POP], ['grain', EFFECT_GRAIN], ['wipe', TRANSITION_WIPE]]) {
    const r = await call('create_asset', { name, source });
    assert.ok(!r.isError, r.text);
    assert.equal(r.images.length, 1, `${name} has a demo thumbnail`);
  }
  for (const [what, [source, expected]] of Object.entries(BROKEN)) {
    const r = await call('create_asset', { name: 'broken', source });
    assert.ok(r.isError, what);
    assert.match(r.text, expected, what);
  }
  const edit = await call('edit_clip', { clip: 'mcp-demo', operations: [
    { op: 'update_item', id: 'label', patch: { motions: [{ asset: 'pop', phase: 'in' }], effects: [{ asset: 'grain', params: { amount: 0.1 } }] } },
    { op: 'update_item', id: 'dot2', patch: { transition: { asset: 'wipe', duration: 0.5 } } },
  ] });
  assert.ok(!edit.isError, edit.text);
  const pre = await call('save_precomp', { clip: 'mcp-demo', items: ['label', 'dot2'], name: 'demo-card', expose: [{ item: 'label', param: 'text', name: 'headline' }], replace: true });
  assert.ok(!pre.isError, pre.text);
  assert.equal(pre.json.created, 'demo-card@1');
  assert.deepEqual(pre.json.params, ['headline']);
  const used = (await call('list_clip_assets', { clip: 'mcp-demo' })).json.assets;
  assert.ok(used.some((a) => a.ref === 'demo-card@1' && a.direct) && used.some((a) => a.ref === 'pop@1' && !a.direct));
  // 3D, baked once into a sequence and reused
  assert.ok(!(await call('create_asset', { name: 'ball', source: BALL })).isError);
  const bake = await call('bake_sequence', { ref: 'ball', name: 'ball-spin', width: 120, height: 120, fps: 10, duration: 1 });
  assert.ok(!bake.isError, bake.text);
  assert.equal(bake.json.cached, false);
  assert.equal(bake.json.bakedFrom, 'ball@1');
  assert.equal(bake.images.length, 1);
  const again = await call('bake_sequence', { ref: 'ball', name: 'ball-spin-again', width: 120, height: 120, fps: 10, duration: 1 });
  assert.equal(again.json.cached, true);
  assert.equal(again.json.sequence, 'ball-spin@1');
  assert.deepEqual((await call('search_assets', { type: 'sequence' })).json.assets.map((a) => a.ref), ['ball-spin@1']);
  const placed = await call('edit_clip', { clip: 'mcp-demo', operations: [{ op: 'add_item', track: 'main', item: { id: 'spin', asset: 'ball-spin', start: 0, duration: 2, params: { loop: true }, transform: { x: 0.8, width: 0.3, height: 0.5 } } }] });
  assert.ok(!placed.isError, placed.text);
  assert.equal((await call('render_clip_frame', { clip: 'mcp-demo', t: 1.5 })).images.length, 1);
});

test('uploads over MCP: upload an image and an SVG, see them in list_undescribed, describe them, find them by tag', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="x()"><script>x()</script><circle cx="32" cy="32" r="24" fill="#ff5c8a"/></svg>';
  const up = await call('upload_image', { name: 'Pink dot.svg', data_base64: Buffer.from(svg).toString('base64') });
  assert.ok(!up.isError, up.text);
  assert.equal(up.json.asset, 'pink-dot@1');
  assert.ok(up.json.removedFromSvg.includes('<script>'));
  assert.equal(up.images.length, 1);
  const dup = await call('upload_image', { name: 'again.svg', data_base64: Buffer.from(svg).toString('base64') });
  assert.equal(dup.json.duplicate, true);
  const list = await call('list_undescribed', {});
  assert.ok(list.json.uploads.some((u) => u.ref === 'pink-dot@1' && u.format === 'svg' && u.vector));
  assert.equal(list.images.length, list.json.uploads.length, 'each upload comes with its picture');
  const d = await call('describe_asset', { name: 'pink-dot', title: 'Pink dot', description: 'A flat pink disc on a transparent background; simple and bold.', tags: ['dot', 'pink', 'shape'], uses: ['a bullet marker', 'drawn on with f.svg'] });
  assert.ok(!d.isError, d.text);
  assert.equal(d.json.needsDescription, false);
  assert.ok((await call('search_assets', { tags: ['pink', 'dot'] })).json.assets.some((a) => a.ref === 'pink-dot@1'));
  assert.ok(!(await call('list_undescribed', {})).json.uploads.some((u) => u.ref === 'pink-dot@1'));
  const bad = await call('upload_image', { name: 'x.svg', data_base64: Buffer.from('<!DOCTYPE svg [<!ENTITY a "b">]><svg>&a;</svg>').toString('base64') });
  assert.ok(bad.isError);
  assert.match(bad.text, /The SVG was rejected: a DOCTYPE or entity declaration/);
});

test('the CLI helper inlines @file: arguments', () => {
  const out = inlineFiles({ name: 'x', nested: [{ source: '@file:package.json' }] });
  assert.match(out.nested[0].source, /"name": "fablecut"/);
});
