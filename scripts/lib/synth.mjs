// Builds a synthetic library in a studio: a dozen real template assets (validated, with thumbnails
// and filmstrips), a few uploads, three clips, then `count` rows that reuse the templates' sources
// and pictures with their own names, descriptions, tags, authors, origins, usage, favourites and
// collections. Seeded: the same count makes the same library. Used by scripts/synth-library.mjs and
// the library tests.

import { createHash } from 'node:crypto';
import { createRng } from '../../src/core/rng.js';
import { transaction, now } from '../../src/db/db.js';
import { createCanvas } from '../../src/render/host.js';

/** Returns { made: [{ id, slug }] }. @param {any} studio @param {{ count?: number }} [o] */
export async function buildSynthetic(studio, { count = 5000 } = {}) {
  const rng = createRng(42);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const AUTHOR = 'synth';

  const SHAPES = ['circle', 'square', 'star', 'ring', 'wave', 'grid', 'bars', 'dots', 'stripes', 'diamond', 'blob', 'zigzag'];
  const NOUNS = ['title', 'lower third', 'badge', 'counter', 'chart', 'caption', 'logo', 'divider', 'frame', 'banner', 'callout', 'ticker', 'timeline', 'quote', 'card', 'map', 'backdrop', 'sparkles', 'confetti', 'gradient'];
  const ADJ = ['neon', 'soft', 'bold', 'minimal', 'retro', 'glitchy', 'warm', 'cold', 'paper', 'chrome', 'pastel', 'dark', 'bright', 'hand-drawn', 'geometric', 'organic', 'kinetic', 'calm', 'loud', 'glassy'];
  const TAGS = ['text', 'title', 'background', 'overlay', 'shape', 'motion', 'data', 'chart', 'logo', 'brand', 'social', 'intro', 'outro', 'loop', 'scene', 'neon', 'retro', 'minimal', 'colourful', 'mono', 'vertical-first', 'transition', 'effect', 'audio', 'photo', 'texture', 'kinetic', 'caption', 'stat', 'map'];
  const AUTHORS = ['claude-fable-5-1', 'claude-opus-5-5', 'studio-user', 'mia', 'jon', 'synth'];

  // templates: small real assets whose thumbnails and strips the synthetic rows share
  const templates = [];
  for (const [i, shape] of SHAPES.entries()) {
    const slug = `tpl-${shape}`;
    const r = await studio.library.createAsset({ slug, author: AUTHOR, source: `asset({
    title: 'Template ${shape}',
    description: 'A ${shape} pattern that pulses and turns; one of the synthetic library templates.',
    tags: ['shape', 'template', '${shape}'],
    duration: 3,
    params: { color: { type: 'color', default: '${['#ff5c8a', '#ffd166', '#7cf5c0', '#7b5cff', '#2dd4bf', '#f97316'][i % 6]}' }, count: { type: 'integer', default: ${4 + i}, min: 1, max: 40 } },
    render(f, p) {
      const { ctx, width: w, height: h } = f;
      ctx.fillStyle = '#121220'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color; ctx.lineWidth = Math.min(w, h) * 0.02;
      for (let k = 0; k < p.count; k++) {
        const a = (k / p.count) * Math.PI * 2 + f.t * 0.8, r = Math.min(w, h) * (0.18 + 0.12 * Math.sin(f.t * 2 + k));
        const x = w / 2 + Math.cos(a) * r * 1.4, y = h / 2 + Math.sin(a) * r;
        ctx.beginPath(); ctx.arc(x, y, Math.min(w, h) * 0.03 * (1 + (k % 3)), 0, Math.PI * 2); ${i % 2 ? 'ctx.fill();' : 'ctx.stroke();'}
      }
    },
  });` });
    templates.push(studio.library.versionRow(r.asset.ref));
  }
  // a few uploaded pictures for the image rows
  const pictures = [];
  for (let i = 0; i < 4; i++) {
    const c = createCanvas(320, 180);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 320, 180);
    grad.addColorStop(0, ['#1b1f3b', '#06241f', '#2a0f1f', '#1f1b0a'][i]); grad.addColorStop(1, ['#ff5c8a', '#2dd4bf', '#ffd166', '#7b5cff'][i]);
    g.fillStyle = grad; g.fillRect(0, 0, 320, 180);
    const r = await studio.uploads.upload({ name: `synthetic photo ${i + 1}.png`, data: c.toBuffer('image/png'), author: AUTHOR });
    pictures.push(studio.library.versionRow(r.asset.ref));
  }
  for (const slug of ['launch-teaser', 'quarterly-numbers', 'brand-sting']) await studio.clips.createClip({ slug, title: slug.replace(/-/g, ' '), author: AUTHOR, format: 'vertical', duration: 10 });
  const clipIds = studio.db.prepare('SELECT id FROM clips ORDER BY id').all().map((r) => r.id);

  const db = studio.db;
  const made = [];
  transaction(db, () => {
    const insA = db.prepare('INSERT INTO assets (slug, type, latest_version, forked_from, origin_clip, created_at, needs_description, featured) VALUES (?, ?, 1, NULL, ?, ?, ?, ?)');
    const insV = db.prepare(`INSERT INTO asset_versions (asset_id, version, kind, title, description, tags, duration, formats, schema, uses, deps, source, source_hash, file, mime, meta, thumb, author, note, clip_id, engine, created_at)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)`);
    const insT = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)');
    const insF = db.prepare('INSERT INTO assets_fts (rowid, slug, title, description, tags, source) VALUES (?, ?, ?, ?, ?, ?)');
    const day = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < count; i++) {
      const image = rng() < 0.12;
      const tpl = image ? pick(pictures) : pick(templates);
      const adj = pick(ADJ), noun = pick(NOUNS), shape = pick(SHAPES);
      const title = `${adj[0].toUpperCase()}${adj.slice(1)} ${noun}${rng() < 0.3 ? ` ${shape}` : ''}`;
      const slug = `syn-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`;
      const tags = [...new Set([pick(TAGS), pick(TAGS), noun.split(' ')[0], ...(rng() < 0.4 ? [adj.replace(/[^a-z]/g, '')] : [])])];
      const kind = image ? null : rng() < 0.82 ? 'visual' : pick(['value', 'motion', 'effect', 'transition', 'audio']);
      const description = `A ${adj} ${noun} ${image ? 'picture' : 'asset'} with ${shape} accents, made for ${pick(['social clips', 'explainers', 'launch videos', 'data stories', 'intros', 'tutorials'])}. Synthetic entry ${i}.`;
      const created = new Date(day + Math.floor(rng() * 270 * 86400000)).toISOString();
      const origin = rng() < 0.5 ? pick(clipIds) : null;
      const needs = image && rng() < 0.4 ? 1 : 0;
      const featured = rng() < 0.02 ? 1 : 0;
      const id = insA.run(slug, image ? 'image' : 'function', origin, created, needs, featured).lastInsertRowid;
      const source = image ? null : `// ${title}\n${tpl.source}`;
      insV.run(id, kind, title, description, JSON.stringify(tags), tpl.duration, tpl.formats, tpl.schema, source, source ? createHash('sha1').update(source).digest('hex') : null,
        tpl.file, tpl.mime, tpl.meta, tpl.thumb, pick(AUTHORS), origin, created);
      for (const t of tags) insT.run(id, t);
      insF.run(id, slug, title, description, tags.join(' '), source ?? '');
      made.push({ id, slug });
    }
    // usage: some assets are in clips, a few are favourites, some are in collections
    const vid = db.prepare('SELECT id FROM asset_versions WHERE asset_id = ? AND version = 1');
    const use = db.prepare('INSERT OR IGNORE INTO clip_assets (clip_id, version_id, direct, depth) VALUES (?, ?, 1, 0)');
    const fav = db.prepare('INSERT OR IGNORE INTO favorites (asset_id, created_at) VALUES (?, ?)');
    db.prepare("INSERT OR IGNORE INTO collections (slug, name, created_at) VALUES ('launch-kit', 'Launch kit', ?), ('data-story', 'Data story', ?), ('brand', 'Brand', ?)").run(now(), now(), now());
    const cols = db.prepare('SELECT id FROM collections ORDER BY id').all().map((r) => r.id);
    const col = db.prepare('INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, added_at) VALUES (?, ?, ?)');
    for (const m of made) {
      const r = rng();
      if (r < 0.15) use.run(pick(clipIds), vid.get(m.id).id);
      if (r < 0.04) use.run(pick(clipIds), vid.get(m.id).id);
      if (rng() < 0.03) fav.run(m.id, now());
      if (rng() < 0.05) col.run(pick(cols), m.id, now());
    }
  });
  return { made };
}
