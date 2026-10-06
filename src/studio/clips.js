// Clips: declarative compositions whose asset references are pinned to exact versions when the
// clip is saved, so an old clip keeps rendering the same frames after its assets move on.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, FORMATS, SAMPLE_RATE, makeRef, parseRef } from '../core/engine.js';
import { normalizeComposition, itemsOf, reformat } from '../core/composition.js';
import { needsEasing, boxToTransform } from '../core/transform.js';
import { precompSource } from './generate.js';
import { mapParams, resolveParams, walkParams } from '../core/schema.js';
import { hashSeed } from '../core/rng.js';
import { encodeWav, detectBeats } from '../render/wav.js';
import { ffmpegPath, run } from '../render/ffmpeg.js';
import { json, now, transaction } from '../db/db.js';
import { SLUG_RE, StudioError } from './library.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

const round3 = (v) => Math.round(v * 1000) / 1000;

/** What an image layer takes: how the image fits its box. */
const IMAGE_ITEM_SCHEMA = { fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain' } };
/** A baked frame sequence plays like a layer: it fits its box, and holds its last frame or loops. */
const SEQUENCE_ITEM_SCHEMA = { ...IMAGE_ITEM_SCHEMA, loop: { type: 'boolean', default: false } };

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
    let wantsEasing = false;
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
    /** Check params against a schema (strictly) and pin the asset/image references in them. */
    const pinWith = (schema, params, at) => {
      for (const e of resolveParams(schema, params, { strict: true }).errors) problems.push(`${at}: params.${e.path}: ${e.message}`);
      const out = mapParams(schema, params, ['asset', 'image'], (value, def) => {
        const dep = pin(value, `${at}: params`);
        if (!dep) return value;
        if (def.type === 'image' && dep.type !== 'image') problems.push(`${at}: params: "${value}" is a ${dep.type} asset where an image is expected`);
        if (def.type === 'asset' && (dep.type !== 'function' || (def.kind && dep.kind !== def.kind))) problems.push(`${at}: params: "${value}" is a ${dep.kind ?? dep.type} asset where a ${def.kind ?? 'function'} asset is expected`);
        const pinned = makeRef(dep.slug, dep.version);
        refs.add(pinned);
        return pinned;
      });
      walkParams(schema, out, ['font'], (family) => {
        const ref = library.fontRef(family);
        if (ref) fonts.add(ref);
        else problems.push(`${at}: params: unknown font family "${family}" (available: ${library.fontFamilies().join(', ')})`);
      });
      return out;
    };
    /** A motion, effect, mask or transition: the right kind of asset, pinned, with valid params. */
    const pinAttachment = (att, where, kinds) => {
      const row = pin(att.asset, where);
      if (!row) return;
      const kind = row.type === 'function' ? row.kind : row.type;
      if (!kinds.includes(kind)) problems.push(`${where}: ${makeRef(row.slug, row.version)} is a ${kind} asset; this takes ${kinds.join(' or ')} assets`);
      att.asset = makeRef(row.slug, row.version);
      refs.add(att.asset);
      const schema = row.type === 'function' ? json(row.schema, {}) : row.type === 'image' ? IMAGE_ITEM_SCHEMA : row.type === 'sequence' ? SEQUENCE_ITEM_SCHEMA : {};
      att.params = pinWith(schema, att.params ?? {}, where);
    };
    for (const [i, fx] of (composition.effects ?? []).entries()) pinAttachment(fx, `effects[${i}]`, ['effect']);
    for (const tr of composition.tracks) for (const [i, fx] of (tr.effects ?? []).entries()) pinAttachment(fx, `track "${tr.id}": effects[${i}]`, ['effect']);
    for (const { track, item } of itemsOf(composition)) {
      const where = `item "${item.id}"`;
      const row = pin(item.asset, where);
      if (!row) continue;
      item.asset = makeRef(row.slug, row.version);
      refs.add(item.asset);
      if (track.type === 'audio') {
        if (!(row.type === 'sound' || (row.type === 'function' && row.kind === 'audio'))) problems.push(`${where}: ${item.asset} is a ${row.kind ?? row.type} asset; an audio track takes audio or sound assets`);
      } else if (!((row.type === 'function' && row.kind === 'visual') || row.type === 'image' || row.type === 'sequence')) {
        problems.push(`${where}: ${item.asset} is a ${row.kind ?? row.type} asset; a ${track.type} track takes visual or image assets`);
      }
      const schema = row.type === 'function' ? json(row.schema, {}) : track.type === 'audio' ? null : row.type === 'image' ? IMAGE_ITEM_SCHEMA : row.type === 'sequence' ? SEQUENCE_ITEM_SCHEMA : null;
      if (!schema) { if (Object.keys(item.params).length) problems.push(`${where}: ${row.type} assets take no params`); continue; }
      // the item's params, and each format's overrides of them, are checked and pinned the same way
      const pinParams = (params, at) => pinWith(schema, params, at);
      item.params = pinParams(item.params, where);
      for (const [fname, o] of Object.entries(item.formats ?? {})) if (o.params) o.params = pinParams(o.params, `${where} (${fname})`);
      for (const [i, m] of (item.motions ?? []).entries()) pinAttachment(m, `${where}: motions[${i}]`, ['motion']);
      for (const [i, fx] of (item.effects ?? []).entries()) pinAttachment(fx, `${where}: effects[${i}]`, ['effect']);
      if (item.mask) pinAttachment(item.mask, `${where}: mask`, ['visual', 'image', 'sequence']);
      if (item.transition) pinAttachment(item.transition, `${where}: transition`, ['transition']);
      // keyframed params must be numbers or colours the schema accepts
      const keyed = [item.keyframes, ...Object.values(item.formats ?? {}).map((o) => o.keyframes)];
      for (const kf of keyed) for (const [prop, keys] of Object.entries(kf ?? {})) {
        if (!prop.startsWith('params.')) continue;
        const name = prop.slice(7), def = schema[name];
        if (!def) { problems.push(`${where}: keyframes.${prop}: ${item.asset} has no parameter "${name}" (known: ${Object.keys(schema).join(', ') || 'none'})`); continue; }
        if (!['number', 'integer', 'color'].includes(def.type)) { problems.push(`${where}: keyframes.${prop}: only number and colour parameters can be keyframed; "${name}" is ${def.type}`); continue; }
        for (const k of keys) for (const e of resolveParams({ [name]: def }, { [name]: k.v }, { strict: true }).errors) problems.push(`${where}: keyframes.${prop} at ${k.t}s: ${e.message}`);
      }
      if (needsEasing(item)) wantsEasing = true;
    }
    // the clip's theme (brand kit): a value asset every asset reads as f.theme
    if (composition.theme) {
      const row = pin(composition.theme, 'theme');
      if (row && !(row.type === 'function' && row.kind === 'value')) problems.push(`theme: ${makeRef(row.slug, row.version)} is a ${row.kind ?? row.type} asset; a theme is a value asset such as "theme-ember"`);
      else if (row) { composition.theme = makeRef(row.slug, row.version); refs.add(composition.theme); }
    }
    // keyframe curves come from an easing asset the composition pins, like any other asset
    if (composition.easing || wantsEasing) {
      const row = pin(composition.easing ?? 'easing', 'easing');
      if (row && !(row.type === 'function' && row.kind === 'value')) problems.push(`easing: ${makeRef(row.slug, row.version)} is a ${row.kind ?? row.type} asset; keyframe curves come from a value asset such as "easing"`);
      else if (row) { composition.easing = makeRef(row.slug, row.version); refs.add(composition.easing); }
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
    const solo = composition.tracks.some((t) => t.type === 'audio' && t.solo);
    for (const { track, item } of itemsOf(composition)) if (track.type === 'audio' && !track.hidden && !track.muted && (!solo || track.solo)) items.push(item);
    const explicit = items.some((it) => it.beats !== undefined);
    const inputs = [];
    let beats = [];
    for (const [i, item] of items.entries()) {
      const row = library.requireVersion(item.asset);
      const wantBeats = explicit ? item.beats === true : i === 0;
      // a split item plays [offset, offset + duration] of an asset timeline assetDuration long
      const offset = item.offset ?? 0;
      const span = item.assetDuration ?? offset + item.duration;
      let path, beatFile;
      if (row.type === 'sound') {
        path = library.absFile(row);
        beatFile = join(audioDir, `${sha1(`${item.asset}|${span}`)}.beats.json`);
        if (wantBeats && !existsSync(beatFile)) {
          const mono = await decodeMono(path);
          writeAtomic(beatFile, JSON.stringify(detectBeats(mono.subarray(0, Math.round(span * SAMPLE_RATE)), SAMPLE_RATE)));
        }
      } else {
        const seed = hashSeed(composition.seed, item.id);
        // assets named in the item's params are part of what the synth needs
        const extra = [];
        walkParams(json(row.schema, {}), item.params, ['asset', 'image'], (value) => { if (parseRef(value).version !== null) extra.push(value); });
        const b = library.bundle([item.asset, ...extra]);
        const key = sha1(JSON.stringify([ENGINE_VERSION, Object.keys(b.assets).sort(), item.asset, item.params, span, seed]));
        path = join(audioDir, `${key}.wav`);
        beatFile = join(audioDir, `${key}.beats.json`);
        if (!existsSync(path)) {
          const r = await pool.run('audio', { ref: item.asset, params: item.params, duration: span, seed }, { bundle: b, timeout: 120000 });
          const left = new Float32Array(r.left), right = new Float32Array(r.right);
          writeAtomic(beatFile, JSON.stringify(detectBeats(left, SAMPLE_RATE)));
          writeAtomic(path, encodeWav(left, right, SAMPLE_RATE));
        }
      }
      const input = { id: item.id, path, start: item.start, duration: item.duration, gain: item.gain ?? 1, fadeIn: item.fadeIn ?? 0, fadeOut: item.fadeOut ?? 0 };
      if (offset) input.offset = offset;
      inputs.push(input);
      if (wantBeats) {
        const found = json(readFileSync(beatFile, 'utf8'), []).filter((t) => t >= offset && t < offset + item.duration);
        beats = beats.concat(found.map((t) => Math.round((t - offset + item.start) * 1000) / 1000));
      }
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
      const schema = json(row.schema, {});
      for (const params of [item.params, ...Object.values(item.formats ?? {}).map((o) => o.params)]) {
        if (params) walkParams(schema, params, ['asset', 'image'], (value) => { if (parseRef(value).version !== null) refs.add(value); });
      }
    }
    if (composition.easing) refs.add(composition.easing);
    if (composition.theme) refs.add(composition.theme);
    // motions, effects, masks and transitions, with the assets named in their params
    const attachments = [...(composition.effects ?? []), ...composition.tracks.flatMap((t) => t.effects ?? [])];
    for (const { track, item } of itemsOf(composition)) if (track.type !== 'audio') attachments.push(...(item.motions ?? []), ...(item.effects ?? []), ...(item.mask ? [item.mask] : []), ...(item.transition ? [item.transition] : []));
    for (const a of attachments) {
      refs.add(a.asset);
      const row = library.requireVersion(a.asset);
      if (row.type === 'function') walkParams(json(row.schema, {}), a.params ?? {}, ['asset', 'image'], (value) => { if (parseRef(value).version !== null) refs.add(value); });
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
      if (direct) library.touch(row.slug, 'used');
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
    ctx.events?.emit('clip', slug, 'created', { revision: 1, author, remixedFrom: remixedFrom ?? null });
    return { clip: getClip(slug), checked };
  }

  /** Replace a clip's composition and/or its title and description. Bumps the revision. @param {string} slug @param {any} [o] */
  async function updateClip(slug, { title, description, composition, check: doCheck = true, repin, by, revision: base } = {}) {
    const row = clipRow(slug);
    // a save made from an older revision (the editor sends the one it loaded) must not overwrite a newer one
    if (base !== undefined && base !== null && base !== row.revision) throw new StudioError(`Clip "${slug}" is at revision ${row.revision}, not ${base}: it was changed elsewhere. Load it again.`, 'conflict');
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
    ctx.events?.emit('clip', slug, 'updated', { revision: row.revision + 1, by: by ?? null });
    return { clip: getClip(slug), checked };
  }

  /**
   * Apply edit operations to a composition (a plain object) and return the new one:
   *   { op: 'set', duration?, fps?, background?, seed?, format? }
   *   { op: 'add_track', track: { id, type, name }, index? }      { op: 'remove_track', id }
   *   { op: 'add_item', track, item }                             { op: 'remove_item', id }
   *   { op: 'update_item', id, patch }   (patch.params merges; a null value removes that param)
   *   { op: 'move_item', id, track, index? }                      { op: 'move_track', id, index }   (index: draw order, last is in front)
   *   { op: 'update_track', id, patch: { name, hidden, locked, solo, muted } }
   *   { op: 'set_transform', id, transform, format? }  (merges; null removes a field; format: that format's override)
   *   { op: 'set_keyframes', id, prop, keyframes, format? }       (null or [] removes the property's keyframes)
   *   { op: 'add_keyframe', id, prop, t, v, ease?, format? }      { op: 'remove_keyframe', id, prop, t, format? }
   *   { op: 'set_override', id, format, override }                (replace a format's override; null clears it)
   *   { op: 'split_item', id, at }  (clip seconds; the second part keeps playing where the first stopped)
   *   { op: 'duplicate_item', id, newId?, start?, track? }
   */
  function applyOps(composition, ops) {
    let c = structuredClone(composition);
    const find = (id) => {
      for (const track of c.tracks) { const i = track.items.findIndex((it) => it.id === id); if (i >= 0) return { track, i, item: track.items[i] }; }
      throw new StudioError(`edit: no item with id "${id}" (items: ${c.tracks.flatMap((t) => t.items.map((it) => it.id)).join(', ') || 'none'})`, 'not_found');
    };
    const allIds = () => new Set(c.tracks.flatMap((t) => t.items.map((it) => it.id)));
    const freeId = (base) => { const ids = allIds(); let id = base, i = 2; while (ids.has(id)) id = `${base}-${i++}`; return id; };
    const clampIndex = (i, n) => (Number.isInteger(i) ? Math.max(0, Math.min(n, i)) : n);
    /** The object a layout edit writes to: the item itself, or its override for one format. */
    const layoutOf = (item, format) => {
      if (!format) return item;
      if (!['vertical', 'horizontal', 'square'].includes(format)) throw new StudioError(`edit: unknown format "${format}"`);
      item.formats = { ...(item.formats ?? {}) };
      item.formats[format] = { ...(item.formats[format] ?? {}) };
      return item.formats[format];
    };
    /** Drop empty overrides so an item edited back to plain stays plain. */
    const prune = (item) => {
      for (const [k, o] of Object.entries(item.formats ?? {})) if (!Object.keys(o).length) delete item.formats[k];
      if (item.formats && !Object.keys(item.formats).length) delete item.formats;
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
        case 'move_item': {
          const f = find(op.id);
          const to = trackOf(op.track ?? f.track.id);
          f.track.items.splice(f.i, 1);
          to.items.splice(op.index === undefined ? to.items.length : clampIndex(op.index, to.items.length), 0, f.item);
          break;
        }
        case 'move_track': {
          const t = trackOf(op.id);
          c.tracks.splice(c.tracks.indexOf(t), 1);
          c.tracks.splice(clampIndex(op.index, c.tracks.length), 0, t);
          break;
        }
        case 'update_track': {
          const t = trackOf(op.id);
          for (const [k, v] of Object.entries(op.patch ?? {})) {
            if (!['name', 'hidden', 'locked', 'solo', 'muted'].includes(k)) throw new StudioError(`edit: update_track can change name, hidden, locked, solo, muted; not "${k}"`);
            if (k === 'name') t.name = String(v);
            else if (v) t[k] = true; else delete t[k];
          }
          break;
        }
        case 'set_transform': {
          const at = layoutOf(find(op.id).item, op.format);
          const tr = { ...(at.transform ?? {}) };
          for (const [k, v] of Object.entries(op.transform ?? {})) { if (v === null) delete tr[k]; else tr[k] = v; }
          if (Object.keys(tr).length) at.transform = tr; else delete at.transform;
          prune(find(op.id).item);
          break;
        }
        case 'set_keyframes': case 'add_keyframe': case 'remove_keyframe': {
          if (typeof op.prop !== 'string') throw new StudioError(`edit: ${op.op} needs prop (x, y, scale, rotation, opacity, params.<name>…)`);
          const at = layoutOf(find(op.id).item, op.format);
          const kf = { ...(at.keyframes ?? {}) };
          let keys = [...(kf[op.prop] ?? [])];
          if (op.op === 'set_keyframes') keys = op.keyframes ? [...op.keyframes] : [];
          else if (op.op === 'add_keyframe') {
            keys = keys.filter((k) => Math.abs(k.t - op.t) > 1e-6);
            keys.push(op.ease === undefined ? { t: op.t, v: op.v } : { t: op.t, v: op.v, ease: op.ease });
          } else keys = keys.filter((k) => Math.abs(k.t - op.t) > 1e-6);
          keys.sort((a, b) => a.t - b.t);
          if (keys.length) kf[op.prop] = keys; else delete kf[op.prop];
          if (Object.keys(kf).length) at.keyframes = kf; else delete at.keyframes;
          prune(find(op.id).item);
          break;
        }
        case 'set_override': {
          const { item } = find(op.id);
          if (!['vertical', 'horizontal', 'square'].includes(op.format)) throw new StudioError('edit: set_override needs format: vertical, horizontal or square');
          item.formats = { ...(item.formats ?? {}) };
          if (op.override) item.formats[op.format] = op.override; else delete item.formats[op.format];
          prune(item);
          break;
        }
        case 'split_item': {
          const f = find(op.id);
          const it = f.item;
          if (!(op.at > it.start + 1e-6 && op.at < it.start + it.duration - 1e-6)) throw new StudioError(`edit: split_item: ${op.at}s is not inside item "${it.id}" (${it.start}s–${round3(it.start + it.duration)}s)`);
          const offset = it.offset ?? 0;
          const whole = it.assetDuration ?? offset + it.duration;
          const cut = round3(op.at - it.start);
          const second = { ...structuredClone(it), id: freeId(`${it.id}-b`), start: round3(op.at), duration: round3(it.duration - cut), offset: round3(offset + cut), assetDuration: whole };
          delete second.fadeIn;
          Object.assign(it, { duration: cut, assetDuration: whole });
          delete it.fadeOut;
          f.track.items.splice(f.i + 1, 0, second);
          break;
        }
        case 'duplicate_item': {
          const f = find(op.id);
          const copy = { ...structuredClone(f.item), id: op.newId ?? freeId(`${f.item.id}-copy`) };
          if (op.newId && allIds().has(op.newId)) throw new StudioError(`edit: an item with id "${op.newId}" already exists`, 'conflict');
          if (op.start !== undefined) copy.start = op.start;
          const to = op.track ? trackOf(op.track) : f.track;
          to.items.splice(to === f.track ? f.i + 1 : to.items.length, 0, copy);
          break;
        }
        default: throw new StudioError(`edit: operation ${n + 1} has unknown op ${JSON.stringify(op?.op)} (use set, add_track, remove_track, move_track, update_track, add_item, update_item, remove_item, move_item, set_transform, set_keyframes, add_keyframe, remove_keyframe, set_override, split_item, duplicate_item)`);
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

  /**
   * Save layers of a clip as one asset (a precomp): the selected items, their timing relative to the
   * first of them, their layout and attachments, drawn by f.layers. `expose` turns item params into
   * the precomp's own params (their current values become the defaults). With replace, the items are
   * swapped for one item that uses the new asset.
   * @param {{ clip: string, items: string[], slug: string, title?: string, description?: string, tags?: string[], expose?: { item: string, param: string, name?: string }[], author: string, replace?: boolean }} o
   */
  async function savePrecomp({ clip: slug, items: ids, slug: name, title, description, tags, expose = [], author, replace = false }) {
    const row = clipRow(slug);
    const comp = json(row.composition);
    if (!Array.isArray(ids) || !ids.length) throw new StudioError('items: the ids of the layers to save');
    const picked = [];
    comp.tracks.forEach((tr, ti) => tr.items.forEach((it, ii) => { if (ids.includes(it.id)) picked.push({ tr, it, ti, ii }); }));
    const missing = ids.filter((id) => !picked.some((p) => p.it.id === id));
    if (missing.length) throw new StudioError(`No item ${missing.map((x) => `"${x}"`).join(', ')} in clip "${slug}"`, 'not_found');
    const audio = picked.filter((p) => p.tr.type === 'audio');
    if (audio.length) throw new StudioError(`A precomp holds visual layers; leave the audio items (${audio.map((p) => p.it.id).join(', ')}) on the clip`);
    const t0 = Math.min(...picked.map((p) => p.it.start));
    const duration = round3(Math.max(...picked.map((p) => p.it.start + p.it.duration)) - t0);
    const uses = {}, aliasOf = new Map();
    const alias = (ref) => {
      if (aliasOf.has(ref)) return aliasOf.get(ref);
      const base = parseRef(ref).slug;
      let a = base, n = 2;
      while (Object.hasOwn(uses, a)) a = `${base}-${n++}`;
      uses[a] = ref;
      aliasOf.set(ref, a);
      return a;
    };
    // assets named in params (themes, images) must be pinned by the precomp too, so they are bundled
    const pinRefs = (ref, params) => {
      const r = library.requireVersion(ref);
      if (r.type === 'function') walkParams(json(r.schema, {}), params ?? {}, ['asset', 'image'], (value) => { if (parseRef(value).version !== null) alias(value); });
    };
    const params = {};
    const byItem = new Map();
    for (const x of expose) {
      const p = picked.find((q2) => q2.it.id === x.item);
      if (!p) throw new StudioError(`expose: "${x.item}" is not one of the saved items`);
      const r = library.requireVersion(p.it.asset);
      const def = json(r.schema, {})[x.param];
      if (!def) throw new StudioError(`expose: ${p.it.asset} has no parameter "${x.param}"`);
      let pname = x.name ?? x.param;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pname)) throw new StudioError(`expose: "${pname}" is not a valid parameter name`);
      if (Object.hasOwn(params, pname)) pname = `${x.item.replace(/[^A-Za-z0-9_]/g, '_')}_${x.param}`;
      params[pname] = { ...def, default: p.it.params[x.param] ?? def.default };
      byItem.set(`${x.item}|${x.param}`, pname);
    }
    const att = (a) => { pinRefs(a.asset, a.params); return { ...a, asset: alias(a.asset) }; };
    const layers = picked.map(({ it }) => {
      pinRefs(it.asset, it.params);
      const L = { id: it.id, asset: alias(it.asset), start: round3(it.start - t0), duration: it.duration };
      L.params = Object.fromEntries(Object.entries(it.params).map(([k, v]) => [k, byItem.has(`${it.id}|${k}`) ? { $param: byItem.get(`${it.id}|${k}`) } : v]));
      const transform = it.transform ?? (it.box ? boxToTransform(it.box) : undefined);
      if (transform) L.transform = transform;
      for (const k of ['label', 'fadeIn', 'fadeOut', 'opacity', 'blend', 'offset', 'assetDuration', 'keyframes', 'formats']) if (it[k] !== undefined) L[k] = it[k];
      if (it.motions) L.motions = it.motions.map(att);
      if (it.effects) L.effects = it.effects.map(att);
      if (it.mask) L.mask = att(it.mask);
      if (it.transition) L.transition = att(it.transition);
      return L;
    });
    if (comp.easing && picked.some((p) => needsEasing(p.it))) { if (uses.easing && uses.easing !== comp.easing) throw new StudioError('The layers use two different easing assets'); uses.easing = comp.easing; }
    const titles = picked.map((p) => library.requireVersion(p.it.asset)).map((r) => r.title ?? r.slug);
    const source = precompSource({
      title: title ?? `${row.title}: ${picked.length} layer${picked.length === 1 ? '' : 's'}`,
      description: description ?? `A precomp of ${picked.length} layer${picked.length === 1 ? '' : 's'} (${[...new Set(titles)].slice(0, 4).join(', ')}) saved from the clip "${row.title}".`,
      tags: [...new Set([...(tags ?? []), 'precomp'])], duration, uses, params, layers, from: `clip "${slug}" (items ${ids.join(', ')})`,
    });
    const saved = await library.saveFunction({ slug: name, source, author, forClip: slug, note: `Precomp of ${picked.length} layer${picked.length === 1 ? '' : 's'} from ${slug}`, mode: 'create', derivation: 'precomp' });
    if (!replace) return { asset: saved.asset, source, clip: null };
    // the new item sits where the top-most saved layer was
    const top = picked.reduce((a, b) => (b.ti > a.ti || (b.ti === a.ti && b.ii > a.ii) ? b : a));
    /** @type {any[]} */
    const ops = ids.map((id) => ({ op: 'remove_item', id }));
    const index = top.tr.items.slice(0, top.ii).filter((it) => !ids.includes(it.id)).length;
    ops.push({ op: 'add_item', track: top.tr.id, item: { id: name, asset: saved.asset.ref, start: t0, duration, params: {}, transform: {} } }, { op: 'move_item', id: name, track: top.tr.id, index });
    const edited = await editClip(slug, ops, { by: `precomp ${saved.asset.ref}` });
    return { asset: saved.asset, source, clip: edited.clip };
  }

  /**
   * Add library assets to a clip at a time (the library's "add to the open clip"): visual ones on a
   * track of their own at the top, audio ones on an audio track, each for its natural duration.
   * @param {{ slug: string, assets: string[], at?: number, author?: string }} o
   */
  async function addAssets({ slug, assets, at = 0, author }) {
    const comp = json(clipRow(slug).composition);
    if (!Array.isArray(assets) || !assets.length || assets.length > 50) throw new StudioError('assets: 1–50 asset names');
    const start = Math.max(0, Math.min(Number(at) || 0, comp.duration - 0.1));
    const ids = new Set(comp.tracks.flatMap((t) => t.items.map((i) => i.id)));
    const ops = [], added = [];
    const ensure = (id, type, name) => { if (!comp.tracks.some((t) => t.id === id) && !ops.some((o) => o.op === 'add_track' && o.track.id === id)) ops.push({ op: 'add_track', track: { id, type, name } }); };
    for (const ref of assets) {
      const row = library.requireVersion(ref);
      const audio = row.type === 'sound' || row.kind === 'audio';
      if (!audio && !(row.type === 'image' || row.type === 'sequence' || row.kind === 'visual')) throw new StudioError(`${ref} is a ${row.kind ?? row.type} asset: attach it to an item instead (motions, effects, transition)`);
      const track = audio ? 'added-audio' : 'added';
      ensure(track, audio ? 'audio' : 'visual', audio ? 'Added audio' : 'Added');
      let id = row.slug, n = 2;
      while (ids.has(id)) id = `${row.slug}-${n++}`;
      ids.add(id);
      const duration = round3(Math.min(row.duration ?? (row.type === 'sequence' ? json(row.meta, {}).duration : null) ?? 3, comp.duration - start));
      ops.push({ op: 'add_item', track, item: { id, asset: makeRef(row.slug, row.version), start: round3(start), duration, params: {} } });
      added.push(id);
    }
    const r = await editClip(slug, ops, { by: author ?? null });
    return { clip: r.clip, added };
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

  return { prepare, prepareAudio, bundleFor, check, createClip, updateClip, editClip, applyOps, remixClip, repinClip, savePrecomp, addAssets, getClip, listClips, clipAssets, clipRow };
}
