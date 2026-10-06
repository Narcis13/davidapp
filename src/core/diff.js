// A line diff (Myers' O(ND) algorithm), for comparing two versions of an asset's source. Shared by
// the server (MCP diff_versions) and the studio's diff view.

/**
 * @param {string} a old text
 * @param {string} b new text
 * @returns {{ op: 'same' | 'del' | 'add', text: string, a: number | null, b: number | null }[]} line numbers are 1-based
 */
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length, max = n + m;
  const v = new Map([[1, 0]]);
  const trace = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }
  // walk back through the trace to recover the edit script
  const out = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d], k = x - y;
    const prevK = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const px = vv.get(prevK) ?? 0, py = px - prevK;
    while (x > px && y > py) { out.push({ op: 'same', text: A[x - 1], a: x, b: y }); x--; y--; }
    if (d > 0) {
      if (x === px) { out.push({ op: 'add', text: B[y - 1], a: null, b: y }); y--; } else { out.push({ op: 'del', text: A[x - 1], a: x, b: null }); x--; }
    }
  }
  return out.reverse();
}

/** A unified diff with `context` lines around each change. */
export function unified(lines, { context = 3, from = 'a', to = 'b' } = {}) {
  const changed = lines.map((l) => l.op !== 'same');
  const keep = lines.map((_, i) => changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));
  const out = [`--- ${from}`, `+++ ${to}`];
  let i = 0;
  while (i < lines.length) {
    if (!keep[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && keep[j]) j++;
    const hunk = lines.slice(i, j);
    const aStart = hunk.find((l) => l.a !== null)?.a ?? 0, bStart = hunk.find((l) => l.b !== null)?.b ?? 0;
    out.push(`@@ -${aStart},${hunk.filter((l) => l.op !== 'add').length} +${bStart},${hunk.filter((l) => l.op !== 'del').length} @@`);
    for (const l of hunk) out.push(`${l.op === 'same' ? ' ' : l.op === 'del' ? '-' : '+'}${l.text}`);
    i = j;
  }
  return out.join('\n');
}
