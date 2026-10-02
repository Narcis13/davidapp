// Render queue: every render job with live progress. Rows update in place while the shared
// poller (lib/api.js) refreshes the list.

import { api, renderQueue } from '/ui/lib/api.js';
import { empty, errorBlock, fill, fmtDate, fmtDuration, h, loading, notice, plural, trim } from '/ui/lib/util.js';

const LABEL = { queued: 'Queued', running: 'Rendering', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };

function elapsed(r) {
  if (!r.startedAt) return r.status === 'queued' ? 'waiting' : '';
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
  return fmtDuration(Math.max(0, (end - new Date(r.startedAt).getTime()) / 1000));
}

function createRow(r, onError) {
  const status = h('span.badge');
  const bar = h('i');
  const frames = h('span.frames', { 'data-testid': 'render-frames' });
  const time = h('span.elapsed', { 'data-testid': 'render-elapsed' });
  const detail = h('div.render-detail');
  const cancel = h('button.btn.small', { type: 'button', 'data-testid': 'cancel-render' }, 'Cancel');
  cancel.addEventListener('click', async () => {
    cancel.disabled = true;
    try { await api.post(`/api/renders/${r.id}/cancel`); } catch (e) { onError(e.message); }
    renderQueue.refresh();
  });
  const el = h('li.render-row', { 'data-testid': 'render-row', 'data-id': r.id },
    h('div.render-main',
      h('div.render-title', h('a', { href: `/clips/${r.clip}` }, r.clipTitle), h('span.ref', `#${r.id} · ${r.clip} · revision ${r.clipRevision}`)),
      h('div.render-status', status, time)),
    h('div.render-progress', h('div.bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar), frames),
    h('div.render-foot', detail, cancel));
  let lastStatus = null;
  function update(next) {
    r = next;
    const pct = Math.round((r.progress ?? 0) * 100);
    el.dataset.status = r.status;
    status.className = `badge st-${r.status}`;
    status.textContent = LABEL[r.status] ?? r.status;
    bar.style.width = `${r.status === 'done' ? 100 : pct}%`;
    bar.parentElement.setAttribute('aria-valuenow', String(pct));
    frames.textContent = `${r.framesDone}/${r.framesTotal} frames · ${pct}%`;
    time.textContent = elapsed(r);
    cancel.hidden = !renderQueue.isActive(r);
    if (r.status === lastStatus) return;
    lastStatus = r.status;
    cancel.disabled = false;
    if (r.status === 'done') {
      const s = r.stats ?? {};
      fill(detail, 
        h('span', { 'data-testid': 'render-stats' }, [
          Number.isFinite(s.renderSeconds) ? `rendered in ${trim(s.renderSeconds, 2)} s` : null,
          Number.isFinite(s.framesPerSecond) ? `${trim(s.framesPerSecond, 1)} frames/s` : null,
          Number.isFinite(s.realtimeFactor) ? `${trim(s.realtimeFactor, 2)}× real time` : null,
          s.workers ? plural(s.workers, 'worker') : null,
        ].filter(Boolean).join(' · ')),
        h('a.btn.small', { href: `/gallery/${r.id}`, 'data-testid': 'open-in-gallery' }, 'Open in gallery'));
    } else if (r.status === 'failed') {
      fill(detail, h('p.render-error', { 'data-testid': 'render-error' }, r.error ?? 'The render failed.'));
    } else if (r.status === 'cancelled') {
      fill(detail, h('span.muted', 'Cancelled before it finished.'));
    } else {
      fill(detail, h('span.muted', `${r.format} ${r.width}×${r.height} · queued ${fmtDate(r.createdAt)}${r.requestedBy ? ` by ${r.requestedBy}` : ''}`));
    }
  }
  update(r);
  return { el, update };
}

export async function mount(view, ctx) {
  ctx.setTitle('Renders');
  let clips;
  try {
    ({ clips } = await api.get('/api/clips'));
  } catch (e) {
    fill(view, errorBlock(e.message));
    return;
  }
  if (!ctx.alive()) return;

  const msg = notice('render-message');
  const select = h('select', { 'data-testid': 'render-clip-select', 'aria-label': 'Clip to render' }, clips.map((c) => h('option', { value: c.slug }, `${c.title} · ${c.format} · ${fmtDuration(c.duration)}`)));
  const start = h('button.btn.primary', { type: 'button', 'data-testid': 'start-render', disabled: !clips.length }, 'Render a clip');
  start.addEventListener('click', async () => {
    msg.hide();
    start.disabled = true;
    try { await api.post(`/api/clips/${select.value}/render`); } catch (e) { msg.show(e.message); }
    start.disabled = false;
    renderQueue.refresh();
  });

  const summary = h('span.count', { 'data-testid': 'render-count', role: 'status' });
  const list = h('ol.render-list', { 'data-testid': 'render-list' });
  const body = h('div', loading('Loading the queue'));
  const rows = new Map();
  let first = true;

  fill(view, 
    h('div.page-head',
      h('div', h('h1', 'Render queue'), h('p.sub', 'Frames are drawn in parallel workers and encoded by FFmpeg.')),
      h('div.page-head-side', summary, clips.length ? h('div.row.render-start', select, start) : null)),
    msg.el, body);

  ctx.onCleanup(renderQueue.subscribe((renders, error) => {
    if (error && first) { fill(body, errorBlock(error)); return; }
    if (error) { msg.show(error); return; }
    first = false;
    const active = renders.filter(renderQueue.isActive).length;
    summary.textContent = renders.length ? `${plural(renders.length, 'render')}${active ? ` · ${active} in progress` : ''}` : '';
    if (!renders.length) {
      rows.clear();
      fill(body, empty('Nothing rendered yet', clips.length ? 'Pick a clip above, or press Render in a clip editor.' : 'Create a clip first. Renders show up here with live progress.'));
      return;
    }
    if (body.firstElementChild !== list) fill(body, list);
    const seen = new Set();
    let before = list.firstElementChild;
    for (const r of renders) {
      seen.add(r.id);
      let row = rows.get(r.id);
      if (row) row.update(r);
      else { row = createRow(r, (text) => msg.show(text)); rows.set(r.id, row); }
      if (row.el !== before) list.insertBefore(row.el, before); else before = before.nextElementSibling;
    }
    for (const [id, row] of rows) if (!seen.has(id)) { row.el.remove(); rows.delete(id); }
  }));
}
