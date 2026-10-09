// Render queue: every render job with live progress. Rows update in place while the shared
// poller (lib/api.js) refreshes the list. Also home of the loudness line, the problems list and the
// render report, which the gallery detail page reuses.

import { api, renderQueue } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { live } from '/ui/lib/live.js';
import { empty, errorBlock, fill, fmtBytes, fmtDate, fmtDuration, fmtTime, h, icon, loading, notice, plural, trim } from '/ui/lib/util.js';

const LABEL = { queued: 'Queued', running: 'Rendering', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
const MINUS = '−';
export const NO_REPORT = 'This render has no report (it was made before the studio wrote them).';

/** -14 → "−14.0", with a real minus sign; a value that rounds to zero has no sign. */
function num(n, digits = 1) {
  const t = Math.abs(n).toFixed(digits);
  return n < 0 && Number(t) !== 0 ? `${MINUS}${t}` : t;
}
const signed = (n, digits = 1) => `${n > 0 && Number(Math.abs(n).toFixed(digits)) !== 0 ? '+' : ''}${num(n, digits)}`;
const range = (a, b) => `${fmtTime(a)}–${fmtTime(b)}`;
const dB = (n) => `${num(n)} dB`;

export const hasReport = (r) => !!r.stats?.files?.report;

/** "−14.0 LUFS · LRA 5.2 LU · true peak −1.3 dBTP", or null when the render has no loudness record. */
export function loudnessLine(stats) {
  const m = stats?.loudness?.measured;
  if (!m) return null;
  if (!Number.isFinite(m.integrated)) return 'No audio to measure';
  return `${num(m.integrated)} LUFS · LRA ${num(m.range)} LU · true peak ${num(m.truePeak)} dBTP`;
}

const targetText = (t) => `${num(t.target)} LUFS, true peak at most ${num(t.truePeak)} dBTP`;

function metBadge(l, testid = 'loudness-met') {
  if (!l.target || l.master?.mode === 'safety') return h('span.badge', { 'data-testid': testid, title: 'The mix only had the safety limiter' }, 'No target');
  const title = `Target ${targetText(l.target)}`;
  return l.met
    ? h('span.badge.ok', { 'data-testid': testid, title }, 'Target met')
    : h('span.badge.warn', { 'data-testid': testid, title }, 'Target missed');
}

/** The loudness line, the target badge and the one-sentence master note. */
export function loudnessSummary(stats) {
  const line = loudnessLine(stats);
  if (!line) return null;
  const l = stats.loudness;
  return h('div.loudness',
    h('div.loudness-head', h('span.render-loudness', { 'data-testid': 'render-loudness' }, line), metBadge(l)),
    l.master?.note ? h('p.loudness-note', { 'data-testid': 'loudness-note' }, l.master.note) : null);
}

/** "No problems", or "3 things to look at" that opens the list. `ids` are the test ids of the count and of each problem. */
export function problemsList(problems, ids = { count: 'render-problems', item: 'render-problem' }, open = false) {
  if (!problems) return null;
  if (!problems.length) return h('p.problems.none', { 'data-testid': ids.count }, h('span.dot'), 'No problems');
  return h('details.problems', { open },
    h('summary', { 'data-testid': ids.count }, h('span.dot'), `${plural(problems.length, 'thing')} to look at`),
    h('ul.problem-list', problems.map((p) => h('li', { 'data-testid': ids.item }, p))));
}

/** Download buttons for what a render wrote next to the MP4; `names` picks and orders them. */
export function downloadLinks(r, names = ['srt', 'vtt', 'words', 'report']) {
  const files = r.stats?.files ?? {};
  const path = { srt: r.srt, vtt: files.vtt, words: files.words, report: files.report };
  const label = { srt: 'Captions (SRT)', vtt: 'Captions (VTT)', words: 'Words (JSON)', report: 'Report (JSON)' };
  return names.filter((n) => path[n]).map((n) => h('a.btn', { href: `/media/${path[n]}`, download: path[n].split('/').pop(), 'data-testid': `download-${n}` }, icon('download', 16), label[n]));
}

// ── the render report ─────────────────────────────────────────────────────────────────────────

/** A block of the report: heading, a count, and a list or "None". */
function block(testid, title, items, extra, full = false) {
  return h(`section.report-block${full ? '.full' : ''}`, { 'data-testid': testid, 'data-count': items.length },
    h('div.report-block-head', h('h3', title), h('span.count', items.length ? String(items.length) : null)),
    extra,
    items.length ? h('ul.report-list', items) : (extra ? null : h('p.muted.report-none', 'None')));
}

const item = (when, ...rest) => h('li', h('span.report-when', when), h('span.report-what', rest));

/** The probe facts as rows of [label, value, expected?]: a row is marked when `expected` is given and differs. */
function probeRows(p, r) {
  const v = p.video ?? {}, a = p.audio, c = p.color ?? {};
  const same = (value, expected) => (value === expected ? undefined : expected);
  const tag = (value, expected = 'bt709') => [value ?? 'none', same(value, expected)];
  return [
    ['File', [
      ['Duration', fmtDuration(p.duration)],
      ['Size', fmtBytes(p.size)],
      ['Faststart', p.faststart ? 'yes' : 'no', p.faststart ? undefined : 'yes'],
    ]],
    ['Video', [
      ['Codec', v.codec ?? 'none', same(v.codec, 'h264')],
      ['Size', `${v.width}×${v.height}`, r.width && (v.width !== r.width || v.height !== r.height) ? `${r.width}×${r.height}` : undefined],
      ['Frame rate', `${trim(v.fps ?? 0, 3)} fps`],
      ['Frames', String(p.frames ?? v.frames), r.framesTotal && (p.frames ?? v.frames) !== r.framesTotal ? String(r.framesTotal) : undefined],
      ['Pixel format', v.pixFmt ?? 'none', same(v.pixFmt, 'yuv420p')],
    ]],
    ['Colour', [
      ['Primaries', ...tag(c.primaries)],
      ['Transfer', ...tag(c.transfer)],
      ['Matrix', ...tag(c.space)],
      ['Range', c.range ?? 'none'],
    ]],
    ['Audio', a ? [
      ['Codec', a.codec, same(a.codec, 'aac')],
      ['Sample rate', `${a.sampleRate} Hz`, a.sampleRate === 48000 ? undefined : '48000 Hz'],
      ['Channels', String(a.channels)],
    ] : [['Stream', 'none', 'an audio stream']]],
  ];
}

function probeTable(p, r) {
  return h('table.report-table', { 'data-testid': 'report-probe' },
    h('caption.visually-hidden', 'Facts about the encoded file'),
    probeRows(p, r).map(([group, rows]) => h('tbody',
      h('tr.group', h('th', { colspan: 2, scope: 'colgroup' }, group)),
      rows.map(([label, value, expected]) => h('tr', expected === undefined ? null : { class: 'warn' },
        h('th', { scope: 'row' }, label),
        h('td', value, expected === undefined ? null : h('span.expect', `expected ${expected}`)))))));
}

function loudnessBlock(data) {
  const l = data.loudness ?? {};
  const m = l.measured, ms = l.master ?? {}, t = data.timings ?? {};
  const secs = (n) => (Number.isFinite(n) ? `${trim(n, 2)} s` : 'unknown');
  const pair = (x) => (x ? `${num(x.integrated)} LUFS, true peak ${num(x.truePeak)} dBTP` : 'unknown');
  return h('section.report-block.full', { 'data-testid': 'report-loudness' },
    h('div.report-block-head', h('h3', 'Loudness'), l.master || l.target ? metBadge(l, 'report-loudness-met') : null),
    !m ? h('p.muted', 'No loudness was measured for this render.') : h('dl.facts',
      h('dt', 'Measured'), h('dd.mono', Number.isFinite(m.integrated) ? loudnessLine({ loudness: l }) : 'No audio to measure'),
      h('dt', 'Target'), h('dd', l.target ? targetText(l.target) : 'None (the mix is only kept clear of clipping)'),
      ms.mode ? [
        h('dt', 'Master'), h('dd', ms.mode === 'target' ? `One gain of ${signed(ms.gainDb)} dB` : 'No gain change'),
        h('dt', 'Limiter'), h('dd', ms.limited ? `Held the peaks${Number.isFinite(ms.limitDb) ? ` at ${dB(ms.limitDb)}` : ''}` : 'Not needed'),
        ms.before && ms.after ? [h('dt', 'Mix before'), h('dd.mono', pair(ms.before)), h('dt', 'Mix after'), h('dd.mono', pair(ms.after))] : null,
      ] : null,
      h('dt', 'Correction'), h('dd', l.correction ?? 'None needed'),
      ms.note ? [h('dt', 'Note'), h('dd', ms.note)] : null),
    h('p.hint', `Passes: render ${secs(t.render)} · mix ${secs(t.mix)} · report ${secs(t.report)} · loudness ${secs(t.loudness)}`));
}

function narrationBlock(list) {
  const entries = list.map((n) => {
    if (!n.first) return h('li', h('span.report-when.mono', n.item), h('span.report-what', 'No words were timed.'));
    return h('li.narration',
      h('span.report-when.mono', n.item),
      h('dl.facts',
        h('dt', 'First word'), h('dd', `${fmtTime(n.first.t)} (frame ${n.first.frame})`),
        h('dt', 'Last word'), h('dd', `${fmtTime(n.last.t)} (frame ${n.last.frame})`),
        h('dt', 'Head and tail'), h('dd', `${trim(n.head, 2)} s before the first word, ${trim(n.tail, 2)} s after the last`),
        h('dt', 'Over cuts'), h('dd', n.overCuts.length
          ? h('ul.report-list', n.overCuts.map((w) => h('li', h('span.badge.warn', 'crosses a cut'), ` “${w.word}” ${range(w.t, w.end)} over the cut at ${fmtTime(w.cut)}`)))
          : 'No word crosses a cut'),
        n.outside.length ? [h('dt', 'Past the end'), h('dd', n.outside.map((w) => `“${w.text}” at ${fmtTime(w.start)}`).join(', '))] : null));
  });
  return block('report-narration', 'Narration', entries, null, true);
}

/**
 * The report of one render from GET /api/renders/:id/report. `r` is the render (its size and frame count
 * are what the file is checked against). `problems: false` leaves the problems list out (the page has one).
 */
export function reportView(data, r, { problems = true } = {}) {
  const rep = data.report;
  const fl = rep.flashes ?? { maxPerSecond: 0, failing: [] };
  return h('div.report-view', { 'data-testid': 'render-report', 'data-render': data.render },
    problems ? h('section.report-block.full', { 'data-testid': 'report-problems' },
      h('div.report-block-head', h('h3', 'Problems')),
      problemsList(data.problems, { count: 'report-problem-count', item: 'report-problem' }, true)) : null,
    h('section.report-block.full',
      h('div.report-block-head', h('h3', 'The encoded file')),
      h('div.table-wrap', probeTable(rep.probe, r))),
    loudnessBlock(data),
    block('report-black', 'Black frames', (rep.black ?? []).map((b) => item(range(b.start, b.end), `${plural(b.frames, 'frame')} of black`))),
    block('report-freezes', 'Frozen picture', (rep.freezes ?? []).map((f) => item(range(f.start, f.end ?? f.start + f.duration),
      `${trim(f.duration, 2)} s `, f.excused ? h('span.badge.ok', 'a hold') : h('span.badge.warn', 'outside any hold')))),
    block('report-jumps', 'Brightness jumps', (rep.jumps ?? []).map((j) => item(fmtTime(j.t), `frame ${j.frame} · mean brightness ${trim(j.from, 2)} to ${trim(j.to, 2)}, no cut marker there`))),
    block('report-flashes', 'Flashing',
      fl.failing.map((f) => item(range(f.start, f.end), `up to ${plural(f.count, 'flash', 'flashes')} in one second · ${f.region === 'frame' ? 'whole frame' : f.region}`)),
      h('p.report-note', `Most flashes in any second: ${fl.maxPerSecond} (the limit is 3). `, fl.failing.length ? h('span.badge.warn', 'over the limit') : h('span.badge.ok', 'within the limit'))),
    block('report-silences', 'Silences', (rep.silences ?? []).map((s) => item(range(s.start, s.end), `${trim(s.duration, 2)} s of silence`))),
    narrationBlock(rep.narration ?? []),
    sheetsBlock(data.urls?.sheets ?? []));
}

function sheetsBlock(urls) {
  return h('section.report-block.full', { 'data-testid': 'report-sheets', 'data-count': urls.length },
    h('div.report-block-head', h('h3', 'Frames from the encoded file'), h('span.count', urls.length ? plural(urls.length, 'sheet') : null)),
    urls.length ? h('ul.report-sheets', urls.map((u, i) => h('li', h('a.report-sheet', { href: u, target: '_blank', rel: 'noopener', 'data-testid': 'report-sheet', 'aria-label': `Open sheet ${i + 1} of ${urls.length} in a new tab` },
      h('img', { src: u, alt: `Frame sheet ${i + 1}`, loading: 'lazy' }))))) : h('p.muted.report-none', 'None'));
}

/** Fetches the report of render `r` and shows it; loading and error states included. */
export function reportPanel(r, options) {
  const box = h('div.report-panel');
  const load = async () => {
    fill(box, h('div.state.loading', { role: 'status', 'data-testid': 'report-loading' }, h('span.spinner'), 'Loading the report'));
    let data;
    try {
      data = await api.get(`/api/renders/${r.id}/report`);
    } catch (e) {
      if (!box.isConnected) return;
      const retry = h('button.btn', { type: 'button', 'data-testid': 'report-retry' }, 'Try again');
      retry.addEventListener('click', load);
      fill(box, h('div.state.error', { role: 'alert', 'data-testid': 'report-error' }, h('h2', 'The report did not load'), h('p', e.message), h('div.row', retry)));
      return;
    }
    if (box.isConnected) fill(box, reportView(data, r, options));
  };
  load();
  return box;
}

function openReport(r) {
  const d = openDialog({
    title: `Report for render #${r.id}`,
    body: reportPanel(r),
    actions: downloadLinks(r),
    testid: 'render-report-dialog',
    wide: true,
  });
  d.el.classList.add('report-dialog');
  return d;
}

// ── the queue ─────────────────────────────────────────────────────────────────────────────────

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
  const quality = h('div.render-quality', { hidden: true });
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
    quality,
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
    quality.hidden = true;
    if (r.status === 'done') {
      const s = r.stats ?? {};
      const parts = [loudnessSummary(s), problemsList(s.problems)].filter(Boolean);
      fill(quality, parts);
      quality.hidden = !parts.length;
      fill(detail,
        h('span', { 'data-testid': 'render-stats' }, [
          Number.isFinite(s.renderSeconds) ? `rendered in ${trim(s.renderSeconds, 2)} s` : null,
          Number.isFinite(s.framesPerSecond) ? `${trim(s.framesPerSecond, 1)} frames/s` : null,
          Number.isFinite(s.realtimeFactor) ? `${trim(s.realtimeFactor, 2)}× real time` : null,
          s.workers ? plural(s.workers, 'worker') : null,
        ].filter(Boolean).join(' · ')),
        h('a.btn.small', { href: `/gallery/${r.id}`, 'data-testid': 'open-in-gallery' }, 'Open in gallery'),
        hasReport(r) ? h('button.btn.small', { type: 'button', 'data-testid': 'render-report-open', onclick: () => openReport(r) }, 'View report') : h('span.muted', { 'data-testid': 'render-no-report' }, NO_REPORT));
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

  // live: a render queued, started or finished anywhere refreshes now rather than at the next poll
  ctx.onCleanup(live.on('render', () => renderQueue.refresh()));
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
