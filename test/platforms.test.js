// Platform safe-zone profiles: scaling, merging, sources and the caption lane.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, platformSafe, captionLane } from '../src/core/platforms.js';
import { safeZone } from '../src/core/engine.js';

const EDGES = ['top', 'right', 'bottom', 'left'];

test('platformSafe: each profile at its reference size is its zones maxed with the format safe zone', () => {
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const { width, height } = p.reference;
    const fmt = safeZone(width, height);
    const s = platformSafe([id], width, height);
    for (const k of EDGES) {
      assert.equal(s[k], Math.max(p.zones[k], fmt[k]), `${id}.${k}`);
      assert.equal(s.from[k], p.zones[k] >= fmt[k] ? id : 'format', `${id}.from.${k}`);
    }
    assert.equal(s.x, s.left);
    assert.equal(s.y, s.top);
    assert.equal(s.width, width - s.left - s.right);
    assert.equal(s.height, height - s.top - s.bottom);
    assert.deepEqual(s.platforms, [id]);
    assert.deepEqual(s.warnings, []);
  }
});

test('platformSafe: several profiles take the tightest edge and name where it came from', () => {
  const { reels, tiktok } = PLATFORMS;
  const fmt = safeZone(1080, 1920);
  const s = platformSafe(['reels', 'tiktok'], 1080, 1920);
  for (const k of EDGES) assert.equal(s[k], Math.max(reels.zones[k], tiktok.zones[k], fmt[k]), k);
  assert.deepEqual(s.platforms, ['reels', 'tiktok']);
  assert.equal(s.from.top, 'reels'); // 269 beats 150
  assert.equal(s.from.bottom, 'reels'); // 672 beats 440
  assert.equal(s.from.right, 'tiktok'); // 120 beats 65
  assert.equal(s.from.left, 'format'); // 72 beats 65 and 60
});

test('platformSafe: the generic feed profile is the union of Shorts, Reels and TikTok', () => {
  for (const k of EDGES) {
    assert.equal(PLATFORMS.feed.zones[k], Math.max(PLATFORMS.shorts.zones[k], PLATFORMS.reels.zones[k], PLATFORMS.tiktok.zones[k]), k);
  }
});

test('platformSafe: scaling to a 540x960 frame halves the pixels', () => {
  const full = platformSafe(['reels', 'tiktok'], 1080, 1920);
  const half = platformSafe(['reels', 'tiktok'], 540, 960);
  // the zones halve; the custom-size 5% format insets (27 and 48 px) are smaller than the halved zones
  for (const k of EDGES) assert.equal(half[k], Math.max(PLATFORMS.reels.zones[k], PLATFORMS.tiktok.zones[k]) / 2, k);
  for (const k of ['top', 'right', 'bottom']) assert.equal(half[k], full[k] / 2, k);
  assert.equal(half.width, 540 - half.left - half.right);
  assert.equal(half.height, 960 - half.top - half.bottom);
  assert.equal(half.from.top, 'reels');
  assert.equal(half.from.right, 'tiktok');
});

test('platformSafe: a profile for other formats applies by fractions with a warning', () => {
  const s = platformSafe(['reels'], 1920, 1080);
  assert.equal(s.top, (269 / 1920) * 1080);
  assert.equal(s.right, (65 / 1080) * 1920);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /reels is made for vertical frames/);
  assert.deepEqual(platformSafe(['youtube'], 1920, 1080).warnings, []);
});

test('platformSafe: an unknown id lists the known ones', () => {
  assert.throws(() => platformSafe(['vine'], 1080, 1920), (e) => {
    return e instanceof Error && /Unknown platform "vine"/.test(e.message) && Object.keys(PLATFORMS).every((id) => e.message.includes(id));
  });
  assert.throws(() => platformSafe(['toString'], 1080, 1920), /Unknown platform/);
  assert.throws(() => platformSafe(['reels'], 0, 1920), /Invalid frame size/);
});

test('profiles: every one has an https source with a retrieved date, a reference size and zones', () => {
  assert.deepEqual(Object.keys(PLATFORMS), ['youtube', 'shorts', 'reels', 'tiktok', 'feed']);
  for (const [id, p] of Object.entries(PLATFORMS)) {
    assert.equal(p.id, id);
    assert.ok(p.formats.length >= 1, `${id} formats`);
    assert.ok(p.sources.length >= 1, `${id} has a source`);
    for (const s of p.sources) {
      assert.ok(s.title && s.says, `${id} source text`);
      assert.match(s.url, /^https:\/\//, `${id} url`);
      assert.match(s.retrieved, /^\d{4}-\d{2}-\d{2}$/, `${id} retrieved`);
    }
    for (const k of EDGES) assert.ok(p.zones[k] > 0 && p.zones[k] < (k === 'left' || k === 'right' ? p.reference.width : p.reference.height) / 2, `${id}.${k}`);
    if (p.assumed) assert.ok(p.assumed.every((a) => typeof a === 'string' && a.length > 0));
  }
});

test('captionLane: sits inside the safe zone, on its bottom edge', () => {
  for (const [w, h, fraction] of [[1080, 1920, 0.15], [1920, 1080, 0.2], [1080, 1080, 0.2]]) {
    const safe = platformSafe(['reels'], w, h);
    const lane = captionLane(safe, w, h);
    assert.equal(lane.height, fraction * h);
    assert.equal(lane.x, safe.x);
    assert.equal(lane.width, safe.width);
    assert.ok(lane.y >= safe.y);
    assert.ok(lane.y + lane.height <= safe.y + safe.height + 1e-9);
    assert.ok(Math.abs(lane.y + lane.height - (safe.y + safe.height)) < 1e-9);
  }
  const safe = platformSafe(['feed'], 1080, 1920);
  assert.equal(captionLane(safe, 1080, 1920, { laneFraction: 0.1 }).height, 192);
  assert.equal(captionLane(safe, 1080, 1920, { laneFraction: 1 }).height, safe.height); // clamped
  assert.throws(() => captionLane(safe, 1080, 1920, { laneFraction: 0 }), /laneFraction/);
});
