// Asset picker: a dialog with a search box that resolves to the chosen function asset (or null).
// It asks the server's ranked search (the same one as the library), one kind at a time, so a
// library of thousands stays quick; with several kinds allowed, a kind filter narrows to one.

import { api, qs } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { assetIcon, debounce, fill, fmtDuration, h, icon, loading, plural } from '/ui/lib/util.js';

const LIMIT = 40;   // per kind; the search box finds the rest

/** @param {{ title?: string, kinds?: string[] }} [o] kinds: which function kinds may be picked */
export function pickAsset({ title = 'Add an asset', kinds = ['visual', 'audio'] } = {}) {
  const search = h('input', { type: 'search', placeholder: 'Search assets', 'data-testid': 'picker-search', 'aria-label': 'Search assets', autocomplete: 'off', spellcheck: false });
  const list = h('div.picker-list', { 'data-testid': 'picker-list' }, loading('Loading assets'));
  let only = '';   // one kind out of `kinds`, or '' for all of them
  const kindChips = kinds.length > 1 ? h('div.chips', { role: 'group', 'aria-label': 'Kind' }) : null;
  function drawKinds() {
    if (!kindChips) return;
    fill(kindChips, ['', ...kinds].map((k) => h(`button.chip${only === k ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(only === k), 'data-testid': 'picker-kind', 'data-kind': k || 'all',
      onclick: () => { only = k; drawKinds(); load(); } }, k ? `${k[0].toUpperCase()}${k.slice(1)}` : 'All')));
  }
  drawKinds();
  const d = openDialog({ title, body: h('div.picker', h('label.searchbox', icon('search'), search), kindChips, list), testid: 'asset-picker', wide: true });

  const option = (a) => h('button.picker-option', { type: 'button', 'data-testid': 'picker-option', 'data-slug': a.slug, onclick: () => d.close(a) },
    h('span.picker-thumb', a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '', loading: 'lazy' }) : icon(assetIcon(a), 24)),
    h('span.picker-text',
      h('span.picker-title', a.title, h(`span.badge.${a.kind}`, a.kind)),
      h('span.ref', `${a.ref} · ${fmtDuration(a.duration)}`),
      h('span.desc', a.description ?? '')));

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const query = search.value.trim();
    const wanted = only ? [only] : kinds;
    let results;
    try {
      results = await Promise.all(wanted.map((kind) => api.get(`/api/assets${qs({ type: 'function', kind, query, sort: 'relevance', limit: LIMIT })}`)));
    } catch (e) {
      if (mine === seq) fill(list, h('p.notice.error', e.message));
      return;
    }
    if (mine !== seq) return;
    const groups = results.map((r, k) => ({ kind: wanted[k], total: r.total, assets: r.assets }));
    if (!groups.some((g) => g.assets.length)) { fill(list, h('p.muted', query ? 'No asset matches this search.' : 'The library has no assets of this kind yet.')); return; }
    const many = groups.length > 1;
    fill(list, groups.filter((g) => g.assets.length).map((g) => [
      many ? h('h3.picker-group', `${g.kind[0].toUpperCase()}${g.kind.slice(1)}`, h('span.count', plural(g.total, 'asset'))) : null,
      g.assets.map(option),
      g.total > g.assets.length ? h('p.hint', `Showing the best ${g.assets.length} of ${g.total}. Search to narrow them down.`) : null,
    ]));
  }
  const typed = debounce(load, 200);
  search.addEventListener('input', typed);
  load();
  search.focus();
  return d.closed.then((a) => { typed.cancel(); seq++; return a ?? null; });
}
