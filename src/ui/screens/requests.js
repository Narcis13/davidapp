// Requests to the agent. /requests is the inbox (every request, filtered by status, with a composer
// for a library question); /requests/<id> is one thread with its proposals. Live: both follow
// 'request' events, nothing polls.

import { api } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { age, scopeLink, statusBadge, STATUS_LABEL, threadView } from '/ui/lib/agent-panel.js';
import { debounce, empty, errorBlock, fill, fmtDate, h, icon, notice, plural } from '/ui/lib/util.js';

const STATUSES = ['open', 'working', 'review', 'done', 'cancelled'];

function row(r) {
  return h('li.request-row', { 'data-testid': 'request-row', 'data-id': r.id, 'data-status': r.status },
    h('div.request-main',
      h('a.request-title', { href: `/requests/${r.id}`, 'data-testid': 'request-open' }, h('span.ref', `#${r.id}`), h('span', r.title)),
      h('div.request-meta',
        r.scope === 'library' ? null : h('span.rq-kind', r.scope),
        scopeLink(r),
        h('time', { datetime: r.createdAt, title: fmtDate(r.createdAt) }, age(r.createdAt)),
        r.messages ? h('span', plural(r.messages, 'message')) : null)),
    h('div.request-side',
      r.pending ? h('span.rq-pending', { 'data-testid': 'request-pending', title: 'A proposal is waiting for you' }, 'Proposal waiting') : null,
      statusBadge(r.status)));
}

async function inbox(view, ctx) {
  ctx.setTitle('Requests');
  let filter = STATUSES.includes(ctx.query.get('status') ?? '') ? ctx.query.get('status') : '';
  let requests = null;

  const input = h('textarea.agent-input', { rows: 2, maxLength: 4000, placeholder: 'Ask the agent about the library', 'aria-label': 'Ask the agent about the library', 'data-testid': 'request-input' });
  const send = h('button.btn.primary', { type: 'button', 'data-testid': 'request-send' }, 'Ask');
  const msg = notice('request-error');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); } });
  send.addEventListener('click', async () => {
    msg.hide();
    const message = input.value.trim();
    if (!message) { input.focus(); return; }
    send.disabled = true;
    try {
      const r = await api.post('/api/requests', { scope: 'library', message });
      input.value = '';
      ctx.navigate(`/requests/${r.id}`);
    } catch (e) {
      msg.show(e.message);
      send.disabled = false;
    }
  });

  const filters = h('div.chips.request-filters', { role: 'group', 'aria-label': 'Filter by status' });
  const count = h('span.count', { 'data-testid': 'request-count', role: 'status' });
  const body = h('div.request-body');

  function draw() {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, requests.filter((r) => r.status === s).length]));
    fill(filters, ['', ...STATUSES].map((s) => {
      const n = s ? counts[s] : requests.length;
      const b = h(`button.chip${filter === s ? '.on' : ''}`, { type: 'button', 'data-testid': 'request-filter', 'data-status': s || 'all', 'aria-pressed': String(filter === s) },
        s ? STATUS_LABEL[s] : 'All', h('span.n', String(n)));
      b.addEventListener('click', () => {
        filter = s;
        ctx.setQuery(s ? `?status=${s}` : '');
        draw();
        /** @type {HTMLElement | null} */ (filters.querySelector(`[data-status="${s || 'all'}"]`))?.focus();
      });
      return b;
    }));
    const waiting = counts.open + counts.working + counts.review;
    count.textContent = requests.length ? `${plural(requests.length, 'request')}${waiting ? ` · ${waiting} waiting` : ''}` : '';
    const shown = filter ? requests.filter((r) => r.status === filter) : requests;
    if (!requests.length) fill(body, empty('No requests yet', 'Ask the agent from an asset playground, a clip editor, or above for the whole library.'));
    else if (!shown.length) fill(body, h('p.request-none', { 'data-testid': 'empty' }, `No ${STATUS_LABEL[filter].toLowerCase()} requests.`));
    else fill(body, h('ol.request-list', { 'data-testid': 'request-list' }, shown.map(row)));
  }

  async function load() {
    try {
      const out = await api.get('/api/requests?limit=200');
      if (!ctx.alive()) return;
      requests = out.requests;
      draw();
    } catch (e) {
      if (!ctx.alive()) return;
      if (!requests) fill(body, errorBlock(e.message)); else msg.show(e.message);
    }
  }

  fill(view,
    h('div.page-head',
      h('div', h('h1', 'Requests'), h('p.sub', 'What you asked the agent, and what it proposed.')),
      h('div.page-head-side', count)),
    h('section.panel.request-ask',
      h('h2', 'Ask about the library'),
      h('div.request-compose', input, send),
      msg.el),
    filters,
    body);
  await load();
  const reload = debounce(load, 120);
  ctx.onCleanup(live.on('request', () => reload()));
  ctx.onCleanup(() => reload.cancel());
}

async function detail(view, ctx, id) {
  ctx.setTitle(`Request #${id}`);
  let first;
  try {
    first = await api.get(`/api/requests/${id}`);
  } catch (e) {
    if (ctx.alive()) fill(view, errorBlock(e.message, h('a.btn', { href: '/requests' }, 'Back to requests')));
    return;
  }
  if (!ctx.alive()) return;
  const title = h('h1', first.title);
  const status = h('span');
  const sub = h('p.sub');
  const head = (r) => {
    title.textContent = r.title;
    fill(status, statusBadge(r.status));
    fill(sub, `${r.scope === 'library' ? 'About the library' : `About ${r.scope} `}`, r.scope === 'library' ? null : scopeLink(r), ` · asked ${fmtDate(r.createdAt)} by ${r.author}`);
    ctx.setTitle(`#${r.id} ${r.title}`);
  };
  head(first);
  const open = first.scope === 'asset' && first.asset
    ? h('a.btn', { href: `/assets/${first.asset}`, 'data-testid': 'request-open-scope' }, 'Open the playground')
    : first.scope === 'clip' && first.clip ? h('a.btn', { href: `/clips/${first.clip}`, 'data-testid': 'request-open-scope' }, 'Open the clip editor') : null;
  const accepted = notice('request-accepted');
  const thread = threadView(id, {
    onChange: head,
    onAccepted: (out) => accepted.show(`Accepted: it is now ${out.result}.`, 'ok'),
  });
  ctx.onCleanup(() => thread.destroy());
  fill(view,
    h('div.page-head',
      h('div',
        h('a.back', { href: '/requests', 'data-testid': 'request-back' }, icon('back', 16), 'Requests'),
        h('div.title-row', h('span.ref', `#${id}`), title, status),
        sub),
      open ? h('div.page-head-side', open) : null),
    accepted.el,
    h('section.panel.request-thread', thread.el));
}

export async function mount(view, ctx) {
  const id = ctx.params[0] ? Number(ctx.params[0]) : null;
  if (id !== null) return detail(view, ctx, id);
  return inbox(view, ctx);
}
