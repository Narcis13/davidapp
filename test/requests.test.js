// Asking the agent: the request queue, proposals and their lifecycle, concurrent edits, the live
// event stream, and "Run now" through a stub `claude` CLI.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempStudio, seedAssets, smallComposition, AUTHOR, DOT } from './helpers.js';
import { createStudio } from '../src/studio/studio.js';
import { createStudioServer } from '../src/server/http.js';
import { findClaude, commandFor } from '../src/studio/agent-run.js';

const STUB = fileURLToPath(new URL('./fixtures/claude-stub.mjs', import.meta.url));
const AGENT = 'agent-under-test';
let t, studio;

before(async () => {
  t = tempStudio();
  studio = t.studio;
  await studio.clips.createClip({ slug: 'demo', title: 'Demo', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  await seedAssets(studio, 'demo');
  await studio.clips.updateClip('demo', { composition: smallComposition() });
});
after(() => t.cleanup());

const R = () => studio.requests;
const greener = DOT.replace("default: '#ff3366'", "default: '#33ff66'");

test('an asset request: claim → context with frames → proposal → accept makes the next version', async () => {
  const r = R().create({ scope: 'asset', asset: 'dot', params: { radius: 30 }, at: 1, message: 'Make the dot green\nand keep the curve.', author: AUTHOR });
  assert.equal(r.status, 'open');
  assert.equal(r.title, 'Make the dot green');
  assert.equal(r.assetRef, 'dot@1');
  assert.deepEqual(R().list({ status: 'open' }).map((x) => x.id), [r.id]);

  const claimed = R().claim({ agent: AGENT });
  assert.equal(claimed.id, r.id);
  assert.equal(claimed.status, 'working');
  assert.equal(R().claim({ agent: AGENT }), null, 'nothing else is open');
  assert.throws(() => R().claim({ id: r.id, agent: 'someone-else' }), /being worked by agent-under-test/);

  const ctx = await R().context(r.id);
  assert.equal(ctx.scope.asset, 'dot@1');
  assert.match(ctx.scope.source, /A dot that slides/);
  assert.deepEqual(ctx.scope.params, { radius: 30 });
  assert.equal(ctx.images.length, 1);
  assert.ok(ctx.images[0].png.length > 1000);

  await assert.rejects(R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: DOT, summary: 'same' }), /identical to dot@1/);
  await assert.rejects(R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: 'asset({ description: "Broken on purpose for the test.", tags: ["t"], render(f) { f.nope(); } });', summary: 'broken' }), /The asset was rejected[\s\S]*f\.nope is not a function/);
  const { proposal, request } = await R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: greener, note: 'Green by default.', summary: 'The dot is green now.' });
  assert.equal(request.status, 'review');
  assert.equal(proposal.base, 'dot@1');
  assert.equal(proposal.meta.wouldBe, 'dot@2');
  assert.ok(proposal.thumb.startsWith('thumbs/proposal-'));
  assert.equal(studio.library.versionRow('dot').version, 1, 'nothing is saved until it is accepted');

  const { result, request: done } = await R().accept({ proposal: proposal.id, author: AUTHOR });
  assert.equal(result, 'dot@2');
  assert.equal(done.status, 'done');
  const v2 = studio.library.getAsset('dot@2');
  assert.equal(v2.author, AGENT);
  assert.match(v2.note, /Green by default\. \(accepted from request #\d+\)/);
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'system', 'agent', 'system']);
  await assert.rejects(R().accept({ proposal: proposal.id, author: AUTHOR }), /is accepted; only a pending proposal/);
});

test('replies, superseded proposals and rejections keep the thread going', async () => {
  const r = R().create({ asset: 'label', message: 'Bigger text please', author: AUTHOR });
  R().claim({ id: r.id, agent: AGENT });
  const LABEL2 = studio.library.getAsset('label').source.replace('size: f.height * 0.3', 'size: f.height * 0.4');
  const first = (await R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: LABEL2, summary: '33% bigger' })).proposal;
  assert.equal(R().reply({ id: r.id, author: AUTHOR, body: 'Even bigger, and bold' }).status, 'open', 'a user reply sends it back to the agent');
  const second = (await R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: LABEL2.replace('0.4', '0.5'), summary: 'Much bigger' })).proposal;
  assert.equal(R().proposal(first.id).status, 'superseded');
  const rejected = R().reject({ proposal: second.id, author: AUTHOR, reason: 'Too big now' });
  assert.equal(rejected.status, 'open');
  assert.equal(rejected.messages.at(-1).body, 'Too big now');
  const third = (await R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: LABEL2.replace('0.4', '0.45'), summary: 'In between' })).proposal;
  assert.equal(R().reject({ proposal: third.id, author: AUTHOR }).status, 'done', 'a rejection without a reason closes it');
  assert.equal(studio.library.versionRow('label').version, 1);
  const q = R().create({ scope: 'library', message: 'Do we have a confetti asset?', author: AUTHOR });
  assert.equal(R().complete({ id: q.id, agent: AGENT, body: 'Not yet: try sparkle-field.' }).status, 'done');
  assert.throws(() => R().reply({ id: R().cancel({ id: R().create({ scope: 'library', message: 'x', author: AUTHOR }).id, author: AUTHOR }).id, author: AUTHOR, body: 'hello?' }), /was cancelled/);
});

test('concurrent edits: an asset that moved on is a conflict unless forced; nothing is lost', async () => {
  const r = R().create({ asset: 'badge', message: 'Rounder corners', author: AUTHOR });
  R().claim({ id: r.id, agent: AGENT });
  const src = studio.library.getAsset('badge').source;
  const { proposal } = await R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: src.replace('f.height / 4', 'f.height / 2'), summary: 'Pill shape' });
  // meanwhile the user saves their own version by hand
  await studio.library.updateAsset({ slug: 'badge', source: src.replace("default: '#2244ff'", "default: '#aa22ff'"), author: AUTHOR, note: 'purple' });
  await assert.rejects(R().accept({ proposal: proposal.id, author: AUTHOR }), (/** @type {any} */ e) => e.code === 'conflict' && /moved to v2 after this proposal was made against badge@1/.test(e.message));
  const { result } = await R().accept({ proposal: proposal.id, author: AUTHOR, force: true });
  assert.equal(result, 'badge@3');
  assert.equal(studio.library.getAsset('badge@2').note, 'purple', 'the hand-made version is still there');
});

test('a clip request: the proposal is edit operations, re-applied on accept (rebases, or conflicts)', async () => {
  const r = R().create({ clip: 'demo', items: ['label'], at: 1, message: 'add a dot at 0:01', author: AUTHOR });
  assert.throws(() => R().create({ clip: 'demo', items: ['ghost'], message: 'x', author: AUTHOR }), /No item "ghost" in clip "demo"/);
  R().claim({ id: r.id, agent: AGENT });
  const ctx = await R().context(r.id);
  assert.equal(ctx.scope.selected[0].id, 'label');
  assert.equal(ctx.images.length, 2, 'the frame at the playhead and a contact sheet');
  await assert.rejects(R().propose({ id: r.id, agent: AGENT, kind: 'clip-edit', operations: [{ op: 'add_item', track: 'main', item: { id: 'd2', asset: 'nope', start: 1, duration: 1 } }], summary: 'x' }), /no asset "nope"/);
  const { proposal } = await R().propose({ id: r.id, agent: AGENT, kind: 'clip-edit', operations: [{ op: 'add_item', track: 'titles', item: { id: 'd2', asset: 'dot', start: 1, duration: 1, params: { color: '#00ffaa' } } }], summary: 'A dot at 0:01' });
  assert.equal(proposal.base, 'demo#2');
  assert.equal(proposal.meta.framesChecked > 0, true);
  // the user keeps editing the clip meanwhile: the proposal still applies
  await studio.clips.editClip('demo', [{ op: 'update_item', id: 'label', patch: { params: { text: 'Edited meanwhile' } } }]);
  const { result } = await R().accept({ proposal: proposal.id, author: AUTHOR });
  assert.equal(result, 'demo#4');
  const comp = studio.clips.getClip('demo').composition;
  assert.ok(comp.tracks.find((x) => x.id === 'titles').items.some((i) => i.id === 'd2' && i.asset.startsWith('dot@')));
  assert.equal(comp.tracks.find((x) => x.id === 'titles').items[0].params.text, 'Edited meanwhile');
  // an edit to an item the user deleted no longer applies
  const r2 = R().create({ clip: 'demo', message: 'recolour the new dot', author: AUTHOR });
  const p2 = (await R().propose({ id: r2.id, agent: AGENT, kind: 'clip-edit', operations: [{ op: 'update_item', id: 'd2', patch: { params: { color: '#ffffff' } } }], summary: 'white' })).proposal;
  await studio.clips.editClip('demo', [{ op: 'remove_item', id: 'd2' }]);
  await assert.rejects(R().accept({ proposal: p2.id, author: AUTHOR }), (/** @type {any} */ e) => e.code === 'conflict' && /no longer apply[\s\S]*no item with id "d2"/.test(e.message));
});

test('a new asset proposed for a clip request is recorded as made for that clip', async () => {
  const r = R().create({ clip: 'demo', message: 'a second dot asset', author: AUTHOR });
  const { proposal } = await R().propose({ id: r.id, agent: AGENT, kind: 'new-asset', name: 'dot-big', source: DOT.replace('default: 20', 'default: 60'), summary: 'A bigger dot' });
  await assert.rejects(R().propose({ id: r.id, agent: AGENT, kind: 'new-asset', name: 'dot', source: DOT, summary: 'dup' }), /already exists/);
  await R().accept({ proposal: proposal.id, author: AUTHOR });
  const a = studio.library.getAsset('dot-big');
  assert.equal(a.originClip, 'demo');
  assert.equal(a.madeForClip, 'demo');
});

test('an expired claim goes back to the queue', () => {
  const r = R().create({ scope: 'library', message: 'anything', author: AUTHOR });
  R().claim({ id: r.id, agent: AGENT });
  studio.db.prepare('UPDATE requests SET lease_until = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', r.id);
  const listed = R().list({ status: 'open' });
  assert.ok(listed.some((x) => x.id === r.id));
  assert.match(R().get(r.id).messages.at(-1).body, /claim expired/);
  assert.equal(R().claim({ id: r.id, agent: 'another-agent' }).claimedBy, 'another-agent');
});

test('every change is an event, whichever process makes it', async () => {
  const from = studio.events.latest();
  const r = R().create({ scope: 'library', message: 'events please', author: AUTHOR });
  await studio.clips.editClip('demo', [{ op: 'set', background: '#202020' }]);
  // a second process on the same data dir (an MCP server) writes to the same table
  const other = createStudio({ dataDir: t.dataDir, role: 'mcp' });
  try {
    await other.library.updateAsset({ slug: 'kick', source: studio.library.getAsset('kick').source.replace('default: 120', 'default: 128'), author: 'other' });
  } finally {
    await other.close();
  }
  const seen = studio.events.since(from).map((e) => `${e.topic}:${e.key}:${e.action}:${e.source}`);
  assert.deepEqual(seen, [`request:${r.id}:created:test`, 'clip:demo:updated:test', 'asset:kick:version:mcp']);
});

test('HTTP: the event stream pushes changes from another process, and replays after a reconnect', async () => {
  const server = /** @type {any} */ (createStudioServer(studio, { env: { PATH: '' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = res.body.getReader();
    let text = '';
    const until = async (re) => {
      const end = Date.now() + 5000;
      while (!re.test(text) && Date.now() < end) text += new TextDecoder().decode((await reader.read()).value);
      return re.test(text);
    };
    const other = createStudio({ dataDir: t.dataDir, role: 'mcp' });
    try { await other.clips.editClip('demo', [{ op: 'set', background: '#303030' }]); } finally { await other.close(); }
    assert.ok(await until(/event: clip\ndata: \{[^\n]*"key":"demo","action":"updated"[^\n]*"source":"mcp"/), `got: ${text}`);
    const lastId = Number(/id: (\d+)\nevent: clip/.exec(text)[1]);
    ctl.abort();
    // a reconnecting client says what it saw last and gets what it missed
    R().create({ scope: 'library', message: 'missed while away', author: AUTHOR });
    await new Promise((r) => setTimeout(r, 400));
    const again = await fetch(`${base}/api/events`, { headers: { 'last-event-id': String(lastId) } });
    const r2 = again.body.getReader();
    let t2 = '';
    const end = Date.now() + 3000;
    while (!/missed|"topic":"request"/.test(t2) && Date.now() < end) t2 += new TextDecoder().decode((await r2.read()).value);
    assert.match(t2, /event: request\ndata: \{[^\n]*"action":"created"/);
    await r2.cancel();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function serve(env) {
  const server = /** @type {any} */ (createStudioServer(studio, { env }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const close = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  return { call, close };
}
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
};

test('Run now: hidden without the claude CLI; with it, a session works the request into a proposal', async () => {
  assert.equal(findClaude({ PATH: '' }), null);
  assert.equal(findClaude({ PATH: '/nonexistent:/also-not' }), null);
  assert.equal(findClaude({ STUDIO_CLAUDE_BIN: STUB }), STUB);
  const none = await serve({ PATH: '' });
  try {
    assert.equal((await none.call('GET', '/api/status')).body.agent.runNow, false);
    const r = (await none.call('POST', '/api/requests', { scope: 'asset', asset: 'dot', message: 'cyan please' })).body;
    const refused = await none.call('POST', `/api/requests/${r.id}/run`);
    assert.equal(refused.status, 501);
    assert.match(refused.body.error, /not on PATH/);
  } finally { await none.close(); }

  const withCli = await serve({ ...process.env, STUDIO_CLAUDE_BIN: STUB, STUDIO_DATA: t.dataDir });
  try {
    assert.equal((await withCli.call('GET', '/api/status')).body.agent.runNow, true);
    const r = (await withCli.call('POST', '/api/requests', { scope: 'asset', asset: 'dot', message: 'cyan please' })).body;
    const started = await withCli.call('POST', `/api/requests/${r.id}/run`);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.run.status, 'running');
    const done = await waitFor(async () => { const x = (await withCli.call('GET', `/api/requests/${r.id}`)).body; return x.run?.status === 'done' ? x : null; });
    assert.ok(done, 'the session finished');
    assert.equal(done.status, 'review');
    assert.equal(done.proposals[0].summary, 'Stub: the default colour is now cyan.');
    assert.equal(done.proposals[0].author, 'claude-code-run');
    const progress = done.messages.filter((m) => m.role === 'progress').map((m) => m.body);
    assert.ok(progress.includes('→ claim_request') && progress.includes('→ propose_asset_version'), progress.join(' | '));
    assert.ok(progress.some((p) => /Claude Code finished \(success, 3 turns/.test(p)));
    const preview = await withCli.call('GET', `/api/proposals/${done.proposals[0].id}/preview`);
    assert.equal(preview.body.ref, `dot@${studio.library.versionRow('dot').version + 1}`);
    assert.ok(preview.body.bundle.assets[preview.body.ref].source.includes('#22ccff'));
    const accepted = await withCli.call('POST', `/api/proposals/${done.proposals[0].id}/accept`, {});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  } finally { await withCli.close(); }
});

test('Run now: a session that overruns its timeout is stopped; one can be cancelled; a failure is reported', async () => {
  const hang = await serve({ ...process.env, STUDIO_CLAUDE_BIN: STUB, CLAUDE_STUB_MODE: 'hang', STUDIO_AGENT_TIMEOUT: '1.5' });
  try {
    const r = (await hang.call('POST', '/api/requests', { scope: 'library', message: 'take forever' })).body;
    await hang.call('POST', `/api/requests/${r.id}/run`);
    const timedOut = await waitFor(async () => { const x = (await hang.call('GET', `/api/requests/${r.id}`)).body; return x.run?.status === 'timeout' ? x : null; }, 10000);
    assert.ok(timedOut, 'stopped by the timeout');
    assert.match(timedOut.messages.at(-1).body, /stopped after 1.5 s/);
    const r2 = (await hang.call('POST', '/api/requests', { scope: 'library', message: 'cancel me' })).body;
    await hang.call('POST', `/api/requests/${r2.id}/run`);
    assert.equal((await hang.call('POST', `/api/requests/${r2.id}/run`)).status, 409, 'one session per request');
    await new Promise((res) => setTimeout(res, 300));
    assert.equal((await hang.call('POST', `/api/requests/${r2.id}/run/cancel`)).status, 200);
    const cancelled = await waitFor(async () => { const x = (await hang.call('GET', `/api/requests/${r2.id}`)).body; return x.run?.status === 'cancelled' ? x : null; }, 10000);
    assert.ok(cancelled);
  } finally { await hang.close(); }
  const fail = await serve({ ...process.env, STUDIO_CLAUDE_BIN: STUB, CLAUDE_STUB_MODE: 'fail' });
  try {
    const r = (await fail.call('POST', '/api/requests', { scope: 'library', message: 'fail' })).body;
    await fail.call('POST', `/api/requests/${r.id}/run`);
    const failed = await waitFor(async () => { const x = (await fail.call('GET', `/api/requests/${r.id}`)).body; return x.run?.status === 'failed' ? x : null; }, 10000);
    assert.match(failed.messages.at(-1).body, /failed \(exit 3\)\. stub: failing on purpose/);
  } finally { await fail.close(); }
});

test('how the CLI is started: a script with this Node, a binary directly, a .cmd shim through the shell with the prompt on stdin', { timeout: 30000 }, async () => {
  assert.deepEqual(commandFor('/opt/claude.mjs', ['-p', '--tools', '']), { cmd: process.execPath, args: ['/opt/claude.mjs', '-p', '--tools', ''], shell: false });
  assert.deepEqual(commandFor('/usr/local/bin/claude', ['-p']), { cmd: '/usr/local/bin/claude', args: ['-p'], shell: false });
  if (process.platform !== 'win32') return;
  assert.deepEqual(commandFor('C:/npm dir/claude.cmd', ['-p', '--tools', '', 'a,b']), { cmd: '"C:/npm dir/claude.cmd"', args: ['"-p"', '"--tools"', '""', '"a,b"'], shell: true });
  // a real shim, in a folder with a space in its name, as npm writes them
  const shim = join(t.dataDir, 'cache', 'claude shim.cmd');
  writeFileSync(shim, `@"${process.execPath}" "${STUB}" %*\r\n`);
  const s = await serve({ ...process.env, STUDIO_CLAUDE_BIN: shim, STUDIO_DATA: t.dataDir });
  try {
    const r = (await s.call('POST', '/api/requests', { scope: 'asset', asset: 'dot', message: 'cyan "please" & thanks | 100%' })).body;
    assert.equal((await s.call('POST', `/api/requests/${r.id}/run`)).status, 200);
    const done = await waitFor(async () => { const x = (await s.call('GET', `/api/requests/${r.id}`)).body; return ['done', 'failed'].includes(x.run?.status) ? x : null; });
    assert.equal(done?.run.status, 'done', JSON.stringify(done?.messages.at(-1)));
    assert.equal(done.proposals[0].summary, 'Stub: the default colour is now cyan.');
  } finally { await s.close(); }
});

test('the studio passes the stub only the studio MCP server and its read/answer tools', async () => {
  const { RUN_TOOLS, promptFor } = await import('../src/studio/agent-run.js');
  assert.ok(!RUN_TOOLS.includes('create_asset') && !RUN_TOOLS.includes('update_clip') && !RUN_TOOLS.includes('start_render'), 'no tool that changes the library or a clip directly');
  assert.match(promptFor({ id: 7, title: 'x' }), /claim_request with id 7/);
  assert.ok(join(STUB).endsWith('claude-stub.mjs'));
});
