// The library at scale: facet counts agree with the searches they stand for, sorting, favourites,
// featured, collections, bulk tagging, recently used, adding assets to a clip, and filmstrips.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempStudio, AUTHOR } from './helpers.js';
import { buildSynthetic } from '../scripts/lib/synth.mjs';

let t, L;
before(async () => {
  t = tempStudio();
  await buildSynthetic(t.studio, { count: 400 });
  L = t.studio.library;
});
after(() => t.cleanup());

const FACET_FILTER = { type: (v) => ({ type: v }), kind: (v) => ({ kind: v }), author: (v) => ({ author: v }), origin: (v) => ({ originClip: v }), usedBy: (v) => ({ usedByClip: v }), format: (v) => ({ format: v }), collection: (v) => ({ collection: v }) };

test('facet counts equal the totals of the searches they stand for, under every combination tried', () => {
  const combos = [{}, { query: 'neon' }, { kind: 'visual' }, { tags: ['title'] }, { query: 'chart', kind: 'visual' }, { usedByClip: 'launch-teaser' }, { favorite: true }, { collection: 'brand' }, { needsDescription: true }, { format: 'vertical', author: 'mia' }];
  let checked = 0;
  for (const f of combos) {
    const r = L.search({ ...f, facets: true, limit: 1 });
    for (const [facet, toFilter] of Object.entries(FACET_FILTER)) {
      for (const { value, count } of r.facets[facet]) {
        const expected = L.search({ ...f, ...toFilter(value), limit: 1 }).total;
        assert.equal(count, expected, `${JSON.stringify(f)} → ${facet}=${value}`);
        checked++;
      }
    }
    for (const { value, count } of r.facets.tag) {
      assert.equal(count, L.search({ ...f, tags: [...(f.tags ?? []), value], limit: 1 }).total, `${JSON.stringify(f)} → tag ${value}`);
      checked++;
    }
    assert.equal(r.facets.favorite, L.search({ ...f, favorite: true, limit: 1 }).total);
    assert.equal(r.facets.needsDescription, L.search({ ...f, needsDescription: true, limit: 1 }).total);
    assert.equal(r.facets.featured, L.search({ ...f, featured: true, limit: 1 }).total);
  }
  assert.ok(checked > 300, `${checked} facet values checked`);
});

test('sorting: newest, most used, name; relevance puts featured and favourite matches first', () => {
  const newest = L.search({ sort: 'newest', limit: 50 }).assets;
  assert.ok(newest.every((a, i) => !i || newest[i - 1].versionCreatedAt >= a.versionCreatedAt));
  const used = L.search({ sort: 'used', limit: 50 }).assets;
  assert.ok(used.every((a, i) => !i || used[i - 1].usedByClips >= a.usedByClips));
  const named = L.search({ sort: 'name', limit: 50 }).assets.map((a) => a.title.toLowerCase());
  assert.deepEqual(named, [...named].sort());
  const plain = L.search({ query: 'neon', limit: 200 }).assets.map((a) => a.slug);
  const target = plain[Math.floor(plain.length / 2)];
  L.setFeatured(target, true);
  L.setFavorite(target, true);
  const boosted = L.search({ query: 'neon', limit: 200 }).assets.map((a) => a.slug);
  assert.ok(boosted.indexOf(target) < plain.indexOf(target), `featured and favourite, it moves up (${plain.indexOf(target)} → ${boosted.indexOf(target)})`);
  L.setFeatured(target, false);
  L.setFavorite(target, false);
  const page1 = L.search({ sort: 'newest', limit: 30 }).assets.map((a) => a.slug), page2 = L.search({ sort: 'newest', limit: 30, offset: 30 }).assets.map((a) => a.slug);
  assert.equal(new Set([...page1, ...page2]).size, 60, 'pages do not overlap');
});

test('favourites, collections, bulk tagging and recently used', async () => {
  const some = L.search({ kind: 'visual', limit: 5, sort: 'name' }).assets.map((a) => a.slug);
  const before = L.getAsset(some[0], { includeSource: false });
  const r = L.bulk({ slugs: some, addTags: ['picked'], removeTags: [before.tags[0]], favorite: true, collection: 'Shortlist', author: AUTHOR });
  assert.deepEqual(r.changed, some);
  assert.equal(L.search({ tags: ['picked'] }).total, 5);
  const after = L.getAsset(some[0], { includeSource: false });
  assert.equal(after.version, before.version, 'tagging makes no new version');
  assert.ok(!after.tags.includes(before.tags[0]) && after.tags.includes('picked'));
  assert.ok(L.search({ favorite: true, limit: 200 }).assets.filter((a) => some.includes(a.slug)).every((a) => a.favorite));
  assert.equal(L.listCollections().find((c) => c.slug === 'shortlist').count, 5);
  assert.equal(L.search({ collection: 'shortlist' }).total, 5);
  L.removeFromCollection('shortlist', [some[0]]);
  assert.equal(L.search({ collection: 'shortlist' }).total, 4);
  assert.throws(() => L.bulk({ slugs: some, addTags: ['Not Kebab'], author: AUTHOR }), /lowercase-kebab/);
  L.touch(some[2], 'opened');
  assert.equal(L.search({ recent: true, limit: 1 }).assets[0].slug, some[2], 'the last one opened comes first');
  // add to the open clip
  const added = await t.studio.clips.addAssets({ slug: 'launch-teaser', assets: ['tpl-circle', 'tpl-star'], at: 2 });
  assert.deepEqual(added.added, ['tpl-circle', 'tpl-star']);
  const track = added.clip.composition.tracks.find((x) => x.id === 'added');
  assert.deepEqual(track.items.map((i) => [i.asset, i.start, i.duration]), [['tpl-circle@1', 2, 3], ['tpl-star@1', 2, 3]]);
  await assert.rejects(t.studio.clips.addAssets({ slug: 'launch-teaser', assets: ['easing-nope'] }), /No asset named/);
});

test('saved assets get a filmstrip for hover previews', () => {
  const a = L.getAsset('tpl-wave', { includeSource: false });
  assert.match(a.strip, /^thumbs\/tpl-wave@1\.strip\.png$/);
  assert.ok(existsSync(join(t.dataDir, a.strip)));
  // strips and thumbnails are written under temp names and renamed once their version is saved: none is left over
  assert.deepEqual(readdirSync(join(t.dataDir, 'thumbs')).filter((f) => f.startsWith('.tmp-')), []);
  assert.equal(L.search({ query: 'tpl wave', limit: 1 }).assets[0].strip, a.strip);
});
