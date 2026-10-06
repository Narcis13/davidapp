// The Node host for the asset runtime: Skia canvases from @napi-rs/canvas, the bundled fonts,
// and a vm sandbox that evaluates asset source with nothing but JS builtins in scope.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

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
  for (const fam of fontManifest()) for (const f of fam.files) GlobalFonts.registerFromPath(join(FONTS_DIR, f.file), fam.family);
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

/** Evaluate asset source in a fresh context and return what it passed to asset({...}). */
export function evaluate(source, filename = 'asset.js') {
  let captured, calls = 0;
  const sandbox = {
    asset: (def) => { calls++; captured = def; },
    console: { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
  };
  const context = vm.createContext(sandbox, { name: filename, codeGeneration: { strings: false, wasm: false } });
  guardScript.runInContext(context);
  new vm.Script(source, { filename }).runInContext(context, { timeout: 2000 });
  if (calls !== 1) throw new Error(calls ? 'asset({...}) was called more than once; one source declares one asset' : 'The source never called asset({...})');
  return captured;
}

export const nodeHost = { evaluate, createCanvas };
export { createCanvas, loadImage };

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
