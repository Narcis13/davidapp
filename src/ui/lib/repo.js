// The editor's Repo panel: is the clip's folder in the repo up to date with the saved clip (GET /api/clips/<slug>/export is a
// dry run), what would be written, and a Write to repo button (POST) that says what it wrote. The dry run reads the saved
// clip, so the panel checks again after a save.

import { api } from '/ui/lib/api.js';
import { fill, fmtBytes, h, plural } from '/ui/lib/util.js';

const KIND = (rel) => (/\/clip\.json$/.test(rel) ? 'clip' : /\/versions\//.test(rel) ? 'version' : /\/sources\//.test(rel) ? 'source' : /\/files\//.test(rel) ? 'file' : 'other');

/** @param {{ slug: string, onWritten?: (r: any) => void }} o */
export function mountRepo({ slug, onWritten = () => {} }) {
  let data = null, error = '', loading = true, writing = false, seq = 0, result = null;
  const badge = h('span.badge', { 'data-testid': 'repo-state', 'data-state': 'loading', role: 'status' }, 'Checking');
  const checkBtn = h('button.btn.small', { type: 'button', 'data-testid': 'repo-check' }, 'Check again');
  const writeBtn = h('button.btn.small.primary', { type: 'button', 'data-testid': 'repo-write' }, 'Write to repo');
  const body = h('div.repo-body');
  const el = h('section.panel.repo-panel', { 'data-testid': 'repo-panel' },
    h('div.panel-head', h('h2', 'Repo'), badge), body, h('div.row.repo-actions', writeBtn, checkBtn));

  const listOf = (title, items, testid) => (items?.length
    ? h('details.repo-list', { 'data-testid': testid, open: items.length <= 6 }, h('summary', `${title} (${items.length})`), h('ul', items.map((rel) => h('li.mono', { 'data-kind': KIND(rel) }, rel))))
    : null);

  function draw() {
    checkBtn.disabled = loading || writing;
    writeBtn.disabled = loading || writing || !!error || !data || data.upToDate || !!data.conflicts?.length;
    const state = loading ? 'loading' : error ? 'error' : data?.conflicts?.length ? 'conflict' : data?.upToDate ? 'up-to-date' : 'changes';
    badge.dataset.state = state;
    badge.className = `badge${state === 'up-to-date' ? ' ok' : state === 'changes' || state === 'conflict' ? ' warn' : ''}`;
    const changes = data ? (data.new?.length ?? 0) + (data.changed?.length ?? 0) : 0;
    badge.textContent = { loading: 'Checking', error: 'Not checked', conflict: 'Conflict', 'up-to-date': 'Up to date', changes: `${plural(changes, 'change')} to write` }[state];
    const out = [];
    if (error) out.push(h('p.notice.error', { role: 'alert', 'data-testid': 'repo-error' }, error));
    else if (data) {
      out.push(h('p.muted', { 'data-testid': 'repo-summary' },
        data.upToDate
          ? `clips/${slug}/ matches the saved clip: ${plural(data.versions, 'version')}, ${plural(data.unchanged, 'file')} already in the repo.`
          : `clips/${slug}/ differs from the saved clip: ${plural(data.new?.length ?? 0, 'new file')}, ${plural(data.changed?.length ?? 0, 'changed file')}.`));
      if (data.conflicts?.length) out.push(h('div.notice.warn', { 'data-testid': 'repo-conflicts' }, 'The repo already has other content under these refs, so nothing can be written:\n', data.conflicts.map((c) => `- ${c.message}`).join('\n')));
      out.push(listOf('New', data.new, 'repo-new'), listOf('Changed', data.changed, 'repo-changed'));
      if (data.external?.length) {
        out.push(h('details.repo-list', { 'data-testid': 'repo-external' }, h('summary', `Kept out of git (${data.external.length})`),
          h('p.hint', 'Files whose licence does not allow a public repo, or over 50 MB: they are listed by SHA-256 with their licence and source, not copied.'),
          h('ul', data.external.map((x) => h('li', h('span.mono', x.ref), h('span.muted', ` · ${x.why ?? 'kept out'}${x.bytes ? ` · ${fmtBytes(x.bytes)}` : ''}${x.license ? ` · ${x.license}` : ''}`))))));
      }
      const c = data.check;
      if (c && c.state !== 'current') out.push(h('p.hint', { 'data-testid': 'repo-check-state' }, c.state === 'missing' ? 'Frame hashes are drawn when the clip is written.' : 'The frame hashes will be drawn again when the clip is written.'));
    }
    if (result) {
      out.push(result.error
        ? h('p.notice.error', { role: 'alert', 'data-testid': 'repo-write-error' }, result.error)
        : h('div.notice.ok', { 'data-testid': 'repo-result', role: 'status' }, result.wrote.length ? `Wrote ${plural(result.wrote.length, 'file')} to the repo:` : 'Nothing to write: the repo was up to date.',
          result.wrote.length ? h('ul.repo-wrote', result.wrote.map((rel) => h('li.mono', { 'data-testid': 'repo-wrote' }, rel))) : null));
    }
    fill(body, out);
  }

  async function refresh({ keepResult = false } = {}) {
    const mine = ++seq;
    loading = true; error = '';
    if (!keepResult) result = null;
    draw();
    try {
      const r = await api.get(`/api/clips/${slug}/export`);
      if (mine !== seq) return;
      data = r;
    } catch (e) {
      if (mine !== seq) return;
      error = e.message;
    } finally {
      if (mine === seq) { loading = false; draw(); }
    }
  }

  writeBtn.addEventListener('click', async () => {
    writing = true; result = null;
    writeBtn.textContent = 'Writing';
    draw();
    try {
      const r = await api.post(`/api/clips/${slug}/export`, {});
      result = { wrote: r.wrote ?? [], folder: r.folder };
      onWritten(r);
    } catch (e) {
      result = { error: e.message, wrote: [] };
    }
    writing = false;
    writeBtn.textContent = 'Write to repo';
    await refresh({ keepResult: true });
  });
  checkBtn.addEventListener('click', () => refresh());
  draw();
  return { el, refresh, destroy() { seq++; } };
}
