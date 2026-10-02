// The asset runtime. One instance compiles a set of pinned asset versions and renders frames from
// them. The same module runs in the Node render workers and in the studio's preview worker; the
// host supplies how to evaluate source in a sandbox and how to create a canvas.
//
// The asset contract (see docs/ASSET_CONTRACT.md for the long form):
//
//   asset({
//     kind: 'visual',                        // visual (draws) | value (returns a value) | audio (returns samples)
//     title, description, tags,              // metadata, searchable in the library
//     duration: 3,                           // natural duration in seconds, or omit for "any"
//     formats: ['vertical', 'horizontal'],   // formats it is designed for (default: all)
//     params: { … },                         // declared parameter schema (core/schema.js)
//     uses: ['easing', 'text-reveal@2'],     // other assets it composes; pinned when the version is saved
//     render(f, p) { … },                    // pure function of (f.t, p): draws on f.ctx, or returns a value
//   });

import { createLib } from './lib/index.js';
import { createRng, hashSeed } from './rng.js';
import { normalizeSchema, resolveParams, SchemaError } from './schema.js';
import { safeZone, formatOf, REF_RE, FORMATS, SAMPLE_RATE } from './engine.js';

export const KINDS = ['visual', 'value', 'audio'];
const MAX_DEPTH = 24;

export class AssetError extends Error {
  constructor(message, chain = []) {
    super(message);
    this.name = 'AssetError';
    this.chain = chain;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate what a source passed to asset({...}) and return the normalized definition. */
export function normalizeDefinition(raw) {
  if (!isPlain(raw)) throw new AssetError('asset() takes one object: asset({ description, tags, params, render(f, p) { … } })');
  const known = ['kind', 'title', 'description', 'tags', 'duration', 'formats', 'params', 'uses', 'render', 'preview'];
  for (const k of Object.keys(raw)) if (!known.includes(k)) throw new AssetError(`asset(): unknown key "${k}" (known: ${known.join(', ')})`);
  const kind = raw.kind ?? 'visual';
  if (!KINDS.includes(kind)) throw new AssetError(`asset(): kind must be one of ${KINDS.join(', ')}; got ${JSON.stringify(raw.kind)}`);
  if (typeof raw.render !== 'function') throw new AssetError('asset(): render must be a function render(f, p)');
  if (raw.preview !== undefined && typeof raw.preview !== 'function') throw new AssetError('asset(): preview must be a function preview(f, p)');
  if (typeof raw.description !== 'string' || raw.description.trim().length < 12) throw new AssetError('asset(): description is required: one or two sentences saying what it draws and when to use it');
  const tags = raw.tags ?? [];
  if (!Array.isArray(tags) || !tags.length || !tags.every((t) => typeof t === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(t))) throw new AssetError('asset(): tags is required: an array of lowercase-kebab strings such as ["text", "reveal"]');
  const duration = raw.duration ?? null;
  if (duration !== null && !(typeof duration === 'number' && duration > 0 && duration <= 600)) throw new AssetError('asset(): duration is the natural length in seconds (a positive number), or omit it');
  const formats = raw.formats ?? Object.keys(FORMATS);
  if (!Array.isArray(formats) || !formats.length || !formats.every((x) => x in FORMATS)) throw new AssetError(`asset(): formats must be a non-empty subset of ${Object.keys(FORMATS).join(', ')}`);
  let schema;
  try { schema = normalizeSchema(raw.params); } catch (e) {
    if (e instanceof SchemaError) throw new AssetError(`asset(): ${e.message}`);
    throw e;
  }
  const uses = {};
  const list = raw.uses ?? [];
  const entries = Array.isArray(list) ? list.map((spec) => [typeof spec === 'string' ? spec.split('@')[0] : spec, spec]) : isPlain(list) ? Object.entries(list) : null;
  if (!entries) throw new AssetError('asset(): uses must be an array like ["easing", "lower-third@2"] or a map { alias: "name@2" }');
  for (const [alias, spec] of entries) {
    if (typeof spec !== 'string' || !REF_RE.test(spec)) throw new AssetError(`asset(): uses entry ${JSON.stringify(spec)} is not an asset reference ("name" or "name@version")`);
    uses[alias] = spec;
  }
  return {
    kind,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null,
    description: raw.description.trim(),
    tags: [...new Set(tags)],
    duration,
    formats: [...formats],
    schema,
    uses,
    render: raw.render,
    preview: raw.preview ?? null,
  };
}

/** Point an error at the asset and line it came from. */
function annotate(err, ref, lineOffset = 0) {
  if (err instanceof AssetError && err.chain.length) {
    err.chain.unshift(ref);
    return err;
  }
  const where = /([a-z0-9-]+@[\w.]+\.js):(\d+):(\d+)/.exec(String(err?.stack ?? ''));
  // errors thrown inside a sandbox come from another realm, so no instanceof here
  const text = err && typeof err.message === 'string' ? `${!err.name || err.name === 'Error' || err.name === 'AssetError' ? '' : `${err.name}: `}${err.message}` : String(err);
  const out = new AssetError(text + (where ? ` (${where[1]}:${Math.max(1, Number(where[2]) - lineOffset)}:${where[3]})` : ''), [ref]);
  out.cause = err;
  return out;
}

/** The message with the chain of assets that led to the failing call. */
export function describeError(err) {
  if (err instanceof AssetError && err.chain.length) return `[${err.chain.join(' > ')}] ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Count save()/restore() so a child that leaves the stack unbalanced can't leak state to its
 * parent, and can't pop saves that belong to its caller (the floor).
 */
function track(ctx) {
  if (ctx.__saveDepth) return ctx;
  let depth = 0, floor = 0;
  const save = ctx.save.bind(ctx), restore = ctx.restore.bind(ctx);
  const reset = typeof ctx.reset === 'function' ? ctx.reset.bind(ctx) : null;
  ctx.save = () => { depth++; save(); };
  ctx.restore = () => { if (depth > floor) { depth--; restore(); } };
  ctx.__saveDepth = () => depth;
  ctx.__floor = (n) => { const old = floor; floor = n; return old; };
  /** Back to a blank canvas in its default state: nothing an earlier frame did may survive. */
  ctx.__reset = () => {
    floor = 0;
    if (reset) { depth = 0; reset(); return; }
    while (depth > 0) { depth--; restore(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.beginPath();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
  return ctx;
}

const resetState = (ctx) => ctx.__reset();

/**
 * host: {
 *   evaluate(source, filename) → the object passed to asset({...}),
 *   createCanvas(width, height) → a canvas with getContext('2d'),
 *   lineOffset: lines the host's wrapper adds before the source (for error locations),
 * }
 */
export function createRuntime(host) {
  const lib = createLib({ sampleRate: SAMPLE_RATE });
  /** @type {Map<string, any>} */
  const entries = new Map();
  /** @type {Map<string, any>} */
  const images = new Map();
  const layers = [];
  let layerIndex = 0;
  let scratch = null;

  function compile(ref, source, deps = {}) {
    let raw;
    try { raw = host.evaluate(source, `${ref}.js`); } catch (e) { throw annotate(e, ref, host.lineOffset); }
    let def;
    try { def = normalizeDefinition(raw); } catch (e) { throw annotate(e, ref); }
    return { ref, def, deps };
  }

  /** Compile and register function assets: { 'slug@1': { source, deps: { alias: 'other@2' } } }. */
  function load(assets) {
    for (const [ref, a] of Object.entries(assets)) {
      if (entries.has(ref) || typeof a.source !== 'string') continue;
      entries.set(ref, compile(ref, a.source, a.deps ?? {}));
    }
  }

  function setImage(ref, image) { images.set(ref, image); }

  function entry(ref) {
    const e = entries.get(ref);
    if (!e) throw new AssetError(`Asset ${ref} is not loaded`);
    return e;
  }

  function resolve(owner, name) {
    if (typeof name !== 'string') throw new AssetError(`f.use() takes an asset name, got ${name === null ? 'null' : typeof name}`);
    const pinned = owner.deps[name] ?? (entries.has(name) || images.has(name) ? name : null);
    if (!pinned) {
      const declared = Object.keys(owner.deps);
      throw new AssetError(`"${name}" is not declared: add it to uses: [...] or pass it through a parameter of type "asset"/"image" (declared: ${declared.join(', ') || 'none'})`);
    }
    return pinned;
  }

  function measureContext() {
    scratch ??= track(host.createCanvas(8, 8).getContext('2d'));
    return scratch;
  }

  function offscreen(width, height) {
    const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height));
    let layer = layers[layerIndex];
    if (!layer) {
      const canvas = host.createCanvas(w, h);
      layer = layers[layerIndex] = { canvas, ctx: track(canvas.getContext('2d')), width: w, height: h };
    } else if (layer.width !== w || layer.height !== h) {
      layer.canvas.width = w; layer.canvas.height = h;
      layer.width = w; layer.height = h;
    }
    layerIndex++;
    resetState(layer.ctx);
    return layer;
  }

  function invoke(e, rawParams, env, fn = e.def.render) {
    if (env.depth > MAX_DEPTH) throw new AssetError(`Assets are nested more than ${MAX_DEPTH} levels deep: is an asset passed to itself?`, [e.ref]);
    const { values: p, errors } = resolveParams(e.def.schema, rawParams ?? {});
    if (errors.length) throw new AssetError(`bad parameters: ${errors.map((x) => `${x.path}: ${x.message}`).join('; ')}`, [e.ref]);
    const { ctx, width, height, t, duration } = env;
    const counts = {};
    let rng = null;
    const f = {
      ctx, t, duration, fps: env.fps,
      progress: duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 1,
      frame: Math.round(t * env.fps),
      width, height,
      vmin: Math.min(width, height) / 100,
      vmax: Math.max(width, height) / 100,
      aspect: width / height,
      format: env.format,
      safe: env.safe,
      seed: env.seed,
      get rng() { return (rng ??= createRng(env.seed)); },
      clip: env.clip,
      sampleRate: SAMPLE_RATE,
      lib,
      params: p,
      ref: e.ref,
      /** Compose another asset: draw a visual, or get the value of a value asset. */
      use(name, params = {}, o = {}) {
        const ref = resolve(e, name);
        if (images.has(ref)) throw new AssetError(`"${name}" is an image: get it with f.image("${name}") and draw it with ctx.drawImage`, [e.ref]);
        const child = entry(ref);
        const key = o.key ?? (counts[ref] = (counts[ref] ?? 0) + 1);
        const seed = hashSeed(env.seed, ref, key);
        const kind = child.def.kind;
        if (kind === 'value') return invoke(child, params, { ...env, seed, depth: env.depth + 1 });
        if (kind === 'audio') {
          if (e.def.kind !== 'audio') throw new AssetError(`"${name}" is an audio asset; only audio assets can use it`, [e.ref]);
          return toStereo(invoke(child, params, { ...env, seed, depth: env.depth + 1, t: 0, duration: o.duration ?? duration }), ref).left;
        }
        if (e.def.kind === 'audio') throw new AssetError(`"${name}" is a visual asset; an audio asset cannot draw`, [e.ref]);
        const at = o.at ?? 0;
        const childDuration = o.duration ?? Math.max(0, duration - at);
        let ct = o.t ?? t - at;
        if (o.hold) ct = Math.min(Math.max(ct, 0), childDuration);
        else if (ct < 0 || ct >= childDuration) return null;
        const boxed = o.x !== undefined || o.y !== undefined || o.width !== undefined || o.height !== undefined;
        const cw = o.width ?? width, ch = o.height ?? height;
        const target = o.ctx ?? ctx;
        const depth = target.__saveDepth();
        target.save();
        const floor = target.__floor(depth + 1);
        try {
          target.beginPath();
          if (o.x || o.y) target.translate(o.x ?? 0, o.y ?? 0);
          if (o.alpha !== undefined) target.globalAlpha *= Math.min(1, Math.max(0, o.alpha));
          return invoke(child, params, {
            ...env, ctx: target, seed, depth: env.depth + 1, t: ct, duration: childDuration, width: cw, height: ch,
            format: boxed ? formatOf(cw, ch) : env.format,
            safe: boxed ? { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, width: cw, height: ch } : env.safe,
          });
        } finally {
          target.__floor(floor);
          while (target.__saveDepth() > depth) target.restore();
        }
      },
      /** A loaded image asset (drawable with ctx.drawImage; has width and height). */
      image(name) {
        const ref = resolve(e, name);
        const img = images.get(ref);
        if (!img) throw new AssetError(`"${name}" is not an image asset`, [e.ref]);
        return img;
      },
      /** A cleared scratch canvas: { canvas, ctx, width, height }. Draw it back with ctx.drawImage(layer.canvas, x, y). */
      offscreen: (w = width, h = height) => offscreen(w, h),
    };
    try {
      return fn(f, p);
    } catch (err) {
      throw annotate(err, e.ref, host.lineOffset);
    }
  }

  /** Accept what an audio asset returned: a Float32Array (mono) or { left, right }. */
  function toStereo(out, ref) {
    const isBuf = (b) => ArrayBuffer.isView(b) && b.constructor.name === 'Float32Array';
    if (isBuf(out)) return { left: out, right: out };
    if (out && isBuf(out.left) && isBuf(out.right) && out.left.length === out.right.length) return { left: out.left, right: out.right };
    throw new AssetError('an audio asset must return a Float32Array (mono) or { left, right } of equal length', [ref]);
  }

  function baseEnv(ctx, o) {
    const width = o.width, height = o.height;
    return {
      ctx, width, height, fps: o.fps ?? 30, t: o.t ?? 0, duration: o.duration ?? 3, seed: o.seed ?? 1, depth: 0,
      format: formatOf(width, height), safe: safeZone(width, height),
      clip: o.clip ?? { t: o.t ?? 0, frame: Math.round((o.t ?? 0) * (o.fps ?? 30)), duration: o.duration ?? 3, fps: o.fps ?? 30, width, height, format: formatOf(width, height), beats: o.beats ?? [], markers: [] },
    };
  }

  const audioCache = new Map();

  /**
   * Draw one frame of a single asset (the playground, thumbnails, validation).
   * o: { t, duration, width, height, fps, seed, background, beats }
   */
  function renderAsset(ctx, ref, params, o) {
    const e = entry(ref);
    track(ctx);
    layerIndex = 0;
    resetState(ctx);
    ctx.save();
    try {
      ctx.clearRect(0, 0, o.width, o.height);
      if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, o.width, o.height); }
      const env = baseEnv(ctx, o);
      if (e.def.kind === 'visual') return invoke(e, params, env);
      if (e.def.preview) return invoke(e, params, env, e.def.preview);
      if (e.def.kind === 'audio') return drawWaveform(ctx, e, params, env);
      return drawValueCard(ctx, e, params, env);
    } finally {
      while (ctx.__saveDepth() > 0) ctx.restore();
    }
  }

  function drawValueCard(ctx, e, params, env) {
    const { width: w, height: h } = env;
    let value;
    try { value = invoke(e, params, env); } catch (err) { value = `error: ${describeError(err)}`; }
    const body = typeof value === 'function' ? 'ƒ()' : JSON.stringify(value, (k, v) => (typeof v === 'function' ? 'ƒ()' : v), 1) ?? String(value);
    ctx.fillStyle = '#12121c'; ctx.fillRect(0, 0, w, h);
    const L = lib.text.layout(ctx, body.slice(0, 900), { font: 'JetBrains Mono', size: Math.min(w, h) * 0.035, maxWidth: w * 0.84, maxHeight: h * 0.8, maxLines: 28, lineHeight: 1.4 });
    ctx.fillStyle = '#c8d3f5';
    lib.text.fill(ctx, L, w * 0.08, (h - L.height) / 2);
  }

  function drawWaveform(ctx, e, params, env) {
    const { width: w, height: h } = env;
    const key = `${e.ref}|${JSON.stringify(params)}|${env.duration}|${env.seed}`;
    let wave = audioCache.get(key);
    if (!wave) {
      const { left } = renderAudio(e.ref, params, { duration: env.duration, seed: env.seed });
      const bins = 480, peaks = new Float32Array(bins);
      const per = Math.max(1, Math.floor(left.length / bins));
      for (let b = 0; b < bins; b++) { let m = 0; for (let i = b * per; i < (b + 1) * per && i < left.length; i++) m = Math.max(m, Math.abs(left[i])); peaks[b] = m; }
      wave = peaks;
      if (audioCache.size > 8) audioCache.clear();
      audioCache.set(key, wave);
    }
    ctx.fillStyle = '#12121c'; ctx.fillRect(0, 0, w, h);
    const mx = w * 0.06, bw = (w - mx * 2) / wave.length, mid = h / 2, amp = h * 0.32;
    const played = env.duration > 0 ? env.t / env.duration : 0;
    for (let b = 0; b < wave.length; b++) {
      ctx.fillStyle = b / wave.length <= played ? '#7cf5c0' : '#4b5a8a';
      const v = Math.max(2, wave[b] * amp);
      ctx.fillRect(mx + b * bw, mid - v, Math.max(1, bw * 0.7), v * 2);
    }
  }

  /** Call a value asset. */
  function callValue(ref, params, o = {}) {
    const e = entry(ref);
    if (e.def.kind !== 'value') throw new AssetError(`${ref} is a ${e.def.kind} asset, not a value asset`);
    return invoke(e, params, baseEnv(measureContext(), { width: 1920, height: 1080, ...o }));
  }

  /** Run an audio asset → { left, right } Float32Arrays of duration × sampleRate samples. */
  function renderAudio(ref, params, { duration, seed = 1 }) {
    const e = entry(ref);
    if (e.def.kind !== 'audio') throw new AssetError(`${ref} is a ${e.def.kind} asset, not an audio asset`);
    const env = baseEnv(measureContext(), { width: 1920, height: 1080, t: 0, duration, seed });
    const { left, right } = toStereo(invoke(e, params, env), ref);
    const n = Math.round(duration * SAMPLE_RATE);
    const fit = (b) => {
      const out = new Float32Array(n);
      out.set(b.length > n ? b.subarray(0, n) : b);
      for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) throw new AssetError('the audio buffer contains NaN or Infinity', [ref]);
      return out;
    };
    const l = fit(left);
    return { left: l, right: right === left ? l : fit(right) };
  }

  /** Is the item on screen at this frame? Uses frame numbers so float error can't flicker an edge. */
  const activeAt = (item, frame, fps) => frame >= Math.round(item.start * fps) && frame < Math.round((item.start + item.duration) * fps);

  /** Draw one frame of a clip composition (already validated and pinned). */
  function renderClipFrame(ctx, comp, frame, extra = {}) {
    track(ctx);
    layerIndex = 0;
    resetState(ctx);
    const { width, height, fps } = comp;
    const t = frame / fps;
    ctx.save();
    try {
      ctx.fillStyle = comp.background ?? '#000000';
      ctx.fillRect(0, 0, width, height);
      const clip = { t, frame, duration: comp.duration, fps, width, height, format: formatOf(width, height), beats: extra.beats ?? comp.beats ?? [], markers: extra.markers ?? comp.markers ?? [] };
      for (const tr of comp.tracks) {
        if (tr.type === 'audio' || tr.hidden) continue;
        for (const item of tr.items) {
          if (!activeAt(item, frame, fps)) continue;
          const lt = Math.max(0, t - item.start);
          let opacity = item.opacity ?? 1;
          if (item.fadeIn > 0) opacity *= Math.min(1, lt / item.fadeIn);
          if (item.fadeOut > 0) opacity *= Math.min(1, (item.duration - lt) / item.fadeOut);
          if (opacity <= 0) continue;
          const e = entry(item.asset);
          if (e.def.kind !== 'visual') throw new AssetError(`item "${item.id}": ${item.asset} is a ${e.def.kind} asset and cannot sit on a visual track`);
          const box = item.box ? { x: item.box.x * width, y: item.box.y * height, width: item.box.width * width, height: item.box.height * height } : null;
          const layered = opacity < 1 || (item.blend && item.blend !== 'source-over');
          const target = layered ? offscreen(width, height).ctx : ctx;
          const depth = target.__saveDepth();
          target.save();
          const floor = target.__floor(depth + 1);
          try {
            target.beginPath();
            if (box) target.translate(box.x, box.y);
            const w = box ? box.width : width, h = box ? box.height : height;
            invoke(e, item.params, {
              ctx: target, width: w, height: h, fps, t: lt, duration: item.duration, depth: 0,
              seed: hashSeed(comp.seed ?? 1, item.id), format: formatOf(w, h), clip,
              safe: box ? { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, width: w, height: h } : safeZone(width, height),
            });
          } catch (err) {
            if (err instanceof AssetError) err.message = `item "${item.id}" at ${t.toFixed(3)}s: ${err.message}`;
            throw err;
          } finally {
            target.__floor(floor);
            while (target.__saveDepth() > depth) target.restore();
          }
          if (layered) {
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.globalCompositeOperation = item.blend ?? 'source-over';
            ctx.drawImage(target.canvas, 0, 0);
            ctx.restore();
          }
        }
      }
    } finally {
      while (ctx.__saveDepth() > 0) ctx.restore();
    }
  }

  return {
    lib, load, compile, setImage, renderAsset, renderClipFrame, renderAudio, callValue,
    has: (ref) => entries.has(ref) || images.has(ref),
    definition: (ref) => entry(ref).def,
    clearTextCache: () => lib.text.clearCache(),
  };
}
