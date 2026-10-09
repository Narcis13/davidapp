// Glyph coverage: the cmap reader on real bundled woff2/woff files and on hand-built sfnt/woff
// tables (every cmap format), and the "what can this family not draw" questions built on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { readCoverage, familyCoverage, missingChars, coverageReport } from '../src/render/glyphs.js';
import { fontManifest, FONTS_DIR, ROOT } from '../src/render/host.js';

const font = (name) => readFileSync(join(FONTS_DIR, name));
const ROMANIAN = 'ăâîșț ĂÂÎȘȚ';

// ---- hand-built fonts -------------------------------------------------------------------------

const u16 = (...v) => Buffer.from(v.flatMap((n) => [(n >> 8) & 0xff, n & 0xff]));
const u32 = (...v) => Buffer.from(v.flatMap((n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]));

/** cmap format 4: A-Z via idDelta (gid = c - 0x40), U+0100..0102 via glyphIdArray [5, 0, 7] (so U+0101 is .notdef), then the 0xFFFF sentinel. */
const format4 = () => Buffer.concat([
  u16(4, 0, 0, 6, 0, 0, 0), // format, length (unchecked), language, segCountX2, searchRange, entrySelector, rangeShift
  u16(0x5a, 0x102, 0xffff), u16(0), // endCode, reservedPad
  u16(0x41, 0x100, 0xffff), // startCode
  u16((-0x40) & 0xffff, 0, 1), // idDelta
  u16(0, 4, 0), // idRangeOffset (segment 1: skip 2 remaining offsets, land on glyphIdArray[0])
  u16(5, 0, 7), // glyphIdArray
]);
const format0 = () => Buffer.concat([u16(0, 262, 0), Buffer.from(Array.from({ length: 256 }, (_, c) => (c === 0x61 || c === 0xe9 ? 3 : 0)))]);
const format6 = () => Buffer.concat([u16(6, 0, 0, 0x3b1, 3), u16(1, 0, 2)]); // alpha, (gap), gamma
const format12 = () => Buffer.concat([u16(12, 0), u32(0, 0, 2), u32(0x41, 0x43, 10), u32(0x1f642, 0x1f643, 50)]);

/** An sfnt with one cmap table holding the given subtables as [platform, encoding, bytes]. */
function sfnt(subtables) {
  const head = u16(0, subtables.length);
  let offset = 4 + subtables.length * 8;
  const records = [];
  for (const [platform, encoding, bytes] of subtables) {
    records.push(Buffer.concat([u16(platform, encoding), u32(offset)]));
    offset += bytes.length;
  }
  const cmap = Buffer.concat([head, ...records, ...subtables.map((s) => s[2])]);
  const dir = Buffer.concat([u32(0x00010000), u16(1, 16, 0, 0), Buffer.from('cmap', 'latin1'), u32(0, 12 + 16, cmap.length)]);
  return { file: Buffer.concat([dir, cmap]), cmap };
}

/** Wrap a cmap table in a WOFF 1.0 container (zlib-compressed). */
function woff(cmap) {
  const comp = deflateSync(cmap);
  const header = Buffer.concat([Buffer.from('wOFF'), u32(0x00010000, 0), u16(1, 0), Buffer.alloc(28)]);
  const entry = Buffer.concat([Buffer.from('cmap', 'latin1'), u32(44 + 20, comp.length, cmap.length, 0)]);
  return Buffer.concat([header, entry, comp]);
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ---- readCoverage -----------------------------------------------------------------------------

test('readCoverage: a bundled latin woff2 has A and no Romanian comma-below', () => {
  const cov = readCoverage(font('inter-latin-400-normal.woff2'), 'inter-latin');
  assert.ok(cov.has(0x41));
  assert.ok(cov.has(0x7a));
  assert.ok(!cov.has(0x219));
  assert.ok(!cov.has(0x21b));
});

test('readCoverage: the latin-ext woff2 has U+0219 and U+021B', () => {
  const cov = readCoverage(font('inter-latin-ext-400-normal.woff2'), 'inter-latin-ext');
  assert.ok(cov.has(0x219));
  assert.ok(cov.has(0x21b));
  assert.ok(cov.has(0x103)); // ă
});

test('readCoverage: a real WOFF 1.0 file from @fontsource agrees with its woff2 twin', { skip: !existsSync(join(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-ext-400-normal.woff')) }, () => {
  const w1 = readCoverage(readFileSync(join(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-ext-400-normal.woff')), 'woff');
  const w2 = readCoverage(font('inter-latin-ext-400-normal.woff2'), 'woff2');
  assert.deepEqual([...w1].sort((a, b) => a - b), [...w2].sort((a, b) => a - b));
});

test('readCoverage: sfnt with cmap format 4 (idDelta, idRangeOffset, .notdef holes, 0xFFFF sentinel)', () => {
  const { file } = sfnt([[3, 1, format4()]]);
  assert.deepEqual([...readCoverage(file, 'f4')].sort((a, b) => a - b), [...range(0x41, 0x5a), 0x100, 0x102]);
});

test('readCoverage: cmap formats 0, 6 and 12', () => {
  assert.deepEqual([...readCoverage(sfnt([[0, 3, format0()]]).file)].sort((a, b) => a - b), [0x61, 0xe9]);
  assert.deepEqual([...readCoverage(sfnt([[0, 3, format6()]]).file)].sort((a, b) => a - b), [0x3b1, 0x3b3]);
  assert.deepEqual([...readCoverage(sfnt([[3, 10, format12()]]).file)].sort((a, b) => a - b), [0x41, 0x42, 0x43, 0x1f642, 0x1f643]);
});

test('readCoverage: prefers the full-range Unicode subtable and skips non-Unicode platforms', () => {
  const both = sfnt([[3, 1, format4()], [3, 10, format12()]]).file;
  assert.ok(readCoverage(both).has(0x1f642));
  assert.ok(!readCoverage(both).has(0x100));
  assert.throws(() => readCoverage(sfnt([[1, 0, format0()]]).file, 'mac.ttf'), /mac\.ttf: not a font file/);
});

test('readCoverage: a hand-built WOFF 1.0 (zlib) reads like its sfnt', () => {
  const { cmap } = sfnt([[3, 1, format4()]]);
  assert.deepEqual([...readCoverage(woff(cmap))].sort((a, b) => a - b), [...range(0x41, 0x5a), 0x100, 0x102]);
});

test('readCoverage: bad input throws "<name>: not a font file"', () => {
  assert.throws(() => readCoverage(Buffer.from('this is not a font at all'), 'notes.txt'), /^Error: notes\.txt: not a font file/);
  assert.throws(() => readCoverage(Buffer.alloc(3), 'tiny'), /tiny: not a font file/);
  const good = font('inter-latin-400-normal.woff2');
  assert.throws(() => readCoverage(good.subarray(0, 200), 'truncated.woff2'), /truncated\.woff2: not a font file/);
  const corrupt = Buffer.from(good);
  corrupt.fill(0xff, 120, 400); // inside the Brotli stream
  assert.throws(() => readCoverage(corrupt, 'corrupt.woff2'), /corrupt\.woff2: not a font file/);
  assert.throws(() => readCoverage(sfnt([[3, 1, format4()]]).file.subarray(0, 40), 'cut.ttf'), /cut\.ttf: not a font file/);
});

// ---- familyCoverage / missingChars ------------------------------------------------------------

test('familyCoverage: one entry per bundled family, covering latin and latin-ext', () => {
  const cov = familyCoverage();
  assert.deepEqual([...cov.keys()], fontManifest().map((f) => f.family));
  assert.equal(familyCoverage(), cov, 'cached');
  for (const [family, set] of cov) {
    assert.ok(set.has(0x41), `${family} has A`);
    assert.ok(set.has(0x219), `${family} has ș`);
  }
});

test('every bundled family draws Romanian text', () => {
  for (const { family } of fontManifest()) assert.deepEqual(missingChars(ROMANIAN, family), [], family);
});

test('missingChars reports CJK and emoji but not ș', () => {
  const m = missingChars('漢 🙂 ș', 'Inter');
  assert.deepEqual(m.map((x) => x.char), ['漢', '🙂']);
  assert.equal(m[0].kind, 'letter');
  assert.deepEqual(m[0].codepoints, ['U+6F22']);
  assert.equal(m[1].kind, 'emoji');
  assert.deepEqual(m[1].codepoints, ['U+1F642']);
});

test('missingChars: distinct graphemes once in order; ZWJ sequences, flags and variation selectors are single graphemes', () => {
  assert.deepEqual(missingChars('漢漢a漢字', 'Inter').map((x) => x.char), ['漢', '字']);
  const family = missingChars('👨‍👩‍👧', 'Inter');
  assert.equal(family.length, 1);
  assert.equal(family[0].kind, 'emoji');
  assert.deepEqual(family[0].codepoints, ['U+1F468', 'U+200D', 'U+1F469', 'U+200D', 'U+1F467']);
  assert.deepEqual(missingChars('🇷🇴', 'Inter').map((x) => x.kind), ['emoji']);
  assert.deepEqual(missingChars('❤️', 'Space Grotesk').map((x) => x.kind).filter((k) => k !== 'emoji'), []);
});

test('missingChars ignores whitespace, control characters, ZWJ and variation selectors', () => {
  const invisible = String.fromCodePoint(0x20, 0x9, 0xa, 0xd, 0xa0, 0x200d, 0xfe0f, 0xfe0e, 0x7);
  assert.deepEqual(missingChars(invisible, 'Inter'), []);
  assert.deepEqual(missingChars('', 'Inter'), []);
});

test('missingChars: an unknown family cannot draw anything but spaces', () => {
  assert.deepEqual(missingChars('a b', 'Comic Sans').map((x) => x.char), ['a', 'b']);
  assert.deepEqual(missingChars('   ', 'Comic Sans'), []);
});

test('missingChars classifies symbols apart from letters', () => {
  const kinds = Object.fromEntries(missingChars('→★≠', 'Anton').map((x) => [x.char, x.kind]));
  for (const k of Object.values(kinds)) assert.ok(k === 'symbol' || k === 'emoji');
  assert.equal(missingChars('Ω', 'Anton')[0]?.kind ?? 'letter', 'letter');
});

// ---- coverageReport ---------------------------------------------------------------------------

test('coverageReport groups by family and character, counts occurrences and keeps the first 3 sample texts', () => {
  const report = coverageReport([
    { text: 'Hello 漢', family: 'Inter' },
    { text: '漢漢 and ș', family: 'Inter' },
    { text: 'Hi 🙂', family: 'Inter' },
    { text: 'Third 漢', family: 'Inter' },
    { text: 'Fourth 漢', family: 'Inter' },
    { text: '漢', family: 'Anton' },
    { text: 'plain', family: 'Anton' },
  ]);
  const find = (family, char) => report.find((r) => r.family === family && r.char === char);
  assert.equal(report.length, 3);
  const inter = find('Inter', '漢');
  assert.equal(inter.count, 5);
  assert.equal(inter.kind, 'letter');
  assert.deepEqual(inter.codepoints, ['U+6F22']);
  assert.deepEqual(inter.samples, ['Hello 漢', '漢漢 and ș', 'Third 漢']);
  assert.equal(find('Inter', '🙂').count, 1);
  assert.equal(find('Inter', '🙂').kind, 'emoji');
  assert.equal(find('Anton', '漢').count, 1);
  assert.equal(find('Inter', 'ș'), undefined);
  assert.deepEqual(coverageReport([]), []);
});
