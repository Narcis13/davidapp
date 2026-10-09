// Text layout: wrapping, auto-fit, alignment, emphasis runs in a second font, letter spacing, and
// positions for every line, word and grapheme so animations can move them independently.
//
//   const L = f.lib.text.layout(ctx, 'Every frame is a *function*', {
//     font: 'Inter', weight: 800, size: 120, maxWidth: f.safe.width, maxHeight: 600, fit: true,
//     align: 'center', markup: true, emFont: 'Playfair Display', emItalic: true });
//   for (const w of L.words) f.lib.text.fillWord(ctx, w, x, y);   // x, y = top-left of the block
//
// Positions are relative to the block's top-left corner; `y` values are baselines.
// Graphemes come from Intl.Segmenter, so an emoji (even a ZWJ sequence) is one unit.

/** Fonts tried after the named family, so emoji and symbols still render. */
export const FALLBACK_FONTS = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/**
 * The CSS font for a face. Right after the family comes its "<family> Ext" alias: the bundled families register
 * their Latin Extended files under it, so ă, ș, ț come from the family's own design (Skia and Chrome pick a font
 * per character down the list, so every character the family's main file has is drawn exactly as before).
 */
export function fontString({ font = 'Inter', size = 64, weight = 400, italic = false } = {}) {
  const family = String(font).replace(/"/g, '');
  return `${italic ? 'italic ' : ''}${weight} ${+size.toFixed(2)}px "${family}", "${family} Ext", ${FALLBACK_FONTS}`;
}

/** The family named first in a font string. */
export const familyOf = (font) => /"([^"]+)"/.exec(font)?.[1] ?? 'sans-serif';

/** A text that cannot be drawn at its size floor: overflowing, truncated, or with a word broken in two. */
export class TextFloorError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'TextFloorError';
    this.details = details;
  }
}

/** A stable id for a layout (FNV-1a of its cache key): the same text and options give the same id in every worker. */
function blockId(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `b${(h >>> 0).toString(36)}`;
}

/** The scale a context's current transform applies to lengths (√|det|). */
const scaleOf = (ctx) => {
  const m = typeof ctx?.getTransform === 'function' ? ctx.getTransform() : null;
  return m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1 : 1;
};

let segmenter;
export function graphemes(text) {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Split text into paragraphs of tokens. With markup, *asterisks* mark emphasis and \* is a literal. */
function tokenize(text, markup) {
  /** @type {any[]} */
  const paragraphs = [];
  let em = false;
  for (const para of String(text).split('\n')) {
    /** @type {any} */
    const tokens = [];
    let cur = '', space = false, curEm = em;
    const flush = (glue) => {
      if (cur) tokens.push({ text: cur, em: curEm, space });
      space = cur ? !glue : space;
      cur = '';
    };
    for (let i = 0; i < para.length; i++) {
      const ch = para[i];
      if (markup && ch === '\\' && para[i + 1] === '*') { if (!cur) curEm = em; cur += '*'; i++; continue; }
      if (markup && ch === '*') { flush(true); if (!tokens.length) space = false; em = !em; curEm = em; continue; }
      if (ch === ' ' || ch === '\t') { flush(false); space = true; continue; }
      if (!cur) curEm = em;
      cur += ch;
    }
    flush(false);
    // leading whitespace is indentation (code keeps its shape); a tab counts as two spaces
    tokens.indent = /^[ \t]*/.exec(para)[0].replace(/\t/g, '  ').length;
    paragraphs.push(tokens);
  }
  return paragraphs;
}

/**
 * inspect: the runtime's inspection state, shared with f.lib.solid: { record (fn or null), suppress (skip drawing,
 * keep recording), frame ({ width, height, short } of the frame being drawn), floor (the asset's default floor) }.
 */
export function createText(inspect = { record: null, suppress: false, frame: null, floor: 0 }) {
  const widths = new Map();
  const layouts = new Map();

  const width = (ctx, font, str) => {
    const key = `${font}\n${str}`;
    let w = widths.get(key);
    if (w === undefined) {
      if (widths.size > 20000) widths.clear();
      // measuring must not leave the context's font changed: a cache miss would then draw differently from a hit
      const prev = ctx.font;
      ctx.font = font;
      w = ctx.measureText(str).width;
      ctx.font = prev;
      widths.set(key, w);
    }
    return w;
  };

  const metrics = (ctx, font, size) => {
    const key = `${font}\n\u0000metrics`;
    let m = widths.get(key);
    if (!m) {
      const prev = ctx.font;
      ctx.font = font;
      const tm = ctx.measureText('Hgjpx');
      ctx.font = prev;
      const asc = tm.fontBoundingBoxAscent ?? tm.actualBoundingBoxAscent ?? size * 0.8;
      const desc = tm.fontBoundingBoxDescent ?? tm.actualBoundingBoxDescent ?? size * 0.2;
      m = { asc, desc };
      widths.set(key, m);
    }
    return m;
  };

  function build(ctx, paragraphs, size, o) {
    const base = fontString({ font: o.font, size, weight: o.weight, italic: o.italic });
    const emph = fontString({ font: o.emFont ?? o.font, size, weight: o.emWeight ?? o.weight, italic: o.emItalic ?? o.italic });
    const tracking = (o.letterSpacing ?? 0) * size;
    const spaceW = width(ctx, base, ' ') + 2 * tracking;
    const maxWidth = o.maxWidth ?? Infinity;
    const wrap = (o.wrap ?? 'word') !== 'none' && Number.isFinite(maxWidth);

    const makeWord = (text, em) => {
      const font = em ? emph : base;
      const gs = graphemes(text);
      const glyphs = [];
      let prefix = '', prev = 0;
      for (let i = 0; i < gs.length; i++) {
        prefix += gs[i];
        const w = width(ctx, font, prefix);
        glyphs.push({ ch: gs[i], x: prev + i * tracking, width: w - prev });
        prev = w;
      }
      return { text, em, font, tracking, width: prev + Math.max(0, gs.length - 1) * tracking, glyphs };
    };

    const lines = [];
    let broken = false;
    for (const tokens of paragraphs) {
      let cur = { words: [], width: (tokens.indent ?? 0) * width(ctx, base, ' ') };
      const push = () => { lines.push(cur); cur = { words: [], width: 0 }; };
      for (const tok of tokens) {
        let word = makeWord(tok.text, tok.em);
        let gap = tok.space && cur.words.length ? spaceW : 0;
        if (wrap && cur.words.length && cur.width + gap + word.width > maxWidth + 0.01) { push(); gap = 0; }
        else if (wrap && !cur.words.length && cur.width + word.width > maxWidth + 0.01) cur.width = 0; // an indent that leaves no room is dropped
        // a single word wider than the box breaks between graphemes rather than overflowing
        while (wrap && word.width > maxWidth + 0.01 && word.glyphs.length > 1) {
          let n = 1;
          broken = true;
          while (n < word.glyphs.length - 1 && word.glyphs[n].x + word.glyphs[n].width <= maxWidth) n++;
          const head = makeWord(word.glyphs.slice(0, n).map((g) => g.ch).join(''), tok.em);
          cur.words.push({ ...head, lx: cur.width + gap, gap });
          cur.width += gap + head.width;
          push(); gap = 0;
          word = makeWord(word.glyphs.slice(n).map((g) => g.ch).join(''), tok.em);
        }
        cur.words.push({ ...word, lx: cur.width + gap, gap });
        cur.width += gap + word.width;
      }
      lines.push(cur);
    }

    // maxLines: drop the overflow and end the last kept line with an ellipsis
    let truncated = false;
    const maxLines = Number.isFinite(o.maxLines) ? Math.max(1, Math.floor(o.maxLines)) : 0;
    if (maxLines && lines.length > maxLines) {
      truncated = true;
      lines.length = maxLines;
      const last = lines[lines.length - 1];
      while (last.words.length) {
        const w = last.words[last.words.length - 1];
        const cut = makeWord(`${w.text.replace(/[.,;:!?…]+$/, '')}…`, w.em);
        if (w.lx + cut.width <= maxWidth || last.words.length === 1) {
          last.words[last.words.length - 1] = { ...cut, lx: w.lx, gap: w.gap };
          last.width = w.lx + cut.width;
          break;
        }
        last.words.pop();
        last.width = w.lx - w.gap;
      }
    }

    const { asc, desc } = metrics(ctx, base, size);
    const lineHeight = size * (o.lineHeight ?? 1.15);
    const blockWidth = lines.reduce((m, l) => Math.max(m, l.width), 0);
    const boxWidth = Number.isFinite(maxWidth) ? maxWidth : blockWidth;
    const align = o.align ?? 'left';
    const out = { size, font: base, lineHeight, ascent: asc, descent: desc, width: blockWidth, boxWidth, height: lines.length * lineHeight, truncated, broken, lines: [], words: [], glyphs: [], length: 0 };
    let pos = 0;
    lines.forEach((l, li) => {
      const x = align === 'center' ? (boxWidth - l.width) / 2 : align === 'right' ? boxWidth - l.width : 0;
      const top = li * lineHeight;
      const y = top + (lineHeight - (asc + desc)) / 2 + asc;
      const line = { index: li, x, y, top, width: l.width, height: lineHeight, words: [], text: l.words.map((w, i) => (i && w.gap ? ' ' : '') + w.text).join('') };
      for (const w of l.words) {
        if (w.gap && line.words.length) pos++;
        const word = { index: out.words.length, line: li, text: w.text, em: w.em, font: w.font, tracking: w.tracking, x: x + w.lx, y, top, width: w.width, height: lineHeight, glyphs: [], pos };
        for (const g of w.glyphs) {
          const glyph = { index: out.glyphs.length, word: word.index, line: li, ch: g.ch, font: w.font, em: w.em, x: word.x + g.x, y, top, width: g.width, height: lineHeight, pos: pos++ };
          word.glyphs.push(glyph);
          out.glyphs.push(glyph);
        }
        line.words.push(word);
        out.words.push(word);
      }
      pos++; // the line break counts as one position, like a typed Enter
      out.lines.push(line);
    });
    out.length = Math.max(0, pos - 1);
    return out;
  }

  /**
   * Lay out text. Options: font, weight, italic, size, lineHeight (multiple of size), letterSpacing (em),
   * maxWidth, maxHeight, maxLines, align (left|center|right), wrap (word|none), fit (shrink size until the
   * block fits maxWidth × maxHeight), minSize, markup (*emphasis*), emFont, emWeight, emItalic,
   * transform (upper|lower), floor (the smallest on-screen size, % of the frame's short side), role ('ticker': text
   * that scrolls past and is not meant to be read in full; check_clip does not hold it to reading time).
   * @param {any} ctx @param {string} text @param {any} [opts]
   */
  function layout(ctx, text, opts = {}) {
    const o = { font: 'Inter', weight: 400, italic: false, size: 64, ...opts };
    let str = String(text ?? '');
    if (o.transform === 'upper') str = str.toUpperCase();
    else if (o.transform === 'lower') str = str.toLowerCase();
    // a size floor (opt-in): a share of the frame's short side, as a size in this context's units
    const floor = o.floor ?? inspect.floor ?? 0;
    const minLocal = floor > 0 && inspect.frame ? ((floor / 100) * inspect.frame.short) / scaleOf(ctx) : 0;
    const key = minLocal ? JSON.stringify([str, o, Math.round(minLocal * 100) / 100]) : JSON.stringify([str, o]);
    const hit = layouts.get(key);
    if (hit) return hit;
    const paragraphs = tokenize(str, !!o.markup);
    const maxWidth = o.maxWidth ?? Infinity, maxHeight = o.maxHeight ?? Infinity;
    // fitting prefers a smaller size over cutting a word in two or dropping lines
    const fits = (L) => L.width <= maxWidth + 0.5 && L.height <= maxHeight + 0.5 && !L.truncated && !L.broken;
    let L;
    if (!minLocal) {
      L = build(ctx, paragraphs, o.size, o);
      if (o.fit && !fits(L)) {
        let lo = Math.min(o.minSize ?? 8, o.size), hi = o.size;
        while (hi - lo > 0.5) {
          const mid = (lo + hi) / 2;
          if (fits(build(ctx, paragraphs, mid, o))) lo = mid; else hi = mid;
        }
        L = build(ctx, paragraphs, Math.floor(lo * 2) / 2, o);
      }
    } else {
      // fit stops at the floor; what still does not fit there is an error, never an ellipsis
      const px = ((floor / 100) * inspect.frame.short);
      const fail = (reason, extra = {}) => {
        throw new TextFloorError(`text "${str.length > 60 ? `${str.slice(0, 57)}…` : str}" cannot be drawn at its size floor (${floor}% of the frame's short side, ${+px.toFixed(1)} px on screen): ${reason}`, { text: str, floor, floorPx: +px.toFixed(1), reason, ...extra });
      };
      if (o.size < minLocal - 0.01) fail(`its size is ${+(o.size * (px / minLocal)).toFixed(1)} px on screen`, { size: o.size });
      L = build(ctx, paragraphs, o.size, o);
      if (o.fit && !fits(L)) {
        let lo = Math.max(Math.min(o.minSize ?? 8, o.size), minLocal), hi = o.size;
        if (!fits(build(ctx, paragraphs, lo, o))) hi = lo;
        while (hi - lo > 0.5) {
          const mid = (lo + hi) / 2;
          if (fits(build(ctx, paragraphs, mid, o))) lo = mid; else hi = mid;
        }
        L = build(ctx, paragraphs, Math.max(minLocal, Math.floor(lo * 2) / 2), o);
      }
      if (L.truncated) fail(`it needs more than ${o.maxLines} line${o.maxLines === 1 ? '' : 's'}`);
      if (L.broken) fail('a word does not fit on one line and would break in two');
      if (L.width > maxWidth + 0.5) fail(`it is ${Math.round(L.width - maxWidth)} px too wide for its box`);
      if (L.height > maxHeight + 0.5) fail(`it is ${Math.round(L.height - maxHeight)} px too tall for its box`);
    }
    L.text = str;
    // what the layout report needs about every word and glyph (not enumerable: assets see the same objects as before)
    const meta = { block: blockId(key), size: L.size, ascent: L.ascent, descent: L.descent, floor, role: o.role };
    for (const list of [L.words, L.glyphs]) for (const item of list) Object.defineProperty(item, 'layoutMeta', { value: meta });
    // layouts are shared between frames and assets through the cache, so nobody may change one
    for (const list of [L.lines, L.words, L.glyphs]) { for (const item of list) Object.freeze(item); Object.freeze(list); }
    for (const line of L.lines) Object.freeze(line.words);
    for (const word of L.words) Object.freeze(word.glyphs);
    Object.freeze(L);
    if (layouts.size > 2000) layouts.clear();
    layouts.set(key, L);
    return L;
  }

  /** Width of a single unwrapped line. */
  /** @param {any} ctx @param {string} text @param {any} [opts] */
  const measure = (ctx, text, opts = {}) => layout(ctx, text, { ...opts, maxWidth: undefined, fit: false, wrap: 'none' }).width;

  const prep = (ctx, font) => { ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; };

  /** The ink extents of a string in the context's current font (relative to its pen position and baseline). */
  const ink = (ctx, str) => {
    const key = `${ctx.font}\n\u0001${str}`;
    let k = widths.get(key);
    if (!k) {
      const m = ctx.measureText(str);
      k = { left: m.actualBoundingBoxLeft ?? 0, right: m.actualBoundingBoxRight ?? m.width, ascent: m.actualBoundingBoxAscent ?? 0, descent: m.actualBoundingBoxDescent ?? 0 };
      if (widths.size > 20000) widths.clear();
      widths.set(key, k);
    }
    return k;
  };

  /** Tell the recorder what a draw call puts on the canvas: the ink box and line box in the context's coordinates. */
  function record(ctx, part, parts, x, y, stroke) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) {
      const k = ink(ctx, p.ch ?? p.text);
      const px = x + p.x, py = y + p.y;
      x0 = Math.min(x0, px - k.left); x1 = Math.max(x1, px + k.right);
      y0 = Math.min(y0, py - k.ascent); y1 = Math.max(y1, py + k.descent);
    }
    if (!(x1 > x0)) { x0 = x + part.x; x1 = x0 + part.width; y0 = y + part.y; y1 = y0; }
    const meta = part.layoutMeta ?? {};
    const style = stroke ? ctx.strokeStyle : ctx.fillStyle;
    inspect.record({
      kind: 'text', text: part.text ?? part.ch, glyph: part.ch !== undefined || undefined, word: part.ch !== undefined ? part.word : part.index, font: part.font, family: familyOf(part.font), size: meta.size ?? null, floor: meta.floor ?? 0, block: meta.block ?? null, role: meta.role,
      ink: [x0, y0, x1, y1], line: [x + part.x, y + part.top, x + part.x + part.width, y + part.top + part.height],
      matrix: ctx.getTransform(), canvas: ctx.canvas, fill: typeof style === 'string' ? style : 'gradient', alpha: ctx.globalAlpha, stroke,
    });
  }

  /** Draw one word of a layout with the block's top-left at (x, y). */
  function fillWord(ctx, word, x = 0, y = 0) {
    prep(ctx, word.font);
    if (inspect.record) record(ctx, word, word.tracking ? word.glyphs : [word], x, y, false);
    if (inspect.suppress) return;
    if (word.tracking) for (const g of word.glyphs) ctx.fillText(g.ch, x + g.x, y + g.y);
    else ctx.fillText(word.text, x + word.x, y + word.y);
  }
  function strokeWord(ctx, word, x = 0, y = 0) {
    prep(ctx, word.font);
    if (inspect.record) record(ctx, word, word.tracking ? word.glyphs : [word], x, y, true);
    if (inspect.suppress) return;
    if (word.tracking) for (const g of word.glyphs) ctx.strokeText(g.ch, x + g.x, y + g.y);
    else ctx.strokeText(word.text, x + word.x, y + word.y);
  }
  /** Draw one grapheme of a layout with the block's top-left at (x, y). */
  function fillGlyph(ctx, glyph, x = 0, y = 0) {
    prep(ctx, glyph.font);
    if (inspect.record) record(ctx, glyph, [glyph], x, y, false);
    if (inspect.suppress) return;
    ctx.fillText(glyph.ch, x + glyph.x, y + glyph.y);
  }
  /** Draw a line; style: { color, emColor } (fillStyle is left alone when color is omitted). */
  /** @param {any} ctx @param {any} line @param {number} [x] @param {number} [y] @param {any} [style] */
  function fillLine(ctx, line, x = 0, y = 0, style = {}) {
    for (const w of line.words) {
      const c = w.em ? style.emColor ?? style.color : style.color;
      if (c) ctx.fillStyle = c;
      fillWord(ctx, w, x, y);
    }
  }
  /** Draw the whole block. */
  function fill(ctx, L, x = 0, y = 0, style = {}) {
    for (const line of L.lines) fillLine(ctx, line, x, y, style);
  }

  const clearCache = () => { widths.clear(); layouts.clear(); };

  return { layout, measure, fill, fillLine, fillWord, strokeWord, fillGlyph, fontString, graphemes, clearCache, TextFloorError };
}
