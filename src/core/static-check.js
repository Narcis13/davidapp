// A first pass over asset source before it is compiled: catch the things that would make a frame
// depend on anything but (t, params), and explain what to use instead. The sandbox enforces the
// same rules at run time; this pass exists for the error messages.

/** @type {[RegExp, string][]} */
const RULES = [
  [/\bMath\s*\.\s*random\b/, 'Math.random() is not allowed: frames must be reproducible. Use f.rng() (seeded per asset instance) instead.'],
  [/\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|\bperformance\s*\.\s*now\b/, 'Wall-clock time is not allowed: a frame is a pure function of (t, params). Use f.t, f.frame or f.clip.t.'],
  [/\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, 'Timers are not available: render() must draw the frame synchronously from f.t.'],
  [/\bimport\s*\(|\bimport\s+[\w{*]|\brequire\s*\(/, 'Modules are not available inside an asset. Compose other assets with `uses: [...]` and f.use(), and use f.lib for helpers.'],
  [/\b(fetch|XMLHttpRequest|WebSocket|importScripts)\b/, 'Network access is not available inside an asset. Images come from image assets via f.image().'],
  [/\b(process|globalThis|window|document|self)\s*[.[]/, 'Host globals are not available inside an asset: everything it needs arrives through f and params.'],
  [/\beval\s*\(|\bnew\s+Function\b/, 'eval and new Function are not allowed inside an asset.'],
  [/\b(async\s+function|await\s)/, 'Assets are synchronous: render() must return after drawing the frame.'],
];

/** Replace comments and string/template contents with spaces, keeping line breaks and offsets. */
export function stripLiterals(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const ch = source[i], next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out += blank(source.slice(i, stop)); i = stop;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(source.slice(i, stop)); i = stop;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && source[j] !== ch) {
        if (source[j] === '\\') j++;
        else if (ch !== '`' && source[j] === '\n') break;
        j++;
      }
      out += ch + blank(source.slice(i + 1, j)) + (j < n ? source[j] : ''); i = j + 1;
    } else { out += ch; i++; }
  }
  return out;
}

/** Returns [{ line, message }] for every rule the source breaks. */
export function staticCheck(source) {
  const problems = [];
  if (typeof source !== 'string' || !source.trim()) return [{ line: 1, message: 'The asset source is empty.' }];
  if (source.length > 200_000) return [{ line: 1, message: `The asset source is ${source.length} characters; the limit is 200000.` }];
  const code = stripLiterals(source);
  for (const [re, message] of RULES) {
    const m = re.exec(code);
    if (m) problems.push({ line: code.slice(0, m.index).split('\n').length, message });
  }
  if (!/\basset\s*\(/.test(code)) problems.push({ line: 1, message: 'The source never calls asset({...}). An asset is declared with a single asset({ description, tags, params, render(f, p) { … } }) call.' });
  return problems;
}
