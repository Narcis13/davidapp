// Lineage: how the library compounds. Clips are columns in the order they were made, assets are
// rows grouped by the clip that first produced them, and each cell says how that clip came by
// that asset: created it, reused it as-is, made a new version, or forked it.

import { api } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { assetHref, debounce, empty, errorBlock, fill, h, plural, s } from '/ui/lib/util.js';

const HOW = {
  created: { label: 'Created for this clip', short: 'created' },
  'as-is': { label: 'Reused as-is', short: 'reused as-is' },
  'new-version': { label: 'New version made for this clip', short: 'new version' },
  fork: { label: 'Forked from an earlier asset', short: 'fork' },
  library: { label: 'From the library (no origin clip)', short: 'library' },
};

/** The marker of a relation: a distinct shape as well as a colour. */
function marker(how, size = 18) {
  const el = s('svg', { viewBox: '0 0 18 18', width: size, height: size, class: `mark mark-${how}`, 'aria-hidden': 'true' });
  if (how === 'created') el.append(s('circle', { cx: 9, cy: 9, r: 6.5 }));
  else if (how === 'as-is') el.append(s('circle', { cx: 9, cy: 9, r: 5.2, fill: 'none', 'stroke-width': 2.6 }));
  else if (how === 'new-version') el.append(s('path', { d: 'M9 1.5L16.500 9 9 16.500 1.500 9z' }));
  else if (how === 'fork') el.append(s('path', { d: 'M9 2.200L16.300 15H1.700z' }));
  else el.append(s('circle', { cx: 9, cy: 9, r: 3 }));
  return el;
}

function summaryCard(c) {
  const k = c.counts;
  const parts = [['created', k.created], ['as-is', k.asIs], ['new-version', k.newVersion], ['fork', k.fork]].filter(([, n]) => n > 0);
  return h('article.card.lineage-card', { 'data-testid': 'lineage-clip', 'data-slug': c.slug },
    h('div.card-body',
      h('div.card-title', h('span.order', String(c.order)), h('h3', h('a', { href: `/clips/${c.slug}` }, c.title)), h('span.badge', c.format)),
      h('p.lineage-sum', { 'data-testid': 'lineage-sum' }, h('b', `created ${k.created}`), ', ', h('b', `reused ${k.reused}`), ' from earlier clips'),
      h('div.stack', { role: 'img', 'aria-label': parts.map(([how, n]) => `${n} ${HOW[how].short}`).join(', ') || 'no assets' }, parts.map(([how, n]) => h(`i.seg-${how}`, { style: { flexGrow: String(n) }, title: `${n} ${HOW[how].short}` }))),
      h('div.meta',
        h('span', plural(k.total, 'asset')),
        k.asIs ? h('span', `${k.asIs} as-is`) : null,
        k.newVersion ? h('span', `${plural(k.newVersion, 'new version')}`) : null,
        k.fork ? h('span', plural(k.fork, 'fork')) : null,
        c.remixedFrom ? h('span', 'remix of ', h('b', c.remixedFrom)) : null)));
}

function matrix(clips, assets) {
  const col = new Map(clips.map((c, i) => [c.slug, i]));
  // a clip can hold two versions of one asset (one on the timeline, one nested): the cell shows the
  // relation that says most, and lists every version
  const RANK = { 'new-version': 4, fork: 3, created: 2, 'as-is': 1 };
  const cellOf = clips.map((c) => {
    const m = new Map();
    for (const a of c.assets) {
      const cur = m.get(a.slug);
      const ra = RANK[a.how] ?? 0, rc = RANK[cur?.how] ?? 0;
      const best = !cur || ra > rc || (ra === rc && a.direct && !cur.direct) ? a : cur;
      m.set(a.slug, { ...best, versions: [...(cur?.versions ?? []), a.version] });
    }
    return m;
  });
  const groups = new Map(clips.map((c) => [c.slug, []]));
  groups.set('', []);
  for (const a of assets) (groups.get(a.originClip ?? '') ?? groups.get('')).push(a);
  const rows = new Map();

  const setActive = (slug, on, cls) => {
    const a = assets.find((x) => x.slug === slug);
    const related = [slug, a?.forkedFrom ? a.forkedFrom.replace(/@\d+$/, '') : null, ...assets.filter((x) => x.forkedFrom?.replace(/@\d+$/, '') === slug).map((x) => x.slug)].filter(Boolean);
    for (const r of related) rows.get(r)?.classList.toggle(r === slug ? cls : `${cls}-rel`, on);
  };
  let pinned = null;

  const body = [];
  for (const [origin, list] of groups) {
    if (!list.length) continue;
    const c = clips[col.get(origin)];
    body.push(h('tr.group',
      h('th', { scope: 'rowgroup' }, c ? [h('span.order', String(c.order)), ' made for ', h('a', { href: `/clips/${c.slug}` }, c.slug)] : 'Library, no origin clip', h('span.count', plural(list.length, 'asset'))),
      clips.map(() => h('td'))));
    for (const a of list) {
      const used = clips.map((_, i) => cellOf[i].get(a.slug) ?? null);
      const idx = used.map((u, i) => (u ? i : -1)).filter((i) => i >= 0);
      const first = idx.length ? idx[0] : -1, last = idx.length ? idx[idx.length - 1] : -1;
      const root = a.forkedFrom && a.rootOriginClip && col.has(a.rootOriginClip) ? col.get(a.rootOriginClip) : -1;
      const tr = h('tr.asset-row', { 'data-testid': 'lineage-row', 'data-slug': a.slug },
        h('th', { scope: 'row' },
          h('a', { href: `/assets/${a.slug}`, title: a.description ?? '' }, a.title === a.slug ? a.slug : a.title),
          h('span.row-meta',
            h(`span.badge.${a.type === 'function' ? a.kind : a.type}`, a.type === 'function' ? a.kind : a.type),
            a.forkedFrom ? h('span.muted', `fork of ${a.forkedFrom}`) : null,
            a.reuseCount ? h('span.reuse', `reused ×${a.reuseCount}`) : null)),
        used.map((u, i) => {
          const classes = ['cell'];
          if (first >= 0 && i > first && i <= last) classes.push('line-l');
          if (first >= 0 && i >= first && i < last) classes.push('line-r');
          if (root >= 0 && first >= 0 && root < first) { if (i > root && i <= first) classes.push('derived-l'); if (i >= root && i < first) classes.push('derived-r'); }
          if (!u) return h(`td.${classes.join('.')}`);
          const from = u.how === 'fork' ? ` of ${u.forkedFrom}` : u.from && u.how !== 'created' ? ` from ${u.from}` : '';
          return h(`td.${classes.join('.')}`, { 'data-testid': 'lineage-cell', 'data-how': u.how, 'data-clip': clips[i].slug },
            h(`a.cell-mark${u.direct ? '' : '.nested'}`, { href: assetHref(u.ref), title: `${clips[i].slug}: ${u.ref}, ${HOW[u.how]?.short ?? u.how}${from}${u.direct ? '' : ' (nested inside another asset)'}`, 'aria-label': `${u.ref}, ${HOW[u.how]?.short ?? u.how}${from}` },
              marker(u.how), h('span.v', [...new Set(u.versions)].sort((x, y) => y - x).map((v) => `v${v}`).join(' + '))));
        }));
      tr.addEventListener('mouseenter', () => setActive(a.slug, true, 'hl'));
      tr.addEventListener('mouseleave', () => setActive(a.slug, false, 'hl'));
      tr.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('a')) return;
        if (pinned) setActive(pinned, false, 'pin');
        pinned = pinned === a.slug ? null : a.slug;
        if (pinned) setActive(pinned, true, 'pin');
      });
      rows.set(a.slug, tr);
      body.push(tr);
    }
  }

  return h('div.matrix-scroll', { 'data-testid': 'lineage-matrix', tabIndex: 0, role: 'region', 'aria-label': 'Asset reuse by clip' },
    h('table.matrix', { style: { '--cols': String(clips.length) } },
      h('thead', h('tr',
        h('th.corner', { scope: 'col' }, 'Asset', h('span.muted', 'clips in the order they were made →')),
        clips.map((c) => h('th.clip-col', { scope: 'col', 'data-testid': 'lineage-col', 'data-slug': c.slug },
          h('a', { href: `/clips/${c.slug}`, title: c.title }, h('span.order', String(c.order)), h('span.clip-name', c.title)),
          h('span.muted', c.format))))),
      h('tbody', body)));
}

export async function mount(view, ctx) {
  ctx.setTitle('Lineage');
  let data;
  try {
    data = await api.get('/api/lineage');
  } catch (e) {
    fill(view, errorBlock(e.message));
    return;
  }
  if (!ctx.alive()) return;
  draw(view, data);
  // live: new assets, versions and clip saves (from anywhere, the MCP server included) redraw the matrix
  const reload = debounce(async () => {
    let next;
    try { next = await api.get('/api/lineage'); } catch { return; }
    if (!ctx.alive()) return;
    const scroll = view.querySelector('[data-testid=lineage-matrix]')?.scrollLeft ?? 0;
    const reportOpen = view.querySelector('[data-testid=reuse-report]')?.open ?? false;
    draw(view, next);
    const m = view.querySelector('[data-testid=lineage-matrix]');
    if (m) m.scrollLeft = scroll;
    const r = view.querySelector('[data-testid=reuse-report]');
    if (r) r.open = reportOpen;
  }, 300);
  ctx.onCleanup(live.on('asset', () => reload()));
  ctx.onCleanup(live.on('clip', () => reload()));
  ctx.onCleanup(() => reload.cancel());
}

function draw(view, data) {
  const { clips, assets, report } = data;
  const head = h('div.page-head', h('div', h('h1', 'Lineage'), h('p.sub', 'Each clip leaves assets behind, and later clips are built from them.')));
  if (!clips.length) {
    fill(view, head, empty('No clips yet', assets.length
      ? `The library has ${plural(assets.length, 'asset')}, but no clip uses them yet. Lineage appears once clips share assets.`
      : 'Lineage appears once clips are made: which clip created an asset and which later clips reused it.'));
    return;
  }
  const top = [...assets].filter((a) => a.reuseCount > 0).sort((a, b) => b.reuseCount - a.reuseCount).slice(0, 8);
  const max = top[0]?.reuseCount ?? 1;
  const totalReused = clips.reduce((n, c) => n + c.counts.reused, 0);
  fill(view, 
    head,
    h('div.lineage-cards', { 'data-testid': 'lineage-clips' }, clips.map(summaryCard)),
    h('section.panel',
      h('div.panel-head', h('h2', 'Which clip uses which asset'), h('span.count', `${plural(assets.length, 'asset')} · ${totalReused} reuses`)),
      h('ul.legend', { 'data-testid': 'legend' }, Object.entries(HOW).filter(([how]) => how !== 'library' || clips.some((c) => c.assets.some((a) => a.how === 'library'))).map(([how, d]) => h('li', marker(how), d.label)),
        h('li', h('span.legend-line'), 'Carried from its origin to later clips')),
      matrix(clips, assets),
      h('p.hint', 'Hover or tap a row to follow one asset. A faded marker is used inside another asset, not placed on the timeline.')),
    h('div.lineage-bottom',
      h('section.panel', { 'data-testid': 'most-reused' },
        h('h2', 'Most reused'),
        top.length
          ? h('ol.reuse-list', top.map((a) => h('li',
            h('a.mono', { href: `/assets/${a.slug}` }, a.slug),
            h('span.reuse-bar', h('i', { style: { width: `${(a.reuseCount / max) * 100}%` } })),
            h('span.muted', plural(a.reuseCount, 'later clip')))))
          : h('p.muted', 'No asset has been reused by a later clip yet.')),
      h('details.panel.report', { 'data-testid': 'reuse-report' },
        h('summary', 'Reuse report as text'),
        h('pre', report))));
}
