// The editor's Credits panel: what a video made from the saved clip would credit, where each file came from, and the
// problems (a placeholder, a file with no licence) that make a final render refuse it, each with a link to the asset's
// page to fix it. From GET /api/clips/<slug>/credits, which reads the clip's saved closure: the panel draws again after
// a save and when an asset's metadata changes.

import { api } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { isUnknownLicense } from '/ui/lib/provenance.js';
import { assetHref, debounce, fill, h, plural } from '/ui/lib/util.js';

const PROBLEM = {
  placeholder: ['Placeholder', 'is marked as a placeholder'],
  'no-license': ['Licence unknown', 'has no licence recorded'],
};
const GROUP = { footage: 'Footage', images: 'Images', sound: 'Sound and music', voice: 'Voice', fonts: 'Fonts', original: 'Motion graphics' };

/** @param {{ slug: string }} o */
export function mountCredits({ slug }) {
  let data = null, error = '', loading = true, seq = 0;
  const count = h('span.count', { hidden: true, 'data-testid': 'credits-count' });
  const refreshBtn = h('button.btn.small', { type: 'button', 'data-testid': 'credits-refresh' }, 'Refresh');
  const body = h('div.credits-body');
  const el = h('section.panel.credits-panel', { 'data-testid': 'credits-panel' },
    h('div.panel-head', h('h2', 'Credits'), h('div.row', count, refreshBtn)), body);

  function draw() {
    refreshBtn.disabled = loading;
    if (loading && !data) { fill(body, h('p.muted', { role: 'status', 'data-testid': 'credits-loading' }, 'Reading the sources')); return; }
    if (error) { fill(body, h('p.notice.error', { role: 'alert', 'data-testid': 'credits-error' }, error)); count.hidden = true; return; }
    const { credits = [], sources = [], problems = [], warnings = [] } = data;
    const files = sources.filter((s) => s.type !== 'function' && !s.bundled);
    count.hidden = false;
    count.textContent = problems.length ? plural(new Set(problems.map((p) => p.ref)).size, 'problem') : 'Ready for a final render';
    count.classList.toggle('prov-problem', problems.length > 0);
    fill(body,
      problems.length ? h('div.credit-problems', { 'data-testid': 'credit-problems', role: 'region', 'aria-label': 'Problems that stop a final render' },
        h('p.notice.warn', 'A final render is refused until these are fixed. Drafts and normal renders are not checked.'),
        h('ul.credit-problem-list', problems.map((p) => {
          const [label, what] = PROBLEM[p.problem] ?? [p.problem, 'needs a look'];
          return h('li', { 'data-testid': 'credit-problem', 'data-problem': p.problem, 'data-ref': p.ref },
            h(`span.badge.prov-${p.problem === 'placeholder' ? 'placeholder' : 'unknown'}`, label),
            h('a.mono', { href: assetHref(p.ref), 'data-testid': 'credit-problem-link' }, p.ref),
            h('span.muted', `${p.type} ${what}`));
        }))) : h('p.credit-ready', { 'data-testid': 'credits-ready' }, h('span.dot'), 'No placeholder and no unknown licence: a final render can go ahead.'),
      warnings.length ? h('ul.credit-warnings', { 'data-testid': 'credit-warnings' }, warnings.map((w) => h('li', w))) : null,
      h('h3', 'Credit lines'),
      credits.length
        ? h('ul.credit-lines', { 'data-testid': 'credit-lines' }, credits.map((c) => h('li', { 'data-testid': 'credit-line' }, c)))
        : h('p.muted', { 'data-testid': 'credit-lines' }, 'Nothing to credit: everything in this clip is original.'),
      files.length ? h('details.credit-sources', { 'data-testid': 'credit-sources' },
        h('summary', `Sources (${files.length})`),
        h('ul.source-list', files.map((s) => h('li', { 'data-testid': 'credit-source', 'data-ref': s.ref },
          h('div.source-head', h('a.mono', { href: assetHref(s.ref) }, s.ref), h('span.muted', GROUP[s.group] ?? s.type)),
          h('div.source-line', isUnknownLicense(s.license) ? h('span.prov-unknown', 'licence unknown') : (s.licenseUrl ? h('a', { href: s.licenseUrl, target: '_blank', rel: 'noopener noreferrer' }, s.license) : s.license),
            s.creator ? ` · by ${s.creator}` : '',
            s.sourceUrl ? [' · ', h('a', { href: s.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'source')] : ''),
          s.placeholder || s.aiGenerated || s.contentId || s.restrictions
            ? h('div.source-flags', s.placeholder ? h('span.badge.prov-placeholder', 'placeholder') : null, s.aiGenerated ? h('span.badge', 'AI-generated') : null, s.contentId ? h('span.badge', 'content ID') : null, s.restrictions ? h('span.badge', { title: s.restrictions }, 'restriction') : null)
            : null)))) : null,
      h('div.row.credit-actions',
        h('a.btn.small', { href: `/api/clips/${slug}/credits?format=md`, download: `${slug}-credits.md`, 'data-testid': 'credits-download' }, 'Download as Markdown')));
  }

  async function refresh() {
    const mine = ++seq;
    loading = true; error = '';
    draw();
    try {
      const r = await api.get(`/api/clips/${slug}/credits`);
      if (mine !== seq) return;
      data = r;
    } catch (e) {
      if (mine !== seq) return;
      error = e.message;
    } finally {
      if (mine === seq) { loading = false; draw(); }
    }
  }
  refreshBtn.addEventListener('click', refresh);
  const later = debounce(refresh, 400);
  // an asset's licence edited elsewhere (its page, another tab, the agent)
  const off = live.on('asset', (e) => { if (e?.action === 'metadata') later(); });
  draw();
  return { el, refresh, destroy() { later.cancel(); off(); seq++; } };
}
