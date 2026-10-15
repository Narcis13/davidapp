// Provenance in the studio: where a file asset came from and what may be done with it. The fields (one form
// shared by the asset page, the upload dialogs and the font form), the read-only panel with its Edit button, the
// badges that say a file is a placeholder or has no licence, and the cached lookup the library cards use.
// The studio's rules are in src/studio/provenance.js; a final render refuses placeholders and unknown licences.

import { api } from '/ui/lib/api.js';
import { fill, fmtDate, h, nextId, notice } from '/ui/lib/util.js';

export const LICENSE_PICKS = ['original', 'CC0-1.0', 'CC-BY-4.0', 'OFL-1.1', 'Apache-2.0', 'MIT'];
export const UNKNOWN_NOTE = 'A final render will refuse it until the licence is set on its page.';

/** No licence recorded: nothing, or the word "unknown" (the same test the studio makes). */
export const isUnknownLicense = (license) => license === null || license === undefined || /^\s*(unknown|n\/a|none|\?)?\s*$/i.test(String(license));

/** The problems a final render would stop at, for one file: [{ id: 'placeholder' | 'unknown', label, title }]. */
export function provenanceIssues(p, tags = []) {
  const out = [];
  if (p?.placeholder || tags.includes('placeholder')) out.push({ id: 'placeholder', label: 'Placeholder', title: 'Marked as a placeholder: a final render refuses it. Replace it with the real file, or clear the mark.' });
  if (p && isUnknownLicense(p.license)) out.push({ id: 'unknown', label: 'Licence unknown', title: 'No licence is recorded: a final render refuses this file until it is set.' });
  return out;
}

/** Badges for the issues of one file (the asset page header, the library detail). */
export const issueBadges = (p, tags) => provenanceIssues(p, tags).map((i) => h(`span.badge.prov-${i.id}`, { 'data-testid': 'prov-badge', 'data-issue': i.id, title: i.title }, i.label));

// ── the form ────────────────────────────────────────────────────────────────────────────────

const FLAGS = [
  ['aiGenerated', 'AI-generated', 'prov-ai', null],
  ['contentId', 'Registered with a content-ID system', 'prov-content-id', 'A platform may claim a video that uses it.'],
  ['placeholder', 'Placeholder', 'prov-placeholder', 'A stand-in for the real file. A final render refuses it.'],
  ['redistributable', 'May be committed to a public repo', 'prov-redistributable', 'Follows the licence until you change it.'],
];

/**
 * The provenance fields as form elements. `value` is a provenance record (or nothing); `values()` reads the form back
 * as the object the studio takes (text fields: null when empty; the flags; `redistributable` only once it was touched).
 * `compact` keeps everything but the licence under a "More about the source" disclosure (the upload dialogs).
 * @param {{ value?: any, testids?: { license?: string, pick?: string }, picks?: string[], compact?: boolean, required?: boolean, hint?: string | null }} [o]
 */
export function provenanceFields({ value = {}, testids = {}, picks = LICENSE_PICKS, compact = false, required = false, hint = null } = {}) {
  const id = nextId('prov');
  const v = value ?? {};
  const text = (key, label, testid, props = {}) => {
    const input = h('input', { type: 'text', id: `${id}-${key}`, value: v[key] ?? '', 'data-testid': testid, autocomplete: 'off', spellcheck: false, maxLength: 500, ...props });
    return { input, el: h('div.field', h('label', { for: `${id}-${key}` }, label), input) };
  };
  const license = h('input', { type: 'text', id: `${id}-license`, value: isUnknownLicense(v.license) ? '' : v.license, 'data-testid': testids.license ?? 'prov-license', placeholder: 'For example CC-BY-4.0, or "commercial, licensed to us"', autocomplete: 'off', spellcheck: false, maxLength: 200 });
  const chips = picks.map((l) => h('button.chip', { type: 'button', 'data-testid': testids.pick ?? 'prov-license-pick', 'data-value': l, 'aria-pressed': 'false', onclick: () => { license.value = l; sync(); license.focus(); } }, l));
  const sync = () => { for (const b of chips) { const on = b.dataset.value === license.value.trim(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
  license.addEventListener('input', sync);
  sync();
  const fields = {
    licenseUrl: text('licenseUrl', 'Licence URL', 'prov-license-url', { placeholder: 'https://…', inputMode: 'url' }),
    sourceUrl: text('sourceUrl', 'Source URL', 'prov-source-url', { placeholder: 'https://… where you got it', inputMode: 'url' }),
    creator: text('creator', 'Creator', 'prov-creator', { maxLength: 200 }),
    credit: text('credit', 'Credit line', 'prov-credit', { placeholder: 'How the video should credit it', maxLength: 300 }),
    date: text('date', 'Date', 'prov-date', { placeholder: 'YYYY-MM-DD, when it was made or obtained', maxLength: 10 }),
    restrictions: text('restrictions', 'Restrictions', 'prov-restrictions', { placeholder: 'For example: not for paid ads', maxLength: 500 }),
  };
  const flags = {};
  const flagEls = FLAGS.map(([key, label, testid, note]) => {
    const input = h('input', { type: 'checkbox', id: `${id}-${key}`, checked: !!v[key], 'data-testid': testid, role: 'switch' });
    flags[key] = input;
    return h('div.field.inline', h('label', { for: `${id}-${key}` }, label), h('label.switch', input, h('span.switch-track', { 'aria-hidden': 'true' })), note ? h('p.hint', note) : null);
  });
  let touched = false;
  flags.redistributable.addEventListener('change', () => { touched = true; });
  const rest = [fields.licenseUrl.el, fields.sourceUrl.el, fields.creator.el, fields.credit.el, fields.date.el, fields.restrictions.el, flagEls];
  const licenseField = h('div.field', h('label', { for: `${id}-license` }, 'Licence', required ? null : h('span.type', 'optional')), h('div.chips.prov-picks', { role: 'group', 'aria-label': 'Common licences' }, chips), license,
    hint ? h('p.hint', hint) : null);
  const nodes = compact
    ? [licenseField, h('details.prov-more', { 'data-testid': 'prov-more' }, h('summary', 'More about the source'), rest)]
    : [licenseField, rest];

  const read = (el) => el.value.trim() || null;
  return {
    nodes, license,
    /** Set the licence from outside (a quick pick elsewhere). */
    setLicense(l) { license.value = l; sync(); },
    values() {
      const out = { license: read(license) };
      for (const [k, f] of Object.entries(fields)) out[k] = read(f.input);
      out.aiGenerated = flags.aiGenerated.checked;
      out.contentId = flags.contentId.checked;
      out.placeholder = flags.placeholder.checked;
      if (touched) out.redistributable = flags.redistributable.checked;
      return out;
    },
    focus() { license.focus(); },
  };
}

/** The query parameters an upload takes for a provenance object (snake_case; only what was said). */
export function provenanceQuery(p) {
  const q = new URLSearchParams();
  if (!p) return q;
  const names = { license: 'license', licenseUrl: 'license_url', sourceUrl: 'source_url', creator: 'creator', credit: 'credit', date: 'date', restrictions: 'restrictions' };
  for (const [k, name] of Object.entries(names)) if (p[k]) q.set(name, p[k]);
  for (const [k, name] of [['aiGenerated', 'ai_generated'], ['contentId', 'content_id'], ['placeholder', 'placeholder'], ['redistributable', 'redistributable']]) if (p[k] !== undefined && (p[k] || k === 'redistributable')) q.set(name, String(!!p[k]));
  return q;
}

/** A short sentence of what was said, for a button or an upload row: "CC-BY-4.0 · by Ada". */
export const provenanceSummary = (p) => (p && !isUnknownLicense(p.license) ? [p.license, p.creator ? `by ${p.creator}` : null].filter(Boolean).join(' · ') : null);

// ── the panel on an asset's page ────────────────────────────────────────────────────────────

const link = (url, label = url) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label);

/**
 * "Source and licence": read-only with an Edit button, saved through the metadata route (no new version). Not for function
 * assets. A font bundled with the studio is shown, not editable (its licence lives with the font file).
 * @param {any} a the asset as the API gives it (provenance, version, type, meta) @param {{ onSaved: (next: any) => void }} o
 */
export function provenancePanel(a, { onSaved }) {
  const el = h('section.panel.prov-panel', { 'data-testid': 'provenance' });
  const msg = notice('prov-error');
  const locked = () => a.type === 'font' && !a.meta?.uploaded;
  let editing = false;   // an open form is not redrawn by an event about an earlier save

  function readView() {
    editing = false;
    const p = a.provenance ?? {};
    const issues = provenanceIssues(p, a.tags ?? []);
    const yes = (b) => (b ? 'yes' : 'no');
    const rows = [
      ['Licence', isUnknownLicense(p.license) ? h('span.prov-unknown', 'unknown') : p.licenseUrl ? link(p.licenseUrl, p.license) : p.license],
      p.licenseUrl && !isUnknownLicense(p.license) ? null : ['Licence URL', p.licenseUrl ? link(p.licenseUrl) : null],
      ['Source', p.sourceUrl ? link(p.sourceUrl) : null],
      ['Creator', p.creator],
      ['Credit line', p.credit],
      ['Date', p.date],
      ['Restrictions', p.restrictions],
      p.derivedFrom ? ['Made from', h('a.mono', { href: `/assets/${String(p.derivedFrom).split('@')[0]}` }, p.derivedFrom)] : null,
      ['AI-generated', yes(p.aiGenerated)],
      ['Content ID', p.contentId ? 'registered: a platform may claim a video that uses it' : 'no'],
      ['Placeholder', p.placeholder ? h('span.prov-flag-on', 'yes: a final render refuses it') : 'no'],
      ['In a public repo', p.redistributable ? 'may be committed' : 'stays out of git'],
    ].filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '');
    const edited = p.edit ? h('p.hint', { 'data-testid': 'prov-edited' }, `Edited by ${p.edit.by} · ${fmtDate(p.edit.at)}`) : (p.recorded ? h('p.hint', `Recorded when uploaded as “${p.recorded}”.`) : null);
    fill(el,
      h('div.panel-head', h('h2', 'Source and licence'),
        h('div.row', issues.map((i) => h(`span.badge.prov-${i.id}`, { 'data-testid': 'prov-badge', 'data-issue': i.id, title: i.title }, i.label)),
          locked() ? null : h('button.btn.small', { type: 'button', 'data-testid': 'prov-edit', onclick: () => editView() }, 'Edit'))),
      issues.length ? h('p.notice.warn', { 'data-testid': 'prov-warning' }, issues.map((i) => i.title).join(' ')) : null,
      h('dl.facts', { 'data-testid': 'prov-facts' }, rows.map(([k, val]) => [h('dt', k), h('dd', val)])),
      locked() ? h('p.hint', 'A font bundled with the studio: its licence is kept with the font file in the fonts folder.') : null,
      (a.versions?.length ?? 1) > 1 ? h('p.hint', `This is the record of v${a.version}; each version has its own.`) : null,
      edited, msg.el);
  }

  function editView() {
    editing = true;
    msg.hide();
    const p = a.provenance ?? {};
    const form = provenanceFields({ value: p, hint: 'Pick one, or type the licence in your own words. Empty means unknown.' });
    const save = h('button.btn.small.primary', { type: 'submit', 'data-testid': 'prov-save' }, 'Save');
    const cancel = h('button.btn.small', { type: 'button', 'data-testid': 'prov-cancel', onclick: () => readView() }, 'Cancel');
    const f = h('form.form.prov-form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        msg.hide();
        save.disabled = true;
        try {
          const next = await api.put(`/api/assets/${a.slug}/metadata`, { provenance: form.values(), version: a.version });
          editing = false;
          onSaved(next);
        } catch (err) {
          msg.show(err.message);
          save.disabled = false;
        }
      },
    }, form.nodes, h('div.row.meta-actions', save, cancel));
    fill(el, h('div.panel-head', h('h2', 'Source and licence'), h('span.hint', `v${a.version}`)), f, h('p.hint', 'Saved on this version; no new version is made.'), msg.el);
    form.focus();
  }

  readView();
  return { el, update(next) { a = next; if (!editing) readView(); } };
}

// ── a lookup for the library cards ──────────────────────────────────────────────────────────

const cache = new Map();   // slug → { p, tags } | 'loading'
let active = 0;
const waiting = [];

/**
 * The provenance of a file asset's latest version, fetched once per page load, three at a time (the list does not carry
 * it). → the record, or null when the fetch failed. Call forget() after an edit.
 * @param {string} slug @returns {Promise<any>}
 */
export function lookupProvenance(slug) {
  const hit = cache.get(slug);
  if (hit && hit !== 'loading') return Promise.resolve(hit.p);
  return new Promise((resolve) => {
    waiting.push({ slug, resolve });
    pump();
  });
}
export const cachedProvenance = (slug) => { const hit = cache.get(slug); return hit && hit !== 'loading' ? hit.p : undefined; };
export const forgetProvenance = (slug) => { cache.delete(slug); };

function pump() {
  while (active < 3 && waiting.length) {
    const { slug, resolve } = waiting.shift();
    const hit = cache.get(slug);
    if (hit && hit !== 'loading') { resolve(hit.p); continue; }
    active++;
    cache.set(slug, 'loading');
    api.get(`/api/assets/${slug}`)
      .then((a) => { cache.set(slug, { p: a.provenance ?? null }); resolve(a.provenance ?? null); })
      .catch(() => { cache.delete(slug); resolve(null); })
      .finally(() => { active--; pump(); });
  }
}
