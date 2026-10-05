// Hand-drawn ink. A stroke is a polyline that is resampled, pushed off its path by smooth noise
// (an unsteady hand), given pen pressure (thin at the ends, swelling in the middle) and filled as a
// ribbon. Strokes draw on partially (progress 0..1) and "boil": the wobble is re-seeded a few times
// a second, like traditional hand-drawn animation. Shape helpers return point lists to feed it.

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };
const noise1 = (x, seed) => {
  const i = Math.floor(x), u = x - i, k = u * u * (3 - 2 * u);
  const a = hash(i + seed * 101.3), b = hash(i + 1 + seed * 101.3);
  return (a + (b - a) * k) * 2 - 1;
};
const lengthOf = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

function resample(pts, step) {
  const out = [[pts[0][0], pts[0][1], 0, -1]];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const x0 = pts[i - 1][0], y0 = pts[i - 1][1], x1 = pts[i][0], y1 = pts[i][1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1e-6) continue;
    const n = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= n; j++) { const u = j / n; out.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, s + d * u, j === n ? i : -1]); }
    s += d;
  }
  return out;
}

// indices of input vertices where the line turns sharply: the ribbon is split there so corners stay clean
function corners(pts) {
  const set = new Set();
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i][0] - pts[i - 1][0], ay = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0], by = pts[i + 1][1] - pts[i][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    if ((ax * bx + ay * by) / (la * lb) < 0.35) set.add(i);
  }
  return set;
}

const STYLES = {
  ink: { alpha: 1, minW: 0.32, passes: 1 },
  pen: { alpha: 1, minW: 0.55, passes: 1 },
  pencil: { alpha: 0.78, minW: 0.4, passes: 2 },
  marker: { alpha: 0.82, minW: 0.92, passes: 1, blend: 'multiply' },
};

// one fill per pass: ribbons and their round caps go into a single path wound the same way, so a
// translucent marker does not darken where the pieces overlap
function ribbonPath(ctx, pieces, dx, dy, ws) {
  ctx.beginPath();
  for (const piece of pieces) {
    const n = piece.length;
    if (!n) continue;
    if (n === 1) { const [x, y, w] = piece[0]; ctx.moveTo(x + dx + w * ws, y + dy); ctx.arc(x + dx, y + dy, w * ws, 0, TAU); continue; }
    const nrm = (i) => {
      const a = piece[Math.max(0, i - 1)], b = piece[Math.min(n - 1, i + 1)];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1;
      return [nx / l, ny / l];
    };
    const poly = [];
    for (let i = 0; i < n; i++) { const [x, y, w] = piece[i], [nx, ny] = nrm(i); poly.push([x + dx + nx * w * ws, y + dy + ny * w * ws]); }
    for (let i = n - 1; i >= 0; i--) { const [x, y, w] = piece[i], [nx, ny] = nrm(i); poly.push([x + dx - nx * w * ws, y + dy - ny * w * ws]); }
    let area = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
    poly.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]));
    ctx.closePath();
    const ccw = area < 0;
    for (const i of [0, n - 1]) {
      const [x, y, w] = piece[i];
      ctx.moveTo(x + dx + w * ws, y + dy);
      ctx.arc(x + dx, y + dy, w * ws, 0, ccw ? -TAU : TAU, ccw);
      ctx.closePath();
    }
  }
  ctx.fill('nonzero');
}

function stroke(g, input, o = {}) {
  if (!input || input.length < 2) return null;
  const ctx = o.ctx ?? g.ctx;
  const k = clamp01(o.progress ?? 1);
  if (k <= 0) return null;
  const st = STYLES[o.style ?? 'ink'] ?? STYLES.ink;
  const width = o.width ?? 4;
  const seed = (o.seed ?? 1) + (o.boil ?? 0) * 7.31;
  let pts = input;
  const over = o.closed ? 0 : (o.overshoot ?? width * 0.9);
  if (over > 0) {
    const a = pts[0], b = pts[1], y = pts[pts.length - 1], z = pts[pts.length - 2];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, lz = Math.hypot(y[0] - z[0], y[1] - z[1]) || 1;
    const oa = over * (0.4 + hash(seed * 1.7)), oz = over * (0.4 + hash(seed * 2.3));
    const head = [a[0] + (a[0] - b[0]) / la * oa, a[1] + (a[1] - b[1]) / la * oa];
    const tail = [y[0] + (y[0] - z[0]) / lz * oz, y[1] + (y[1] - z[1]) / lz * oz];
    pts = pts.length === 2 ? [head, tail] : [head, ...pts.slice(1, -1), tail];
  }
  const S0 = lengthOf(pts);
  const step = Math.max(2.5, Math.min(8, S0 / 24));
  const R = resample(pts, step);
  const S = R[R.length - 1][2];
  if (S < 0.5) return null;
  const end = S * k;
  const wob = (o.wobble ?? 1) * (o.wobblePx ?? (1.4 + width * 0.32));
  const period = o.period ?? (60 + width * 5);
  const bow = wob * 1.4 * (hash(seed * 3.7) - 0.5) * 2 * Math.min(1, S / 220);
  const tl = Math.min(S * 0.22, width * 5);
  const minW = o.minWidth ?? st.minW;
  const split = corners(pts);

  const place = (x, y, s, nx, ny) => {
    const off = wob * (0.75 * noise1(s / period, seed) + 0.25 * noise1(s / (period * 0.3), seed + 17)) + bow * Math.sin(Math.PI * s / S);
    const press = minW + (1 - minW) * smooth(s / tl) * smooth((S - s) / tl);
    const w = (width / 2) * press * (1 + 0.18 * noise1(s / (period * 1.6), seed + 5));
    return [x + nx * off, y + ny * off, w];
  };
  const normal = (i) => {
    const a = R[Math.max(0, i - 1)], b = R[Math.min(R.length - 1, i + 1)];
    const nx = -(b[1] - a[1]), ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1;
    return [nx / l, ny / l];
  };
  // the drawn part, as pieces split at sharp corners
  const pieces = [[]];
  let tip = null;
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    if (r[2] > end) {
      const p = R[i - 1], u = (end - p[2]) / Math.max(1e-6, r[2] - p[2]);
      const [nx, ny] = normal(i);
      tip = place(p[0] + (r[0] - p[0]) * u, p[1] + (r[1] - p[1]) * u, end, nx, ny);
      pieces[pieces.length - 1].push(tip);
      break;
    }
    const [nx, ny] = normal(i);
    const q = place(r[0], r[1], r[2], nx, ny);
    pieces[pieces.length - 1].push(q);
    tip = q;
    if (r[3] >= 0 && split.has(r[3]) && i < R.length - 1) pieces.push([q]);
  }

  ctx.save();
  ctx.fillStyle = o.color ?? '#1f2a44';
  if (st.blend) ctx.globalCompositeOperation = st.blend;
  const passes = o.passes ?? st.passes;
  for (let pass = 0; pass < passes; pass++) {
    ctx.globalAlpha = (o.alpha ?? 1) * st.alpha * (pass ? 0.55 : 1);
    const dx = pass ? (hash(seed + pass * 9.1) - 0.5) * width * 0.9 : 0, dy = pass ? (hash(seed + pass * 4.3) - 0.5) * width * 0.9 : 0;
    ribbonPath(ctx, pieces, dx, dy, pass ? 0.6 : 1);
  }
  ctx.restore();
  return tip ? [tip[0], tip[1]] : null;
}

// A list of strokes drawn one after another, as if the pen moves on to the next: progress runs over
// their total length, with a short pen lift between them. Items are point lists or
// { pts, width, color, style, closed, alpha }. Returns the pen tip while drawing.
function strokes(g, list, o = {}) {
  const items = list.filter(Boolean).map((s) => (Array.isArray(s) ? { pts: s } : s)).filter((s) => s.pts && s.pts.length > 1);
  if (!items.length) return null;
  const lens = items.map((s) => lengthOf(s.pts));
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const lift = o.lift ?? avg * 0.12;
  const total = lens.reduce((a, b) => a + b, 0) + lift * (items.length - 1);
  const d = clamp01(o.progress ?? 1) * total;
  let at = 0, tip = null;
  items.forEach((s, i) => {
    const k = clamp01((d - at) / Math.max(1e-6, lens[i]));
    if (k > 0) {
      const { pts, ...rest } = s;
      const t = stroke(g, pts, { ...o, ...rest, progress: k, seed: (o.seed ?? 1) + i * 13.7 + (s.seed ?? 0) });
      if (k < 1) tip = t;
    }
    at += lens[i] + lift;
  });
  return clamp01(o.progress ?? 1) < 1 ? tip : null;
}

// ---- shapes: all return point lists [[x, y], …] (or lists of them for multi-stroke shapes)
const line = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]];
function arc(cx, cy, rx, ry, a0, a1, rot = 0, n) {
  const m = n ?? Math.max(8, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / 6));
  const c = Math.cos(rot), s = Math.sin(rot), out = [];
  for (let i = 0; i <= m; i++) { const a = a0 + (a1 - a0) * (i / m), x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([cx + x * c - y * s, cy + x * s + y * c]); }
  return out;
}
// a loose, hand-drawn circle: starts somewhere, overlaps itself a little, radius drifts
function circle(cx, cy, r, o = {}) {
  const ry = o.ry ?? r, start = o.start ?? -2.2, turns = o.turns ?? 1.1, seed = o.seed ?? 3;
  const n = Math.max(16, Math.ceil(turns * Math.max(r, ry) / 3.5)), out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = start + u * turns * TAU, drift = 1 + 0.06 * noise1(u * 3, seed) + (u - 0.5) * 0.05;
    out.push([cx + Math.cos(a) * r * drift, cy + Math.sin(a) * ry * drift]);
  }
  return out;
}
function bez(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
// Catmull-Rom through the points: lets shapes be written as a few control points
function spline(pts, per = 8, closed = false) {
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(closed ? [...pts[0]] : [...pts[pts.length - 1]]);
  return out;
}
const rect = (x, y, w, h) => [line(x, y, x + w, y), line(x + w, y, x + w, y + h), line(x + w, y + h, x, y + h), line(x, y + h, x, y)];
function arrow(x0, y0, x1, y1, o = {}) {
  const bend = o.bend ?? 0.15, head = o.head ?? Math.hypot(x1 - x0, y1 - y0) * 0.18;
  const mx = (x0 + x1) / 2 - (y1 - y0) * bend, my = (y0 + y1) / 2 + (x1 - x0) * bend;
  const shaft = bez([x0, y0], [mx, my], [mx, my], [x1, y1], 20);
  const a = Math.atan2(y1 - my, x1 - mx);
  return [shaft, [[x1 + Math.cos(a + 2.6) * head, y1 + Math.sin(a + 2.6) * head], [x1, y1], [x1 + Math.cos(a - 2.6) * head, y1 + Math.sin(a - 2.6) * head]]];
}
// parallel hatching lines across a rectangle (clip them to a shape with ctx.clip())
function hatch(x, y, w, h, o = {}) {
  const ang = o.angle ?? -0.8, gap = o.gap ?? 14, seed = o.seed ?? 1;
  const c = Math.cos(ang), s = Math.sin(ang), cx = x + w / 2, cy = y + h / 2, R = Math.hypot(w, h) / 2, out = [];
  for (let d = -R, i = 0; d <= R; d += gap, i++) {
    const j = (hash(seed + i * 3.1) - 0.5) * gap * 0.5;
    const px = cx - s * (d + j), py = cy + c * (d + j), half = R * (0.92 + 0.08 * hash(seed + i));
    out.push(i % 2 ? [[px + c * half, py + s * half], [px - c * half, py - s * half]] : [[px - c * half, py - s * half], [px + c * half, py + s * half]]);
  }
  return out;
}
// one back-and-forth zigzag that covers a rectangle: a scribble fill
function scribble(x, y, w, h, o = {}) {
  const rows = o.rows ?? 8, seed = o.seed ?? 2, out = [];
  for (let i = 0; i <= rows; i++) {
    const yy = y + (h * i) / rows + (hash(seed + i) - 0.5) * (h / rows) * 0.4;
    out.push(i % 2 ? [x + w + (hash(seed + i * 2) - 0.5) * w * 0.06, yy] : [x + (hash(seed + i * 5) - 0.5) * w * 0.06, yy]);
  }
  return out;
}
// map strokes drawn in a viewBox (default 100×100) into a box, keeping the aspect ratio, centred
function fit(list, box, vb = [100, 100]) {
  const s = Math.min(box.width / vb[0], box.height / vb[1]);
  const ox = box.x + (box.width - vb[0] * s) / 2, oy = box.y + (box.height - vb[1] * s) / 2;
  const map = (pts) => pts.map((p) => [ox + p[0] * s, oy + p[1] * s]);
  return { scale: s, x: ox, y: oy, map, list: list.map((it) => (Array.isArray(it) ? map(it) : { ...it, pts: map(it.pts) })) };
}
function path(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]));
  ctx.closePath();
}

// a yellow pencil whose point sits on the pen tip
function pencil(g, tip, o = {}) {
  if (!tip) return;
  const ctx = o.ctx ?? g.ctx, L = o.size ?? g.vmin * 12, w = L * 0.13;
  const ang = (o.angle ?? -1.05) + 0.06 * Math.sin((g.t ?? 0) * 9);
  ctx.save();
  ctx.translate(tip[0], tip[1]);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.roundRect(L * 0.05, w * 0.1, L, w, w * 0.2); ctx.fill();
  ctx.fillStyle = '#e8c497';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.2, -w / 2); ctx.lineTo(L * 0.2, w / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = o.lead ?? '#2b2b33';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.07, -w * 0.18); ctx.lineTo(L * 0.07, w * 0.18); ctx.closePath(); ctx.fill();
  ctx.fillStyle = o.body ?? '#f2b928';
  ctx.fillRect(L * 0.2, -w / 2, L * 0.62, w);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(L * 0.2, -w / 2, L * 0.62, w * 0.28);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(L * 0.2, w * 0.18, L * 0.62, w * 0.32);
  ctx.fillStyle = '#b9bcc4'; ctx.fillRect(L * 0.82, -w / 2, L * 0.08, w);
  ctx.fillStyle = '#ef8fa0';
  ctx.beginPath(); ctx.roundRect(L * 0.9, -w / 2, L * 0.1, w, [0, w * 0.35, w * 0.35, 0]); ctx.fill();
  ctx.restore();
}

const boil = (g, fps = 8) => (fps > 0 ? Math.floor(((g.clip && g.clip.t) ?? g.t) * fps) : 0);

const INK = { stroke, strokes, boil, hash, noise: noise1, lengthOf, line, arc, circle, bez, spline, rect, arrow, hatch, scribble, fit, path, pencil, styles: Object.keys(STYLES) };

asset({
  kind: 'value',
  title: 'Sketch ink',
  description: 'Hand-drawn stroke engine shared by the sketch assets. stroke(g, points, { width, color, style: ink|pen|pencil|marker, progress, wobble, boil, seed }) draws a wobbly, pressure-tapered ribbon and returns the pen tip; strokes(g, list, o) draws several in sequence with pen lifts. Shape helpers (line, arc, circle, bez, spline, rect, arrow, hatch, scribble, fit, path), boil(g, fps) for the hand-drawn "boil", and pencil(g, tip) draws a pencil cursor at the tip.',
  tags: ['sketch', 'hand-drawn', 'ink', 'stroke', 'foundation', 'draw-on'],
  params: {
    style: { type: 'enum', options: Object.keys(STYLES), default: 'ink', description: 'Stroke style shown in the preview' },
  },
  render() {
    return INK;
  },
  preview(f, p) {
    const { ctx, width: w, height: h } = f;
    ctx.fillStyle = '#f3ecdc';
    ctx.fillRect(0, 0, w, h);
    const b = boil(f, 8), u = Math.min(w, h) / 100, k = f.lib.clamp01(f.progress * 1.25);
    const o = { style: p.style, width: u * 1.6, color: '#1f2a44', boil: b };
    stroke(f, line(w * 0.6, h * 0.74, w * 0.93, h * 0.72), { ...o, style: 'marker', width: u * 9, color: '#ffd84d', progress: k * 3 - 1.2 });
    stroke(f, circle(w * 0.28, h * 0.5, u * 26, { seed: 4 }), { ...o, progress: k * 3 });
    strokes(f, arrow(w * 0.42, h * 0.62, w * 0.7, h * 0.36), { ...o, color: '#e8553e', progress: k * 3 - 1 });
    const tip = strokes(f, [spline([[w * 0.62, h * 0.72], [w * 0.7, h * 0.62], [w * 0.77, h * 0.74], [w * 0.84, h * 0.62], [w * 0.92, h * 0.72]], 10)], { ...o, progress: k * 3 - 2 });
    pencil(f, tip, { size: u * 22 });
  },
});
