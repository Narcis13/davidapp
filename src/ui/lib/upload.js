// Uploads: a drop zone over a page plus an upload button. Each file is one raw POST (the body is the
// file, Content-Type its image type), so nothing is encoded; a status row per file says how it went
// (uploading, done, duplicate, error) and, for an SVG, what the sanitiser removed.

import { fill, h, icon, plural } from '/ui/lib/util.js';

export const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const TYPES = ACCEPT.split(',');
const MAX = 25_000_000;   // the server's limit (src/studio/uploads.js)
const BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

/** One file → { asset, duplicate, removed }; throws with the server's message. */
async function send(file, type) {
  let res;
  try {
    res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': type }, body: file });
  } catch {
    throw new Error('The studio server is not reachable');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(data?.error ?? `The upload failed (${res.status})`);
  return data;
}

/**
 * uploader({ target, onUploaded, onOpen }) → { button, input, status, dropZone, destroy }
 * target: the element that accepts drops; onUploaded(asset) after each new file; onOpen(slug) when a row is clicked.
 * @param {{ target: HTMLElement, onUploaded?: (asset: any, duplicate: boolean) => void, onOpen?: (slug: string) => void }} o
 */
export function uploader({ target, onUploaded, onOpen }) {
  const input = h('input.visually-hidden', { type: 'file', multiple: true, accept: ACCEPT, 'data-testid': 'upload-input', tabindex: -1, 'aria-hidden': 'true' });
  const button = h('button.btn', { type: 'button', 'data-testid': 'upload-button', onclick: () => input.click() }, icon('plus', 16), 'Upload');
  const rows = h('ul.upload-rows');
  const summary = h('span.upload-sum');
  const dismiss = h('button.icon-btn.small', { type: 'button', 'aria-label': 'Close the upload list', 'data-testid': 'upload-dismiss', onclick: () => { status.hidden = true; fill(rows); } }, icon('close', 16));
  const status = h('section.upload-status', { 'data-testid': 'upload-status', 'aria-label': 'Uploads', hidden: true },
    h('header.upload-head', summary, dismiss), rows);
  const dropZone = h('div.drop-zone', { 'data-testid': 'drop-zone', hidden: true, 'aria-hidden': 'true' },
    h('div.drop-zone-inner', icon('download', 32), h('b', 'Drop images to add them to the library'), h('span', 'PNG, JPEG, WebP or SVG, up to 25 MB each')));

  let pending = 0, done = 0, failed = 0;
  const count = () => { summary.textContent = pending ? `Uploading ${done + 1} of ${done + pending}` : `${plural(done - failed, 'file')} uploaded${failed ? `, ${failed} failed` : ''}`; };

  function row(file) {
    const state = h('span.upload-state', 'Waiting');
    const note = h('span.upload-note');
    const el = h('li.upload-row', { 'data-testid': 'upload-row', 'data-name': file.name, 'data-state': 'queued' },
      h('span.upload-name', file.name), state, note);
    rows.prepend(el);
    return {
      set(s, text, extra) {
        el.dataset.state = s;
        state.textContent = text;
        fill(note, extra ?? null);
      },
      link(slug) {
        if (!onOpen) return;
        const open = h('button.btn.small', { type: 'button', 'data-testid': 'upload-open', onclick: () => onOpen(slug) }, 'Show');
        el.append(open);
      },
    };
  }

  async function upload(files) {
    if (!files.length) return;
    status.hidden = false;
    const jobs = [...files].map((file) => ({ file, r: row(file) }));
    pending += jobs.length;
    count();
    // one at a time: the server rasterises and makes a palette per file
    for (const { file, r } of jobs) {
      const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
      const type = TYPES.includes(file.type) ? file.type : BY_EXT[ext] ?? '';
      r.set('uploading', 'Uploading');
      try {
        if (!type) throw new Error('Not a PNG, JPEG, WebP or SVG image');
        if (file.size > MAX) throw new Error('Larger than 25 MB');
        const res = await send(file, type);
        const removed = res.removed ?? [];
        if (res.duplicate) r.set('duplicate', 'Already in the library', `as ${res.asset.slug}`);
        else r.set('done', 'Added', removed.length ? `Removed from the SVG: ${removed.join(', ')}` : 'Needs a description');
        r.link(res.asset.slug);
        onUploaded?.(res.asset, !!res.duplicate);
      } catch (e) {
        r.set('error', 'Failed', e.message);
        failed++;
      }
      pending--; done++;
      count();
    }
  }

  input.addEventListener('change', () => { upload([...input.files]); input.value = ''; });

  // drag over the page → the drop zone; a counter, because dragenter/leave fire per child
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; dropZone.hidden = false; };
  const onOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const onLeave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) dropZone.hidden = true; };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dropZone.hidden = true;
    upload([...e.dataTransfer.files]);
  };
  target.addEventListener('dragenter', onEnter);
  target.addEventListener('dragover', onOver);
  target.addEventListener('dragleave', onLeave);
  target.addEventListener('drop', onDrop);

  return {
    button, input, status, dropZone, upload,
    destroy() {
      target.removeEventListener('dragenter', onEnter);
      target.removeEventListener('dragover', onOver);
      target.removeEventListener('dragleave', onLeave);
      target.removeEventListener('drop', onDrop);
    },
  };
}
