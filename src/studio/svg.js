// Uploaded SVGs: a strict parser, an allowlist sanitiser and the vector model behind f.svg().
//
// An SVG is a document that can run script and fetch things, so an upload is rebuilt from an
// allowlist rather than cleaned up: only known drawing elements and attributes survive, every
// reference must point inside the file (#id), and anything that executes, embeds or fetches is
// dropped: <script>, event handlers (on*), <foreignObject>, external href/xlink:href, <image>,
// <style> (CSS can @import and url()), SMIL animation (it can rewrite href). A DOCTYPE or a custom
// entity rejects the file outright (entity expansion, external entities).
//
// With `styles: true` a <style> is not dropped but read: its simple rules (see parseSheet) are applied to
// the elements they match as presentation attributes, following the cascade, and the element goes. Nothing
// of the CSS text survives except those attributes, each checked like any other attribute. What could not be
// kept is listed in a report ({ kept, dropped: [{ what, why }] }) that the upload hands back.

import { parsePath, pathLength } from '../core/lib/svg.js';
import { createCanvas } from '../render/host.js';

export class SvgError extends Error {}

const MAX_BYTES = 2_000_000, MAX_DEPTH = 64, MAX_NODES = 20000;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(code > 0 && code < 0x110000)) throw new SvgError(`bad character reference ${m}`);
      return String.fromCodePoint(code);
    }
    if (!Object.hasOwn(ENTITIES, e)) throw new SvgError(`unknown entity ${m} (only the XML entities are allowed)`);
    return ENTITIES[e];
  });
}

/** Parse XML into { name, attrs: [[k, v]], children } elements and { text } nodes. Strict; throws SvgError. */
export function parseXml(text) {
  if (text.length > MAX_BYTES) throw new SvgError(`the SVG is ${text.length} bytes; the limit is ${MAX_BYTES}`);
  const root = { name: '#root', attrs: [], children: [] };
  const stack = [root];
  let i = 0, nodes = 0;
  const top = () => stack[stack.length - 1];
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { top().children.push({ text: decodeEntities(text.slice(i)) }); break; }
    if (lt > i) top().children.push({ text: decodeEntities(text.slice(i, lt)) });
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e < 0) throw new SvgError('unterminated comment'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt); if (e < 0) throw new SvgError('unterminated CDATA'); top().children.push({ text: text.slice(lt + 9, e) }); i = e + 3; continue; }
    if (/^<!DOCTYPE/i.test(text.slice(lt, lt + 9)) || text.startsWith('<!ENTITY', lt)) throw new SvgError('a DOCTYPE or entity declaration is not allowed in an uploaded SVG');
    if (text.startsWith('<?', lt)) {
      const e = text.indexOf('?>', lt);
      if (e < 0) throw new SvgError('unterminated processing instruction');
      if (!/^<\?xml[\s?]/.test(text.slice(lt, lt + 6))) throw new SvgError('processing instructions other than <?xml …?> are not allowed');
      i = e + 2;
      continue;
    }
    if (text[lt + 1] === '/') {
      const m = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(text.slice(lt));
      if (!m) throw new SvgError(`bad closing tag at ${lt}`);
      if (top().name !== m[1]) throw new SvgError(`</${m[1]}> does not close <${top().name}>`);
      stack.pop();
      i = lt + m[0].length;
      continue;
    }
    const m = /^<([A-Za-z_][\w:.-]*)/.exec(text.slice(lt));
    if (!m) throw new SvgError(`bad markup at ${lt}`);
    const el = { name: m[1], attrs: [], children: [] };
    let j = lt + m[0].length;
    for (;;) {
      while (/\s/.test(text[j] ?? '')) j++;
      if (text.startsWith('/>', j)) { j += 2; top().children.push(el); break; }
      if (text[j] === '>') { j += 1; top().children.push(el); stack.push(el); break; }
      const a = /^([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.slice(j));
      if (!a) throw new SvgError(`bad attribute in <${el.name}> at ${j}`);
      el.attrs.push([a[1], decodeEntities(a[3] ?? a[4])]);
      j += a[0].length;
    }
    if (++nodes > MAX_NODES) throw new SvgError(`more than ${MAX_NODES} elements`);
    if (stack.length > MAX_DEPTH) throw new SvgError(`nested deeper than ${MAX_DEPTH} levels`);
    i = j;
  }
  if (stack.length !== 1) throw new SvgError(`<${top().name}> is never closed`);
  return root;
}

const ELEMENTS = new Set(['svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'symbol', 'use', 'marker',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feMerge', 'feMergeNode', 'feFlood', 'feComposite', 'feDropShadow']);
const UNWRAP = new Set(['a', 'switch']);   // kept for their children, the element itself goes
const ATTRS = new Set(['id', 'class', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'points', 'viewBox', 'preserveAspectRatio',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'clip-path', 'clip-rule', 'mask', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'patternUnits', 'patternContentUnits', 'patternTransform', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'visibility', 'display',
  'color', 'xmlns', 'xmlns:xlink', 'version', 'style', 'href', 'xlink:href', 'filter', 'stdDeviation', 'dx', 'dy', 'in', 'in2', 'result', 'mode', 'type', 'values', 'operator', 'k1', 'k2', 'k3', 'k4',
  'flood-color', 'flood-opacity', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'marker-start', 'marker-mid', 'marker-end', 'xml:space', 'filterUnits', 'primitiveUnits']);
const CSS_PROPS = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'visibility', 'display', 'color', 'clip-path', 'mask', 'filter', 'mix-blend-mode', 'isolation']);

const COLOR_FNS = ['rgb', 'rgba', 'hsl', 'hsla'], TRANSFORM_FNS = ['matrix', 'translate', 'scale', 'rotate', 'skewx', 'skewy'];
const TRANSFORM_ATTRS = new Set(['transform', 'gradientTransform', 'patternTransform']);
/**
 * What a value may not carry, or null when it is fine. Checked positively, since a value that fails
 * to parse here can still parse in a renderer: no CSS escapes (u\72l), and once every well-formed
 * url(#id) is taken out, no function left but colours (and transform functions where a transform goes).
 * So an unclosed url(http://…, a protocol-relative url(//…) and image-set('http://…') all go.
 */
function badValue(v, transforms = false) {
  if (v.includes('\\')) return 'an escape';
  const rest = v.replace(/url\(\s*(['"]?)#[^\s()'"]+\1\s*\)/gi, ' ');
  // each "(" and the name before it; looked up backwards from the bracket so a long run of letters costs nothing
  for (let at = rest.indexOf('('); at >= 0; at = rest.indexOf('(', at + 1)) {
    const name = /([\w-]*)\s*$/.exec(rest.slice(Math.max(0, at - 64), at))[1];
    const fn = name.toLowerCase();
    if (!COLOR_FNS.includes(fn) && !(transforms && TRANSFORM_FNS.includes(fn))) return fn === 'url' ? 'external url()' : `${name || 'a bare '}()`;
  }
  return null;
}
const dangerous = (v) => /javascript:|vbscript:|data:(?!image\/(png|jpeg|webp);)|expression\s*\(|@import|behaviou?r\s*:/i.test(v);

// ── what could not be kept ────────────────────────────────────────────────────────────────────

const REPORT_MAX = 50;
/** An empty report: what was kept (short strings) and what was dropped ({ what, why }). */
export const newReport = () => ({ kept: [], dropped: [] });
const clip = (s, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function keep(report, what) { if (report.kept.length < REPORT_MAX && !report.kept.includes(what)) report.kept.push(what); }
/** Note one dropped thing; a repeat is ignored and a list past REPORT_MAX ends with a note saying so. */
export function drop(report, what, why) {
  what = clip(String(what)); why = clip(String(why), 140);
  if (report.dropped.length > REPORT_MAX || report.dropped.some((d) => d.what === what)) return;
  report.dropped.push(report.dropped.length === REPORT_MAX ? { what: 'more', why: `only the first ${REPORT_MAX} are listed` } : { what, why });
}

// ── internal style sheets ─────────────────────────────────────────────────────────────────────

const CSS_MAX = { sheet: 200_000, rules: 1000, decls: 8000 };
// the properties a rule may give an element: those a style attribute may carry that are also presentation attributes
const CSS_APPLIED = new Set([...CSS_PROPS, 'clip-rule', 'flood-color', 'flood-opacity', 'marker-start', 'marker-mid', 'marker-end'].filter((p) => p !== 'mix-blend-mode' && p !== 'isolation'));
const SIMPLE_SELECTOR = /^(\*|[A-Za-z][\w-]*)?((?:[.#][A-Za-z_][\w-]*)*)$/;

function stripComments(s) {
  let out = '', i = 0;
  for (;;) {
    const a = s.indexOf('/*', i);
    if (a < 0) return out + s.slice(i);
    out += s.slice(i, a);
    const b = s.indexOf('*/', a + 2);
    if (b < 0) return out;
    i = b + 2;
  }
}

/** The index of the first of `stops` at or after i that is outside quotes and brackets, or the end. */
function skipTo(s, i, stops) {
  let depth = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { for (i++; i < s.length && s[i] !== ch; i++) if (s[i] === '\\') i++; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && stops.includes(ch)) return i;
  }
  return s.length;
}
function splitTop(s, sep) {
  const parts = [];
  for (let i = 0; i <= s.length;) { const j = skipTo(s, i, sep); parts.push(s.slice(i, j)); i = j + 1; }
  return parts;
}
/** The index of the } that closes the { at `open`, or the end. */
function blockEnd(s, open) {
  for (let depth = 1, i = open + 1; i < s.length; i++) {
    i = skipTo(s, i, '{}');
    if (i >= s.length) break;
    if (s[i] === '{') depth++; else if (--depth === 0) return i;
  }
  return s.length;
}

/** A simple selector (type, class, id, or a compound of them; * for any) → { type, ids, classes, spec: [ids, classes, types] }, or { why }. */
function parseSelector(raw) {
  const s = raw.trim(), m = SIMPLE_SELECTOR.exec(s);
  if (!s || !m) return { why: s.includes(':') ? 'pseudo-classes and pseudo-elements are not supported' : s.includes('[') ? 'attribute selectors are not supported' : /[\s>+~]/.test(s) ? 'combinators are not supported' : 'only type, class and id selectors are supported' };
  const parts = m[2].match(/[.#][^.#]+/g) ?? [];
  const ids = parts.filter((x) => x[0] === '#').map((x) => x.slice(1)), classes = parts.filter((x) => x[0] === '.').map((x) => x.slice(1));
  const type = m[1] && m[1] !== '*' ? m[1] : null;
  return { type, ids, classes, spec: [ids.length, classes.length, type ? 1 : 0] };
}

/**
 * Read one style sheet into `rules` ([{ sels, decls: [{ prop, value, important, seq }] }]) and note what was
 * left out in `report`. Strict and small: rules with simple selectors and plain declarations of the properties
 * in CSS_APPLIED, nothing else. At-rules (@import, @media, @font-face…) are skipped whole, a declaration whose
 * value could fetch or hide something (url() that is not #id, escapes, functions other than colours) is dropped, and
 * `st` (shared by the sheets of a file) caps the rules and declarations kept.
 */
function parseSheet(text, report, rules, st) {
  let s = stripComments(text);
  if (s.length > CSS_MAX.sheet) { drop(report, `style sheet text past ${CSS_MAX.sheet} characters`, 'the rest of a very long style sheet is ignored'); s = s.slice(0, CSS_MAX.sheet); }
  let i = 0;
  while (i < s.length) {
    while (i < s.length && s.charCodeAt(i) <= 32) i++;
    if (i >= s.length) break;
    if (s[i] === '@') {
      const j = skipTo(s, i, ';{'), name = /^@[\w-]*/.exec(s.slice(i, i + 40))[0].toLowerCase();
      drop(report, `${name} rule`, name === '@import' ? 'a style sheet is never fetched' : 'at-rules are not applied');
      i = (s[j] === '{' ? blockEnd(s, j) : j) + 1;
      continue;
    }
    const j = skipTo(s, i, '{;}');
    if (s[j] !== '{') { drop(report, `"${s.slice(i, j).trim()}"`, 'not a rule'); i = j + 1; continue; }
    const end = blockEnd(s, j), prelude = s.slice(i, j).trim(), body = s.slice(j + 1, end), where = clip(prelude, 40);
    i = end + 1;
    if (body.includes('{')) { drop(report, `${where} { … }`, 'nested rules are not applied'); continue; }
    if (st.rules >= CSS_MAX.rules || st.decls >= CSS_MAX.decls) { drop(report, `rules past the first ${CSS_MAX.rules}`, 'a style sheet is read up to a limit'); continue; }
    const sels = [];
    for (const part of splitTop(prelude, ',')) {
      const sel = parseSelector(part);
      if (sel.why) drop(report, `selector "${clip(part.trim(), 40)}"`, sel.why); else sels.push(sel);
    }
    const decls = [];
    for (const part of splitTop(body, ';')) {
      if (!part.trim()) continue;
      const c = part.indexOf(':');
      if (c < 0) { drop(report, `"${clip(part.trim(), 30)}" in ${where}`, 'not a declaration'); continue; }
      const prop = part.slice(0, c).trim().toLowerCase();
      let value = part.slice(c + 1).trim().replace(/\s+/g, ' ');
      const important = /!\s*important$/i.test(value);
      if (important) value = value.replace(/\s*!\s*important$/i, '');
      if (!CSS_APPLIED.has(prop)) { drop(report, `property "${clip(prop, 30)}" in ${where}`, 'not a presentation property the studio draws'); continue; }
      const bad = !value ? 'an empty value' : value.length > 1000 ? 'a value over 1000 characters' : /[!{}]/.test(value) ? 'not a plain value' : badValue(value) ?? (dangerous(value) ? 'an unsafe value' : null);
      if (bad) { drop(report, `${prop} in ${where}`, `${bad}; only colours and url(#id) references are kept`); continue; }
      decls.push({ prop, value, important, seq: st.seq++ });
    }
    if (!sels.length || !decls.length) continue;
    st.rules++; st.decls += decls.length;
    rules.push({ sels, decls });
  }
}


/** Apply rules to the cleaned tree: per property the winner by importance, specificity (id > class > type) and order, below the style attribute. */
function applyRules(tree, rules, report) {
  const byId = new Map(), byClass = new Map(), byType = new Map(), any = [];
  const add = (map, key, entry) => { const list = map.get(key); if (list) list.push(entry); else map.set(key, [entry]); };
  for (const rule of rules) {
    for (const sel of rule.sels) {
      const entry = { sel, rule };
      if (sel.ids.length) add(byId, sel.ids[0], entry);
      else if (sel.classes.length) add(byClass, sel.classes[0], entry);
      else if (sel.type) add(byType, sel.type, entry);
      else any.push(entry);
    }
  }
  const beats = (d, spec, cur) => {
    if (d.important !== cur.d.important) return d.important;
    for (let k = 0; k < 3; k++) if (spec[k] !== cur.spec[k]) return spec[k] > cur.spec[k];
    return d.seq > cur.d.seq;
  };
  const used = new Set();
  const visit = (el) => {
    if (!el.name) return;
    const id = attr(el, 'id'), classes = (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
    const found = [...(byId.get(id) ?? []), ...classes.flatMap((c) => byClass.get(c) ?? []), ...(byType.get(el.name) ?? []), ...any];
    const best = new Map();
    for (const { sel, rule } of found) {
      if ((sel.type && sel.type !== el.name) || !sel.ids.every((x) => x === id) || !sel.classes.every((c) => classes.includes(c))) continue;
      for (const d of rule.decls) { const cur = best.get(d.prop); if (!cur || beats(d, sel.spec, cur)) best.set(d.prop, { d, spec: sel.spec, rule }); }
    }
    if (best.size) {
      const own = (attr(el, 'style') ?? '').split(';').map((d) => d.trim()).filter(Boolean).map((text) => ({ text, prop: text.split(':')[0].trim().toLowerCase(), important: /!\s*important$/i.test(text) }));
      let styleChanged = false;
      for (const [prop, b] of best) {
        const mine = own.find((x) => x.prop === prop);
        if (mine && (mine.important || !b.d.important)) continue;   // the style attribute wins, unless only the rule is important
        const at = el.attrs.findIndex(([k]) => k === prop);
        if (at >= 0) el.attrs[at][1] = b.d.value; else el.attrs.push([prop, b.d.value]);
        used.add(b.rule);
        for (const x of own.filter((y) => y.prop === prop)) { x.text = ''; styleChanged = true; }
      }
      if (styleChanged) {
        const left = own.map((x) => x.text).filter(Boolean).join('; ');
        const at = el.attrs.findIndex(([k]) => k === 'style');
        if (left) el.attrs[at][1] = left; else el.attrs.splice(at, 1);
      }
    }
    el.children.forEach(visit);
  };
  visit(tree);
  keep(report, `style sheet: ${used.size} of ${rules.length} rules applied to elements`);
}

/**
 * Sanitise an SVG: returns { svg (the rebuilt document), removed: [what was dropped], tree }.
 * Throws SvgError when the file cannot be accepted at all.
 */
export function sanitizeSvg(text, opts = {}) {
  const src = String(text).replace(/^\uFEFF/, '');
  const doc = parseXml(src);
  const roots = doc.children.filter((c) => c.name);
  if (doc.children.some((c) => c.text?.trim())) throw new SvgError('there is text outside the <svg> element');
  if (roots.length !== 1 || roots[0].name !== 'svg') throw new SvgError('the file is not an SVG: its root element must be <svg>');
  const removed = [];
  const note = (s) => { if (!removed.includes(s)) removed.push(s); };
  const sheets = [];   // the <style> elements met on the way (opts.styles), read once the tree is built
  const clean = (el) => {
    const out = { name: el.name, attrs: [], children: [] };
    for (const [k, v] of el.attrs) {
      if (/^on/i.test(k)) { note(`event handler ${k} on <${el.name}>`); continue; }
      if (!ATTRS.has(k)) { note(`attribute ${k} on <${el.name}>`); continue; }
      if (k === 'href' || k === 'xlink:href') { if (!v.startsWith('#')) { note(`external ${k} on <${el.name}>`); continue; } }
      // a style attribute is filtered declaration by declaration below; other values whole
      if (k !== 'style' && dangerous(v)) { note(`unsafe value in ${k} on <${el.name}>`); continue; }
      const bad = k === 'style' ? null : badValue(v, TRANSFORM_ATTRS.has(k));
      if (bad) { note(`${bad} in ${k} on <${el.name}>`); continue; }
      if (k === 'style') {
        const kept = v.split(';').map((d) => d.trim()).filter(Boolean).filter((d) => {
          const [prop, ...rest] = d.split(':');
          const val = rest.join(':').trim();
          const ok = CSS_PROPS.has(prop.trim().toLowerCase()) && !badValue(val) && !dangerous(val);
          if (!ok) note(`style property "${prop.trim()}" on <${el.name}>`);
          return ok;
        });
        if (kept.length) out.attrs.push([k, kept.join('; ')]);
        continue;
      }
      out.attrs.push([k, v]);
    }
    for (const c of el.children) {
      if (c.text !== undefined) { out.children.push({ text: c.text }); continue; }
      if (c.name === 'style' && opts.styles) { sheets.push(c); continue; }
      if (ELEMENTS.has(c.name)) out.children.push(clean(c));
      else if (UNWRAP.has(c.name)) { note(`<${c.name}> (its contents kept)`); out.children.push(...clean({ ...c, name: 'g', attrs: [] }).children); }
      else note(`<${c.name}>`);
    }
    return out;
  };
  const tree = clean(roots[0]);
  if (!tree.attrs.some(([k]) => k === 'xmlns')) tree.attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg']);
  let report;
  if (opts.styles) {
    report = newReport();
    const rules = [], st = { rules: 0, decls: 0, seq: 0 };
    for (const sheet of sheets) {
      const type = attr(sheet, 'type'), media = attr(sheet, 'media');
      if (type && type.trim().toLowerCase() !== 'text/css') { drop(report, `<style type="${type}">`, 'only CSS style sheets are read'); continue; }
      if (media && !/^\s*(all|screen)?\s*$/i.test(media)) { drop(report, `<style media="${media}">`, 'a style sheet for one medium is not applied'); continue; }
      parseSheet(sheet.children.map((c) => c.text ?? '').join(''), report, rules, st);
    }
    if (rules.length) applyRules(tree, rules, report);
    flattenGradients(tree);
    ellipsesToPaths(tree);
    for (const what of removed) drop(report, what, 'removed by the sanitiser');
  }
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(tree)}\n`, removed, tree, report };
}

const esc = (s, attr) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(attr ? /"/g : /$^/, '&quot;');
function serialize(el) {
  if (el.text !== undefined) return esc(el.text, false);
  const attrs = el.attrs.map(([k, v]) => ` ${k}="${esc(v, true)}"`).join('');
  return el.children.length ? `<${el.name}${attrs}>${el.children.map(serialize).join('')}</${el.name}>` : `<${el.name}${attrs}/>`;
}

// ── the vector model ──────────────────────────────────────────────────────────────────────────

const num = (v, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/** Parse an SVG transform list into a matrix [a, b, c, d, e, f]. */
export function parseTransform(s) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of String(s ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t;
    if (fn === 'matrix') t = a.length === 6 ? a : [1, 0, 0, 1, 0, 0];
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s2 = Math.sin(r);
      t = [c, s2, -s2, c, 0, 0];
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility', 'color', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset'];

/** A declaration's value without its !important. */
const plain = (v) => v.replace(/\s*!\s*important$/i, '').trim();

function styleOf(el, parent) {
  const s = { ...parent, opacity: 1 };
  const own = {};
  for (const [k, v] of el.attrs) if (STYLE_KEYS.includes(k)) own[k] = plain(v);
  for (const [k, v] of el.attrs) if (k === 'style') for (const d of v.split(';')) { const [p, ...r] = d.split(':'); if (STYLE_KEYS.includes(p?.trim())) own[p.trim()] = plain(r.join(':')); }
  for (const k of Object.keys(own)) if (own[k] === 'inherit') delete own[k];   // the parent's value stays
  Object.assign(s, own);
  s.opacity = (parent.groupOpacity ?? 1) * num(own.opacity ?? '1', 1);
  return s;
}

const attr = (el, k) => el.attrs.find(([a]) => a === k)?.[1];
const useTarget = (el, ids) => ids.get((attr(el, 'href') ?? attr(el, 'xlink:href') ?? '').slice(1));
function indexIds(tree) {
  const ids = new Map();
  const index = (el) => { if (!el.name) return; const id = attr(el, 'id'); if (id) ids.set(id, el); el.children.forEach(index); };
  index(tree);
  return ids;
}

const shapes = new WeakMap();
/**
 * An element's own outline as path commands ({ cmds, length }, or null when it draws none). Worked
 * out once per element: a <use> can draw the same path thousands of times.
 */
function shapeOf(el) {
  if (shapes.has(el)) return shapes.get(el);
  let d = null;
  const a = (k) => num(attr(el, k));
  if (el.name === 'path') d = attr(el, 'd');
  else if (el.name === 'rect') {
    const x = a('x'), y = a('y'), rw = a('width'), rh = a('height');
    let rx = num(attr(el, 'rx') ?? attr(el, 'ry'), 0), ry = num(attr(el, 'ry') ?? attr(el, 'rx'), 0);
    rx = Math.min(rx, rw / 2); ry = Math.min(ry, rh / 2);
    d = rx || ry ? `M${x + rx},${y}H${x + rw - rx}A${rx},${ry} 0 0 1 ${x + rw},${y + ry}V${y + rh - ry}A${rx},${ry} 0 0 1 ${x + rw - rx},${y + rh}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + rh - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z` : `M${x},${y}H${x + rw}V${y + rh}H${x}Z`;
  } else if (el.name === 'circle' || el.name === 'ellipse') {
    const cx = a('cx'), cy = a('cy'), rx = el.name === 'circle' ? a('r') : a('rx'), ry = el.name === 'circle' ? a('r') : a('ry');
    d = `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
  } else if (el.name === 'line') d = `M${a('x1')},${a('y1')}L${a('x2')},${a('y2')}`;
  else if (el.name === 'polyline' || el.name === 'polygon') {
    const pts = (attr(el, 'points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    if (pts.length >= 4) d = `M${pts.slice(0, 2).join(',')}L${pts.slice(2).join(',')}${el.name === 'polygon' ? 'Z' : ''}`;
  }
  let shape = null;
  if (d) {
    try { const cmds = parsePath(d); if (cmds.length) shape = { cmds, length: Math.round(pathLength(cmds) * 1000) / 1000 }; } catch { /* malformed path data draws nothing */ }
  }
  shapes.set(el, shape);
  return shape;
}

/** What walking a drawing may cost before the studio stops: elements visited and path commands drawn, with every <use> followed. */
export const VECTOR_BUDGET = { nodes: 20_000, commands: 200_000 };
/** What <use> may add to a document before it is refused: the rasteriser expands every reference too (about half a second at these numbers). */
export const USE_BUDGET = { nodes: 200_000, commands: 5_000_000 };

/**
 * What the <use> elements of a document add to it once expanded: { nodes, commands } (elements and
 * path commands drawn beyond the document's own). Counted, not expanded: each element's total is
 * worked out once, so groups of <use> nested ten deep (10^12 shapes) cost one pass over the elements.
 */
export function useExpansion(tree) {
  const ids = indexIds(tree);
  const totals = new Map(), open = new Set();
  let own = 0, ownCommands = 0;
  const total = (el, depth) => {
    if (!el.name) return [0, 0];
    const known = totals.get(el);
    if (known) return known;
    // a reference that comes back to itself draws nothing; a chain of references this long is refused
    if (open.has(el)) return [0, 0];
    if (depth > 256) return [Infinity, Infinity];
    open.add(el);
    const sum = [1, shapeOf(el)?.cmds.length ?? 0];
    for (const c of [...el.children, ...(el.name === 'use' ? [useTarget(el, ids)].filter(Boolean) : [])]) { const t = total(c, depth + 1); sum[0] += t[0]; sum[1] += t[1]; }
    open.delete(el);
    totals.set(el, sum);
    return sum;
  };
  const count = (el) => { if (!el.name) return; own++; ownCommands += shapeOf(el)?.cmds.length ?? 0; el.children.forEach(count); };
  count(tree);
  const [nodes, commands] = total(tree, 0);
  return { nodes: nodes - own, commands: commands - ownCommands };
}

/**
 * The SVG's drawable paths as data (see src/core/lib/svg.js); text is left to the raster.
 * A drawing over VECTOR_BUDGET comes back with no paths and `over: true`: it has a raster, but no f.svg().
 *
 * By default a gradient becomes its first stop's colour (the model every upload had until gradients were kept).
 * With `gradients: true` the model has `v: 2`: linear and radial gradients are kept (see readGradient), a path
 * has its `bb`, `miter` and dashes, and `report` ({ kept, dropped }, see newReport) is told what the model leaves out.
 * @param {any} tree
 * @param {{ gradients?: boolean, report?: { kept: string[], dropped: { what: string, why: string }[] } }} [o]
 */
export function vectorModel(tree, o = {}) {
  const v2 = !!o.gradients, report = o.report ?? newReport();
  const vb = (attr(tree, 'viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const w = num(attr(tree, 'width'), vb[2] ?? 300), h = num(attr(tree, 'height'), vb[3] ?? 150);
  const viewBox = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, w, h];
  const ids = indexIds(tree);
  const gradients = {}, read = new Map();
  /** A fill or stroke: a colour, 'none', or in a v2 model 'url(#id)' naming an entry of `gradients`. */
  const paintV2 = (v, s) => {
    const ref = /^url\(\s*(['"]?)#([^)\s'"]+)\1\s*\)\s*(.*)$/.exec(v);
    if (!ref) return v === 'currentColor' ? s.color ?? '#000000' : v;
    const [, , id, rest] = ref, fallback = rest.trim() && rest.trim() !== 'none' ? rest.trim() : null;
    const g = ids.get(id);
    if (g?.name === 'linearGradient' || g?.name === 'radialGradient') {
      if (!read.has(id)) read.set(id, readGradient(id, g, ids, viewBox, report));
      const got = read.get(id);
      if (got.gradient) { gradients[id] = got.gradient; return `url(#${id})`; }
      return got.solid;
    }
    if (!g) drop(report, `reference to #${id}`, 'no element has that id');
    return fallback ?? 'none';   // a pattern or anything else that is not drawn (listed with the other undrawn elements)
  };
  const paint = (v, s) => {
    if (!v || v === 'none') return v === 'none' ? 'none' : null;
    if (v2) return paintV2(v, s);
    if (v === 'currentColor') return s.color ?? '#000000';
    const ref = /^url\(\s*#([^)\s]+)\s*\)/.exec(v);
    if (ref) { const g = ids.get(ref[1]); const stop = g?.children.find((c) => c.name === 'stop'); return stop ? (attr(stop, 'stop-color') ?? /stop-color:\s*([^;]+)/.exec(attr(stop, 'style') ?? '')?.[1]?.trim() ?? '#000000') : '#000000'; }
    return v;
  };
  const paths = [];
  let nodes = 0, commands = 0, over = false;
  const walk = (el, m, parent, depth) => {
    if (over || !el.name || depth > 32 || paths.length > 4000) return;
    // nested <use> multiplies: ten levels of ten references are 10^10 visits with nothing to show for them
    if (++nodes > VECTOR_BUDGET.nodes) { over = true; return; }
    if (['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'linearGradient', 'radialGradient', 'marker', 'filter', 'title', 'desc', 'text'].includes(el.name) && depth > 0) return;
    const s = styleOf(el, parent);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const mm = mul(m, parseTransform(attr(el, 'transform')));
    const group = { ...s, groupOpacity: s.opacity };
    if (el.name === 'svg' || el.name === 'g') { for (const c of el.children) walk(c, mm, group, depth + 1); return; }
    if (el.name === 'use') {
      const target = useTarget(el, ids);
      if (target) walk(target.name === 'symbol' ? { ...target, name: 'g' } : target, mul(mm, [1, 0, 0, 1, num(attr(el, 'x')), num(attr(el, 'y'))]), group, depth + 1);
      return;
    }
    const shape = shapeOf(el);
    if (!shape) return;
    if ((commands += shape.cmds.length) > VECTOR_BUDGET.commands) { over = true; return; }
    const path = {
      d: shape.cmds, fill: paint(s.fill ?? '#000000', s), stroke: paint(s.stroke ?? 'none', s), strokeWidth: num(s['stroke-width'], 1), opacity: s.opacity,
      fillOpacity: num(s['fill-opacity'], 1), strokeOpacity: num(s['stroke-opacity'], 1), fillRule: s['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
      lineCap: s['stroke-linecap'] ?? 'butt', lineJoin: s['stroke-linejoin'] ?? 'miter', m: mm.map((v) => Math.round(v * 1e6) / 1e6), length: shape.length,
    };
    if (v2) {
      const ml = num(s['stroke-miterlimit'], 4);
      path.miter = ml >= 1 ? ml : 4;
      const dash = parseDash(s['stroke-dasharray']);
      if (dash) { path.dash = dash; path.dashOffset = num(s['stroke-dashoffset'], 0); }
      else if (s['stroke-dasharray'] && !/^\s*none\s*$/i.test(s['stroke-dasharray']) && path.stroke !== 'none') drop(report, `stroke-dasharray "${s['stroke-dasharray']}"`, 'not a list of lengths; drawn solid');
      if ([path.fill, path.stroke].some((x) => typeof x === 'string' && x.startsWith('url(#'))) path.bb = bounds(shape.cmds).map((x) => Math.round(x * 1e4) / 1e4);
    }
    paths.push(path);
  };
  walk(tree, [1, 0, 0, 1, 0, 0], { fill: '#000000' }, 0);
  if (!v2) return over ? { width: w, height: h, viewBox, paths: [], over: true } : { width: w, height: h, viewBox, paths };
  if (over) { drop(report, 'vector model', `the drawing is over the limit of ${VECTOR_BUDGET.nodes} elements or ${VECTOR_BUDGET.commands} path commands; only the image is kept`); return { v: 2, width: w, height: h, viewBox, paths: [], over: true }; }
  keep(report, `${paths.length} paths in the vector model`);
  listUndrawn(tree, ids, report);
  const model = { v: 2, width: w, height: h, viewBox, paths };
  if (Object.keys(gradients).length) model.gradients = gradients;
  return model;
}

// ── gradients and what f.svg() does not draw ──────────────────────────────────────────────────

/** "5", "50%", "1.5px" → a number; a percentage is a share of `of`. */
function length(str, def, of = 1) {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(%|[a-z]*)\s*$/i.exec(str ?? '');
  if (!m) return def;
  return m[2] === '%' ? (parseFloat(m[1]) / 100) * of : parseFloat(m[1]);
}
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** A dash pattern as numbers, or null for none (or a list that is not lengths). */
function parseDash(v) {
  if (!v || /^\s*none\s*$/i.test(v)) return null;
  const list = v.trim().split(/[\s,]+/).map((x) => (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(x) ? parseFloat(x) : NaN));
  return list.length && list.every((x) => x >= 0) && list.some((x) => x > 0) ? list : null;
}

let probe;
/** A CSS colour → [r, g, b, a]; hex, rgb(), hsl() and the keywords. What does not parse is black, as in a renderer. */
function rgbaOf(c) {
  const s = String(c).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    const x = m[1].length < 6 ? [...m[1]].map((d) => d + d) : m[1].match(/../g);
    return [parseInt(x[0], 16), parseInt(x[1], 16), parseInt(x[2], 16), x[3] ? parseInt(x[3], 16) / 255 : 1];
  }
  m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[2].split(/[\s,/]+/).filter(Boolean);
    if (p.length >= 3) {
      const part = (x, scale) => (x.endsWith('%') ? (parseFloat(x) / 100) * scale : parseFloat(x));
      const a = p[3] === undefined ? 1 : Math.min(1, Math.max(0, part(p[3], 1)));
      if (m[1].startsWith('rgb')) return [0, 1, 2].map((i) => Math.round(Math.min(255, Math.max(0, part(p[i], 255))))).concat(a);
      const hh = (((parseFloat(p[0]) % 360) + 360) % 360) / 360, ss = Math.min(1, Math.max(0, parseFloat(p[1]) / 100)), ll = Math.min(1, Math.max(0, parseFloat(p[2]) / 100));
      const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, pp = 2 * ll - q;
      const f = (t) => { t = (t + 1) % 1; return Math.round(255 * (t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp)); };
      return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3), a];
    }
  }
  // a keyword: let the rasteriser say what it is, by painting one pixel
  probe ??= createCanvas(1, 1).getContext('2d');
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000000';
  probe.fillStyle = s;
  probe.fillRect(0, 0, 1, 1);
  const px = probe.getImageData(0, 0, 1, 1).data;
  return px[3] === 0 ? [0, 0, 0, 0] : [px[0], px[1], px[2], 1];
}
const hex2 = (n) => n.toString(16).padStart(2, '0');
const colourString = ([r, g, b, a]) => (a >= 1 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `rgba(${r}, ${g}, ${b}, ${round(a, 3)})`);

/** A property of an element as written: in its style attribute, else as a presentation attribute. */
function propOf(el, name) {
  let v;
  for (const d of (attr(el, 'style') ?? '').split(';')) { const [p, ...r] = d.split(':'); if (p.trim().toLowerCase() === name) v = plain(r.join(':')); }
  return v ?? attr(el, name);
}

/** The geometric bounding box [x0, y0, x1, y1] of path commands (curves to their extremes). */
function bounds(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, x = 0, y = 0, sx = 0, sy = 0;
  const add = (px, py) => { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); };
  const cubicRoots = (p0, p1, p2, p3) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const d = b * b - 4 * a * c;
    return d < 0 ? [] : [(-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a)];
  };
  for (const c of cmds) {
    if (c[0] === 'M') { x = sx = c[1]; y = sy = c[2]; add(x, y); }
    else if (c[0] === 'L') { x = c[1]; y = c[2]; add(x, y); }
    else if (c[0] === 'C') {
      const at = (t, p0, p1, p2, p3) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
      for (const t of [...cubicRoots(x, c[1], c[3], c[5]), ...cubicRoots(y, c[2], c[4], c[6])]) if (t > 0 && t < 1) add(at(t, x, c[1], c[3], c[5]), at(t, y, c[2], c[4], c[6]));
      x = c[5]; y = c[6]; add(x, y);
    } else if (c[0] === 'Q') {
      const at = (t, p0, p1, p2) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
      for (const t of [(x - c[1]) / (x - 2 * c[1] + c[3]), (y - c[2]) / (y - 2 * c[2] + c[4])]) if (t > 0 && t < 1) add(at(t, x, c[1], c[3]), at(t, y, c[2], c[4]));
      x = c[3]; y = c[4]; add(x, y);
    } else if (c[0] === 'Z') { x = sx; y = sy; }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

const GRADIENT_COMMON = ['gradientUnits', 'gradientTransform', 'spreadMethod'];
const GRADIENT_GEOMETRY = { linearGradient: ['x1', 'y1', 'x2', 'y2'], radialGradient: ['cx', 'cy', 'r', 'fx', 'fy'] };
/** A gradient and the gradients its href leads to, nearest first: a gradient without stops or attributes of its own takes them from the next (a loop or a long chain ends it). */
function gradientChain(g, ids) {
  const chain = [g];
  for (let next = useTarget(g, ids); next && chain.length < 16 && !chain.includes(next) && GRADIENT_GEOMETRY[next.name]; next = useTarget(next, ids)) chain.push(next);
  return chain;
}
/**
 * The rasteriser that draws the stored image paints an <ellipse> that has a gradient fill or stroke black, so such an
 * ellipse becomes the <path> with the same outline (a circle is drawn correctly and stays).
 */
function ellipsesToPaths(el) {
  if (!el.name) return;
  if (el.name === 'ellipse' && ['fill', 'stroke'].some((k) => /url\(/.test(attr(el, k) ?? ''))) {
    const n = (k) => num(attr(el, k)), cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry');
    el.name = 'path';
    el.attrs = el.attrs.filter(([k]) => !['cx', 'cy', 'rx', 'ry'].includes(k));
    el.attrs.push(['d', `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`]);
  }
  el.children.forEach(ellipsesToPaths);
}

/**
 * Give every gradient what it inherits through href (stops and attributes) and drop the href: the rasteriser that
 * draws the stored image follows xlink:href only, and not through every step, so the file it gets is made plain.
 */
function flattenGradients(tree) {
  const ids = indexIds(tree);
  for (const g of ids.values()) {
    if (!GRADIENT_GEOMETRY[g.name] || !(attr(g, 'href') ?? attr(g, 'xlink:href'))) continue;
    const chain = gradientChain(g, ids);
    for (const name of [...GRADIENT_COMMON, ...GRADIENT_GEOMETRY[g.name]]) {
      if (attr(g, name) !== undefined) continue;
      const from = chain.find((n) => (GRADIENT_COMMON.includes(name) || n.name === g.name) && attr(n, name) !== undefined);
      if (from) g.attrs.push([name, attr(from, name)]);
    }
    if (!g.children.some((c) => c.name === 'stop')) g.children.push(...(chain.map((n) => n.children.filter((c) => c.name === 'stop')).find((l) => l.length) ?? []));
    g.attrs = g.attrs.filter(([k]) => k !== 'href' && k !== 'xlink:href');
  }
}

/**
 * A <linearGradient> or <radialGradient> as a model entry: { gradient } for two stops or more, or { solid }
 * (a colour, or 'none' without stops) when it paints one flat colour. Stops, units, spread and the geometry
 * attributes come from the gradient or, when it has none, the gradients its href chain leads to. Only `pad` is drawn;
 * `reflect` and `repeat` are reported and drawn as pad.
 */
function readGradient(id, g, ids, viewBox, report) {
  const chain = gradientChain(g, ids);
  const pick = (name, sameKind = false) => { for (const n of chain) if (!sameKind || n.name === g.name) { const v = attr(n, name); if (v !== undefined) return v; } };
  const radial = g.name === 'radialGradient', box = pick('gradientUnits') !== 'userSpaceOnUse';
  const spread = (pick('spreadMethod') ?? 'pad').trim();
  if (spread !== 'pad') drop(report, `spreadMethod="${spread}" on #${id}`, 'f.svg() draws it as pad');
  const stopEls = chain.map((n) => n.children.filter((c) => c.name === 'stop')).find((l) => l.length) ?? [];
  let last = 0;
  const stops = stopEls.map((st) => {
    const at = Math.min(1, Math.max(last, length(propOf(st, 'offset'), 0)));
    last = at;
    const [r, gg, b, a] = rgbaOf(propOf(st, 'stop-color') ?? '#000000');
    const op = Math.min(1, Math.max(0, parseFloat(propOf(st, 'stop-opacity') ?? '1')));
    return [round(at), colourString([r, gg, b, a * (Number.isFinite(op) ? op : 1)])];
  });
  if (!stops.length) return { solid: 'none' };
  if (stops.length === 1) return { solid: stops[0][1] };
  const [, , vw, vh] = viewBox, diag = Math.sqrt((vw * vw + vh * vh) / 2);
  const m = parseTransform(pick('gradientTransform')).map((x) => round(x));
  // box units: fractions of the shape's box (a percentage is the same fraction); user units: the viewport, for percentages
  const at = (name, def, axis, same = true) => {
    const of = box ? 1 : axis === 'x' ? vw : axis === 'y' ? vh : diag;
    return round(length(pick(name, same), def, of), 4);
  };
  const gradient = { type: radial ? 'radial' : 'linear', units: box ? 'box' : 'user', m, stops };
  if (radial) {
    Object.assign(gradient, { cx: at('cx', box ? 0.5 : vw * 0.5, 'x'), cy: at('cy', box ? 0.5 : vh * 0.5, 'y'), r: at('r', box ? 0.5 : diag * 0.5, 'r') });
    gradient.fx = at('fx', gradient.cx, 'x'); gradient.fy = at('fy', gradient.cy, 'y');
  } else {
    Object.assign(gradient, { x1: at('x1', 0, 'x'), y1: at('y1', 0, 'y'), x2: at('x2', box ? 1 : vw, 'x'), y2: at('y2', 0, 'y') });
  }
  keep(report, `${gradient.type} gradient #${id} (${stops.length} stops${chain.length > 1 ? ', inherited' : ''})`);
  return { gradient };
}

const UNDRAWN = { filter: 'filters', mask: 'masks', pattern: 'patterns', clipPath: 'clip paths', marker: 'markers' };
/** Note the elements the model leaves to the raster: those used by a drawing (a filter, mask, pattern, clip path, marker), and text. */
function listUndrawn(tree, ids, report) {
  const used = new Set();
  let text = false;
  const scan = (el) => {
    if (!el.name) return;
    if (el.name === 'text') text = true;
    for (const [, v] of el.attrs) for (const m of v.matchAll(/url\(\s*['"]?#([^)\s'"]+)/g)) used.add(m[1]);
    el.children.forEach(scan);
  };
  scan(tree);
  for (const [id, el] of ids) if (Object.hasOwn(UNDRAWN, el.name) && used.has(id)) drop(report, `<${el.name}> #${id}`, `f.svg() does not draw ${UNDRAWN[el.name]}`);
  if (text) drop(report, '<text>', 'f.svg() does not draw text');
}
