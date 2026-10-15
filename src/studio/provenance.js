// Provenance: where a file asset came from and what may be done with it.
//
// Every version of a file asset (image, sound, video, font, sequence) carries meta.provenance:
//   { license, licenseUrl, sourceUrl, creator, credit, date, aiGenerated, contentId, restrictions, placeholder, redistributable }
// Function assets (code written in the studio) are original by definition and carry none. A baked file keeps
// `derivedFrom` (what it was made from). Provenance lives in the version's meta column, which may be updated
// (the immutability trigger guards source, file, deps and the rest), so editing it never makes a new version; the
// edit is recorded as meta.provenanceEdit = { by, at }. meta.license is kept equal to provenance.license because
// older code reads it.
//
// This module is the shape (parse, validate, defaults, the read side that understands rows written before it
// existed) and the service that turns a clip's closure into credits, sources and problems, and decides whether a
// final render may go ahead.

import { json, now } from '../db/db.js';
import { makeRef } from '../core/engine.js';
import { StudioError } from './library.js';

export const FIELDS = ['license', 'licenseUrl', 'sourceUrl', 'creator', 'credit', 'date', 'aiGenerated', 'contentId', 'restrictions', 'placeholder', 'redistributable'];
const BOOLEANS = ['aiGenerated', 'contentId', 'placeholder', 'redistributable'];
const URLS = ['licenseUrl', 'sourceUrl'];
const LIMITS = { license: 200, creator: 200, credit: 300, restrictions: 500, licenseUrl: 500, sourceUrl: 500 };

/** snake_case spellings (MCP, query strings) → the field names. */
const ALIASES = { license_url: 'licenseUrl', source_url: 'sourceUrl', ai_generated: 'aiGenerated', content_id: 'contentId' };

/** The licence kinds a file asset may be committed to a public repo under, unless said otherwise. */
const OPEN = /^(original|cc0(-1\.0)?|cc-by(-[a-z]+)*(-[0-9.]+)?|public domain|ofl(-1\.[01])?|sil ofl.*|mit|isc|apache(-2\.0)?|bsd(-[0-9]-clause)?|0bsd|unlicense|mpl-2\.0)$/i;

/** No licence recorded: null, empty, or the word "unknown". */
export const isUnknownLicense = (license) => license === null || license === undefined || /^\s*(unknown|n\/a|none|\?)?\s*$/i.test(String(license));

/** May a file under this licence be committed to a public repo? Unknown: no. */
/** A licence string may say more after its identifier ("Apache-2.0 (Kokoro-82M weights and voices)"): the identifier decides. */
export const defaultRedistributable = (license) => !isUnknownLicense(license) && (OPEN.test(String(license).trim()) || OPEN.test(String(license).trim().split(/\s*[(;,]|\s+-\s+/)[0]));

const isoDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

/**
 * Check provenance input and return it with the canonical field names. Only the given fields are returned, so a partial
 * update leaves the others alone. null clears a text field. Strings are trimmed; "" is null.
 * @param {any} input @param {{ label?: string }} [o]
 * @returns {Partial<Record<string, any>>}
 */
export function parseProvenance(input, { label = 'provenance' } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new StudioError(`${label} is an object of ${FIELDS.join(', ')}`);
  const out = {};
  const problems = [];
  for (const [rawKey, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const key = ALIASES[rawKey] ?? rawKey;
    if (!FIELDS.includes(key)) { problems.push(`unknown field "${rawKey}" (the fields are ${FIELDS.join(', ')})`); continue; }
    if (BOOLEANS.includes(key)) {
      if (typeof value !== 'boolean') problems.push(`${key} must be true or false; got ${JSON.stringify(value)}`);
      else out[key] = value;
      continue;
    }
    if (value === null) { out[key] = null; continue; }
    if (typeof value !== 'string') { problems.push(`${key} must be text or null; got ${JSON.stringify(value)}`); continue; }
    const text = value.trim();
    if (LIMITS[key] && text.length > LIMITS[key]) { problems.push(`${key} is at most ${LIMITS[key]} characters (${text.length} given)`); continue; }
    if (URLS.includes(key) && text) {
      let url = null;
      try { url = new URL(text); } catch { /* reported below */ }
      if (!url || !/^https?:$/.test(url.protocol) || /\s/.test(text)) { problems.push(`${key} must be a web address starting with http:// or https://; got "${text.slice(0, 80)}"`); continue; }
    }
    if (key === 'date' && text && !isoDate(text)) { problems.push(`date must be an ISO date such as 2025-03-14 (when it was made or obtained); got "${text.slice(0, 40)}"`); continue; }
    out[key] = text === '' ? null : text;
  }
  if (problems.length) throw new StudioError(`${label}:\n- ${problems.join('\n- ')}`, 'invalid', { problems });
  return out;
}

/** The provenance input of an MCP call's snake_case arguments (or a query string's), as the object parseProvenance takes. */
export function fromArgs(a) {
  const pick = {};
  for (const [from, to] of [['license', 'license'], ['license_url', 'licenseUrl'], ['source_url', 'sourceUrl'], ['creator', 'creator'], ['credit', 'credit'], ['date', 'date'], ['ai_generated', 'aiGenerated'], ['content_id', 'contentId'], ['restrictions', 'restrictions'], ['placeholder', 'placeholder'], ['redistributable', 'redistributable']]) {
    if (a?.[from] !== undefined) pick[to] = a[from];
  }
  return pick;
}

/** The provenance input in a URL's query string (snake_case; true/false/1/0/yes/no for the flags). @param {URLSearchParams} query */
export function fromQuery(query) {
  const a = {};
  for (const key of ['license', 'license_url', 'source_url', 'creator', 'credit', 'date', 'restrictions', 'ai_generated', 'content_id', 'placeholder', 'redistributable']) {
    const v = query.get(key);
    if (v === null) continue;
    if (['ai_generated', 'content_id', 'placeholder', 'redistributable'].includes(key)) {
      const s = v.trim().toLowerCase();
      a[key] = ['true', '1', 'yes'].includes(s) ? true : ['false', '0', 'no'].includes(s) ? false : v;
    } else a[key] = v;
  }
  return fromArgs(a);
}

/**
 * The full record stored on a new file version. `given` is what the caller said (see parseProvenance); everything else is
 * recorded as it is: no licence is null (unknown), not a guess. `defaultLicense` is for files the studio made itself.
 * @param {any} given @param {{ defaultLicense?: string | null, derivedFrom?: string | null, defaults?: any }} [o]
 */
export function buildProvenance(given, { defaultLicense = null, derivedFrom = null, defaults = {} } = {}) {
  const g = given ? parseProvenance(given) : {};
  const license = g.license !== undefined ? g.license : defaultLicense;
  const record = {
    license, licenseUrl: null, sourceUrl: null, creator: null, credit: null, date: now().slice(0, 10),
    aiGenerated: false, contentId: false, restrictions: null, placeholder: false, redistributable: defaultRedistributable(license),
    ...defaults, ...g,
  };
  if (g.redistributable === undefined && defaults.redistributable === undefined) record.redistributable = defaultRedistributable(record.license);
  if (derivedFrom) record.derivedFrom = derivedFrom;
  return record;
}

/**
 * Apply a partial edit to a version's meta (a parsed patch) → the new meta. Keeps meta.license equal to the licence, moves
 * redistributable with the licence when it was only the default of the old one, and records who and when.
 * @param {any} meta @param {any} current the provenance as read (provenanceOf) @param {any} patch @param {string} by
 */
export function applyPatch(meta, current, patch, by) {
  if (!Object.keys(patch).length) throw new StudioError(`Give at least one of ${FIELDS.join(', ')} to change`);
  const next = { ...stored(current), ...patch };
  if (patch.license !== undefined && patch.redistributable === undefined && current.redistributable === defaultRedistributable(current.license)) next.redistributable = defaultRedistributable(next.license);
  const { recorded: _r, edit: _e, ...clean } = next;
  return { ...meta, license: next.license, provenance: clean, provenanceEdit: { by, at: now() } };
}

/** The fields that are stored (the read side adds recorded and edit). */
const stored = (p) => { const { recorded: _r, edit: _e, ...rest } = p; return rest; };

/**
 * What a version row says about provenance, for every kind of row: new ones carry meta.provenance; older ones only a licence
 * (and a font's source), read as unknown where they never said. null for a function asset (original by definition).
 * @param {any} row a version row (type, meta)
 */
export function provenanceOf(row) {
  if (row.type === 'function') return null;
  const meta = json(row.meta, {});
  const edit = meta.provenanceEdit ?? null;
  if (meta.provenance) {
    const p = { ...blank(), ...meta.provenance };
    return edit ? { ...p, edit } : p;
  }
  // rows from before provenance existed: a licence string, and for fonts the source text
  const p = blank();
  const old = typeof meta.license === 'string' ? meta.license.trim() : null;
  if (old && /^uploaded by the user$/i.test(old)) { p.recorded = old; p.license = null; } else p.license = old || null;
  // a baked sequence never recorded a licence: the studio made it from its own assets
  if (row.type === 'sequence' && !p.license) { p.license = 'original'; if (meta.bakedFrom) p.derivedFrom = meta.bakedFrom; }
  if (typeof meta.source === 'string' && /^https?:\/\//i.test(meta.source)) p.sourceUrl = meta.source.trim().split(/\s/)[0];
  p.redistributable = defaultRedistributable(p.license);
  return p;
}

function blank() {
  return { license: null, licenseUrl: null, sourceUrl: null, creator: null, credit: null, date: null, aiGenerated: false, contentId: false, restrictions: null, placeholder: false, redistributable: false };
}

/** The voice of a narration ({ name, model, license, source }), from either place it may be recorded. */
export const voiceOf = (meta) => meta?.voice ?? meta?.narration?.voice ?? null;

// ── credits ──────────────────────────────────────────────────────────────────────────────

const GROUPS = [['footage', 'Footage'], ['images', 'Images'], ['sound', 'Sound and music'], ['voice', 'Voice'], ['fonts', 'Fonts']];
/** A narration's voice as add_narration records it ({ name, model }) or as generate_narration does ({ voice, engine }). */
const voiceName = (v) => v.name ?? v.voice ?? v.id ?? null;
const voiceModel = (v) => v.model ?? v.engine ?? null;

const LABEL = { footage: 'Footage', images: 'Image', sound: 'Sound', voice: 'Voice', fonts: 'Font' };
const ORIGINAL_LINE = 'Motion graphics: original, made in Fablecut';

/** Which group of the credits a file version belongs to. */
function groupOf(row, tags) {
  if (row.type === 'video') return 'footage';
  if (row.type === 'font') return 'fonts';
  if (row.type === 'sound') return json(row.meta, {}).narration || voiceOf(json(row.meta, {})) ? 'voice' : 'sound';
  return tags.includes('music') ? 'sound' : 'images';
}

const mdText = (s) => String(s).replace(/([\\`*[\]<>|])/g, '\\$1').replace(/\r?\n/g, ' ');
/** Text we wrote ourselves (problems, notes): only what would turn into markup is escaped, so { … } and [ … ] stay readable. */
const mdNote = (s) => String(s).replace(/([\\`*<>|])/g, '\\$1').replace(/\r?\n/g, ' ');
const licenseLabel = (p) => (isUnknownLicense(p.license) ? 'licence unknown' : p.licenseUrl ? `[${mdText(p.license)}](${p.licenseUrl})` : mdText(p.license));

/**
 * @param {any} ctx @param {any} library
 */
export function createProvenance(ctx, library) {
  const { db } = ctx;
  const q = (sql) => db.prepare(sql);

  /** The pinned refs of a clip's closure (what was saved), or of a render (what it was queued with), deps of deps and fonts included. */
  function refsOf({ clip, renderId }) {
    if (renderId !== undefined) {
      return q('SELECT a.slug, v.version FROM render_assets ra JOIN asset_versions v ON v.id = ra.version_id JOIN assets a ON a.id = v.asset_id WHERE ra.render_id = ? ORDER BY a.type, a.slug, v.version').all(renderId).map((r) => makeRef(r.slug, r.version));
    }
    const row = q('SELECT id FROM clips WHERE slug = ?').get(clip);
    if (!row) throw new StudioError(`No clip named "${clip}". Use list_clips to see what exists.`, 'not_found');
    return q('SELECT a.slug, v.version FROM clip_assets ca JOIN asset_versions v ON v.id = ca.version_id JOIN assets a ON a.id = v.asset_id WHERE ca.clip_id = ? ORDER BY ca.depth, a.type, a.slug, v.version').all(row.id).map((r) => makeRef(r.slug, r.version));
  }

  /** Every version row to account for: the closure, plus what its baked files were made from. */
  function rowsOf(refs) {
    /** @type {Map<string, { row: any, via: string | null }>} */
    const rows = new Map();
    const queue = refs.map((ref) => ({ ref, via: null }));
    while (queue.length) {
      const { ref, via } = queue.shift();
      let row;
      try { row = library.requireVersion(ref); } catch { continue; }
      const pinned = makeRef(row.slug, row.version);
      if (rows.has(pinned)) continue;
      rows.set(pinned, { row, via });
      const p = provenanceOf(row);
      const from = p?.derivedFrom ?? (row.type !== 'function' ? json(row.meta, {}).bakedFrom : null);
      if (from) {
        // what a baked file was drawn from: its pinned deps (an image in it) count as part of the clip
        try { for (const r of library.closure([from]).versions.keys()) if (!rows.has(r)) queue.push({ ref: r, via: pinned }); } catch { /* the source is gone: nothing to add */ }
      }
    }
    return rows;
  }

  const tagsOf = (row) => library.summary(row).tags;

  /**
   * The problems that stop a final render, one per asset and reason: a placeholder (flag or tag), or a file asset with no licence.
   * @returns {{ ref: string, type: string, problem: 'placeholder' | 'no-license', message: string }[]}
   */
  function problemsOf(rows) {
    const out = [];
    for (const [ref, { row }] of rows) {
      const p = provenanceOf(row);
      const tags = tagsOf(row);
      const later = row.latest_version > row.version ? ` (the latest version is ${makeRef(row.slug, row.latest_version)}: repin_clip moves a clip to it)` : '';
      if (p?.placeholder) out.push({ ref, type: row.type, problem: 'placeholder', message: `${ref} (${row.type}) is marked as a placeholder: replace it with the real file (add_file_asset, upload_image, add_footage or add_font under the same name makes a new version; then repin_clip)${later}, or if it is the real thing, set_asset_metadata { name: "${row.slug}", provenance: { placeholder: false } }` });
      if (tags.includes('placeholder')) out.push({ ref, type: row.type, problem: 'placeholder', message: `${ref} (${row.type}) is tagged "placeholder": replace it${later}, or if it is the real thing, remove the tag (organize_assets { names: ["${row.slug}"], remove_tags: ["placeholder"] })` });
      // the bundled fonts carry their licence with them; a function asset is the studio's own code
      if (p && isUnknownLicense(p.license)) out.push({ ref, type: row.type, problem: 'no-license', message: `${ref} (${row.type}) has no licence${p.recorded ? ` (it was recorded only as "${p.recorded}")` : ''}: say what it is under with set_asset_metadata { name: "${row.slug}", version: ${row.version}, provenance: { license: "original" | "CC-BY-4.0" | …, creator, source_url } }, or replace it with a file you may use` });
    }
    return out;
  }

  /**
   * Credits, sources and problems of a clip's closure (or of a render's: renderId).
   * @param {{ clip: string, renderId?: number, format?: 'json' | 'markdown' }} o
   * @returns {{ credits: string[], sources: any[], problems: any[], warnings: string[], markdown?: string }}
   */
  function credits({ clip, renderId, format = 'json' }) {
    const rows = rowsOf(refsOf({ clip, renderId }));
    const problems = problemsOf(rows);
    const sources = [], warnings = [];
    let functions = 0;
    const bundled = [];
    for (const [ref, { row, via }] of rows) {
      if (row.type === 'function') { functions++; continue; }
      const p = provenanceOf(row);
      const meta = json(row.meta, {});
      const title = library.summary(row).title;
      // a baked sequence is the studio's own motion graphics, unless someone gave it a credit
      if (row.type === 'sequence' && String(p.license).toLowerCase() === 'original' && !p.credit && !p.creator) { functions++; continue; }
      if (row.type === 'font' && !meta.uploaded) { bundled.push({ ref, title, license: p.license, licenseUrl: p.licenseUrl, sourceUrl: p.sourceUrl }); continue; }
      const voice = voiceOf(meta);
      const group = groupOf(row, tagsOf(row));
      sources.push({
        ref, type: row.type, group, title, license: p.license, licenseUrl: p.licenseUrl, sourceUrl: p.sourceUrl, creator: p.creator, credit: p.credit,
        aiGenerated: p.aiGenerated, contentId: p.contentId, restrictions: p.restrictions, placeholder: p.placeholder, redistributable: p.redistributable, date: p.date,
        ...(voice ? { voice } : {}), ...(via ? { via } : {}),
      });
      if (p.contentId) warnings.push(`${ref}: registered with a content-ID system, so a platform may claim a video that uses it`);
      if (p.restrictions) warnings.push(`${ref}: restriction: ${p.restrictions}`);
      if (voice && isUnknownLicense(voice.license)) warnings.push(`${ref}: the licence of the voice${voiceName(voice) ? ` "${voiceName(voice)}"` : ''} is not recorded`);
    }
    const byGroup = (g) => sources.filter((s) => s.group === g).sort((a, b) => (a.ref < b.ref ? -1 : 1));
    // the sources: one entry for the studio's own motion graphics, one per bundled font family
    const all = [...sources];
    if (functions) all.push({ ref: 'fablecut', type: 'function', group: 'original', title: 'Motion graphics', license: 'original', licenseUrl: null, sourceUrl: null, creator: null, credit: ORIGINAL_LINE, aiGenerated: false, contentId: false, restrictions: null, count: functions });
    for (const f of bundled) all.push({ ref: f.ref, type: 'font', group: 'fonts', title: f.title, license: f.license, licenseUrl: f.licenseUrl, sourceUrl: f.sourceUrl, creator: null, credit: null, aiGenerated: false, contentId: false, restrictions: null, bundled: true });

    const lines = [];
    if (functions) lines.push(ORIGINAL_LINE);
    for (const g of ['footage', 'images', 'sound', 'voice']) {
      for (const s of byGroup(g)) {
        const line = lineOf(s);
        if (line) lines.push(line);
      }
    }
    const fontLines = [...byGroup('fonts').map((s) => lineOf(s)).filter(Boolean)];
    if (bundled.length) {
      const byLicense = new Map();
      for (const f of bundled) byLicense.set(f.license ?? 'licence unknown', [...(byLicense.get(f.license ?? 'licence unknown') ?? []), f.title]);
      for (const [license, titles] of byLicense) fontLines.push(`Fonts: ${[...new Set(titles)].sort().join(', ')} (${license})`);
    }
    lines.push(...fontLines);
    const result = { credits: lines, sources: all, problems, warnings };
    if (format === 'markdown') return { ...result, markdown: markdown({ clip, sources, bundled, functions, lines, problems, warnings, byGroup }) };
    return result;
  }

  /** One credit line for a source: the credit as given, else "Footage: creator, licence"; nothing for original work without a credit. */
  function lineOf(s) {
    if (s.credit) return s.credit;
    if (s.voice) {
      const v = s.voice;
      const who = [voiceName(v), voiceModel(v) ? `(${voiceModel(v)})` : null].filter(Boolean).join(' ');
      return `Voice: ${who || s.title}${isUnknownLicense(v.license) ? '' : `, ${v.license}`}`;
    }
    if (String(s.license).toLowerCase() === 'original' && !s.creator) return null;
    if (isUnknownLicense(s.license) && !s.creator) return null; // nothing to credit: the problem list says what is missing
    return `${LABEL[s.group] ?? 'Source'}: ${s.creator ? `${s.title} by ${s.creator}` : s.title}${isUnknownLicense(s.license) || String(s.license).toLowerCase() === 'original' ? '' : `, ${s.license}`}`;
  }

  function markdown({ clip, sources, bundled, functions, lines, problems, warnings, byGroup }) {
    const out = [`# Credits and sources${clip ? `: ${mdText(clip)}` : ''}`, ''];
    out.push('## Credits', '');
    if (lines.length) out.push(...lines.map((l) => `- ${mdText(l)}`));
    else out.push('Nothing to credit: everything in this video is original.');
    out.push('');
    for (const [g, title] of GROUPS) {
      const list = byGroup(g);
      const own = g === 'fonts' ? bundled : [];
      if (!list.length && !own.length) continue;
      out.push(`## ${title}`, '');
      for (const s of list) {
        const bits = [`**${mdText(s.title)}** (\`${s.ref}\`)`];
        if (s.creator) bits.push(`by ${mdText(s.creator)}`);
        bits.push(licenseLabel(s));
        if (s.sourceUrl) bits.push(`source: <${s.sourceUrl}>`);
        if (s.date) bits.push(`obtained ${s.date}`);
        if (s.voice) bits.push(`voice ${mdText([voiceName(s.voice), voiceModel(s.voice)].filter(Boolean).join(', '))}${s.voice.license ? ` (${mdText(s.voice.license)})` : ''}`);
        if (s.restrictions) bits.push(`restriction: ${mdText(s.restrictions)}`);
        if (s.via) bits.push(`used by \`${s.via}\``);
        out.push(`- ${bits.join('; ')}`);
      }
      for (const f of own) out.push(`- **${mdText(f.title)}** (bundled with Fablecut); ${licenseLabel({ license: f.license, licenseUrl: f.licenseUrl })}${f.sourceUrl ? `; source: <${f.sourceUrl}>` : ''}`);
      out.push('');
    }
    if (functions) out.push('## Motion graphics', '', `Original, made in Fablecut (${functions} asset${functions === 1 ? '' : 's'}).`, '');
    const ai = sources.filter((s) => s.aiGenerated);
    if (ai.length) out.push('## AI-generated material', '', ...ai.map((s) => `- **${mdText(s.title)}** (\`${s.ref}\`)`), '');
    const cid = sources.filter((s) => s.contentId);
    if (cid.length) out.push('## Registered with a content-ID system', '', 'A platform may claim a video that uses these.', '', ...cid.map((s) => `- **${mdText(s.title)}** (\`${s.ref}\`)`), '');
    if (warnings.length) out.push('## Notes', '', ...warnings.map((w) => `- ${mdNote(w)}`), '');
    if (problems.length) out.push('## To fix before a final render', '', ...problems.map((p) => `- ${mdNote(p.message)}`), '');
    return `${out.join('\n').trimEnd()}\n`;
  }

  /**
   * Refuse a final render when the closure holds a placeholder or a file with no licence; the message lists each asset and what to do.
   * @param {{ clip: string, renderId?: number }} o
   */
  function assertFinal({ clip, renderId }) {
    const problems = problemsOf(rowsOf(refsOf({ clip, renderId })));
    if (!problems.length) return;
    const n = new Set(problems.map((p) => p.ref)).size;
    throw new StudioError(`A final render of "${clip}" is refused: ${n} asset${n === 1 ? '' : 's'} in it ${n === 1 ? 'is' : 'are'} not ready.\n- ${problems.map((p) => p.message).join('\n- ')}\nDrafts and normal renders are not checked; render without final to review the cut.`, 'rejected', { problems });
  }

  /** What stops a final render of the clip, and what to know (restrictions, content ID), without rendering. */
  function check({ clip }) {
    const r = credits({ clip });
    return { clip, ready: r.problems.length === 0, problems: r.problems, warnings: r.warnings };
  }

  return { credits, check, assertFinal, refsOf, rowsOf, problemsOf };
}
