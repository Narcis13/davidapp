// The isomorphic core: parameter schemas, seeded randomness, static checks, text layout and
// composition structure. No database and no workers here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchema, resolveParams, walkParams, mapParams, SchemaError } from '../src/core/schema.js';
import { createRng, hashSeed } from '../src/core/rng.js';
import { staticCheck, stripLiterals } from '../src/core/static-check.js';
import { normalizeComposition, reformat } from '../src/core/composition.js';
import { createText, graphemes } from '../src/core/lib/text.js';
import * as color from '../src/core/lib/color.js';
import * as beat from '../src/core/lib/beat.js';
import { parseRef, safeZone, formatOf } from '../src/core/engine.js';
import { createCanvas, registerFonts } from '../src/render/host.js';

registerFonts();
const ctx = createCanvas(16, 16).getContext('2d');

test('schema: declarations are normalized and defaults filled', () => {
  const s = normalizeSchema({
    size: { type: 'number', min: 8, max: 400 },
    mode: { type: 'enum', options: ['up', 'down'] },
    items: { type: 'array', of: { type: 'string' }, default: ['a'], maxItems: 3 },
    style: { type: 'object', fields: { color: { type: 'color', default: '#ff0000' }, bold: { type: 'boolean' } } },
    reveal: { type: 'asset', kind: 'visual', default: 'text-reveal' },
  });
  assert.equal(s.size.default, 8);
  assert.equal(s.mode.default, 'up');
  assert.deepEqual(s.style.default, { color: '#ff0000', bold: false });
  const { values, errors } = resolveParams(s, { size: 100, style: { bold: true } });
  assert.deepEqual(errors, []);
  assert.deepEqual(values, { size: 100, mode: 'up', items: ['a'], style: { color: '#ff0000', bold: true }, reveal: 'text-reveal' });
});

test('schema: bad declarations are rejected with the parameter path', () => {
  assert.throws(() => normalizeSchema({ size: { type: 'numbr' } }), (e) => e instanceof SchemaError && /params\.size: unknown type/.test(e.message));
  assert.throws(() => normalizeSchema({ mode: { type: 'enum', options: [] } }), /enum needs options/);
  assert.throws(() => normalizeSchema({ c: { type: 'color', default: 'reddish' } }), /params\.c\.default: expected a CSS color/);
  assert.throws(() => normalizeSchema({ n: { type: 'number', min: 5, max: 1 } }), /min is greater than max/);
  assert.throws(() => normalizeSchema({ n: { type: 'number', minimum: 5 } }), /unknown key "minimum"/);
  assert.throws(() => normalizeSchema({ 'bad-name': { type: 'number' } }), /not a valid parameter name/);
});

test('schema: values are validated; strict mode reports ranges, lenient mode clamps', () => {
  const s = normalizeSchema({ size: { type: 'number', min: 8, max: 400, default: 64 }, text: { type: 'string', default: '' }, n: { type: 'integer', default: 1 } });
  assert.deepEqual(resolveParams(s, { size: 900 }).values.size, 400);
  const strict = resolveParams(s, { size: 900, text: 5, extra: 1, n: 1.5 }, { strict: true });
  assert.deepEqual(strict.errors.map((e) => e.path).sort(), ['extra', 'n', 'size', 'text']);
  assert.match(strict.errors.find((e) => e.path === 'size').message, /above the maximum 400/);
  assert.match(strict.errors.find((e) => e.path === 'extra').message, /unknown parameter \(known: size, text, n\)/);
});

test('schema: walkParams and mapParams reach nested asset references', () => {
  const s = normalizeSchema({ bg: { type: 'asset', default: 'grid' }, rows: { type: 'array', of: { type: 'object', fields: { icon: { type: 'image' }, anim: { type: 'asset', default: 'pop' } } }, default: [] } });
  const values = { rows: [{ icon: 'logo' }, { anim: 'slide@2' }] };
  const seen = [];
  walkParams(s, values, ['asset', 'image'], (v, def, path) => seen.push(`${path}=${v}`));
  assert.deepEqual(seen, ['bg=grid', 'rows[0].icon=logo', 'rows[0].anim=pop', 'rows[1].anim=slide@2']);
  const mapped = mapParams(s, values, ['asset', 'image'], (v) => (v.includes('@') ? v : `${v}@1`));
  assert.deepEqual(mapped, { rows: [{ icon: 'logo@1' }, { anim: 'slide@2' }] });
});

test('rng: the same seed gives the same sequence, forks are independent', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const seq = (r) => Array.from({ length: 5 }, () => r());
  const sa = seq(a);
  assert.deepEqual(sa, seq(b));
  assert.notDeepEqual(sa, seq(c));
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  assert.equal(createRng(7).fork('x')(), createRng(7).fork('x')());
  assert.notEqual(createRng(7).fork('x')(), createRng(7).fork('y')());
  assert.equal(hashSeed(1, 'a', 2), hashSeed(1, 'a', 2));
  assert.notEqual(hashSeed(1, 'a', 2), hashSeed(1, 'a', 3));
  const ints = Array.from({ length: 200 }, () => a.int(1, 3));
  assert.deepEqual([...new Set(ints)].sort(), [1, 2, 3]);
  assert.deepEqual(createRng(5).shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
});

test('static check: impure code is rejected with the line and what to use instead', () => {
  const ok = `asset({ description: 'fine', render(f) { const s = "Math.random() in a string"; // Date.now() in a comment\n } })`;
  assert.deepEqual(staticCheck(ok), []);
  const bad = staticCheck(`asset({\n render(f) {\n  const x = Math.random();\n  const t = Date.now();\n  setTimeout(() => {}, 1);\n } })`);
  assert.deepEqual(bad.map((p) => p.line), [3, 4, 5]);
  assert.match(bad[0].message, /f\.rng\(\)/);
  assert.match(staticCheck('const x = 1;')[0].message, /never calls asset/);
  assert.match(staticCheck('')[0].message, /empty/);
  assert.equal(stripLiterals('a = "x//y"; // c').trimEnd(), 'a = "    ";');
});

test('text: words wrap inside the box and never overflow it', () => {
  const T = createText();
  const L = T.layout(ctx, 'The quick brown fox jumps over the lazy dog', { font: 'Inter', weight: 800, size: 60, maxWidth: 400 });
  assert.ok(L.lines.length > 1);
  for (const line of L.lines) assert.ok(line.width <= 400.01, `line "${line.text}" is ${line.width}px`);
  assert.equal(L.words.length, 9);
  assert.equal(L.height, L.lines.length * 60 * 1.15);
  assert.equal(L.lines.map((l) => l.text).join(' '), 'The quick brown fox jumps over the lazy dog');
});

test('text: a word wider than the box breaks between graphemes', () => {
  const T = createText();
  const L = T.layout(ctx, 'Supercalifragilistic', { font: 'Inter', size: 60, maxWidth: 200 });
  assert.ok(L.lines.length > 1);
  for (const line of L.lines) assert.ok(line.width <= 200.01);
  assert.equal(L.lines.map((l) => l.text).join(''), 'Supercalifragilistic');
});

test('text: fit shrinks the size until the block fits the box', () => {
  const T = createText();
  const text = 'Every frame is a function of time and parameters';
  const big = T.layout(ctx, text, { font: 'Inter', size: 200, maxWidth: 600, maxHeight: 300 });
  assert.ok(big.height > 300);
  const L = T.layout(ctx, text, { font: 'Inter', size: 200, maxWidth: 600, maxHeight: 300, fit: true });
  assert.ok(L.size < 200 && L.size >= 8);
  assert.ok(L.height <= 300.5 && L.width <= 600.5, `${L.width}x${L.height}`);
  // and it is the largest size that fits, within a pixel
  const larger = T.layout(ctx, text, { font: 'Inter', size: L.size + 1.5, maxWidth: 600, maxHeight: 300 });
  assert.ok(larger.height > 300.5 || larger.width > 600.5);
});

test('text: fit shrinks a long word rather than breaking it', () => {
  const T = createText();
  const L = T.layout(ctx, 'Compounding', { font: 'Inter', weight: 800, size: 300, maxWidth: 500, fit: true });
  assert.equal(L.lines.length, 1);
  assert.ok(!L.broken && L.width <= 500.5 && L.size < 300);
});

test('text: leading whitespace is kept as indentation', () => {
  const T = createText();
  const L = T.layout(ctx, 'a {\n  b\n}', { font: 'JetBrains Mono', size: 40 });
  assert.equal(L.lines.length, 3);
  const cell = T.measure(ctx, 'a', { font: 'JetBrains Mono', size: 40 });
  assert.ok(Math.abs(L.words[2].x - 2 * cell) < 0.5, `indent is ${L.words[2].x}, expected ${2 * cell}`);
  assert.equal(L.words[3].x, 0);
});

test('text: maxLines truncates with an ellipsis; fit avoids truncation', () => {
  const T = createText();
  const text = 'one two three four five six seven eight nine ten';
  const L = T.layout(ctx, text, { font: 'Inter', size: 40, maxWidth: 200, maxLines: 2 });
  assert.equal(L.lines.length, 2);
  assert.ok(L.truncated);
  assert.ok(L.lines[1].text.endsWith('…'));
  assert.ok(L.lines[1].width <= 200.01);
  const F = T.layout(ctx, text, { font: 'Inter', size: 40, maxWidth: 200, maxLines: 2, fit: true });
  assert.ok(!F.truncated && F.lines.length <= 2 && F.size < 40);
});

test('text: alignment, emphasis runs in a second font, and glyph positions', () => {
  const T = createText();
  const L = T.layout(ctx, 'A *bold* move', { font: 'Inter', size: 50, maxWidth: 800, align: 'center', markup: true, emFont: 'Playfair Display', emItalic: true, emWeight: 700 });
  assert.equal(L.lines.length, 1);
  assert.ok(Math.abs(L.lines[0].x - (800 - L.lines[0].width) / 2) < 0.01);
  assert.deepEqual(L.words.map((w) => [w.text, w.em]), [['A', false], ['bold', true], ['move', false]]);
  assert.match(L.words[1].font, /italic 700 50px "Playfair Display"/);
  assert.match(L.words[0].font, /^400 50px "Inter"/);
  // glyphs advance left to right and stay inside their word
  const w = L.words[1];
  assert.equal(w.glyphs.map((g) => g.ch).join(''), 'bold');
  for (let i = 1; i < w.glyphs.length; i++) assert.ok(w.glyphs[i].x > w.glyphs[i - 1].x);
  const last = w.glyphs[w.glyphs.length - 1];
  assert.ok(Math.abs(last.x + last.width - (w.x + w.width)) < 0.01);
  // positions count the spaces between words, like typed characters
  assert.equal(L.length, 'A bold move'.length);
  assert.equal(L.glyphs[L.glyphs.length - 1].pos, 'A bold move'.length - 1);
  // right alignment and letter spacing
  const R = T.layout(ctx, 'Hi', { font: 'Inter', size: 50, maxWidth: 300, align: 'right' });
  assert.ok(Math.abs(R.lines[0].x + R.lines[0].width - 300) < 0.01);
  const S = T.layout(ctx, 'Hi', { font: 'Inter', size: 50, letterSpacing: 0.2 });
  assert.ok(Math.abs(S.width - (T.measure(ctx, 'Hi', { font: 'Inter', size: 50 }) + 10)) < 0.5);
});

test('text: emoji and ZWJ sequences are single graphemes; explicit newlines break lines', () => {
  assert.deepEqual(graphemes('a👩‍💻🚀é'), ['a', '👩‍💻', '🚀', 'é']);
  const T = createText();
  const L = T.layout(ctx, 'Ship it 🚀\nnow', { font: 'Inter', size: 40 });
  assert.equal(L.lines.length, 2);
  assert.equal(L.words[2].glyphs.length, 1);
  assert.ok(L.words[2].width > 20, 'the emoji has a real width (fallback font)');
  const E = T.layout(ctx, 'a\n\nb', { font: 'Inter', size: 40 });
  assert.equal(E.lines.length, 3);
});

test('color and beat helpers', () => {
  assert.deepEqual(color.parse('#f00'), [255, 0, 0, 1]);
  assert.deepEqual(color.parse('#00ff0080').map((v) => +v.toFixed(2)), [0, 255, 0, 0.5]);
  assert.deepEqual(color.parse('rgba(1, 2, 3, 0.25)'), [1, 2, 3, 0.25]);
  assert.deepEqual(color.parse('hsl(120, 100%, 50%)').map(Math.round), [0, 255, 0, 1]);
  assert.equal(color.mix('#000000', '#ffffff', 0.5), 'rgba(128,128,128,1)');
  assert.equal(color.alpha('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
  assert.equal(color.onColor('#ffffff'), '#0b0b12');
  const beats = [0.5, 1, 1.5];
  assert.equal(beat.at(0.2, beats), null);
  assert.equal(beat.at(1.2, beats).index, 1);
  assert.ok(Math.abs(beat.at(1.25, beats).phase - 0.5) < 1e-9);
  assert.equal(beat.pulse(1, beats), 1);
  assert.ok(beat.pulse(1.4, beats) < 0.2);
  assert.equal(beat.count(1.6, beats), 3);
});

test('engine: references, formats and safe zones', () => {
  assert.deepEqual(parseRef('text-reveal@3'), { slug: 'text-reveal', version: 3 });
  assert.deepEqual(parseRef('easing'), { slug: 'easing', version: null });
  assert.throws(() => parseRef('Bad Ref'), /Invalid asset reference/);
  assert.equal(formatOf(1080, 1920), 'vertical');
  assert.equal(formatOf(640, 360), 'custom');
  const s = safeZone(1080, 1920);
  assert.deepEqual([s.x, s.y, s.width, s.height], [72, 250, 936, 1270]);
});

test('composition: structure is validated with paths, and normalized', () => {
  const bad = normalizeComposition({ format: 'wide', fps: 500, duration: 500, tracks: [{ type: 'visual', items: [{ asset: 'Bad Ref', start: -1 }, { id: 'a', asset: 'x', start: 0, duration: 1 }, { id: 'a', asset: 'x', start: 0, duration: 1 }] }] });
  const paths = bad.errors.map((e) => e.path);
  for (const p of ['format', 'fps', 'duration', 'tracks[0].items[0].asset', 'tracks[0].items[0].start', 'tracks[0].items[2].id']) assert.ok(paths.includes(p), `missing error for ${p}: ${paths}`);
  assert.equal(bad.composition, null);
  const ok = normalizeComposition({ format: 'vertical', duration: 10, tracks: [{ type: 'text', items: [{ asset: 'title', start: 2, params: { text: 'x' }, fadeIn: 0.5 }] }, { type: 'audio', items: [{ asset: 'music@2', gain: 0.5 }] }] });
  assert.deepEqual(ok.errors, []);
  const c = ok.composition;
  assert.equal(c.width, 1080); assert.equal(c.height, 1920); assert.equal(c.fps, 30);
  assert.deepEqual(c.tracks[0].items[0], { id: 'track-1-1', asset: 'title', start: 2, duration: 8, params: { text: 'x' }, fadeIn: 0.5 });
  assert.equal(c.tracks[1].items[0].gain, 0.5);
  const late = normalizeComposition({ format: 'square', duration: 5, tracks: [{ items: [{ asset: 'a', start: 4, duration: 3 }] }] });
  assert.match(late.errors[0].message, /after the clip ends/);
  assert.equal(normalizeComposition({ format: 'vertical', duration: 121, tracks: [] }).errors[0].path, 'duration');
  const h = reformat(c, 'horizontal');
  assert.equal(h.width, 1920); assert.equal(c.width, 1080);
});
