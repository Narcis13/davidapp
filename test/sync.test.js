// sync-assets never undoes a change made in the studio: it syncs file edits, stops (writing nothing) when the
// library's newest version came from the studio (an accepted proposal, a playground save), pulls that version
// into assets/ when asked, and can be forced.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tempStudio, AUTHOR } from './helpers.js';
import { createTools } from '../src/mcp/tools.js';
import { syncAssets, SyncConflict, SYNC_NOTE } from '../scripts/sync-assets.mjs';

const source = (label) => `asset({
  description: 'A label for sync tests, saying which version it is.',
  tags: ['test'],
  params: { text: { type: 'string', default: '${label}' } },
  render(f, p) { f.ctx.fillStyle = '#ffffff'; f.ctx.fillText(p.text, 10, 20); },
});`;

let env, studio, dir, client;
const quiet = () => {};
before(() => {
  env = tempStudio();
  studio = env.studio;
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sync-assets-'));
  const tools = createTools(studio, { author: 'sync-test' });
  // the MCP client the script expects, over the tools in this process
  client = { callTool: async ({ name, arguments: args }) => tools.call(name, args) };
});
after(async () => { rmSync(dir, { recursive: true, force: true }); await env.cleanup(); });

test('sync-assets creates and updates from the files, refuses to undo a studio change, and pulls it into assets/ when asked', async () => {
  writeFileSync(join(dir, 'tag.js'), source('one'));
  let r = await syncAssets(client, ['tag'], { dir, log: quiet });
  assert.deepEqual(r.created, ['tag']);
  // a file edit makes a new version
  writeFileSync(join(dir, 'tag.js'), source('two'));
  r = await syncAssets(client, ['tag'], { dir, log: quiet });
  assert.deepEqual(r.updated, ['tag']);
  assert.equal(studio.library.getAsset('tag').version, 2);
  assert.equal(studio.library.getAsset('tag').note, SYNC_NOTE);

  // a proposal accepted in the studio makes v3; the file still says "two"
  await studio.library.updateAsset({ slug: 'tag', source: source('studio'), author: 'studio-user', note: 'accepted from request #4' });
  await assert.rejects(syncAssets(client, ['tag'], { dir, log: quiet }), (e) => e instanceof SyncConflict && /tag: the library is at v3 \(studio-user, "accepted from request #4"\)/.test(e.message) && /--pull/.test(e.message));
  assert.equal(studio.library.getAsset('tag').version, 3, 'nothing was written');

  // a save in the playground is a studio change too
  await studio.library.updateAsset({ slug: 'tag', source: source('playground'), author: 'studio-user' });
  await assert.rejects(syncAssets(client, [], { dir, log: quiet }), SyncConflict);

  // --pull brings the library's version into assets/, and then the files and the library agree
  r = await syncAssets(client, ['tag'], { dir, log: quiet, pull: true });
  assert.deepEqual(r.pulled, ['tag']);
  assert.ok(readdirSync(dir).includes('tag.v4.js'));
  assert.equal(readFileSync(join(dir, 'tag.v4.js'), 'utf8'), source('playground'));
  r = await syncAssets(client, ['tag'], { dir, log: quiet });
  assert.deepEqual(r.unchanged, ['tag']);
  assert.equal(studio.library.getAsset('tag').version, 4);

  // and editing the pulled file syncs as before
  writeFileSync(join(dir, 'tag.v4.js'), source('after pull'));
  r = await syncAssets(client, ['tag'], { dir, log: quiet });
  assert.deepEqual(r.updated, ['tag']);
});

test('sync-assets --force syncs the file over a studio change', async () => {
  await studio.library.updateAsset({ slug: 'tag', source: source('again in the studio'), author: AUTHOR, note: 'accepted from request #9' });
  const before = studio.library.getAsset('tag').version;
  const r = await syncAssets(client, ['tag'], { dir, log: quiet, force: true });
  assert.deepEqual(r.updated, ['tag']);
  assert.equal(studio.library.getAsset('tag').version, before + 1);
});
