// Uploaded SVGs: a strict parser, an allowlist sanitiser and the vector model behind f.svg().
//
// An SVG is a document that can run script and fetch things, so an upload is rebuilt from an
// allowlist rather than cleaned up: only known drawing elements and attributes survive, every
// reference must point inside the file (#id), and anything that executes, embeds or fetches is
// dropped: <script>, event handlers (on*), <foreignObject>, external href/xlink:href, <image>,
// <style> (CSS can @import and url()), SMIL animation (it can rewrite href). A DOCTYPE or a custom
// entity rejects the file outright (entity expansion, external entities).

import { parsePath, pathLength } from '../core/lib/svg.js';

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

const localUrlsOnly = (v) => !/url\s*\(/i.test(v) || [...v.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)].every((m) => m[2].startsWith('#'));
const dangerous = (v) => /javascript:|vbscript:|data:(?!image\/(png|jpeg|webp);)|expression\s*\(|@import|behaviou?r\s*:/i.test(v);

/**
 * Sanitise an SVG: returns { svg (the rebuilt document), removed: [what was dropped], tree }.
 * Throws SvgError when the file cannot be accepted at all.
 */
export function sanitizeSvg(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const doc = parseXml(src);
  const roots = doc.children.filter((c) => c.name);
  if (doc.children.some((c) => c.text?.trim())) throw new SvgError('there is text outside the <svg> element');
  if (roots.length !== 1 || roots[0].name !== 'svg') throw new SvgError('the file is not an SVG: its root element must be <svg>');
  const removed = [];
  const note = (s) => { if (!removed.includes(s)) removed.push(s); };
  const clean = (el) => {
    const out = { name: el.name, attrs: [], children: [] };
    for (const [k, v] of el.attrs) {
      if (/^on/i.test(k)) { note(`event handler ${k} on <${el.name}>`); continue; }
      if (!ATTRS.has(k)) { note(`attribute ${k} on <${el.name}>`); continue; }
      if (k === 'href' || k === 'xlink:href') { if (!v.startsWith('#')) { note(`external ${k} on <${el.name}>`); continue; } }
      // a style attribute is filtered declaration by declaration below; other values whole
      if (k !== 'style' && dangerous(v)) { note(`unsafe value in ${k} on <${el.name}>`); continue; }
      if (k !== 'style' && !localUrlsOnly(v)) { note(`external url() in ${k} on <${el.name}>`); continue; }
      if (k === 'style') {
        const kept = v.split(';').map((d) => d.trim()).filter(Boolean).filter((d) => {
          const [prop, ...rest] = d.split(':');
          const val = rest.join(':').trim();
          const ok = CSS_PROPS.has(prop.trim().toLowerCase()) && localUrlsOnly(val) && !dangerous(val);
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
      if (ELEMENTS.has(c.name)) out.children.push(clean(c));
      else if (UNWRAP.has(c.name)) { note(`<${c.name}> (its contents kept)`); out.children.push(...clean({ ...c, name: 'g', attrs: [] }).children); }
      else note(`<${c.name}>`);
    }
    return out;
  };
  const tree = clean(roots[0]);
  if (!tree.attrs.some(([k]) => k === 'xmlns')) tree.attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg']);
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(tree)}\n`, removed, tree };
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

const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility', 'color'];

function styleOf(el, parent) {
  const s = { ...parent, opacity: 1 };
  const own = {};
  for (const [k, v] of el.attrs) if (STYLE_KEYS.includes(k)) own[k] = v.trim();
  for (const [k, v] of el.attrs) if (k === 'style') for (const d of v.split(';')) { const [p, ...r] = d.split(':'); if (STYLE_KEYS.includes(p?.trim())) own[p.trim()] = r.join(':').trim(); }
  Object.assign(s, own);
  s.opacity = (parent.groupOpacity ?? 1) * num(own.opacity ?? '1', 1);
  return s;
}

/** The SVG's drawable paths as data (see src/core/lib/svg.js); gradients become their first stop's colour, text is left to the raster. */
export function vectorModel(tree) {
  const attr = (el, k) => el.attrs.find(([a]) => a === k)?.[1];
  const vb = (attr(tree, 'viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const w = num(attr(tree, 'width'), vb[2] ?? 300), h = num(attr(tree, 'height'), vb[3] ?? 150);
  const viewBox = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, w, h];
  const ids = new Map();
  const index = (el) => { if (!el.name) return; const id = attr(el, 'id'); if (id) ids.set(id, el); el.children.forEach(index); };
  index(tree);
  const paint = (v, s) => {
    if (!v || v === 'none') return v === 'none' ? 'none' : null;
    if (v === 'currentColor') return s.color ?? '#000000';
    const ref = /^url\(\s*#([^)\s]+)\s*\)/.exec(v);
    if (ref) { const g = ids.get(ref[1]); const stop = g?.children.find((c) => c.name === 'stop'); return stop ? (attr(stop, 'stop-color') ?? /stop-color:\s*([^;]+)/.exec(attr(stop, 'style') ?? '')?.[1]?.trim() ?? '#000000') : '#000000'; }
    return v;
  };
  const paths = [];
  const walk = (el, m, parent, depth) => {
    if (!el.name || depth > 32 || paths.length > 4000) return;
    if (['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'linearGradient', 'radialGradient', 'marker', 'filter', 'title', 'desc', 'text'].includes(el.name) && depth > 0) return;
    const s = styleOf(el, parent);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const mm = mul(m, parseTransform(attr(el, 'transform')));
    const group = { ...s, groupOpacity: s.opacity };
    if (el.name === 'svg' || el.name === 'g') { for (const c of el.children) walk(c, mm, group, depth + 1); return; }
    if (el.name === 'use') {
      const target = ids.get((attr(el, 'href') ?? attr(el, 'xlink:href') ?? '').slice(1));
      if (target) walk(target.name === 'symbol' ? { ...target, name: 'g' } : target, mul(mm, [1, 0, 0, 1, num(attr(el, 'x')), num(attr(el, 'y'))]), group, depth + 1);
      return;
    }
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
    if (!d) return;
    let cmds;
    try { cmds = parsePath(d); } catch { return; }
    if (!cmds.length) return;
    paths.push({
      d: cmds, fill: paint(s.fill ?? '#000000', s), stroke: paint(s.stroke ?? 'none', s), strokeWidth: num(s['stroke-width'], 1), opacity: s.opacity,
      fillOpacity: num(s['fill-opacity'], 1), strokeOpacity: num(s['stroke-opacity'], 1), fillRule: s['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
      lineCap: s['stroke-linecap'] ?? 'butt', lineJoin: s['stroke-linejoin'] ?? 'miter', m: mm.map((v) => Math.round(v * 1e6) / 1e6), length: Math.round(pathLength(cmds) * 1000) / 1000,
    });
  };
  walk(tree, [1, 0, 0, 1, 0, 0], { fill: '#000000' }, 0);
  return { width: w, height: h, viewBox, paths };
}
