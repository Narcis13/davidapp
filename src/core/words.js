// Words of a narration: the script split into words, canonical comparison tokens, word timings
// imported from the shapes voice services return, and the alignment of a take to the script.
// The script's words, in order, are the identity of the words: word i means the same word in every
// take, so anything anchored to word i survives a new recording.
//
// Canonical tokens (normalizeText): lower case, diacritics folded, punctuation dropped, inner
// apostrophes dropped ("don't" -> "dont"), hyphens, slashes and colons split ("e-mail" -> "e" "mail"),
// and numerals written as DIGITS, in English:
//   14 / fourteen -> "14"          2026 / two thousand twenty six / twenty twenty-six -> "2026"
//   3.5 / three point five -> "3.5"   1,000 / one thousand / a thousand -> "1000"
//   14% / fourteen percent -> "14" "percent"   1st / first -> "1st"   $5 / five dollars -> "5" "dollar"
// Digits are written without separators, leading zeros or trailing decimal zeros; "-5" and
// "minus five" -> "-5"; "5 million" / "five million" -> "5000000". "one" is always "1".
// Other languages: diacritics folded, digits pass through ('ro' also reads 1.000 and 3,5).

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round3 = (v) => Math.round(v * 1000) / 1000;
const has = (o, k) => Object.hasOwn(o, k);
const langOf = (language) => String(language ?? 'en').toLowerCase().slice(0, 2);

// ---------------------------------------------------------------- canonical tokens

const FOLD = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ı': 'i', 'ð': 'd', 'þ': 'th' };
function fold(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[ßæœøłđıðþ]/g, (c) => FOLD[c])
    .replace(/[‘’ʼ`´]/g, "'");
}

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const ORD_ONES = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19 };
const ORD_TENS = { twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 };
const ORD_SCALES = { hundredth: 100, thousandth: 1e3, millionth: 1e6, billionth: 1e9, trillionth: 1e12 };
const WORD_FORMS = { dollars: 'dollar', euros: 'euro', pounds: 'pound' };
const CURRENCY = { '$': 'dollar', '€': 'euro', '£': 'pound' };

/** Digits without separators, leading zeros or trailing decimal zeros. */
function tidy(d) {
  let [i, f] = d.split('.');
  i = i.replace(/^0+(?=\d)/, '');
  if (f === undefined) return i;
  f = f.replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}
/** d × 10^k on a decimal string, without floating point. */
function shift(d, k) {
  const [i, f = ''] = d.split('.');
  const digits = i + f.padEnd(k, '0');
  const point = i.length + k;
  return tidy(digits.slice(0, point) + (digits.length > point ? `.${digits.slice(point)}` : ''));
}
function ordinal(v) {
  const n = v.replace(/^-/, '').split('.')[0];
  if (/1[123]$/.test(n)) return `${v}th`;
  return v + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n.slice(-1)] ?? 'th');
}
/** The canonical digit strings of a written number ("1,000" -> ["1000"]; "3,5" in English -> ["3", "5"]). */
function canonDigits(d, lang) {
  if (lang === 'ro') {
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(d)) return [tidy(d.replace(/\./g, '').replace(',', '.'))];
    if (/^\d+,\d+$/.test(d)) return [tidy(d.replace(',', '.'))];
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(d)) return [tidy(d.replace(/,/g, ''))];
  if (/^\d+(\.\d+)?$/.test(d)) return [tidy(d)];
  return d.split(/[.,]/).map(tidy);
}

// Letters, digits, currency, % and & are what survives; everything else separates.
const PIECE_RE = /([$€£])|(%)|(&)|(?:((?<![\p{L}\d])-)?(\d+(?:[.,]\d+)*)(?:(st|nd|rd|th)(?!\p{L}))?)|(\p{L}+\d*)/gu;

/** One whitespace-separated word as pieces: { k: 'n' digits | 'w' word, v, wi, ord?, cur? }. */
function piecesOf(word, wi, lang) {
  let s = fold(word).replace(/(\p{L})'(?=\p{L})/gu, '$1');
  s = s.replace(/(?<![\p{L}\d])(\p{L})\.(?=\p{L}(?:\.|(?![\p{L}\d])))/gu, '$1'); // u.s.a -> usa
  const out = [];
  let cur = null;
  const flush = () => { if (cur) { out.push({ k: 'w', v: cur, wi }); cur = null; } };
  for (const m of s.matchAll(PIECE_RE)) {
    if (m[1]) { flush(); cur = CURRENCY[m[1]]; } else if (m[2]) { flush(); out.push({ k: 'w', v: 'percent', wi }); } else if (m[3]) { flush(); out.push({ k: 'w', v: 'and', wi }); } else if (m[5] !== undefined) {
      const ds = canonDigits(m[5], lang);
      ds.forEach((d, n) => {
        const last = n === ds.length - 1;
        const p = { k: 'n', v: m[4] && d !== '0' ? `-${d}` : d, wi };
        if (last && m[6]) p.ord = true;
        if (last && cur) { p.cur = cur; cur = null; }
        out.push(p);
      });
    } else if (m[7]) { flush(); out.push({ k: 'w', v: WORD_FORMS[m[7]] ?? m[7], wi }); }
  }
  flush();
  return out;
}

/** Digits, possibly followed by scale words ("5 million"). */
function digitsNumber(ps, i, en) {
  const p = ps[i];
  let v = p.v, j = i + 1;
  if (en && !p.ord) {
    while (ps[j] && ps[j].k === 'w' && (has(SCALES, ps[j].v) || ps[j].v === 'hundred') && !v.startsWith('-')) {
      v = shift(v, Math.round(Math.log10(ps[j].v === 'hundred' ? 100 : SCALES[ps[j].v])));
      j++;
    }
  }
  const b = ps[j - 1].wi;
  const toks = [{ t: p.ord ? ordinal(v) : v, a: p.wi, b }];
  if (p.cur) toks.push({ t: p.cur, a: p.wi, b });
  return { toks, next: j };
}

/** A year read in two halves: "nineteen ninety-nine", "twenty twenty six", "twenty oh five" (1300-2099). */
function yearForm(ps, i) {
  const w = ps[i].v;
  const A = has(ONES, w) && ONES[w] >= 13 ? ONES[w] : w === 'twenty' ? 20 : 0;
  const b = ps[i + 1];
  if (!A || !b || b.k !== 'w') return null;
  const unit = (p) => p && p.k === 'w' && has(ONES, p.v) && ONES[p.v] >= 1 && ONES[p.v] <= 9;
  let B, next;
  if (b.v === 'oh' && unit(ps[i + 2])) { B = ONES[ps[i + 2].v]; next = i + 3; } else if (has(ONES, b.v) && ONES[b.v] >= 10) { B = ONES[b.v]; next = i + 2; } else if (has(TENS, b.v)) {
    B = TENS[b.v]; next = i + 2;
    if (unit(ps[i + 2])) { B += ONES[ps[i + 2].v]; next = i + 3; }
  } else return null;
  return { value: String(A * 100 + B), next, ord: false };
}

/** A cardinal or ordinal written in words starting at ps[i]: { value, next, ord } or null. */
function cardinal(ps, i) {
  let total = 0, group = 0, last = 'none', lastScale = Infinity, j = i, used = false, ord = false;
  const w = (k) => (ps[k] && ps[k].k === 'w' ? ps[k].v : null);
  const startsLow = () => last === 'none' || last === 'scale' || last === 'hundred';
  while (w(j) !== null) {
    const v = w(j);
    if (v === 'a') {
      const n = w(j + 1);
      if (j === i && n !== null && (n === 'hundred' || has(SCALES, n))) { group = 1; last = 'ones'; used = true; j++; continue; }
      break;
    }
    if (v === 'and') {
      const n = w(j + 1);
      if (used && (last === 'hundred' || last === 'scale') && n !== null && n !== 'zero' && (has(ONES, n) || has(TENS, n) || has(ORD_ONES, n) || has(ORD_TENS, n))) { j++; continue; }
      break;
    }
    if (has(ONES, v)) {
      const n = ONES[v];
      if (n === 0) { if (used) break; used = true; j++; break; }
      if (n >= 10 ? startsLow() : (startsLow() || last === 'tens')) { group += n; last = n >= 10 ? 'teen' : 'ones'; used = true; j++; continue; }
      break;
    }
    if (has(TENS, v)) {
      if (!startsLow()) break;
      group += TENS[v]; last = 'tens'; used = true; j++; continue;
    }
    if (v === 'hundred') {
      if ((last === 'ones' || last === 'teen' || last === 'tens') && group > 0 && group < 100) { group *= 100; last = 'hundred'; j++; continue; }
      break;
    }
    if (has(SCALES, v)) {
      if (group > 0 && SCALES[v] < lastScale) { total += group * SCALES[v]; group = 0; lastScale = SCALES[v]; last = 'scale'; j++; continue; }
      break;
    }
    if (has(ORD_ONES, v)) {
      const n = ORD_ONES[v];
      if (n >= 10 ? startsLow() : (startsLow() || last === 'tens')) { group += n; used = true; ord = true; j++; }
      break;
    }
    if (has(ORD_TENS, v)) {
      if (startsLow()) { group += ORD_TENS[v]; used = true; ord = true; j++; }
      break;
    }
    if (has(ORD_SCALES, v)) {
      const s = ORD_SCALES[v];
      if (s === 100) {
        if ((last === 'ones' || last === 'teen' || last === 'tens') && group > 0 && group < 100) { group *= 100; used = true; ord = true; j++; } else if (!used) { group = 100; used = true; ord = true; j++; }
      } else if (group > 0 && s < lastScale) { total += group * s; group = 0; used = true; ord = true; j++; } else if (!used) { total = s; used = true; ord = true; j++; }
      break;
    }
    break;
  }
  if (!used) return null;
  return { value: String(total + group), next: j, ord };
}

/** A number written in words at ps[i], with decimals ("point five") and scale ("two point five million"). */
function wordsNumber(ps, i) {
  if (ps[i].k !== 'w') return null;
  const y = yearForm(ps, i);
  const c = y ?? cardinal(ps, i);
  if (!c) return null;
  let { value, next } = c;
  if (!c.ord && !y) {
    const isDigit = (p) => p && p.k === 'w' && ((has(ONES, p.v) && ONES[p.v] <= 9) || p.v === 'oh');
    if (ps[next] && ps[next].k === 'w' && ps[next].v === 'point' && isDigit(ps[next + 1])) {
      let frac = '', k = next + 1;
      while (isDigit(ps[k])) { frac += ps[k].v === 'oh' ? '0' : ONES[ps[k].v]; k++; }
      value = tidy(`${value}.${frac}`);
      next = k;
      while (ps[next] && ps[next].k === 'w' && (has(SCALES, ps[next].v) || ps[next].v === 'hundred')) {
        value = shift(value, Math.round(Math.log10(ps[next].v === 'hundred' ? 100 : SCALES[ps[next].v])));
        next++;
      }
    }
  }
  const toks = [{ t: c.ord ? ordinal(value) : value, a: ps[i].wi, b: ps[next - 1].wi }];
  return { toks, next };
}

/** Canonical tokens of a list of whitespace-free words: [{ t, a, b }] where a..b are the words the token came from. */
function tokenize(words, lang) {
  const ps = [];
  words.forEach((w, wi) => ps.push(...piecesOf(w, wi, lang)));
  const en = lang === 'en';
  const out = [];
  for (let i = 0; i < ps.length;) {
    const p = ps[i];
    let r = null;
    if (en && p.k === 'w' && (p.v === 'minus' || p.v === 'negative') && ps[i + 1]) {
      const q = ps[i + 1];
      r = q.k === 'n' ? digitsNumber(ps, i + 1, en) : wordsNumber(ps, i + 1);
      if (r) { r.toks[0] = { ...r.toks[0], t: r.toks[0].t === '0' ? '0' : `-${r.toks[0].t}`, a: p.wi }; }
    } else if (p.k === 'n') r = digitsNumber(ps, i, en);
    else if (en) r = wordsNumber(ps, i);
    if (r) { out.push(...r.toks); i = r.next; continue; }
    out.push({ t: p.v, a: p.wi, b: p.wi });
    i++;
  }
  return out;
}

/**
 * Canonical comparison tokens of a piece of text: lower case, punctuation stripped, diacritics folded,
 * numerals as digits (see the top of the file). The same text in any spelling of its numbers gives the same tokens.
 * @param {string} text
 * @param {{ language?: string }} [o]
 * @returns {string[]}
 */
export function normalizeText(text, { language = 'en' } = {}) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  return tokenize(words, langOf(language)).map((t) => t.t);
}

/**
 * Script -> words [{ i, text (as written, with attached punctuation), norm: string[] (canonical tokens,
 * usually one; "14%" is two: "14" "percent"; a number written over several words shares its token) }].
 * Whitespace separates words, so "3.5", "1,000", "14%", "$5", "e-mail", "don't" stay single words.
 * @param {string} script
 * @param {{ language?: string }} [o]
 * @returns {{ i: number, text: string, norm: string[] }[]}
 */
export function scriptWords(script, { language = 'en' } = {}) {
  const parts = String(script ?? '').split(/\s+/).filter(Boolean);
  const norm = parts.map(() => []);
  for (const t of tokenize(parts, langOf(language))) for (let w = t.a; w <= t.b; w++) norm[w].push(t.t);
  return parts.map((text, i) => ({ i, text, norm: norm[i] }));
}

// ---------------------------------------------------------------- importing word timings

const SHAPES = 'Accepted shapes: (1) an array of { word | text | punctuated_word, start, end } in seconds (or start_ms/end_ms, or integer milliseconds); '
  + '(2) an object with words at the top (OpenAI verbose_json, AssemblyAI) or at results.channels[0].alternatives[0].words (Deepgram); '
  + '(3) ElevenLabs character alignment { alignment | normalized_alignment: { characters, character_start_times_seconds, character_end_times_seconds } } or those three arrays at the top level; '
  + '(4) whisper.cpp JSON { transcription: [{ offsets: { from, to }, text, tokens? }] }.';

function fromList(list, unit) {
  const rows = list.map((w, k) => {
    if (!isPlain(w)) throw new Error(`word ${k} is not an object like { word, start, end }. ${SHAPES}`);
    const text = w.punctuated_word ?? w.word ?? w.text;
    if (typeof text !== 'string') throw new Error(`word ${k} has no text (expected word, text or punctuated_word). ${SHAPES}`);
    const ms = num(w.start_ms) && num(w.end_ms);
    const start = ms ? w.start_ms : w.start, end = ms ? w.end_ms : w.end;
    if (!num(start) || !num(end)) throw new Error(`word ${k} (${JSON.stringify(text)}) has no numeric start and end. ${SHAPES}`);
    return { text, start, end, ms };
  });
  const plain = rows.filter((r) => !r.ms);
  const msUnits = unit ? unit === 'ms' : plain.length > 0 && plain.every((r) => Number.isInteger(r.start) && Number.isInteger(r.end)) && plain.some((r) => r.start > 600 || r.end > 600);
  return rows.map((r) => (r.ms || msUnits ? { text: r.text, start: r.start / 1000, end: r.end / 1000 } : { text: r.text, start: r.start, end: r.end }));
}

function fromCharacters(al) {
  const chars = al.characters, starts = al.character_start_times_seconds, ends = al.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends) || chars.length !== starts.length || chars.length !== ends.length) {
    throw new Error(`character alignment needs characters, character_start_times_seconds and character_end_times_seconds of the same length. ${SHAPES}`);
  }
  const out = [];
  let cur = null;
  chars.forEach((c, k) => {
    if (typeof c !== 'string' || !num(starts[k]) || !num(ends[k])) throw new Error(`character ${k} has no text or no numeric times. ${SHAPES}`);
    if (c.trim() === '') { cur = null; return; }
    if (!cur) { cur = { text: '', start: starts[k], end: ends[k] }; out.push(cur); }
    cur.text += c.trim();
    cur.end = ends[k];
  });
  return out;
}

const SPECIAL_TOKEN = /^\s*[[<][\s\S]*[\]>]\s*$/;

function fromWhisper(segments) {
  const out = [];
  let cur = null;
  segments.forEach((seg, k) => {
    const off = seg?.offsets;
    if (!isPlain(seg) || !isPlain(off) || !num(off.from) || !num(off.to)) throw new Error(`transcription segment ${k} has no offsets { from, to } in milliseconds. ${SHAPES}`);
    if (Array.isArray(seg.tokens) && seg.tokens.length) {
      let first = true;
      for (const t of seg.tokens) {
        const text = String(t?.text ?? '');
        if (SPECIAL_TOKEN.test(text) || text.trim() === '') continue;
        const o = isPlain(t.offsets) && num(t.offsets.from) && num(t.offsets.to) ? t.offsets : off;
        const punctuation = !/[\p{L}\p{N}]/u.test(text);
        if (!cur || /^\s/.test(text) || (first && !punctuation)) {
          cur = { text: text.trim(), start: o.from / 1000, end: o.to / 1000 };
          out.push(cur);
        } else { cur.text += text.trim(); cur.end = o.to / 1000; }
        first = false;
      }
    } else {
      const text = String(seg.text ?? '');
      if (SPECIAL_TOKEN.test(text)) return;
      const words = text.trim().split(/\s+/).filter(Boolean);
      const total = words.reduce((n, w) => n + w.length, 0);
      let at = 0;
      for (const w of words) {
        const a = off.from + (off.to - off.from) * (at / total);
        at += w.length;
        out.push({ text: w, start: a / 1000, end: (off.from + (off.to - off.from) * (at / total)) / 1000 });
      }
    }
  });
  return out;
}

/**
 * Parse word timings from the shapes services return -> { words: [{ text, start, end }] (seconds, sorted by
 * start, empty words dropped), source: 'word-list' | 'character-alignment' | 'whisper.cpp' }.
 * Milliseconds are told from seconds by option `unit` ('s' | 'ms'), else by start_ms/end_ms fields, else
 * because all values are integers and one is above 600 (AssemblyAI). Unknown shapes throw an Error that lists the accepted shapes.
 * @param {any} input
 * @param {{ unit?: 's' | 'ms' }} [o]
 * @returns {{ words: { text: string, start: number, end: number }[], source: string }}
 */
export function importWords(input, { unit } = {}) {
  let words, source = 'word-list';
  const wordList = (x) => (Array.isArray(x) ? x : null);
  if (Array.isArray(input)) words = fromList(input, unit);
  else if (isPlain(input)) {
    const al = isPlain(input.alignment) ? input.alignment : isPlain(input.normalized_alignment) ? input.normalized_alignment : Array.isArray(input.characters) ? input : null;
    const dg = wordList(input.results?.channels?.[0]?.alternatives?.[0]?.words);
    if (Array.isArray(input.transcription)) { words = fromWhisper(input.transcription); source = 'whisper.cpp'; } else if (al) { words = fromCharacters(al); source = 'character-alignment'; } else if (wordList(input.words)) words = fromList(input.words, unit);
    else if (dg) words = fromList(dg, unit);
    else if (Array.isArray(input.segments) && input.segments.length && input.segments.every((s) => isPlain(s) && Array.isArray(s.words))) words = fromList(input.segments.flatMap((s) => s.words), unit);
  }
  if (!words) throw new Error(`Unrecognised word timings. ${SHAPES}`);
  const clean = words
    .map((w) => ({ text: w.text.trim(), start: w.start, end: Math.max(w.start, w.end) }))
    .filter((w) => w.text !== '')
    .sort((a, b) => a.start - b.start);
  return { words: clean, source };
}

// ---------------------------------------------------------------- alignment

const lev = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};

/**
 * Needleman-Wunsch over two token arrays: pairs [i, j] with -1 for a gap. A match costs 0, a gap 1, a
 * substitution 0.6 to 0.6 + slope (more for tokens that look less alike, so "colour" for "color" beats unrelated pairings).
 * Aligning timings uses slope 0.4 (a misheard word still lends its time); the transcript check uses 0.9, so two
 * unrelated words pair up only when that beats a drop plus an insertion.
 */
function nw(a, b, slope = 0.4) {
  const memo = new Map();
  const sub = (x, y) => {
    const key = `${x}|${y}`;
    let c = memo.get(key);
    if (c === undefined) { c = 0.6 + slope * (lev(x, y) / Math.max(x.length, y.length, 1)); memo.set(key, c); }
    return c;
  };
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ha = a.length, hb = b.length;
  while (ha > lo && hb > lo && a[ha - 1] === b[hb - 1]) { ha--; hb--; }
  const n = ha - lo, m = hb - lo;
  if (n * m > 4e7) throw new Error(`the script and the take differ over too many words to align (${n} x ${m})`);
  const ops = [];
  for (let k = 0; k < lo; k++) ops.push([k, k]);
  const w = m + 1;
  const trace = new Uint8Array((n + 1) * w); // 0 diagonal, 1 skip a script token, 2 skip a heard token
  let prev = new Float64Array(w), cur = new Float64Array(w);
  for (let j = 0; j <= m; j++) { prev[j] = j; trace[j] = 2; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; trace[i * w] = 1;
    for (let j = 1; j <= m; j++) {
      const x = a[lo + i - 1], y = b[lo + j - 1];
      const d = prev[j - 1] + (x === y ? 0 : sub(x, y)), u = prev[j] + 1, l = cur[j - 1] + 1;
      if (d <= u && d <= l) { cur[j] = d; trace[i * w + j] = 0; } else if (u <= l) { cur[j] = u; trace[i * w + j] = 1; } else { cur[j] = l; trace[i * w + j] = 2; }
    }
    [prev, cur] = [cur, prev];
  }
  const mid = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const t = trace[i * w + j];
    if (t === 0) { mid.push([lo + i - 1, lo + j - 1]); i--; j--; } else if (t === 1) { mid.push([lo + i - 1, -1]); i--; } else { mid.push([-1, lo + j - 1]); j--; }
  }
  for (let k = mid.length - 1; k >= 0; k--) ops.push(mid[k]);
  for (let k = 0; k < a.length - ha; k++) ops.push([ha + k, hb + k]);
  return ops;
}

/**
 * Align the words of a take to the script: for every script word whether it was said as written, said
 * differently, or dropped, and which heard words are extra. Times are not involved here.
 */
function alignCore(scriptTexts, heardTexts, lang, slope = 0.4) {
  const S = tokenize(scriptTexts, lang), T = tokenize(heardTexts, lang);
  const ops = nw(S.map((t) => t.t), T.map((t) => t.t), slope);
  const sAl = new Array(S.length).fill(-1), tAl = new Array(T.length).fill(-1), after = new Array(T.length).fill(-1);
  let lastWord = -1;
  for (const [s, t] of ops) {
    if (s >= 0) lastWord = S[s].b;
    if (s >= 0 && t >= 0) { sAl[s] = t; tAl[t] = s; } else if (t >= 0) after[t] = lastWord;
  }
  const sTokens = scriptTexts.map(() => []), tTokens = heardTexts.map(() => []);
  S.forEach((t, k) => { for (let w = t.a; w <= t.b; w++) sTokens[w].push(k); });
  T.forEach((t, k) => { for (let w = t.a; w <= t.b; w++) tTokens[w].push(k); });
  const tExact = (k) => tAl[k] >= 0 && S[tAl[k]].t === T[k].t;

  const words = scriptTexts.map((_, i) => {
    const toks = sTokens[i];
    if (!toks.length) return { status: 'none', heard: [] };
    const heard = new Set();
    let exact = true, any = false;
    for (const s of toks) {
      const t = sAl[s];
      if (t < 0) { exact = false; continue; }
      any = true;
      if (S[s].t !== T[t].t) exact = false;
      for (let w = T[t].a; w <= T[t].b; w++) heard.add(w);
    }
    if (!any) return { status: 'missing', heard: [] };
    const hs = [...heard].sort((x, y) => x - y);
    if (exact) exact = hs.every((w) => tTokens[w].every(tExact));
    return { status: exact ? 'match' : 'sub', heard: hs };
  });
  const extras = [];
  heardTexts.forEach((_, w) => {
    if (tTokens[w].length && tTokens[w].every((k) => tAl[k] < 0)) extras.push({ w, after: after[tTokens[w][0]] });
  });
  return { words, extras };
}

/**
 * Align timed words (from importWords) to the script -> { words: [{ i, text (script form), start, end, spoken? (what was
 * heard when it differs), missing? (the take dropped it) }], extra: [{ text, start, end, after (script index of the word
 * before it, -1 at the start) }], stats: { matched, substituted, missing, extra } }.
 * Needleman-Wunsch over the canonical tokens (a substitution costs less than a gap, and less for look-alike words), so the script word "2026" matches the heard "twenty twenty six" (its time spans
 * them). Dropped words get times spread between their matched neighbours in proportion to their length (at least 1 ms each).
 * Every script word gets a time; times are rounded to the millisecond and never decrease. A script word with no
 * letters or digits ("—") takes its time the same way but counts nowhere in stats.
 * @param {string} script
 * @param {any} timed the words of importWords (or its `words`): [{ text, start, end }]
 * @param {{ language?: string }} [o]
 */
export function alignWords(script, timed, { language = 'en' } = {}) {
  const lang = langOf(language);
  const heard = Array.isArray(timed) ? timed : timed?.words;
  if (!Array.isArray(heard)) throw new Error('alignWords needs the timed words from importWords: [{ text, start, end }]');
  const sw = scriptWords(script, { language });
  const { words: al, extras } = alignCore(sw.map((w) => w.text), heard.map((w) => w.text), lang);

  const start = new Array(sw.length).fill(null), end = new Array(sw.length).fill(null);
  for (let i = 0; i < sw.length; i++) {
    if (al[i].status !== 'match' && al[i].status !== 'sub') continue;
    start[i] = Math.min(...al[i].heard.map((h) => heard[h].start));
    end[i] = Math.max(...al[i].heard.map((h) => heard[h].end));
  }
  // script words sharing the same heard words ("14" "percent" said as "14%") split that time by length
  for (let i = 0; i < sw.length;) {
    let j = i + 1;
    const key = start[i] === null ? null : al[i].heard.join(',');
    while (key !== null && j < sw.length && start[j] !== null && al[j].heard.join(',') === key) j++;
    if (j - i > 1) {
      const a = start[i], b = end[i], total = sw.slice(i, j).reduce((n, w) => n + Math.max(1, w.text.length), 0);
      let at = 0;
      for (let k = i; k < j; k++) {
        start[k] = a + (b - a) * (at / total);
        at += Math.max(1, sw[k].text.length);
        end[k] = a + (b - a) * (at / total);
      }
    }
    i = j;
  }
  // words without a heard counterpart: spread over the gap between their timed neighbours
  for (let i = 0; i < sw.length;) {
    if (start[i] !== null) { i++; continue; }
    let j = i;
    while (j < sw.length && start[j] === null) j++;
    const k = j - i;
    const from = i > 0 ? end[i - 1] : null, to = j < sw.length ? start[j] : null;
    const a = from ?? Math.max(0, (to ?? 0.3 * k) - 0.3 * k);
    const b = to ?? a + 0.3 * k;
    const weights = sw.slice(i, j).map((w) => Math.max(1, w.text.length));
    const total = weights.reduce((n, x) => n + x, 0);
    let at = 0;
    for (let n = 0; n < k; n++) {
      if (b - a >= 0.001 * k) { start[i + n] = a + (b - a) * (at / total); at += weights[n]; end[i + n] = a + (b - a) * (at / total); } else { start[i + n] = a + 0.001 * n; end[i + n] = start[i + n] + 0.001; }
    }
    i = j;
  }

  const words = [];
  const stats = { matched: 0, substituted: 0, missing: 0, extra: extras.length };
  let ps = 0, pe = 0;
  for (let i = 0; i < sw.length; i++) {
    const a = al[i];
    const known = a.status === 'match' || a.status === 'sub';
    const s = Math.max(round3(start[i]), ps);
    let e = Math.max(round3(end[i]), s, pe);
    if (!known && e < s + 0.001) e = round3(s + 0.001);
    ps = s; pe = e;
    const w = { i, text: sw[i].text, start: s, end: e };
    if (a.status === 'match') stats.matched++;
    else if (a.status === 'sub') { stats.substituted++; w.spoken = a.heard.map((h) => heard[h].text).join(' '); } else if (a.status === 'missing') { stats.missing++; w.missing = true; }
    words.push(w);
  }
  const extra = extras.map((x) => ({ text: heard[x.w].text, start: round3(heard[x.w].start), end: round3(heard[x.w].end), after: x.after }));
  return { words, extra, stats };
}

/**
 * Compare a transcript of the take (plain text, a list of words, or timed words) with the script, ignoring case,
 * punctuation and how numbers are written -> { ok (no slips, drops or insertions), slips: [{ i, script, heard }],
 * drops: [{ i, script }], insertions: [{ after, heard }], counts: { script, heard, matched, slips, drops, insertions } }.
 * i and after are script word indices (after: the word before the extra one, -1 at the start).
 * @param {string} script
 * @param {any} transcript a string, a list of strings or { text | word } objects, or { words }
 * @param {{ language?: string }} [o]
 */
export function checkTranscript(script, transcript, { language = 'en' } = {}) {
  const lang = langOf(language);
  let list = transcript;
  if (isPlain(list) && Array.isArray(list.words)) list = list.words;
  const heard = typeof list === 'string' ? list.split(/\s+/).filter(Boolean)
    : Array.isArray(list) ? list.map((w) => (typeof w === 'string' ? w : String(w?.punctuated_word ?? w?.word ?? w?.text ?? ''))).filter((w) => w.trim() !== '')
      : null;
  if (!heard) throw new Error('checkTranscript needs the transcript as text, a list of words, or { words } with timed words');
  const sw = scriptWords(script, { language });
  const { words: al, extras } = alignCore(sw.map((w) => w.text), heard, lang, 0.9);
  const slips = [], drops = [];
  let matched = 0;
  al.forEach((a, i) => {
    if (a.status === 'match') matched++;
    else if (a.status === 'sub') slips.push({ i, script: sw[i].text, heard: a.heard.map((h) => heard[h]).join(' ') });
    else if (a.status === 'missing') drops.push({ i, script: sw[i].text });
  });
  const insertions = extras.map((x) => ({ after: x.after, heard: heard[x.w] }));
  return {
    ok: !slips.length && !drops.length && !insertions.length,
    slips, drops, insertions,
    counts: { script: sw.length, heard: heard.length, matched, slips: slips.length, drops: drops.length, insertions: insertions.length },
  };
}

/**
 * The transcript check over several independent transcripts of the same take (two speech-to-text models, or a
 * person and a model): a word counts as a slip, a drop or an insertion only when every transcript says so, since
 * one recogniser mishearing a word ("eye" as "I", a dropped "a") is not the reader's slip. Same result shape as
 * checkTranscript, plus `each` (every transcript's own result) and `disputed` (what only some of them heard wrong).
 * @param {string} script @param {any[]} transcripts @param {{ language?: string }} [o]
 */
export function checkTranscripts(script, transcripts, o = {}) {
  if (!Array.isArray(transcripts) || !transcripts.length) throw new Error('checkTranscripts needs a list of transcripts');
  const each = transcripts.map((t) => checkTranscript(script, t, o));
  if (each.length === 1) return { ...each[0], each, disputed: [] };
  const keyOf = { slips: (x) => `${x.i}`, drops: (x) => `${x.i}`, insertions: (x) => `${x.after}|${normalizeText(x.heard, o).join(' ')}` };
  const out = {}, disputed = [];
  for (const kind of ['slips', 'drops', 'insertions']) {
    const all = each.map((r) => new Set(r[kind].map(keyOf[kind])));
    out[kind] = each[0][kind].filter((x) => all.every((s) => s.has(keyOf[kind](x))));
    for (const [n, r] of each.entries()) for (const x of r[kind]) if (!all.every((s) => s.has(keyOf[kind](x)))) disputed.push({ kind: kind.slice(0, -1), transcript: n, ...x });
  }
  return {
    ok: !out.slips.length && !out.drops.length && !out.insertions.length,
    slips: out.slips, drops: out.drops, insertions: out.insertions,
    counts: { script: each[0].counts.script, transcripts: each.length, slips: out.slips.length, drops: out.drops.length, insertions: out.insertions.length, disputed: disputed.length },
    each, disputed,
  };
}
