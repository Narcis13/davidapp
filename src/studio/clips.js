// Clips: declarative compositions whose asset references are pinned to exact versions when the
// clip is saved, so an old clip keeps rendering the same frames after its assets move on.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, FORMATS, SAMPLE_RATE, makeRef, parseRef } from '../core/engine.js';
import { normalizeComposition, itemsOf, reformat } from '../core/composition.js';
import { mapParams, resolveParams, walkParams } from '../core/schema.js';
import { hashSeed } from '../core/rng.js';
import { encodeWav, detectBeats } from '../render/wav.js';
import { ffmpegPath, run } from '../render/ffmpeg.js';
import { json, now, transaction } from '../db/db.js';
import { SLUG_RE, StudioError } from './library.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** Write a cache file so that nobody can read it half-written. */
function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function createClips(ctx, library) {
  const { db, dataDir, pool } = ctx;
  const audioDir = join(dataDir, 'cache', 'audio');
  mkdirSync(audioDir, { recursive: true });
  const stmts = new Map();
  const q = (sql) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };

  /**
   * Validate a composition against the library and pin every reference.
   * Returns { composition, refs (pinned refs to bundle), fonts (font asset refs) }. Throws StudioError listing every problem.
   */
  /** @param {any} input @param {{ repin?: true | string[] }} [o] */
  function prepare(input, { repin } = {}) {
    const { composition, errors } = normalizeComposition(input);
    if (errors.length) throw new StudioError(`The composition is invalid:\n- ${errors.map((e) => `${e.path}: ${e.message}`).join('\n- ')}`, 'invalid', { errors });
    const problems = [];
    const refs = new Set(), fonts = new Set();
    const pin = (ref, where) => {
      let wanted = ref, row;
      try {
        if (repin) {
          const { slug } = parseRef(ref);
          if (repin === true || repin.includes(slug)) wanted = slug;
        }
        row = library.versionRow(wanted);
      } catch (e) {
        problems.push(`${where}: ${e.message}`);
        return null;
      }
      if (!row) { problems.push(`${where}: no asset "${wanted}" in the library`); return null; }
      return row;
    };
    for (const { track, item } of itemsOf(composition)) {
      const where = `item "${item.id}"`;
      const row = pin(item.asset, where);
      if (!row) continue;
      item.asset = makeRef(row.slug, row.version);
      refs.add(item.asset);
      if (track.type === 'audio') {
        if (!(row.type === 'sound' || (row.type === 'function' && row.kind === 'audio'))) problems.push(`${where}: ${item.asset} is a ${row.kind ?? row.type} asset; an audio track takes audio or sound assets`);
      } else if (!(row.type === 'function' && row.kind === 'visual')) {
        problems.push(`${where}: ${item.asset} is a ${row.kind ?? row.type} asset; a ${track.type} track takes visual assets`);
      }
      if (row.type !== 'function') { if (Object.keys(item.params).length) problems.push(`${where}: ${row.type} assets take no params`); continue; }
      const schema = json(row.schema, {});
      for (const e of resolveParams(schema, item.params, { strict: true }).errors) problems.push(`${where}: params.${e.path}: ${e.message}`);
      item.params = mapParams(schema, item.params, ['asset', 'image'], (value, def) => {
        const dep = pin(value, `${where}: params`);
        if (!dep) return value;
        if (def.type === 'image' && dep.type !== 'image') problems.push(`${where}: params: "${value}" is a ${dep.type} asset where an image is expected`);
        if (def.type === 'asset' && (dep.type !== 'function' || (def.kind && dep.kind !== def.kind))) problems.push(`${where}: params: "${value}" is a ${dep.kind ?? dep.type} asset where a ${def.kind ?? 'function'} asset is expected`);
        const pinned = makeRef(dep.slug, dep.version);
        refs.add(pinned);
        return pinned;
      });
      walkParams(schema, item.params, ['font'], (family) => {
        const ref = library.fontRef(family);
        if (ref) fonts.add(ref);
        else problems.push(`${where}: params: unknown font family "${family}" (available: ${library.fontFamilies().join(', ')})`);
      });
    }
    if (problems.length) throw new StudioError(`The composition is invalid:\n- ${problems.join('\n- ')}`, 'invalid', { problems });
    return { composition, refs: [...refs], fonts: [...fonts] };
  }

  // ── audio: synthesize each audio item once, cache the WAV, find the beats ────────────────

  async function decodeMono(path) {
    const r = await run(ffmpegPath(), ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1']);
    if (r.code !== 0) throw new StudioError(`Could not decode ${path}: ${r.stderr.trim()}`);
    return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  }

  /** → { inputs: [{ path, start, duration, gain, fadeIn, fadeOut, id }], beats: [seconds] } */
  async function prepareAudio(composition) {
    const items = [];
    for (const { track, item } of itemsOf(composition)) if (track.type === 'audio' && !track.hidden) items.push(item);
    const explicit = items.some((it) => it.beats !== undefined);
    const inputs = [];
    let beats = [];
    for (const [i, item] of items.entries()) {
      const row = library.requireVersion(item.asset);
      const wantBeats = explicit ? item.beats === true : i === 0;
      let path, beatFile;
      if (row.type === 'sound') {
        path = library.absFile(row);
        beatFile = join(audioDir, `${sha1(`${item.asset}|${item.duration}`)}.beats.json`);
        if (wantBeats && !existsSync(beatFile)) {
          const mono = await decodeMono(path);
          writeAtomic(beatFile, JSON.stringify(detectBeats(mono.subarray(0, Math.round(item.duration * SAMPLE_RATE)), SAMPLE_RATE)));
        }
      } else {
        const seed = hashSeed(composition.seed, item.id);
        // assets named in the item's params are part of what the synth needs
        const extra = [];
        walkParams(json(row.schema, {}), item.params, ['asset', 'image'], (value) => { if (parseRef(value).version !== null) extra.push(value); });
        const b = library.bundle([item.asset, ...extra]);
        const key = sha1(JSON.stringify([ENGINE_VERSION, Object.keys(b.assets).sort(), item.asset, item.params, item.duration, seed]));
        path = join(audioDir, `${key}.wav`);
        beatFile = join(audioDir, `${key}.beats.json`);
        if (!existsSync(path)) {
          const r = await pool.run('audio', { ref: item.asset, params: item.params, duration: item.duration, seed }, { bundle: b, timeout: 120000 });
          const left = new Float32Array(r.left), right = new Float32Array(r.right);
          writeAtomic(beatFile, JSON.stringify(detectBeats(left, SAMPLE_RATE)));
          writeAtomic(path, encodeWav(left, right, SAMPLE_RATE));
        }
      }
      inputs.push({ id: item.id, path, start: item.start, duration: item.duration, gain: item.gain ?? 1, fadeIn: item.fadeIn ?? 0, fadeOut: item.fadeOut ?? 0 });
      if (wantBeats) beats = beats.concat(json(readFileSync(beatFile, 'utf8'), []).map((t) => Math.round((t + item.start) * 1000) / 1000));
    }
    beats.sort((a, b) => a - b);
    return { inputs, beats };
  }

  const bundles = new Map();
  /** Everything a worker needs to render the (pinned) composition: { bundle, audio }. */
  async function bundleFor(composition) {
    const key = sha1(JSON.stringify(composition));
    const hit = bundles.get(key);
    if (hit) return hit;
    const refs = new Set();
    for (const { track, item } of itemsOf(composition)) {
      if (track.type === 'audio') continue;
      refs.add(item.asset);
      const row = library.requireVersion(item.asset);
      walkParams(json(row.schema, {}), item.params, ['asset', 'image'], (value) => { if (parseRef(value).version !== null) refs.add(value); });
    }
    const audio = await prepareAudio(composition);
    const bundle = library.bundle([...refs], { composition, beats: audio.beats });
    const out = { bundle, audio };
    if (bundles.size > 12) bundles.delete(bundles.keys().next().value);
    bundles.set(key, out);
    return out;
  }

  /** Draw a sample of frames (first, middle and last frame of every visual item) to catch run-time errors. */
  async function check(composition) {
    const { bundle } = await bundleFor(composition);
    const fps = composition.fps;
    const total = Math.round(composition.duration * fps);
    const frames = new Set();
    for (const { track, item } of itemsOf(composition)) {
      if (track.type === 'audio') continue;
      const a = Math.round(item.start * fps), b = Math.min(total, Math.round((item.start + item.duration) * fps)) - 1;
      for (const f of [a, Math.round((a + b) / 2), b]) if (f >= 0 && f < total) frames.add(f);
    }
    const list = [...frames].sort((x, y) => x - y);
    const step = Math.max(1, Math.ceil(list.length / 40));
    const picked = list.filter((_, i) => i % step === 0);
    const t0 = performance.now();
    for (const frame of picked) {
      try {
        await pool.run('clipFrame', { frame, output: 'none' }, { bundle, timeout: 30000 });
      } catch (e) {
        throw new StudioError(`The composition failed to draw frame ${frame} (${(frame / fps).toFixed(2)}s): ${e.message}`, 'rejected', { frame, logs: e.logs });
      }
    }
    return { framesChecked: picked.length, msPerFrame: Math.round((performance.now() - t0) / Math.max(1, picked.length)) };
  }

  // ── storage ───────────────────────────────────────────────────────────────────────────────

  function writeUsage(clipId, refs, fonts) {
    const c = library.closure(refs);
    q('DELETE FROM clip_assets WHERE clip_id = ?').run(clipId);
    const ins = q('INSERT OR REPLACE INTO clip_assets (clip_id, version_id, direct, depth) VALUES (?, ?, ?, ?)');
    for (const { row, depth, direct } of c.versions.values()) {
      ins.run(clipId, row.version_id, direct ? 1 : 0, depth);
      // an asset nobody claimed is first produced by the first clip that uses it
      if (row.origin_clip === null) q('UPDATE assets SET origin_clip = ? WHERE id = ? AND origin_clip IS NULL').run(clipId, row.asset_id);
    }
    for (const ref of fonts) ins.run(clipId, library.requireVersion(ref).version_id, 0, 1);
  }

  /** @param {any} row @param {{ withComposition?: boolean }} [o] */
  function shape(row, { withComposition = true } = {}) {
    return {
      slug: row.slug, title: row.title, description: row.description,
      format: row.format, width: row.width, height: row.height, fps: row.fps, duration: row.duration,
      revision: row.revision, author: row.author,
      remixedFrom: library.clipSlug(row.remixed_from),
      createdAt: row.created_at, updatedAt: row.updated_at,
      composition: withComposition ? json(row.composition) : undefined,
    };
  }

  const clipRow = (slug) => {
    const row = q('SELECT * FROM clips WHERE slug = ?').get(slug);
    if (!row) throw new StudioError(`No clip named "${slug}". Use list_clips to see what exists.`, 'not_found');
    return row;
  };

  const emptyComposition = ({ format, width, height, fps, duration, background, seed }) => ({ format, width, height, fps: fps ?? 30, duration: duration ?? 30, background, seed, tracks: [] });

  /** Create a clip. Without a composition it starts empty, so assets can be created "for" it first. @param {any} o */
  async function createClip({ slug, title, description = '', author, composition, format, width, height, fps, duration, background, seed, remixedFrom, check: doCheck = true }) {
    if (!SLUG_RE.test(slug ?? '')) throw new StudioError(`"${slug}" is not a valid clip name: use lowercase letters, digits and dashes (2–64 characters)`);
    if (!author) throw new StudioError('author is required');
    if (q('SELECT 1 FROM clips WHERE slug = ?').get(slug)) throw new StudioError(`A clip named "${slug}" already exists. Use update_clip to change it.`, 'conflict');
    const p = prepare(composition ?? emptyComposition({ format: format ?? (width ? undefined : 'horizontal'), width, height, fps, duration, background, seed }));
    const checked = doCheck && p.refs.length ? await check(p.composition) : null;
    const c = p.composition;
    const at = now();
    const from = remixedFrom ? clipRow(remixedFrom) : null;
    try { transaction(db, () => {
      const id = q(`INSERT INTO clips (slug, title, description, format, width, height, fps, duration, composition, revision, remixed_from, author, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(slug, title ?? slug, description, c.format, c.width, c.height, c.fps, c.duration, JSON.stringify(c), from?.id ?? null, author, at, at).lastInsertRowid;
      writeUsage(id, p.refs, p.fonts);
    }); } catch (e) {
      if (/UNIQUE constraint/i.test(String(e?.message))) throw new StudioError(`A clip named "${slug}" already exists. Use update_clip to change it.`, 'conflict');
      throw e;
    }
    return { clip: getClip(slug), checked };
  }

  /** Replace a clip's composition and/or its title and description. Bumps the revision. @param {string} slug @param {any} [o] */
  async function updateClip(slug, { title, description, composition, check: doCheck = true, repin } = {}) {
    const row = clipRow(slug);
    let c = json(row.composition), p = null, checked = null;
    if (composition !== undefined || repin) {
      p = prepare(composition ?? c, { repin });
      c = p.composition;
      if (doCheck && p.refs.length) checked = await check(c);
    }
    transaction(db, () => {
      // the check above ran without the lock: only write if nobody saved this clip in the meantime
      const done = q('UPDATE clips SET title = ?, description = ?, format = ?, width = ?, height = ?, fps = ?, duration = ?, composition = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
        .run(title ?? row.title, description ?? row.description, c.format, c.width, c.height, c.fps, c.duration, JSON.stringify(c), now(), row.id, row.revision);
      if (!done.changes) throw new StudioError(`Clip "${slug}" was changed by someone else while this edit was being checked (it was revision ${row.revision}). Load it again and re-apply the edit.`, 'conflict');
      if (p) writeUsage(row.id, p.refs, p.fonts);
    });
    return { clip: getClip(slug), checked };
  }

  /**
   * Apply edit operations to a composition (a plain object) and return the new one:
   *   { op: 'set', duration?, fps?, background?, seed?, format? }
   *   { op: 'add_track', track: { id, type, name }, index? }      { op: 'remove_track', id }
   *   { op: 'add_item', track, item }                             { op: 'remove_item', id }
   *   { op: 'update_item', id, patch }   (patch.params merges; a null value removes that param)
   *   { op: 'move_item', id, track }
   */
  function applyOps(composition, ops) {
    let c = structuredClone(composition);
    const find = (id) => {
      for (const track of c.tracks) { const i = track.items.findIndex((it) => it.id === id); if (i >= 0) return { track, i, item: track.items[i] }; }
      throw new StudioError(`edit: no item with id "${id}" (items: ${c.tracks.flatMap((t) => t.items.map((it) => it.id)).join(', ') || 'none'})`, 'not_found');
    };
    const trackOf = (id) => {
      const t = c.tracks.find((x) => x.id === id);
      if (!t) throw new StudioError(`edit: no track with id "${id}" (tracks: ${c.tracks.map((x) => x.id).join(', ') || 'none'})`, 'not_found');
      return t;
    };
    for (const [n, op] of ops.entries()) {
      switch (op?.op) {
        case 'set':
          for (const k of ['duration', 'fps', 'background', 'seed', 'markers']) if (op[k] !== undefined) c[k] = op[k];
          if (op.format) c = reformat(c, op.format);
          break;
        case 'add_track':
          if (c.tracks.some((t) => t.id === op.track?.id)) throw new StudioError(`edit: a track with id "${op.track.id}" already exists`, 'conflict');
          c.tracks.splice(op.index ?? c.tracks.length, 0, { items: [], ...op.track });
          break;
        case 'remove_track': c.tracks.splice(c.tracks.indexOf(trackOf(op.id)), 1); break;
        case 'add_item': trackOf(op.track).items.push(op.item); break;
        case 'remove_item': { const f = find(op.id); f.track.items.splice(f.i, 1); break; }
        case 'update_item': {
          const f = find(op.id);
          const { params, ...rest } = op.patch ?? {};
          Object.assign(f.item, rest);
          if (params) {
            f.item.params = { ...f.item.params, ...params };
            for (const [k, v] of Object.entries(params)) if (v === null) delete f.item.params[k];
          }
          break;
        }
        case 'move_item': { const f = find(op.id); f.track.items.splice(f.i, 1); trackOf(op.track).items.push(f.item); break; }
        default: throw new StudioError(`edit: operation ${n + 1} has unknown op ${JSON.stringify(op?.op)} (use set, add_track, remove_track, add_item, update_item, remove_item, move_item)`);
      }
    }
    return c;
  }

  const editClip = async (slug, ops, opts = {}) => updateClip(slug, { ...opts, composition: applyOps(json(clipRow(slug).composition), ops) });

  /** A new clip in another format from an existing one. Assets re-flow from the new frame size and safe zones. */
  async function remixClip({ slug, newSlug, format, title, author }) {
    const row = clipRow(slug);
    if (!FORMATS[format]) throw new StudioError(`Unknown format "${format}"; use ${Object.keys(FORMATS).join(', ')}`);
    return createClip({ slug: newSlug, title: title ?? `${row.title} (${format})`, description: `Remix of "${row.title}" in ${format} format.`, author, composition: reformat(json(row.composition), format), remixedFrom: slug });
  }

  /** Move a clip's pins to the latest versions, in place or as a new clip. only: slugs to move (default all). */
  async function repinClip({ slug, newSlug, only, title, author }) {
    const row = clipRow(slug);
    const repin = only?.length ? only : true;
    if (!newSlug) return updateClip(slug, { repin });
    const p = prepare(json(row.composition), { repin });
    return createClip({ slug: newSlug, title: title ?? `${row.title} (latest assets)`, description: `"${row.title}" with its assets moved to their latest versions.`, author, composition: p.composition, remixedFrom: slug });
  }

  function getClip(slug) {
    const row = clipRow(slug);
    return { ...shape(row), assets: clipAssets(slug) };
  }

  const listClips = () => q('SELECT * FROM clips ORDER BY id').all().map((row) => ({
    ...shape(row, { withComposition: false }),
    assetCount: q('SELECT COUNT(*) AS n FROM clip_assets WHERE clip_id = ?').get(row.id).n,
    renders: q("SELECT COUNT(*) AS n FROM renders WHERE clip_id = ? AND status = 'done'").get(row.id).n,
  }));

  /** The pinned versions a clip uses, with where each asset came from. */
  function clipAssets(slug) {
    const clip = clipRow(slug);
    const rows = q(`SELECT a.slug, a.type, a.latest_version, a.origin_clip, a.forked_from, v.version, v.kind, v.title, v.description, v.author, v.clip_id, v.thumb, ca.direct, ca.depth
      FROM clip_assets ca JOIN asset_versions v ON v.id = ca.version_id JOIN assets a ON a.id = v.asset_id WHERE ca.clip_id = ? ORDER BY ca.depth, a.type, a.slug`).all(clip.id);
    return rows.map((r) => ({
      ref: makeRef(r.slug, r.version), slug: r.slug, version: r.version, latestVersion: r.latest_version, type: r.type, kind: r.kind,
      title: r.title ?? r.slug, description: r.description, author: r.author, thumb: r.thumb,
      direct: !!r.direct, depth: r.depth,
      originClip: library.clipSlug(r.origin_clip),
      versionMadeFor: library.clipSlug(r.clip_id),
      forkedFrom: library.refOfVersionId(r.forked_from),
      // how this clip came by the asset
      relation: r.type === 'font' ? 'library' : r.origin_clip === clip.id ? 'created' : r.clip_id === clip.id ? 'new-version' : 'reused',
    }));
  }

  return { prepare, prepareAudio, bundleFor, check, createClip, updateClip, editClip, applyOps, remixClip, repinClip, getClip, listClips, clipAssets, clipRow };
}
