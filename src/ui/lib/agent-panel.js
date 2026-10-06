// Ask the agent: a composer, the requests for one scope, and each request's thread with the
// agent's proposals (preview, accept, reject, reply). Mounted by the playground (scope asset), the
// clip editor (scope clip) and used by the requests screen (threadView). Everything updates from
// live 'request' events; nothing polls.
//
//   const panel = mountAgentPanel(container, { scope: 'asset', asset: 'block', getContext: () => ({ version, params }),
//     onPreview: (p) => …, onAccepted: (result) => … });
//   ctx.onCleanup(panel.destroy);

import { api, getStatus } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { assetHref, fill, fmtDate, h, icon, nextId, plural } from '/ui/lib/util.js';

export const STATUS_LABEL = { open: 'Open', working: 'Working', review: 'Review', done: 'Done', cancelled: 'Cancelled' };
const ROLE_LABEL = { user: 'You', agent: 'Agent', system: 'Studio', progress: 'Run' };
const KIND_LABEL = { 'asset-version': 'New version', 'new-asset': 'New asset', 'clip-edit': 'Clip edit' };

/** "just now", "4 min ago", "3 h ago", "2 d ago", then the date. */
export function age(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(iso);
}

export const statusBadge = (status) => h(`span.badge.rq-${status}`, { 'data-status': status }, STATUS_LABEL[status] ?? status);

/** Where a request points: the asset or clip it was asked about. */
export function scopeLink(r) {
  if (r.scope === 'asset' && r.asset) return h('a.rq-scope', { href: r.assetRef ? assetHref(r.assetRef) : `/assets/${r.asset}`, 'data-testid': 'request-scope' }, r.assetRef ?? r.asset);
  if (r.scope === 'clip' && r.clip) return h('a.rq-scope', { href: `/clips/${r.clip}`, 'data-testid': 'request-scope' }, `${r.clip}${r.clipRevision ? ` #${r.clipRevision}` : ''}`);
  return h('span.rq-scope', { 'data-testid': 'request-scope' }, 'Library');
}

/** Run something at most once at a time; a call during a run schedules one more run. */
function coalesce(fn) {
  let busy = false, again = false;
  return async function run() {
    if (busy) { again = true; return; }
    busy = true;
    try { await fn(); } finally { busy = false; }
    if (again) { again = false; run(); }
  };
}

const runNowAvailable = () => getStatus().then((s) => !!s?.agent?.runNow, () => false);

// ── one request's thread ──────────────────────────────────────────────────────────────────

/**
 * A request's thread: messages, progress from a Run now session, proposals and the actions on
 * them. Refreshes itself on live events for this request.
 * @param {number} id
 * @param {{ onPreview?: (p: any) => void, onAccepted?: (result: any) => void, onChange?: (request: any) => void, compact?: boolean }} [opts]
 */
export function threadView(id, opts = {}) {
  const el = h('div.agent-thread', { 'data-testid': 'agent-thread', 'data-id': id, 'aria-busy': 'true' });
  const body = h('div.agent-thread-body', h('div.agent-loading', h('span.spinner'), 'Loading the thread'));
  const msg = h('div.notice.error', { hidden: true, role: 'alert', 'data-testid': 'agent-error' });
  el.append(body, msg);
  let data = null, alive = true, runNow = false;
  /** per-proposal UI state that survives a re-render */
  const ui = new Map();
  const openLogs = new Set();
  const pState = (pid) => { if (!ui.has(pid)) ui.set(pid, { reason: '', conflict: null, busy: false }); return ui.get(pid); };

  const replyInput = h('textarea.agent-reply-input', { rows: 2, placeholder: 'Reply to the agent', 'aria-label': 'Reply to the agent', 'data-testid': 'agent-reply-input', maxLength: 4000 });
  const replyBtn = h('button.btn.small', { type: 'button', 'data-testid': 'agent-reply' }, 'Reply');
  replyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); replyBtn.click(); } });
  replyBtn.addEventListener('click', () => sendReply(replyInput.value, replyBtn, () => { replyInput.value = ''; }));

  const showError = (text) => { msg.textContent = text; msg.hidden = false; };
  const hideError = () => { msg.hidden = true; msg.textContent = ''; };

  async function act(btn, fn) {
    hideError();
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { showError(e.message); } finally { if (btn) btn.disabled = false; }
    refresh();
  }

  function sendReply(text, btn, done) {
    const body2 = text.trim();
    if (!body2) { replyInput.focus(); return; }
    act(btn, async () => { await api.post(`/api/requests/${id}/messages`, { body: body2 }); done?.(); });
  }

  const refresh = coalesce(async () => {
    try {
      const [next, rn] = await Promise.all([api.get(`/api/requests/${id}`), runNowAvailable()]);
      if (!alive) return;
      data = next;
      runNow = rn;
      draw();
      opts.onChange?.(data);
    } catch (e) {
      if (!alive) return;
      if (!data) fill(body, h('p.muted', e.message)); else showError(e.message);
    } finally {
      el.removeAttribute('aria-busy');
    }
  });

  function proposalCard(p) {
    const st = pState(p.id);
    const meta = p.meta ?? {};
    const pending = p.status === 'pending' && data.status !== 'cancelled';
    const wouldBe = meta.wouldBe ?? (p.kind === 'clip-edit' ? `${p.target} next revision` : p.target);
    const head = h('div.agent-proposal-head',
      h('span.badge', KIND_LABEL[p.kind] ?? p.kind),
      h(`span.badge.pp-${p.status}`, p.status),
      h('span.agent-ref.mono', { title: 'Made against → would become' }, p.base ? `${p.base} → ${wouldBe}` : wouldBe));
    const warnings = meta.warnings?.length ? h('ul.agent-warnings', { 'data-testid': 'agent-warnings' }, meta.warnings.map((w) => h('li', typeof w === 'string' ? w : w.message ?? JSON.stringify(w)))) : null;
    const facts = [
      meta.framesChecked ? `${plural(meta.framesChecked, 'frame')} checked` : null,
      Array.isArray(meta.testFrames) ? `${plural(meta.testFrames.length, 'test frame')}` : null,
      p.result ? `now ${p.result}` : null,
    ].filter(Boolean).join(' · ');
    const card = h('div.agent-proposal', { 'data-testid': 'agent-proposal', 'data-id': p.id, 'data-status': p.status },
      p.thumb ? h('img.agent-thumb', { src: `/media/${p.thumb}`, alt: `Proposal #${p.id}`, loading: 'lazy' }) : null,
      h('div.agent-proposal-main',
        head,
        p.summary ? h('p.agent-summary', p.summary) : null,
        facts ? h('p.agent-facts', facts) : null,
        warnings));
    if (!pending) return card;

    const actions = h('div.agent-actions');
    if (opts.onPreview) {
      const preview = h('button.btn.small', { type: 'button', 'data-testid': 'agent-preview' }, 'Preview');
      preview.addEventListener('click', () => act(preview, async () => { opts.onPreview(await api.get(`/api/proposals/${p.id}/preview`)); }));
      actions.append(preview);
    }
    const accept = h('button.btn.small.primary', { type: 'button', 'data-testid': 'agent-accept' }, 'Accept');
    const doAccept = (btn, force) => act(btn, async () => {
      try {
        const out = await api.post(`/api/proposals/${p.id}/accept`, force ? { force: true } : {});
        st.conflict = null;
        opts.onAccepted?.(out);
      } catch (e) {
        if (e.status === 409) { st.conflict = { message: e.message, latest: e.body?.details?.latest ?? null }; return; }
        throw e;
      }
    });
    accept.addEventListener('click', () => doAccept(accept, false));
    const reason = h('input.agent-reason', { type: 'text', placeholder: 'Reason (optional)', 'aria-label': 'Reason for rejecting', 'data-testid': 'agent-reject-reason', value: st.reason, maxLength: 2000 });
    reason.addEventListener('input', () => { st.reason = reason.value; });
    const reject = h('button.btn.small', { type: 'button', 'data-testid': 'agent-reject' }, 'Reject');
    reason.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reject.click(); } });
    reject.addEventListener('click', () => act(reject, async () => {
      await api.post(`/api/proposals/${p.id}/reject`, { reason: st.reason.trim() || undefined });
      st.reason = '';
    }));
    actions.append(accept);
    card.querySelector('.agent-proposal-main').append(actions, h('div.agent-reject-row', reason, reject));

    if (st.conflict) {
      const force = p.kind === 'clip-edit' ? null : h('button.btn.small', { type: 'button', 'data-testid': 'agent-accept-force' }, 'Accept anyway');
      force?.addEventListener('click', () => doAccept(force, true));
      const rebase = h('button.btn.small', { type: 'button', 'data-testid': 'agent-rebase' }, 'Ask to rebase');
      rebase.addEventListener('click', () => {
        const text = p.kind === 'clip-edit'
          ? 'The clip changed since this proposal. Please redo it on the current revision.'
          : `Please start again from the latest version${st.conflict?.latest ? ` (${st.conflict.latest})` : ''}.`;
        st.conflict = null;
        sendReply(text, rebase);
      });
      card.querySelector('.agent-proposal-main').append(h('div.agent-conflict', { role: 'alert', 'data-testid': 'agent-conflict' }, h('p', st.conflict.message), h('div.agent-actions', force, rebase)));
    }
    return card;
  }

  function messageEl(m) {
    return h('li.agent-message', { 'data-testid': 'agent-message', 'data-role': m.role, 'data-id': m.id },
      h('div.agent-message-head', h('b', m.role === 'agent' || m.role === 'user' ? `${ROLE_LABEL[m.role]}${m.author && m.role === 'agent' ? ` · ${m.author}` : ''}` : ROLE_LABEL[m.role] ?? m.role), h('time', { datetime: m.at, title: fmtDate(m.at) }, age(m.at))),
      h('p.agent-body', m.body));
  }

  function progressGroup(lines, running) {
    const key = lines[0].id;
    const det = h('details.agent-progress', { 'data-testid': 'agent-progress', open: openLogs.has(key) || running },
      h('summary', { 'data-testid': 'agent-progress-toggle' }, running ? h('span.spinner') : null, `Run log · ${plural(lines.length, 'line')}`),
      h('ol', lines.map((m) => h('li', { 'data-testid': 'agent-message', 'data-role': 'progress' }, m.body))));
    det.addEventListener('toggle', () => { if (det.open) openLogs.add(key); else openLogs.delete(key); });
    return det;
  }

  function draw() {
    const r = data;
    el.dataset.status = r.status;
    const running = !!r.running;
    const byProposal = new Map(r.proposals.map((p) => [p.id, p]));
    const shown = new Set();
    const items = [];
    const msgs = r.messages;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === 'progress') {
        // one log per run: studio lines that arrive between progress lines go under it
        const group = [], between = [];
        while (i < msgs.length && (msgs[i].role === 'progress' || msgs[i].role === 'system')) (msgs[i].role === 'progress' ? group : between).push(msgs[i++]);
        i--;
        items.push(h('li.agent-progress-item', progressGroup(group, running && i === msgs.length - 1)), ...between.map(messageEl));
        continue;
      }
      items.push(messageEl(m));
      // the proposal sits under the agent's message that made it
      if (m.role === 'agent' && m.proposal && byProposal.has(m.proposal) && !shown.has(m.proposal)) {
        shown.add(m.proposal);
        items.push(h('li.agent-proposal-item', proposalCard(byProposal.get(m.proposal))));
      }
    }
    for (const p of r.proposals) if (!shown.has(p.id)) items.push(h('li.agent-proposal-item', proposalCard(p)));

    const open = r.status !== 'done' && r.status !== 'cancelled';
    const working = r.status === 'working' || running;
    const foot = h('div.agent-foot');
    if (working) foot.append(h('div.agent-working', { role: 'status', 'data-testid': 'agent-working' }, h('span.spinner'), running ? 'Running now' : `${r.claimedBy ?? 'The agent'} is working on it`));
    else if (r.status === 'open') foot.append(h('p.agent-wait', { 'data-testid': 'agent-waiting' }, 'Waiting for the agent. Claude Code picks it up over MCP.'));
    const tools = h('div.agent-actions');
    if (running) {
      const stop = h('button.btn.small.agent-left', { type: 'button', 'data-testid': 'agent-run-cancel' }, 'Cancel run');
      stop.addEventListener('click', () => act(stop, () => api.post(`/api/requests/${id}/run/cancel`)));
      tools.append(stop);
    } else if (runNow && open) {
      const run = h('button.btn.small.agent-left', { type: 'button', 'data-testid': 'agent-run-now' }, 'Run now');
      run.addEventListener('click', () => act(run, () => api.post(`/api/requests/${id}/run`)));
      tools.append(run);
    }
    if (open) {
      const cancel = h('button.btn.small.danger', { type: 'button', 'data-testid': 'agent-cancel' }, 'Cancel request');
      cancel.addEventListener('click', () => act(cancel, () => api.post(`/api/requests/${id}/cancel`)));
      tools.append(cancel);
    }
    if (r.status !== 'cancelled') { foot.append(replyInput); tools.append(replyBtn); }
    if (tools.childElementCount) foot.append(tools);

    const hadFocus = el.contains(document.activeElement) ? document.activeElement : null;
    const focusId = hadFocus?.dataset?.testid;
    const focusPid = hadFocus?.closest?.('[data-testid=agent-proposal]')?.dataset.id;
    fill(body, h('ol.agent-messages', items), foot);
    // keep keyboard focus across a live re-render
    if (hadFocus && !el.contains(hadFocus) && focusId) {
      const sel = focusPid ? `[data-testid=agent-proposal][data-id="${focusPid}"] [data-testid="${focusId}"]` : `[data-testid="${focusId}"]`;
      /** @type {HTMLElement | null} */ (el.querySelector(sel))?.focus();
    }
  }

  const off = live.on('request', (e) => { if (Number(e.key) === Number(id)) refresh(); });
  refresh();
  return {
    el,
    refresh,
    get data() { return data; },
    destroy() { alive = false; off(); },
  };
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {{ scope: 'asset' | 'clip' | 'library', asset?: string, clip?: string,
 *   getContext?: () => ({ version?: number, params?: any, at?: number, items?: string[] }),
 *   onPreview?: (p: any) => void, onAccepted?: (result: any) => void }} opts
 * @returns {{ destroy(): void, refresh(): void }}
 */
export function mountAgentPanel(container, opts) {
  const scope = opts.scope ?? (opts.asset ? 'asset' : opts.clip ? 'clip' : 'library');
  const listUrl = scope === 'asset' ? `/api/requests?asset=${encodeURIComponent(opts.asset ?? '')}`
    : scope === 'clip' ? `/api/requests?clip=${encodeURIComponent(opts.clip ?? '')}` : '/api/requests?scope=library';
  const sheetId = nextId('agent-sheet');
  let alive = true, requests = [], first = true;
  /** id → { el, thread?, open } */
  const rows = new Map();

  const input = h('textarea.agent-input', { rows: 3, maxLength: 4000, 'data-testid': 'agent-input', 'aria-label': 'Ask the agent',
    placeholder: scope === 'asset' ? 'Ask for a change to this asset' : scope === 'clip' ? 'Ask for a change to this clip' : 'Ask the agent' });
  const send = h('button.btn.primary.small', { type: 'button', 'data-testid': 'agent-send' }, 'Send');
  const sendMsg = h('div.notice.error', { hidden: true, role: 'alert', 'data-testid': 'agent-send-error' });
  const hint = h('span.agent-hint', 'Ctrl+Enter to send');
  const count = h('span.count', { 'data-testid': 'agent-count' });
  const list = h('ol.agent-requests', { 'data-testid': 'agent-requests' });
  const listState = h('div.agent-list-state', h('div.agent-loading', h('span.spinner'), 'Loading requests'));

  const close = h('button.icon-btn.agent-close', { type: 'button', 'aria-label': 'Close', 'data-testid': 'agent-close' }, icon('close', 18));
  const sheet = h('section.agent-panel', { id: sheetId, 'aria-label': 'Ask the agent', 'data-testid': 'agent-panel', 'data-scope': scope },
    h('div.agent-head', h('h2', 'Ask the agent'), count, close),
    h('div.agent-composer', input, sendMsg, h('div.agent-actions', hint, send)),
    listState, list);
  const openBtn = h('button.btn.agent-open', { type: 'button', 'data-testid': 'agent-open', 'aria-controls': sheetId, 'aria-expanded': 'false' }, 'Ask the agent', h('b.agent-open-n', { hidden: true }));
  const backdrop = h('div.agent-backdrop', { hidden: true });
  const root = h('div.agent-dock', openBtn, backdrop, sheet);
  container.append(root);

  function setSheet(on) {
    root.classList.toggle('sheet-open', on);
    backdrop.hidden = !on;
    openBtn.setAttribute('aria-expanded', String(on));
    document.documentElement.classList.toggle('agent-sheet-lock', on);
    if (on) input.focus(); else openBtn.focus();
  }
  openBtn.addEventListener('click', () => setSheet(true));
  close.addEventListener('click', () => setSheet(false));
  backdrop.addEventListener('click', () => setSheet(false));
  const onKey = (e) => { if (e.key === 'Escape' && root.classList.contains('sheet-open')) setSheet(false); };
  document.addEventListener('keydown', onKey);

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); } });
  send.addEventListener('click', async () => {
    const message = input.value.trim();
    sendMsg.hidden = true;
    if (!message) { input.focus(); return; }
    const c = opts.getContext?.() ?? {};
    send.disabled = true;
    try {
      const r = await api.post('/api/requests', { scope, asset: opts.asset, clip: opts.clip, version: c.version, params: c.params, at: c.at, items: c.items, message });
      input.value = '';
      // the new one opens; the others fold
      for (const row of rows.values()) row.open = false;
      rows.set(r.id, { open: true });
      await load();
    } catch (e) {
      sendMsg.textContent = e.message;
      sendMsg.hidden = false;
    } finally {
      send.disabled = false;
    }
  });

  function toggle(id) {
    const row = rows.get(id);
    row.open = !row.open;
    draw();
  }

  function rowEl(r) {
    let row = rows.get(r.id);
    if (!row) { row = { open: false }; rows.set(r.id, row); }
    const head = h('button.agent-req-head', { type: 'button', 'data-testid': 'agent-request', 'data-id': r.id, 'data-status': r.status, 'aria-expanded': String(row.open) },
      icon('down', 14),
      h('span.agent-req-title', r.title),
      r.pending ? h('span.rq-pending', { title: 'A proposal is waiting for you' }, 'proposal') : null,
      statusBadge(r.status),
      h('time', { datetime: r.createdAt }, age(r.createdAt)));
    head.addEventListener('click', () => toggle(r.id));
    if (!row.el) row.el = h('li.agent-req');
    row.el.dataset.status = r.status;
    if (row.open && !row.thread) row.thread = threadView(r.id, { onPreview: opts.onPreview, onAccepted: opts.onAccepted, compact: true });
    if (!row.open && row.thread) { row.thread.destroy(); row.thread = null; }
    fill(row.el, head, row.thread?.el ?? null);
    return row.el;
  }

  function draw() {
    count.textContent = requests.length ? plural(requests.length, 'request') : '';
    const waiting = requests.filter((r) => r.status === 'review').length;
    const n = openBtn.querySelector('.agent-open-n');
    n.textContent = String(waiting);
    n.hidden = !waiting;
    if (!requests.length) {
      fill(listState, h('p.agent-empty', { 'data-testid': 'agent-empty' }, scope === 'library' ? 'No library questions yet.' : `Nothing asked about this ${scope} yet.`));
      list.replaceChildren();
      return;
    }
    listState.replaceChildren();
    // newest first; the newest is open unless the user folded it
    if (first) { first = false; const r0 = requests[0]; if (!rows.has(r0.id)) rows.set(r0.id, { open: true }); }
    const ids = new Set(requests.map((r) => r.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.thread?.destroy(); rows.delete(id); }
    const older = requests.slice(1);
    const els = [rowEl(requests[0])];
    if (older.length) els.push(h('li.agent-older', h('span', plural(older.length, 'earlier request'))), ...older.map(rowEl));
    fill(list, els);
  }

  const load = coalesce(async () => {
    try {
      const out = await api.get(`${listUrl}&limit=50`);
      if (!alive) return;
      requests = out.requests;
      draw();
    } catch (e) {
      if (alive) fill(listState, h('p.notice.error', { role: 'alert' }, e.message));
    }
  });

  const off = live.on('request', (e) => {
    const id = Number(e.key);
    const mine = requests.some((r) => r.id === id)
      || (e.action === 'created' && (scope === 'asset' ? e.data?.asset === opts.asset : scope === 'clip' ? e.data?.clip === opts.clip : e.data?.scope === 'library'));
    if (mine) load();
  });
  load();

  return {
    refresh() { load(); for (const row of rows.values()) row.thread?.refresh(); },
    destroy() {
      alive = false;
      off();
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('agent-sheet-lock');
      for (const row of rows.values()) row.thread?.destroy();
      rows.clear();
      root.remove();
    },
  };
}
