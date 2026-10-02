// Library: every asset in the studio, searchable and filterable. The filters live in the URL
// query, so a link reproduces a view.

import { api, getStatus, qs } from '/ui/lib/api.js';
import { assetIcon, debounce, empty, errorBlock, fill, h, icon, loading, plural } from '/ui/lib/util.js';

const TYPES = [['', 'Any type'], ['function', 'Function'], ['image', 'Image'], ['sound', 'Sound'], ['font', 'Font']];
const KINDS = [['', 'Any kind'], ['visual', 'Visual'], ['value', 'Value'], ['audio', 'Audio']];

/** One asset as a card. Shared with the asset picker. */
export function assetCard(a) {
  const badge = a.type === 'function' ? a.kind : a.type;
  return h('a.card.asset-card', { href: `/assets/${a.slug}`, 'data-testid': 'asset-card', 'data-slug': a.slug },
    h('div.thumb', a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '', loading: 'lazy', width: 640, height: 360 }) : h('span.thumb-icon', icon(assetIcon(a), 40))),
    h('div.card-body',
      h('div.card-title', h('h3', a.title), h(`span.badge.${badge}`, badge)),
      h('div.ref', `${a.slug}@${a.version}`),
      h('p.desc', a.description ?? ''),
      a.tags?.length ? h('div.tags', a.tags.slice(0, 6).map((t) => h('span.tag', t))) : null,
      h('div.meta',
        a.originClip ? h('span', 'made for ', h('b', a.originClip)) : null,
        a.forkedFrom ? h('span', 'fork of ', h('b', a.forkedFrom)) : null,
        h('span', a.usedByClips ? `used by ${plural(a.usedByClips, 'clip')}` : 'not used yet'),
        a.author ? h('span', `by ${a.author}`) : null)));
}

export async function mount(view, ctx) {
  ctx.setTitle('Library');
  const q = ctx.query;
  const state = {
    q: q.get('q') ?? '', type: q.get('type') ?? '', kind: q.get('kind') ?? '', format: q.get('format') ?? '',
    tag: (q.get('tag') ?? '').split(',').filter(Boolean), origin: q.get('origin') ?? '', usedBy: q.get('usedBy') ?? '',
  };

  let status, clips;
  try {
    [status, { clips }] = await Promise.all([getStatus({ fresh: true }), api.get('/api/clips')]);
  } catch (e) {
    fill(view, errorBlock(e.message));
    return;
  }
  if (!ctx.alive()) return;

  const select = (testid, label, options, key) => {
    const el = h('select', { 'data-testid': testid, 'aria-label': label }, options.map(([value, text]) => h('option', { value }, text)));
    // a filter value from the URL that no longer exists (a deleted clip) still shows as itself
    if (state[key] && !options.some(([v]) => v === state[key])) el.append(h('option', { value: state[key] }, state[key]));
    el.value = state[key];
    el.addEventListener('change', () => { state[key] = el.value; update(); });
    return el;
  };
  const clipOptions = (any) => [['', any], ...clips.map((c) => [c.slug, c.title === c.slug ? c.slug : `${c.title} (${c.slug})`])];

  const search = h('input', { type: 'search', value: state.q, placeholder: 'Search titles, descriptions, tags', 'data-testid': 'search', 'aria-label': 'Search assets', autocomplete: 'off', spellcheck: false });
  const tagsEl = h('div.chips', { 'data-testid': 'tag-filters', role: 'group', 'aria-label': 'Tags' });
  const count = h('span.count', { 'data-testid': 'result-count', role: 'status' });
  const clear = h('button.btn.small', { type: 'button', 'data-testid': 'clear-filters', hidden: true }, 'Clear filters');
  const grid = h('div.grid.assets', { 'data-testid': 'asset-grid' });

  const typeSel = select('filter-type', 'Type', TYPES, 'type');
  const kindSel = select('filter-kind', 'Kind', KINDS, 'kind');
  const formatSel = select('filter-format', 'Format', [['', 'Any format'], ...Object.entries(status.formats).map(([k, f]) => [k, f.label])], 'format');
  const originSel = select('filter-origin', 'Made for clip', clipOptions('Made for any clip'), 'origin');
  const usedSel = select('filter-used-by', 'Used by clip', clipOptions('Used by any clip'), 'usedBy');

  function drawTags() {
    const top = status.tags.slice(0, 18).map((t) => t.tag);
    const all = [...new Set([...state.tag, ...top])];
    fill(tagsEl, all.map((tag) => {
      const on = state.tag.includes(tag);
      const n = status.tags.find((t) => t.tag === tag)?.n;
      return h(`button.chip${on ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(on), 'data-testid': 'tag-filter', 'data-tag': tag,
        onclick: () => { state.tag = on ? state.tag.filter((t) => t !== tag) : [...state.tag, tag]; drawTags(); update(); } }, tag, n ? h('span.n', String(n)) : null);
    }));
  }

  const filtered = () => !!(state.q || state.type || state.kind || state.format || state.tag.length || state.origin || state.usedBy);

  let seq = 0;
  async function load() {
    const mine = ++seq;
    grid.setAttribute('aria-busy', 'true');
    let res;
    try {
      res = await api.get(`/api/assets${qs({ query: state.q.trim(), type: state.type, kind: state.kind, format: state.format, tag: state.tag.join(','), origin: state.origin, usedBy: state.usedBy, limit: 200 })}`);
    } catch (e) {
      if (mine !== seq || !ctx.alive()) return;
      grid.removeAttribute('aria-busy');
      count.textContent = '';
      fill(grid, errorBlock(e.message));
      return;
    }
    if (mine !== seq || !ctx.alive()) return;
    grid.removeAttribute('aria-busy');
    count.textContent = filtered() ? `${plural(res.total, 'asset')} match` + (res.total === 1 ? 'es' : '') : plural(res.total, 'asset');
    clear.hidden = !filtered();
    if (!res.assets.length) {
      fill(grid, filtered()
        ? empty('Nothing matches', 'No asset fits this search and these filters.', h('button.btn', { type: 'button', onclick: reset }, 'Clear filters'))
        : empty('The library is empty', 'Assets appear here when they are created through the MCP server or saved from a playground.'));
      return;
    }
    fill(grid, res.assets.map(assetCard));
  }

  function update() {
    ctx.setQuery(qs({ q: state.q.trim(), type: state.type, kind: state.kind, tag: state.tag.join(','), format: state.format, origin: state.origin, usedBy: state.usedBy }));
    load();
  }

  function reset() {
    Object.assign(state, { q: '', type: '', kind: '', format: '', tag: [], origin: '', usedBy: '' });
    search.value = '';
    for (const el of [typeSel, kindSel, formatSel, originSel, usedSel]) el.value = '';
    drawTags();
    update();
  }

  const typed = debounce(() => { state.q = search.value; update(); }, 220);
  search.addEventListener('input', typed);
  ctx.onCleanup(() => typed.cancel());
  clear.addEventListener('click', reset);

  drawTags();
  grid.append(loading('Loading assets'));
  fill(view, 
    h('div.page-head',
      h('div', h('h1', 'Library'), h('p.sub', 'Every clip leaves reusable assets behind. Search them, open one to play with it.')),
      h('div.page-head-side', count, clear)),
    h('div.filters', { 'data-testid': 'filters' },
      h('label.searchbox', icon('search'), search),
      h('div.filter-row', typeSel, kindSel, formatSel, originSel, usedSel),
      status.tags.length || state.tag.length ? tagsEl : null),
    grid);
  await load();
}
