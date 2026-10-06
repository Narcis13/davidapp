// The clip editor's timeline: a ruler with beat ticks, one row per track (front-most visual track
// at the top, audio at the bottom) with its controls, items as blocks that can be selected (Shift
// or ⌘ adds), dragged in time and to another track, trimmed at their edges, keyframe markers and
// audio waveforms, and a playhead. Moves snap to the playhead, beats and other items' edges. It
// scrolls inside its own container, so a long clip never widens the page.

import { clamp, fmtTime, h, s, splitRef } from '/ui/lib/util.js';
import { drawWaveform } from '/ui/lib/waveform.js';

const GRID = 0.05;
const MIN_ITEM = 0.1;
const SNAP_PX = 8;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
const grid = (t) => Math.round(t / GRID) * GRID;
const round = (t) => Math.round(t * 1000) / 1000;
const visualType = (type) => type !== 'audio';

const GLYPH = {
  grip: '<path d="M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01" stroke-width="2.6"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  eye: '<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/>',
  solo: '<circle cx="10" cy="10" r="6.5"/><path d="M12 7.6c-.5-.6-1.200-.9-2-.9-1.100 0-2 .6-2 1.500 0 2 4 1 4 3.100 0 .9-.9 1.600-2.100 1.600-.9 0-1.700-.4-2.200-1"/>',
  mute: '<path d="M4 8v4h3l4 3V5L7 8zM14 8l4 4M18 8l-4 4"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.600L14 6"/>',
};
const glyph = (name) => { const el = s('svg', { viewBox: '0 0 20 20', width: 16, height: 16, class: 'icon', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); el.innerHTML = GLYPH[name]; return el; };

/**
 * @param {{
 *   onSeek: (t: number) => void,
 *   onSelect: (ids: string[], primary: string | null, trackId: string | null) => void,
 *   onBegin?: (key: string) => void,
 *   onChange: (itemId: string, patch: { start: number, duration: number }, done: boolean) => void,
 *   onMoveItem?: (itemId: string, trackId: string) => void,
 *   onTrack?: (trackId: string, patch: object) => void,
 *   onReorderTracks?: (ids: string[]) => void,
 *   onAddTrack?: (type: string) => void,
 *   onDeleteTrack?: (trackId: string) => void,
 *   keyframesOf?: (item: any) => { prop: string, t: number }[],
 * }} o
 */
export function createTimeline({ onSeek, onSelect, onBegin = () => {}, onChange, onMoveItem = () => {}, onTrack = () => {}, onReorderTracks = () => {}, onAddTrack = () => {}, onDeleteTrack = () => {}, keyframesOf = () => [] }) {
  let comp = null, beats = [], pps = 40, time = 0, fitted = false, peaks = null;
  let selected = new Set(), primary = null, selectedTrack = null;
  let itemEls = new Map();

  const ruler = h('div.tl-ruler', { 'data-testid': 'ruler' });
  const playhead = h('div.tl-playhead', { 'data-testid': 'playhead' });
  const snapLine = h('div.tl-snap', { 'data-testid': 'time-snap', hidden: true });
  const rows = h('div.tl-rows');
  const inner = h('div.tl-inner', h('div.tl-row.tl-ruler-row', h('div.tl-head', h('span.muted', 'Tracks')), ruler), rows, playhead, snapLine);
  const el = h('div.timeline', { 'data-testid': 'timeline', tabIndex: 0, role: 'group', 'aria-label': 'Timeline' }, inner);

  const zoom = h('input', { type: 'range', min: 4, max: 240, step: 1, value: '40', 'data-testid': 'zoom', 'aria-label': 'Timeline zoom' });
  const fitBtn = h('button.btn.small', { type: 'button', 'data-testid': 'zoom-fit' }, 'Fit');
  const trackType = h('select.small', { 'data-testid': 'add-track-type', 'aria-label': 'Type of the new track' }, h('option', { value: 'visual' }, 'Visual'), h('option', { value: 'text' }, 'Text'), h('option', { value: 'audio' }, 'Audio'));
  const addTrackBtn = h('button.btn.small', { type: 'button', 'data-testid': 'add-track', title: 'Add a track (visual tracks go in front)' }, '+ Track');
  addTrackBtn.addEventListener('click', () => onAddTrack(trackType.value));
  const toolbar = h('div.tl-toolbar', h('label.tl-zoom', h('span', 'Zoom'), zoom), fitBtn, h('span.tl-add-track', trackType, addTrackBtn));

  const headWidth = () => inner.querySelector('.tl-head')?.getBoundingClientRect().width ?? 120;
  const lanesWidth = () => (comp ? Math.max(1, comp.duration * pps) : 1);
  const trackById = (id) => comp.tracks.find((t) => t.id === id);

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
    for (const k of node.querySelectorAll('.tl-kf')) k.style.left = `${(Number(k.dataset.t) - (item.offset ?? 0)) * pps}px`;
    const wave = node.querySelector('canvas.tl-wave');
    if (wave && peaks) requestAnimationFrame(() => { if (wave.isConnected) drawWaveform(wave, peaks, item.start, item.start + item.duration); });
  }

  function movePlayhead() { playhead.style.transform = `translateX(${time * pps}px)`; }

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
    const visual = comp.tracks.filter((t) => visualType(t.type)).reverse();
    return [...visual, ...comp.tracks.filter((t) => t.type === 'audio')];
  }

  function toggleBtn(track, key, label, name, testid) {
    const on = !!track[key];
    const b = h(`button.tl-flag.${key}`, { type: 'button', 'data-testid': testid, 'data-track': track.id, 'aria-pressed': String(on), 'data-on': String(on), 'aria-label': `${label} ${track.name ?? track.id}`, title: label }, glyph(name));
    b.addEventListener('click', (e) => { e.stopPropagation(); onTrack(track.id, { [key]: !on }); });
    return b;
  }

  function trackHead(track, index, group) {
    const name = h('input.tl-name', { type: 'text', value: track.name ?? track.id, 'data-testid': 'track-name', 'data-track': track.id, 'aria-label': 'Track name', spellcheck: false, autocomplete: 'off', maxLength: 60 });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } else if (e.key === 'Escape') { name.value = track.name ?? track.id; name.blur(); } });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== (track.name ?? track.id)) onTrack(track.id, { name: v }); else name.value = track.name ?? track.id; });
    const grip = h('button.tl-grip', { type: 'button', 'data-testid': 'track-handle', 'data-track': track.id, 'aria-label': `Move track ${track.name ?? track.id} (arrow keys)`, title: 'Drag to change the stacking order', disabled: !!track.locked }, glyph('grip'));
    grip.addEventListener('pointerdown', (e) => startTrackDrag(e, track, group));
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      reorder(track.id, group, index + (e.key === 'ArrowUp' ? -1 : 1));
    });
    const del = h('button.tl-flag.del', { type: 'button', 'data-testid': 'delete-track', 'data-track': track.id, 'aria-label': `Delete track ${track.name ?? track.id}`, title: 'Delete track', disabled: !!track.locked }, glyph('trash'));
    del.addEventListener('click', (e) => { e.stopPropagation(); onDeleteTrack(track.id); });
    const head = h('div.tl-head', { 'data-track': track.id },
      h('div.tl-head-top', grip, name, del),
      h('div.tl-flags',
        toggleBtn(track, 'locked', 'Lock', 'lock', 'track-lock'),
        toggleBtn(track, 'hidden', 'Hide', 'eye', 'track-hide'),
        toggleBtn(track, 'solo', 'Solo', 'solo', 'track-solo'),
        track.type === 'audio' ? toggleBtn(track, 'muted', 'Mute', 'mute', 'track-mute') : null,
        h('span.tl-type', track.type)));
    head.addEventListener('click', (e) => { if (e.target === head || e.target.classList?.contains('tl-type')) select([], null, track.id); });
    return head;
  }

  function build() {
    itemEls = new Map();
    rows.replaceChildren();
    if (!comp) return;
    if (!comp.tracks.length) rows.append(h('div.tl-row', h('div.tl-head'), h('div.tl-lane.tl-empty', h('span.muted', 'No tracks yet. Add an item to start.'))));
    const shown = order();
    const visual = shown.filter((t) => visualType(t.type)), audio = shown.filter((t) => !visualType(t.type));
    for (const track of shown) {
      const group = visualType(track.type) ? visual : audio;
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
        const kfs = track.type === 'audio' ? [] : keyframesOf(item);
        const node = h(`div.tl-item.${track.type}`, { 'data-testid': 'item', 'data-id': item.id, 'data-asset': item.asset, 'data-track': track.id, tabIndex: 0, role: 'button', 'aria-label': `${splitRef(item.asset).slug}, starts at ${fmtTime(item.start)}`, title: `${item.asset} · ${item.id}` },
          track.type === 'audio' ? h('canvas.tl-wave', { 'data-testid': 'waveform', 'aria-hidden': 'true', width: 1, height: 1 }) : null,
          h('span.tl-handle.l', { 'data-edge': 'l' }),
          h('span.tl-label', item.label ?? splitRef(item.asset).slug),
          kfs.map((k) => {
            const m = h('i.tl-kf', { 'data-testid': 'keyframe', 'data-prop': k.prop, 'data-t': String(k.t), title: `${k.prop} at ${fmtTime(k.t)}` });
            m.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); onSeek(clamp(item.start + k.t - (item.offset ?? 0), 0, comp.duration)); });
            return m;
          }),
          h('span.tl-handle.r', { 'data-edge': 'r' }));
        node.style.setProperty('--sub', String(sub.get(item.id) ?? 0));
        if (track.locked) node.classList.add('locked');
        place(node, item);
        node.addEventListener('pointerdown', (e) => startDrag(e, item, node, track));
        node.addEventListener('click', (e) => { e.stopPropagation(); click(item.id, track.id, e); });
        node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); click(item.id, track.id, e); } });
        itemEls.set(item.id, node);
        lane.append(node);
      }
      lane.addEventListener('click', () => select([], null, track.id));
      const flags = ['locked', 'hidden', 'solo', 'muted'].filter((k) => track[k]);
      rows.append(h(`div.tl-row${flags.map((f) => `.is-${f}`).join('')}`, { 'data-track': track.id, style: { '--subs': String(Math.max(1, ends.length)) } }, trackHead(track, group.indexOf(track), group), lane));
    }
    mark();
    layout();
  }

  function mark() {
    for (const [id, node] of itemEls) {
      node.classList.toggle('selected', selected.has(id));
      node.classList.toggle('primary', id === primary);
      node.setAttribute('aria-pressed', String(selected.has(id)));
    }
    for (const row of rows.querySelectorAll('.tl-row[data-track]')) row.classList.toggle('selected', row.dataset.track === selectedTrack);
  }

  function select(ids, prim, trackId) {
    selected = new Set(ids);
    primary = prim;
    selectedTrack = trackId;
    mark();
    onSelect([...selected], primary, trackId);
  }

  /** Click: select one; Shift, ⌘ or Ctrl adds or removes it. */
  function click(id, trackId, e) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      const prim = next.has(id) ? id : [...next].pop() ?? null;
      select([...next], prim, trackId);
    } else select([id], id, trackId);
  }

  /** Times an edge can snap to: the playhead, beats, other items' edges, the clip's ends. */
  function snapTargets(exclude) {
    const out = [0, comp.duration, time, ...beats];
    for (const { item } of items()) if (!exclude.has(item.id)) out.push(item.start, item.start + item.duration);
    return out;
  }
  function snapTo(values, targets, thr) {
    let best = null;
    for (const v of values) for (const c of targets) { const d = c - v; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c }; }
    return best;
  }
  function showSnap(t) {
    if (t === null) { snapLine.hidden = true; return; }
    snapLine.hidden = false;
    snapLine.style.transform = `translateX(${t * pps}px)`;
  }

  /** The row under a client y among the tracks an item may move to. */
  function rowAt(y, from) {
    for (const row of rows.querySelectorAll('.tl-row[data-track]')) {
      const r = row.getBoundingClientRect();
      if (y >= r.top && y < r.bottom) {
        const t = trackById(row.dataset.track);
        if (t && !t.locked && visualType(t.type) === visualType(from.type)) return { row, track: t };
        return null;
      }
    }
    return null;
  }

  // drag to move (also to another track), drag an edge to trim. Touch drags only a selected item, so a swipe still scrolls.
  function startDrag(e, item, node, track) {
    if (e.button !== undefined && e.button > 0) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (track.locked) return;
    if (e.pointerType === 'touch' && !selected.has(item.id)) return;
    const edge = e.target instanceof Element ? e.target.dataset.edge ?? null : null;
    const x0 = e.clientX, start0 = item.start, dur0 = item.duration;
    const targets = snapTargets(new Set([item.id]));
    let moved = false, drop = null;
    e.preventDefault();
    node.focus({ preventScroll: true });
    try { node.setPointerCapture(e.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    const apply = (ev, done) => {
      const dt = (ev.clientX - x0) / pps;
      const crossed = !edge && ev.clientY !== undefined ? rowAt(ev.clientY, track) : null;
      const leaving = crossed && crossed.track.id !== track.id;
      if (!moved && Math.abs(ev.clientX - x0) < 3 && !leaving) { if (done) finish(); return; }
      if (!moved) onBegin(`drag:${item.id}:${performance.now()}`);
      moved = true;
      const thr = ev.altKey ? -1 : SNAP_PX / pps;
      let start = start0, duration = dur0, snapped = null;
      if (edge === 'l') {
        const sn = snapTo([start0 + dt], targets, thr);
        start = clamp(sn ? start0 + dt + sn.d : grid(start0 + dt), 0, start0 + dur0 - MIN_ITEM);
        if (sn) snapped = sn.at;
        duration = start0 + dur0 - start;
      } else if (edge === 'r') {
        const sn = snapTo([start0 + dur0 + dt], targets, thr);
        duration = clamp((sn ? start0 + dur0 + dt + sn.d : grid(start0 + dur0 + dt)) - start0, MIN_ITEM, comp.duration - start0);
        if (sn) snapped = sn.at;
      } else {
        const sn = snapTo([start0 + dt, start0 + dur0 + dt], targets, thr);
        start = clamp(sn ? start0 + dt + sn.d : grid(start0 + dt), 0, Math.max(0, comp.duration - dur0));
        if (sn) snapped = sn.at;
      }
      showSnap(done ? null : snapped);
      item.start = round(start); item.duration = round(duration);
      place(node, item);
      node.classList.add('dragging');
      for (const r of rows.querySelectorAll('.tl-row.drop-target')) r.classList.remove('drop-target');
      drop = leaving ? crossed.track : null;
      if (drop && !done) crossed.row.classList.add('drop-target');
      onChange(item.id, { start: item.start, duration: item.duration }, done && !drop);
      if (done) finish();
    };
    const move = (ev) => apply(ev, false);
    const up = (ev) => apply(ev, true);
    const finish = () => {
      node.classList.remove('dragging');
      showSnap(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // a drag that ends outside the block fires no click, so select here
      if (moved && !selected.has(item.id)) select([item.id], item.id, track.id);
      if (moved && drop) { onMoveItem(item.id, drop.id); return; }
      // overlaps may have changed: restack the rows once the pointer is up
      if (moved) setTimeout(build, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** New display position of a track within its group (visual or audio). */
  function reorder(id, group, index) {
    const ids = group.map((t) => t.id);
    const from = ids.indexOf(id);
    const to = clamp(index, 0, ids.length - 1);
    if (from < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    const shown = order();
    const visual = visualType(trackById(id).type) ? ids : shown.filter((t) => visualType(t.type)).map((t) => t.id);
    const audio = visualType(trackById(id).type) ? shown.filter((t) => !visualType(t.type)).map((t) => t.id) : ids;
    // the composition draws the first track at the back: the top row is the last one
    onReorderTracks([...[...visual].reverse(), ...audio]);
    requestAnimationFrame(() => rows.querySelector(`[data-testid=track-handle][data-track="${CSS.escape(id)}"]`)?.focus());
  }

  function startTrackDrag(e, track, group) {
    if (track.locked || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    const row = rows.querySelector(`.tl-row[data-track="${CSS.escape(track.id)}"]`);
    const groupRows = group.map((t) => rows.querySelector(`.tl-row[data-track="${CSS.escape(t.id)}"]`));
    const y0 = e.clientY;
    // where the rows were when the drag started (the dragged one moves with the pointer)
    const rects = groupRows.map((r) => r.getBoundingClientRect());
    let index = group.indexOf(track);
    const move = (ev) => {
      row.classList.add('dragging');
      row.style.transform = `translateY(${ev.clientY - y0}px)`;
      index = group.indexOf(track);
      for (const [i, b] of rects.entries()) {
        if (ev.clientY >= b.top && ev.clientY < b.bottom) index = i;
      }
      for (const [i, r] of groupRows.entries()) r.classList.toggle('drop-target', i === index && r !== row);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      row.style.transform = '';
      for (const r of groupRows) r.classList.remove('drop-target');
      reorder(track.id, group, index);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

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
    /** Something changed in the draft (timing, keyframes, flags): rebuild the rows. */
    refresh() { build(); },
    /** Audio peaks of the clip's mix ({ peaks, rate }) for the waveforms. */
    setPeaks(p) { peaks = p; layout(); },
    setTime(t, follow = false) {
      time = t;
      movePlayhead();
      if (follow) {
        const x = headWidth() + t * pps;
        if (x < el.scrollLeft + headWidth() || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - headWidth() - 40);
      }
    },
    /** ids: the selected items (or one id, or null), primary: the one the inspector shows. */
    setSelected(ids, prim, trackId) {
      const list = ids === null || ids === undefined ? [] : Array.isArray(ids) ? ids : [ids];
      selected = new Set(list);
      primary = prim === undefined ? list[list.length - 1] ?? null : prim;
      if (trackId !== undefined) selectedTrack = trackId;
      else if (primary) selectedTrack = comp?.tracks.find((t) => t.items.some((i) => i.id === primary))?.id ?? selectedTrack;
      mark();
    },
    get pxPerSecond() { return pps; },
    destroy() { resize.disconnect(); },
  };
}
