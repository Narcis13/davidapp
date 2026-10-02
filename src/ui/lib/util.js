// Small DOM and formatting helpers shared by every screen. No framework: `h()` builds elements.

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * h('div.card.wide', { onclick, 'data-testid': 'x', hidden: true }, child, 'text', [more])
 * Props whose name has a dash, or that are not DOM properties, become attributes.
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props !== null && props !== undefined && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { children.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') { if (v) el.className = `${el.className} ${v}`.trim(); }
    else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; } }
    else if (k.includes('-') || k === 'role' || k === 'for' || k === 'list' || !(k in el)) { if (v !== false) el.setAttribute(k, v === true ? '' : String(v)); }
    else el[k] = v;
  }
  append(el, children);
  return el;
}

/** Replace an element's children; like h(), accepts nodes, strings, arrays and null. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** SVG element: every prop is an attribute. */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

const ICONS = {
  play: '<path d="M6 4.2v11.6L16 10z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M5.5 4h3.2v12H5.5zM11.3 4h3.2v12h-3.2z" fill="currentColor" stroke="none"/>',
  search: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6"/>',
  up: '<path d="M5 12l5-5 5 5"/>',
  down: '<path d="M5 8l5 5 5-5"/>',
  back: '<path d="M11.5 4.5L6 10l5.5 5.5"/>',
  function: '<path d="M7 3.5C5.5 3.5 5 4.5 5 6v2c0 1-.6 2-2 2 1.400 0 2 1 2 2v2c0 1.500.5 2.500 2 2.500M13 3.500c1.500 0 2 1 2 2.500v2c0 1 .6 2 2 2-1.400 0-2 1-2 2v2c0 1.500-.5 2.500-2 2.500"/>',
  value: '<path d="M4 15c3 0 3-10 6-10s3 10 6 10"/>',
  audio: '<path d="M3 10h1.500M6.500 6v8M9.500 3.500v13M12.500 7v6M15.500 9v2"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="1.500"/><path d="M3 13l4-4 4 4 2-2 4 4"/><circle cx="13" cy="8" r="1.200"/>',
  sound: '<path d="M4 8v4h3l4 3V5L7 8zM14 7.500a3.500 3.500 0 0 1 0 5"/>',
  font: '<path d="M4.500 16L10 4l5.500 12M6.600 11.500h6.800"/>',
  film: '<rect x="2.500" y="4" width="15" height="12" rx="1.600"/><path d="M6 4v12M14 4v12"/>',
  download: '<path d="M10 3.500v9M6 9l4 4 4-4M4 16.500h12"/>',
  fork: '<circle cx="6" cy="4.500" r="1.800"/><circle cx="14" cy="4.500" r="1.800"/><circle cx="10" cy="15.500" r="1.800"/><path d="M6 6.300c0 4 4 3 4 7.400M14 6.300c0 4-4 3-4 7.400"/>',
};

/** An inline icon (stroke follows the text colour). */
export function icon(name, size = 18) {
  const el = s('svg', { viewBox: '0 0 20 20', width: size, height: size, class: 'icon', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  el.innerHTML = ICONS[name] ?? '';
  return el;
}

/** The icon that stands for an asset without a thumbnail. */
export const assetIcon = (a) => (a.type === 'function' ? (a.kind === 'audio' ? 'audio' : a.kind === 'value' ? 'value' : 'function') : a.type);

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** 83.456 → "1:23.46" */
export function fmtTime(t) {
  const cs = Math.max(0, Math.round((t ?? 0) * 100));
  return `${Math.floor(cs / 6000)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

/** 83.4 → "1 min 23 s", 2 → "2 s", 0.18 → "0.18 s" */
export function fmtDuration(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return 'any length';
  if (sec < 60) return `${trim(sec, sec < 10 ? 2 : 1)} s`;
  const m = Math.floor(sec / 60), r = Math.round(sec - m * 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

export const trim = (n, digits = 2) => String(Math.round(n * 10 ** digits) / 10 ** digits);

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${trim(n / 1024, 0)} kB`;
  return `${trim(n / 1024 / 1024, 1)} MB`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function debounce(fn, ms) {
  let timer = 0;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

let uid = 0;
export const nextId = (prefix = 'id') => `${prefix}-${++uid}`;

/** "slug@3" → { slug, version } without throwing. */
export function splitRef(ref) {
  const m = /^([a-z0-9][a-z0-9-]*)(?:@(\d+))?$/.exec(ref ?? '');
  return m ? { slug: m[1], version: m[2] ? Number(m[2]) : null } : { slug: String(ref), version: null };
}

/** The playground URL of an asset reference. */
export function assetHref(ref) {
  const { slug, version } = splitRef(ref);
  return version ? `/assets/${slug}?v=${version}` : `/assets/${slug}`;
}

/** Loading, empty and error blocks every screen uses. */
export const loading = (text = 'Loading') => h('div.state.loading', { role: 'status', 'data-testid': 'loading' }, h('span.spinner'), text);
export const empty = (title, text, ...actions) => h('div.state.empty', { 'data-testid': 'empty' }, h('h2', title), text ? h('p', text) : null, actions.length ? h('div.row', actions) : null);
export const errorBlock = (message, ...actions) => h('div.state.error', { role: 'alert', 'data-testid': 'screen-error' }, h('h2', 'Something went wrong'), h('p', message), actions.length ? h('div.row', actions) : null);

/** A message strip that can be shown, replaced and hidden. kind: error | ok | info */
export function notice(testid) {
  const el = h('div.notice', { hidden: true, 'data-testid': testid });
  return {
    el,
    show(text, kind = 'error') { el.className = `notice ${kind}`; el.setAttribute('role', kind === 'error' ? 'alert' : 'status'); el.textContent = text; el.hidden = false; },
    hide() { el.hidden = true; el.textContent = ''; },
  };
}
