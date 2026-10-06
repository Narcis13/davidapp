// Uploads: PNG, JPEG, WebP and SVG files dropped into the studio become image assets.
//
// The type is read from the bytes, not the name. A file already in the library (same SHA-256)
// is not added twice. An SVG is sanitised (see svg.js), rasterised once at a generous size, and
// kept next to its raster with a vector model for f.svg(); the raster is what both the preview and
// the render draw, so they agree. Every upload gets its size, a dominant palette and a thumbnail,
// and lands on the "needs description" list until the agent (over MCP, seeing the image) writes
// its title, description, tags and suggested uses.

import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { createCanvas, loadImage } from '../render/host.js';
import { json } from '../db/db.js';
import { StudioError, SLUG_RE } from './library.js';
import { sanitizeSvg, vectorModel, SvgError } from './svg.js';

export const MAX_UPLOAD = 25_000_000;

/** What a file is, from its first bytes: { kind, ext } or null. */
export function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { kind: 'png', ext: '.png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'jpeg', ext: '.jpg' };
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { kind: 'webp', ext: '.webp' };
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  // an XML prologue (declaration, comments, a DOCTYPE, even one with an internal subset) then <svg>;
  // whether that prologue is acceptable is the sanitiser's call, with a clearer message
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[\s\S]*?>\s*(\]\s*>\s*)?)?<svg[\s>]/i.test(head) || (/^(<\?xml|<!DOCTYPE\s+svg)/i.test(head) && /<svg[\s>]/i.test(head))) return { kind: 'svg', ext: '.svg' };
  return null;
}

/** The dominant colours of an image (median cut over a small copy), most common first, as hex. */
export function palette(img, count = 5) {
  const k = Math.min(1, 64 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < count) {
    let best = -1, bestScore = 0, channel = 0;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        const score = (hi - lo) * Math.sqrt(b.length);
        if (score > bestScore) { bestScore = score; best = bi; channel = ch; }
      }
    });
    if (best < 0 || bestScore === 0) break;
    const b = [...boxes[best]].sort((x, y) => x[channel] - y[channel] || x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    const mid = Math.floor(b.length / 2);
    boxes = [...boxes.slice(0, best), b.slice(0, mid), b.slice(mid), ...boxes.slice(best + 1)];
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return boxes.filter((b) => b.length)
    .map((b) => ({ n: b.length, c: [0, 1, 2].map((ch) => b.reduce((s, p) => s + p[ch], 0) / b.length) }))
    .sort((a, b) => b.n - a.n)
    .map((x) => `#${hex(x.c[0])}${hex(x.c[1])}${hex(x.c[2])}`);
}

const slugify = (name) => basename(name, extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'upload';
const titleOf = (name) => basename(name, extname(name)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) || 'Upload';

export function createUploads(ctx, library) {
  const { db } = ctx;

  function uniqueSlug(name) {
    const base = slugify(name).padEnd(2, '0');
    let slug = base, n = 2;
    while (library.versionRow(slug)) slug = `${base}-${n++}`;
    if (!SLUG_RE.test(slug)) throw new StudioError(`Could not make an asset name from "${name}"`);
    return slug;
  }

  /**
   * Add one uploaded file → { asset, duplicate, removed (what the SVG sanitiser dropped) }.
   * @param {{ name: string, data: Buffer, author: string, forClip?: string, slug?: string }} o
   */
  async function upload({ name, data, author, forClip, slug: wanted }) {
    if (!Buffer.isBuffer(data) || !data.length) throw new StudioError('The file is empty');
    if (data.length > MAX_UPLOAD) throw new StudioError(`The file is ${data.length} bytes; uploads are at most ${MAX_UPLOAD}`);
    const type = sniff(data);
    if (!type) throw new StudioError(`"${name}" is not a PNG, JPEG, WebP or SVG file`, 'unsupported');
    const hash = createHash('sha256').update(data).digest('hex');
    const dup = db.prepare("SELECT a.slug, v.version FROM assets a JOIN asset_versions v ON v.asset_id = a.id WHERE a.type = 'image' AND json_extract(v.meta, '$.hash') = ? ORDER BY v.id LIMIT 1").get(hash);
    if (dup) return { asset: library.getAsset(`${dup.slug}@${dup.version}`, { includeSource: false }), duplicate: true, removed: [] };
    let raster = data, ext = type.ext, removed = [], vector = null, sidecar, natural = null;
    if (type.kind === 'svg') {
      let clean;
      try { clean = sanitizeSvg(data.toString('utf8')); } catch (e) {
        if (e instanceof SvgError) throw new StudioError(`The SVG was rejected: ${e.message}`, 'rejected');
        throw e;
      }
      removed = clean.removed;
      vector = vectorModel(clean.tree);
      natural = { width: vector.width, height: vector.height };
      const img = await loadImage(Buffer.from(clean.svg)).catch(() => { throw new StudioError('The SVG could not be drawn after sanitising', 'rejected'); });
      // rasterised once, big enough to scale down cleanly in any clip
      const k = Math.min(2048 / Math.max(img.width, img.height), Math.max(1, 1024 / Math.max(img.width, img.height)) * 2);
      const c = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      raster = c.toBuffer('image/png');
      ext = '.png';
      sidecar = { ext: '.svg', data: Buffer.from(clean.svg) };
      if (vector.paths.length > 4000 || JSON.stringify(vector).length > 1_500_000) vector = null;
    }
    const img = await loadImage(raster).catch(() => { throw new StudioError(`"${name}" could not be decoded as an image`, 'rejected'); });
    const slug = wanted ?? uniqueSlug(name);
    const colours = palette(img);
    const kindName = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', svg: 'SVG' }[type.kind];
    const r = await library.addFileAsset({
      slug, type: 'image', data: raster, ext, author, forClip, license: 'uploaded by the user',
      title: titleOf(name), tags: ['upload', type.kind === 'svg' ? 'svg' : 'photo'],
      description: `An uploaded ${kindName} image, "${basename(name)}" (${natural ? `${natural.width}×${natural.height}` : `${img.width}×${img.height}`}), waiting for a description.`,
      meta: { hash, originalName: basename(name), format: type.kind, palette: colours, natural, sanitized: type.kind === 'svg' ? { removed } : undefined, vector },
      needsDescription: true, sidecar,
    });
    return { asset: r.asset, duplicate: false, removed };
  }

  /** Uploads waiting for a description, oldest first. */
  function undescribed(limit = 20) {
    return db.prepare("SELECT a.slug FROM assets a WHERE a.needs_description = 1 ORDER BY a.id LIMIT ?").all(Math.min(100, Math.max(1, limit)))
      .map((r) => library.getAsset(r.slug, { includeSource: false }));
  }

  /** The agent's description of an upload: title, description, tags, suggested uses. Takes it off the list. */
  function describe({ slug, title, description, tags, uses, author }) {
    const row = library.requireVersion(slug);
    if (row.type !== 'image') throw new StudioError(`"${slug}" is a ${row.type} asset; describe_asset is for uploaded images`);
    if (!description) throw new StudioError('description is required');
    const meta = json(row.meta, {});
    const keep = [...new Set([...(tags ?? []), meta.format === 'svg' ? 'svg' : null, 'upload'].filter(Boolean))];
    return library.setMetadata({ slug: row.slug, title, description, tags: keep, uses, author });
  }

  return { upload, undescribed, describe };
}
