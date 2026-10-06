// Clips: every clip as a card with a poster frame drawn by the renderer.

import { api, getStatus } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { openDialog } from '/ui/lib/dialog.js';
import { debounce, empty, errorBlock, fill, fmtDuration, h, icon, notice, plural } from '/ui/lib/util.js';

const SLUG = '[a-z0-9][a-z0-9-]{1,63}';

function clipCard(c) {
  const hasFrames = c.assetCount > 0;
  const t = Math.round(c.duration * 0.4 * 100) / 100;
  return h('a.card.clip-card', { href: `/clips/${c.slug}`, 'data-testid': 'clip-card', 'data-slug': c.slug },
    h('div.thumb',
      hasFrames
        ? h('img', { src: `/api/clips/${c.slug}/frame.png?t=${t}&maxSize=480&r=${c.revision}`, alt: '', loading: 'lazy' })
        : h('span.thumb-icon', icon('film', 40))),
    h('div.card-body',
      h('div.card-title', h('h3', c.title), h('span.badge', c.format)),
      h('div.ref', c.slug),
      c.description ? h('p.desc', c.description) : null,
      h('div.meta',
        h('span', `${c.width}×${c.height}`),
        h('span', fmtDuration(c.duration)),
        h('span', `revision ${c.revision}`),
        h('span', plural(c.assetCount, 'asset')),
        h('span', c.renders ? plural(c.renders, 'finished render') : 'not rendered yet'),
        c.remixedFrom ? h('span', 'remix of ', h('b', c.remixedFrom)) : null)));
}

/** A form that creates an empty clip and opens it in the editor. */
function newClipDialog(ctx, status) {
  const name = h('input', { type: 'text', id: 'nc-name', required: true, pattern: SLUG, placeholder: 'my-clip', 'data-testid': 'new-clip-name', autocomplete: 'off', spellcheck: false });
  const title = h('input', { type: 'text', id: 'nc-title', placeholder: 'My clip', 'data-testid': 'new-clip-title', autocomplete: 'off' });
  const format = h('select', { id: 'nc-format', 'data-testid': 'new-clip-format' }, Object.entries(status.formats).map(([k, f]) => h('option', { value: k }, `${f.label} · ${f.width}×${f.height}`)));
  const duration = h('input.num', { type: 'number', id: 'nc-duration', min: 1, max: 120, step: 1, value: '30', 'data-testid': 'new-clip-duration' });
  const err = notice('new-clip-error');
  const create = h('button.btn.primary', { type: 'submit', 'data-testid': 'new-clip-create' }, 'Create clip');
  const form = h('form.form', { novalidate: true },
    h('div.field', h('label', { for: 'nc-name' }, 'Name'), name, h('p.hint', 'Lowercase letters, digits and dashes.')),
    h('div.field', h('label', { for: 'nc-title' }, 'Title'), title),
    h('div.field', h('label', { for: 'nc-format' }, 'Format'), format),
    h('div.field', h('label', { for: 'nc-duration' }, 'Duration in seconds'), duration),
    err.el,
    h('div.dialog-foot.inline', create));
  const d = openDialog({ title: 'New clip', body: form, testid: 'new-clip-dialog' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hide();
    const slug = name.value.trim();
    if (!new RegExp(`^${SLUG}$`).test(slug)) { err.show('The name needs 2 to 64 lowercase letters, digits or dashes.'); name.focus(); return; }
    create.disabled = true;
    try {
      const clip = await api.post('/api/clips', { name: slug, title: title.value.trim() || slug, format: format.value, duration: Number(duration.value) || 30 });
      d.close();
      ctx.navigate(`/clips/${clip.slug}`);
    } catch (e2) {
      err.show(e2.message);
      create.disabled = false;
    }
  });
  name.focus();
}

export async function mount(view, ctx) {
  ctx.setTitle('Clips');
  let clips, status;
  try {
    [{ clips }, status] = await Promise.all([api.get('/api/clips'), getStatus()]);
  } catch (e) {
    fill(view, errorBlock(e.message));
    return;
  }
  if (!ctx.alive()) return;
  const newBtn = h('button.btn', { type: 'button', 'data-testid': 'new-clip', onclick: () => newClipDialog(ctx, status) }, icon('plus', 16), 'New clip');
  const count = h('span.count', { 'data-testid': 'clip-count' });
  const body = h('div');
  const draw = () => {
    count.textContent = plural(clips.length, 'clip');
    fill(body, clips.length
      ? h('div.grid.clips', { 'data-testid': 'clip-grid' }, clips.map(clipCard))
      : empty('No clips yet', 'A clip is a timeline of assets. Create one here, or let Claude Code build one through the MCP server.'));
  };
  fill(view,
    h('div.page-head',
      h('div', h('h1', 'Clips'), h('p.sub', 'Compositions that pin the asset versions they use.')),
      h('div.page-head-side', count, newBtn)),
    body);
  draw();
  // live: a clip made or saved anywhere (another tab, the MCP server) shows up without a reload
  const reload = debounce(async () => {
    try { ({ clips } = await api.get('/api/clips')); } catch { return; }
    if (ctx.alive()) draw();
  }, 200);
  ctx.onCleanup(live.on('clip', () => reload()));
  ctx.onCleanup(() => reload.cancel());
}
