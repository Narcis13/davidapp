// Vector drawings from uploaded SVGs (f.svg(name) and f.lib.svg): the paths of a sanitised SVG as
// plain data, drawn with ordinary canvas calls, so it is the same in Node and the browser. Draw it
// whole, recoloured, or drawn on (strokes trace in, fills fade in) with `progress`.
//
//   const logo = f.svg(p.logo);
//   logo.draw(f.ctx, { x: 0, y: 0, width: f.width, height: f.height, progress: f.progress, fill: p.color });
//
// A model is { width, height, viewBox: [x, y, w, h], paths: [{ d: [['M', x, y], ['C', …], ['Z']], fill,
// stroke, strokeWidth, opacity, fillOpacity, strokeOpacity, fillRule, lineCap, lineJoin, m: [a, b, c, d, e, f] }] }.

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

function trace(ctx, cmds) {
  for (const c of cmds) {
    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === 'Q') ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else if (c[0] === 'Z') ctx.closePath();
  }
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
  ctx.save();
  ctx.translate((o.x ?? 0) + (bw - vw * k) / 2 - vx * k, (o.y ?? 0) + (bh - vh * k) / 2 - vy * k);
  ctx.scale(k, k);
  const total = progress < 1 ? model.paths.reduce((s, p) => s + (p.length ?? 0), 0) : 0;
  let before = 0;
  for (const p of model.paths) {
    const fill = p.fill && p.fill !== 'none' ? recolor(o.fill ?? p.fill) : null;
    const stroke = p.stroke && p.stroke !== 'none' ? recolor(o.stroke ?? p.stroke) : null;
    ctx.save();
    ctx.transform(...(p.m ?? [1, 0, 0, 1, 0, 0]));
    ctx.globalAlpha *= p.opacity ?? 1;
    ctx.lineCap = p.lineCap ?? 'butt';
    ctx.lineJoin = p.lineJoin ?? 'miter';
    const sw = (p.strokeWidth ?? 1) * (o.strokeWidth ?? 1);
    if (progress >= 1) {
      ctx.beginPath();
      trace(ctx, p.d);
      // the fill's opacity is set for the fill and the alpha put back as it was (dividing it back fails for 0)
      if (fill) { const alpha = ctx.globalAlpha; ctx.fillStyle = fill; ctx.globalAlpha = alpha * (p.fillOpacity ?? 1); ctx.fill(p.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); ctx.globalAlpha = alpha; }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.globalAlpha *= p.strokeOpacity ?? 1; ctx.stroke(); }
    } else {
      // drawing on: this path's share of the total length traces in, in document order
      const len = p.length ?? 0;
      const shown = Math.min(1, Math.max(0, (progress * total - before) / Math.max(1e-9, len)));
      before += len;
      const fillIn = Math.min(1, Math.max(0, (progress - 2 / 3) * 3));
      if (fill && fillIn > 0) { const alpha = ctx.globalAlpha; ctx.beginPath(); trace(ctx, p.d); ctx.fillStyle = fill; ctx.globalAlpha = alpha * (fillIn * (p.fillOpacity ?? 1)); ctx.fill(p.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); ctx.globalAlpha = alpha; }
      const lineColor = stroke ?? (o.outline !== false ? fill : null);
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
