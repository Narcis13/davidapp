// Procedural 3D for assets (f.lib.solid): meshes built from code, a camera, lights, and a software
// rasterizer with a depth buffer. Everything is plain arithmetic on typed arrays, so a 3D frame is
// the same bytes in the Node render and in the browser preview, and no GPU or WebGL is involved.
//
//   const S = f.lib.solid;
//   const ball = S.icosphere(2, 1);
//   S.render(f, {
//     camera: { position: [0, 1.5, 5], target: [0, 0, 0], fov: 40 },
//     lights: [{ type: 'ambient', intensity: 0.35 }, { type: 'directional', direction: [-1, -2, -1.5], intensity: 0.9 }],
//     objects: [{ mesh: ball, rotation: [0, f.t * 40, 0], color: '#ff5c8a', shading: 'flat' }],
//   });
//
// A mesh is { positions: number[] (x, y, z …), indices: number[] (triangles, counter-clockwise
// when seen from outside), colors?: number[] (r, g, b per vertex, 0–255) }. Units are arbitrary;
// y is up, the camera looks along -z of its own space.

import { parse as parseColor } from './color.js';

// ── vectors and matrices (4×4, row-major, column vectors) ───────────────────────────────────

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d) => (d * Math.PI) / 180;

export function multiply(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return o;
}
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const translation = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
export const scaling = (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export function rotationX(deg) { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
export function rotationY(deg) { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
export function rotationZ(deg) { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

/** Model matrix: scale, then rotate (x, y, z in degrees, applied in that order), then move. */
export function compose({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  const s = Array.isArray(scale) ? scaling(scale[0], scale[1], scale[2]) : scaling(scale);
  const r = multiply(rotationZ(rotation[2] ?? 0), multiply(rotationY(rotation[1] ?? 0), rotationX(rotation[0] ?? 0)));
  return multiply(translation(position[0], position[1], position[2]), multiply(r, s));
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], x[1], x[2], -dot(x, eye), y[0], y[1], y[2], -dot(y, eye), z[0], z[1], z[2], -dot(z, eye), 0, 0, 0, 1];
}

const apply = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];

// ── meshes ────────────────────────────────────────────────────────────────────────────────────

/** A mesh from flat arrays. */
export const mesh = (positions, indices, colors = null) => ({ positions: [...positions], indices: [...indices], colors: colors ? [...colors] : null });

/** Several meshes as one (vertex colours kept; a mesh without them gets white). */
export function merge(...list) {
  const out = { positions: [], indices: [], colors: list.some((m) => m.colors) ? [] : null };
  for (const m of list) {
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    for (const i of m.indices) out.indices.push(i + base);
    if (out.colors) out.colors.push(...(m.colors ?? m.positions.map(() => 255)));
  }
  return out;
}

/** A mesh with every vertex moved by a matrix (compose({ … }) or any 4×4). */
export function transform(m, matrix) {
  const p = [];
  for (let i = 0; i < m.positions.length; i += 3) p.push(...apply(matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
  return { positions: p, indices: [...m.indices], colors: m.colors ? [...m.colors] : null };
}

/** The same mesh painted one colour (CSS colour or [r, g, b]). */
export function paint(m, color) {
  const c = rgb(color);
  const colors = [];
  for (let i = 0; i < m.positions.length; i += 3) colors.push(c[0], c[1], c[2]);
  return { ...m, colors };
}

export function box(w = 1, h = 1, d = 1) {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces = [
    [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]],
    [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]],
    [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]],
  ];
  const positions = [], indices = [];
  for (const f of faces) {
    const b = positions.length / 3;
    for (const p of f) positions.push(...p);
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { positions, indices, colors: null };
}

/** A sphere made of near-equal triangles: detail 0 is an icosahedron, each step splits every triangle in four. */
export function icosphere(detail = 1, radius = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < Math.min(5, Math.max(0, Math.round(detail))); d++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(key)) { verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])); cache.set(key, verts.length - 1); }
      return cache.get(key);
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  verts = verts.map((v) => [v[0] * radius, v[1] * radius, v[2] * radius]);
  return { positions: verts.flat(), indices: faces.flat(), colors: null };
}

/** A solid of revolution: profile [[radius, y], …] from bottom to top, turned around the y axis. */
export function lathe(profile, segments = 24) {
  const positions = [], indices = [];
  const n = profile.length;
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
    for (const [r, y] of profile) positions.push(r * si, y, r * c);
  }
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i, b = (s + 1) * n + i;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  return { positions, indices, colors: null };
}

export const cylinder = (radiusTop = 0.5, radiusBottom = 0.5, height = 1, segments = 24) => {
  const h = height / 2;
  return merge(lathe([[0, -h], [radiusBottom, -h], [radiusTop, h], [0, h]], segments));
};

/** A ring: R is the distance to the tube's centre, r the tube's radius. */
export function torus(R = 1, r = 0.35, segments = 32, tube = 12) {
  const positions = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * Math.PI * 2;
    for (let j = 0; j <= tube; j++) {
      const v = (j / tube) * Math.PI * 2;
      positions.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < tube; j++) {
      const a = i * (tube + 1) + j, b = (i + 1) * (tube + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, indices, colors: null };
}

/** Triangles covering a simple polygon [[x, y], …] (ear clipping; either winding). */
export function triangulate(poly) {
  const pts = poly.map((p) => [p[0], p[1]]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = pts.map((_, i) => i);
  if (area < 0) idx.reverse();
  const out = [];
  const inside = (p, a, b, c) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/** A flat shape [[x, y], …] given depth along z (centred), with caps and walls. */
export function extrude(shape, depth = 0.3) {
  const n = shape.length, z = depth / 2;
  const positions = [], indices = [];
  for (const [x, y] of shape) positions.push(x, y, z);
  for (const [x, y] of shape) positions.push(x, y, -z);
  const tri = triangulate(shape);
  for (let i = 0; i < tri.length; i += 3) { indices.push(tri[i], tri[i + 1], tri[i + 2]); indices.push(n + tri[i], n + tri[i + 2], n + tri[i + 1]); }
  let area = 0;
  for (let i = 0; i < n; i++) { const a = shape[i], b = shape[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, b = positions.length / 3;
    positions.push(shape[i][0], shape[i][1], z, shape[j][0], shape[j][1], z, shape[j][0], shape[j][1], -z, shape[i][0], shape[i][1], -z);
    if (ccw) indices.push(b, b + 3, b + 2, b, b + 2, b + 1); else indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { positions, indices, colors: null };
}

/**
 * Low-poly terrain: a grid of cols × rows cells over size × size, height(x, z) per vertex (use
 * f.lib.fbm with f.rng for hills), coloured by color(height) when given.
 * @param {{ size?: number, cols?: number, rows?: number, height?: (x: number, z: number) => number, color?: ((y: number) => any) | null }} [o]
 */
export function terrain({ size = 4, cols = 32, rows = 32, height = () => 0, color = null } = {}) {
  const positions = [], indices = [], colors = color ? [] : null;
  const h = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { const x = (c / cols - 0.5) * size, z = (r / rows - 0.5) * size; h.push([x, height(x, z), z]); }
  // every triangle gets its own vertices, so each face keeps one flat colour
  const at = (r, c) => h[r * (cols + 1) + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tris = (r + c) % 2 ? [[at(r, c), at(r + 1, c), at(r, c + 1)], [at(r, c + 1), at(r + 1, c), at(r + 1, c + 1)]] : [[at(r, c), at(r + 1, c + 1), at(r, c + 1)], [at(r, c), at(r + 1, c), at(r + 1, c + 1)]];
      for (const t of tris) {
        const b = positions.length / 3;
        for (const p of t) positions.push(...p);
        indices.push(b, b + 1, b + 2);
        if (colors) { const k = rgb(color((t[0][1] + t[1][1] + t[2][1]) / 3)); for (let i = 0; i < 3; i++) colors.push(k[0], k[1], k[2]); }
      }
    }
  }
  return { positions, indices, colors };
}

/** Copies of a mesh: list of { position, rotation, scale, color } (instanced particles). */
export function instances(m, list) {
  return merge(...list.map((it) => { const t = transform(m, compose(it)); return it.color ? paint(t, it.color) : t; }));
}

// 5×7 block font for 3D type: each glyph is seven rows of five bits
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01111 10000 10000 10000 10000 10000 01111', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000', G: '01111 10000 10000 10011 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '11111 00100 00100 00100 00100 00100 11111', J: '00111 00010 00010 00010 00010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001', S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10011 10101 10101 10101 11001 01110', 1: '00100 01100 00100 00100 00100 00100 01110', 2: '01110 10001 00001 00110 01000 10000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110', 6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  ' ': '00000 00000 00000 00000 00000 00000 00000', '.': '00000 00000 00000 00000 00000 01100 01100', '!': '00100 00100 00100 00100 00100 00000 00100', '?': '01110 10001 00001 00110 00100 00000 00100',
  '-': '00000 00000 00000 11111 00000 00000 00000', ':': '00000 01100 01100 00000 01100 01100 00000', "'": '00100 00100 01000 00000 00000 00000 00000', ',': '00000 00000 00000 00000 01100 00100 01000',
  '+': '00000 00100 00100 11111 00100 00100 00000', '%': '11001 11010 00010 00100 01000 01011 10011', '/': '00001 00010 00010 00100 01000 01000 10000', '&': '01100 10010 10100 01000 10101 10010 01101',
};

/**
 * Block letters in 3D: each lit cell of a 5×7 font is a cube, with the faces between neighbours
 * left out. size: the height of a capital; centred on the origin. Unknown characters are blank.
 */
export function text(str, { size = 1, depth = 0.25, spacing = 1 } = {}) {
  const chars = [...String(str).toUpperCase()];
  const cell = size / 7, cols = chars.length * 6 - 1;
  const lit = (x, y) => {
    if (x < 0 || y < 0 || y > 6) return false;
    const ci = Math.floor(x / 6), cx = x % 6;
    if (ci >= chars.length || cx === 5) return false;
    const g = FONT[chars[ci]];
    return !!g && g.split(' ')[y][cx] === '1';
  };
  const positions = [], indices = [];
  const ox = (-cols / 2) * cell * spacing, oy = 3.5 * cell, z = depth / 2;
  const quad = (a, b, c, d) => { const base = positions.length / 3; positions.push(...a, ...b, ...c, ...d); indices.push(base, base + 1, base + 2, base, base + 2, base + 3); };
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < cols; x++) {
      if (!lit(x, y)) continue;
      const x0 = ox + x * cell * spacing, x1 = x0 + cell * spacing, y1 = oy - y * cell, y0 = y1 - cell;
      quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
      quad([x1, y0, -z], [x0, y0, -z], [x0, y1, -z], [x1, y1, -z]);
      if (!lit(x + 1, y)) quad([x1, y0, z], [x1, y0, -z], [x1, y1, -z], [x1, y1, z]);
      if (!lit(x - 1, y)) quad([x0, y0, -z], [x0, y0, z], [x0, y1, z], [x0, y1, -z]);
      if (!lit(x, y - 1)) quad([x0, y1, z], [x1, y1, z], [x1, y1, -z], [x0, y1, -z]);
      if (!lit(x, y + 1)) quad([x0, y0, -z], [x1, y0, -z], [x1, y0, z], [x0, y0, z]);
    }
  }
  return { positions, indices, colors: null };
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────

function rgb(c) {
  if (Array.isArray(c)) return c;
  const p = parseColor(c ?? '#ffffff');
  return [p[0], p[1], p[2]];
}

/** Clip a polygon of view-space points against the near plane z = -near. */
function clipNear(poly, near) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a.p[2] <= -near, inb = b.p[2] <= -near;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (-near - a.p[2]) / (b.p[2] - a.p[2]);
      out.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, -near], c: [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t] });
    }
  }
  return out;
}

/**
 * Render a scene into a frame: f (or any { ctx, width, height, offscreen }) gets the picture drawn
 * at (0, 0) with transparency where nothing is. Returns { triangles, drawn } counts.
 *
 * scene: {
 *   camera: { position, target, up, fov (degrees, vertical), near, far },
 *   lights: [{ type: 'ambient' | 'directional' | 'point', color, intensity, direction (where it shines), position }],
 *   objects: [{ mesh, position, rotation, scale, color, shading: 'flat' | 'smooth' | 'toon', steps, emissive, doubleSided }],
 *   background: null | colour, fog: { color, near, far }, supersample: 1 | 2 | 3,
 * }
 */
export function render(f, scene) {
  const W = Math.max(1, Math.ceil(f.width)), H = Math.max(1, Math.ceil(f.height));
  const ss = Math.max(1, Math.min(3, Math.round(scene.supersample ?? 2)));
  const w = W * ss, h = H * ss;
  const cam = scene.camera ?? {};
  const eye = cam.position ?? [0, 0, 5];
  const view = lookAt(eye, cam.target ?? [0, 0, 0], cam.up ?? [0, 1, 0]);
  const near = cam.near ?? 0.1, far = cam.far ?? 100;
  const fy = 1 / Math.tan(rad(cam.fov ?? 45) / 2), fx = fy / (W / H);
  const color = new Float32Array(w * h * 4);
  const depth = new Float32Array(w * h);
  const bg = scene.background ? rgb(scene.background) : null;
  if (bg) for (let i = 0; i < w * h; i++) { color[i * 4] = bg[0]; color[i * 4 + 1] = bg[1]; color[i * 4 + 2] = bg[2]; color[i * 4 + 3] = 1; }
  const lights = (scene.lights ?? [{ type: 'ambient', intensity: 0.35 }, { type: 'directional', direction: [-1, -2, -1.5], intensity: 0.9 }]).map((l) => ({
    type: l.type ?? 'directional', color: rgb(l.color ?? '#ffffff').map((v) => v / 255), intensity: l.intensity ?? 1,
    dir: l.direction ? norm([-l.direction[0], -l.direction[1], -l.direction[2]]) : null, pos: l.position ?? null,
  }));
  const fog = scene.fog ? { c: rgb(scene.fog.color), near: scene.fog.near ?? 5, far: scene.fog.far ?? 20 } : null;
  let triangles = 0, drawn = 0;

  const shade = (n, center, base, o) => {
    let r = 0, g = 0, b = 0;
    for (const l of lights) {
      let k = l.intensity;
      if (l.type !== 'ambient') {
        const L = l.type === 'point' ? norm(sub(l.pos, center)) : l.dir;
        let d = Math.max(0, dot(n, L));
        if (o.shading === 'toon') { const steps = o.steps ?? 3; d = Math.ceil(d * steps - 1e-9) / steps; }
        k *= d;
      }
      r += k * l.color[0]; g += k * l.color[1]; b += k * l.color[2];
    }
    const e = o.emissive ?? 0;
    return [base[0] * (r + e), base[1] * (g + e), base[2] * (b + e)];
  };

  for (const o of scene.objects ?? []) {
    const m = o.mesh;
    if (!m?.positions || !m?.indices) throw new Error('solid.render: every object needs a mesh (made with f.lib.solid)');
    const model = compose(o);
    const mv = multiply(view, model);
    const tint = rgb(o.color ?? '#ffffff');
    const P = m.positions, I = m.indices, C = m.colors;
    const world = [], viewPos = [];
    for (let i = 0; i < P.length; i += 3) { const p = [P[i], P[i + 1], P[i + 2]]; world.push(apply(model, p)); viewPos.push(apply(mv, p)); }
    // smooth shading lights each vertex with the average normal of its faces
    let vertexNormals = null;
    if (o.shading === 'smooth') {
      vertexNormals = world.map(() => [0, 0, 0]);
      for (let t = 0; t < I.length; t += 3) {
        const n = cross(sub(world[I[t + 1]], world[I[t]]), sub(world[I[t + 2]], world[I[t]]));
        for (let k = 0; k < 3; k++) { const vn = vertexNormals[I[t + k]]; vn[0] += n[0]; vn[1] += n[1]; vn[2] += n[2]; }
      }
      vertexNormals = vertexNormals.map(norm);
    }
    const albedo = (vi) => (C ? [(C[vi * 3] / 255) * tint[0], (C[vi * 3 + 1] / 255) * tint[1], (C[vi * 3 + 2] / 255) * tint[2]] : tint);
    for (let t = 0; t < I.length; t += 3) {
      triangles++;
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const n = norm(cross(sub(world[b], world[a]), sub(world[c], world[a])));
      const center = [(world[a][0] + world[b][0] + world[c][0]) / 3, (world[a][1] + world[b][1] + world[c][1]) / 3, (world[a][2] + world[b][2] + world[c][2]) / 3];
      if (!o.doubleSided && dot(n, sub(eye, center)) <= 0) continue;
      const facing = o.doubleSided && dot(n, sub(eye, center)) < 0 ? [-n[0], -n[1], -n[2]] : n;
      let vs;
      if (o.shading === 'smooth') vs = [a, b, c].map((vi) => ({ p: viewPos[vi], c: shade(vertexNormals[vi], world[vi], albedo(vi), o) }));
      else {
        const base = C ? [0, 1, 2].map((k) => (albedo(a)[k] + albedo(b)[k] + albedo(c)[k]) / 3) : tint;
        const col = shade(facing, center, base, o);
        vs = [a, b, c].map((vi) => ({ p: viewPos[vi], c: col }));
      }
      const poly = clipNear(vs, near);
      if (poly.length < 3) continue;
      // project: x, y in supersampled pixels, plus 1/z for depth and perspective-correct colour
      const pr = poly.map((v) => {
        const iz = 1 / -v.p[2];
        return { x: (v.p[0] * fx * iz * 0.5 + 0.5) * w, y: (0.5 - v.p[1] * fy * iz * 0.5) * h, iz, z: -v.p[2], c: v.c };
      });
      for (let k = 1; k < pr.length - 1; k++) if (raster(pr[0], pr[k], pr[k + 1])) drawn++;
    }
  }

  function raster(v0, v1, v2) {
    let area = (v1.x - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (v1.y - v0.y);
    if (Math.abs(area) < 1e-12) return false;
    if (area < 0) { const tmp = v1; v1 = v2; v2 = tmp; area = -area; }
    const minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x))), maxX = Math.min(w - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)));
    const minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y))), maxY = Math.min(h - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)));
    if (minX > maxX || minY > maxY) return false;
    let any = false;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = (v2.x - v1.x) * (py - v1.y) - (v2.y - v1.y) * (px - v1.x);
        const w1 = (v0.x - v2.x) * (py - v2.y) - (v0.y - v2.y) * (px - v2.x);
        const w2 = (v1.x - v0.x) * (py - v0.y) - (v1.y - v0.y) * (px - v0.x);
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const b0 = w0 / area, b1 = w1 / area, b2 = w2 / area;
        const iz = b0 * v0.iz + b1 * v1.iz + b2 * v2.iz;
        const zz = 1 / iz;
        if (zz < near || zz > far) continue;
        const di = y * w + x;
        if (depth[di] !== 0 && iz <= depth[di]) continue;
        depth[di] = iz;
        // perspective-correct colour
        const k0 = (b0 * v0.iz) / iz, k1 = (b1 * v1.iz) / iz, k2 = (b2 * v2.iz) / iz;
        let r = v0.c[0] * k0 + v1.c[0] * k1 + v2.c[0] * k2, g = v0.c[1] * k0 + v1.c[1] * k1 + v2.c[1] * k2, bl = v0.c[2] * k0 + v1.c[2] * k1 + v2.c[2] * k2;
        if (fog) { const t = Math.min(1, Math.max(0, (zz - fog.near) / (fog.far - fog.near))); r += (fog.c[0] - r) * t; g += (fog.c[1] - g) * t; bl += (fog.c[2] - bl) * t; }
        const ci = di * 4;
        color[ci] = r; color[ci + 1] = g; color[ci + 2] = bl; color[ci + 3] = 1;
        any = true;
      }
    }
    return any;
  }

  // resolve the supersampled buffer: average coverage (alpha) and colour
  const layer = f.offscreen(W, H);
  const img = layer.ctx.createImageData(W, H);
  const out = img.data, n = ss * ss;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        let i = ((y * ss + sy) * w + x * ss) * 4;
        for (let sx = 0; sx < ss; sx++, i += 4) { const ca = color[i + 3]; r += color[i] * ca; g += color[i + 1] * ca; b += color[i + 2] * ca; a += ca; }
      }
      const o = (y * W + x) * 4;
      if (a) { out[o] = Math.round(Math.min(255, r / a)); out[o + 1] = Math.round(Math.min(255, g / a)); out[o + 2] = Math.round(Math.min(255, b / a)); }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  layer.ctx.putImageData(img, 0, 0);
  f.ctx.drawImage(layer.canvas, 0, 0);
  return { triangles, drawn };
}
