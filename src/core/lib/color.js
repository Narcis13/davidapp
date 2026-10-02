// Color helpers: parse CSS colors, mix them, change alpha. Results are CSS strings.

import { clamp01 } from './math.js';

const hex2 = (s) => parseInt(s, 16);

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(), transparent → [r, g, b, a]. */
export function parse(color) {
  if (Array.isArray(color)) return color;
  const c = String(color).trim().toLowerCase();
  if (c === 'transparent') return [0, 0, 0, 0];
  if (c[0] === '#') {
    const h = c.slice(1);
    if (h.length === 3 || h.length === 4) return [hex2(h[0] + h[0]), hex2(h[1] + h[1]), hex2(h[2] + h[2]), h.length === 4 ? hex2(h[3] + h[3]) / 255 : 1];
    if (h.length === 6 || h.length === 8) return [hex2(h.slice(0, 2)), hex2(h.slice(2, 4)), hex2(h.slice(4, 6)), h.length === 8 ? hex2(h.slice(6, 8)) / 255 : 1];
  }
  const m = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    const num = (s, scale = 1) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
    const a = parts[3] === undefined ? 1 : num(parts[3], 1);
    if (m[1].startsWith('rgb')) return [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255), a];
    return [...hslToRgb(parseFloat(parts[0]), num(parts[1], 1), num(parts[2], 1)), a];
  }
  throw new Error(`Cannot parse color ${JSON.stringify(color)}`);
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** @param {number[]} c [r, g, b, a] */
export const css = (c) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+clamp01(c[3] ?? 1).toFixed(4)})`;
/** Linear mix of two colors in sRGB: t=0 → a, t=1 → b. */
export const mix = (a, b, t) => {
  const A = parse(a), B = parse(b);
  return css([0, 1, 2, 3].map((i) => A[i] + (B[i] - A[i]) * t));
};
/** The same color with its alpha multiplied by `a`. */
export const alpha = (color, a) => {
  const c = parse(color);
  return css([c[0], c[1], c[2], c[3] * a]);
};
export const lighten = (color, amount) => mix(color, '#ffffff', amount);
export const darken = (color, amount) => mix(color, '#000000', amount);
export const hsl = (h, s, l, a = 1) => css([...hslToRgb(h, s, l), a]);
/** Relative luminance 0..1. */
export const luminance = (color) => {
  const [r, g, b] = parse(color).map((v) => v / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** Black or white, whichever reads better on the given color. */
export const onColor = (color, dark = '#0b0b12', light = '#ffffff') => (luminance(color) > 0.4 ? dark : light);
