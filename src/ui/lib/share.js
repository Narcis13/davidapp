// The clip editor's Share dialog: the clip's live page on this studio (/share/<slug>, the saved clip as it is when the
// page is opened), and an export to one folder that plays from any static host with the studio stopped
// (POST /api/clips/<slug>/share, the same as share_clip). The studio publishes that folder at /shared/<slug>/, a link
// anyone can open without signing in; the folder can also be copied to any other static host.
// An interactive clip has no Render button: Share is the way to the page that plays it.
//
//   openShareDialog({ slug, interactive, dirty })

import { api } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { fill, fmtBytes, fmtDate, h, plural } from '/ui/lib/util.js';

/** @param {{ slug: string, interactive: boolean, dirty: boolean }} o */
export function openShareDialog({ slug, interactive, dirty }) {
  const href = `/share/${slug}`;
  const address = `${location.origin}${href}`;
  const publicHref = `/shared/${slug}/`;
  const publicAddress = `${location.origin}${publicHref}`;
  const testid = interactive ? 'interactive-share-dialog' : 'share-dialog';

  const link = h('input.mono.share-url', { type: 'text', readOnly: true, value: address, 'aria-label': 'Address of the share page', 'data-testid': 'share-url' });
  const copied = h('span.muted.share-copied', { role: 'status', 'data-testid': 'share-copied' });
  const copyBtn = h('button.btn.small', { type: 'button', 'data-testid': 'share-copy' }, 'Copy link');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(address); copied.textContent = 'Copied.'; }
    catch { link.select(); copied.textContent = 'Selected: press Ctrl+C (⌘C) to copy.'; }
  });
  link.addEventListener('focus', () => link.select());

  const baseUrl = h('input', { type: 'text', inputmode: 'url', id: 'share-base', placeholder: publicAddress, autocomplete: 'off', spellcheck: false, 'data-testid': 'share-base-url' });
  const exportBtn = h('button.btn.primary', { type: 'button', 'data-testid': 'share-export' }, 'Publish');
  const last = h('p.hint', { 'data-testid': 'share-last' });
  const result = h('div', { 'data-testid': 'share-result' });

  const body = h('div.form.share-form',
    interactive ? h('p.muted', 'An interactive clip reacts to clicks, taps and keys, so it is played in the browser. There is no MP4 to render.') : null,
    h('h3', 'The live page'),
    h('p', 'Share it as a page: ', h('a', { href, target: '_blank', rel: 'noopener', 'data-testid': interactive ? 'interactive-share-link' : 'share-link' }, address)),
    h('div.row.share-row', link, copyBtn, h('a.btn.small', { href, target: '_blank', rel: 'noopener', 'data-testid': 'share-open' }, 'Open')),
    copied,
    dirty ? h('p.notice.info', { 'data-testid': 'share-unsaved' }, 'This clip has unsaved changes. The page plays the saved clip, so save first.') : null,
    h('p.hint', 'The page shows the clip as it is saved when it is opened. Only people signed in to this studio can open it; to send it to anyone, publish it below.'),
    h('h3', 'Publish a link'),
    h('p.muted', `One folder (output/share/${slug}/) with the page, the player and only the media the clip shows. This studio serves it at ${publicAddress}, a link anyone can open without signing in; it also plays from any other static web host, under any path.`),
    h('div.field', h('label', { for: 'share-base' }, 'Base URL (optional)'), baseUrl,
      h('p.hint', 'Only if you will publish the folder somewhere else: the link-preview picture and address use it, so chat apps can show a card. Default: the link above.')),
    h('div.row', exportBtn),
    last,
    result);

  const d = openDialog({ title: interactive ? 'Played, not rendered' : 'Share this clip', body, testid });

  const showLast = (exported) => {
    if (!exported) return void (last.textContent = 'Not published yet.');
    fill(last, `Last published ${fmtDate(exported.at)} · ${fmtBytes(exported.bytes)} at `, h('a', { href: publicHref, target: '_blank', rel: 'noopener', 'data-testid': 'share-public-link' }, publicAddress));
  };
  api.get(`/api/clips/${slug}/share`).then((info) => showLast(info.exported)).catch(() => { last.textContent = ''; });

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Publishing';
    fill(result, h('p.muted', { role: 'status' }, 'Writing the folder: footage frames and sound take a while.'));
    try {
      const r = await api.post(`/api/clips/${slug}/share`, { baseUrl: baseUrl.value.trim() || publicAddress });
      if (!d.el.isConnected) return;
      fill(result, h('div.notice.ok', { role: 'status', 'data-testid': 'share-exported' },
        h('p', `Wrote ${plural(r.files, 'file')}, ${fmtBytes(r.bytes)}, in ${r.seconds} s. Anyone can open it at:`),
        h('div.row.share-row', h('input.mono.share-url', { type: 'text', readOnly: true, value: publicAddress, 'aria-label': 'Public address of the share page', 'data-testid': 'share-public-url' }),
          h('a.btn.small', { href: publicHref, target: '_blank', rel: 'noopener', 'data-testid': 'share-public-open' }, 'Open')),
        h('p.hint.mono', r.dir),
        r.url && r.url !== publicAddress ? h('p', 'Link previews point at ', h('span.mono', r.url)) : null,
        (r.warnings ?? []).map((w) => h('p.hint', { 'data-testid': 'share-warning' }, w))));
      showLast({ dir: r.dir, bytes: r.bytes, at: new Date().toISOString() });
    } catch (e) {
      if (d.el.isConnected) fill(result, h('p.notice.error', { role: 'alert', 'data-testid': 'share-error' }, e.message));
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Publish';
    }
  });
  return d;
}
