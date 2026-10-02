// Asset picker: a dialog with a search box that resolves to the chosen function asset (or null).

import { api, qs } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { assetIcon, debounce, fill, fmtDuration, h, icon, loading } from '/ui/lib/util.js';

/** @param {{ title?: string, kinds?: string[] }} [o] kinds: which function kinds may be picked */
export function pickAsset({ title = 'Add an asset', kinds = ['visual', 'audio'] } = {}) {
  const search = h('input', { type: 'search', placeholder: 'Search assets', 'data-testid': 'picker-search', 'aria-label': 'Search assets', autocomplete: 'off', spellcheck: false });
  const list = h('div.picker-list', { 'data-testid': 'picker-list' }, loading('Loading assets'));
  const d = openDialog({ title, body: h('div.picker', h('label.searchbox', icon('search'), search), list), testid: 'asset-picker', wide: true });
  let seq = 0;
  async function load() {
    const mine = ++seq;
    let res;
    try {
      res = await api.get(`/api/assets${qs({ type: 'function', kind: kinds.length === 1 ? kinds[0] : '', query: search.value.trim(), limit: 100 })}`);
    } catch (e) {
      if (mine === seq) fill(list, h('p.notice.error', e.message));
      return;
    }
    if (mine !== seq) return;
    const assets = res.assets.filter((a) => kinds.includes(a.kind));
    if (!assets.length) { fill(list, h('p.muted', search.value.trim() ? 'No asset matches this search.' : 'The library has no assets of this kind yet.')); return; }
    fill(list, assets.map((a) => h('button.picker-option', { type: 'button', 'data-testid': 'picker-option', 'data-slug': a.slug, onclick: () => d.close(a) },
      h('span.picker-thumb', a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '', loading: 'lazy' }) : icon(assetIcon(a), 24)),
      h('span.picker-text',
        h('span.picker-title', a.title, h(`span.badge.${a.kind}`, a.kind)),
        h('span.ref', `${a.ref} · ${fmtDuration(a.duration)}`),
        h('span.desc', a.description ?? '')))));
  }
  const typed = debounce(load, 200);
  search.addEventListener('input', typed);
  load();
  search.focus();
  return d.closed.then((a) => { typed.cancel(); seq++; return a ?? null; });
}
