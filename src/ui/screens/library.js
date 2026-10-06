// Library: every asset in the studio, built for thousands. The server searches, ranks and counts
// facets; this screen keeps a virtualized grid (only the rows in view exist), fetches pages by
// offset as you scroll, and keeps every filter, the sort, the density and the open asset in the
// URL query, so a link reproduces a view. A detail panel opens beside the grid (a bottom sheet on
// a phone); a selection gets bulk actions; files dropped on the page are uploaded.

import { api, getStatus, qs } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { virtualGrid } from '/ui/lib/grid.js';
import { live } from '/ui/lib/live.js';
import { uploader } from '/ui/lib/upload.js';
import { assetIcon, debounce, empty, errorBlock, fill, fmtDate, fmtDuration, h, icon, loading, s } from '/ui/lib/util.js';

const PAGE = 60;
const OPEN_CLIP = 'fablecut.openClip';
const DENSITY_KEY = 'fablecut.libraryDensity';

const SORTS = [['relevance', 'Relevance'], ['newest', 'Newest'], ['used', 'Most used'], ['name', 'Name']];
const DENSITIES = [['comfortable', 'Comfortable'], ['compact', 'Compact'], ['list', 'List']];
// value filters: state key = URL key = API key (q is the API's `query`)
const VALUE_KEYS = ['type', 'kind', 'format', 'author', 'origin', 'usedBy', 'collection', 'derivation'];
const FLAG_KEYS = ['favorite', 'featured', 'needsDescription', 'recent'];
const FACETS = [
  { key: 'type', title: 'Type', testid: 'filter-type' },
  { key: 'kind', title: 'Kind', testid: 'filter-kind' },
  { key: 'tag', title: 'Tags', testid: 'tag-filters', top: 14 },
  { key: 'format', title: 'Format', testid: 'filter-format' },
  { key: 'author', title: 'Author', testid: 'filter-author' },
  { key: 'origin', title: 'Made for clip', testid: 'filter-origin' },
  { key: 'usedBy', title: 'Used by clip', testid: 'filter-used-by' },
];
const FLAGS = [['favorite', 'Favourites'], ['featured', 'Featured'], ['needsDescription', 'Needs description']];
const LABELS = { type: 'Type', kind: 'Kind', format: 'Format', author: 'Author', origin: 'Made for', usedBy: 'Used by', collection: 'Collection', derivation: 'Derived by', tag: 'Tag',
  favorite: 'Favourites', featured: 'Featured', needsDescription: 'Needs description', recent: 'Recently used' };

const svg = (paths, size = 18) => { const el = s('svg', { viewBox: '0 0 20 20', width: size, height: size, class: 'icon', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); el.innerHTML = paths; return el; };
const STAR = '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>';
const CHECK = '<path d="M5 10.5l3.2 3L15 6.5"/>';
const DENSITY_ICONS = {
  comfortable: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
  compact: '<path d="M3 3h3.5v3.5H3zM8.25 3h3.5v3.5h-3.5zM13.5 3H17v3.5h-3.5zM3 8.25h3.5v3.5H3zM8.25 8.25h3.5v3.5h-3.5zM13.5 8.25H17v3.5h-3.5zM3 13.5h3.5V17H3zM8.25 13.5h3.5V17h-3.5zM13.5 13.5H17V17h-3.5z"/>',
  list: '<rect x="3" y="4" width="4" height="3" rx=".6"/><rect x="3" y="12" width="4" height="3" rx=".6"/><path d="M9.5 5.5H17M9.5 13.5H17"/>',
};

const fmtN = (n) => Number(n ?? 0).toLocaleString('en-US');
const nAssets = (n) => `${fmtN(n)} ${n === 1 ? 'asset' : 'assets'}`;
const badgeOf = (a) => (a.type === 'function' ? a.kind ?? 'function' : a.type);
const isField = (el) => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable="true"]');
const swatchColor = (c) => (typeof c === 'string' ? c : c?.hex ?? c?.color ?? (Array.isArray(c?.c) ? `rgb(${c.c.map(Math.round).join(',')})` : null));

function readOpenClip() {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_CLIP) ?? 'null');
    return v && typeof v.slug === 'string' && /^[a-z0-9-]+$/.test(v.slug) ? v : null;
  } catch { return null; }
}

export async function mount(view, ctx) {
  ctx.setTitle('Library');
  view.classList.add('view-library');
  const q = ctx.query;
  let storedDensity = null;
  try { storedDensity = localStorage.getItem(DENSITY_KEY); } catch { /* storage blocked */ }
  const state = {
    q: q.get('q') ?? '',
    tag: (q.get('tag') ?? '').split(',').filter(Boolean),
    sort: SORTS.some(([v]) => v === q.get('sort')) ? q.get('sort') : 'relevance',
    density: [q.get('view'), storedDensity].find((d) => DENSITIES.some(([v]) => v === d)) ?? 'comfortable',
    open: q.get('open') || null,
  };
  for (const k of VALUE_KEYS) state[k] = q.get(k) ?? '';
  for (const k of FLAG_KEYS) state[k] = q.get(k) === '1';

  let status, clips = [], collections = [];
  try {
    [status, clips, collections] = await Promise.all([
      getStatus(),
      api.get('/api/clips').then((r) => r.clips).catch(() => []),
      api.get('/api/collections').then((r) => r.collections).catch(() => []),
    ]);
  } catch (e) {
    fill(view, errorBlock(e.message));
    return;
  }
  if (!ctx.alive()) return;
  const clipTitle = (slug) => clips.find((c) => c.slug === slug)?.title ?? slug;
  const valueLabel = (key, v) => {
    if (key === 'format') return status.formats?.[v]?.label ?? v;
    if (key === 'origin' || key === 'usedBy') return clipTitle(v);
    if (key === 'collection') return collections.find((c) => c.slug === v)?.name ?? v;
    return v;
  };

  const selection = new Set();   // slugs
  const favs = new Map();        // slug → favourite, as set here (the asset endpoint does not say)
  let anchor = null;             // index for shift-click ranges
  let facets = null;
  const expanded = new Set();    // facet sections showing every value

  // ── elements ─────────────────────────────────────────────────────────────────────────────
  const search = h('input', { type: 'search', value: state.q, placeholder: 'Search titles, descriptions, tags, source', 'data-testid': 'search', 'aria-label': 'Search assets', autocomplete: 'off', spellcheck: false });
  const count = h('span.count', { 'data-testid': 'result-count', role: 'status' });
  const sortSel = h('select.lib-sort', { 'data-testid': 'sort', 'aria-label': 'Sort' }, SORTS.map(([v, t]) => h('option', { value: v }, t)));
  sortSel.value = state.sort;
  const densityBtns = DENSITIES.map(([v, t]) => h('button.btn.seg.icon-seg', { type: 'button', 'data-testid': 'density', 'data-value': v, 'aria-label': t, title: t, 'aria-pressed': String(state.density === v),
    onclick: () => setDensity(v) }, svg(DENSITY_ICONS[v])));
  const facetsToggle = h('button.btn.facets-toggle', { type: 'button', 'data-testid': 'facets-toggle', 'aria-expanded': 'false', 'aria-controls': 'lib-facets', onclick: () => toggleSheet() }, 'Filters', h('span.n'));
  const clear = h('button.btn.small', { type: 'button', 'data-testid': 'clear-filters', hidden: true, onclick: reset }, 'Clear filters');
  const activeEl = h('div.lib-active', { hidden: true });
  const facetsBody = h('div.facets-body');
  const facetsEl = h('aside.lib-facets', { id: 'lib-facets', 'data-testid': 'filters', 'aria-label': 'Filters' },
    h('header.sheet-head', h('h2', 'Filters'), h('button.btn.primary.small', { type: 'button', 'data-testid': 'facets-done', onclick: () => toggleSheet(false) }, 'Show results')),
    facetsBody);
  const stateEl = h('div.lib-state');
  const toast = h('div.lib-toast', { role: 'status', 'data-testid': 'library-message', hidden: true });
  const detail = h('aside.lib-detail', { 'data-testid': 'detail-panel', 'aria-label': 'Asset details', hidden: true, tabindex: -1 });
  const backdrop = h('div.lib-backdrop', { hidden: true, onclick: () => { closeDetail(); toggleSheet(false); } });
  const bulkBar = h('div.bulk-bar', { 'data-testid': 'bulk-bar', role: 'region', 'aria-label': 'Selection', hidden: true });

  const grid = virtualGrid({
    testid: 'asset-grid', label: 'Assets',
    renderItem: card, renderPlaceholder: () => h('div.vcard.ph', { role: 'option', 'aria-selected': 'false', 'aria-label': 'Loading' }, h('div.vthumb'), h('div.vbody', h('i'), h('i'))),
    onRange: (f, l) => want(f, l),
    onKey: (e, i) => {
      const a = grid.item(i);
      if (!a) return false;
      if (e.key === 'Enter') { openDetail(a.slug); return true; }
      if (e.key === ' ') { if (e.shiftKey && anchor !== null) selectRange(anchor, i); else { toggle(a.slug); anchor = i; } return true; }
      return false;
    },
    layout(w) {
      const phone = w < 560;
      if (state.density === 'list') return { cols: 1, rowHeight: phone ? 76 : 64, gap: 6, className: 'is-list' };
      const gap = phone ? 10 : 14;
      const min = state.density === 'compact' ? (phone ? 150 : 172) : (phone ? 300 : 236);
      const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
      const colW = (w - gap * (cols - 1)) / cols;
      return { cols, rowHeight: Math.round(colW * 9 / 16) + (state.density === 'compact' ? 38 : 84), gap, className: state.density === 'compact' ? 'is-compact' : 'is-comfortable' };
    },
  });

  const results = h('section.lib-results', grid.el, stateEl, bulkBar);
  const body = h('div.lib-body', facetsEl, results, detail);
  const up = uploader({ target: view, onUploaded: () => refresh(), onOpen: (slug) => openDetail(slug) });

  // ── one card ─────────────────────────────────────────────────────────────────────────────
  function card(a, i) {
    const sel = selection.has(a.slug);
    const badge = badgeOf(a);
    const thumb = h(`div.vthumb${a.strip ? '.has-strip' : ''}`, { style: a.strip ? { '--strip': `url("/media/${a.strip}")` } : null },
      a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '', loading: 'lazy', decoding: 'async', draggable: false }) : h('span.thumb-icon', icon(assetIcon(a), 32)),
      a.strip ? h('span.vstrip', { 'aria-hidden': 'true' }) : null,
      h('button.vcheck', { type: 'button', tabindex: -1, 'aria-label': `Select ${a.title}`, 'data-testid': 'card-select', onclick: (e) => { e.stopPropagation(); toggle(a.slug); anchor = i; } }, svg(CHECK, 14)),
      h('button.vstar', { type: 'button', tabindex: -1, 'aria-label': a.favorite ? 'Remove from favourites' : 'Add to favourites', 'aria-pressed': String(!!a.favorite), 'data-testid': 'card-favorite',
        onclick: (e) => { e.stopPropagation(); setFlag(a.slug, 'favorite', !a.favorite); } }, svg(STAR, 16)),
      h('span.vflags',
        a.featured ? h('span.flag.featured', { 'data-testid': 'featured-mark' }, svg(STAR, 11), 'Featured') : null,
        a.needsDescription ? h('span.flag.needs', { 'data-testid': 'needs-description' }, 'Needs description') : null));
    const el = h('div.vcard', {
      role: 'option', 'data-testid': 'asset-card', 'data-slug': a.slug, 'aria-selected': String(sel), 'data-selected': sel ? 'true' : null,
      'aria-label': `${a.title}, ${badge}${a.favorite ? ', favourite' : ''}${a.needsDescription ? ', needs description' : ''}`,
      class: [state.open === a.slug ? 'open' : '', a.favorite ? 'fav' : ''].join(' ').trim() || null,
      onclick: (e) => onCardClick(e, a, i),
      ondblclick: () => ctx.navigate(`/assets/${a.slug}`),
    },
    thumb,
    h('div.vbody',
      h('div.vtitle', h('span.vname', a.title), h(`span.badge.${badge}`, badge)),
      h('div.vdesc', a.description ?? ''),
      h('div.vmeta',
        h('span', { 'data-testid': 'used-by-count' }, a.usedByClips ? `used by ${a.usedByClips}` : 'unused'),
        a.edited ? h('span.edited', { 'data-testid': 'edited-mark', title: 'Title, description or tags edited in the studio' }, 'edited') : null,
        a.derivation ? h('span', a.derivation) : null,
        h('span.ref', `v${a.version}`))));
    return el;
  }

  function onCardClick(e, a, i) {
    if (e.shiftKey && anchor !== null) { selectRange(anchor, i); e.preventDefault(); return; }
    anchor = i;
    if (e.metaKey || e.ctrlKey || selection.size) { toggle(a.slug); return; }
    openDetail(a.slug);
  }

  // ── selection ────────────────────────────────────────────────────────────────────────────
  function toggle(slug) {
    if (selection.has(slug)) selection.delete(slug); else selection.add(slug);
    syncSelection();
  }
  function selectRange(from, to) {
    const [a, b] = from < to ? [from, to] : [to, from];
    for (let i = a; i <= b; i++) { const it = grid.item(i); if (it) selection.add(it.slug); }
    syncSelection();
  }
  function selectAll() {
    for (const [, it] of grid.loaded()) selection.add(it.slug);
    syncSelection();
  }
  function clearSelection() { selection.clear(); syncSelection(); }
  function syncSelection() {
    for (const el of grid.list.querySelectorAll('[data-testid=asset-card]')) {
      const on = selection.has(el.dataset.slug);
      el.setAttribute('aria-selected', String(on));
      if (on) el.dataset.selected = 'true'; else delete el.dataset.selected;
      el.querySelector('.vcheck')?.setAttribute('aria-label', `${on ? 'Deselect' : 'Select'} ${el.querySelector('.vname')?.textContent ?? ''}`);
    }
    results.classList.toggle('selecting', selection.size > 0);
    drawBulk();
  }

  // ── paging ───────────────────────────────────────────────────────────────────────────────
  let gen = 0;
  const pages = new Map();   // page → generation it was fetched (or is being fetched) for
  let wanted = [0, 0];
  let inflight = 0;
  let firstDone = false;

  function apiParams() {
    const p = { query: state.q.trim(), tag: state.tag.join(','), sort: state.sort };
    for (const k of VALUE_KEYS) p[k] = state[k];
    for (const k of FLAG_KEYS) p[k] = state[k] ? '1' : '';
    return p;
  }

  function want(first, last) {
    wanted = [Math.floor(Math.max(0, first - 12) / PAGE), Math.floor((last + 12) / PAGE)];
    pump();
  }

  function pump() {
    if (!firstDone) return;
    for (let p = wanted[0]; p <= wanted[1] && inflight < 2; p++) {
      if (p * PAGE >= grid.total || pages.get(p) === gen) continue;
      fetchPage(p, false);
    }
  }

  async function fetchPage(p, withFacets) {
    const mine = gen;
    pages.set(p, mine);
    inflight++;
    let res, err;
    try {
      res = await api.get(`/api/assets${qs({ ...apiParams(), limit: PAGE, offset: p * PAGE, facets: withFacets ? 1 : '' })}`);
    } catch (e) { err = e; }
    inflight--;
    if (!ctx.alive() || mine !== gen) { if (mine !== gen && ctx.alive()) pump(); return; }
    if (err) {
      pages.delete(p);
      if (!firstDone) showState(errorBlock(err.message, h('button.btn', { type: 'button', onclick: reload }, 'Try again')));
      else say(err.message, 'error');
      return;
    }
    if (withFacets && res.facets) { facets = res.facets; drawFacets(); }
    if (res.total !== grid.total) grid.setTotal(res.total);
    grid.setItems(p * PAGE, res.assets);
    drawCount(res.total);
    if (!firstDone) {
      firstDone = true;
      grid.list.removeAttribute('aria-busy');
      if (!res.total) showState(filtered()
        ? empty('Nothing matches', 'No asset fits this search and these filters.', h('button.btn', { type: 'button', onclick: reset }, 'Clear filters'))
        : empty('The library is empty', 'Assets appear here when they are created through the MCP server, saved from a playground, or uploaded.', up.button.cloneNode(true)));
      else showState(null);
      if (state.open) markOpen();
    }
    pump();
  }

  function showState(node) {
    fill(stateEl, node);
    stateEl.hidden = !node;
    grid.el.classList.toggle('dim', !!node);
    // the empty block's upload button is a copy: give it the real one's behaviour
    const copy = stateEl.querySelector('[data-testid=upload-button]');
    if (copy) { copy.dataset.testid = 'empty-upload'; copy.addEventListener('click', () => up.input.click()); }
  }

  /** A new search: forget the results and start from the top. */
  function reload() {
    gen++;
    pages.clear();
    firstDone = false;
    grid.clear();
    grid.setTotal(0);
    grid.list.setAttribute('aria-busy', 'true');
    showState(loading('Loading assets'));
    fetchPage(0, true);
  }

  /** Something changed on the server: fetch the pages in view again, keeping scroll and selection. */
  const refresh = debounce(() => {
    if (!ctx.alive()) return;
    if (!firstDone) { reload(); return; }
    gen++;
    pages.clear();
    const [f] = grid.range();
    fetchPage(Math.max(0, Math.floor(Math.max(0, f) / PAGE)), true);
    if (state.open) loadDetail(state.open, { quiet: true });
  }, 350);

  // ── filters, sort, density, URL ──────────────────────────────────────────────────────────
  const filtered = () => !!(state.q.trim() || state.tag.length || VALUE_KEYS.some((k) => state[k]) || FLAG_KEYS.some((k) => state[k]));
  const activeCount = () => state.tag.length + VALUE_KEYS.filter((k) => state[k]).length + FLAG_KEYS.filter((k) => state[k]).length;

  function writeUrl() {
    const p = { q: state.q.trim(), tag: state.tag.join(',') };
    for (const k of VALUE_KEYS) p[k] = state[k];
    for (const k of FLAG_KEYS) p[k] = state[k] ? '1' : '';
    p.sort = state.sort === 'relevance' ? '' : state.sort;
    p.view = state.density === 'comfortable' ? '' : state.density;
    p.open = state.open ?? '';
    ctx.setQuery(qs(p));
  }

  function update() {
    writeUrl();
    drawActive();
    drawFacets();
    reload();
  }

  function setFilter(key, value) {
    if (key === 'tag') state.tag = state.tag.includes(value) ? state.tag.filter((t) => t !== value) : [...state.tag, value];
    else if (FLAG_KEYS.includes(key)) state[key] = !state[key];
    else state[key] = state[key] === value ? '' : value;
    update();
  }

  function reset() {
    state.q = '';
    search.value = '';
    state.tag = [];
    for (const k of VALUE_KEYS) state[k] = '';
    for (const k of FLAG_KEYS) state[k] = false;
    update();
  }

  function setDensity(v) {
    state.density = v;
    try { localStorage.setItem(DENSITY_KEY, v); } catch { /* storage blocked */ }
    for (const b of densityBtns) { const on = b.dataset.value === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    writeUrl();
    const keep = grid.active;
    grid.relayout();
    grid.reveal(keep);
  }
  for (const b of densityBtns) b.classList.toggle('on', b.dataset.value === state.density);

  sortSel.addEventListener('change', () => { state.sort = sortSel.value; update(); });
  const typed = debounce(() => { state.q = search.value; update(); }, 220);
  search.addEventListener('input', typed);
  search.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); grid.focusIndex(0); } });
  ctx.onCleanup(() => typed.cancel());

  function drawCount(total) {
    count.textContent = filtered() ? `${nAssets(total)} ${total === 1 ? 'matches' : 'match'}` : nAssets(total);
  }

  function drawActive() {
    const chips = [];
    if (state.q.trim()) chips.push(['q', `“${state.q.trim()}”`, () => { state.q = ''; search.value = ''; update(); }]);
    for (const k of VALUE_KEYS) if (state[k]) chips.push([k, `${LABELS[k]}: ${valueLabel(k, state[k])}`, () => setFilter(k, state[k])]);
    for (const t of state.tag) chips.push(['tag', `#${t}`, () => setFilter('tag', t)]);
    for (const k of FLAG_KEYS) if (state[k]) chips.push([k, LABELS[k], () => setFilter(k)]);
    fill(activeEl, chips.map(([key, text, off]) => h('button.chip.on', { type: 'button', 'data-testid': 'active-filter', 'data-key': key, 'aria-label': `Remove the filter ${text}`, onclick: off }, text, icon('close', 12))), clear);
    activeEl.hidden = !chips.length;
    clear.hidden = !chips.length;
    const n = activeCount();
    facetsToggle.querySelector('.n').textContent = n ? String(n) : '';
  }

  // ── the facets panel ─────────────────────────────────────────────────────────────────────
  function facetButton(key, value, label, n, testid = 'facet') {
    const on = key === 'tag' ? state.tag.includes(value) : FLAG_KEYS.includes(key) ? state[key] : state[key] === value;
    return h(`button.facet${on ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(on), 'data-testid': testid, 'data-facet': key, 'data-value': value,
      'data-tag': key === 'tag' ? value : null, 'data-slug': key === 'collection' ? value : null, onclick: () => setFilter(key, value) },
    h('span.facet-label', label), n === null ? null : h('span.facet-n', fmtN(n)));
  }

  function drawFacets() {
    const f = facets ?? {};
    const sections = [];
    // quick views: flags, recently used, collections
    sections.push(h('section.facet-group', { 'aria-label': 'Show' },
      h('div.facet-list',
        FLAGS.map(([k, label]) => facetButton(k, '1', label, f[k] ?? null)),
        facetButton('recent', '1', 'Recently used', null, 'recent-link'))));
    const colCounts = new Map((f.collection ?? []).map((c) => [c.value, c.count]));
    sections.push(h('section.facet-group', { 'data-testid': 'collections' },
      h('h3', 'Collections'),
      collections.length
        ? h('div.facet-list', collections.map((c) => facetButton('collection', c.slug, c.name, colCounts.get(c.slug) ?? 0, 'collection-link')))
        : h('p.hint', 'Select assets and add them to a collection to see it here.')));
    for (const def of FACETS) {
      const values = (f[def.key] ?? []).map((v) => ({ value: String(v.value), count: v.count }));
      const chosen = def.key === 'tag' ? state.tag : state[def.key] ? [state[def.key]] : [];
      for (const c of chosen) if (!values.some((v) => v.value === c)) values.unshift({ value: c, count: 0 });
      if (!values.length) continue;
      const top = def.top ?? 6;
      const all = expanded.has(def.key);
      const shown = all ? values : values.filter((v, k) => k < top || chosen.includes(v.value));
      sections.push(h('section.facet-group', { role: 'group', 'aria-label': def.title, 'data-testid': def.testid },
        h('h3', def.title),
        h(`div.facet-list${def.key === 'tag' ? '.tags' : ''}`, shown.map((v) => facetButton(def.key, v.value, valueLabel(def.key, v.value), v.count, def.key === 'tag' ? 'tag-filter' : 'facet'))),
        values.length > shown.length || all
          ? h('button.facet-more', { type: 'button', 'data-testid': 'facet-more', 'data-facet': def.key, 'aria-expanded': String(all),
            onclick: () => { if (all) expanded.delete(def.key); else expanded.add(def.key); drawFacets(); } }, all ? 'Show fewer' : `Show all ${values.length}`)
          : null));
    }
    // keep the keyboard focus on the same control across a redraw
    const focused = facetsBody.contains(document.activeElement) ? document.activeElement : null;
    const key = focused ? [focused.dataset.testid, focused.dataset.facet, focused.dataset.value] : null;
    fill(facetsBody, sections);
    if (key) facetsBody.querySelector(`[data-testid="${key[0]}"][data-facet="${key[1]}"]${key[2] ? `[data-value="${CSS.escape(key[2])}"]` : ''}`)?.focus();
  }

  function toggleSheet(on = !facetsEl.classList.contains('open')) {
    facetsEl.classList.toggle('open', on);
    facetsToggle.setAttribute('aria-expanded', String(on));
    syncBackdrop();
    if (on) facetsEl.querySelector('[data-testid=facets-done]')?.focus();
  }
  const syncBackdrop = () => { backdrop.hidden = !(facetsEl.classList.contains('open') || (!detail.hidden && window.matchMedia('(max-width: 760px)').matches)); };

  // ── the detail panel ─────────────────────────────────────────────────────────────────────
  let detailSeq = 0;
  let returnFocus = null;

  function markOpen() {
    for (const el of grid.list.querySelectorAll('[data-testid=asset-card]')) el.classList.toggle('open', el.dataset.slug === state.open);
  }

  function openDetail(slug) {
    if (!detail.contains(document.activeElement)) returnFocus = slug;
    state.open = slug;
    writeUrl();
    markOpen();
    detail.hidden = false;
    body.classList.add('has-detail');
    syncBackdrop();
    const known = grid.loaded().find(([, a]) => a.slug === slug)?.[1];
    if (known) drawDetail(known, null);
    else fill(detail, loading('Loading the asset'));
    loadDetail(slug);
    // the grid got narrower: keep the opened card in view
    const idx = grid.loaded().find(([, a]) => a.slug === slug)?.[0];
    requestAnimationFrame(() => { if (idx !== undefined) grid.reveal(idx); });
    detail.querySelector('[data-testid=detail-close]')?.focus({ preventScroll: true });
  }

  async function loadDetail(slug, { quiet = false } = {}) {
    const mine = ++detailSeq;
    let full;
    try {
      full = await api.get(`/api/assets/${slug}`);
    } catch (e) {
      if (mine !== detailSeq || !ctx.alive() || quiet) return;
      fill(detail, h('header.detail-head', h('h2', slug), closeBtn()), errorBlock(e.message));
      return;
    }
    if (mine !== detailSeq || !ctx.alive() || state.open !== slug) return;
    const fav = favs.get(slug) ?? grid.loaded().find(([, a]) => a.slug === slug)?.[1]?.favorite;
    const hadFocus = detail.contains(document.activeElement) ? document.activeElement.dataset.testid : null;
    drawDetail({ ...full, favorite: full.favorite ?? fav ?? false }, full);
    if (hadFocus) detail.querySelector(`[data-testid="${hadFocus}"]`)?.focus({ preventScroll: true });
  }

  function closeDetail() {
    if (detail.hidden) return;
    detailSeq++;
    const slug = state.open;
    state.open = null;
    writeUrl();
    detail.hidden = true;
    body.classList.remove('has-detail');
    syncBackdrop();
    markOpen();
    const idx = grid.loaded().find(([, a]) => a.slug === (returnFocus ?? slug))?.[0];
    if (idx !== undefined) requestAnimationFrame(() => grid.focusIndex(idx));
  }

  const closeBtn = () => h('button.icon-btn', { type: 'button', 'aria-label': 'Close the details', 'data-testid': 'detail-close', onclick: closeDetail }, icon('close'));

  function drawDetail(a, full) {
    const meta = full?.meta ?? {};
    const badge = badgeOf(a);
    const palette = (meta.palette ?? []).map(swatchColor).filter(Boolean);
    const removed = meta.sanitized?.removed ?? null;
    const size = meta.natural ?? (meta.width ? { width: meta.width, height: meta.height } : null);
    const clip = readOpenClip();
    const lineage = [
      a.derivation ? h('span', { class: 'badge' }, a.derivation) : null,
      a.forkedFrom ? h('span', 'from ', lineageLink(a.forkedFrom)) : null,
      full?.parentVersion && full.parentVersion !== a.forkedFrom ? h('span', 'after ', h('span.ref', full.parentVersion)) : null,
      full?.forks?.length ? h('span', `${full.forks.length} ${full.forks.length === 1 ? 'fork' : 'forks'}: `, full.forks.slice(0, 6).map((f, k) => [k ? ', ' : '', lineageLink(f)])) : null,
    ].filter(Boolean);

    fill(detail,
      h('header.detail-head', h('div.detail-title', h('h2', a.title), h('span.ref', a.ref)), closeBtn()),
      h(`div.detail-media${a.strip ? '.has-strip' : ''}`, { style: a.strip ? { '--strip': `url("/media/${a.strip}")` } : null },
        a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '' }) : h('span.thumb-icon', icon(assetIcon(a), 40)),
        a.strip ? h('span.vstrip', { 'aria-hidden': 'true' }) : null),
      h('div.detail-badges',
        h(`span.badge.${badge}`, badge),
        a.featured ? h('span.badge.warn', 'featured') : null,
        a.needsDescription ? h('span.badge.needs', 'needs description') : null,
        a.edited ? h('span.badge', 'edited') : null,
        h('span.muted', a.usedByClips ? `used by ${a.usedByClips} ${a.usedByClips === 1 ? 'clip' : 'clips'}` : 'not used yet')),
      h('div.detail-actions',
        h('a.btn.primary', { href: `/assets/${a.slug}`, 'data-testid': 'detail-open' }, 'Open in playground'),
        h(`button.btn.toggle${a.favorite ? '.on' : ''}`, { type: 'button', 'data-testid': 'favorite-toggle', 'aria-pressed': String(!!a.favorite), onclick: () => setFlag(a.slug, 'favorite', !a.favorite) },
          svg(STAR, 16), a.favorite ? 'Favourite' : 'Add to favourites'),
        h(`button.btn.toggle${a.featured ? '.on' : ''}`, { type: 'button', 'data-testid': 'feature-toggle', 'aria-pressed': String(!!a.featured), onclick: () => setFlag(a.slug, 'featured', !a.featured) },
          a.featured ? 'Featured' : 'Feature'),
        h('button.btn', { type: 'button', 'data-testid': 'detail-add-to-clip', disabled: !clip, title: clip ? null : 'Open a clip in the editor first', onclick: () => addToClip([a.slug]) },
          clip ? `Add to ${clipTitle(clip.slug)}` : 'No clip open'),
        collectionPicker('detail-collection', () => [a.slug])),
      a.description ? h('p.detail-desc', a.description) : null,
      a.tags?.length ? h('div.tags', a.tags.map((t) => h('button.tag.tag-btn', { type: 'button', 'data-testid': 'detail-tag', 'data-tag': t, title: `Filter by ${t}`, onclick: () => { if (!state.tag.includes(t)) setFilter('tag', t); } }, t))) : null,
      palette.length ? h('div.detail-section', h('h3', 'Palette'), h('div.palette', { 'data-testid': 'palette' }, palette.map((c) => h('span.pal', { style: { background: c }, title: c }, h('span', c))))) : null,
      a.suggestedUses?.length ? h('div.detail-section', h('h3', 'Suggested uses'), h('ul.bullets', a.suggestedUses.map((u) => h('li', u)))) : null,
      h('dl.facts.detail-facts',
        h('dt', 'Type'), h('dd', a.type === 'function' ? `function · ${a.kind}` : a.type),
        a.author ? [h('dt', 'Author'), h('dd', a.author)] : null,
        a.duration ? [h('dt', 'Duration'), h('dd', fmtDuration(a.duration))] : null,
        a.formats?.length ? [h('dt', 'Formats'), h('dd', a.formats.join(', '))] : null,
        size ? [h('dt', 'Size'), h('dd', `${size.width}×${size.height}`)] : null,
        a.params?.length ? [h('dt', 'Params'), h('dd.mono', a.params.join(', '))] : null,
        a.originClip ? [h('dt', 'Made for'), h('dd', h('a', { href: `/clips/${a.originClip}` }, clipTitle(a.originClip)))] : null,
        lineage.length ? [h('dt', 'Lineage'), h('dd.lineage', lineage)] : null,
        a.createdAt ? [h('dt', 'Created'), h('dd', fmtDate(a.createdAt))] : null),
      removed ? h('div.detail-section', h('h3', 'SVG'), removed.length
        ? h('p.notice', { 'data-testid': 'svg-notes' }, `Removed when sanitising: ${removed.join(', ')}.`)
        : h('p.hint', { 'data-testid': 'svg-notes' }, 'Nothing had to be removed when sanitising.')) : null,
      full ? h('div.detail-section', h('h3', 'Used by'), full.usedBy?.length
        ? h('ul.detail-list', { 'data-testid': 'detail-used-by' }, dedupe(full.usedBy).map((u) => h('li', h('a', { href: `/clips/${u.clip}` }, u.title || u.clip), h('span.ref', `v${u.version}${u.direct ? '' : ' · inside another asset'}`))))
        : h('p.hint', 'No clip uses it yet.')) : null,
      full?.versions?.length ? h('div.detail-section', h('h3', 'Versions'),
        h('ul.detail-list', { 'data-testid': 'detail-versions' }, [...full.versions].reverse().slice(0, 8).map((v) => h('li',
          h('a.mono', { href: `/assets/${a.slug}?v=${v.version}` }, `v${v.version}`),
          h('span.version-note', v.note || 'no note'),
          h('span.ref', [v.author, fmtDate(v.createdAt)].filter(Boolean).join(' · ')))))) : null,
      full ? null : h('div.detail-loading', loading('Loading details')));
  }

  const dedupe = (rows) => [...new Map(rows.map((u) => [`${u.clip}@${u.version}`, u])).values()];
  const lineageLink = (ref) => { const slug = String(ref).split('@')[0]; return h('button.linkish', { type: 'button', 'data-testid': 'lineage-link', 'data-slug': slug, onclick: () => openDetail(slug) }, ref); };

  // ── actions ──────────────────────────────────────────────────────────────────────────────
  let toastTimer = 0;
  function say(text, kind = 'ok', ...extra) {
    clearTimeout(toastTimer);
    toast.className = `lib-toast ${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    fill(toast, h('span', text), extra);
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, kind === 'error' ? 8000 : 4500);
  }
  ctx.onCleanup(() => clearTimeout(toastTimer));

  /** Change one summary in place (favourite, featured) so the card updates before the refresh. */
  function patch(slug, change) {
    for (const [i, a] of grid.loaded()) if (a.slug === slug) grid.setItems(i, [{ ...a, ...change }]);
  }

  async function setFlag(slug, flag, on) {
    try {
      await api.put(`/api/assets/${slug}/${flag}`, { on });
    } catch (e) { say(e.message, 'error'); return; }
    patch(slug, { [flag]: on });
    if (flag === 'favorite') favs.set(slug, on);
    if (state.open === slug) loadDetail(slug, { quiet: true });
    refresh();
  }

  async function addToClip(slugs) {
    const clip = readOpenClip();
    if (!clip || !slugs.length) return;
    try {
      const r = await api.post(`/api/clips/${clip.slug}/add-assets`, { slugs, ...(Number.isFinite(clip.at) ? { at: clip.at } : {}) });
      const n = Array.isArray(r.added) ? r.added.length : slugs.length;
      say(`Added ${n} ${n === 1 ? 'asset' : 'assets'} to ${clipTitle(r.clip ?? clip.slug)}`, 'ok', h('a', { href: `/clips/${r.clip ?? clip.slug}` }, 'Open the clip'));
    } catch (e) { say(e.message, 'error'); }
  }

  async function bulk(body, text) {
    const slugs = [...selection];
    if (!slugs.length) return;
    try {
      await api.post('/api/assets/bulk', { slugs, ...body });
    } catch (e) { say(e.message, 'error'); return false; }
    say(text);
    if (body.favorite !== undefined) for (const slug of slugs) patch(slug, { favorite: body.favorite });
    refresh();
    return true;
  }

  /** A select: existing collections and "New collection…"; getSlugs() says what to add. */
  function collectionPicker(testid, getSlugs) {
    const el = h('select.collection-pick', { 'data-testid': testid, 'aria-label': 'Add to a collection' },
      h('option', { value: '' }, 'Add to collection'),
      collections.map((c) => h('option', { value: c.name }, c.name)),
      h('option', { value: '\u0000new' }, 'New collection…'));
    el.addEventListener('change', async () => {
      let name = el.value;
      el.value = '';
      if (!name) return;
      if (name === '\u0000new') name = await askName();
      if (!name) return;
      const slugs = getSlugs();
      try {
        await api.post('/api/assets/bulk', { slugs, collection: name });
        collections = (await api.get('/api/collections')).collections;
      } catch (e) { say(e.message, 'error'); return; }
      say(`Added ${slugs.length} ${slugs.length === 1 ? 'asset' : 'assets'} to ${name}`);
      refresh();
    });
    return el;
  }

  function askName() {
    const input = h('input', { type: 'text', 'data-testid': 'collection-name', 'aria-label': 'Collection name', placeholder: 'For example: Launch titles', maxlength: 48 });
    const ok = h('button.btn.primary', { type: 'submit', 'data-testid': 'collection-create' }, 'Create');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) d.close(input.value.trim()); } },
      h('label.field', h('span', 'Name'), input), h('div.dialog-foot.inline', cancel, ok));
    const d = openDialog({ title: 'New collection', body: form, testid: 'collection-dialog' });
    cancel.addEventListener('click', () => d.close(null));
    input.focus();
    return d.closed;
  }

  // ── the bulk bar ─────────────────────────────────────────────────────────────────────────
  const tagInput = h('input', { type: 'text', 'data-testid': 'bulk-tag-input', 'aria-label': 'Tag', placeholder: 'tag-name', autocomplete: 'off', spellcheck: false });
  const tagOf = () => tagInput.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const bulkCount = h('b', { 'data-testid': 'bulk-count' });
  const bulkFav = h('button.btn.small', { type: 'button', 'data-testid': 'bulk-favorite' }, svg(STAR, 14), 'Favourite');
  const bulkClip = h('button.btn.small', { type: 'button', 'data-testid': 'bulk-add-to-clip' });
  async function tagAction(add) {
    const tag = tagOf();
    if (!tag) { tagInput.focus(); say('Type a tag first', 'error'); return; }
    if (await bulk(add ? { addTags: [tag] } : { removeTags: [tag] }, `${add ? 'Added' : 'Removed'} #${tag} ${add ? 'to' : 'from'} ${selection.size} ${selection.size === 1 ? 'asset' : 'assets'}`)) tagInput.value = '';
  }
  tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tagAction(true); } });
  bulkFav.addEventListener('click', () => {
    const on = !allFavourite();
    bulk({ favorite: on }, on ? `Added ${selection.size} to favourites` : `Removed ${selection.size} from favourites`);
  });
  bulkClip.addEventListener('click', () => addToClip([...selection]));
  const allFavourite = () => { const loaded = new Map(grid.loaded().map(([, a]) => [a.slug, a])); return [...selection].every((s) => loaded.get(s)?.favorite); };
  fill(bulkBar,
    h('div.bulk-count', bulkCount, h('button.btn.small', { type: 'button', 'data-testid': 'bulk-clear', onclick: clearSelection }, 'Clear')),
    h('div.bulk-tags', tagInput,
      h('button.btn.small', { type: 'button', 'data-testid': 'bulk-add-tag', onclick: () => tagAction(true) }, 'Add tag'),
      h('button.btn.small', { type: 'button', 'data-testid': 'bulk-remove-tag', onclick: () => tagAction(false) }, 'Remove tag')),
    h('div.bulk-more', h('span.bulk-coll'), bulkFav, bulkClip));
  function drawBulk() {
    bulkBar.hidden = !selection.size;
    if (!selection.size) return;
    bulkCount.textContent = `${fmtN(selection.size)} selected`;
    const fav = allFavourite();
    bulkFav.lastChild.textContent = fav ? 'Unfavourite' : 'Favourite';
    const clip = readOpenClip();
    bulkClip.disabled = !clip;
    bulkClip.textContent = clip ? `Add to ${clipTitle(clip.slug)}` : 'No clip open';
    bulkClip.title = clip ? '' : 'Open a clip in the editor first';
    fill(bulkBar.querySelector('.bulk-coll'), collectionPicker('bulk-collection', () => [...selection]));
  }

  // ── keyboard: Escape, select all ─────────────────────────────────────────────────────────
  const onKey = (e) => {
    if (!ctx.alive() || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (facetsEl.classList.contains('open')) { toggleSheet(false); facetsToggle.focus(); e.preventDefault(); return; }
      if (!detail.hidden) { closeDetail(); e.preventDefault(); return; }
      if (selection.size && !isField(e.target)) { clearSelection(); e.preventDefault(); }
      return;
    }
    if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey) && !e.altKey && !isField(e.target)) {
      e.preventDefault();
      selectAll();
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey));
  const onResize = () => syncBackdrop();
  window.addEventListener('resize', onResize);
  ctx.onCleanup(() => window.removeEventListener('resize', onResize));

  // ── live: an asset described over MCP, a bulk edit elsewhere, an upload ──────────────────
  const offAsset = live.on('asset', () => refresh());
  const offLibrary = live.on('library', async () => {
    try { collections = (await api.get('/api/collections')).collections; } catch { /* the next refresh tries again */ }
    refresh();
  });
  ctx.onCleanup(offAsset);
  ctx.onCleanup(offLibrary);
  ctx.onCleanup(() => { refresh.cancel(); grid.destroy(); up.destroy(); });

  // ── the page ─────────────────────────────────────────────────────────────────────────────
  fill(view,
    h('div.lib-head',
      h('div.lib-title', h('h1', 'Library'), count),
      h('div.lib-head-side', up.button, up.input)),
    h('div.lib-toolbar',
      h('label.searchbox', icon('search'), search),
      h('div.lib-tools', sortSel, h('div.seg-group', { role: 'group', 'aria-label': 'Density' }, densityBtns), facetsToggle)),
    activeEl,
    body,
    backdrop, toast, up.status, up.dropZone);
  drawActive();
  drawFacets();
  if (state.open) openDetail(state.open);
  reload();
}
