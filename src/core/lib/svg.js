// Vector drawings from uploaded SVGs (f.svg(name) and f.lib.svg): the paths of a sanitised SVG as
// plain data, drawn with ordinary canvas calls, so it is the same in Node and the browser. Draw it
// whole, recoloured, or drawn on (strokes trace in, fills fade in) with `progress`.
//
//   const logo = f.svg(p.logo);
//   logo.draw(f.ctx, { x: 0, y: 0, width: f.width, height: f.height, progress: f.progress, fill: p.color });
//
// A model is { width, height, viewBox: [x, y, w, h], paths: [{ d: [['M', x, y], ['C', …], ['Z']], fill,
// stroke, strokeWidth, opacity, fillOpacity, strokeOpacity, fillRule, lineCap, lineJoin, m: [a, b, c, d, e, f] }] }.
//
// A model with `v: 2` (made since gradients were kept) may also have `gradients: { id: { type: 'linear' | 'radial',
// units: 'box' | 'user', m, stops: [[offset, colour]], x1 y1 x2 y2 | cx cy r fx fy } }`; a path's fill or stroke
// 'url(#id)' names one, and `bb` is the path's bounding box [x0, y0, x1, y1] (what a 'box' gradient is laid on).
// A path of such a model may also carry `miter` and `dash` / `dashOffset`. A model without `v` is drawn exactly as before.

const NUMS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Parse SVG path data into absolute M, L, C, Q and Z commands. Throws on malformed data. */
export function parsePath(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null;
  const num = () => { const v = Number(tokens[i++]); if (!Number.isFinite(v)) throw new Error(`bad path data near "${tokens.slice(i - 2, i + 2).join(' ')}"`); return v; };
  // an arc's two flags are one character each, and minified paths run them into the next number: "a5 5 0 0110 10"
  const flag = () => {
    const tok = tokens[i] ?? '';
    if (tok[0] !== '0' && tok[0] !== '1') throw new Error(`bad path data near "${tokens.slice(Math.max(0, i - 1), i + 3).join(' ')}": an arc flag is 0 or 1`);
    if (tok.length > 1) tokens[i] = tok.slice(1); else i++;
    return Number(tok[0]);
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error('path data must start with a command');
    const C = cmd.toUpperCase(), rel = cmd !== C;
    if (C === 'Z') { out.push(['Z']); x = sx; y = sy; lastC = lastQ = null; if (/[A-Za-z]/.test(tokens[i] ?? 'Z')) continue; cmd = null; continue; }
    if (NUMS[C] === undefined) throw new Error(`unknown path command ${cmd}`);
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; out.push(['M', x, y]); cmd = rel ? 'l' : 'L'; lastC = lastQ = null; break;
      case 'L': x = ox + num(); y = oy + num(); out.push(['L', x, y]); lastC = lastQ = null; break;
      case 'H': x = ox + num(); out.push(['L', x, y]); lastC = lastQ = null; break;
      case 'V': y = oy + num(); out.push(['L', x, y]); lastC = lastQ = null; break;
      case 'C': { const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(); x = ox + num(); y = oy + num(); out.push(['C', x1, y1, x2, y2, x, y]); lastC = [x2, y2]; lastQ = null; break; }
      case 'S': { const x1 = lastC ? 2 * x - lastC[0] : x, y1 = lastC ? 2 * y - lastC[1] : y; const x2 = ox + num(), y2 = oy + num(); x = ox + num(); y = oy + num(); out.push(['C', x1, y1, x2, y2, x, y]); lastC = [x2, y2]; lastQ = null; break; }
      case 'Q': { const x1 = ox + num(), y1 = oy + num(); x = ox + num(); y = oy + num(); out.push(['Q', x1, y1, x, y]); lastQ = [x1, y1]; lastC = null; break; }
      case 'T': { const x1 = lastQ ? 2 * x - lastQ[0] : x, y1 = lastQ ? 2 * y - lastQ[1] : y; x = ox + num(); y = oy + num(); out.push(['Q', x1, y1, x, y]); lastQ = [x1, y1]; lastC = null; break; }
      case 'A': {
        const rx = num(), ry = num(), phi = num(), large = flag(), sweep = flag();
        const x2 = ox + num(), y2 = oy + num();
        for (const c of arcToCubics(x, y, rx, ry, phi, large, sweep, x2, y2)) out.push(c);
        x = x2; y = y2; lastC = lastQ = null;
        break;
      }
    }
  }
  return out;
}

/** An elliptical arc (SVG endpoint parameterisation) as cubic Bézier commands. */
export function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [['L', x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let k = Math.sqrt(Math.max(0, num / den));
  if (!!large === !!sweep) k = -k;
  const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= Math.PI * 2;
  if (sweep && dt < 0) dt += Math.PI * 2;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segs, out = [];
  const pt = (a) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  const der = (a) => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
  const kappa = (4 / 3) * Math.tan(step / 4);
  for (let s = 0; s < segs; s++) {
    const a0 = t1 + s * step, a1 = a0 + step;
    const p0 = pt(a0), p1 = pt(a1), d0 = der(a0), d1 = der(a1);
    out.push(['C', p0[0] + kappa * d0[0], p0[1] + kappa * d0[1], p1[0] - kappa * d1[0], p1[1] - kappa * d1[1], p1[0], p1[1]]);
  }
  return out;
}

/** Commands → polylines (one per subpath), for lengths and drawing on. */
export function flatten(cmds, steps = 16) {
  const lines = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0;
  for (const c of cmds) {
    if (c[0] === 'M') { cur = [[c[1], c[2]]]; lines.push(cur); x = sx = c[1]; y = sy = c[2]; continue; }
    if (!cur) { cur = [[x, y]]; lines.push(cur); }
    if (c[0] === 'L') { cur.push([c[1], c[2]]); x = c[1]; y = c[2]; }
    else if (c[0] === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([u * u * u * x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]]);
      }
      x = c[5]; y = c[6];
    } else if (c[0] === 'Q') {
      for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; cur.push([u * u * x + 2 * u * t * c[1] + t * t * c[3], u * u * y + 2 * u * t * c[2] + t * t * c[4]]); }
      x = c[3]; y = c[4];
    } else if (c[0] === 'Z') { cur.push([sx, sy]); x = sx; y = sy; cur = null; }
  }
  return lines;
}

const lineLength = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };

// `t`: an optional matrix the points go through (a radial gradient is drawn in its own space)
function trace(ctx, cmds, t) {
  if (t) {
    const at = (x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
    for (const c of cmds) {
      if (c[0] === 'M') ctx.moveTo(...at(c[1], c[2]));
      else if (c[0] === 'L') ctx.lineTo(...at(c[1], c[2]));
      else if (c[0] === 'C') ctx.bezierCurveTo(...at(c[1], c[2]), ...at(c[3], c[4]), ...at(c[5], c[6]));
      else if (c[0] === 'Q') ctx.quadraticCurveTo(...at(c[1], c[2]), ...at(c[3], c[4]));
      else if (c[0] === 'Z') ctx.closePath();
    }
    return;
  }
  for (const c of cmds) {
    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === 'Q') ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else if (c[0] === 'Z') ctx.closePath();
  }
}

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/**
 * A canvas style for a model gradient on a path with bounding box `bb`: { style, m, inv, k } or null when
 * it paints nothing (a box gradient on a flat shape). `m`, when set, is the matrix to draw through and `inv` the
 * one the path goes through first (a radial gradient is an ellipse in the path's space); `k` scales a stroke's width.
 * A linear gradient needs no transform: any affine map of one is another linear gradient.
 */
function gradientPaint(ctx, g, bb, recolor) {
  if (!g.stops?.length) return null;
  const stops = g.stops.map(([at, c]) => [at, recolor(c)]);
  const solid = { style: stops[stops.length - 1][1], m: null, inv: null, k: 1 };
  if (stops.length === 1) return solid;
  let m = g.m ?? [1, 0, 0, 1, 0, 0];
  if (g.units !== 'user') {
    if (!bb || !(bb[2] - bb[0] > 0) || !(bb[3] - bb[1] > 0)) return null;
    m = mul([bb[2] - bb[0], 0, 0, bb[3] - bb[1], bb[0], bb[1]], m);
  }
  const inv = invert(m);
  if (!inv) return null;
  let grad;
  if (g.type === 'radial') {
    if (!(g.r > 0)) return solid;
    grad = ctx.createRadialGradient(g.fx, g.fy, 0, g.cx, g.cy, g.r);
  } else {
    const dx = g.x2 - g.x1, dy = g.y2 - g.y1, len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return solid;
    // t = a·x + b·y + c in the path's space; the canvas axis with the same t runs along (a, b) / (a² + b²)
    const a = (inv[0] * dx + inv[1] * dy) / len2, b = (inv[2] * dx + inv[3] * dy) / len2, c = ((inv[4] - g.x1) * dx + (inv[5] - g.y1) * dy) / len2;
    const n = a * a + b * b;
    if (!(n > 0)) return solid;
    const x0 = (-c * a) / n, y0 = (-c * b) / n;
    grad = ctx.createLinearGradient(x0, y0, x0 + a / n, y0 + b / n);
  }
  for (const [at, c] of stops) grad.addColorStop(Math.min(1, Math.max(0, at)), c);
  return g.type === 'radial' ? { style: grad, m, inv, k: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) } : { style: grad, m: null, inv: null, k: 1 };
}

/**
 * Draw a model into a box (contain-fitted, centred). Options:
 *   x, y, width, height   the box (default: the model's own size at 0, 0)
 *   progress              0..1: strokes trace in over the whole span and fills fade in over the last third (default 1)
 *   fill, stroke          replace every fill / stroke colour; colors: { '#old': '#new' } replaces some
 *   strokeWidth           multiplies stroke widths; outline: true draws fills as outlines while they trace
 */
export function draw(ctx, model, o = {}) {
  const [vx, vy, vw, vh] = model.viewBox ?? [0, 0, model.width, model.height];
  const bw = o.width ?? model.width, bh = o.height ?? model.height;
  const k = Math.min(bw / vw, bh / vh);
  const progress = Math.min(1, Math.max(0, o.progress ?? 1));
  const recolor = (c) => (c && o.colors?.[String(c).toLowerCase()]) ?? c;
  // gradients only exist in models made since `v: 2`; an older model is drawn by the code below it exactly as it always was
  const grads = model.v >= 2 && model.gradients ? model.gradients : null;
  const paintOf = (v, over) => {
    if (!v || v === 'none') return null;
    if ((over === undefined || over === null) && grads && typeof v === 'string' && v.startsWith('url(#')) { const id = v.slice(5, -1); if (Object.hasOwn(grads, id)) return grads[id]; }
    return recolor(over ?? v);
  };
  // a gradient as a plain colour: its first stop (what traces in while a drawing is drawn on)
  const flat = (v) => (v && typeof v === 'object' ? recolor(v.stops?.[0]?.[1]) ?? null : v);
  ctx.save();
  ctx.translate((o.x ?? 0) + (bw - vw * k) / 2 - vx * k, (o.y ?? 0) + (bh - vh * k) / 2 - vy * k);
  ctx.scale(k, k);
  const total = progress < 1 ? model.paths.reduce((s, p) => s + (p.length ?? 0), 0) : 0;
  let before = 0;
  for (const p of model.paths) {
    const fill = paintOf(p.fill, o.fill);
    const stroke = paintOf(p.stroke, o.stroke);
    ctx.save();
    ctx.transform(...(p.m ?? [1, 0, 0, 1, 0, 0]));
    ctx.globalAlpha *= p.opacity ?? 1;
    ctx.lineCap = p.lineCap ?? 'butt';
    ctx.lineJoin = p.lineJoin ?? 'miter';
    if (grads) ctx.miterLimit = p.miter ?? 4;
    const sw = (p.strokeWidth ?? 1) * (o.strokeWidth ?? 1);
    const rule = p.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
    // a gradient fill or stroke: the path again, through the gradient's own space when it needs one
    const gradient = (g, alpha, line) => {
      const gp = gradientPaint(ctx, g, p.bb, recolor);
      if (!gp) return;
      ctx.save();
      if (gp.m) ctx.transform(...gp.m);
      ctx.beginPath();
      trace(ctx, p.d, gp.inv);
      ctx.globalAlpha *= alpha;
      if (line) { ctx.strokeStyle = gp.style; ctx.lineWidth = sw / gp.k; ctx.stroke(); } else { ctx.fillStyle = gp.style; ctx.fill(rule); }
      ctx.restore();
    };
    if (progress >= 1) {
      ctx.beginPath();
      trace(ctx, p.d);
      // the fill's opacity is set for the fill and the alpha put back as it was (dividing it back fails for 0)
      if (typeof fill === 'string') { const alpha = ctx.globalAlpha; ctx.fillStyle = fill; ctx.globalAlpha = alpha * (p.fillOpacity ?? 1); ctx.fill(rule); ctx.globalAlpha = alpha; }
      else if (fill) gradient(fill, p.fillOpacity ?? 1, false);
      if (grads && p.dash) { ctx.setLineDash(p.dash); ctx.lineDashOffset = p.dashOffset ?? 0; }
      if (typeof stroke === 'string') { if (fill && typeof fill !== 'string') { ctx.beginPath(); trace(ctx, p.d); } ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.globalAlpha *= p.strokeOpacity ?? 1; ctx.stroke(); }
      else if (stroke) gradient(stroke, p.strokeOpacity ?? 1, true);
    } else {
      // drawing on: this path's share of the total length traces in, in document order
      const len = p.length ?? 0;
      const shown = Math.min(1, Math.max(0, (progress * total - before) / Math.max(1e-9, len)));
      before += len;
      const fillIn = Math.min(1, Math.max(0, (progress - 2 / 3) * 3));
      if (typeof fill === 'string' && fillIn > 0) { const alpha = ctx.globalAlpha; ctx.beginPath(); trace(ctx, p.d); ctx.fillStyle = fill; ctx.globalAlpha = alpha * (fillIn * (p.fillOpacity ?? 1)); ctx.fill(rule); ctx.globalAlpha = alpha; }
      else if (fill && fillIn > 0) gradient(fill, fillIn * (p.fillOpacity ?? 1), false);
      const lineColor = flat(stroke ?? (o.outline !== false ? fill : null));
      if (lineColor && shown > 0) {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = stroke ? sw : Math.max(1, 1.5 / k) * (o.strokeWidth ?? 1);
        let left = shown * len;
        ctx.beginPath();
        for (const line of flatten(p.d)) {
          if (left <= 0) break;
          ctx.moveTo(line[0][0], line[0][1]);
          for (let i = 1; i < line.length && left > 0; i++) {
            const seg = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
            if (seg <= left) { ctx.lineTo(line[i][0], line[i][1]); left -= seg; } else { const t = left / seg; ctx.lineTo(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t); left = 0; }
          }
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Total length of a path's commands (in its own units), for drawing on. */
export const pathLength = (cmds) => flatten(cmds).reduce((s, l) => s + lineLength(l), 0);
