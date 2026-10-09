// Contrast of drawn text against what is behind it (WCAG 2 contrast ratio), from two renders of the same
// frame: one with the text, one without (f.lib.inspect.suppress). The text's colour is read from the pixels
// the text changed; the background is every pixel of the frame without the text inside the text's box, and
// the ratio reported is against the worst of them (a low percentile, so one stray pixel does not decide).

/** sRGB channel 0..255 → linear. */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const LUT = Float64Array.from({ length: 256 }, (_, i) => lin(i));
/** Relative luminance of an sRGB colour. */
export const luminance = (r, g, b) => 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];
/** WCAG contrast ratio of two luminances. */
export const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Contrast of one text box. a: RGBA with the text, b: RGBA without it (same size w × h), box in frame pixels.
 * → { ratio (at the worst `percentile` of the background), min, textColor, background (the worst pixel), textPixels } or null
 * when the text changed too few pixels to judge (hidden, off-frame, fully transparent).
 */
export function boxContrast(a, b, w, h, box, { percentile = 0.05 } = {}) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.width)), y1 = Math.min(h, Math.ceil(box.y + box.height));
  if (x1 <= x0 || y1 <= y0) return null;
  // the text's own pixels: where it changed the frame most (the core of the glyphs, not their antialiased edges)
  let maxDiff = 0;
  const diffs = new Float32Array((x1 - x0) * (y1 - y0));
  for (let y = y0, k = 0; y < y1; y++) for (let x = x0; x < x1; x++, k++) {
    const i = (y * w + x) * 4;
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    diffs[k] = d;
    if (d > maxDiff) maxDiff = d;
  }
  if (maxDiff < 24) return null;
  const cut = maxDiff * 0.6;
  const textL = [];
  let tr = 0, tg = 0, tb = 0;
  // the background as a luminance histogram (with one pixel kept per bin for its colour)
  const BINS = 1024;
  const counts = new Uint32Array(BINS), sample = new Int32Array(BINS).fill(-1), binL = new Float64Array(BINS);
  let total = 0;
  for (let y = y0, k = 0; y < y1; y++) for (let x = x0; x < x1; x++, k++) {
    const i = (y * w + x) * 4;
    const l = luminance(b[i], b[i + 1], b[i + 2]);
    const bin = Math.min(BINS - 1, Math.floor(l * BINS));
    if (counts[bin]++ === 0) { sample[bin] = i; binL[bin] = l; }
    total++;
    if (diffs[k] >= cut) { textL.push(luminance(a[i], a[i + 1], a[i + 2])); tr += a[i]; tg += a[i + 1]; tb += a[i + 2]; }
  }
  if (textL.length < 4) return null;
  textL.sort((p, q) => p - q);
  const tl = textL[Math.floor(textL.length / 2)];
  const n = textL.length;
  // each background luminance's contrast with the text, worst first; the worst few pixels decide
  const bins = [];
  for (let k = 0; k < BINS; k++) if (counts[k]) bins.push([ratio(tl, binL[k]), k]);
  bins.sort((p, q) => p[0] - q[0]);
  const want = Math.floor(total * percentile);
  let seen = 0, worst = bins[bins.length - 1];
  for (const bn of bins) { seen += counts[bn[1]]; if (seen > want) { worst = bn; break; } }
  const wi = sample[worst[1]];
  return {
    ratio: Math.round(worst[0] * 100) / 100, min: Math.round(bins[0][0] * 100) / 100,
    textColor: hex(Math.round(tr / n), Math.round(tg / n), Math.round(tb / n)), background: hex(b[wi], b[wi + 1], b[wi + 2]), textPixels: n,
  };
}

/** A small greyscale copy of an RGBA frame (cols wide), for comparing frames cheaply. */
export function thumbGray(rgba, w, h, cols = 64) {
  const rows = Math.max(1, Math.round((h / w) * cols));
  const out = new Uint8Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const xa = Math.floor((tx * w) / cols), xb = Math.max(xa + 1, Math.floor(((tx + 1) * w) / cols));
    const ya = Math.floor((ty * h) / rows), yb = Math.max(ya + 1, Math.floor(((ty + 1) * h) / rows));
    let s = 0, c = 0;
    for (let y = ya; y < yb; y += 2) for (let x = xa; x < xb; x += 2) { const i = (y * w + x) * 4; s += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]; c++; }
    out[ty * cols + tx] = Math.round(s / c);
  }
  return out;
}

/** Mean absolute difference of two greyscale thumbnails (0..255). */
export const grayDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
/** Standard deviation of a greyscale thumbnail: near 0 for an empty frame. */
export const grayStd = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length); };
