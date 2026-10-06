// Version diff for the playground: two versions picked from the history, their source line diff
// (side by side, unified on a phone) and the same frame of both, drawn with the same t and params.
// framePair() is also used by the playground to compare an agent's proposal with the current version.
//
//   const pair = framePair({ testid, labels: ['v1', 'v2'], cellTestids: [...] });
//   await pair.show([{ ref, bundle, params }, { ref, bundle, params }], { duration, width, height, t });
//   pair.seek(t)  pair.setParams([pA, pB])  pair.setLabels([...])  pair.destroy()
//
//   const diff = createDiffView({ asset, getView: () => ({ params, duration, width, height, t }) });
//   diff.el  diff.open()  diff.seek(t)  diff.refresh()  diff.destroy()

import { api, qs } from '/ui/lib/api.js';
import { referencedAssets } from '/ui/lib/params.js';
import { Preview } from '/ui/preview.js';
import { fill, h, nextId, plural } from '/ui/lib/util.js';

const FPS = 30;

/** Keep only the parameter values a schema still declares. */
export const paramsFor = (schema, values) => Object.fromEntries(Object.entries(values ?? {}).filter(([k]) => schema && k in schema));

/**
 * Two previews side by side, drawn at the same time with their own refs and bundles.
 * @param {{ testid?: string, labels: string[], cellTestids?: string[] }} o
 */
export function framePair({ testid, labels, cellTestids = [] }) {
  const cells = labels.map((label, i) => {
    const canvas = h('canvas', { width: 16, height: 9, 'aria-label': label, 'data-testid': cellTestids[i] ? `${cellTestids[i]}-canvas` : undefined });
    const caption = h('span.pair-caption', label);
    const err = h('span.pair-error', { hidden: true, role: 'alert' });
    const frame = h('div.pair-frame.busy', canvas);
    const pv = new Preview(canvas, { onError: (m) => { err.hidden = !m; err.textContent = m ?? ''; } });
    const el = h('figure.pair-cell', { 'data-testid': cellTestids[i] }, frame, h('figcaption', caption, err));
    return { el, pv, frame, caption };
  });
  const el = h('div.frame-pair', { 'data-testid': testid }, cells.map((c) => c.el));
  return {
    el,
    previews: cells.map((c) => c.pv),
    setLabels(next) { next.forEach((l, i) => { cells[i].caption.textContent = l; cells[i].el.querySelector('canvas').setAttribute('aria-label', l); }); },
    /** sides: [{ ref, bundle, params }] in label order. */
    async show(sides, { duration, width, height, t = 0 }) {
      el.style.setProperty('--ar', String(width / height));
      el.classList.toggle('portrait', height > width);
      await Promise.all(cells.map(async (c, i) => {
        c.frame.classList.add('busy');
        c.pv.time = t;
        try { await c.pv.showAsset({ ...sides[i], duration, width, height, fps: FPS }); } finally { c.frame.classList.remove('busy'); }
      }));
    },
    seek(t) { for (const c of cells) if (c.pv.view) c.pv.seek(t); },
    setParams(list) { cells.forEach((c, i) => { if (c.pv.view) c.pv.setParams(list[i]); }); },
    setView(patch) { for (const c of cells) if (c.pv.view) c.pv.setView(patch); },
    destroy() { for (const c of cells) c.pv.destroy(); },
  };
}

/** Pair the del and add lines of each changed run so a side-by-side row shows old next to new. */
function sideBySide(lines) {
  const rows = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].op === 'same') { rows.push({ op: 'same', left: lines[i], right: lines[i] }); i += 1; continue; }
    const dels = [], adds = [];
    while (i < lines.length && lines[i].op !== 'same') { (lines[i].op === 'del' ? dels : adds).push(lines[i]); i += 1; }
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) rows.push({ op: 'change', left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}

/** Hide long unchanged runs, keeping `context` lines around each change. Returns [{ hidden: n, rows }] | row. */
function collapse(rows, context = 3) {
  const keep = rows.map(() => false);
  rows.forEach((r, i) => { if (r.op !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k += 1) keep[k] = true; });
  const out = [];
  for (let i = 0; i < rows.length;) {
    if (keep[i]) { out.push(rows[i]); i += 1; continue; }
    const start = i;
    while (i < rows.length && !keep[i]) i += 1;
    if (i - start < 4) out.push(...rows.slice(start, i));
    else out.push({ fold: rows.slice(start, i) });
  }
  return out;
}

const num = (n) => h('span.dl-n', n ?? '');
const text = (line, cls) => h(`span.dl-t${cls}`, line ? line.text || ' ' : '');

function sideRow(r) {
  const l = r.left, rt = r.right;
  const lc = r.op === 'same' ? '' : l ? '.del' : '.empty';
  const rc = r.op === 'same' ? '' : rt ? '.add' : '.empty';
  return h('div.dl-row', num(l?.a), text(l, lc), num(rt?.b), text(rt, rc));
}
function unifiedRow(line) {
  const cls = line.op === 'add' ? '.add' : line.op === 'del' ? '.del' : '';
  const sign = line.op === 'add' ? '+' : line.op === 'del' ? '−' : ' ';
  return h(`div.du-row${cls}`, num(line.a), num(line.b), h('span.du-sign', { 'aria-hidden': 'true' }, sign), h('span.dl-t', line.text || ' '));
}

/** The diff body: side by side (wide) and unified (phone); CSS shows one. */
function renderDiff(lines) {
  const fold = (rows, draw, label) => {
    const holder = h('div.dl-fold');
    const btn = h('button.btn.small.dl-expand', { type: 'button', 'data-testid': 'diff-expand' }, `Show ${plural(label, 'unchanged line')}`);
    btn.addEventListener('click', () => fill(holder, rows.map(draw)));
    holder.append(btn);
    return holder;
  };
  const side = collapse(sideBySide(lines)).map((r) => (r.fold ? fold(r.fold, sideRow, r.fold.length) : sideRow(r)));
  const uni = collapse(lines.map((l) => ({ ...l, left: l, right: l }))).map((r) => (r.fold ? fold(r.fold, unifiedRow, r.fold.length) : unifiedRow(r)));
  return [h('div.diff-side', { role: 'table', 'aria-label': 'Side by side diff' }, side), h('div.diff-unified', { 'aria-label': 'Unified diff' }, uni)];
}

/**
 * @param {{ asset: any, getView: () => { params: object, duration: number, width: number, height: number, t: number } }} o
 */
export function createDiffView({ asset, getView }) {
  const versions = asset.versions.map((v) => v.version);
  // default: the version on screen against the one before it (latest-1 vs latest when on the latest)
  let b = asset.version;
  let a = versions.filter((v) => v < b).pop() ?? b;
  const ida = nextId('diff'), idb = nextId('diff');
  const select = (id, testid, value) => h('select.mono', { id, 'data-testid': testid }, versions.map((v) => h('option', { value: String(v), selected: v === value }, `v${v}`)));
  const selA = select(ida, 'diff-a', a), selB = select(idb, 'diff-b', b);
  const stats = h('span.diff-stats', { 'data-testid': 'diff-stats' });
  const notes = h('div.diff-notes');
  const body = h('div.diff-body', { 'data-testid': 'diff-view', tabIndex: 0, 'aria-label': 'Source diff' });
  const pair = framePair({ testid: 'diff-frames', labels: [`v${a}`, `v${b}`], cellTestids: ['diff-frame-a', 'diff-frame-b'] });
  const msg = h('p.notice.error', { hidden: true, role: 'alert' });
  const el = h('div.diff-panel', { hidden: true },
    h('div.diff-pick',
      h('label.inline-field', { for: ida }, 'From', selA),
      h('label.inline-field', { for: idb }, 'To', selB),
      stats),
    msg, notes, pair.el, body);
  let schemas = [null, null], loaded = false, seq = 0;

  async function bundleOf(v, schema, params) {
    const refs = referencedAssets(schema, params);
    return (await api.get(`/api/assets/${asset.slug}/bundle${qs({ version: v, with: refs.join(',') })}`)).bundle;
  }

  async function load() {
    const my = ++seq;
    msg.hidden = true;
    body.setAttribute('aria-busy', 'true');
    try {
      const d = await api.get(`/api/assets/${asset.slug}/diff${qs({ a, b })}`);
      if (my !== seq) return;
      schemas = [d.a.schema, d.b.schema];
      stats.textContent = a === b ? 'Same version' : `+${d.added} −${d.removed}`;
      stats.classList.toggle('none', !d.added && !d.removed);
      fill(notes,
        h('span', { 'data-testid': 'diff-note-a' }, h('b', `v${a}`), ` ${d.a.note ?? (a === 1 ? 'First version' : 'No note')}`),
        h('span', { 'data-testid': 'diff-note-b' }, h('b', `v${b}`), ` ${d.b.note ?? (b === 1 ? 'First version' : 'No note')}`));
      fill(body, d.lines.length ? renderDiff(d.lines) : h('p.muted', 'No source to compare.'));
      pair.setLabels([`From v${a}`, `To v${b}`]);
      const v = getView();
      const params = [paramsFor(schemas[0], v.params), paramsFor(schemas[1], v.params)];
      const [ba, bb] = await Promise.all([bundleOf(a, schemas[0], params[0]), bundleOf(b, schemas[1], params[1])]);
      if (my !== seq) return;
      await pair.show([{ ref: d.a.ref, bundle: ba, params: params[0] }, { ref: d.b.ref, bundle: bb, params: params[1] }], v);
      loaded = true;
    } catch (e) {
      if (my !== seq) return;
      msg.textContent = e.message;
      msg.hidden = false;
    } finally {
      body.removeAttribute('aria-busy');
    }
  }
  selA.addEventListener('change', () => { a = Number(selA.value); load(); });
  selB.addEventListener('change', () => { b = Number(selB.value); load(); });

  return {
    el,
    get open() { return !el.hidden; },
    toggle(on = el.hidden) {
      el.hidden = !on;
      if (on && !loaded) load();
      return on;
    },
    seek(t) { if (!el.hidden && loaded) pair.seek(t); },
    /** The playground's params, size or duration changed. */
    refresh({ structural = false } = {}) {
      if (el.hidden || !loaded) return;
      if (structural) { load(); return; }
      const v = getView();
      pair.setView({ width: v.width, height: v.height, duration: v.duration });
      pair.el.style.setProperty('--ar', String(v.width / v.height));
      pair.el.classList.toggle('portrait', v.height > v.width);
      pair.setParams([paramsFor(schemas[0], v.params), paramsFor(schemas[1], v.params)]);
    },
    destroy() { seq += 1; pair.destroy(); },
  };
}
