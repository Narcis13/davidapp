// Builds the tiny test fonts in test/fixtures/fonts/ from nothing: a "skyline" font whose letters are bars (so a text
// drawn with it can never be mistaken for a bundled family), in the formats the studio accepts. The files are
// dedicated to the public domain (CC0 1.0). Run: node scripts/make-test-fonts.mjs
//
//   fixture-blocks-regular.ttf      Fixture Blocks, 400: bars. ASCII and the Romanian letters.
//   fixture-blocks-regular-v2.ttf   the same family and weight with triangles: "version 2" of the file above.
//   fixture-blocks-bold.ttf         Fixture Blocks, 700: wider bars.
//   fixture-slant.woff2             Fixture Slant, 600 italic: slanted bars, wrapped as WOFF2 (null transforms).
//   fixture-wide.otf                Fixture Wide, 400: CFF outlines; ASCII and all of Latin Extended-A (at most 228 glyphs: the CFF charset is the predefined one).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'fonts');

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
const i16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const checksum = (b) => { let s = 0; const p = pad4(b); for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ASCII = range(0x20, 0x7e);
const ROMANIAN = [0xc2, 0xce, 0xe2, 0xee, 0x102, 0x103, 0x218, 0x219, 0x21a, 0x21b];

/** One glyph: advance, and its contour as points (TrueType: clockwise). Bars of five heights; triangles of the same. */
function shape(cp, { kind, adv, inset, slant }) {
  if (cp === 0x20) return { adv: Math.round(adv / 2), pts: [] };
  const h = 300 + ((cp * 7) % 5) * 100;
  const x0 = inset, x1 = adv - inset, xm = adv / 2;
  const skew = (x, y) => Math.round(x + y * slant);
  const pts = kind === 'triangle' ? [[x0, 0], [xm, h], [x1, 0]] : [[x0, 0], [x0, h], [x1, h], [x1, 0]];
  return { adv, pts: pts.map(([x, y]) => [skew(x, y), y]) };
}

/** Glyph list: .notdef (a frame-less bar) then one per code point, in code point order. */
function glyphsOf(cps, style) {
  return [{ cp: -1, ...shape(0x41, style) }, ...cps.map((cp) => ({ cp, ...shape(cp, style) }))];
}

function glyfOf(g) {
  if (!g.pts.length) return Buffer.alloc(0);
  const xs = g.pts.map((p) => p[0]), ys = g.pts.map((p) => p[1]);
  const flags = Buffer.alloc(g.pts.length, 1); // on curve, 16-bit deltas
  const dx = [], dy = [];
  let px = 0, py = 0;
  for (const [x, y] of g.pts) { dx.push(i16(x - px)); dy.push(i16(y - py)); px = x; py = y; }
  return pad4(Buffer.concat([i16(1), i16(Math.min(...xs)), i16(Math.min(...ys)), i16(Math.max(...xs)), i16(Math.max(...ys)), u16(g.pts.length - 1), u16(0), flags, ...dx, ...dy]));
}

function cmapOf(glyphs) {
  // consecutive code points with consecutive glyph ids make one segment
  const segs = [];
  glyphs.forEach((g, gid) => {
    if (g.cp < 0) return;
    const last = segs[segs.length - 1];
    if (last && g.cp === last.end + 1 && gid === last.gid + (g.cp - last.start)) last.end = g.cp; else segs.push({ start: g.cp, end: g.cp, gid });
  });
  segs.push({ start: 0xffff, end: 0xffff, gid: 0, last: true });
  const n = segs.length;
  const entrySelector = Math.floor(Math.log2(n)), searchRange = 2 * 2 ** entrySelector;
  const sub = Buffer.concat([
    u16(4), u16(16 + n * 8), u16(0), u16(n * 2), u16(searchRange), u16(entrySelector), u16(n * 2 - searchRange),
    ...segs.map((s) => u16(s.end)), u16(0), ...segs.map((s) => u16(s.start)),
    ...segs.map((s) => u16(s.last ? 1 : s.gid - s.start)), ...segs.map(() => u16(0)),
  ]);
  const head = Buffer.concat([u16(0), u16(2), u16(0), u16(3), u32(20), u16(3), u16(1), u32(20)]);
  return Buffer.concat([head, sub]);
}

function nameOf(strings) {
  const recs = Object.entries(strings).map(([id, s]) => ({ id: +id, data: Buffer.from(s, 'utf16le').swap16() })).sort((a, b) => a.id - b.id);
  let off = 0;
  const records = recs.map((r) => { const rec = Buffer.concat([u16(3), u16(1), u16(0x409), u16(r.id), u16(r.data.length), u16(off)]); off += r.data.length; return rec; });
  return Buffer.concat([u16(0), u16(recs.length), u16(6 + recs.length * 12), ...records, ...recs.map((r) => r.data)]);
}

/** CFF: one INDEX of items, offsets one byte (or two) wide. */
function index(items, offSize = 1) {
  if (!items.length) return u16(0);
  const offs = [1];
  for (const it of items) offs.push(offs[offs.length - 1] + it.length);
  const enc = (v) => (offSize === 1 ? Buffer.from([v]) : u16(v));
  return Buffer.concat([u16(items.length), Buffer.from([offSize]), ...offs.map(enc), ...items]);
}
const num = (v) => (v >= -107 && v <= 107 ? Buffer.from([v + 139]) : Buffer.concat([Buffer.from([28]), i16(v)]));
const int5 = (v) => Buffer.concat([Buffer.from([29]), u32(v)]);

function cffOf(glyphs, name, bbox) {
  const charstrings = glyphs.map((g) => {
    const w = num(g.adv);
    if (!g.pts.length) return Buffer.concat([w, Buffer.from([14])]);
    const [[x0, y0], ...rest] = g.pts;
    const d = rest.flatMap(([x, y], i) => { const [px, py] = i === 0 ? [x0, y0] : rest[i - 1]; return [x - px, y - py]; });
    return Buffer.concat([w, num(x0), num(y0), Buffer.from([21]), ...d.map(num), Buffer.from([5, 14])]);
  });
  const header = Buffer.from([1, 0, 4, 1]);
  const nameIndex = index([Buffer.from(name, 'latin1')]);
  const strings = u16(0), gsubrs = u16(0);
  const csIndex = index(charstrings, 2);
  const topSize = 4 * 5 + 1 + 5 + 1 + 10 + 1; // FontBBox, CharStrings, Private: every number five bytes, so the size is known
  const topIndexSize = index([Buffer.alloc(topSize)]).length;
  const csOffset = header.length + nameIndex.length + topIndexSize + strings.length + gsubrs.length;
  const privOffset = csOffset + csIndex.length;
  const top = Buffer.concat([...bbox.map(int5), Buffer.from([5]), int5(csOffset), Buffer.from([17]), int5(4), int5(privOffset), Buffer.from([18])]);
  const priv = Buffer.from([139, 20, 139, 21]); // defaultWidthX 0, nominalWidthX 0
  return Buffer.concat([header, nameIndex, index([top]), strings, gsubrs, csIndex, priv]);
}

/** An sfnt file from tables {tag: Buffer}; head's checkSumAdjustment is filled in. */
function sfnt(version, tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let off = 12 + n * 16;
  const records = [], bodies = [];
  for (const tag of tags) {
    const data = tables[tag];
    records.push(Buffer.concat([Buffer.from(tag, 'latin1'), u32(checksum(data)), u32(off), u32(data.length)]));
    bodies.push(pad4(data));
    off += pad4(data).length;
  }
  const entrySelector = Math.floor(Math.log2(n)), searchRange = 2 ** entrySelector * 16;
  const file = Buffer.concat([u32(version), u16(n), u16(searchRange), u16(entrySelector), u16(n * 16 - searchRange), ...records, ...bodies]);
  const at = file.indexOf(tables.head, 12 + n * 16);
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, at + 8);
  return file;
}

/**
 * opts: { family, subfamily, weight, italic, kind ('bar' | 'triangle'), adv, inset, slant, cps, cff (an OpenType file with CFF outlines) }
 */
function build(opts) {
  const { family, subfamily, weight, italic, cps, cff } = opts;
  const glyphs = glyphsOf(cps, opts);
  const bodies = glyphs.map(glyfOf);
  const loca = Buffer.concat([...(() => { let o = 0; const out = [u32(0)]; for (const b of bodies) { o += b.length; out.push(u32(o)); } return out; })()]);
  const xs = glyphs.flatMap((g) => g.pts.map((p) => p[0])), top = 700 + 100;
  const bbox = [Math.min(0, ...xs), 0, Math.max(...glyphs.map((g) => g.adv), ...xs), top];
  const nPts = Math.max(...glyphs.map((g) => g.pts.length));
  const post = full(family, subfamily);
  const head = Buffer.concat([u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0x000b), u16(1000), Buffer.alloc(16), ...bbox.map(i16), u16((weight >= 600 ? 1 : 0) | (italic ? 2 : 0)), u16(8), i16(2), i16(1), i16(0)]);
  const hhea = Buffer.concat([u32(0x00010000), i16(800), i16(-200), i16(0), u16(Math.max(...glyphs.map((g) => g.adv))), i16(0), i16(0), i16(bbox[2]), i16(1), i16(0), i16(0), Buffer.alloc(8), i16(0), u16(glyphs.length)]);
  const maxp = cff ? Buffer.concat([u32(0x00005000), u16(glyphs.length)])
    : Buffer.concat([u32(0x00010000), u16(glyphs.length), u16(nPts), u16(1), u16(0), u16(0), u16(2), ...Array(8).fill(u16(0))]);
  const hmtx = Buffer.concat(glyphs.map((g) => Buffer.concat([u16(g.adv), i16(g.pts.length ? Math.min(...g.pts.map((p) => p[0])) : 0)])));
  const lo = Math.min(...cps), hi = Math.min(0xffff, Math.max(...cps));
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(4, 0); os2.writeInt16BE(Math.round(glyphs.reduce((s, g) => s + g.adv, 0) / glyphs.length), 2); os2.writeUInt16BE(weight, 4); os2.writeUInt16BE(5, 6);
  os2.writeUInt32BE(0x00000001, 42); // Basic Latin
  os2.write('FXTR', 58, 'latin1');
  os2.writeUInt16BE((italic ? 1 : 0) | (weight >= 600 ? 0x20 : 0x40) | 0x80, 62); os2.writeUInt16BE(lo, 64); os2.writeUInt16BE(hi, 66);
  os2.writeInt16BE(800, 68); os2.writeInt16BE(-200, 70); os2.writeUInt16BE(900, 74); os2.writeUInt16BE(250, 76); os2.writeUInt32BE(1, 78);
  os2.writeInt16BE(500, 86); os2.writeInt16BE(700, 88); os2.writeUInt16BE(0x20, 92); os2.writeUInt16BE(1, 94);
  const postTable = Buffer.concat([u32(0x00030000), u32(italic ? 0xffec0000 : 0), i16(-100), i16(50), u32(0), Buffer.alloc(16)]);
  const names = nameOf({
    0: 'Public domain (CC0 1.0). Generated by scripts/make-test-fonts.mjs.', 1: family, 2: subfamily, 4: `${family} ${subfamily}`, 6: post,
    13: 'Dedicated to the public domain under CC0 1.0: you may use it for any purpose.', 14: 'https://creativecommons.org/publicdomain/zero/1.0/',
  });
  const common = { head, hhea, maxp, hmtx, 'OS/2': os2, cmap: cmapOf(glyphs), name: names, post: postTable };
  return cff
    ? sfnt(0x4f54544f, { ...common, 'CFF ': cffOf(glyphs, post, bbox) })
    : sfnt(0x00010000, { ...common, glyf: Buffer.concat(bodies), loca });
}

const full = (family, sub) => `${family.replace(/ /g, '')}-${sub.replace(/ /g, '')}`;

const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF '];
const base128 = (v) => { const out = [v & 0x7f]; for (v = Math.floor(v / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v & 0x7f) | 0x80); return Buffer.from(out); };

/** A WOFF2 wrapper around a TrueType file: every table kept as it is (glyf and loca with transform version 3, the null transform). */
function woff2(ttf) {
  const n = ttf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    tables.push({ tag: ttf.toString('latin1', rec, rec + 4), data: ttf.subarray(ttf.readUInt32BE(rec + 8), ttf.readUInt32BE(rec + 8) + ttf.readUInt32BE(rec + 12)) });
  }
  const dir = Buffer.concat(tables.map((t) => {
    const index = WOFF2_TAGS.indexOf(t.tag);
    const nullTransform = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0;
    return Buffer.concat([Buffer.from([index | (nullTransform << 6)]), base128(t.data.length)]);
  }));
  const compressed = brotliCompressSync(Buffer.concat(tables.map((t) => t.data)));
  const total = 12 + n * 16 + tables.reduce((s, t) => s + pad4(t.data).length, 0);
  const length = 48 + dir.length + pad4(compressed).length;
  const header = Buffer.concat([Buffer.from('wOF2'), u32(ttf.readUInt32BE(0)), u32(length), u16(n), u16(0), u32(total), u32(compressed.length), u16(1), u16(0), Buffer.alloc(20)]);
  return Buffer.concat([header, dir, pad4(compressed)]);
}

const bars = { kind: 'bar', adv: 600, inset: 60, slant: 0 };
const files = {
  'fixture-blocks-regular.ttf': build({ ...bars, family: 'Fixture Blocks', subfamily: 'Regular', weight: 400, italic: false, cps: [...ASCII, ...ROMANIAN].sort((a, b) => a - b) }),
  'fixture-blocks-regular-v2.ttf': build({ ...bars, kind: 'triangle', family: 'Fixture Blocks', subfamily: 'Regular', weight: 400, italic: false, cps: [...ASCII, ...ROMANIAN].sort((a, b) => a - b) }),
  'fixture-blocks-bold.ttf': build({ ...bars, adv: 720, inset: 30, family: 'Fixture Blocks', subfamily: 'Bold', weight: 700, italic: false, cps: [...ASCII, ...ROMANIAN].sort((a, b) => a - b) }),
  'fixture-slant.woff2': woff2(build({ ...bars, slant: 0.25, family: 'Fixture Slant', subfamily: 'SemiBold Italic', weight: 600, italic: true, cps: ASCII })),
  'fixture-wide.otf': build({ ...bars, kind: 'triangle', adv: 640, cff: true, family: 'Fixture Wide', subfamily: 'Regular', weight: 400, italic: false, cps: [...ASCII, ...range(0x100, 0x17f)] }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
writeFileSync(join(OUT, 'LICENSE.txt'), 'These test fonts were generated by scripts/make-test-fonts.mjs.\nThey are dedicated to the public domain under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/).\n');
