// The editor's issues panel: runs the studio's checks (safe zones, clipped text, overlaps, the caption
// lane, size, contrast, holds, captions, glyphs, first and last frame) on the draft, lists what it
// found with the time it happens at, and shows the still the check kept. A click on a row moves the
// playhead there and selects the item. The list says so when the draft has changed since it was made.

import { api } from '/ui/lib/api.js';
import { fill, fmtTime, h, plural } from '/ui/lib/util.js';

const CHECK_LABEL = {
  'safe-zone': 'Safe zone', clipped: 'Clipped', overlap: 'Overlap', 'caption-lane': 'Caption lane', size: 'Size', contrast: 'Contrast',
  hold: 'Hold', captions: 'Captions', glyphs: 'Glyphs', 'first-frame': 'First frame', 'last-frame': 'Last frame',
};

/**
 * @param {{ slug: string, getComposition: () => any, onSeek: (t: number) => void, onPick?: (itemId: string | null) => void }} o
 */
export function mountIssues({ slug, getComposition, onSeek, onPick = () => {} }) {
  let issues = null, stale = false, running = false, open = -1, runId = 0, error = '';
  const runBtn = h('button.btn.small', { type: 'button', 'data-testid': 'run-check' }, 'Check the clip');
  const loading = h('p.issues-loading', { hidden: true, role: 'status', 'data-testid': 'issues-loading' }, h('span.spinner'), 'Checking frames. This can take up to half a minute.');
  const errorEl = h('p.notice.error', { hidden: true, role: 'alert', 'data-testid': 'issues-error' });
  const staleEl = h('p.notice.info', { hidden: true, 'data-testid': 'issues-stale' }, 'The clip has changed since this check. Run it again to see what is left.');
  const count = h('span.count', { hidden: true, 'data-testid': 'issues-count' });
  const list = h('ul.issue-list', { 'data-testid': 'issues-list' });
  const el = h('section.panel.issues-panel', { 'data-testid': 'issues-panel' },
    h('div.panel-head', h('h2', 'Issues'), h('div.row', count, runBtn)),
    loading, errorEl, staleEl, list);

  function draw() {
    runBtn.disabled = running;
    runBtn.textContent = issues ? 'Check again' : 'Check the clip';
    loading.hidden = !running;
    errorEl.hidden = !error;
    errorEl.textContent = error;
    staleEl.hidden = !(stale && issues && !running);
    count.hidden = !issues;
    if (issues) count.textContent = issues.length ? plural(issues.length, 'issue') : 'No issues';
    if (!issues) { fill(list, error || running ? null : h('li.muted.issues-hint', 'Runs the studio checks on the clip as it is now: text in the safe zone, size, contrast, holds, captions and more.')); return; }
    fill(list, issues.length ? issues.map((it, i) => {
      const range = it.until !== undefined && it.until > it.t + 0.005 ? `${fmtTime(it.t)}–${fmtTime(it.until)}` : fmtTime(it.t);
      const row = h('button.issue', { type: 'button', 'data-testid': 'issue', 'data-check': it.check, 'data-item': it.item ?? '', 'data-severity': it.severity, 'aria-expanded': String(open === i) },
        h('span.issue-head', h(`span.badge.sev-${it.severity}`, CHECK_LABEL[it.check] ?? it.check), h('span.timecode', range), it.item ? h('span.ref', it.item) : null),
        h('span.issue-msg', it.message));
      row.addEventListener('click', () => { open = open === i ? -1 : i; onSeek(it.t); onPick(it.item ?? null); draw(); });
      return h('li', { class: open === i ? 'open' : null }, row,
        open === i && it.still ? h('img.issue-still', { src: `${it.still}?run=${runId}`, alt: `The frame at ${fmtTime(it.t)}: ${it.message}`, 'data-testid': 'issue-still', loading: 'lazy' }) : null);
    }) : h('li.muted.issues-empty', 'No issues found.'));
  }

  async function run() {
    if (running) return;
    running = true; error = ''; open = -1;
    draw();
    try {
      const r = await api.post(`/api/clips/${slug}/check`, { composition: getComposition() });
      issues = r.issues ?? [];
      runId++;
      stale = false;
    } catch (e) {
      error = e.message;
    } finally {
      running = false;
      draw();
    }
  }
  runBtn.addEventListener('click', run);
  draw();

  return {
    el,
    /** The draft changed: what is listed may no longer hold. */
    markStale() { if (issues && !stale) { stale = true; draw(); } },
    run,
  };
}
