// How a browser evaluates asset source (the studio preview and the share-page player).
// The Node renderer uses a vm context instead (src/render/host.js); both close the same gaps.
//
// Hiding fetch and Function as names is not enough: `({}).constructor.constructor(...)` reaches
// the real Function, and a function built that way does not see the hidden names. The constructors
// that compile strings are replaced for this realm, and import() / eval() are rejected from the
// source (including when the parentheses are written as a unicode escape).

import { stripLiterals } from './static-check.js';

// `eval` cannot be a strict-mode parameter name, so a call to it is rejected by dynamicCode instead.
const HIDDEN = ['self', 'globalThis', 'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'setTimeout', 'setInterval',
  'requestAnimationFrame', 'queueMicrotask', 'performance', 'postMessage', 'close', 'caches', 'indexedDB', 'navigator', 'location', 'Function', 'Worker', 'onmessage'];

const no = (what, instead) => { throw new Error(`${what} is not available inside an asset: frames must be a pure function of (t, params). ${instead}`); };
const SafeMath = Object.freeze(Object.fromEntries([...Object.getOwnPropertyNames(Math).map((k) => [k, Math[k]]), ['random', () => no('Math.random()', 'Use f.rng().')]]));
const SafeDate = new Proxy(Date, {
  construct(T, args) { if (!args.length) no('new Date()', 'Use f.t or f.clip.t.'); return Reflect.construct(T, args); },
  apply() { no('Date()', 'Use f.t or f.clip.t.'); },
  get(T, k) { return k === 'now' ? () => no('Date.now()', 'Use f.t or f.clip.t.') : T[k]; },
});
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

const deny = function assetIsolateDenied() {
  throw new Error('eval and new Function are not available inside an asset.');
};

let installed = false;
/** Replace the constructors that compile strings, in this realm only. Idempotent. */
export function installAssetIsolate() {
  if (installed) return;
  installed = true;
  const poison = (sample) => {
    try {
      const C = sample?.constructor;
      if (!C?.prototype || C.prototype.constructor === deny) return;
      Object.defineProperty(C.prototype, 'constructor', { configurable: true, writable: true, value: deny });
    } catch { /* this realm froze that constructor */ }
  };
  poison(function () {});
  poison(function* () {});
  poison(async function () {});
  poison(async function* () {});
}

/** Turn `\uXXXX` escapes into characters so a check sees the code the parser will. */
function decoded(code) {
  return code.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (all, braced, short) => {
    const cp = parseInt(braced ?? short, 16);
    if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return all;
    return String.fromCodePoint(cp);
  });
}

/**
 * A message when the source compiles strings or imports a module, otherwise null.
 * Comments and string contents are ignored; unicode escapes outside them are not.
 * @param {string} source
 */
export function dynamicCode(source) {
  const code = decoded(stripLiterals(source));
  if (/\bimport\s*\(/.test(code)) return 'import() is not available inside an asset. Compose other assets with `uses: [...]` and f.use().';
  if (/\beval\s*\(|\bnew\s+Function\b/.test(code)) return 'eval and new Function are not available inside an asset.';
  return null;
}

/**
 * Compile one asset source the way the preview and the player do.
 * The source string starts with `"use strict";` on its first line, which is the wrapper the workers' lineOffset already accounts for.
 * @param {string} source @param {string} [filename]
 */
export function evaluateBrowser(source, filename = 'asset.js') {
  installAssetIsolate();
  const blocked = dynamicCode(source);
  if (blocked) throw new Error(blocked);
  let captured, calls = 0;
  const fn = new Function('asset', 'console', 'Math', 'Date', ...HIDDEN, `"use strict"; ${source}\n//# sourceURL=${filename}`);
  fn((def) => { calls++; captured = def; }, quiet, SafeMath, SafeDate);
  if (calls !== 1) throw new Error(calls ? 'asset({...}) was called more than once; one source declares one asset' : 'The source never called asset({...})');
  return captured;
}
