// A virtualized grid (or list) for thousands of items with a bounded DOM: only the rows in view,
// plus a little overscan, exist as elements. Rows have a fixed height per layout, so the scroll
// height is rows × stride and any index can be scrolled to without measuring. Items arrive sparse
// (pages fetched by offset): a missing item draws as a placeholder and onRange() asks for it.
//
//   const g = virtualGrid({ renderItem, renderPlaceholder, onRange, onActivate, layout });
//   g.setTotal(5021); g.setItems(60, page); g.refresh();
//
// Keyboard (on the cards, roving tabindex): arrows move across rows and columns, Home/End,
// PageUp/PageDown; onKey() gets the rest (Enter, Space, …) with the focused index.

import { h } from '/ui/lib/util.js';

const OVERSCAN = 2;   // rows above and below the viewport
const PAD = 4;        // room for the focus ring inside the scroll box (matches .vgrid-list in library.css)

/**
 * @param {{ testid?: string, label?: string, renderItem: (item: any, i: number) => HTMLElement, renderPlaceholder: (i: number) => HTMLElement,
 *   onRange?: (first: number, last: number) => void, onKey?: (e: KeyboardEvent, i: number) => boolean | void,
 *   layout: (width: number) => { cols: number, rowHeight: number, gap: number, className?: string } }} o
 */
export function virtualGrid({ testid = 'virtual-grid', label = 'Items', renderItem, renderPlaceholder, onRange, onKey, layout }) {
  const sizer = h('div.vgrid-sizer');
  const win = h('div.vgrid-window', { role: 'presentation' });
  const list = h('div.vgrid-list', { role: 'listbox', 'aria-label': label, 'aria-multiselectable': 'true', 'data-testid': testid }, win);
  const scroller = h('div.vgrid-scroll', sizer, list);

  let items = [];          // sparse: index → item
  let total = 0;
  let cols = 1, rowHeight = 100, gap = 0, className = '';
  let width = 0;
  let first = -1, last = -1;   // the indices drawn now
  let active = 0;          // the roving focus index
  let mounted = new Map(); // index → { item, el }
  let raf = 0;
  let lastRange = '';

  const stride = () => rowHeight + gap;
  const rows = () => Math.ceil(total / cols);

  function measure() {
    const w = list.clientWidth;
    if (!w) return false;
    width = w;
    const l = layout(w);
    cols = Math.max(1, l.cols);
    rowHeight = l.rowHeight;
    gap = l.gap;
    if (l.className !== className) { list.className = `vgrid-list ${l.className ?? ''}`.trim(); className = l.className; }
    list.style.setProperty('--cols', String(cols));
    list.style.setProperty('--row-h', `${rowHeight}px`);
    list.style.setProperty('--gap', `${gap}px`);
    sizer.style.height = `${Math.max(0, rows() * stride() - gap) + PAD * 2}px`;
    return true;
  }

  /** Draw the rows in view; keep elements whose item did not change (hover and focus survive). */
  function draw(force = false) {
    raf = 0;
    if (!width && !measure()) return;
    const top = scroller.scrollTop, height = scroller.clientHeight || 600;
    const r0 = Math.max(0, Math.floor((top - PAD) / stride()) - OVERSCAN);
    const r1 = Math.min(rows() - 1, Math.floor((top - PAD + height) / stride()) + OVERSCAN);
    const f = r0 * cols, l = Math.min(total - 1, (r1 + 1) * cols - 1);
    if (!force && f === first && l === last) return;
    first = f; last = l;
    const hadFocus = list.contains(document.activeElement) ? Number(document.activeElement.closest('[data-index]')?.dataset.index) : null;
    const next = new Map();
    const els = [];
    for (let i = f; i <= l; i++) {
      const item = items[i];
      const old = mounted.get(i);
      let el;
      if (old && old.item === item && !force) el = old.el;
      else {
        el = item === undefined ? renderPlaceholder(i) : renderItem(item, i);
        el.dataset.index = String(i);
        el.setAttribute('aria-posinset', String(i + 1));
        el.setAttribute('aria-setsize', String(total));
      }
      next.set(i, { item, el });
      els.push(el);
    }
    mounted = next;
    win.style.transform = `translateY(${r0 * stride()}px)`;
    // replaceChildren would drop focus; only touch the DOM when the order changed
    const same = els.length === win.children.length && els.every((el, k) => win.children[k] === el);
    if (!same) win.replaceChildren(...els);
    roving();
    if (hadFocus !== null && mounted.has(hadFocus) && document.activeElement !== mounted.get(hadFocus).el) mounted.get(hadFocus).el.focus({ preventScroll: true });
    const range = `${f}:${l}`;
    if (range !== lastRange && total) { lastRange = range; onRange?.(f, l); }
  }

  function roving() {
    const target = mounted.has(active) ? active : first;
    for (const [i, { el }] of mounted) el.tabIndex = i === target ? 0 : -1;
  }

  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => draw()); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(() => { const w = list.clientWidth; if (w && w !== width) { measure(); draw(true); } else schedule(); });
  ro.observe(scroller);

  /** Scroll so that index i is in view (nearest edge). */
  function reveal(i) {
    const y = Math.floor(i / cols) * stride() + PAD;
    if (y - PAD < scroller.scrollTop) scroller.scrollTop = y - PAD;
    else if (y + rowHeight + PAD > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y + rowHeight + PAD - scroller.clientHeight;
  }

  function focusIndex(i) {
    if (!total) return;
    active = Math.max(0, Math.min(total - 1, i));
    reveal(active);
    draw();
    roving();
    mounted.get(active)?.el.focus({ preventScroll: true });
  }

  list.addEventListener('focusin', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-index]') : null;
    if (el) { active = Number(el.dataset.index); roving(); }
  });

  list.addEventListener('keydown', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-index]') : null;
    if (!el || e.target !== el) return;
    const i = Number(el.dataset.index);
    const page = Math.max(1, Math.floor(scroller.clientHeight / stride())) * cols;
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, PageDown: page, PageUp: -page };
    if (e.key in moves && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const to = i + moves[e.key];
      if (to >= 0 && to < total) focusIndex(to);
      e.preventDefault();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') { focusIndex(e.key === 'Home' ? 0 : total - 1); e.preventDefault(); return; }
    if (onKey?.(e, i)) e.preventDefault();
  });

  return {
    el: scroller,
    list,
    /** The number of results; resets nothing else (items stay until replaced). */
    setTotal(n) {
      total = n;
      if (active >= total) active = Math.max(0, total - 1);
      items.length = Math.min(items.length, total);
      if (width) measure();
      draw(true);
    },
    setItems(offset, page) {
      for (let k = 0; k < page.length; k++) items[offset + k] = page[k];
      draw(true);
    },
    /** Forget every item (a new search) and go back to the top. */
    clear() {
      items = [];
      active = 0;
      lastRange = '';
      scroller.scrollTop = 0;
    },
    item: (i) => items[i],
    loaded: () => items.map((it, i) => [i, it]).filter(([, it]) => it !== undefined),
    get total() { return total; },
    get cols() { return cols; },
    get active() { return active; },
    /** The element drawn for index i, if it is in the DOM. */
    elementAt: (i) => mounted.get(i)?.el ?? null,
    /** The first index in view (to restore after a refresh). */
    range: () => [first, last],
    focusIndex,
    reveal,
    /** Re-measure (the layout changed) and redraw every card. */
    relayout() { width = 0; measure(); draw(true); },
    redraw: () => draw(true),
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); },
  };
}
