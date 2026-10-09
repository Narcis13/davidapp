// Narration words: script words, canonical numerals, importing word timings from the shapes services
// return, aligning a take to the script, checking a transcript against it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptWords, normalizeText, importWords, alignWords, checkTranscript } from '../src/core/words.js';

const same = (a, b) => assert.deepEqual(normalizeText(a), normalizeText(b), `"${a}" should read as "${b}"`);
const differ = (a, b) => assert.notDeepEqual(normalizeText(a), normalizeText(b), `"${a}" should not read as "${b}"`);

/** Timed words for a script's words: word k at 0.5 k for 0.4 s. */
const timedOf = (text) => text.split(/\s+/).map((t, k) => ({ text: t, start: k * 0.5, end: k * 0.5 + 0.4 }));

test('scriptWords: whitespace separates, punctuation stays attached, numbers and hyphens stay whole', () => {
  const w = scriptWords('It reached 3.5 dB, 1,000 times — "e-mail" is 14% of $5; don\'t worry about Fablecut\'s ă.');
  assert.deepEqual(w.map((x) => x.text), ['It', 'reached', '3.5', 'dB,', '1,000', 'times', '—', '"e-mail"', 'is', '14%', 'of', '$5;', "don't", 'worry', 'about', "Fablecut's", 'ă.']);
  assert.deepEqual(w.map((x) => x.i), w.map((_, k) => k));
  const by = Object.fromEntries(w.map((x) => [x.text, x.norm]));
  assert.deepEqual(by['3.5'], ['3.5']);
  assert.deepEqual(by['dB,'], ['db']);
  assert.deepEqual(by['1,000'], ['1000']);
  assert.deepEqual(by['—'], []);
  assert.deepEqual(by['"e-mail"'], ['e', 'mail']);
  assert.deepEqual(by['14%'], ['14', 'percent']);
  assert.deepEqual(by['$5;'], ['5', 'dollar']);
  assert.deepEqual(by["don't"], ['dont']);
  assert.deepEqual(by["Fablecut's"], ['fablecuts']);
  assert.deepEqual(by['ă.'], ['a']);
  assert.deepEqual(scriptWords('  \n\t '), []);
  assert.equal(scriptWords('a b\r\nc').length, 3);
});

test('scriptWords: a number written over several words shares its token', () => {
  const w = scriptWords('in twenty twenty-six we');
  assert.deepEqual(w.map((x) => x.norm), [['in'], ['2026'], ['2026'], ['we']]);
});

test('normalizeText: case, punctuation, diacritics', () => {
  assert.deepEqual(normalizeText('Hello, WORLD! (really?)'), ['hello', 'world', 'really']);
  assert.deepEqual(normalizeText("Don't — it's “fine”"), ['dont', 'its', 'fine']);
  assert.deepEqual(normalizeText('Ședința începe în Brașov, é à ü'), ['sedinta', 'incepe', 'in', 'brasov', 'e', 'a', 'u']);
  assert.deepEqual(normalizeText('Ţară și ŞTIRI', { language: 'ro' }), ['tara', 'si', 'stiri']);
  assert.deepEqual(normalizeText('U.S.A. e-mail'), ['usa', 'e', 'mail']);
  assert.deepEqual(normalizeText(''), []);
});

test('normalizeText: numerals have one canonical form (digits) however they are said or written', () => {
  const groups = [
    ['14', 'fourteen', 'Fourteen.'],
    ['2026', 'two thousand twenty six', 'two thousand and twenty-six', 'twenty twenty-six', 'twenty twenty six', 'Twenty twenty-six,'],
    ['1999', 'nineteen ninety-nine', 'nineteen ninety nine'],
    ['2005', 'twenty oh five', 'two thousand five', 'two thousand and five'],
    ['3.5', 'three point five', '3.50'],
    ['1,000', 'one thousand', 'a thousand', '1000'],
    ['14%', 'fourteen percent', '14 percent'],
    ['1st', 'first', '1st.'],
    ['21st', 'twenty-first', 'twenty first'],
    ['$5', 'five dollars', '5 dollars', '5 dollar'],
    ['105', 'one hundred and five', 'one hundred five'],
    ['200,000', 'two hundred thousand', 'two hundred thousand'],
    ['2,500,000', 'two point five million', '2.5 million', 'two million five hundred thousand'],
    ['-1', 'minus one'],
    ['0.5', 'zero point five', '0.50'],
    ['1,234,567', 'one million two hundred thirty-four thousand five hundred sixty-seven'],
    ['100', 'a hundred', 'one hundred'],
    ['3 billion', 'three billion', '3,000,000,000'],
  ];
  for (const g of groups) for (const x of g) assert.deepEqual(normalizeText(x.replace(/^3 billion$/, '3000000000')), normalizeText(g[0].replace(/^3 billion$/, '3000000000')), `"${x}" vs "${g[0]}"`);
  assert.deepEqual(normalizeText('14'), ['14']);
  assert.deepEqual(normalizeText('two thousand twenty six'), ['2026']);
  assert.deepEqual(normalizeText('1,000 and 14% and $5 and 1st'), ['1000', 'and', '14', 'percent', 'and', '5', 'dollar', 'and', '1st']);
  assert.deepEqual(normalizeText('we shipped in nineteen ninety-nine and twenty twenty-six'), ['we', 'shipped', 'in', '1999', 'and', '2026']);
});

test('normalizeText: different numbers stay different', () => {
  differ('fourteen', 'forty');
  differ('fourteen', 'fifteen');
  differ('14', '41');
  differ('twenty', 'two thousand');
  differ('2026', 'twenty twenty five');
  differ('3.5', 'three point six');
  differ('1,000', 'one hundred');
  differ('14%', '14 dollars');
  differ('first', 'second');
  differ('one hundred and five', 'one hundred and fifty');
  differ('twenty one', 'twenty two');
  assert.deepEqual(normalizeText('twenty one'), ['21']);
  assert.deepEqual(normalizeText('one two three'), ['1', '2', '3']);
  assert.deepEqual(normalizeText('ten thirty'), ['10', '30']); // a time is not a year
  assert.deepEqual(normalizeText('a cat and a hat'), ['a', 'cat', 'and', 'a', 'hat']);
});

test('normalizeText: other languages fold diacritics and pass digits through', () => {
  same('14', '14');
  assert.deepEqual(normalizeText('Avem 14 mere și 3,5 kg, 1.000 lei', { language: 'ro' }), ['avem', '14', 'mere', 'si', '3.5', 'kg', '1000', 'lei']);
  assert.deepEqual(normalizeText('fourteen', { language: 'ro' }), ['fourteen']);
  assert.deepEqual(normalizeText('Zażółć gęślą', { language: 'pl' }), ['zazolc', 'gesla']);
});

// ---------------------------------------------------------------- importWords

const HELLO = [
  { text: 'Hello,', start: 0.08, end: 0.4 },
  { text: 'world.', start: 0.48, end: 0.96 },
];

test('importWords: Deepgram-like response', () => {
  const dg = {
    metadata: { request_id: 'abc', duration: 1.2, channels: 1 },
    results: { channels: [{ alternatives: [{
      transcript: 'hello world', confidence: 0.99,
      words: [
        { word: 'hello', start: 0.08, end: 0.4, confidence: 0.98, punctuated_word: 'Hello,' },
        { word: 'world', start: 0.48, end: 0.96, confidence: 0.99, punctuated_word: 'world.' },
      ],
    }] }] },
  };
  assert.deepEqual(importWords(dg), { words: HELLO, source: 'word-list' });
});

test('importWords: OpenAI verbose_json-like response', () => {
  const oa = {
    task: 'transcribe', language: 'english', duration: 1.2, text: 'Hello, world.',
    words: [{ word: 'Hello,', start: 0.08, end: 0.4 }, { word: ' world.', start: 0.48, end: 0.96 }],
  };
  assert.deepEqual(importWords(oa), { words: HELLO, source: 'word-list' });
  // segments carrying their own words (whisper python style)
  const seg = { text: 'x', segments: [{ id: 0, text: 'Hello, world.', words: oa.words }] };
  assert.deepEqual(importWords(seg).words, HELLO);
});

test('importWords: AssemblyAI integer milliseconds', () => {
  const aai = {
    id: 'x1', status: 'completed', text: 'Hello, world.',
    words: [{ text: 'Hello,', start: 80, end: 400, confidence: 0.99 }, { text: 'world.', start: 480, end: 960, confidence: 0.99 }],
  };
  assert.deepEqual(importWords(aai).words, HELLO);
  // forced with the option either way
  assert.deepEqual(importWords(aai.words, { unit: 'ms' }).words, HELLO);
  assert.deepEqual(importWords([{ word: 'a', start: 2, end: 3 }, { word: 'b', start: 4, end: 700 }], { unit: 's' }).words.map((w) => w.end), [3, 700]);
});

test('importWords: arrays in seconds or with start_ms/end_ms, sorted, empty words dropped', () => {
  assert.deepEqual(importWords([{ word: 'b', start: 1.5, end: 2 }, { word: 'a', start: 0.25, end: 1.5 }, { word: '  ', start: 3, end: 3.1 }]).words,
    [{ text: 'a', start: 0.25, end: 1.5 }, { text: 'b', start: 1.5, end: 2 }]);
  assert.deepEqual(importWords([{ text: 'x', start_ms: 100, end_ms: 350 }]).words, [{ text: 'x', start: 0.1, end: 0.35 }]);
  // small integers are seconds, not milliseconds
  assert.deepEqual(importWords([{ word: 'a', start: 1, end: 2 }, { word: 'b', start: 3, end: 4 }]).words.map((w) => w.start), [1, 3]);
  assert.deepEqual(importWords([]).words, []);
});

/** ElevenLabs character alignment for a list of timed words (with the spaces between them). */
function charAlignment(words) {
  const characters = [], s = [], e = [];
  words.forEach((w, k) => {
    if (k > 0) { characters.push(' '); s.push(words[k - 1].end); e.push(w.start); }
    const step = (w.end - w.start) / w.text.length;
    [...w.text].forEach((c, n) => { characters.push(c); s.push(+(w.start + n * step).toFixed(4)); e.push(+(w.start + (n + 1) * step).toFixed(4)); });
  });
  return { characters, character_start_times_seconds: s, character_end_times_seconds: e };
}

test('importWords: ElevenLabs character alignment (nested, normalized, top level)', () => {
  const al = charAlignment(HELLO);
  const r = importWords({ audio_base64: 'AAAA', alignment: al, normalized_alignment: charAlignment([{ text: 'hello', start: 0, end: 1 }]) });
  assert.equal(r.source, 'character-alignment');
  assert.deepEqual(r.words.map((w) => w.text), ['Hello,', 'world.']);
  assert.equal(r.words[0].start, 0.08);
  assert.ok(Math.abs(r.words[0].end - 0.4) < 1e-9);
  assert.equal(r.words[1].start, 0.48);
  assert.ok(Math.abs(r.words[1].end - 0.96) < 1e-9);
  assert.deepEqual(importWords({ normalized_alignment: al }).words, r.words);
  assert.deepEqual(importWords(al).words, r.words);
  // a word starts at its first character and ends at its last, whatever the spaces do
  const odd = importWords({ alignment: { characters: [' ', 'a', 'b', ' ', ' ', 'c'], character_start_times_seconds: [0, 1, 1.5, 2, 2.2, 3], character_end_times_seconds: [1, 1.5, 2, 2.2, 3, 3.5] } });
  assert.deepEqual(odd.words, [{ text: 'ab', start: 1, end: 2 }, { text: 'c', start: 3, end: 3.5 }]);
  assert.throws(() => importWords({ alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [] } }), /same length/);
});

const tok = (text, from, to) => ({ text, offsets: { from, to }, timestamps: { from: '00:00:00,000', to: '00:00:00,000' }, id: 1, p: 0.9 });

test('importWords: whisper.cpp -ojf (tokens, special tokens skipped, sub-word pieces joined)', () => {
  const wc = {
    systeminfo: 'AVX = 1', model: { type: 'base' }, params: { language: 'en' }, result: { language: 'en' },
    transcription: [
      {
        timestamps: { from: '00:00:00,000', to: '00:00:02,200' }, offsets: { from: 0, to: 2200 }, text: ' Hello, world. Fablecut',
        tokens: [
          tok('[_BEG_]', 0, 0), tok(' Hello', 80, 400), tok(',', 400, 420), tok(' world', 480, 900), tok('.', 900, 960),
          tok(' Fab', 1100, 1300), tok('lec', 1300, 1500), tok('ut', 1500, 1800), tok('[_TT_110]', 1800, 1800), tok('<|endoftext|>', 2200, 2200),
        ],
      },
      { timestamps: { from: '', to: '' }, offsets: { from: 2200, to: 3000 }, text: ' [BLANK_AUDIO]', tokens: [tok('[_BEG_]', 2200, 2200), tok(' [BLANK_AUDIO]', 2200, 3000)] },
      { timestamps: { from: '', to: '' }, offsets: { from: 3000, to: 3600 }, text: ' Ok', tokens: [tok('[_BEG_]', 3000, 3000), tok(' Ok', 3000, 3600), tok('[_TT_180]', 3600, 3600)] },
    ],
  };
  const r = importWords(wc);
  assert.equal(r.source, 'whisper.cpp');
  assert.deepEqual(r.words, [
    { text: 'Hello,', start: 0.08, end: 0.42 },
    { text: 'world.', start: 0.48, end: 0.96 },
    { text: 'Fablecut', start: 1.1, end: 1.8 },
    { text: 'Ok', start: 3, end: 3.6 },
  ]);
});

test('importWords: whisper.cpp -oj (segments only, time spread by characters) and -ml 1', () => {
  const oj = { transcription: [
    { timestamps: {}, offsets: { from: 1000, to: 2000 }, text: ' ab cd' },
    { timestamps: {}, offsets: { from: 2000, to: 2500 }, text: ' [MUSIC]' },
    { timestamps: {}, offsets: { from: 2500, to: 3500 }, text: ' abcdefgh i' },
  ] };
  const r = importWords(oj);
  assert.equal(r.source, 'whisper.cpp');
  assert.deepEqual(r.words.map((w) => w.text), ['ab', 'cd', 'abcdefgh', 'i']);
  assert.deepEqual(r.words.slice(0, 2).map((w) => [w.start, w.end]), [[1, 1.5], [1.5, 2]]);
  const w3 = r.words[2], w4 = r.words[3];
  assert.equal(w3.start, 2.5);
  assert.ok(Math.abs(w3.end - (2.5 + (8 / 9))) < 1e-9);
  assert.ok(Math.abs(w4.start - w3.end) < 1e-12);
  assert.equal(w4.end, 3.5);

  const ml1 = { transcription: ['Hello', ',', 'world'].map((t, k) => ({ timestamps: {}, offsets: { from: k * 400, to: k * 400 + 400 }, text: k === 1 ? t : ` ${t}`, tokens: [tok(k === 1 ? t : ` ${t}`, k * 400, k * 400 + 400)] })) };
  // the comma has no leading space and is punctuation: it joins the word before
  assert.deepEqual(importWords(ml1).words, [{ text: 'Hello,', start: 0, end: 0.8 }, { text: 'world', start: 0.8, end: 1.2 }]);
  const ml1plain = { transcription: [' Hello', ' world'].map((t, k) => ({ offsets: { from: k * 500, to: k * 500 + 500 }, text: t })) };
  assert.deepEqual(importWords(ml1plain).words, [{ text: 'Hello', start: 0, end: 0.5 }, { text: 'world', start: 0.5, end: 1 }]);
});

test('importWords: unknown shapes throw with the accepted shapes listed', () => {
  for (const bad of [null, 5, 'hello', {}, { text: 'hello' }, { results: {} }, [{ foo: 1 }], [{ word: 'a' }], [{ word: 'a', start: 'x', end: 2 }], { transcription: [{ text: 'a' }] }]) {
    assert.throws(() => importWords(bad), (e) => e instanceof Error && /Accepted shapes/.test(e.message) && /Deepgram/.test(e.message) && /whisper\.cpp/.test(e.message) && /ElevenLabs/.test(e.message), JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------- alignWords

test('alignWords: a perfect take keeps every time and flags nothing', () => {
  const script = 'Hello, brave new world.';
  const timed = timedOf('hello brave new world');
  const r = alignWords(script, timed);
  assert.deepEqual(r.stats, { matched: 4, substituted: 0, missing: 0, extra: 0 });
  assert.deepEqual(r.extra, []);
  assert.deepEqual(r.words, [
    { i: 0, text: 'Hello,', start: 0, end: 0.4 },
    { i: 1, text: 'brave', start: 0.5, end: 0.9 },
    { i: 2, text: 'new', start: 1, end: 1.4 },
    { i: 3, text: 'world.', start: 1.5, end: 1.9 },
  ]);
  // importWords output is accepted as is
  assert.deepEqual(alignWords(script, { words: timed, source: 'word-list' }), r);
});

test('alignWords: a slip takes the heard time and records what was said', () => {
  const r = alignWords('one small step for man', timedOf('one tall step for man'));
  assert.deepEqual(r.stats, { matched: 4, substituted: 1, missing: 0, extra: 0 });
  const w = r.words[1];
  assert.equal(w.text, 'small');
  assert.equal(w.spoken, 'tall');
  assert.equal(w.start, 0.5);
  assert.equal(w.end, 0.9);
  assert.equal(r.words[0].spoken, undefined);
});

test('alignWords: a dropped word is interpolated, flagged missing, and times stay ordered', () => {
  const r = alignWords('the quick brown fox jumps', [
    { text: 'the', start: 0, end: 0.4 }, { text: 'quick', start: 0.5, end: 0.9 },
    { text: 'fox', start: 2, end: 2.4 }, { text: 'jumps', start: 2.5, end: 2.9 },
  ]);
  assert.deepEqual(r.stats, { matched: 4, substituted: 0, missing: 1, extra: 0 });
  const b = r.words[2];
  assert.equal(b.text, 'brown');
  assert.equal(b.missing, true);
  assert.equal(b.start, 0.9);
  assert.equal(b.end, 2);
  assert.equal(r.words[0].missing, undefined);
  // two dropped words share the gap by length; times never decrease
  const r2 = alignWords('aa bbbb cc dd', [{ text: 'aa', start: 0, end: 1 }, { text: 'dd', start: 4, end: 5 }]);
  assert.deepEqual(r2.words.map((w) => w.missing === true), [false, true, true, false]);
  assert.deepEqual(r2.words.slice(1, 3).map((w) => [w.start, w.end]), [[1, 3], [3, 4]]);
  for (const r_ of [r, r2]) r_.words.forEach((w, k, all) => { assert.ok(w.end >= w.start); if (k) { assert.ok(w.start >= all[k - 1].start); assert.ok(w.end >= all[k - 1].end); } });
});

test('alignWords: dropped words at the ends and abutting neighbours still get a time of at least 1 ms', () => {
  const lead = alignWords('zero one two', [{ text: 'one', start: 1, end: 1.5 }, { text: 'two', start: 1.5, end: 2 }]);
  assert.equal(lead.words[0].missing, true);
  assert.ok(lead.words[0].end <= 1 && Math.round((lead.words[0].end - lead.words[0].start) * 1000) >= 1);
  const tail = alignWords('one two three', [{ text: 'one', start: 0, end: 0.5 }, { text: 'two', start: 0.5, end: 1 }]);
  assert.equal(tail.words[2].missing, true);
  assert.ok(tail.words[2].start >= 1 && Math.round((tail.words[2].end - tail.words[2].start) * 1000) >= 1);
  const tight = alignWords('a b c', [{ text: 'a', start: 0, end: 1 }, { text: 'c', start: 1, end: 2 }]);
  assert.ok(Math.round((tight.words[1].end - tight.words[1].start) * 1000) >= 1);
  assert.equal(tight.words[1].start, 1);
  const none = alignWords('a b', []);
  assert.deepEqual(none.stats, { matched: 0, substituted: 0, missing: 2, extra: 0 });
  assert.ok(none.words.every((w) => w.end > w.start));
});

test('alignWords: an inserted word goes to extra with the script word it follows', () => {
  const r = alignWords('turn the dial left', timedOf('turn the big dial left'));
  assert.deepEqual(r.stats, { matched: 4, substituted: 0, missing: 0, extra: 1 });
  assert.deepEqual(r.extra, [{ text: 'big', start: 1, end: 1.4, after: 1 }]);
  assert.deepEqual(r.words.map((w) => w.text), ['turn', 'the', 'dial', 'left']);
  assert.equal(r.words[2].start, 1.5);
  const front = alignWords('go now', timedOf('um go now'));
  assert.deepEqual(front.extra.map((x) => [x.text, x.after]), [['um', -1]]);
  const back = alignWords('go now', timedOf('go now please'));
  assert.deepEqual(back.extra.map((x) => [x.text, x.after]), [['please', 1]]);
});

test('alignWords: numerals match however they were said; the script word spans the heard words', () => {
  const r = alignWords('Back in 2026 we grew 14% in a year.', [
    ...timedOf('back in').map((w) => w),
    { text: 'twenty', start: 1, end: 1.4 }, { text: 'twenty', start: 1.4, end: 1.8 }, { text: 'six', start: 1.8, end: 2.2 },
    { text: 'we', start: 2.4, end: 2.6 }, { text: 'grew', start: 2.6, end: 3 },
    { text: 'fourteen', start: 3.2, end: 3.8 }, { text: 'percent', start: 3.8, end: 4.3 },
    { text: 'in', start: 4.4, end: 4.5 }, { text: 'a', start: 4.5, end: 4.6 }, { text: 'year', start: 4.6, end: 5 },
  ]);
  assert.deepEqual(r.stats, { matched: 9, substituted: 0, missing: 0, extra: 0 });
  const y = r.words[2];
  assert.equal(y.text, '2026');
  assert.equal(y.start, 1);
  assert.equal(y.end, 2.2);
  assert.equal(y.spoken, undefined);
  const pct = r.words[5];
  assert.equal(pct.text, '14%');
  assert.equal(pct.start, 3.2);
  assert.equal(pct.end, 4.3);
  // the other way round: the script says it in words, the service wrote digits
  const r2 = alignWords('in twenty twenty-six it cost five dollars', [
    { text: 'in', start: 0, end: 0.2 }, { text: '2026', start: 0.3, end: 1.3 }, { text: 'it', start: 1.4, end: 1.5 },
    { text: 'cost', start: 1.5, end: 1.9 }, { text: '$5', start: 2, end: 2.6 },
  ]);
  assert.deepEqual(r2.stats, { matched: 7, substituted: 0, missing: 0, extra: 0 });
  assert.deepEqual([r2.words[1].start, r2.words[1].end, r2.words[2].start, r2.words[2].end], [0.3, 0.675, 0.675, 1.3]);
  assert.deepEqual([r2.words[5].start, r2.words[6].end], [2, 2.6]);
});

test('alignWords: a slip, a drop and an insertion together; times are milliseconds', () => {
  const script = 'First we trim the silence then we normalize the loudness';
  const r = alignWords(script, [
    { text: 'first', start: 0.0004, end: 0.3336 }, { text: 'we', start: 0.4, end: 0.5 }, { text: 'trimmed', start: 0.55, end: 0.9 },
    { text: 'silence', start: 1.2, end: 1.7 }, { text: 'then', start: 1.9, end: 2.1 }, { text: 'um', start: 2.15, end: 2.3 },
    { text: 'we', start: 2.4, end: 2.5 }, { text: 'normalize', start: 2.5, end: 3.1 }, { text: 'the', start: 3.1, end: 3.2 }, { text: 'loudness', start: 3.2, end: 3.8 },
  ]);
  assert.deepEqual(r.stats, { matched: 8, substituted: 1, missing: 1, extra: 1 });
  assert.equal(r.words[2].spoken, 'trimmed');
  assert.equal(r.words[3].missing, true);
  assert.equal(r.words[3].text, 'the');
  assert.deepEqual(r.extra.map((x) => [x.text, x.after]), [['um', 5]]);
  assert.equal(r.words[0].start, 0);
  assert.equal(r.words[0].end, 0.334);
  for (const w of r.words) { assert.equal(w.start, Math.round(w.start * 1000) / 1000); assert.equal(w.end, Math.round(w.end * 1000) / 1000); }
  // word i is the same word in every take
  const again = alignWords(script, timedOf('first we trim the silence then we normalize the loudness'));
  assert.deepEqual(again.words.map((w) => w.text), r.words.map((w) => w.text));
});

// ---------------------------------------------------------------- checkTranscript

test('checkTranscript: a planted slip, drop and insertion are each named with their index', () => {
  const script = 'The quick brown fox jumps over the lazy dog';
  const r = checkTranscript(script, 'The quick brown fox leaps over lazy dog today');
  assert.equal(r.ok, false);
  assert.deepEqual(r.slips, [{ i: 4, script: 'jumps', heard: 'leaps' }]);
  assert.deepEqual(r.drops, [{ i: 6, script: 'the' }]);
  assert.deepEqual(r.insertions, [{ after: 8, heard: 'today' }]);
  assert.deepEqual(r.counts, { script: 9, heard: 9, matched: 7, slips: 1, drops: 1, insertions: 1 });
  // an insertion in the middle
  const mid = checkTranscript('a b c', 'a b x c');
  assert.deepEqual(mid.insertions, [{ after: 1, heard: 'x' }]);
  assert.equal(mid.slips.length + mid.drops.length, 0);
});

test('checkTranscript: only case, punctuation and numerals differ -> ok', () => {
  const script = 'In 2026 we shipped 14 builds, 1,000 tests and 3.5 GB of "fresh" captions - it\'s the 1st time.';
  const heard = 'in twenty twenty six we shipped fourteen builds one thousand tests and three point five gb of fresh captions its the first time';
  const r = checkTranscript(script, heard);
  assert.deepEqual(r, { ok: true, slips: [], drops: [], insertions: [], counts: { script: 19, heard: 23, matched: 18, slips: 0, drops: 0, insertions: 0 } });
  assert.equal(checkTranscript('Hello, World!', 'hello world').ok, true);
  assert.equal(checkTranscript('Hello, World!', 'hello there world').ok, false);
});

test('checkTranscript: timed words and word lists are accepted; a number said differently is a slip', () => {
  const script = 'one small step';
  assert.equal(checkTranscript(script, [{ text: 'One', start: 0, end: 1 }, { word: 'small', start: 1, end: 2 }, { text: 'step', start: 2, end: 3 }]).ok, true);
  assert.equal(checkTranscript(script, { words: [{ text: 'one' }, { text: 'small' }, { text: 'step' }] }).ok, true);
  assert.equal(checkTranscript(script, ['one', 'small', 'step']).ok, true);
  const r = checkTranscript('we sold 14 units', 'we sold 40 units');
  assert.deepEqual(r.slips, [{ i: 2, script: '14', heard: '40' }]);
  assert.throws(() => checkTranscript(script, 42), /transcript/);
});
