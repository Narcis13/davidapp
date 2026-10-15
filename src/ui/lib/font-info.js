// What a font file says about itself, read in the browser before it is uploaded (the form shows it, so the
// person sees what will be saved): family, weight, style and the licence note the file carries. TTF and OTF
// are read from their `name`, `OS/2`, `head` and `maxp` tables. WOFF2 is Brotli-compressed and the browser has
// no Brotli decoder for it, so a WOFF2 file is only recognised: the studio reads it when it is saved.

const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
export const weightName = (w) => WEIGHT_NAMES[w] ?? WEIGHT_NAMES[Math.round(w / 100) * 100] ?? String(w);

/** The file kind from its first bytes: 'ttf', 'otf', 'woff2', 'woff', 'ttc' or null. */
function kindOf(view) {
  if (view.byteLength < 12) return null;
  const tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'ttcf') return 'ttc';
  if (tag === 'OTTO') return 'otf';
  if (view.getUint32(0) === 0x00010000 || tag === 'true') return 'ttf';
  return null;
}

/** The strings of a `name` table by name id: the first English one, else any. */
function names(view, at, length) {
  const count = view.getUint16(at + 2), strings = at + view.getUint16(at + 4);
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const r = at + 6 + i * 12;
    if (r + 12 > at + length) break;
    const platform = view.getUint16(r), lang = view.getUint16(r + 4), id = view.getUint16(r + 6), len = view.getUint16(r + 8), off = view.getUint16(r + 10);
    const start = strings + off;
    if (start + len > view.byteLength) continue;
    let text = '';
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(view.getUint16(start + k));
    else if (platform === 1) for (let k = 0; k < len; k++) text += String.fromCharCode(view.getUint8(start + k));
    else continue;
    const english = platform === 1 ? lang === 0 : lang === 0x409;
    const rank = english ? 2 : 1;
    if (text && (best.get(id)?.rank ?? 0) < rank) best.set(id, { text: text.trim(), rank });
  }
  return (id) => best.get(id)?.text ?? '';
}

/**
 * @param {File | Blob} file
 * @returns {Promise<{ format: string, family?: string, subfamily?: string, weight?: number, style?: 'normal' | 'italic', glyphs?: number, license?: string, readable: boolean } | null>}
 *   null when the bytes are not a font at all
 */
export async function readFontInfo(file) {
  const view = new DataView(await file.slice(0, Math.min(file.size, 4_000_000)).arrayBuffer());
  const format = kindOf(view);
  if (!format) return null;
  if (format !== 'ttf' && format !== 'otf') return { format, readable: false };
  const tables = new Map();
  const n = view.getUint16(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (r + 16 > view.byteLength) break;
    tables.set(String.fromCharCode(view.getUint8(r), view.getUint8(r + 1), view.getUint8(r + 2), view.getUint8(r + 3)), { at: view.getUint32(r + 8), length: view.getUint32(r + 12) });
  }
  const out = { format, readable: true };
  try {
    const name = tables.get('name');
    if (name) {
      const get = names(view, name.at, name.length);
      out.family = get(16) || get(1) || undefined;
      out.subfamily = get(17) || get(2) || undefined;
      out.license = get(13) || undefined;
    }
    const os2 = tables.get('OS/2'), head = tables.get('head'), maxp = tables.get('maxp');
    out.weight = os2 && os2.length >= 6 ? view.getUint16(os2.at + 4) : 400;
    const italic = (os2 && os2.length >= 64 ? view.getUint16(os2.at + 62) & 1 : 0) || (head && head.length >= 46 ? (view.getUint16(head.at + 44) >> 1) & 1 : 0) || /italic|oblique/i.test(out.subfamily ?? '');
    out.style = italic ? 'italic' : 'normal';
    if (maxp) out.glyphs = view.getUint16(maxp.at + 4);
  } catch { /* a damaged table: the studio says what is wrong when it reads the file */ }
  return out;
}
