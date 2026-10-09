// Which characters a bundled font can draw: a small sfnt/woff/woff2 cmap reader (Node only) and the
// questions built on it ("what in this text would fall back to a system font or draw as a box?").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, inflateSync } from 'node:zlib';
import { fontManifest, FONTS_DIR } from './host.js';

const MAX_CP = 0x10ffff;

/** The 63 table tags a WOFF2 directory entry can name by index (WOFF2 spec, "Table Directory"). */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const tagAt = (b, o) => b.toString('latin1', o, o + 4);

/** Bounds-checked slice: a Buffer.subarray that throws instead of silently truncating. */
function slice(buf, start, length, what) {
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > buf.length) throw new RangeError(`${what} lies outside the file`);
  return buf.subarray(start, start + length);
}

/** @returns {Map<string, Buffer>} the sfnt tables of an OpenType/TrueType file (first font of a collection). */
function sfntTables(buf) {
  let base = 0;
  if (tagAt(buf, 0) === 'ttcf') base = buf.readUInt32BE(12);
  const n = buf.readUInt16BE(base + 4);
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const rec = base + 12 + i * 16;
    tables.set(tagAt(buf, rec), slice(buf, buf.readUInt32BE(rec + 8), buf.readUInt32BE(rec + 12), `table '${tagAt(buf, rec)}'`));
  }
  return tables;
}

/** @returns {Map<string, Buffer>} the tables of a WOFF 1.0 file (zlib per table). */
function woffTables(buf) {
  const n = buf.readUInt16BE(12);
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const rec = 44 + i * 20;
    const tag = tagAt(buf, rec);
    const offset = buf.readUInt32BE(rec + 4);
    const comp = buf.readUInt32BE(rec + 8);
    const orig = buf.readUInt32BE(rec + 12);
    const data = slice(buf, offset, comp, `table '${tag}'`);
    tables.set(tag, comp < orig ? inflateSync(data) : data);
  }
  return tables;
}

/** @returns {Map<string, Buffer>} the tables of a WOFF2 file; transformed tables (glyf, loca, hmtx) are returned undecoded under their tag. */
function woff2Tables(buf) {
  const n = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let pos = 48;
  const readBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf.readUInt8(pos++);
      if (i === 0 && byte === 0x80) throw new RangeError('UIntBase128 has a leading zero');
      if (value > 0x1ffffff) throw new RangeError('UIntBase128 overflows 32 bits');
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new RangeError('UIntBase128 is longer than 5 bytes');
  };
  const dir = [];
  for (let i = 0; i < n; i++) {
    const flags = buf.readUInt8(pos++);
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag;
    if (index === 63) { tag = tagAt(buf, pos); pos += 4; } else tag = WOFF2_TAGS[index];
    const origLength = readBase128();
    // glyf/loca are transformed unless version 3; every other table only when version is not 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? readBase128() : origLength;
    dir.push({ tag, length });
  }
  const stream = brotliDecompressSync(slice(buf, pos, compressedSize, 'compressed table stream'));
  const tables = new Map();
  let at = 0;
  for (const { tag, length } of dir) {
    tables.set(tag, slice(stream, at, length, `table '${tag}'`));
    at += length;
  }
  return tables;
}

/** Add every code point with a non-zero glyph from one cmap subtable at `o` into `out`. */
function readSubtable(cmap, o, out) {
  const format = cmap.readUInt16BE(o);
  const add = (cp) => { if (cp >= 0 && cp <= MAX_CP) out.add(cp); };
  if (format === 0) {
    for (let c = 0; c < 256; c++) if (cmap.readUInt8(o + 6 + c)) add(c);
  } else if (format === 4) {
    const segCount = cmap.readUInt16BE(o + 6) / 2;
    const endAt = o + 14;
    const startAt = endAt + segCount * 2 + 2;
    const deltaAt = startAt + segCount * 2;
    const rangeAt = deltaAt + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = cmap.readUInt16BE(endAt + s * 2);
      const start = cmap.readUInt16BE(startAt + s * 2);
      const delta = cmap.readUInt16BE(deltaAt + s * 2);
      const rangeOffset = cmap.readUInt16BE(rangeAt + s * 2);
      for (let c = start; c <= end && c < 0xffff; c++) {
        if (rangeOffset === 0) {
          if (((c + delta) & 0xffff) !== 0) add(c);
        } else {
          const gid = cmap.readUInt16BE(rangeAt + s * 2 + rangeOffset + (c - start) * 2);
          if (gid !== 0 && ((gid + delta) & 0xffff) !== 0) add(c);
        }
      }
    }
  } else if (format === 6) {
    const first = cmap.readUInt16BE(o + 6);
    const count = cmap.readUInt16BE(o + 8);
    for (let i = 0; i < count; i++) if (cmap.readUInt16BE(o + 10 + i * 2)) add(first + i);
  } else if (format === 12) {
    const groups = cmap.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const at = o + 16 + g * 12;
      const start = cmap.readUInt32BE(at);
      const end = Math.min(cmap.readUInt32BE(at + 4), MAX_CP);
      const glyph = cmap.readUInt32BE(at + 8);
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) add(c);
    }
  } else return false;
  return true;
}

/** Lower is better: a full-range Unicode subtable beats a BMP one beats the legacy Unicode platform. */
function rank(platform, encoding) {
  if (platform === 3 && encoding === 10) return 0;
  if (platform === 0 && (encoding === 4 || encoding === 6)) return 1;
  if (platform === 3 && encoding === 1) return 2;
  if (platform === 0) return 3;
  return -1;
}

/**
 * The Unicode code points a font file covers, from its cmap: woff2 (Brotli), woff (zlib per table) or
 * ttf/otf (sfnt). cmap subtable formats 0, 4, 6 and 12 (preferring a Unicode platform 3/10, 3/1 or 0/x
 * subtable). Throws Error('<name>: not a font file …') on bad input.
 * @param {Buffer | Uint8Array} buffer
 * @param {string} [name]
 * @returns {Set<number>}
 */
export function readCoverage(buffer, name = 'font') {
  const bad = (why) => new Error(`${name}: not a font file (${why})`);
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buf.length < 12) throw bad(`only ${buf.length} bytes`);
  try {
    const magic = tagAt(buf, 0);
    let tables;
    if (magic === 'wOF2') tables = woff2Tables(buf);
    else if (magic === 'wOFF') tables = woffTables(buf);
    else if (magic === 'OTTO' || magic === 'true' || magic === 'ttcf' || buf.readUInt32BE(0) === 0x00010000) tables = sfntTables(buf);
    else throw bad(`unknown signature ${JSON.stringify(magic)}`);
    const cmap = tables.get('cmap');
    if (!cmap) throw bad('no cmap table');
    const n = cmap.readUInt16BE(2);
    const candidates = [];
    for (let i = 0; i < n; i++) {
      const rec = 4 + i * 8;
      const platform = cmap.readUInt16BE(rec);
      const encoding = cmap.readUInt16BE(rec + 2);
      const r = rank(platform, encoding);
      if (r >= 0) candidates.push({ r, offset: cmap.readUInt32BE(rec + 4) });
    }
    candidates.sort((a, b) => a.r - b.r);
    for (const { offset } of candidates) {
      const out = new Set();
      if (readSubtable(cmap, offset, out)) return out;
    }
    throw bad('no Unicode cmap subtable in format 0, 4, 6 or 12');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`${name}: not a font file`)) throw e;
    throw bad(e instanceof Error ? e.message : String(e));
  }
}

/** @type {Map<string, Set<number>> | undefined} */
let coverage;
/**
 * Coverage per bundled family: the union of its latin files and its latin-ext files, from fonts/fonts.json. Cached.
 * @returns {Map<string, Set<number>>}
 */
export function familyCoverage() {
  if (coverage) return coverage;
  const map = new Map();
  for (const fam of fontManifest()) {
    const set = new Set();
    for (const f of [...fam.files, ...(fam.ext?.files ?? [])]) {
      for (const cp of readCoverage(readFileSync(join(FONTS_DIR, f.file)), f.file)) set.add(cp);
    }
    map.set(fam.family, set);
  }
  return (coverage = map);
}

/** @typedef {{ char: string, codepoints: string[], kind: 'emoji' | 'letter' | 'symbol' }} MissingChar */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const IGNORED_CP = new Set([0x200d, 0xfe0e, 0xfe0f]); // ZWJ, text and emoji variation selectors
const IGNORED = /^[\p{White_Space}\p{Cc}]$/u;
const PICTO = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1f1e6}-\u{1f1ff}]$/u;
const LETTER = /^[\p{L}\p{M}\p{N}]$/u;
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** Every uncovered grapheme of `text` in order, repeats included. */
function scan(text, family) {
  const covered = familyCoverage().get(family);
  const out = [];
  for (const { segment } of segmenter.segment(String(text))) {
    const cps = [...segment].map((c) => c.codePointAt(0));
    const real = cps.filter((cp) => !IGNORED_CP.has(cp) && !IGNORED.test(String.fromCodePoint(cp)));
    if (!real.length) continue;
    const base = String.fromCodePoint(real[0]);
    const emoji = PICTO.test(base) || cps.includes(0x20e3);
    const missing = !covered || (emoji ? !covered.has(real[0]) : real.some((cp) => !covered.has(cp)));
    if (missing) out.push({ char: segment, codepoints: cps.map(hex), kind: emoji ? 'emoji' : LETTER.test(base) ? 'letter' : 'symbol' });
  }
  return out;
}

/**
 * The characters of `text` that `family` cannot draw, as graphemes: each distinct grapheme once, in order
 * of appearance. An unknown family cannot draw any non-space character. Whitespace, control characters,
 * ZWJ and variation selectors are ignored. `codepoints` lists every code point of the grapheme; `kind` is
 * 'emoji' for a pictographic base (reported when that base is uncovered), else 'letter' (letters, marks,
 * digits) or 'symbol' (punctuation and everything else).
 * @param {string} text
 * @param {string} family
 * @returns {MissingChar[]}
 */
export function missingChars(text, family) {
  const seen = new Set();
  return scan(text, family).filter((m) => !seen.has(m.char) && seen.add(m.char));
}

/**
 * What an asset or clip draws, checked against the fonts it draws it in.
 * `count` is the total number of occurrences across all the entries; `samples` the first 3 distinct texts it appears in.
 * @param {{ text: string, family: string }[]} entries
 * @returns {{ family: string, char: string, codepoints: string[], kind: MissingChar['kind'], count: number, samples: string[] }[]}
 */
export function coverageReport(entries) {
  const groups = new Map();
  for (const { text, family } of entries) {
    for (const m of scan(text, family)) {
      const key = `${family}\u0000${m.char}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { family, ...m, count: 0, samples: [] }));
      g.count++;
      if (g.samples.length < 3 && !g.samples.includes(text)) g.samples.push(text);
    }
  }
  return [...groups.values()];
}
