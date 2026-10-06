// Direct manipulation on the preview: an SVG layer over the frame that hit-tests the layers at the
// playhead, draws the selected layer's box, corner handles, rotation handle and anchor, and turns
// drags into transform patches. Geometry comes from /core/transform.js, the same code the runtime
// places layers with, so the handles sit exactly on what is drawn.
//
//   const handles = createCanvasHandles({ host: frameEl, layers, selection, onSelect, onTransform });
//   handles.redraw();   // after the time, the selection or the draft changed

import { safeZone } from '/core/engine.js';
import { TRANSFORM_DEFAULTS, apply, corners, invert, layerGeometry, spaceRect } from '/core/transform.js';
import { s } from '/ui/lib/util.js';

const CORNER = { nw: [0, 0], ne: [1, 0], se: [1, 1], sw: [0, 1] };
const SNAP_PX = 7;          // screen pixels
const MIN_BOX = 4;          // frame pixels

const aabb = (pts) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
  return { l, r, t, b, cx: (l + r) / 2, cy: (t + b) / 2 };
};

/** Is frame point p inside the layer's (rotated, scaled) box? */
function hits(geo, p) {
  const inv = invert(geo.matrix);
  if (!inv) return false;
  const q = apply(inv, p.x, p.y);
  return q.x >= 0 && q.y >= 0 && q.x <= geo.width && q.y <= geo.height;
}

/**
 * @param {{
 *   host: HTMLElement,
 *   size: () => { width: number, height: number },
 *   layers: () => { id: string, transform: any, editable: boolean, label?: string }[],
 *   selection: () => { ids: Set<string>, primary: string | null },
 *   onSelect: (id: string | null, additive: boolean) => void,
 *   onTransform: (id: string, patch: object, phase: { begin: boolean, done: boolean }) => void,
 * }} o  layers are listed front to back
 */
export function createCanvasHandles({ host, size, layers, selection, onSelect, onTransform }) {
  const svg = s('svg', { class: 'canvas-overlay', 'data-testid': 'canvas-overlay', preserveAspectRatio: 'none', tabindex: '0', role: 'application', 'aria-label': 'Layers on the preview: click to select, drag to move, arrow keys nudge' });
  host.append(svg);
  let guides = [];          // [{ x } | { y }] while a move snaps
  let enabled = true;

  const unit = () => { const r = svg.getBoundingClientRect(); return r.width ? size().width / r.width : 1; };
  const toFrame = (e) => {
    const r = svg.getBoundingClientRect(), { width, height } = size();
    return { x: ((e.clientX - r.left) / (r.width || 1)) * width, y: ((e.clientY - r.top) / (r.height || 1)) * height };
  };
  const full = (t) => ({ ...TRANSFORM_DEFAULTS, ...t });

  function redraw() {
    const { width, height } = size();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    if (!enabled) return;
    const u = unit();
    const sel = selection();
    const list = layers();
    for (const L of list) {
      if (!sel.ids.has(L.id)) continue;
      const geo = layerGeometry(L.transform, width, height);
      const pts = corners(geo);
      const d = `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}Z`;
      const primary = L.id === sel.primary;
      svg.append(s('path', { class: `box${primary ? ' primary' : ''}${L.editable ? '' : ' locked'}`, d, 'data-handle': primary && L.editable ? 'move' : null, 'data-testid': primary && L.editable ? 'handle' : null }));
      if (!primary || !L.editable) continue;
      // the rotation handle sits outside the top edge, along the box's own "up"
      const top = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const side = { x: (pts[3].x + pts[2].x) / 2, y: (pts[3].y + pts[2].y) / 2 };
      const len = Math.hypot(top.x - side.x, top.y - side.y) || 1;
      const flip = geo.matrix[3] < 0 ? -1 : 1;
      const rot = { x: top.x + ((top.x - side.x) / len) * 30 * u * flip, y: top.y + ((top.y - side.y) / len) * 30 * u * flip };
      svg.append(s('line', { class: 'rot-arm', x1: top.x, y1: top.y, x2: rot.x, y2: rot.y }));
      const knob = (name, p, cls) => {
        const g = s('g', { class: `knob ${cls}`, 'data-handle': name, 'data-testid': 'handle' });
        g.append(s('circle', { class: 'hit', cx: p.x, cy: p.y, r: 15 * u }), s('circle', { class: 'dot', cx: p.x, cy: p.y, r: (cls === 'rotate' ? 6 : 5) * u }));
        svg.append(g);
      };
      ['nw', 'ne', 'se', 'sw'].forEach((n, i) => knob(n, pts[i], 'corner'));
      knob('rotate', rot, 'rotate');
      const a = geo.anchor, c = 7 * u;
      svg.append(s('g', { class: 'anchor' }, s('circle', { cx: a.x, cy: a.y, r: 3.5 * u }), s('line', { x1: a.x - c, y1: a.y, x2: a.x + c, y2: a.y }), s('line', { x1: a.x, y1: a.y - c, x2: a.x, y2: a.y + c })));
    }
    for (const g of guides) {
      svg.append(g.x !== undefined
        ? s('line', { class: 'snap-guide', 'data-testid': 'snap-guide', x1: g.x, y1: 0, x2: g.x, y2: height })
        : s('line', { class: 'snap-guide', 'data-testid': 'snap-guide', x1: 0, y1: g.y, x2: width, y2: g.y }));
    }
  }

  /** The layer under a frame point, front-most first; the primary selection wins where it overlaps. */
  function hitTest(p) {
    const { width, height } = size();
    const list = layers();
    const sel = selection();
    const prim = list.find((L) => L.id === sel.primary);
    if (prim && hits(layerGeometry(prim.transform, width, height), p)) return prim;
    return list.find((L) => hits(layerGeometry(L.transform, width, height), p)) ?? null;
  }

  function drag(e, layer, mode) {
    const { width, height } = size();
    const t0 = full(layer.transform);
    const geo0 = layerGeometry(t0, width, height);
    const R = spaceRect(t0.space, width, height);
    const p0 = toFrame(e);
    const u = unit();
    const safe = safeZone(width, height);
    const box0 = aabb(corners(geo0));
    const others = layers().filter((L) => L.id !== layer.id).map((L) => aabb(corners(layerGeometry(L.transform, width, height))));
    const xs = [width / 2, safe.x, safe.x + safe.width, 0, width, ...others.flatMap((b) => [b.l, b.cx, b.r])];
    const ys = [height / 2, safe.y, safe.y + safe.height, 0, height, ...others.flatMap((b) => [b.t, b.cy, b.b])];
    const inv0 = invert(geo0.matrix);
    let began = false;
    const send = (patch, done) => {
      const r = (v) => Math.round(v * 10000) / 10000;
      const out = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, r(v)]));
      onTransform(layer.id, out, { begin: !began, done });
      began = true;
    };

    const step = (ev, done) => {
      const p = toFrame(ev);
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (!began && Math.hypot(dx, dy) < 2 * u && !done) return;
      if (!began && done && Math.hypot(dx, dy) < 2 * u) return;
      guides = [];
      if (mode === 'move') {
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (!ev.altKey) {
          const thr = SNAP_PX * u;
          const best = (cands, vals) => {
            let pick = null;
            for (const v of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= thr && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, at: c }; }
            return pick;
          };
          const sx = ev.shiftKey && dx === 0 ? null : best(xs, [box0.l + dx, box0.cx + dx, box0.r + dx]);
          const sy = ev.shiftKey && dy === 0 ? null : best(ys, [box0.t + dy, box0.cy + dy, box0.b + dy]);
          if (sx) { dx += sx.d; guides.push({ x: sx.at }); }
          if (sy) { dy += sy.d; guides.push({ y: sy.at }); }
        }
        send({ x: t0.x + dx / R.width, y: t0.y + dy / R.height }, done);
      } else if (mode === 'rotate') {
        const a = geo0.anchor;
        const ang = (q) => (Math.atan2(q.y - a.y, q.x - a.x) * 180) / Math.PI;
        let rot = t0.rotation + ang(p) - ang(p0);
        if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
        rot = ((rot + 540) % 360) - 180;
        send({ rotation: rot }, done);
      } else {
        // a corner: the opposite corner stays put, in the box's own (rotated, scaled) space
        const [cx, cy] = CORNER[mode];
        const ox = (1 - cx) * geo0.width, oy = (1 - cy) * geo0.height;
        const q = apply(inv0, p.x, p.y);
        const sgx = cx ? 1 : -1, sgy = cy ? 1 : -1;
        let w = Math.max(MIN_BOX, (q.x - ox) * sgx), hh = Math.max(MIN_BOX, (q.y - oy) * sgy);
        if (ev.shiftKey) { const k = Math.max(w / geo0.width, hh / geo0.height); w = geo0.width * k; hh = geo0.height * k; }
        const left = sgx > 0 ? ox : ox - w, top = sgy > 0 ? oy : oy - hh;
        const anchor = apply(geo0.matrix, left + t0.anchorX * w, top + t0.anchorY * hh);
        send({ x: (anchor.x - R.x) / R.width, y: (anchor.y - R.y) / R.height, width: w / R.width, height: hh / R.height }, done);
      }
      if (done) guides = [];
      redraw();
    };
    const move = (ev) => step(ev, false);
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); step(ev, true); guides = []; redraw(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  svg.addEventListener('pointerdown', (e) => {
    if (!enabled || (e.button !== undefined && e.button > 0)) return;
    const target = e.target instanceof Element ? e.target.closest('[data-handle]') : null;
    const handle = target?.getAttribute('data-handle') ?? null;
    const sel = selection();
    const list = layers();
    e.preventDefault();
    svg.focus({ preventScroll: true });
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    if (handle && handle !== 'move') {
      const L = list.find((x) => x.id === sel.primary);
      if (L?.editable) drag(e, L, handle);
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const L = handle === 'move' && !additive ? list.find((x) => x.id === sel.primary) : hitTest(toFrame(e));
    if (!L) { if (!additive) onSelect(null, false); return; }
    if (additive) { onSelect(L.id, true); return; }
    if (sel.primary !== L.id) onSelect(L.id, false);
    if (L.editable) drag(e, L, 'move');
  });

  svg.addEventListener('keydown', (e) => {
    if (!enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const sel = selection();
    const L = layers().find((x) => x.id === sel.primary);
    if (!L?.editable) return;
    e.preventDefault();
    const { width, height } = size();
    const t = full(L.transform);
    const R = spaceRect(t.space, width, height);
    const n = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
    onTransform(L.id, { x: Math.round((t.x + dx / R.width) * 10000) / 10000, y: Math.round((t.y + dy / R.height) * 10000) / 10000 }, { begin: true, done: true });
    redraw();
  });

  const resize = new ResizeObserver(() => redraw());
  resize.observe(svg);

  return {
    el: svg,
    redraw,
    /** Hide the handles (while a proposal is on screen). */
    setEnabled(on) { enabled = on; svg.classList.toggle('off', !on); redraw(); },
    destroy() { resize.disconnect(); svg.remove(); },
  };
}
