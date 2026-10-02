// The clip editor's timeline: a ruler with beat ticks, one row per track, items as blocks that can
// be selected, dragged in time and trimmed at their edges, and a playhead. It scrolls sideways
// inside its own container, so a long clip never widens the page.

import { clamp, fmtTime, h, splitRef } from '/ui/lib/util.js';

const SNAP = 0.05;
const MIN_ITEM = 0.1;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
const snap = (t) => Math.round(t / SNAP) * SNAP;
const round = (t) => Math.round(t * 1000) / 1000;

/**
 * @param {{
 *   onSeek: (t: number) => void,
 *   onSelect: (itemId: string | null, trackId: string | null) => void,
 *   onChange: (itemId: string, patch: { start: number, duration: number }, done: boolean) => void,
 * }} o
 */
export function createTimeline({ onSeek, onSelect, onChange }) {
  let comp = null, beats = [], pps = 40, time = 0, selected = null, selectedTrack = null, fitted = false;
  let itemEls = new Map();

  const ruler = h('div.tl-ruler', { 'data-testid': 'ruler' });
  const playhead = h('div.tl-playhead', { 'data-testid': 'playhead' });
  const rows = h('div.tl-rows');
  const inner = h('div.tl-inner', h('div.tl-row.tl-ruler-row', h('div.tl-head', h('span.muted', 'Tracks')), ruler), rows, playhead);
  const el = h('div.timeline', { 'data-testid': 'timeline', tabIndex: 0, role: 'group', 'aria-label': 'Timeline' }, inner);

  const zoom = h('input', { type: 'range', min: 4, max: 240, step: 1, value: '40', 'data-testid': 'zoom', 'aria-label': 'Timeline zoom' });
  const fitBtn = h('button.btn.small', { type: 'button', 'data-testid': 'zoom-fit' }, 'Fit');
  const toolbar = h('div.tl-toolbar', h('label.tl-zoom', h('span', 'Zoom'), zoom), fitBtn);

  const headWidth = () => inner.querySelector('.tl-head')?.getBoundingClientRect().width ?? 120;
  const lanesWidth = () => (comp ? Math.max(1, comp.duration * pps) : 1);

  function fit() {
    if (!comp) return;
    const room = el.clientWidth - headWidth() - 24;
    if (room <= 0) return;
    pps = clamp(room / comp.duration, 4, 240);
    // short blocks must stay grabbable: never fit below 16 px per second on a narrow pane
    if (el.clientWidth < 560) pps = Math.max(pps, 16);
    zoom.value = String(Math.round(pps));
    fitted = true;
    layout();
  }

  function drawRuler() {
    ruler.replaceChildren();
    if (!comp) return;
    const step = TICK_STEPS.find((x) => x * pps >= 64) ?? 60;
    for (let i = 0; i * step <= comp.duration + 1e-6; i++) {
      const t = i * step;
      // the last tick keeps its line but drops a label that would run past the end
      ruler.append(h('span.tl-tick', { style: { left: `${t * pps}px` } }, (comp.duration - t) * pps >= 44 ? fmtTime(t).replace(/\.00$/, '') : ''));
    }
    for (const b of beats) {
      if (b <= comp.duration) ruler.append(h('i.tl-beat', { style: { left: `${b * pps}px` }, 'data-testid': 'beat' }));
    }
  }

  function place(node, item) {
    node.style.left = `${item.start * pps}px`;
    node.style.width = `${Math.max(2, item.duration * pps)}px`;
  }

  function movePlayhead() {
    playhead.style.transform = `translateX(${time * pps}px)`;
  }

  function layout() {
    if (!comp) return;
    inner.style.setProperty('--lanes', `${lanesWidth()}px`);
    drawRuler();
    for (const { item } of items()) { const node = itemEls.get(item.id); if (node) place(node, item); }
    movePlayhead();
  }

  function* items() { for (const track of comp.tracks) for (const item of track.items) yield { track, item }; }

  /** Tracks top to bottom: the frontmost visual track first, audio tracks last. */
  function order() {
    const visual = comp.tracks.filter((t) => t.type !== 'audio').reverse();
    return [...visual, ...comp.tracks.filter((t) => t.type === 'audio')];
  }

  function build() {
    itemEls = new Map();
    rows.replaceChildren();
    if (!comp) return;
    if (!comp.tracks.length) rows.append(h('div.tl-row', h('div.tl-head'), h('div.tl-lane.tl-empty', h('span.muted', 'No tracks yet. Add an item to start.'))));
    for (const track of order()) {
      const lane = h('div.tl-lane', { 'data-track': track.id });
      // items of one track may overlap in time: stack them in sub-rows so each stays reachable
      const ends = [];
      const sub = new Map();
      for (const item of [...track.items].sort((a, b) => a.start - b.start)) {
        let k = ends.findIndex((end) => end <= item.start + 1e-6);
        if (k < 0) k = ends.length;
        ends[k] = item.start + item.duration;
        sub.set(item.id, k);
      }
      for (const item of track.items) {
        const node = h(`div.tl-item.${track.type}`, { 'data-testid': 'item', 'data-id': item.id, 'data-asset': item.asset, tabIndex: 0, role: 'button', 'aria-label': `${splitRef(item.asset).slug}, starts at ${fmtTime(item.start)}`, title: `${item.asset} · ${item.id}` },
          h('span.tl-handle.l', { 'data-edge': 'l' }),
          h('span.tl-label', item.label ?? splitRef(item.asset).slug),
          h('span.tl-handle.r', { 'data-edge': 'r' }));
        node.style.setProperty('--sub', String(sub.get(item.id) ?? 0));
        place(node, item);
        node.addEventListener('pointerdown', (e) => startDrag(e, item, node));
        node.addEventListener('click', (e) => { e.stopPropagation(); select(item.id, track.id); });
        node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); select(item.id, track.id); } });
        itemEls.set(item.id, node);
        lane.append(node);
      }
      const head = h('button.tl-head', { type: 'button', 'data-track': track.id, title: 'Select this track for new items' }, h('span.tl-name', track.name ?? track.id), h('span.tl-type', track.type));
      head.addEventListener('click', () => select(null, track.id));
      lane.addEventListener('click', () => select(null, track.id));
      rows.append(h('div.tl-row', { 'data-track': track.id, style: { '--subs': String(Math.max(1, ends.length)) } }, head, lane));
    }
    mark();
    layout();
  }

  function mark() {
    for (const [id, node] of itemEls) { node.classList.toggle('selected', id === selected); node.setAttribute('aria-pressed', String(id === selected)); }
    for (const row of rows.querySelectorAll('.tl-row[data-track]')) row.classList.toggle('selected', row.dataset.track === selectedTrack);
  }

  function select(itemId, trackId) {
    selected = itemId;
    selectedTrack = trackId;
    mark();
    onSelect(itemId, trackId);
  }

  // drag to move, drag an edge to trim. Touch drags only the selected item, so a swipe still scrolls.
  function startDrag(e, item, node) {
    if (e.button !== undefined && e.button > 0) return;
    if (e.pointerType === 'touch' && selected !== item.id) return;
    const edge = e.target instanceof Element ? e.target.dataset.edge ?? null : null;
    const x0 = e.clientX, start0 = item.start, dur0 = item.duration;
    let moved = false;
    e.preventDefault();
    node.focus({ preventScroll: true });
    try { node.setPointerCapture(e.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    const apply = (ev, done) => {
      const dt = (ev.clientX - x0) / pps;
      if (!moved && Math.abs(ev.clientX - x0) < 3) { if (done) finish(); return; }
      moved = true;
      let start = start0, duration = dur0;
      if (edge === 'l') {
        start = clamp(snap(start0 + dt), 0, start0 + dur0 - MIN_ITEM);
        duration = start0 + dur0 - start;
      } else if (edge === 'r') {
        duration = clamp(snap(start0 + dur0 + dt) - start0, MIN_ITEM, comp.duration - start0);
      } else {
        start = clamp(snap(start0 + dt), 0, Math.max(0, comp.duration - dur0));
      }
      item.start = round(start); item.duration = round(duration);
      place(node, item);
      node.classList.add('dragging');
      onChange(item.id, { start: item.start, duration: item.duration }, done);
      if (done) finish();
    };
    const move = (ev) => apply(ev, false);
    const up = (ev) => apply(ev, true);
    const finish = () => {
      node.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // a drag that ends outside the block fires no click, so select here
      if (moved && selected !== item.id) select(item.id, trackOf(item.id));
      // overlaps may have changed: restack the rows once the pointer is up
      if (moved) setTimeout(build, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const trackOf = (itemId) => comp.tracks.find((t) => t.items.some((i) => i.id === itemId))?.id ?? null;

  // the ruler seeks: click, or press and drag
  const seekAt = (e) => {
    const x = e.clientX - ruler.getBoundingClientRect().left;
    onSeek(clamp(x / pps, 0, comp.duration));
  };
  ruler.addEventListener('pointerdown', (e) => {
    if (!comp || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    seekAt(e);
    const move = (ev) => seekAt(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  zoom.addEventListener('input', () => { pps = Number(zoom.value); layout(); });
  fitBtn.addEventListener('click', fit);

  const resize = new ResizeObserver(() => { if (comp && !fitted) fit(); });
  resize.observe(el);

  return {
    el, toolbar,
    /** A new composition (after load, save, bundle, add or delete): rebuild the rows. */
    setData(next) {
      comp = next.composition; beats = next.beats ?? [];
      build();
      if (!fitted) fit();
    },
    /** Positions changed in the inspector: move the blocks without rebuilding. */
    refresh() { build(); },
    setTime(t, follow = false) {
      time = t;
      movePlayhead();
      if (follow) {
        const x = headWidth() + t * pps;
        if (x < el.scrollLeft + headWidth() || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - headWidth() - 40);
      }
    },
    setSelected(itemId, trackId = itemId ? trackOf(itemId) : selectedTrack) { selected = itemId; selectedTrack = trackId; mark(); },
    get pxPerSecond() { return pps; },
    destroy() { resize.disconnect(); },
  };
}
