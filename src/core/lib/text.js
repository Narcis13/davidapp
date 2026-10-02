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

export function fontString({ font = 'Inter', size = 64, weight = 400, italic = false } = {}) {
  return `${italic ? 'italic ' : ''}${weight} ${+size.toFixed(2)}px "${String(font).replace(/"/g, '')}", ${FALLBACK_FONTS}`;
}

let segmenter;
export function graphemes(text) {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Split text into paragraphs of tokens. With markup, *asterisks* mark emphasis and \* is a literal. */
function tokenize(text, markup) {
  const paragraphs = [];
  let em = false;
  for (const para of String(text).split('\n')) {
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
    paragraphs.push(tokens);
  }
  return paragraphs;
}

export function createText() {
  const widths = new Map();
  const layouts = new Map();

  const width = (ctx, font, str) => {
    const key = `${font}\n${str}`;
    let w = widths.get(key);
    if (w === undefined) {
      if (widths.size > 20000) widths.clear();
      ctx.font = font;
      w = ctx.measureText(str).width;
      widths.set(key, w);
    }
    return w;
  };

  const metrics = (ctx, font, size) => {
    const key = `${font}\n\u0000metrics`;
    let m = widths.get(key);
    if (!m) {
      ctx.font = font;
      const tm = ctx.measureText('Hgjpx');
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
    for (const tokens of paragraphs) {
      let cur = { words: [], width: 0 };
      const push = () => { lines.push(cur); cur = { words: [], width: 0 }; };
      for (const tok of tokens) {
        let word = makeWord(tok.text, tok.em);
        let gap = tok.space && cur.words.length ? spaceW : 0;
        if (wrap && cur.words.length && cur.width + gap + word.width > maxWidth + 0.01) { push(); gap = 0; }
        // a single word wider than the box breaks between graphemes rather than overflowing
        while (wrap && word.width > maxWidth + 0.01 && word.glyphs.length > 1) {
          let n = 1;
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
    if (o.maxLines && lines.length > o.maxLines) {
      truncated = true;
      lines.length = o.maxLines;
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
    const out = { size, font: base, lineHeight, ascent: asc, descent: desc, width: blockWidth, boxWidth, height: lines.length * lineHeight, truncated, lines: [], words: [], glyphs: [], length: 0 };
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
   * transform (upper|lower).
   * @param {any} ctx @param {string} text @param {any} [opts]
   */
  function layout(ctx, text, opts = {}) {
    const o = { font: 'Inter', weight: 400, italic: false, size: 64, ...opts };
    let str = String(text ?? '');
    if (o.transform === 'upper') str = str.toUpperCase();
    else if (o.transform === 'lower') str = str.toLowerCase();
    const key = JSON.stringify([str, o]);
    const hit = layouts.get(key);
    if (hit) return hit;
    const paragraphs = tokenize(str, !!o.markup);
    const maxWidth = o.maxWidth ?? Infinity, maxHeight = o.maxHeight ?? Infinity;
    const fits = (L) => L.width <= maxWidth + 0.5 && L.height <= maxHeight + 0.5 && !L.truncated;
    let L = build(ctx, paragraphs, o.size, o);
    if (o.fit && !fits(L)) {
      let lo = Math.min(o.minSize ?? 8, o.size), hi = o.size;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        if (fits(build(ctx, paragraphs, mid, o))) lo = mid; else hi = mid;
      }
      L = build(ctx, paragraphs, Math.floor(lo * 2) / 2, o);
    }
    L.text = str;
    if (layouts.size > 2000) layouts.clear();
    layouts.set(key, L);
    return L;
  }

  /** Width of a single unwrapped line. */
  /** @param {any} ctx @param {string} text @param {any} [opts] */
  const measure = (ctx, text, opts = {}) => layout(ctx, text, { ...opts, maxWidth: undefined, fit: false, wrap: 'none' }).width;

  const prep = (ctx, font) => { ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; };

  /** Draw one word of a layout with the block's top-left at (x, y). */
  function fillWord(ctx, word, x = 0, y = 0) {
    prep(ctx, word.font);
    if (word.tracking) for (const g of word.glyphs) ctx.fillText(g.ch, x + g.x, y + g.y);
    else ctx.fillText(word.text, x + word.x, y + word.y);
  }
  function strokeWord(ctx, word, x = 0, y = 0) {
    prep(ctx, word.font);
    if (word.tracking) for (const g of word.glyphs) ctx.strokeText(g.ch, x + g.x, y + g.y);
    else ctx.strokeText(word.text, x + word.x, y + word.y);
  }
  /** Draw one grapheme of a layout with the block's top-left at (x, y). */
  function fillGlyph(ctx, glyph, x = 0, y = 0) {
    prep(ctx, glyph.font);
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

  return { layout, measure, fill, fillLine, fillWord, strokeWord, fillGlyph, fontString, graphemes, clearCache };
}
