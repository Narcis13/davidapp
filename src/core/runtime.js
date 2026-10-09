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
import { forFormat, isV2Item, layerGeometry, sampleItem, spaceRect, TRANSFORM_DEFAULTS } from './transform.js';
import { drawDemo } from './demo.js';
import { platformSafe } from './platforms.js';

/**
 * visual draws; value returns a value; audio returns samples; motion returns a transform delta for
 * an item; transition draws one layer turning into another; effect draws a processed copy of a layer.
 */
export const KINDS = ['visual', 'value', 'audio', 'motion', 'transition', 'effect'];
/** What a motion may return: offsets in px add, scales and opacity multiply, rotation (degrees) adds. */
export const MOTION_KEYS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity'];
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
  const known = ['kind', 'title', 'description', 'tags', 'duration', 'formats', 'params', 'uses', 'render', 'preview', 'floor'];
  for (const k of Object.keys(raw)) if (!known.includes(k)) throw new AssetError(`asset(): unknown key "${k}" (known: ${known.join(', ')})`);
  const kind = raw.kind ?? 'visual';
  if (!KINDS.includes(kind)) throw new AssetError(`asset(): kind must be one of ${KINDS.join(', ')}; got ${JSON.stringify(raw.kind)}`);
  if (typeof raw.render !== 'function') throw new AssetError('asset(): render must be a function render(f, p)');
  if (raw.preview !== undefined && typeof raw.preview !== 'function') throw new AssetError('asset(): preview must be a function preview(f, p)');
  if (raw.floor !== undefined && !(typeof raw.floor === 'number' && raw.floor >= 0 && raw.floor <= 20)) throw new AssetError('asset(): floor is the smallest on-screen text size, as a percentage of the frame\'s short side (0–20), for every f.lib.text.layout call that does not set its own');
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
    floor: raw.floor ?? 0,
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
 * Effects read pixels back with getImageData: from the runtime's own layers, and for an effect on the
 * whole clip from the frame itself. So every context is asked for with { willReadFrequently: true }
 * (a browser warns otherwise), here and by the host for the context it passes to renderClipFrame and
 * renderAsset. Skia in Node ignores the option.
 */
export function createRuntime(host) {
  const lib = createLib({ sampleRate: SAMPLE_RATE });
  /** @type {Map<string, any>} */
  const entries = new Map();
  /** @type {Map<string, any>} */
  const images = new Map();
  /** sequence ref → { frames, fps, width, height, get(index) → image | null } */
  const sequences = new Map();
  const layers = [];
  let layerIndex = 0;
  let scratch = null;
  // inspection (layout report, checks): the item being drawn, and the canvases assets asked for with f.offscreen
  const inspect = lib.inspect;
  let cur = null, curTrack = null, inTransition = false;
  const assetCanvases = new Set();

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

  /** ref → the vector model of an uploaded SVG (f.svg) */
  const vectors = new Map();
  function setImage(ref, image, vector = null) { images.set(ref, image); if (vector) vectors.set(ref, vector); }
  function setSequence(ref, seq) { sequences.set(ref, seq); }

  /** The frame of a sequence an item shows at asset time `at` (held on its last frame, or looped). */
  const sequenceIndex = (seq, at, loop) => {
    const i = Math.max(0, Math.round(at * seq.fps));
    return loop ? i % seq.frames : Math.min(seq.frames - 1, i);
  };

  /**
   * The sequence frames a clip frame will draw: [{ ref, index }]. The host loads them (they are files)
   * before calling renderClipFrame, which is synchronous.
   */
  function sequenceFramesAt(comp, frame) {
    const out = [];
    if (!sequences.size) return out;
    const { fps } = comp;
    const t = frame / fps;
    const solo = comp.tracks.some((tr) => tr.type !== 'audio' && tr.solo);
    const format = formatOf(comp.width, comp.height);
    // the same time and loop flags the draw path reads: the item's params merged for the format, the mask's own params
    const want = (raw, time) => {
      const item = forFormat(raw, format);
      const at = Math.max(0, time - item.start) + (item.offset ?? 0);
      for (const [ref, params] of [[item.asset, item.params], [item.mask?.asset, item.mask?.params]]) {
        const seq = ref && sequences.get(ref);
        if (seq) out.push({ ref, index: sequenceIndex(seq, at, params?.loop) });
      }
    };
    for (const tr of comp.tracks) {
      if (tr.type === 'audio' || tr.hidden || (solo && !tr.solo)) continue;
      const handoff = transitionsAt(tr, frame, fps);
      for (const from of handoff.outgoing) want(from, Math.min(t, from.start + from.duration - 1 / fps));
      for (const item of tr.items) if (activeAt(item, frame, fps)) want(item, t);
    }
    return out;
  }

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
    scratch ??= track(host.createCanvas(8, 8).getContext('2d', { willReadFrequently: true }));
    return scratch;
  }

  function offscreen(width, height) {
    const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height));
    let layer = layers[layerIndex];
    if (!layer) {
      const canvas = host.createCanvas(w, h);
      // effects read layers back (getImageData): tell the browser, so it keeps them in CPU memory
      layer = layers[layerIndex] = { canvas, ctx: track(canvas.getContext('2d', { willReadFrequently: true })), width: w, height: h };
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
      /** The clip's theme (a value asset's value), or null: read colours and fonts from it by default. */
      theme: env.clip?.theme ?? null,
      /** motion: in | out | emphasis | loop. */
      phase: env.phase ?? null,
      /** effect: the layer to process; transition: the outgoing and incoming layers ({ canvas, ctx, width, height } or null). */
      source: env.source ?? null,
      from: env.from ?? null,
      to: env.to ?? null,
      /** Compose another asset: draw a visual, or get the value of a value asset. */
      use(name, params = {}, o = {}) {
        const ref = resolve(e, name);
        if (images.has(ref)) throw new AssetError(`"${name}" is an image: get it with f.image("${name}") and draw it with ctx.drawImage`, [e.ref]);
        const child = entry(ref);
        const key = o.key ?? (counts[ref] = (counts[ref] ?? 0) + 1);
        const seed = hashSeed(env.seed, ref, key);
        const kind = child.def.kind;
        if (kind === 'value' || kind === 'motion') return invoke(child, params, { ...env, seed, depth: env.depth + 1 });
        // an effect or transition used from another one (a preset) works on the same layers
        if (kind === 'effect' || kind === 'transition') {
          if (e.def.kind !== kind) throw new AssetError(`"${name}" is ${kind === 'effect' ? 'an effect' : 'a transition'}; only ${kind === 'effect' ? 'an effect' : 'a transition'} can use it (attach it to an item instead)`, [e.ref]);
          return invoke(child, params, { ...env, seed, depth: env.depth + 1 });
        }
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
      /**
       * The vector drawing of an uploaded SVG image: { width, height, viewBox, paths, draw(ctx, { x, y,
       * width, height, progress, fill, stroke, colors, strokeWidth }) } (see lib.svg). For draw-on and recolouring.
       */
      svg(name) {
        const ref = resolve(e, name);
        const model = vectors.get(ref);
        if (!model) throw new AssetError(`"${name}" has no vector drawing: f.svg() takes an uploaded SVG image (use f.image() for other images)`, [e.ref]);
        return { ...model, draw: (c, o) => lib.svg.draw(c, model, o) };
      },
      /** A cleared scratch canvas: { canvas, ctx, width, height }. Draw it back with ctx.drawImage(layer.canvas, x, y). */
      offscreen: (w = width, h = height) => { const l = offscreen(w, h); assetCanvases.add(l.canvas); return l; },
      /**
       * Draw layers inside this asset's box, the way a clip draws its items: a precomp. Each layer is
       * { asset (an alias from uses), start, duration, params, transform, keyframes, motions, effects,
       * mask, transition, track, opacity, blend, fadeIn, fadeOut }, bottom first. A layer without a
       * duration lasts until this asset ends. A transition hands over from the layer before it, among
       * the layers with the same `track` (all of them when none names one). A param value
       * { $param: "name" } takes values[name], so a precomp exposes the params it chooses.
       */
      layers(list, values = {}) {
        if (!Array.isArray(list)) throw new AssetError('f.layers() takes a list of layers', [e.ref]);
        if (e.def.kind !== 'visual') throw new AssetError('f.layers() draws, so only a visual asset can call it', [e.ref]);
        const sub = { width, height, fps: env.fps, seed: env.seed, format: env.format, easing: e.deps.easing ?? null };
        const frame = Math.round(t * env.fps);
        const items = list.map((layer, i) => bindLayer(e, layer, values, i, duration));
        const handoffs = new Map();
        for (const item of items) {
          let handoff = handoffs.get(item.track);
          if (!handoff) handoffs.set(item.track, (handoff = transitionsAt({ items: items.filter((other) => other.track === item.track) }, frame, env.fps)));
          if (handoff.outgoing.has(item)) continue;
          const tx = handoff.incoming.get(item);
          if (tx) { drawTransition(ctx, sub, tx, t, env.clip, env.format); continue; }
          if (!activeAt(item, frame, env.fps)) continue;
          drawLayer(ctx, sub, forFormat(item, env.format), t, env.clip);
        }
      },
    };
    const floor = inspect.floor;
    inspect.floor = e.def.floor;
    try {
      return fn(f, p);
    } catch (err) {
      throw annotate(err, e.ref, host.lineOffset);
    } finally {
      inspect.floor = floor;
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
    // size floors are relative to the frame; o.record collects what f.lib.text draws (takeTexts())
    inspect.frame = { width: o.width, height: o.height, short: Math.min(o.width, o.height) };
    assetTexts = o.record ? [] : null;
    inspect.record = assetTexts ? recorder(assetTexts) : null;
    assetCanvases.clear();
    cur = null;
    ctx.save();
    try {
      ctx.clearRect(0, 0, o.width, o.height);
      if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, o.width, o.height); }
      const env = baseEnv(ctx, o);
      if (e.def.kind === 'visual') return invoke(e, params, env);
      if (e.def.preview) return invoke(e, params, env, e.def.preview);
      if (e.def.kind === 'motion' || e.def.kind === 'transition' || e.def.kind === 'effect') return drawKindDemo(ctx, e, params, env, o.background);
      if (e.def.kind === 'audio') return drawWaveform(ctx, e, params, env);
      return drawValueCard(ctx, e, params, env);
    } finally {
      while (ctx.__saveDepth() > 0) ctx.restore();
      inspect.record = null;
    }
  }
  let assetTexts = null;
  /** What f.lib.text and f.lib.solid drew in the last renderAsset call made with record: true. */
  const takeTexts = () => { const t = assetTexts ?? []; assetTexts = null; return t; };

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

  /** Map what f.lib.text or f.lib.solid recorded (context coordinates) to frame pixels, attributed to the item being drawn. */
  function recorder(out) {
    return (r) => {
      const m = r.matrix, M = [m.a, m.b, m.c, m.d, m.e, m.f];
      const quadOf = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
      const aabb = (q) => { const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }; };
      const quad = quadOf(r.ink);
      const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
      const approximate = assetCanvases.has(r.canvas) ? 'offscreen' : inTransition ? 'transition' : null;
      out.push({
        item: cur?.item ?? null, track: cur?.track ?? null, mask: cur?.mask ? true : undefined, kind: r.kind, text: r.text, font: r.font, family: r.family,
        size: r.size, screenSize: r.size === null ? null : r.size * scale, floor: r.floor, block: r.block, fill: r.fill, alpha: r.alpha * (cur?.opacity ?? 1), stroke: r.stroke || undefined,
        box: aabb(quad), quad, line: aabb(quadOf(r.line)), approximate: approximate ?? undefined,
      });
    };
  }

  /** Run fn with item attributed as the one being drawn (the outermost item wins: a precomp's layers belong to its item). */
  function drawingItem(id, opacity, fn) {
    if (cur || !inspect.record) return fn();
    cur = { item: id, track: curTrack, opacity };
    try { return fn(); } finally { cur = null; }
  }

  /**
   * Draw one frame of a clip composition (already validated and pinned).
   * extra: { beats, markers, words, captions, lane, record (collect what f.lib.text and f.lib.solid draw), suppressText (draw everything but text) }.
   * Returns { texts } when recording (one entry per drawn word, in frame pixels), else undefined.
   */
  function renderClipFrame(ctx, comp, frame, extra = {}) {
    track(ctx);
    layerIndex = 0;
    resetState(ctx);
    const { width, height, fps } = comp;
    const t = frame / fps;
    const texts = extra.record ? [] : null;
    inspect.record = texts ? recorder(texts) : null;
    inspect.suppress = !!extra.suppressText;
    inspect.frame = { width, height, short: Math.min(width, height) };
    assetCanvases.clear();
    cur = null; inTransition = false;
    ctx.save();
    try {
      ctx.fillStyle = comp.background ?? '#000000';
      ctx.fillRect(0, 0, width, height);
      const clip = { t, frame, duration: comp.duration, fps, width, height, format: formatOf(width, height), beats: extra.beats ?? comp.beats ?? [], markers: extra.markers ?? comp.markers ?? [] };
      // v2: the clip's theme, read by every asset as f.theme (only set when the clip has one)
      if (comp.theme) clip.theme = themeOf(comp.theme);
      // v3: the narration's words and the caption pages in clip time, and the caption lane (only set when the clip has them)
      if (extra.words?.length) clip.words = extra.words;
      if (extra.captions) clip.captions = extra.captions;
      if (extra.lane) clip.lane = extra.lane;
      const format = formatOf(width, height);
      const solo = comp.tracks.some((tr) => tr.type !== 'audio' && tr.solo);
      // captions that are file only are not drawn
      const fileOnly = comp.captions && comp.captions.burnIn === false;
      for (const tr of comp.tracks) {
        if (tr.type === 'audio' || tr.hidden || (solo && !tr.solo) || (fileOnly && tr.role === 'captions')) continue;
        curTrack = tr.id;
        // v2: a track with effects is drawn on its own layer first, then processed (an adjustment layer)
        if (tr.effects?.length) { drawTrackWithEffects(ctx, comp, tr, frame, t, clip, format); continue; }
        const handoff = transitionsAt(tr, frame, fps);
        for (const item of tr.items) {
          if (handoff.outgoing.has(item)) continue;
          const tx = handoff.incoming.get(item);
          if (tx) { drawTransition(ctx, comp, tx, t, clip, format); continue; }
          if (!activeAt(item, frame, fps)) continue;
          // composition v2 (transforms, keyframes, formats…) and image layers take the new path;
          // everything else is drawn exactly as in v1, so old clips keep their pixels
          if (isV2Item(item) || images.has(item.asset) || sequences.has(item.asset)) { drawLayer(ctx, comp, forFormat(item, format), t, clip); continue; }
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
            drawingItem(item.id, layered ? opacity : 1, () => invoke(e, item.params, {
              ctx: target, width: w, height: h, fps, t: lt, duration: item.duration, depth: 0,
              seed: hashSeed(comp.seed ?? 1, item.id), format: formatOf(w, h), clip,
              safe: box ? { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, width: w, height: h } : clipSafe(comp),
            }));
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
      // v2: effects on the whole clip, after every track
      if (comp.effects?.length) {
        const out = applyEffects({ canvas: ctx.canvas, ctx, width, height }, comp.effects, comp, { t, duration: comp.duration }, clip, 'clip');
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(out.canvas, 0, 0);
        ctx.restore();
      }
    } finally {
      while (ctx.__saveDepth() > 0) ctx.restore();
      inspect.record = null;
      inspect.suppress = false;
      cur = null; curTrack = null; inTransition = false;
    }
    return texts ? { texts } : undefined;
  }

  /** The safe zone a clip's full-frame items see as f.safe: the format's, or (opt-in, safe: 'platform') the tightest edge of its platform profiles. */
  const safes = new Map();
  function clipSafe(comp) {
    if (comp.safe !== 'platform' || !comp.platforms?.length) return safeZone(comp.width, comp.height);
    const key = `${comp.platforms.join(',')}|${comp.width}x${comp.height}`;
    if (!safes.has(key)) { const p = platformSafe(comp.platforms, comp.width, comp.height); safes.set(key, { top: p.top, right: p.right, bottom: p.bottom, left: p.left, x: p.x, y: p.y, width: p.width, height: p.height }); }
    return safes.get(key);
  }

  const themes = new Map();
  /** A theme asset's value, computed once per runtime (value assets are pure). */
  function themeOf(ref) {
    if (!themes.has(ref)) themes.set(ref, callValue(ref, {}));
    return themes.get(ref);
  }

  const easings = new Map();
  /** The curve called `name` from the composition's pinned easing asset. */
  function easeOf(comp) {
    return (name) => {
      if (!comp.easing) throw new AssetError(`a keyframe eases with "${name}", but the composition pins no easing asset (set composition.easing, e.g. "easing@1")`);
      let table = easings.get(comp.easing);
      if (!table) easings.set(comp.easing, (table = callValue(comp.easing, {})));
      const fn = table?.[name];
      if (typeof fn !== 'function') throw new AssetError(`unknown easing "${name}" in ${comp.easing}${Array.isArray(table?.names) ? ` (known: ${table.names.join(', ')})` : ''}`);
      return fn;
    };
  }

  /** Draw an image into a w × h box: contain (default), cover (cropped to the box) or fill. */
  function drawImageFit(ctx, img, w, h, fit = 'contain') {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (fit === 'fill') return ctx.drawImage(img, 0, 0, w, h);
    const k = fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
    const dw = img.width * k, dh = img.height * k;
    if (fit === 'cover') { ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); }
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /** The length of the timeline an item plays from: its own duration, or for a part of a split item the whole it was cut from. */
  const wholeOf = (item) => item.assetDuration ?? (item.offset ?? 0) + item.duration;

  /**
   * Where an item is at time t (clip seconds): its sampled state with motions applied, and its geometry. Null when invisible.
   * Keyframes, motions, effects and the asset itself run on the item's own timeline (`at` of `whole`), so the parts of a
   * split item play on as one; fadeIn and fadeOut belong to each part's own start and end on screen.
   */
  function layerState(comp, item, t, clip) {
    const { width, height } = comp;
    const lt = Math.max(0, t - item.start);
    const offset = item.offset ?? 0;
    const at = lt + offset;
    const s = sampleItem(item, at, easeOf(comp));
    let opacity = s.opacity;
    if (item.fadeIn > 0) opacity *= Math.min(1, lt / item.fadeIn);
    if (item.fadeOut > 0) opacity *= Math.min(1, (item.duration - lt) / item.fadeOut);
    let transform = s.transform;
    if (item.motions?.length) {
      const box = layerGeometry(transform, width, height);
      const m = motionDelta(comp, item, at, box, clip);
      const R = spaceRect(transform.space, width, height);
      transform = { ...transform, x: transform.x + m.x / R.width, y: transform.y + m.y / R.height, scale: transform.scale * m.scale, scaleX: transform.scaleX * m.scaleX, scaleY: transform.scaleY * m.scaleY, rotation: transform.rotation + m.rotation };
      opacity *= m.opacity;
    }
    if (opacity <= 0) return null;
    return { lt, at, whole: wholeOf(item), params: s.params, transform, opacity, geo: layerGeometry(transform, width, height) };
  }

  /**
   * The combined transform delta of an item's motions at time `at` of its own timeline: `in` runs at the
   * start of the whole and `out` at its end, so neither replays (or plays early) at the cut of a split item.
   */
  function motionDelta(comp, item, at, box, clip) {
    const out = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    const whole = wholeOf(item);
    item.motions.forEach((m, i) => {
      const e = entry(m.asset);
      if (e.def.kind !== 'motion') throw new AssetError(`item "${item.id}": ${m.asset} is a ${e.def.kind} asset, not a motion`);
      const phase = m.phase ?? 'in';
      const d = phase === 'loop' ? whole : Math.min(whole, m.duration ?? e.def.duration ?? 0.6);
      const start = phase === 'out' ? whole - d : phase === 'emphasis' ? m.at ?? 0 : 0;
      if (at < start || at > start + d) return;
      const r = invoke(e, m.params, {
        ctx: measureContext(), width: box.width, height: box.height, fps: comp.fps, t: at - start, duration: d, depth: 0,
        seed: hashSeed(comp.seed ?? 1, item.seedId ?? item.id, 'motion', i), clip, phase,
        format: formatOf(box.width, box.height), safe: { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, width: box.width, height: box.height },
      });
      const delta = checkMotion(r, m.asset);
      out.x += delta.x ?? 0; out.y += delta.y ?? 0;
      out.scale *= delta.scale ?? 1; out.scaleX *= delta.scaleX ?? 1; out.scaleY *= delta.scaleY ?? 1;
      out.rotation += delta.rotation ?? 0; out.opacity *= delta.opacity ?? 1;
    });
    out.opacity = Math.min(1, Math.max(0, out.opacity));
    return out;
  }

  function checkMotion(r, ref) {
    if (r === undefined || r === null) return {};
    if (typeof r !== 'object' || Array.isArray(r)) throw new AssetError(`a motion returns an object such as { x, y, scale, rotation, opacity }; got ${Array.isArray(r) ? 'an array' : typeof r}`, [ref]);
    for (const [k, v] of Object.entries(r)) {
      if (!MOTION_KEYS.includes(k)) throw new AssetError(`a motion returned "${k}"; it can return ${MOTION_KEYS.join(', ')}`, [ref]);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new AssetError(`a motion returned ${k}: ${String(v)}; every value must be a finite number`, [ref]);
    }
    return r;
  }

  /** Draw the item's content (an image or a visual asset) into target, with the canvas transform of its geometry. */
  function drawContent(target, comp, item, st, clip) {
    const { width, height, fps } = comp;
    const seq = sequences.get(item.asset);
    let img = images.get(item.asset);
    if (seq) {
      const index = sequenceIndex(seq, st.at, st.params.loop);
      img = seq.get(index);
      if (!img) throw new AssetError(`item "${item.id}": frame ${index} of ${item.asset} is not loaded`);
    }
    const e = img ? null : entry(item.asset);
    if (e && e.def.kind !== 'visual') throw new AssetError(`item "${item.id}": ${item.asset} is a ${e.def.kind} asset and cannot sit on a visual track${e.def.kind === 'effect' || e.def.kind === 'motion' || e.def.kind === 'transition' ? ` (attach it to an item: ${e.def.kind === 'effect' ? 'effects' : e.def.kind === 'motion' ? 'motions' : 'transition'})` : ''}`);
    const geo = st.geo;
    const depth = target.__saveDepth();
    target.save();
    const floor = target.__floor(depth + 1);
    try {
      target.beginPath();
      target.transform(...geo.matrix);
      if (img) drawImageFit(target, img, geo.width, geo.height, st.params.fit);
      else {
        invoke(e, st.params, {
          ctx: target, width: geo.width, height: geo.height, fps, t: st.at, duration: st.whole, depth: 0,
          seed: hashSeed(comp.seed ?? 1, item.seedId ?? item.id), clip,
          format: geo.full ? formatOf(width, height) : formatOf(geo.width, geo.height),
          safe: geo.full ? clipSafe(comp) : { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, width: geo.width, height: geo.height },
        });
      }
    } finally {
      target.__floor(floor);
      while (target.__saveDepth() > depth) target.restore();
    }
  }

  /**
   * Draw one composition-v2 item (already merged for the frame's format): its keyframed transform,
   * motions, opacity and params at this frame, placed with a canvas transform so vectors stay sharp;
   * then its effects and mask on a layer of its own.
   */
  function drawLayer(ctx, comp, item, t, clip) {
    if (item.hidden) return;
    try {
      const st = layerState(comp, item, t, clip);
      if (!st) return;
      const own = item.effects?.length || item.mask;
      const layered = own || st.opacity < 1 || (item.blend && item.blend !== 'source-over');
      drawingItem(item.id, layered ? st.opacity : 1, () => {
        if (!layered) return drawContent(ctx, comp, item, st, clip);
        let layer = offscreen(comp.width, comp.height);
        drawContent(layer.ctx, comp, item, st, clip);
        if (item.effects?.length) layer = applyEffects(layer, item.effects, comp, { t: st.at, duration: st.whole }, clip, item.seedId ?? item.id);
        if (item.mask) applyMask(layer, comp, item, st, t, clip);
        composite(ctx, layer.canvas, st.opacity, item.blend);
      });
    } catch (err) {
      if (err instanceof AssetError && !err.message.startsWith('item "')) err.message = `item "${item.id}" at ${t.toFixed(3)}s: ${err.message}`;
      throw err;
    }
  }

  function composite(ctx, canvas, opacity = 1, blend = 'source-over') {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = blend ?? 'source-over';
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }

  /** Run effects one after another on a layer; each draws a processed copy of the previous result. */
  function applyEffects(layer, list, comp, span, clip, owner) {
    let src = layer;
    list.forEach((fx, i) => {
      const e = entry(fx.asset);
      if (e.def.kind !== 'effect') throw new AssetError(`${fx.asset} is a ${e.def.kind} asset, not an effect`);
      const out = offscreen(comp.width, comp.height);
      invoke(e, fx.params, {
        ctx: out.ctx, width: comp.width, height: comp.height, fps: comp.fps, t: span.t, duration: span.duration, depth: 0,
        seed: hashSeed(comp.seed ?? 1, owner, 'effect', i), clip, source: src,
        format: formatOf(comp.width, comp.height), safe: clipSafe(comp),
      });
      src = out;
    });
    return src;
  }

  /** Keep the layer's pixels where the mask is opaque (or bright, or the inverse). */
  function applyMask(layer, comp, item, st, t, clip) {
    const m = item.mask;
    const mask = offscreen(comp.width, comp.height);
    const mItem = { id: `${item.id}:mask`, seedId: `${item.seedId ?? item.id}:mask`, asset: m.asset, start: item.start, duration: item.duration, params: m.params, offset: item.offset, assetDuration: item.assetDuration, transform: m.transform ?? st.transform };
    const mst = layerState(comp, mItem, t, clip);
    // text in a mask (block letters cut out of a photo) is the item's text: recorded as such
    if (cur) cur.mask = true;
    try {
      if (mst) drawContent(mask.ctx, comp, mItem, { ...mst, geo: m.transform ? mst.geo : st.geo }, clip);
    } finally {
      if (cur) cur.mask = false;
    }
    const mode = m.mode ?? 'alpha';
    if (mode.startsWith('luma')) {
      // brightness becomes coverage: the same arithmetic on every platform
      const img = mask.ctx.getImageData(0, 0, mask.width, mask.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = Math.round(((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3]) / 255);
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
      mask.ctx.putImageData(img, 0, 0);
    }
    layer.ctx.save();
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    layer.ctx.globalCompositeOperation = mode.endsWith('inverted') ? 'destination-out' : 'destination-in';
    layer.ctx.drawImage(mask.canvas, 0, 0);
    layer.ctx.restore();
  }

  /** A track with effects: its items on one layer, the effects over it, then onto the frame. */
  function drawTrackWithEffects(ctx, comp, tr, frame, t, clip, format) {
    const layer = offscreen(comp.width, comp.height);
    const handoff = transitionsAt(tr, frame, comp.fps);
    for (const item of tr.items) {
      if (handoff.outgoing.has(item)) continue;
      const tx = handoff.incoming.get(item);
      if (tx) { drawTransition(layer.ctx, comp, tx, t, clip, format); continue; }
      if (!activeAt(item, frame, comp.fps)) continue;
      drawLayer(layer.ctx, comp, forFormat(item, format), t, clip);
    }
    composite(ctx, applyEffects(layer, tr.effects, comp, { t, duration: comp.duration }, clip, `track:${tr.id}`).canvas);
  }

  /**
   * Transitions running on a track at this frame. An item with a transition hands over from the item
   * before it on the same track (the latest one that starts earlier); for the transition's duration
   * that item keeps playing, or holds its last frame if it has already ended. Like a motion, a
   * transition without a duration runs for its asset's own, else 0.5 s, and never for longer than its item.
   */
  function transitionsAt(tr, frame, fps) {
    const incoming = new Map(), outgoing = new Set();
    for (const item of tr.items) {
      if (!item.transition) continue;
      const duration = Math.min(wholeOf(item), item.transition.duration ?? entries.get(item.transition.asset)?.def.duration ?? 0.5);
      const a = Math.round(item.start * fps), d = Math.round(duration * fps);
      if (frame < a || frame >= a + d || !activeAt(item, frame, fps)) continue;
      let from = null;
      for (const other of tr.items) if (other !== item && other.start < item.start && (!from || other.start > from.start)) from = other;
      if (from && Math.round((from.start + from.duration) * fps) < a - 1) from = null;
      if (from) outgoing.add(from);
      incoming.set(item, { item, from, start: item.start, duration });
    }
    return { incoming, outgoing };
  }

  function drawTransition(ctx, comp, tx, t, clip, format) {
    const { item, from } = tx;
    const e = entry(item.transition.asset);
    if (e.def.kind !== 'transition') throw new AssetError(`item "${item.id}": ${item.transition.asset} is a ${e.def.kind} asset, not a transition`);
    const to = offscreen(comp.width, comp.height);
    // a transition moves and mixes these layers, so what is recorded in them is only roughly where it shows
    const was = inTransition;
    inTransition = true;
    let fromLayer = null;
    try {
      drawLayer(to.ctx, comp, forFormat(item, format), t, clip);
      if (from) {
        fromLayer = offscreen(comp.width, comp.height);
        // the outgoing item holds its last frame once it has ended
        const last = from.start + from.duration - 1 / comp.fps;
        drawLayer(fromLayer.ctx, comp, forFormat(from, format), Math.min(t, last), clip);
      }
    } finally {
      inTransition = was;
    }
    const out = offscreen(comp.width, comp.height);
    const lt = t - tx.start;
    try {
      invoke(e, item.transition.params, {
        ctx: out.ctx, width: comp.width, height: comp.height, fps: comp.fps, t: lt, duration: tx.duration, depth: 0,
        seed: hashSeed(comp.seed ?? 1, item.id, 'transition'), clip, from: fromLayer, to,
        format: formatOf(comp.width, comp.height), safe: clipSafe(comp),
      });
    } catch (err) {
      if (err instanceof AssetError) err.message = `item "${item.id}" at ${t.toFixed(3)}s (transition): ${err.message}`;
      throw err;
    }
    composite(ctx, out.canvas);
  }

  /**
   * A precomp layer with its aliases resolved through the owner's pins and its $param bindings filled.
   * A layer without a duration lasts for what is left of the owner's (`duration` seconds).
   */
  function bindLayer(owner, layer, values, i, duration) {
    if (!layer || typeof layer !== 'object') throw new AssetError(`f.layers(): layer ${i} is not an object`, [owner.ref]);
    const bind = (v) => {
      if (Array.isArray(v)) return v.map(bind);
      if (v && typeof v === 'object') {
        if (typeof v.$param === 'string') return values[v.$param];
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bind(x)]));
      }
      return v;
    };
    const pin = (alias) => resolve(owner, alias);
    const att = (a) => ({ ...a, asset: pin(a.asset), params: bind(a.params ?? {}) });
    const item = { ...layer, id: layer.id ?? `layer-${i + 1}`, asset: pin(layer.asset), start: layer.start ?? 0, duration: layer.duration ?? Math.max(0, duration - (layer.start ?? 0)), params: bind(layer.params ?? {}) };
    if (layer.motions) item.motions = layer.motions.map(att);
    if (layer.effects) item.effects = layer.effects.map(att);
    if (layer.mask) item.mask = att(layer.mask);
    if (layer.transition) item.transition = att(layer.transition);
    if (!item.transform) item.transform = {};
    return item;
  }

  /** The playground preview of a motion, transition or effect: applied to a built-in demo scene. */
  function drawKindDemo(ctx, e, params, env, background) {
    const { width: w, height: h } = env;
    const kind = e.def.kind;
    const scene = (which) => { const l = offscreen(w, h); drawDemo(l.ctx, w, h, which, lib); return l; };
    if (kind === 'effect') {
      const src = scene('scene');
      const out = offscreen(w, h);
      invoke(e, params, { ...env, ctx: out.ctx, source: src });
      ctx.drawImage(out.canvas, 0, 0);
    } else if (kind === 'transition') {
      const out = offscreen(w, h);
      invoke(e, params, { ...env, ctx: out.ctx, from: scene('a'), to: scene('b') });
      ctx.drawImage(out.canvas, 0, 0);
    } else {
      // a card that enters with the motion as 'in', rests, and leaves with it as 'out' (or loops)
      if (!background) drawDemo(ctx, w, h, 'floor', lib);
      const card = { width: 0.36, height: 0.36 * Math.min(w, h) / h };
      const d = Math.min(env.duration / 2, e.def.duration ?? 0.6);
      const loop = (params?.phase ?? null) === 'loop' || (e.def.tags ?? []).includes('loop');
      const phase = loop ? 'loop' : env.t < env.duration / 2 ? 'in' : 'out';
      const start = phase === 'out' ? env.duration - d : 0;
      const span = phase === 'loop' ? env.duration : d;
      let delta = {};
      if (env.t >= start && env.t <= start + span) {
        delta = checkMotion(invoke(e, params, { ...env, ctx: measureContext(), t: env.t - start, duration: span, phase, width: card.width * w, height: card.height * h }), e.ref);
      }
      const tf = { ...TRANSFORM_DEFAULTS, ...card };
      const R = { width: w, height: h };
      const geo = layerGeometry({ ...tf, x: tf.x + (delta.x ?? 0) / R.width, y: tf.y + (delta.y ?? 0) / R.height, scale: delta.scale ?? 1, scaleX: delta.scaleX ?? 1, scaleY: delta.scaleY ?? 1, rotation: delta.rotation ?? 0 }, w, h);
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, delta.opacity ?? 1));
      ctx.transform(...geo.matrix);
      drawDemo(ctx, geo.width, geo.height, 'card', lib);
      ctx.restore();
    }
  }

  /** Run a motion once (validation, tests): its delta at time t of the given phase. */
  function callMotion(ref, params, { phase = 'in', t = 0, duration = 0.6, width = 400, height = 300, fps = 30, seed = 1 } = {}) {
    const e = entry(ref);
    if (e.def.kind !== 'motion') throw new AssetError(`${ref} is a ${e.def.kind} asset, not a motion`);
    const env = { ...baseEnv(measureContext(), { width, height, fps, t, duration, seed }), phase };
    return checkMotion(invoke(e, params, env), ref);
  }

  return {
    lib, load, compile, setImage, setSequence, sequenceFramesAt, renderAsset, renderClipFrame, renderAudio, callValue, callMotion, takeTexts,
    has: (ref) => entries.has(ref) || images.has(ref) || sequences.has(ref),
    definition: (ref) => entry(ref).def,
    clearTextCache: () => lib.text.clearCache(),
  };
}
