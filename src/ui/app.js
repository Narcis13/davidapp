// The studio shell: History API routing, the nav (with the render-queue badge) and screen mounting.
// Every screen module exports `mount(view, ctx)`; resources register with ctx.onCleanup().

import { renderQueue } from '/ui/lib/api.js';
import { errorBlock, fill, h, loading } from '/ui/lib/util.js';
import { confirmDialog } from '/ui/lib/dialog.js';
import * as library from '/ui/screens/library.js';
import * as asset from '/ui/screens/asset.js';
import * as clips from '/ui/screens/clips.js';
import * as editor from '/ui/screens/editor.js';
import * as renders from '/ui/screens/renders.js';
import * as gallery from '/ui/screens/gallery.js';
import * as lineage from '/ui/screens/lineage.js';
import * as requests from '/ui/screens/requests.js';

const ROUTES = [
  { re: /^\/$/, screen: library, nav: 'library' },
  { re: /^\/assets\/([a-z0-9-]+)\/?$/, screen: asset, nav: 'library' },
  { re: /^\/clips\/?$/, screen: clips, nav: 'clips' },
  { re: /^\/clips\/([a-z0-9-]+)\/?$/, screen: editor, nav: 'clips' },
  { re: /^\/renders\/?$/, screen: renders, nav: 'renders' },
  { re: /^\/gallery(?:\/(\d+))?\/?$/, screen: gallery, nav: 'gallery' },
  { re: /^\/lineage\/?$/, screen: lineage, nav: 'lineage' },
  { re: /^\/requests(?:\/(\d+))?\/?$/, screen: requests, nav: 'requests' },
];
const NOT_APP = /^\/(api|media|fonts|core|ui|vendor)\//;

const main = document.getElementById('main');
let current = null;   // { cleanups, alive, guard }

function setNav(name) {
  for (const a of document.querySelectorAll('.nav a')) {
    const on = a.dataset.nav === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function render() {
  if (current) {
    current.alive = false;
    for (const fn of current.cleanups.splice(0)) { try { fn(); } catch { /* a screen's cleanup must not block navigation */ } }
  }
  const path = location.pathname;
  const route = ROUTES.find((r) => r.re.test(path));
  const view = h('div.view');
  fill(main, view);
  const state = { cleanups: [], alive: true, guard: null };
  current = state;
  if (!route) {
    setNav(null);
    document.title = 'Not found · Fablecut';
    view.append(errorBlock(`There is no screen at ${path}.`, h('a.btn', { href: '/' }, 'Open the library')));
    return;
  }
  setNav(route.nav);
  const ctx = {
    params: route.re.exec(path).slice(1),
    query: new URLSearchParams(location.search),
    navigate,
    alive: () => state.alive,
    onCleanup(fn) { if (state.alive) state.cleanups.push(fn); else fn(); },
    setTitle(title) { if (state.alive) document.title = title ? `${title} · Fablecut` : 'Fablecut'; },
    /** Replace the query string without remounting the screen. */
    setQuery(search) { history.replaceState(null, '', `${location.pathname}${search}`); },
    /** fn() returns a sentence when leaving would lose work, else null. */
    setGuard(fn) { state.guard = fn; },
  };
  view.append(loading());
  try {
    await route.screen.mount(view, ctx);
  } catch (e) {
    if (state.alive) fill(view, errorBlock(e?.message ?? String(e), h('a.btn', { href: '/' }, 'Open the library')));
  }
}

/** Go to another screen. force skips the unsaved-changes question. */
export async function navigate(url, { replace = false, force = false } = {}) {
  const warning = !force && current?.guard ? current.guard() : null;
  if (warning && !(await confirmDialog(warning, { ok: 'Leave', cancel: 'Stay' }))) return;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  window.scrollTo(0, 0);
  await render();
  main.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || NOT_APP.test(url.pathname)) return;
  e.preventDefault();
  if (url.href === location.href) return;
  navigate(url.pathname + url.search);
});

window.addEventListener('popstate', () => { render(); });
window.addEventListener('beforeunload', (e) => { if (current?.guard?.()) e.preventDefault(); });

// the badge: renders that are queued or running
const badge = document.querySelector('[data-testid="render-badge"]');
renderQueue.subscribe((list) => {
  const n = list.filter(renderQueue.isActive).length;
  badge.textContent = String(n);
  badge.hidden = n === 0;
  badge.setAttribute('aria-label', `${n} in the queue`);
});

render();
