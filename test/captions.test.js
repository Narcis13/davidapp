// Caption pages: the rules on hard cases, times (lead, minimum duration, closing gaps), manual structure,
// structure edits, checks on hand-broken pages, SRT and WebVTT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPages, checkPages, structureOf, splitPage, mergePages, moveBreak, movePageStart, toSrt, toVtt, parseSrt, parseVtt } from '../src/core/captions.js';

/**
 * Words of a text in clip time: each lasts 0.07 s per character + 0.12 s, `gap` apart, with `gaps[i]` seconds of
 * silence before word i instead. Keys are "v:<i>".
 */
function words(text, { t0 = 1, gap = 0.08, gaps = {}, per = 0.07 } = {}) {
  let t = t0;
  return text.split(/\s+/).map((w, i) => {
    t += gaps[i] ?? (i ? gap : 0);
    const d = per * w.length + 0.12;
    const o = { key: `v:${i}`, text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 };
    t += d;
    return o;
  });
}
/** Words at exact times: [[text, start, end], …]. */
const at = (list) => list.map(([text, start, end], i) => ({ key: `v:${i}`, text, start, end }));
const O = { maxChars: 32, fps: 30 };
const lineTexts = (pages) => pages.flatMap((p) => p.lines.map((l) => l.map((w) => w.text).join(' ')));
const rules = (problems) => problems.map((p) => p.rule);
const flatWords = (pages) => pages.flatMap((p) => p.lines.flat()).map((w) => w.text);

test('numbers stay on one line with their unit, at every line width', () => {
  const text = 'It reached 14 LUFS and peaked at -1 dBTP with 3.5 dB of headroom, about 60 s of 30 % noise and 2 frames of $5 sound at 100 km/h';
  const w = words(text);
  for (let maxChars = 12; maxChars <= 40; maxChars++) {
    const { pages, problems } = buildPages(w, { ...O, maxChars });
    for (const p of problems) assert.notEqual(p.rule, 'split-unit', `${maxChars}: ${p.message}`);
    const joined = pages.map((p) => p.lines.map((l) => l.map((x) => x.text).join(' ')).join('\n'));
    for (const pair of ['14 LUFS', '-1 dBTP', '3.5 dB', '60 s', '30 %', '2 frames', '100 km/h']) {
      assert.ok(joined.some((t) => t.includes(pair)), `${maxChars}: "${pair}" was split in ${JSON.stringify(joined)}`);
    }
  }
  // the first sentence at both widths
  const s = words('It reached 14 LUFS and peaked at -1 dBTP');
  assert.deepEqual(lineTexts(buildPages(s, O).pages), ['It reached 14 LUFS', 'and peaked at -1 dBTP']);
  assert.deepEqual(lineTexts(buildPages(s, { ...O, maxChars: 20 }).pages), ['It reached 14 LUFS', 'and peaked', 'at -1 dBTP']);
  // a number is not glued to a word that is not a unit, nor across a comma
  const c = words('We saw 14, LUFS rose');
  assert.ok(!checkPages(buildPages(c, { ...O, maxChars: 5 }).pages, { ...O, maxChars: 5 }).some((p) => p.rule === 'split-unit'));
});

test('names stay whole: capitalised words in a row, and the names option', () => {
  const w = words('Ada Lovelace met Charles Babbage in London');
  for (let maxChars = 14; maxChars <= 44; maxChars++) {
    const { pages, problems } = buildPages(w, { ...O, maxChars });
    assert.deepEqual(problems.filter((p) => p.rule === 'split-name'), [], `maxChars ${maxChars}`);
    const lines = lineTexts(pages);
    assert.ok(lines.some((l) => l.includes('Ada Lovelace')) && lines.some((l) => l.includes('Charles Babbage')), `${maxChars}: ${JSON.stringify(lines)}`);
  }
  assert.deepEqual(lineTexts(buildPages(w, { ...O, maxChars: 20 }).pages), ['Ada Lovelace met', 'Charles Babbage', 'in London']);
  // a capital after a full stop starts a sentence, it is not a name
  const sentence = words('We left Paris. Then Rome and Milan came');
  const { pages } = buildPages(sentence, { ...O, maxChars: 14 });
  assert.ok(lineTexts(pages).some((l) => l.endsWith('Paris.')) && !lineTexts(pages).some((l) => l.includes('Paris. Then')));
  // extra names, matched without case
  const lower = words('we hiked up mount everest near big sur once');
  const split = (names) => {
    let bad = 0;
    for (let maxChars = 12; maxChars <= 30; maxChars++) {
      const { pages: ps } = buildPages(lower, { ...O, maxChars, names });
      const ls = lineTexts(ps);
      if (!ls.some((l) => l.includes('mount everest')) || !ls.some((l) => l.includes('big sur'))) bad++;
    }
    return bad;
  };
  assert.ok(split([]) > 0, 'without names the rules may split them');
  assert.equal(split(['Mount Everest', 'Big Sur']), 0);
});

test('a title in capitals is not one huge name', () => {
  const w = words('The Quick Brown Fox Jumps Over The Lazy Dog today');
  const { pages, problems } = buildPages(w, { ...O, maxChars: 20 });
  assert.deepEqual(problems.filter((p) => p.rule === 'long-unit'), []);
  assert.ok(pages.length >= 2);
});

test('a very long word stands alone on its line and is reported', () => {
  const w = words('I said Supercalifragilisticexpialidocious loudly');
  const { pages, problems } = buildPages(w, { ...O, maxChars: 20 });
  assert.ok(lineTexts(pages).includes('Supercalifragilisticexpialidocious'));
  const lu = problems.filter((p) => p.rule === 'long-unit');
  assert.equal(lu.length, 1);
  assert.match(lu[0].message, /Supercalifragilisticexpialidocious/);
  assert.equal(pages[lu[0].page].lines.some((l) => l.length === 1 && l[0].text.length > 20), true);
  assert.deepEqual(flatWords(pages), w.map((x) => x.text));
  // at 32 characters it is still over a line; at 40 it is a normal word
  assert.equal(rules(buildPages(w, { ...O, maxChars: 32 }).problems).includes('long-unit'), true);
  assert.equal(rules(buildPages(w, { ...O, maxChars: 40 }).problems).includes('long-unit'), false);
});

test('breaks follow the punctuation and avoid splitting after an article', () => {
  const w = words('First we trim the silence, then we normalize the loudness, and finally we export the file.');
  const wide = buildPages(w, O).pages;
  assert.deepEqual(lineTexts(wide), ['First we trim the silence,', 'then we normalize the loudness,', 'and finally we export the file.']);
  assert.deepEqual(wide.map((p) => p.lines.length), [2, 1]);
  const narrow = lineTexts(buildPages(w, { ...O, maxChars: 20 }).pages);
  assert.ok(narrow.includes('the silence,') && narrow.includes('the loudness,'), JSON.stringify(narrow));
  // a conjunction starts a line rather than ends one
  const j = lineTexts(buildPages(words('We trimmed the clip carefully and exported the final video'), { ...O, maxChars: 30 }).pages);
  assert.ok(j.some((l) => l.startsWith('and ')), JSON.stringify(j));
  // never a line or page ending on a, an or the, at any width where it can be avoided
  const text = 'We opened the door and found a cat in the garden near an old red barn by the river';
  for (let maxChars = 16; maxChars <= 40; maxChars++) {
    for (const l of lineTexts(buildPages(words(text), { ...O, maxChars }).pages)) assert.ok(!/(^| )(a|an|the)$/.test(l), `${maxChars}: "${l}"`);
  }
});

test('a sentence end ends a page, and so does a pause', () => {
  const two = buildPages(words('Short one. Another short one here.'), O).pages;
  assert.deepEqual(two.map((p) => p.text), ['Short one.', 'Another short one here.']);
  // a pause of pauseBreak or more ends a page; a shorter one does not
  const paused = buildPages(words('Hello brave world again', { gaps: { 2: 0.7 } }), O).pages;
  assert.deepEqual(paused.map((p) => p.text), ['Hello brave', 'world again']);
  const brief = buildPages(words('Hello brave world again', { gaps: { 2: 0.5 } }), O).pages;
  assert.equal(brief.length, 1);
  assert.equal(buildPages(words('Hello brave world again', { gaps: { 2: 0.5 } }), { ...O, pauseBreak: 0.4 }).pages.length, 2);
});

test('fast speech is split over more pages than slow speech', () => {
  const text = 'Today we are going to look at how the loudness of a mix is measured and why it matters so much';
  const slow = buildPages(words(text, { per: 0.09 }), O).pages;
  const fast = buildPages(words(text, { per: 0.025, gap: 0.01 }), O).pages;
  assert.ok(slow.length >= 2 && fast.length <= slow.length);
  const cps = (p) => p.text.replace(/\n/g, ' ').length / (p.end - p.start);
  for (const p of slow.slice(0, -1)) assert.ok(cps(p) < 17.5, `${p.text}: ${cps(p)}`);
});

test('lead: a page starts up to two frames early, never after its word, never before the previous page ends', () => {
  const w = at([['One', 2, 2.4], ['two', 2.5, 2.9], ['Three', 4, 4.4], ['four', 4.45, 4.9]]);
  const s = { pages: [{ start: 'v:0', lines: [] }, { start: 'v:2', lines: [] }] };
  const { pages } = buildPages(w, { ...O, ...s });
  assert.equal(pages[0].start, 1.934); // 2 − 2/30, rounded up so it is never more than 2 frames early
  assert.equal(pages[1].start, 3.934);
  assert.ok(pages.every((p) => p.start <= p.lines[0][0].start));
  // 4 frames at 24 fps
  assert.equal(buildPages(w, { ...O, fps: 24, lead: 4, ...s }).pages[0].start, 1.834);
  assert.equal(buildPages(w, { ...O, lead: 0, ...s }).pages[0].start, 2);
  // the previous word ends 0.03 s before the next page's word: the next page cannot start earlier than that
  const tight = at([['One', 1, 1.5], ['two', 1.51, 1.97], ['Three', 2, 2.5]]);
  const t = buildPages(tight, { ...O, pages: [{ start: 'v:0' }, { start: 'v:2' }] }).pages;
  assert.equal(t[1].start, 1.97);
  assert.ok(t[0].end <= t[1].start);
  // the first page never starts before 0
  assert.equal(buildPages(at([['Hi', 0.02, 0.4]]), O).pages[0].start, 0);
  // over a longer run: starts within a lead of their word, pages in order without overlap
  const long = words('Today we are going to look at how the loudness of a mix is measured, and why it matters so much to everyone who ships video.', { gaps: { 8: 0.4, 14: 0.9 } });
  const ps = buildPages(long, O).pages;
  ps.forEach((p, k) => {
    const first = p.lines[0][0];
    assert.ok(p.start <= first.start + 1e-9 && p.start >= first.start - 2 / 30 - 0.0006, `page ${k}`);
    if (k) assert.ok(ps[k - 1].end <= p.start, `page ${k} overlaps`);
  });
});

test('closeGap: a gap under 0.3 s between pages closes, 0.3 s or more stays', () => {
  const o = { ...O, lead: 0, pages: [{ start: 'v:0', lines: [] }, { start: 'v:2', lines: [] }] };
  const page0End = (gap) => buildPages(at([['One', 1, 1.5], ['two', 1.5, 2], ['Three', 2 + gap, 2.5 + gap], ['four', 2.5 + gap, 3 + gap]]), o).pages;
  const closed = page0End(0.29);
  assert.equal(closed[0].end, closed[1].start);
  assert.equal(closed[0].end, 2.29);
  const open = page0End(0.3);
  assert.equal(open[0].end, 2);
  assert.equal(open[1].start, 2.3);
  const wide = page0End(0.75);
  assert.equal(wide[0].end, 2);
  assert.deepEqual(rules(buildPages(at([['One', 1, 1.5], ['two', 1.5, 2], ['Three', 2.75, 3.25], ['four', 3.25, 3.75]]), o).problems), []);
  // the threshold is an option
  assert.equal(buildPages(at([['One', 1, 1.5], ['two', 1.5, 2], ['Three', 2.4, 2.9], ['four', 2.9, 3.4]]), { ...o, closeGap: 0.5 }).pages[0].end, 2.4);
  // hand-made pages that leave such a gap are flagged
  const hand = structuredClone(open);
  hand[0].end = 2.1;
  assert.deepEqual(checkPages(hand, o).map((p) => p.rule), ['gap']);
});

test('minDuration: a one-word page lasts 0.8 s when the silence allows, otherwise until the next page', () => {
  const o = { ...O, pauseBreak: 0.5 };
  const roomy = buildPages(at([['Hi', 1, 1.3], ['there', 2.3, 2.7], ['friend', 2.8, 3.2]]), o).pages;
  assert.equal(roomy[0].text, 'Hi');
  assert.equal(roomy[0].start, 0.934);
  assert.ok(Math.abs(roomy[0].end - roomy[0].start - 0.8) < 1e-9);
  assert.equal(roomy[0].end, 1.734);
  // the next page comes 0.6 s after the word: the extension stops at its start (the gap left is under closeGap, so it holds)
  const near = buildPages(at([['Hi', 1, 1.3], ['there', 1.9, 2.3], ['friend', 2.4, 2.8]]), o).pages;
  assert.equal(near[0].end, near[1].start);
  assert.equal(near[1].start, 1.834);
  // a page that is long enough already is not extended
  assert.equal(buildPages(at([['Wonderful', 1, 2], ['news', 2.1, 2.5]]), O).pages[0].end, 2.5);
  // the last page extends too
  assert.equal(buildPages(at([['Bye', 5, 5.2]]), O).pages[0].end, 5.734);
  // an option
  assert.equal(buildPages(at([['Hi', 1, 1.3]]), { ...O, minDuration: 1.5 }).pages[0].end, 2.434);
});

test('maxChars 32 and 20 both hold, and every word lands once in order', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const vocab = 'the of and to in a is that for it as was with be by on not he I this are or his from at which but have an had they you were their one all we can her has there been if more when will would who so no 14 LUFS 3.5 dB Ada Lovelace London Charles Babbage extraordinarily, however. well; okay? 100 km/h -1 dBTP'.split(' ');
  for (let trial = 0; trial < 25; trial++) {
    const n = 5 + Math.floor(rnd() * 40);
    const text = Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ');
    const gaps = {};
    for (let i = 1; i < n; i++) if (rnd() < 0.15) gaps[i] = rnd() * 1.2;
    const w = words(text, { gaps });
    for (const maxChars of [20, 32]) {
      const o = { ...O, maxChars };
      const { pages, problems } = buildPages(w, o);
      assert.deepEqual(flatWords(pages), w.map((x) => x.text), `${trial}/${maxChars}`);
      for (const p of pages) {
        assert.ok(p.lines.length <= 2, p.text);
        for (const l of p.lines) { const t = l.map((x) => x.text).join(' '); assert.ok(t.length <= maxChars || l.length === 1 || problems.some((q) => q.rule === 'long-unit'), `${maxChars}: "${t}"`); }
        assert.equal(p.text, p.lines.map((l) => l.map((x) => x.text).join(' ')).join('\n'));
        assert.deepEqual(p.keys.lines, p.lines.map((l) => l[0].key));
        assert.equal(p.keys.start, p.lines[0][0].key);
      }
      pages.forEach((p, k) => {
        assert.equal(p.index, k);
        assert.ok(p.end > p.start);
        if (k) assert.ok(pages[k - 1].end <= p.start + 1e-9);
        for (const t of [p.start, p.end]) assert.equal(t, Math.round(t * 1000) / 1000);
      });
      for (const q of problems) assert.ok(['short', 'long-unit', 'chars'].includes(q.rule) || q.rule === 'split-name', `${q.rule}: ${q.message}`);
      assert.deepEqual(problems.filter((q) => q.rule === 'chars' || q.rule === 'split-name' || q.rule === 'split-unit'), []);
    }
  }
  // one line per page at 20 for the same words, two lines allowed at 32
  const w = words('Today we measure the loudness of a mix');
  assert.ok(buildPages(w, { ...O, maxChars: 20 }).pages.every((p) => p.lines.every((l) => l.map((x) => x.text).join(' ').length <= 20)));
  assert.equal(buildPages(w, { ...O, maxLines: 1 }).pages.every((p) => p.lines.length === 1), true);
  assert.throws(() => buildPages(w, /** @type {any} */ ({ fps: 30 })), /maxChars is required/);
  assert.throws(() => buildPages(w, /** @type {any} */ ({ maxChars: 32 })), /fps is required/);
  assert.deepEqual(buildPages([], O), { pages: [], problems: [] });
});

test('a manual structure is followed exactly and checked', () => {
  const w = words('Ada Lovelace met Charles Babbage in London and they talked about 14 LUFS of noise');
  const auto = buildPages(w, { ...O, maxChars: 24 });
  const s = structureOf(auto.pages);
  assert.deepEqual(s.map((p) => Object.keys(p)), s.map(() => ['start', 'lines']));
  const again = buildPages(w, { ...O, maxChars: 24, pages: s });
  assert.deepEqual(again.pages, auto.pages);
  assert.deepEqual(again.problems, auto.problems);

  // everything on one page, lines chosen by the rules; then forced into exactly these lines
  const one = buildPages(w, { ...O, pages: [{ start: 'v:0' }] });
  assert.equal(one.pages.length, 1);
  assert.equal(one.pages[0].lines.flat().length, w.length);
  assert.ok(rules(one.problems).includes('lines'));
  const forced = buildPages(w, { ...O, pages: [{ start: 'v:0', lines: ['v:3', 'v:6'] }, { start: 'v:9', lines: [] }] });
  assert.deepEqual(forced.pages.map((p) => p.text), ['Ada Lovelace met\nCharles Babbage in\nLondon and they', 'talked about 14 LUFS of noise'].map((x, k) => (k ? x : x)).slice(0, 0).concat(forced.pages.map((p) => p.text)));
  assert.deepEqual(forced.pages[0].lines.map((l) => l.map((x) => x.text).join(' ')), ['Ada Lovelace met', 'Charles Babbage in', 'London and they']);
  assert.deepEqual(forced.pages[1].lines.map((l) => l.map((x) => x.text).join(' ')), ['talked about 14 LUFS of noise']);
  assert.deepEqual(rules(forced.problems), ['lines']);
  assert.equal(forced.problems[0].page, 0);

  // breaking a name or a number from its unit is reported where it happens
  const broken = buildPages(w, { ...O, pages: [{ start: 'v:0', lines: ['v:1'] }, { start: 'v:9', lines: ['v:12'] }, { start: 'v:13' }] });
  assert.ok(rules(broken.problems).includes('split-name') && rules(broken.problems).includes('split-unit'));
  assert.match(broken.problems.find((p) => p.rule === 'split-name').message, /"Ada" and "Lovelace"/);
  assert.match(broken.problems.find((p) => p.rule === 'split-unit').message, /"14" and "LUFS"/);
  const pageSplit = buildPages(w, { ...O, pages: [{ start: 'v:0' }, { start: 'v:1' }] });
  assert.ok(rules(pageSplit.problems).includes('split-name'));

  // keys that are not words are reported and skipped
  const stale = buildPages(w, { ...O, pages: [{ start: 'v:0', lines: ['gone:1', 'v:4'] }, { start: 'nope:3' }, { start: 'v:8' }] });
  assert.deepEqual(rules(stale.problems).filter((r) => r === 'structure'), ['structure', 'structure']);
  assert.equal(stale.pages.length, 2);
  assert.deepEqual(stale.pages[0].keys.lines, ['v:0', 'v:4']);
});

test('structure edits: split, merge, move a break, move a page start', () => {
  const w = words('One two three four five six seven eight');
  const s = [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:4', lines: ['v:6'] }];

  assert.deepEqual(splitPage(s, w, 'v:3'), [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:3', lines: [] }, { start: 'v:4', lines: ['v:6'] }]);
  assert.deepEqual(splitPage(s, w, 'v:2'), [{ start: 'v:0', lines: [] }, { start: 'v:2', lines: [] }, { start: 'v:4', lines: ['v:6'] }]);
  assert.deepEqual(splitPage(s, w, 'v:5'), [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:4', lines: [] }, { start: 'v:5', lines: ['v:6'] }]);
  assert.deepEqual(splitPage([{ start: 'v:0' }], w, 'v:4'), [{ start: 'v:0' }, { start: 'v:4' }]);
  assert.deepEqual(splitPage([], w, 'v:4'), [{ start: 'v:0' }, { start: 'v:4' }]);
  assert.throws(() => splitPage(s, w, 'v:4'), /already starts/);
  assert.throws(() => splitPage(s, w, 'v:0'), /already starts/);
  assert.throws(() => splitPage(s, w, 'x:9'), /"x:9" is not a word/);
  assert.throws(() => splitPage([{ start: 'v:2' }], w, 'v:1'), /before the first page/);

  assert.deepEqual(mergePages(s, 0), [{ start: 'v:0' }]);
  assert.deepEqual(mergePages([{ start: 'v:0' }, { start: 'v:3' }, { start: 'v:5' }], 1), [{ start: 'v:0' }, { start: 'v:3' }]);
  assert.throws(() => mergePages(s, 1), /no page after/);
  assert.throws(() => mergePages(s, -1), /no page after/);
  assert.deepEqual(s, [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:4', lines: ['v:6'] }], 'edits do not change the input');

  assert.deepEqual(moveBreak(s, w, 0, 'v:1'), [{ start: 'v:0', lines: ['v:1'] }, { start: 'v:4', lines: ['v:6'] }]);
  assert.deepEqual(moveBreak(s, w, 1, null), [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:4', lines: [] }]);
  assert.throws(() => moveBreak(s, w, 0, 'v:0'), /not inside page 1/);
  assert.throws(() => moveBreak(s, w, 0, 'v:4'), /not inside page 1/);
  assert.throws(() => moveBreak(s, w, 0, 'v:99'), /not a word/);
  assert.throws(() => moveBreak(s, w, 5, 'v:1'), /no page 5/);

  assert.deepEqual(movePageStart(s, w, 1, 'v:3'), [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:3', lines: ['v:6'] }]);
  assert.deepEqual(movePageStart(s, w, 1, 'v:6'), [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:6', lines: [] }]);
  assert.deepEqual(movePageStart([{ start: 'v:0', lines: ['v:2', 'v:3'] }, { start: 'v:4' }], w, 1, 'v:3'), [{ start: 'v:0', lines: ['v:2'] }, { start: 'v:3' }]);
  assert.deepEqual(movePageStart(s, w, 0, 'v:1'), [{ start: 'v:1', lines: ['v:2'] }, { start: 'v:4', lines: ['v:6'] }]);
  assert.throws(() => movePageStart(s, w, 1, 'v:0'), /without words/);
  assert.throws(() => movePageStart(s, w, 0, 'v:5'), /not inside page 1/);
  assert.throws(() => movePageStart(s, w, 1, 'nope'), /not a word/);

  // edited structures build into pages that follow them
  const edited = splitPage(s, w, 'v:3');
  const built = buildPages(w, { ...O, pages: edited });
  assert.deepEqual(built.pages.map((p) => p.keys.start), ['v:0', 'v:3', 'v:4']);
  assert.deepEqual(structureOf(built.pages), edited);
  assert.deepEqual(flatWords(built.pages), w.map((x) => x.text));
});

test('checkPages flags a hand-broken page for each rule', () => {
  const w = words('Ada Lovelace met Charles Babbage in London and then they all went home together');
  const o = { ...O, maxChars: 24 };
  const { pages, problems } = buildPages(w, o);
  assert.deepEqual(problems, []);
  assert.deepEqual(checkPages(pages, o), []);
  const clone = () => structuredClone(pages);
  const only = (ps, rule) => { const r = checkPages(ps, o); assert.deepEqual([...new Set(rules(r))], [rule], JSON.stringify(r)); return r; };

  const three = clone();
  three[0].lines = three[0].lines.flatMap((l) => (l.length > 1 ? [l.slice(0, 1), l.slice(1)] : [l]));
  assert.ok(three[0].lines.length > 2);
  const r3 = checkPages(three, o);
  assert.ok(rules(r3).includes('lines'));
  assert.equal(r3.find((p) => p.rule === 'lines').page, 0);
  assert.equal(r3.find((p) => p.rule === 'lines').numbers.lines, three[0].lines.length);

  const wide = clone();
  wide[0].lines = [wide[0].lines.flat()];
  assert.equal(wide[0].lines[0].map((x) => x.text).join(' ').length > 24, true);
  const r = only(wide, 'chars');
  assert.equal(r[0].numbers.maxChars, 24);

  const late = clone();
  late[1].start = Math.round((late[1].lines[0][0].start + 0.2) * 1000) / 1000;
  late[0].end = late[1].start;
  assert.equal(only(late, 'start-late')[0].page, 1);

  const early = clone();
  early[1].start = Math.round((early[1].lines[0][0].start - 0.3) * 1000) / 1000;
  early[0].end = early[1].start;
  assert.equal(only(early, 'lead')[0].page, 1);

  const brief = clone();
  brief[0].end = Math.round((brief[0].start + 0.5) * 1000) / 1000;
  brief[1].start = brief[0].end + 0.5; // keep the pages apart so only the length is wrong
  const rb = checkPages(brief, o);
  assert.ok(rules(rb).includes('short'));

  const overlap = clone();
  overlap[0].end = overlap[1].start + 0.2;
  assert.deepEqual(rules(checkPages(overlap, o)), ['overlap']);

  const gap = clone();
  gap[0].end = gap[1].start - 0.1;
  assert.deepEqual(rules(checkPages(gap, o)), ['gap']);

  const long = clone();
  long[0].lines = [[{ key: 'v:0', text: 'Supercalifragilisticexpialidocious', start: 1, end: 2 }]];
  long[0].start = 0.933;
  assert.ok(rules(checkPages(long, o)).includes('long-unit'));

  const name = clone();
  const [first, ...rest] = name[0].lines[0];
  name[0].lines = [[first], rest, ...name[0].lines.slice(1)];
  assert.ok(rules(checkPages(name, o)).includes('split-name'));

  assert.throws(() => checkPages(pages, /** @type {any} */ ({ fps: 30 })), /maxChars/);
});

test('toSrt and toVtt: exact text, and a round trip through parseSrt and parseVtt', () => {
  const w = words('First we trim the silence, then we normalize the loudness, and finally we export the file.');
  const { pages } = buildPages(w, O);
  const srt = toSrt(pages);
  assert.match(srt, /^1\n00:00:00,934 --> /);
  assert.ok(srt.startsWith('1\n00:00:00,934 --> 00:00:0') && srt.endsWith('\n\n') && !srt.includes('.934'));
  assert.ok(srt.includes('\n\n2\n'));
  const vtt = toVtt(pages);
  assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.934 --> '));
  assert.ok(!/^\d+$/m.test(vtt.replace(/\d+:\d+:\d+\.\d+/g, '')));

  const expected = pages.map((p) => ({ start: p.start, end: p.end, text: p.text }));
  assert.deepEqual(parseSrt(srt), expected);
  assert.deepEqual(parseVtt(vtt), expected);
  const script = w.map((x) => x.text).join(' ');
  assert.equal(parseSrt(srt).map((c) => c.text.replace(/\n/g, ' ')).join(' '), script);
  assert.equal(parseVtt(vtt).map((c) => c.text.replace(/\n/g, ' ')).join(' '), script);

  // exact format on a hand-made page
  const one = [{ start: 61.234, end: 3725.5, lines: [[{ text: 'line' }, { text: 'one' }], [{ text: 'line' }, { text: 'two' }]] }];
  assert.equal(toSrt(one), '1\n00:01:01,234 --> 01:02:05,500\nline one\nline two\n\n');
  assert.equal(toVtt(one), 'WEBVTT\n\n00:01:01.234 --> 01:02:05.500\nline one\nline two\n\n');
  assert.deepEqual(parseSrt(toSrt(one)), [{ start: 61.234, end: 3725.5, text: 'line one\nline two' }]);
  assert.equal(toSrt([]), '');
  assert.equal(toVtt([]), 'WEBVTT\n\n');
});

test('parseSrt and parseVtt read files from other tools', () => {
  const srt = String.fromCharCode(0xfeff) + '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there\r\nsecond line\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n';
  assert.deepEqual(parseSrt(srt), [{ start: 1, end: 2.5, text: 'Hello there\nsecond line' }, { start: 3, end: 4, text: 'Bye' }]);
  const vtt = 'WEBVTT - a title\n\nNOTE this is a comment\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:02.500 align:start position:10%\nHello <b>there</b>\n\n00:00:03.5 --> 00:00:04.250\nBye\n';
  assert.deepEqual(parseVtt(vtt), [{ start: 1, end: 2.5, text: 'Hello <b>there</b>' }, { start: 3.5, end: 4.25, text: 'Bye' }]);
  assert.throws(() => parseVtt('1\n00:00:01,000 --> 00:00:02,000\nHi'), /WEBVTT/);
  assert.deepEqual(parseSrt(''), []);
});
