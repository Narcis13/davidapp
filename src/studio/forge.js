// The forge: making assets ahead of the clips that will use them. Three parts sit on what the studio already has.
//
// - checkAsset (check_asset): the checks a clip gets (safe zone, cut text, overlap, size floor, contrast, glyphs),
//   run on one asset placed alone on a frame of each format it is made for. The result is kept on the version, and a
//   promotion reads it.
// - variants (asset_variants): one asset under several parameter sets or seeds, as a labelled grid, so a few good
//   looks can be kept as presets instead of new code.
// - the stage of an asset (library.js): a forge candidate stays out of search and suggest_assets until it is promoted,
//   or a clip uses it.

import { FORMATS, makeRef } from '../core/engine.js';
import { json, now } from '../db/db.js';
import { createCanvas, loadImage } from '../render/host.js';
import { resolveParams } from '../core/schema.js';
import { CHECKS } from './checks.js';
import { StudioError } from './library.js';

/**
 * The checks that mean something for an asset on its own. Left out: the first and last frame and the hold (they are about
 * where a clip starts, ends and cuts, not the asset) and the captions (a clip's captions).
 */
export const ASSET_CHECKS = ['safe-zone', 'clipped', 'overlap', 'size', 'contrast', 'glyphs'];
/** The most variants one grid shows. */
export const MAX_VARIANTS = 24;

const r2 = (v) => Math.round(v * 100) / 100;

/** @param {any} ctx @param {{ library: any, checks: any, assetSheet: (o: any) => Promise<any>, saveFrame: (name: string, png: Buffer) => string }} deps */
export function createForge(ctx, { library, checks, assetSheet, saveFrame }) {
  /**
   * Check one visual asset alone on a frame of each format (default: the formats it declares, else all three), over its
   * natural duration. pass: no issue of severity error in any format. Kept on the version (record: false to leave it out).
   * @param {{ ref: string, params?: any, formats?: string[], duration?: number, step?: number, only?: string[], background?: string, stills?: boolean, record?: boolean }} o
   */
  async function checkAsset({ ref, params = {}, formats, duration, step, only, background = '#101018', stills = true, record = true }) {
    const t0 = performance.now();
    const row = library.requireVersion(ref);
    const target = makeRef(row.slug, row.version);
    if (row.type !== 'function' || row.kind !== 'visual') {
      throw new StudioError(`${target} is ${row.type === 'function' ? `a ${row.kind} asset` : `a ${row.type} asset`}: check_asset checks visual assets, which draw on their own. A ${row.kind ?? row.type} is checked in a clip that uses it (check_clip).`, 'invalid');
    }
    const declared = json(row.formats, []);
    const list = formats?.length ? [...new Set(formats)] : declared.length ? declared : Object.keys(FORMATS);
    const unknown = list.filter((f) => !Object.hasOwn(FORMATS, f));
    if (unknown.length) throw new StudioError(`Unknown format ${unknown.map((f) => `"${f}"`).join(', ')}; use ${Object.keys(FORMATS).join(', ')}`);
    const use = only ?? ASSET_CHECKS;
    if (!Array.isArray(use) || !use.length || !use.every((c) => CHECKS.includes(c))) throw new StudioError(`only lists checks by name: ${CHECKS.join(', ')}`);
    const d = duration ?? row.duration ?? 3;
    if (!(d > 0 && d <= 120)) throw new StudioError('duration is 0–120 seconds');
    // finer than a clip's default: an asset is short, and an issue must last two sampled frames to count
    const every = step ?? Math.max(0.1, Math.min(0.5, d / 12));
    const out = [];
    for (const format of list) {
      const composition = { format, fps: 30, duration: d, background, tracks: [{ id: 'asset', type: 'visual', items: [{ id: 'asset', asset: target, start: 0, duration: d, params }] }] };
      const r = await checks.checkClip({ composition, step: every, only: use, stills, name: `asset-${row.slug}@${row.version}-${format}` });
      const issues = r.issues.map((i) => ({ check: i.check, severity: i.severity, t: i.t, until: i.until, message: i.message, numbers: i.numbers, still: i.still }));
      const errors = issues.filter((i) => i.severity === 'error').length;
      out.push({ format, pass: errors === 0, frames: r.frames, errors, warnings: issues.length - errors, issues, counts: Object.fromEntries(Object.entries(r.counts).filter(([k, n]) => use.includes(k) && n)) });
    }
    const errors = out.reduce((s, f) => s + f.errors, 0), warnings = out.reduce((s, f) => s + f.warnings, 0);
    const result = { asset: target, stage: row.stage ?? 'library', pass: errors === 0, errors, warnings, params, duration: d, step: r2(every), checks: use, background, formats: out, seconds: r2((performance.now() - t0) / 1000) };
    if (record) library.recordCheck(target, { at: now(), pass: result.pass, errors, warnings, params, duration: d, checks: use, formats: out.map((f) => ({ format: f.format, pass: f.pass, errors: f.errors, warnings: f.warnings, counts: f.counts })) });
    return { ...result, recorded: record };
  }

  /**
   * Every combination asked for: variants (parameter sets) × vary (each listed value of a parameter, crossed with the
   * others) × seeds. → [{ params, seed }]
   * @param {{ variants?: any[], vary?: Record<string, any[]>, seeds?: number[] }} o
   */
  function combinations({ variants, vary, seeds }) {
    // each variant is { params, seed } or a bare parameter set
    const norm = (v) => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new StudioError('a variant is a parameter set, or { params, seed }');
      return 'params' in v || 'seed' in v ? { params: { ...(v.params ?? {}) }, seed: v.seed } : { params: { ...v }, seed: undefined };
    };
    let list = (variants?.length ? variants : [{}]).map(norm);
    for (const [name, values] of Object.entries(vary ?? {})) {
      if (!Array.isArray(values) || !values.length) throw new StudioError(`vary.${name} is a list of values to try`);
      list = list.flatMap((v) => values.map((x) => ({ params: { ...v.params, [name]: x }, seed: v.seed })));
      if (list.length > MAX_VARIANTS) break;
    }
    if (seeds?.length) list = list.flatMap((v) => seeds.map((seed) => ({ ...v, seed })));
    if (list.length > MAX_VARIANTS) throw new StudioError(`That is ${list.length} variants or more; a grid shows at most ${MAX_VARIANTS}. Try fewer values, or split it in two calls.`);
    for (const v of list) if (v.seed !== undefined && !(Number.isInteger(v.seed) && v.seed >= 0)) throw new StudioError('a seed is a whole number ≥ 0');
    return list;
  }

  /** "color #ff0, radius 40" for a parameter set, kept short. */
  const describe = (params, seed) => {
    const parts = Object.entries(params).map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    if (seed !== undefined) parts.push(`seed ${seed}`);
    return parts.join(', ') || 'defaults';
  };

  /**
   * One asset under several parameter sets or seeds, as a grid: a row per variant (its number and what it changes), a few
   * frames across the asset's duration in each (or the one frame at t). → { asset, variants: [{ n, params, seed, label }],
   * png, path, times }
   * @param {{ ref: string, variants?: any[], vary?: Record<string, any[]>, seeds?: number[], frames?: number, t?: number, format?: string, duration?: number, background?: string }} o
   */
  async function variants({ ref, variants: given, vary, seeds, frames = 4, t, format, duration, background = '#101018' }) {
    const row = library.requireVersion(ref);
    const target = makeRef(row.slug, row.version);
    if (row.type !== 'function' || row.kind !== 'visual') throw new StudioError(`${target} is ${row.type === 'function' ? `a ${row.kind}` : `a ${row.type}`} asset: variants are drawn for visual assets, which draw on their own. Try a ${row.kind ?? row.type}'s variants in a clip (render_clip_frame with a draft composition).`, 'invalid');
    if (format !== undefined && !Object.hasOwn(FORMATS, format)) throw new StudioError(`Unknown format "${format}"; use ${Object.keys(FORMATS).join(', ')}`);
    const list = combinations({ variants: given, vary, seeds });
    // a value out of range would be clamped quietly, and the grid would show something else than its label says
    const schema = json(row.schema, {});
    for (const [i, v] of list.entries()) {
      const { errors } = resolveParams(schema, v.params, { strict: true });
      if (errors.length) throw new StudioError(`Variant ${i + 1} (${describe(v.params, v.seed)}) does not fit ${target}:\n- ${errors.map((e) => `${e.path}: ${e.message}`).join('\n- ')}`, 'invalid');
    }
    const d = duration ?? row.duration ?? 3;
    const n = t !== undefined ? 1 : Math.max(1, Math.min(8, frames));
    const fps = 30;
    const times = t !== undefined ? [Math.round(Math.min(Math.max(0, t), d) * fps) / fps] : Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) / n) * d * fps) / fps);
    const declared = json(row.formats, []);
    const shape = FORMATS[format ?? (declared.includes('horizontal') || !declared.length ? 'horizontal' : declared[0])];
    const wide = shape.width >= shape.height;
    const cellWidth = n === 1 ? (wide ? 400 : 240) : (wide ? 280 : 150);
    const strips = await Promise.all(list.map((v, i) => assetSheet({ ref: target, params: v.params, seed: v.seed ?? 1, times, cols: n, cellWidth, duration: d, width: shape.width, height: shape.height, background })
      .catch((e) => { throw new StudioError(`Variant ${i + 1} (${describe(v.params, v.seed)}): ${e.message}`, e.code ?? 'invalid'); })));
    const out = list.map((v, i) => ({ n: i + 1, params: v.params, seed: v.seed, label: describe(v.params, v.seed) }));
    const png = await grid(strips.map((s) => s.png), out.map((v) => `${v.n}  ${v.label}`));
    const path = saveFrame(`variants-${row.slug}@${row.version}-${Date.now().toString(36)}`, png);
    return { asset: target, variants: out, times, png, path };
  }

  /** The strips stacked, each under a label band (number and parameters). */
  async function grid(pngs, labels) {
    const imgs = await Promise.all(pngs.map((p) => loadImage(p)));
    const width = Math.max(...imgs.map((i) => i.width));
    const band = 26, gap = 8;
    const height = imgs.reduce((s, i) => s + band + i.height + gap, gap);
    const c = createCanvas(width + 2 * gap, height);
    const g = c.getContext('2d');
    g.fillStyle = '#16161d';
    g.fillRect(0, 0, c.width, c.height);
    let y = gap;
    for (const [k, img] of imgs.entries()) {
      g.fillStyle = '#ffffff';
      g.font = '600 14px "JetBrains Mono"';
      let text = labels[k];
      while (text.length > 4 && g.measureText(text).width > width) text = `${text.slice(0, -2)}…`;
      g.fillText(text, gap, y + 18);
      g.drawImage(img, gap, y + band);
      y += band + img.height + gap;
    }
    return c.toBuffer('image/png');
  }

  return { checkAsset, variants, combinations, ASSET_CHECKS };
}
