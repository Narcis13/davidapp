// Asking the agent: the request queue, proposals and their lifecycle, concurrent edits, the live
// event stream, and "Run now" through a stub `claude` CLI.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempStudio, seedAssets, smallComposition, AUTHOR, DOT } from './helpers.js';
import { createStudio } from '../src/studio/studio.js';
import { createStudioServer } from '../src/server/http.js';
import { findClaude, commandFor, RUN_TOOLS } from '../src/studio/agent-run.js';
import { transaction } from '../src/db/db.js';

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

test('a proposal that arrives after the user cancelled does not bring the request back', async () => {
  const r = R().create({ asset: 'kick', message: 'faster please', author: AUTHOR });
  R().claim({ id: r.id, agent: AGENT });
  const faster = studio.library.getAsset('kick').source.replace('default: 120', 'default: 140');
  // the agent's proposal is still being validated (test frames are drawn) when the user cancels
  const proposing = R().propose({ id: r.id, agent: AGENT, kind: 'asset-version', source: faster, summary: 'Faster' });
  assert.equal(R().cancel({ id: r.id, author: AUTHOR }).status, 'cancelled');
  await assert.rejects(proposing, (/** @type {any} */ e) => e.code === 'conflict' && /was cancelled while this proposal was being prepared/.test(e.message));
  const after = R().get(r.id);
  assert.equal(after.status, 'cancelled');
  assert.deepEqual(after.proposals, [], 'no proposal was stored');
  assert.equal(after.messages.at(-1).body, 'Cancelled.');
  // the same for a request closed meanwhile (the agent completed it from another session)
  const r2 = R().create({ asset: 'kick', message: 'slower please', author: AUTHOR });
  const late = R().propose({ id: r2.id, agent: AGENT, kind: 'asset-version', source: faster.replace('140', '100'), summary: 'Slower' });
  R().complete({ id: r2.id, agent: AGENT, body: 'Nothing to change.' });
  await assert.rejects(late, /was closed while this proposal was being prepared/);
  assert.equal(R().get(r2.id).status, 'done');
});

test('accepting twice at once (a double click, two tabs) applies the proposal once', async () => {
  const r = R().create({ clip: 'demo', message: 'a darker background', author: AUTHOR });
  // an edit that would apply cleanly a second time, so nothing but the guard stops it
  const { proposal } = await R().propose({ id: r.id, agent: AGENT, kind: 'clip-edit', operations: [{ op: 'set', background: '#050505' }], summary: 'Darker' });
  const before = studio.clips.getClip('demo').revision;
  const from = studio.events.latest();
  const results = await Promise.allSettled([R().accept({ proposal: proposal.id, author: AUTHOR }), R().accept({ proposal: proposal.id, author: AUTHOR })]);
  assert.deepEqual(results.map((x) => x.status), ['fulfilled', 'rejected']);
  const refused = /** @type {any} */ (results[1]).reason;
  assert.equal(refused.code, 'conflict');
  assert.match(refused.message, /is being accepted already/);
  assert.equal(studio.clips.getClip('demo').revision, before + 1, 'one new revision');
  assert.equal(R().get(r.id).messages.filter((m) => /^Accepted proposal/.test(m.body)).length, 1);
  assert.deepEqual(studio.events.since(from).map((e) => `${e.topic}:${e.action}`), ['clip:updated', 'request:proposal']);
  await assert.rejects(R().accept({ proposal: proposal.id, author: AUTHOR }), /is accepted; only a pending proposal/);
  // decided from another process while this one was saving: the stored decision stands
  const r2 = R().create({ clip: 'demo', message: 'lighter again', author: AUTHOR });
  const p2 = (await R().propose({ id: r2.id, agent: AGENT, kind: 'clip-edit', operations: [{ op: 'set', background: '#101018' }], summary: 'Lighter' })).proposal;
  const accepting = R().accept({ proposal: p2.id, author: AUTHOR });
  studio.db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ?").run(p2.id);
  await assert.rejects(accepting, (/** @type {any} */ e) => e.code === 'conflict' && /was rejected elsewhere while it was being accepted/.test(e.message));
  assert.equal(R().proposal(p2.id).status, 'rejected');
});

test('two agents going for the same request: one gets it, the other is told who has it', async () => {
  const r = R().create({ scope: 'library', message: 'who takes this?', author: AUTHOR });
  // in this process: the second claim sees the first
  assert.equal(R().claim({ id: r.id, agent: 'agent-a' }).claimedBy, 'agent-a');
  assert.throws(() => R().claim({ id: r.id, agent: 'agent-b' }), (/** @type {any} */ e) => e.code === 'conflict' && /being worked by agent-a \(until /.test(e.message));
  assert.equal(R().claim({ id: r.id, agent: 'agent-a' }).claimedBy, 'agent-a', 'the holder may claim again (a longer lease)');
  assert.equal(R().get(r.id).messages.filter((m) => /is working on it/.test(m.body)).length, 1);
  // from several processes at the same instant, as MCP servers do: exactly one holds each request
  const open = [1, 2, 3].map((n) => R().create({ scope: 'library', message: `race ${n}`, author: AUTHOR }).id);
  const script = `
    import { createStudio } from ${JSON.stringify(new URL('../src/studio/studio.js', import.meta.url).href)};
    const [dir, agent, at, ...ids] = process.argv.slice(1);
    const studio = createStudio({ dataDir: dir, role: 'mcp' });
    await new Promise((r) => setTimeout(r, Math.max(0, Number(at) - Date.now())));
    const out = ids.map((id) => { try { return studio.requests.claim({ id: Number(id), agent }).claimedBy; } catch (e) { return 'refused: ' + e.message; } });
    await studio.close();
    console.log(JSON.stringify(out));`;
  const at = Date.now() + 2500;
  const outs = await Promise.all(['p1', 'p2', 'p3', 'p4'].map((agent) => new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', script, t.dataDir, agent, String(at), ...open.map(String)], { env: { ...process.env } }, (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(JSON.parse(stdout.trim().split('\n').at(-1)))));
  })));
  for (const [i, id] of open.entries()) {
    const got = outs.map((o) => o[i]);
    const holder = R().get(id).claimedBy;
    assert.equal(got.filter((x) => !x.startsWith('refused')).length, 1, `request ${id}: ${got.join(' | ')}`);
    assert.ok(got.includes(holder));
    for (const x of got.filter((y) => y.startsWith('refused'))) assert.match(x, new RegExp(`being worked by ${holder}`));
    assert.equal(R().get(id).messages.filter((m) => /is working on it/.test(m.body)).length, 1);
  }
});

test('a change and its event are one transaction: if the event cannot be written, nothing changed', async () => {
  const emit = studio.events.emit;
  const counts = () => studio.db.prepare('SELECT (SELECT COUNT(*) FROM requests) AS requests, (SELECT COUNT(*) FROM request_messages) AS messages, (SELECT COUNT(*) FROM assets) AS assets, (SELECT COUNT(*) FROM events) AS events').get();
  const r = R().create({ scope: 'library', message: 'events with the change', author: AUTHOR });
  const before = counts(), revision = studio.clips.getClip('demo').revision;
  studio.events.emit = () => { throw new Error('database is locked'); };
  try {
    assert.throws(() => R().create({ scope: 'library', message: 'never stored', author: AUTHOR }), /database is locked/);
    assert.throws(() => R().reply({ id: r.id, author: AUTHOR, body: 'never stored either' }), /database is locked/);
    assert.throws(() => R().claim({ id: r.id, agent: AGENT }), /database is locked/);
    assert.throws(() => R().cancel({ id: r.id, author: AUTHOR }), /database is locked/);
    assert.throws(() => studio.library.setFavorite('dot', true), /database is locked/);
    assert.throws(() => studio.library.setMetadata({ slug: 'dot', title: 'Never', author: AUTHOR }), /database is locked/);
    await assert.rejects(studio.clips.editClip('demo', [{ op: 'set', background: '#ff00ff' }]), /database is locked/);
    await assert.rejects(studio.library.createAsset({ slug: 'never-saved', source: DOT.replace('A dot that slides', 'A dot that never slides'), author: AUTHOR }), /database is locked/);
  } finally {
    studio.events.emit = emit;
  }
  assert.deepEqual(counts(), before);
  assert.equal(R().get(r.id).status, 'open');
  assert.equal(studio.clips.getClip('demo').revision, revision);
  assert.equal(studio.library.getAsset('dot').title === 'Never' || studio.library.getAsset('dot').favorite, false);
  assert.equal(studio.library.versionRow('never-saved'), undefined);
  assert.deepEqual(readdirSync(join(t.dataDir, 'thumbs')).filter((f) => f.startsWith('.tmp-') || f.startsWith('never-saved')), [], 'and its files are gone');
  // a transaction inside a transaction joins it: one commit, or one rollback, for all of it
  assert.throws(() => transaction(studio.db, () => { R().reply({ id: r.id, author: AUTHOR, body: 'inside' }); throw new Error('outer fails'); }), /outer fails/);
  assert.deepEqual(counts(), before);
  assert.equal(studio.db.isTransaction, false);
  assert.equal(transaction(studio.db, () => transaction(studio.db, () => R().reply({ id: r.id, author: AUTHOR, body: 'inside' }).messages.length)), 2);
  assert.equal(counts().events, before.events + 1);
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
  const { promptFor } = await import('../src/studio/agent-run.js');
  assert.ok(!RUN_TOOLS.includes('create_asset') && !RUN_TOOLS.includes('update_clip') && !RUN_TOOLS.includes('start_render'), 'no tool that changes the library or a clip directly');
  assert.match(promptFor({ id: 7, title: 'x' }), /claim_request with id 7/);
  assert.ok(join(STUB).endsWith('claude-stub.mjs'));
  // the session's MCP server is told the same list, so the limit does not rest on the CLI's flags, and it renders nothing
  const config = JSON.parse(readFileSync(join(t.dataDir, 'cache', 'agent-mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(Object.keys(config), ['studio']);
  assert.deepEqual(config.studio.env, { STUDIO_DATA: t.dataDir, STUDIO_AUTHOR: 'claude-code-run', STUDIO_TOOLS: RUN_TOOLS.join(','), STUDIO_RUNNER: '0' });
});

test('Run now: a timeout that is not a number means the default; a session ending after the studio closed its database is not a crash', async () => {
  // its own studio: this one is shut down in the middle of a session
  const own = tempStudio();
  const server = /** @type {any} */ (createStudioServer(own.studio, { env: { ...process.env, STUDIO_CLAUDE_BIN: STUB, CLAUDE_STUB_MODE: 'hang', STUDIO_AGENT_TIMEOUT: 'abc' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })).json();
  const r = await post('/api/requests', { scope: 'library', message: 'still running at shutdown' });
  const started = await post(`/api/requests/${r.id}/run`);
  assert.equal(started.run.status, 'running');
  assert.equal(started.run.timeoutSeconds, 600, 'not NaN, which would stop every session at once');
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(own.studio.requests.get(r.id).run.status, 'running', 'still running after half a second');
  // shutdown: the server stops its sessions, then the database closes, and only then does the child's "close" arrive
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  own.studio.db.close();
  await own.studio.pool.destroy();
  // an exception thrown in that handler would be uncaught and fail this test
  await new Promise((res) => setTimeout(res, 1500));
  try { rmSync(own.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
});
