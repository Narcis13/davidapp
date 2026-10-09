// Captions: pages of one to a few lines built from timed words by rules, checked against the same rules,
// edited as a small structure (which word starts each page and line) and written as SRT or WebVTT.
// Words are in clip time: { key: "<item>:<i>", text, start, end }, sorted by start. A composition stores only the
// structure ([{ start: key, lines: [key, …] }]); the times of a page always come from its words.
//
// How pages are chosen: words are glued into units that must stay on one line (a number with its unit,
// a name), then dynamic programming over the units picks page ends and line breaks with a cost made of
// line balance, break quality (after punctuation good, before a conjunction or preposition fair, right after an
// article never), page duration, sentence ends inside a page, and reading speed.

const round3 = (v) => Math.round(v * 1000) / 1000;
const EPS = 0.0005;

// costs (arbitrary units; a mid-phrase break is 3, a page costs 3, a second line 1.5)
const PAGE_COST = 3;
const LINE_COST = 1.5;
const SENTENCE_INSIDE = 4;
const CPS_MAX = 17;

const SENTENCE_END = /[.?!…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:–—]["'”’)\]]*$/;
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'jr', 'sr', 'e.g', 'i.e', 'etc', 'inc', 'no']);
const ARTICLES = new Set(['a', 'an', 'the']);
const JOINERS = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'for', 'from', 'into', 'about', 'that', 'which', 'who', 'where', 'when', 'while', 'if', 'as', 'than']);
const SCALE_WORDS = new Set(['hundred', 'thousand', 'million', 'billion', 'trillion']);
const UNITS = new Set([
  'lufs', 'lu', 'db', 'dbtp', 'dbfs', 'dbu', 'gb', 'mb', 'kb', 'tb', 'gib', 'mib', 'kbps', 'mbps', 'gbps', 'bps', 'hz', 'khz', 'mhz', 'ghz', 'fps', 'bpm',
  'ms', 's', 'sec', 'secs', 'second', 'seconds', 'min', 'mins', 'minute', 'minutes', 'h', 'hr', 'hrs', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'frame', 'frames', 'px', 'pt', 'em', 'rem', 'bit', 'bits', 'byte', 'bytes', 'pixel', 'pixels', 'sample', 'samples',
  'm', 'cm', 'mm', 'km', 'mi', 'ft', 'kg', 'g', 'mg', 'lb', 'lbs', 'km/h', 'kmh', 'mph', 'm/s', 'w', 'kw', 'v', '%', 'percent',
]);

/** Lower case with the punctuation around the word removed (a leading minus, currency sign and a lone % stay). */
const bare = (t) => t.toLowerCase().replace(/^[^\p{L}\p{N}%$€£-]+/u, '').replace(/[^\p{L}\p{N}%]+$/u, '');
const unquoted = (t) => t.replace(/^[("'“‘[]+/, '').replace(/[)"'”’\]]+$/, '');
const endsSentence = (t) => SENTENCE_END.test(t) && !ABBREVIATIONS.has(bare(t));
const endsClause = (t) => CLAUSE_END.test(t) || /^[–—-]{1,3}$/.test(t);
const isNumber = (t) => { const c = unquoted(t); return /^[-+−]?[$€£]?\d[\d.,:/]*$/.test(c) && !/[.,:/]$/.test(c); };
function isCapitalised(t) {
  const c = unquoted(t);
  if (!/^\p{Lu}/u.test(c) || /^I(['’]\w+)?[^\p{L}]*$/u.test(c)) return false;
  const letters = c.replace(/[^\p{L}]/gu, '');
  return !(letters.length > 1 && letters === letters.toUpperCase());
}

/**
 * What must stay together: link[k] says whether word k and word k+1 belong on one line ('number' with its
 * unit, 'name', 'dash' before a lone dash) or null.
 */
function linksOf(words, names = []) {
  const n = words.length;
  const link = new Array(Math.max(0, n - 1)).fill(null);
  let inNumber = false;
  for (let k = 0; k < n - 1; k++) {
    const t = words[k].text, next = bare(words[k + 1].text);
    const here = isNumber(t) || (inNumber && SCALE_WORDS.has(bare(t)) && !/[,;:.!?…]$/.test(t));
    if (here && (UNITS.has(next) || SCALE_WORDS.has(next))) { link[k] = 'number'; inNumber = true; } else inNumber = false;
  }
  for (let k = 1; k < n; k++) if (/^[–—-]{1,3}$/.test(words[k].text)) link[k - 1] ??= 'dash';
  // capitalised words in a row inside a sentence: Ada Lovelace, Charles Babbage (a long run is a title, not a name)
  for (let k = 0; k < n;) {
    if (!isCapitalised(words[k].text)) { k++; continue; }
    let e = k;
    while (e + 1 < n && isCapitalised(words[e + 1].text) && !endsSentence(words[e].text) && !CLAUSE_END.test(words[e].text)) e++;
    if (e > k && e - k < 4) for (let m = k; m < e; m++) link[m] ??= 'name';
    k = e + 1;
  }
  for (const name of names) {
    const parts = String(name).trim().split(/\s+/).map(bare).filter(Boolean);
    if (parts.length < 2) continue;
    for (let k = 0; k + parts.length <= n; k++) {
      if (parts.every((p, m) => bare(words[k + m].text) === p)) for (let m = 0; m < parts.length - 1; m++) link[k + m] = 'name';
    }
  }
  return link;
}

/** The cost of ending a line or page between word k and word k+1. */
function breakCost(words, k) {
  const a = words[k], b = words[k + 1];
  if (ARTICLES.has(bare(a.text)) && !endsClause(a.text) && !endsSentence(a.text)) return 60;
  let c;
  if (endsSentence(a.text)) c = 0;
  else if (endsClause(a.text)) c = 0.4;
  else if (JOINERS.has(bare(b.text))) c = 1.2;
  else c = 3;
  return Math.max(0, c - Math.min(1, Math.max(0, b.start - a.end) * 2)); // a pause favours a break
}

/** Units (runs of words that stay on one line) inside words lo..hi. */
function unitsIn(words, link, lo, hi) {
  const out = [];
  let a = lo, len = -1;
  for (let k = lo; k <= hi; k++) {
    len += words[k].text.length + 1;
    if (k === hi || !link[k]) { out.push({ a, b: k, len }); a = k + 1; len = -1; }
  }
  return out;
}

/**
 * The best split of units i..j-1 into at most maxLines lines: { cost, lines: [[p, q), …] (unit indices), chars }
 * or null when they do not fit. A unit longer than a line stands alone on its line.
 */
function layout(lens, brk, i, j, maxLines, maxChars) {
  const m = j - i;
  let total = lens[i];
  for (let k = i + 1; k < j; k++) total += lens[k] + 1;
  let best = null;
  for (let K = 1; K <= Math.min(maxLines, m); K++) {
    const target = total / K;
    const f = Array.from({ length: K + 1 }, () => new Float64Array(m + 1).fill(Infinity));
    const from = Array.from({ length: K + 1 }, () => new Int32Array(m + 1));
    f[0][0] = 0;
    for (let l = 1; l <= K; l++) {
      for (let q = l; q <= m; q++) {
        let len = -1;
        for (let p = q - 1; p >= l - 1; p--) {
          len += lens[i + p] + 1;
          if (q - p > 1 && len > maxChars) break;
          if (f[l - 1][p] === Infinity) continue;
          const c = f[l - 1][p] + (K > 1 ? 4 * ((len - target) / maxChars) ** 2 : 0) + (q < m ? brk[i + q - 1] : 0);
          if (c < f[l][q]) { f[l][q] = c; from[l][q] = p; }
        }
      }
    }
    if (f[K][m] === Infinity) continue;
    const cost = f[K][m] + (K - 1) * LINE_COST;
    if (best && best.cost <= cost) continue;
    const lines = [];
    for (let l = K, q = m; l > 0; l--) { const p = from[l][q]; lines.unshift([p, q]); q = p; }
    best = { cost, lines, chars: total };
  }
  return best;
}

/** Lines by filling each up to maxChars, whatever the line count (for a page the rules cannot fit). */
function greedyLines(lens, i, j, maxChars) {
  const lines = [];
  let p = 0, len = -1;
  for (let k = i; k < j; k++) {
    const add = lens[k] + (len < 0 ? 0 : 1);
    if (len >= 0 && len + add > maxChars) { lines.push([p, k - i]); p = k - i; len = lens[k]; } else len = len < 0 ? lens[k] : len + add;
  }
  lines.push([p, j - i]);
  return lines;
}

function resolve(o) {
  if (!o || !Number.isInteger(o.maxChars) || o.maxChars < 1) throw new Error('captions: maxChars is required, a number of characters per line (32 for 16:9, 20 otherwise)');
  if (!(o.fps > 0)) throw new Error('captions: fps is required, the frame rate of the clip');
  return {
    maxLines: o.maxLines ?? 2, maxChars: o.maxChars, fps: o.fps, lead: o.lead ?? 2, minDuration: o.minDuration ?? 0.8,
    closeGap: o.closeGap ?? 0.3, pauseBreak: o.pauseBreak ?? 0.6, names: o.names ?? [], pages: o.pages,
  };
}

/** Page and line boundaries chosen by the rules: ranges [{ a, b, lines: [[a, b], …] }] over word indices. */
function autoRanges(words, link, bc, opt) {
  const units = unitsIn(words, link, 0, words.length - 1);
  const U = units.length;
  const lens = units.map((u) => u.len);
  const brk = units.map((u) => bc[u.b] ?? 0);
  const gapAfter = units.map((u, k) => (k < U - 1 ? words[units[k + 1].a].start - words[u.b].end : Infinity));
  const sentence = units.map((u) => endsSentence(words[u.b].text));
  const best = new Float64Array(U + 1).fill(Infinity);
  const from = new Int32Array(U + 1);
  const chosen = new Array(U + 1);
  best[0] = 0;
  for (let j = 1; j <= U; j++) {
    for (let i = j - 1; i >= 0; i--) {
      if (i < j - 1 && gapAfter[i] >= opt.pauseBreak) break;
      const lay = layout(lens, brk, i, j, opt.maxLines, opt.maxChars);
      if (!lay) break;
      if (best[i] === Infinity) continue;
      const dur = Math.max(0.001, words[units[j - 1].b].end - words[units[i].a].start);
      let c = best[i] + PAGE_COST + lay.cost + (j < U ? brk[j - 1] : 0);
      for (let k = i; k < j - 1; k++) if (sentence[k]) c += SENTENCE_INSIDE;
      if (dur < 1.2) c += (1.2 - dur) * 2.5;
      if (dur > 5) c += (dur - 5) * 1.5;
      const cps = lay.chars / Math.max(dur, opt.minDuration);
      if (cps > CPS_MAX) c += (cps - CPS_MAX) + 0.3 * (cps - CPS_MAX) ** 2;
      if (c < best[j]) { best[j] = c; from[j] = i; chosen[j] = lay; }
    }
  }
  const out = [];
  for (let j = U; j > 0; j = from[j]) {
    const i = from[j], lay = chosen[j];
    out.unshift({ a: units[i].a, b: units[j - 1].b, lines: lay.lines.map(([p, q]) => [units[i + p].a, units[i + q - 1].b]) });
  }
  return out;
}

/** Page and line boundaries given by a structure; what cannot be followed is reported in `problems`. */
function manualRanges(words, link, bc, opt, structure, problems) {
  const at = new Map(words.map((w, k) => [w.key, k]));
  const starts = [];
  structure.forEach((p, n) => {
    const k = at.get(p?.start);
    if (k === undefined) problems.push({ page: n, rule: 'structure', message: `Page ${n + 1} of the structure starts at ${JSON.stringify(p?.start)}, which is not a word of this clip; it is skipped.` });
    else if (starts.length && k <= starts[starts.length - 1].k) problems.push({ page: n, rule: 'structure', message: `Page ${n + 1} of the structure starts at ${JSON.stringify(p.start)}, not after the previous page; it is skipped.` });
    else starts.push({ k, n, lines: p.lines });
  });
  return starts.map((s, x) => {
    const a = s.k, b = x + 1 < starts.length ? starts[x + 1].k - 1 : words.length - 1;
    if (s.lines !== undefined) {
      const ls = [];
      for (const key of s.lines) {
        const k = at.get(key);
        if (k === undefined || k <= (ls.length ? ls[ls.length - 1] : a) || k > b) problems.push({ page: s.n, rule: 'structure', message: `Page ${s.n + 1}: the line break at ${JSON.stringify(key)} is not a word inside the page after the previous break; it is ignored.` });
        else ls.push(k);
      }
      const edges = [a, ...ls, b + 1];
      return { a, b, lines: edges.slice(0, -1).map((e, m) => [e, edges[m + 1] - 1]) };
    }
    const us = unitsIn(words, link, a, b);
    const lens = us.map((u) => u.len), brk = us.map((u) => bc[u.b] ?? 0);
    const lay = layout(lens, brk, 0, us.length, opt.maxLines, opt.maxChars);
    const lines = lay ? lay.lines : greedyLines(lens, 0, us.length, opt.maxChars);
    return { a, b, lines: lines.map(([p, q]) => [us[p].a, us[q - 1].b]) };
  });
}

/** Page start and end times from the words' times (see buildPages). */
function pageTimes(ranges, words, opt) {
  const lead = opt.lead / opt.fps;
  const base = ranges.map((r) => ({ ws: words[r.a].start, we: words[r.b].end }));
  const start = base.map((p, k) => round3(Math.min(p.ws, Math.max(p.ws - lead, k ? base[k - 1].we : 0, 0))));
  return base.map((p, k) => {
    const ns = k + 1 < base.length ? start[k + 1] : Infinity;
    let end = Math.max(p.we, Math.min(start[k] + opt.minDuration, ns));
    if (ns - end < opt.closeGap - 1e-9) end = ns;
    return { start: start[k], end: round3(Math.min(Math.max(end, start[k]), ns)) };
  });
}

/**
 * Build caption pages -> { pages: [{ index, start, end, lines: [[word, …], …], text, keys: { start, lines } }], problems }.
 * o: { maxLines = 2, maxChars (required), fps (required), lead = 2 frames, minDuration = 0.8, closeGap = 0.3,
 * pauseBreak = 0.6, names = [], pages?: structure }. With `pages` ([{ start: key, lines?: [key, …] }], the keys of
 * each page's first word and of each further line) the structure is followed exactly and checked; a page without
 * `lines` has its lines chosen by the rules, `lines: []` is one line. Without it the rules choose.
 * Times: a page starts at its first word's start or up to `lead` frames earlier (never after the word, never before the
 * previous page's last word ends); it ends at its last word's end, extended to last at least minDuration (into the
 * silence, never past the next page's start); when the gap to the next page's start is under closeGap it holds until
 * the next page starts. Times are rounded to the millisecond. `problems` is checkPages of the result, plus
 * rule 'structure' for keys of a given structure that are not words.
 * @param {{ key: string, text: string, start: number, end: number }[]} words
 * @param {{ maxLines?: number, maxChars: number, fps: number, lead?: number, minDuration?: number, closeGap?: number, pauseBreak?: number, names?: string[], pages?: { start: string, lines?: string[] }[] }} o
 */
export function buildPages(words, o) {
  const opt = resolve(o);
  const problems = [];
  if (!words.length) return { pages: [], problems };
  const link = linksOf(words, opt.names);
  const bc = words.map((_, k) => (k < words.length - 1 ? breakCost(words, k) : 0));
  const ranges = opt.pages ? manualRanges(words, link, bc, opt, opt.pages, problems) : autoRanges(words, link, bc, opt);
  const times = pageTimes(ranges, words, opt);
  const pages = ranges.map((r, index) => {
    const lines = r.lines.map(([a, b]) => words.slice(a, b + 1));
    return {
      index, start: times[index].start, end: times[index].end, lines,
      text: lines.map((l) => l.map((w) => w.text).join(' ')).join('\n'),
      keys: { start: words[r.a].key, lines: lines.map((l) => l[0].key) },
    };
  });
  return { pages, problems: [...problems, ...checkPages(pages, o)] };
}

/**
 * Check pages against the rules -> problems [{ page (index), rule, message, numbers }], rule being one of
 * 'lines' (too many lines), 'chars' (a line too long), 'long-unit' (one unbreakable unit longer than a line),
 * 'start-late' (page starts after its first word), 'lead' (starts earlier than `lead` frames before it),
 * 'short' (shorter than minDuration), 'gap' (a gap under closeGap left between pages), 'overlap',
 * 'split-unit' (a number parted from its unit) and 'split-name' (a name split by a page or line break).
 * @param {{ index?: number, start: number, end: number, lines: { key?: string, text: string, start: number, end: number }[][] }[]} pages
 * @param {{ maxLines?: number, maxChars: number, fps: number, lead?: number, minDuration?: number, closeGap?: number, names?: string[] }} o
 */
export function checkPages(pages, o) {
  const opt = resolve(o);
  const problems = [];
  const idOf = (p, k) => p.index ?? k;
  const flat = [];
  const lineStart = pages.map((p) => p.lines.map((line) => { const at = flat.length; line.forEach((w) => flat.push({ w, pi: 0, li: 0 })); return at; }));
  pages.forEach((p, pi) => p.lines.forEach((line, li) => { for (let k = 0; k < line.length; k++) { flat[lineStart[pi][li] + k].pi = pi; flat[lineStart[pi][li] + k].li = li; } }));
  const link = linksOf(flat.map((f) => f.w), opt.names);

  pages.forEach((p, pi) => {
    const id = idOf(p, pi), label = `Page ${id + 1}`;
    const add = (rule, message, numbers) => problems.push({ page: id, rule, message, numbers });
    if (p.lines.length > opt.maxLines) add('lines', `${label} has ${p.lines.length} lines; at most ${opt.maxLines}.`, { lines: p.lines.length, maxLines: opt.maxLines });
    p.lines.forEach((line, li) => {
      const text = line.map((w) => w.text).join(' ');
      if (text.length <= opt.maxChars) return;
      const joined = line.every((_, k) => k === line.length - 1 || link[lineStart[pi][li] + k]);
      if (joined) add('long-unit', `${label}, line ${li + 1}: "${text}" cannot be broken and is ${text.length} characters (a line holds ${opt.maxChars}); it stands alone on its line.`, { line: li + 1, chars: text.length, maxChars: opt.maxChars });
      else add('chars', `${label}, line ${li + 1} has ${text.length} characters; at most ${opt.maxChars}.`, { line: li + 1, chars: text.length, maxChars: opt.maxChars });
    });
    const first = p.lines[0]?.[0];
    if (!first) return;
    if (p.start > first.start + EPS) add('start-late', `${label} appears at ${p.start}s, after its first word "${first.text}" starts (${first.start}s).`, { start: p.start, wordStart: first.start });
    const lead = opt.lead / opt.fps;
    if (p.start < first.start - lead - EPS) add('lead', `${label} appears ${round3(first.start - p.start)}s before its first word; at most ${opt.lead} frames (${round3(lead)}s).`, { start: p.start, wordStart: first.start, lead: round3(lead) });
    const duration = round3(p.end - p.start);
    if (duration < opt.minDuration - EPS) add('short', `${label} lasts ${duration}s; at least ${opt.minDuration}s.`, { duration, minDuration: opt.minDuration });
    const next = pages[pi + 1];
    if (next) {
      const gap = round3(next.start - p.end);
      if (gap < -EPS) add('overlap', `${label} ends at ${p.end}s, after the next page starts (${next.start}s).`, { end: p.end, nextStart: next.start });
      else if (gap > EPS && gap < opt.closeGap - EPS) add('gap', `${label} leaves a gap of ${gap}s before the next page; gaps under ${opt.closeGap}s are closed.`, { gap, closeGap: opt.closeGap });
    }
  });
  for (let k = 0; k < flat.length - 1; k++) {
    if (!link[k] || (flat[k].pi === flat[k + 1].pi && flat[k].li === flat[k + 1].li)) continue;
    const name = link[k] === 'name';
    const across = flat[k].pi !== flat[k + 1].pi ? 'page' : 'line';
    problems.push({
      page: idOf(pages[flat[k].pi], flat[k].pi), rule: name ? 'split-name' : 'split-unit',
      message: `"${flat[k].w.text}" and "${flat[k + 1].w.text}" belong together (${name ? 'a name' : link[k] === 'dash' ? 'a dash' : 'a number and its unit'}) but a ${across} break splits them.`,
      numbers: { at: flat[k + 1].w.key },
    });
  }
  return problems.sort((a, b) => a.page - b.page);
}

/**
 * The structure of built pages, to store in a composition: [{ start, lines }] (keys; lines are the further lines).
 * @param {{ keys: { start: string, lines: string[] } }[]} pages
 */
export function structureOf(pages) {
  return pages.map((p) => ({ start: p.keys.start, lines: p.keys.lines.slice(1) }));
}

// ---------------------------------------------------------------- edits on a structure

function indexed(structure, words) {
  const at = new Map(words.map((w, k) => [w.key, k]));
  const idx = (key, what) => {
    const k = at.get(key);
    if (k === undefined) throw new Error(`${what} ${JSON.stringify(key)} is not a word of this clip`);
    return k;
  };
  const pages = structure.map((p, n) => ({ start: idx(p.start, `page ${n + 1} start`), lines: p.lines === undefined ? undefined : p.lines.map((l) => idx(l, `page ${n + 1} line start`)) }));
  pages.forEach((p, n) => { if (n && p.start <= pages[n - 1].start) throw new Error(`the structure is not in order: page ${n + 1} does not start after page ${n}`); });
  return { idx, pages, end: (n) => (n + 1 < pages.length ? pages[n + 1].start : words.length) };
}
const back = (pages, words) => pages.map((p) => (p.lines === undefined ? { start: words[p.start].key } : { start: words[p.start].key, lines: p.lines.map((l) => words[l].key) }));
function pageAt(pages, k) {
  let found = -1;
  pages.forEach((p, n) => { if (p.start <= k) found = n; });
  return found;
}

/**
 * A new page starts at the word atKey. Line breaks of the page it splits go to the half they fall in.
 * @param {{ start: string, lines?: string[] }[]} structure
 * @param {{ key: string }[]} words
 * @param {string} atKey
 */
export function splitPage(structure, words, atKey) {
  const { idx, pages } = indexed(structure, words);
  const k = idx(atKey, 'the split point');
  if (!pages.length) {
    if (k === 0) throw new Error(`${JSON.stringify(atKey)} is the first word; a page already starts there`);
    pages.push({ start: 0, lines: undefined });
  }
  const n = pageAt(pages, k);
  if (n < 0) throw new Error(`${JSON.stringify(atKey)} comes before the first page`);
  const p = pages[n];
  if (p.start === k) throw new Error(`a page already starts at ${JSON.stringify(atKey)}`);
  pages.splice(n, 1, { start: p.start, lines: p.lines?.filter((l) => l < k) }, { start: k, lines: p.lines?.filter((l) => l > k) });
  return back(pages, words);
}

/**
 * Page pageIndex and the next one become one page; its lines are left to the rules (call buildPages again).
 * @param {{ start: string, lines?: string[] }[]} structure
 * @param {number} pageIndex
 */
export function mergePages(structure, pageIndex) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= structure.length - 1) {
    throw new Error(`cannot merge page ${pageIndex}: there is no page after it (the structure has ${structure.length} pages)`);
  }
  const out = structure.map((p) => ({ ...p }));
  out.splice(pageIndex, 2, { start: structure[pageIndex].start });
  return out;
}

/**
 * The page's second line starts at lineKey (null: the page is one line).
 * @param {{ start: string, lines?: string[] }[]} structure
 * @param {{ key: string }[]} words
 * @param {number} pageIndex
 * @param {string | null} lineKey
 */
export function moveBreak(structure, words, pageIndex, lineKey) {
  const { idx, pages, end } = indexed(structure, words);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) throw new Error(`there is no page ${pageIndex} (the structure has ${pages.length} pages)`);
  if (lineKey !== null) {
    const k = idx(lineKey, 'the line start');
    if (k <= pages[pageIndex].start || k >= end(pageIndex)) throw new Error(`${JSON.stringify(lineKey)} is not inside page ${pageIndex + 1}, after its first word`);
    pages[pageIndex].lines = [k];
  } else pages[pageIndex].lines = [];
  return back(pages, words);
}

/**
 * The page starts at the word key; the previous page ends before it (and gains or loses the words in between).
 * @param {{ start: string, lines?: string[] }[]} structure
 * @param {{ key: string }[]} words
 * @param {number} pageIndex
 * @param {string} key
 */
export function movePageStart(structure, words, pageIndex, key) {
  const { idx, pages, end } = indexed(structure, words);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) throw new Error(`there is no page ${pageIndex} (the structure has ${pages.length} pages)`);
  const k = idx(key, 'the new page start');
  const p = pages[pageIndex];
  if (pageIndex > 0 && k <= pages[pageIndex - 1].start) throw new Error(`${JSON.stringify(key)} would leave page ${pageIndex} without words; move it after that page's first word`);
  if (k >= end(pageIndex)) throw new Error(`${JSON.stringify(key)} is not inside page ${pageIndex + 1}; it would leave the page without words`);
  if (pageIndex > 0) pages[pageIndex - 1].lines = pages[pageIndex - 1].lines?.filter((l) => l < k);
  p.lines = p.lines?.filter((l) => l > k);
  p.start = k;
  return back(pages, words);
}

// ---------------------------------------------------------------- subtitles

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(t, sep) {
  let ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

/**
 * SubRip text of the pages: "1\n00:00:01,234 --> 00:00:02,500\nline one\nline two\n\n2\n…".
 * @param {{ start: number, end: number, lines: { text: string }[][] }[]} pages
 */
export function toSrt(pages) {
  return pages.map((p, k) => `${k + 1}\n${stamp(p.start, ',')} --> ${stamp(p.end, ',')}\n${pageText(p)}\n\n`).join('');
}

/**
 * WebVTT text of the pages: "WEBVTT\n\n00:00:01.234 --> 00:00:02.500\nline one\nline two\n\n…".
 * @param {{ start: number, end: number, lines: { text: string }[][] }[]} pages
 */
export function toVtt(pages) {
  return `WEBVTT\n\n${pages.map((p) => `${stamp(p.start, '.')} --> ${stamp(p.end, '.')}\n${pageText(p)}\n\n`).join('')}`;
}
const pageText = (p) => p.lines.map((l) => l.map((w) => w.text).join(' ')).join('\n');

const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIMING = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);
const seconds = (h, m, s, f) => ((Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(f.padEnd(3, '0'))) / 1000;

function parseCues(text) {
  const out = [];
  for (const block of String(text).replace(/^\p{Cf}/u, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    const m = at >= 0 ? TIMING.exec(lines[at]) : null;
    if (!m) continue;
    out.push({ start: seconds(m[1], m[2], m[3], m[4]), end: seconds(m[5], m[6], m[7], m[8]), text: lines.slice(at + 1).map((l) => l.trimEnd()).join('\n').trim() });
  }
  return out;
}

/**
 * Cues of an SRT text -> [{ start, end, text }] (seconds; the lines of a cue joined with \n).
 * @param {string} text
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function parseSrt(text) { return parseCues(text); }

/**
 * Cues of a WebVTT text -> [{ start, end, text }]; header, NOTE and STYLE blocks, cue ids and cue settings are skipped.
 * @param {string} text
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function parseVtt(text) {
  if (!/^\p{Cf}?WEBVTT/u.test(String(text))) throw new Error('not WebVTT: the text must start with WEBVTT');
  return parseCues(text);
}
