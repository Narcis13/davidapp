// Pixel effects for `effect` assets (f.lib.fx). Everything here is plain arithmetic on RGBA bytes,
// so an effect does the same thing in the Node render and in the browser preview; canvas filters
// (ctx.filter) differ between the two and are not used. Big blurs run on a downsampled copy, so a
// 1080p frame stays fast.
//
//   const img = fx.read(f.source);        // the layer's pixels (RGBA, not premultiplied)
//   fx.glow(img, { radius: 24, strength: 0.8 });
//   fx.write(f.ctx, img);
//
// An image here is { data: Uint8ClampedArray, width, height } (an ImageData works too).

import { createRng } from '../rng.js';
import { parse as parseColor } from './color.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** A copy of a layer's pixels ({ canvas, ctx, width, height } or a context). */
export function read(layer) {
  const ctx = layer.ctx ?? layer;
  const c = ctx.canvas;
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Put pixels on a context at (x, y). */
export function write(ctx, img, x = 0, y = 0) {
  if (globalThis.ImageData && img instanceof globalThis.ImageData) return ctx.putImageData(img, x, y);
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  ctx.putImageData(out, x, y);
}

export const create = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
export const clone = (img) => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

function premultiply(d) {
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a < 255) { d[i] = Math.round((d[i] * a) / 255); d[i + 1] = Math.round((d[i + 1] * a) / 255); d[i + 2] = Math.round((d[i + 2] * a) / 255); } }
}
function unpremultiply(d) {
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a && a < 255) { d[i] = clamp255(Math.round((d[i] * 255) / a)); d[i + 1] = clamp255(Math.round((d[i + 1] * 255) / a)); d[i + 2] = clamp255(Math.round((d[i + 2] * 255) / a)); } }
}

/** Box-average downsample by an integer factor. */
export function downsample(img, k) {
  if (k <= 1) return clone(img);
  const w = Math.max(1, Math.floor(img.width / k)), h = Math.max(1, Math.floor(img.height / k));
  const out = create(w, h), s = img.data, d = out.data, n = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = 0; yy < k; yy++) {
        let i = ((y * k + yy) * img.width + x * k) * 4;
        for (let xx = 0; xx < k; xx++, i += 4) { r += s[i]; g += s[i + 1]; b += s[i + 2]; a += s[i + 3]; }
      }
      const o = (y * w + x) * 4;
      d[o] = Math.round(r / n); d[o + 1] = Math.round(g / n); d[o + 2] = Math.round(b / n); d[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Bilinear resample to width × height. */
export function resize(img, width, height) {
  const out = create(width, height), s = img.data, d = out.data;
  const sx = img.width / width, sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.min(img.height - 1, Math.floor(fy)), y1 = Math.min(img.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.min(img.width - 1, Math.floor(fx)), x1 = Math.min(img.width - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * img.width + x0) * 4, b = (y0 * img.width + x1) * 4, c = (y1 * img.width + x0) * 4, e = (y1 * img.width + x1) * 4;
      const o = (y * width + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = s[a + k] + (s[b + k] - s[a + k]) * tx, bot = s[c + k] + (s[e + k] - s[c + k]) * tx;
        d[o + k] = Math.round(top + (bot - top) * ty);
      }
    }
  }
  return out;
}

function boxPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4, div = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 4 : line * 4;
    for (let k = 0; k < 4; k++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step + k];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + k] = Math.round(acc / div);
        acc += src[base + Math.min(len - 1, i + r + 1) * step + k] - src[base + Math.max(0, i - r) * step + k];
      }
    }
  }
}

/** Gaussian-like blur (three box passes, premultiplied so edges don't darken). In place; radius in px. */
export function blur(img, radius) {
  const r = Math.max(0, radius);
  if (r < 0.5) return img;
  // a big radius blurs a smaller copy: the same look, a fraction of the work
  const k = r >= 24 ? 4 : r >= 8 ? 2 : 1;
  const work = k > 1 ? downsample(img, k) : img;
  const d = work.data;
  premultiply(d);
  const tmp = new Uint8ClampedArray(d.length);
  const rr = Math.max(1, Math.round(r / k / 1.73));
  for (let p = 0; p < 3; p++) { boxPass(d, tmp, work.width, work.height, rr, true); boxPass(tmp, d, work.width, work.height, rr, false); }
  unpremultiply(d);
  if (k > 1) img.data.set(resize(work, img.width, img.height).data);
  return img;
}

/** Bright parts, blurred and added back: a glow. strength 0..2; threshold 0..1 (luma that starts to glow). */
export function glow(img, { radius = 20, strength = 0.8, threshold = 0.55, color = null } = {}) {
  const k = radius >= 16 ? 4 : 2;
  const small = downsample(img, k), d = small.data;
  const tint = color ? parseColor(color) : null;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const m = Math.max(0, (l - threshold) / Math.max(1e-6, 1 - threshold)) * (d[i + 3] / 255);
    if (tint) { d[i] = tint[0] * m; d[i + 1] = tint[1] * m; d[i + 2] = tint[2] * m; } else { d[i] *= m; d[i + 1] *= m; d[i + 2] *= m; }
    d[i + 3] = 255;
  }
  blur(small, radius / k);
  const big = resize(small, img.width, img.height).data, s = img.data;
  for (let i = 0; i < s.length; i += 4) {
    const gr = big[i] * strength, gg = big[i + 1] * strength, gb = big[i + 2] * strength;
    // screen the glow over the pixel; where the layer was clear, the glow brings its own alpha
    s[i] = clamp255(Math.round(255 - ((255 - s[i]) * (255 - Math.min(255, gr))) / 255));
    s[i + 1] = clamp255(Math.round(255 - ((255 - s[i + 1]) * (255 - Math.min(255, gg))) / 255));
    s[i + 2] = clamp255(Math.round(255 - ((255 - s[i + 2]) * (255 - Math.min(255, gb))) / 255));
    s[i + 3] = Math.max(s[i + 3], clamp255(Math.round(Math.max(gr, gg, gb))));
  }
  return img;
}

/** Film grain: seeded noise, the same every time for the same seed. amount 0..1. */
export function grain(img, { amount = 0.15, seed = 1, mono = true, size = 1 } = {}) {
  const rng = createRng(seed);
  const s = img.data, w = img.width, h = img.height, k = Math.max(1, Math.round(size));
  const cols = Math.ceil(w / k), rows = Math.ceil(h / k);
  const field = new Float32Array(cols * rows * (mono ? 1 : 3));
  for (let i = 0; i < field.length; i++) field[i] = (rng() + rng() + rng() - 1.5) * 2 * amount * 128;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, c = (Math.floor(y / k) * cols + Math.floor(x / k)) * (mono ? 1 : 3);
      s[o] = clamp255(Math.round(s[o] + field[c]));
      s[o + 1] = clamp255(Math.round(s[o + 1] + field[mono ? c : c + 1]));
      s[o + 2] = clamp255(Math.round(s[o + 2] + field[mono ? c : c + 2]));
    }
  }
  return img;
}

/** Darken (or tint) towards the edges. amount 0..1, radius: where it starts (fraction of the half-diagonal). */
export function vignette(img, { amount = 0.5, radius = 0.55, softness = 0.45, color = '#000000' } = {}) {
  const [cr, cg, cb] = parseColor(color);
  const s = img.data, w = img.width, h = img.height, cx = w / 2, cy = h / 2, half = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / half;
      const v = Math.min(1, Math.max(0, (dd - radius) / Math.max(1e-6, softness)));
      const m = v * v * (3 - 2 * v) * amount;
      if (!m) continue;
      const o = (y * w + x) * 4;
      s[o] = Math.round(s[o] + (cr - s[o]) * m); s[o + 1] = Math.round(s[o + 1] + (cg - s[o + 1]) * m); s[o + 2] = Math.round(s[o + 2] + (cb - s[o + 2]) * m);
    }
  }
  return img;
}

/** Colour grade through a lookup table: exposure (stops), contrast, saturation, temperature, tint, gamma, lift. */
export function grade(img, { exposure = 0, contrast = 0, saturation = 0, temperature = 0, tint = 0, gamma = 1, lift = 0 } = {}) {
  const lut = new Uint8ClampedArray(256);
  const gain = 2 ** exposure, c = 1 + contrast;
  for (let i = 0; i < 256; i++) {
    let v = (i / 255) * gain;
    v = (v - 0.5) * c + 0.5;
    v = lift + v * (1 - lift);
    v = Math.max(0, v) ** (1 / gamma);
    lut[i] = clamp255(Math.round(v * 255));
  }
  const s = img.data, sat = 1 + saturation;
  const tr = 1 + temperature * 0.12, tb = 1 - temperature * 0.12, tg = 1 + tint * 0.08;
  for (let i = 0; i < s.length; i += 4) {
    let r = lut[s[i]] * tr, g = lut[s[i + 1]] * tg, b = lut[s[i + 2]] * tb;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    s[i] = clamp255(Math.round(r)); s[i + 1] = clamp255(Math.round(g)); s[i + 2] = clamp255(Math.round(b));
  }
  return img;
}

/** Map brightness onto two colours (shadows → dark, highlights → light). mix 0..1. */
export function duotone(img, { dark = '#1b1f3b', light = '#ffd166', mix = 1, contrast = 0 } = {}) {
  const D = parseColor(dark), L = parseColor(light), s = img.data, c = 1 + contrast;
  for (let i = 0; i < s.length; i += 4) {
    let l = (0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2]) / 255;
    l = Math.min(1, Math.max(0, (l - 0.5) * c + 0.5));
    for (let k = 0; k < 3; k++) s[i + k] = clamp255(Math.round(s[i + k] + (D[k] + (L[k] - D[k]) * l - s[i + k]) * mix));
  }
  return img;
}

/** Split red and blue apart along an angle (degrees): chromatic aberration. amount in px. */
export function chromatic(img, { amount = 6, angle = 0, radial = true } = {}) {
  const src = clone(img).data, s = img.data, w = img.width, h = img.height;
  const ax = Math.cos((angle * Math.PI) / 180), ay = Math.sin((angle * Math.PI) / 180), cx = w / 2, cy = h / 2, half = Math.hypot(cx, cy);
  const at = (x, y, k) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + k];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = radial ? Math.hypot(x - cx, y - cy) / half : 1;
      const dx = Math.round(ax * amount * f), dy = Math.round(ay * amount * f);
      const o = (y * w + x) * 4;
      s[o] = at(x + dx, y + dy, 0);
      s[o + 2] = at(x - dx, y - dy, 2);
      s[o + 3] = Math.max(s[o + 3], at(x + dx, y + dy, 3), at(x - dx, y - dy, 3));
    }
  }
  return img;
}

/** Move pixels by a field: field(x, y) → [dx, dy] in px. Nearest-neighbour, so it is exact everywhere. */
export function displace(img, field) {
  const src = clone(img).data, s = img.data, w = img.width, h = img.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [dx, dy] = field(x, y);
      const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx))), sy = Math.min(h - 1, Math.max(0, Math.round(y + dy)));
      const o = (y * w + x) * 4, i = (sy * w + sx) * 4;
      s[o] = src[i]; s[o + 1] = src[i + 1]; s[o + 2] = src[i + 2]; s[o + 3] = src[i + 3];
    }
  }
  return img;
}

/** Big square pixels of the given size. */
export function pixelate(img, size = 12) {
  const k = Math.max(1, Math.round(size));
  const small = downsample(img, k), s = img.data, d = small.data, w = img.width;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < w; x++) {
      const i = (Math.min(small.height - 1, Math.floor(y / k)) * small.width + Math.min(small.width - 1, Math.floor(x / k))) * 4, o = (y * w + x) * 4;
      s[o] = d[i]; s[o + 1] = d[i + 1]; s[o + 2] = d[i + 2]; s[o + 3] = d[i + 3];
    }
  }
  return img;
}

/** Horizontal scanlines: every `spacing` px a line darkened by strength 0..1. */
export function scanlines(img, { spacing = 4, strength = 0.25, offset = 0 } = {}) {
  const s = img.data, w = img.width, k = 1 - strength, sp = Math.max(2, Math.round(spacing));
  for (let y = 0; y < img.height; y++) {
    if ((y + Math.round(offset)) % sp) continue;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; s[o] = Math.round(s[o] * k); s[o + 1] = Math.round(s[o + 1] * k); s[o + 2] = Math.round(s[o + 2] * k); }
  }
  return img;
}

/** Blend `top` over `img` with an opacity (normal alpha compositing, in place). */
export function over(img, top, opacity = 1) {
  const s = img.data, t = top.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = (t[i + 3] / 255) * opacity;
    if (!a) continue;
    const b = s[i + 3] / 255, out = a + b * (1 - a);
    for (let k = 0; k < 3; k++) s[i + k] = clamp255(Math.round((t[i + k] * a + s[i + k] * b * (1 - a)) / Math.max(1e-6, out)));
    s[i + 3] = clamp255(Math.round(out * 255));
  }
  return img;
}
