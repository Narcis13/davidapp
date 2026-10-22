// The Node host for the asset runtime: Skia canvases from @napi-rs/canvas, the bundled fonts,
// and a vm sandbox that evaluates asset source with nothing but JS builtins in scope.

import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { dynamicCode } from '../core/isolate.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FONTS_DIR = join(ROOT, 'fonts');

let manifest;
export function fontManifest() {
  return (manifest ??= JSON.parse(readFileSync(join(FONTS_DIR, 'fonts.json'), 'utf8')));
}

let fontsRegistered = false;
/** Register every bundled font file with Skia (once per thread). */
export function registerFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const fam of fontManifest()) {
    for (const f of fam.files) GlobalFonts.registerFromPath(join(FONTS_DIR, f.file), fam.family);
    // the Latin Extended files go under their own alias, which fontString puts right after the family
    for (const f of fam.ext?.files ?? []) GlobalFonts.registerFromPath(join(FONTS_DIR, f.file), fam.ext.family);
  }
}

const fontSetsRegistered = new Set();
/**
 * Register the uploaded fonts a bundle carries: { <alias>: { family, files: [{ path, weight, style }] } }. Each set goes under
 * the alias that names exactly those files (never under the family name, so another version of the family cannot hijack it).
 * Idempotent per thread: a set already registered is not registered again, so a worker can load any number of bundles.
 * @param {Record<string, { family: string, files: { path: string, weight?: number, style?: string }[] }>} [fonts]
 */
export function registerFontSets(fonts) {
  for (const [alias, set] of Object.entries(fonts ?? {})) {
    if (fontSetsRegistered.has(alias)) continue;
    for (const f of set.files) {
      if (!existsSync(f.path)) throw new Error(`The font file of "${set.family}" is missing: ${f.path}`);
      if (!GlobalFonts.registerFromPath(f.path, alias)) throw new Error(`The font file of "${set.family}" could not be loaded (${f.path}); it may be damaged`);
    }
    fontSetsRegistered.add(alias);
  }
}

// Runs inside each sandbox before the asset: no randomness, no wall clock.
const GUARD = `(() => {
  const no = (what, instead) => { throw new Error(what + ' is not available inside an asset: frames must be a pure function of (t, params). ' + instead); };
  Math.random = () => no('Math.random()', 'Use f.rng().');
  const D = Date;
  globalThis.Date = new Proxy(D, {
    construct(T, args) { if (!args.length) no('new Date()', 'Use f.t or f.clip.t.'); return new T(...args); },
    apply() { no('Date()', 'Use f.t or f.clip.t.'); },
    get(T, k) { return k === 'now' ? () => no('Date.now()', 'Use f.t or f.clip.t.') : T[k]; },
  });
})()`;
const guardScript = new vm.Script(GUARD, { filename: 'sandbox-guard.js' });

// asset() and console live inside the context, so a render cannot follow them out to this process.
// Constructors that compile strings are replaced in the context only. __log is removed before user source runs.
const PRELUDE = `"use strict";
(() => {
  const send = globalThis.__log;
  delete globalThis.__log;
  const show = (v) => {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  };
  const line = (level) => (...args) => send(level, args.map(show).join(' '));
  globalThis.console = { log: line('log'), info: line('info'), warn: line('warn'), error: line('error'), debug: line('debug') };
  const deny = function assetIsolateDenied() { throw new Error('eval and new Function are not available inside an asset.'); };
  const poison = (sample) => {
    try {
      const C = sample.constructor;
      if (!C || !C.prototype || C.prototype.constructor === deny) return;
      Object.defineProperty(C.prototype, 'constructor', { configurable: true, writable: true, value: deny });
    } catch (e) { /* some realms freeze a constructor; the context still refuses strings */ }
  };
  poison(function () {});
  poison(function* () {});
  poison(async function () {});
  poison(async function* () {});
  globalThis.asset = (def) => { globalThis.__calls = (globalThis.__calls || 0) + 1; globalThis.__captured = def; };
})();`;
const preludeScript = new vm.Script(PRELUDE, { filename: 'sandbox-prelude.js' });

const logs = [];
/** Lines written with console.* by asset code since the last call. */
export function takeLogs() {
  return logs.splice(0, logs.length);
}
const show = (v) => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};
const log = (level) => (...args) => { if (logs.length < 100) logs.push(`${level}: ${args.map(show).join(' ')}`.slice(0, 500)); };

// While an asset render runs, a host function's .constructor must not be the real Function.
// Restored afterwards, and only when the outermost asset returns (assets call each other).
const denyHost = function assetIsolateDenied() {
  throw new Error('eval and new Function are not available inside an asset.');
};
let sealDepth = 0;
let savedConstructor;
function seal(fn) {
  return function sealedAsset(...args) {
    if (sealDepth === 0) {
      savedConstructor = Object.getOwnPropertyDescriptor(Function.prototype, 'constructor');
      Object.defineProperty(Function.prototype, 'constructor', { configurable: true, writable: true, value: denyHost });
    }
    sealDepth++;
    try { return fn.apply(this, args); }
    finally {
      sealDepth--;
      if (sealDepth === 0 && savedConstructor) Object.defineProperty(Function.prototype, 'constructor', savedConstructor);
    }
  };
}

/** Evaluate asset source in a fresh context and return what it passed to asset({...}). */
export function evaluate(source, filename = 'asset.js') {
  const blocked = dynamicCode(source);
  if (blocked) throw new Error(blocked);
  const sandbox = { __log: (level, text) => log(level)(text) };
  const context = vm.createContext(sandbox, { name: filename, codeGeneration: { strings: false, wasm: false } });
  preludeScript.runInContext(context);
  guardScript.runInContext(context);
  // one strict line before the source, subtracted again by nodeHost.lineOffset
  new vm.Script(`"use strict";\n${source}`, { filename }).runInContext(context, { timeout: 2000 });
  const calls = sandbox.__calls || 0;
  if (calls !== 1) throw new Error(calls ? 'asset({...}) was called more than once; one source declares one asset' : 'The source never called asset({...})');
  const def = sandbox.__captured;
  if (def && typeof def === 'object') {
    if (typeof def.render === 'function') def.render = seal(def.render);
    if (typeof def.preview === 'function') def.preview = seal(def.preview);
  }
  return def;
}

export const nodeHost = { evaluate, createCanvas, lineOffset: 1 };
export { createCanvas, loadImage };

/**
 * Options for the context of a canvas the runtime draws a frame on. An effect on the whole clip reads
 * the frame back (getImageData), and a browser canvas has to be told so when its context is made; the
 * preview worker passes the same. Skia ignores it: nothing changes in what Node draws.
 */
export const FRAME_CONTEXT = /** @type {any} */ ({ willReadFrequently: true });

/** Two PNGs next to each other on one dark canvas (version diffs, before/after). */
export async function sideBySide(a, b, gap = 12) {
  const [A, B] = await Promise.all([loadImage(a), loadImage(b)]);
  const c = createCanvas(A.width + B.width + gap, Math.max(A.height, B.height));
  const g = c.getContext('2d');
  g.fillStyle = '#16161d';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(A, 0, 0);
  g.drawImage(B, A.width + gap, 0);
  return c.toBuffer('image/png');
}
