// Uploads: a drop zone over a page plus an upload button. Each file is one raw POST (the body is the
// file, nothing is encoded). Images go to /api/uploads; video files to /api/footage, streamed from disk
// with a progress bar; font files to /api/fonts after a small form asks for the licence (the family, weight
// and style the file says are shown first). A status row per file says how it went (uploading, reading,
// done, duplicate, error) with the server's own message, which says what to do. The Licence button sets the
// licence and source of the images and video that follow; a file added without one is recorded as unknown
// and its row says a final render will refuse it.

import { openDialog } from '/ui/lib/dialog.js';
import { getStatus } from '/ui/lib/api.js';
import { readFontInfo, weightName } from '/ui/lib/font-info.js';
import { UNKNOWN_NOTE, isUnknownLicense, provenanceFields, provenanceQuery, provenanceSummary } from '/ui/lib/provenance.js';
import { fill, fmtBytes, h, icon, nextId, notice, plural } from '/ui/lib/util.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
const FONT_EXT = ['ttf', 'otf', 'woff2'];
export const ACCEPT = [...IMAGE_TYPES, ...VIDEO_EXT.map((e) => `.${e}`), ...FONT_EXT.map((e) => `.${e}`)].join(',');
const MAX_IMAGE = 25_000_000;   // the server's limits (src/studio/uploads.js, fonts.js, server/routes/footage.js)
const MAX_FONT = 25_000_000;
const MAX_VIDEO = 2 * 1024 * 1024 * 1024;
const BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2' };
const LICENSES = ['OFL-1.1', 'Apache-2.0'];

const extOf = (name) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
/** 'image', 'video', 'font' or null. */
export function kindOfFile(file) {
  const ext = extOf(file.name);
  if (IMAGE_TYPES.includes(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext) || file.type.startsWith('video/')) return 'video';
  if (FONT_EXT.includes(ext) || file.type.startsWith('font/')) return 'font';
  return null;
}

async function readAnswer(status, text) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (status < 200 || status >= 300) throw new Error(data?.error ?? `The upload failed (${status})`);
  return data;
}

/** One image → { asset, duplicate, removed }; throws with the server's message. */
async function sendImage(file, type, prov) {
  let res;
  try {
    res = await fetch(`/api/uploads?${new URLSearchParams({ name: file.name, ...Object.fromEntries(provenanceQuery(prov)) })}`, { method: 'POST', headers: { 'content-type': type }, body: file });
  } catch {
    throw new Error('The studio server is not reachable');
  }
  return readAnswer(res.status, await res.text());
}

/** One video file, streamed as the request body, with the bytes sent so far reported (fetch cannot report them). → { asset } */
function sendVideo(file, onProgress, prov) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/footage?${new URLSearchParams({ name: file.name, ...Object.fromEntries(provenanceQuery(prov)) })}`);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); });
    xhr.upload.addEventListener('load', () => onProgress(file.size, file.size));
    xhr.addEventListener('load', () => readAnswer(xhr.status, xhr.responseText).then(resolve, reject));
    xhr.addEventListener('error', () => reject(new Error('The studio server is not reachable')));
    xhr.addEventListener('abort', () => reject(new Error('The upload was cancelled')));
    xhr.send(file);
  });
}

/** One font file with its licence → { asset, coverage }; throws with the server's message. */
async function sendFont(file, { name, provenance }) {
  const q = new URLSearchParams({ name, file: file.name, ...Object.fromEntries(provenanceQuery(provenance)) });
  let res;
  try {
    res = await fetch(`/api/fonts?${q}`, { method: 'POST', headers: { 'content-type': BY_EXT[extOf(file.name)] ?? 'application/octet-stream' }, body: file });
  } catch {
    throw new Error('The studio server is not reachable');
  }
  return readAnswer(res.status, await res.text());
}

const slugOf = (name) => name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * The form a font file needs before it is saved: what the file says about itself, a name for the library and the licence
 * (two quick picks and free text). The upload runs from the dialog, so what the server says is shown in the form and the
 * person can fix it and try again. → the server's answer, or null when the form was closed.
 * @param {File} file @param {any} info what readFontInfo found
 */
function fontDialog(file, info) {
  const id = nextId('font');
  const name = h('input.mono', { type: 'text', id: `${id}-name`, value: slugOf(file.name), 'data-testid': 'font-name', autocomplete: 'off', spellcheck: false, autocapitalize: 'off', maxLength: 64 });
  const prov = provenanceFields({ picks: LICENSES, required: true, compact: true, testids: { license: 'font-license', pick: 'font-license-pick' } });
  const license = prov.license;
  const err = notice('font-error');
  const add = h('button.btn.primary', { type: 'submit', 'data-testid': 'font-add' }, 'Add font');
  const cancel = h('button.btn', { type: 'button', 'data-testid': 'font-cancel' }, 'Cancel');
  const read = info?.readable
    ? [['Family', info.family ?? 'not in the file'], ['Weight', `${info.weight} ${weightName(info.weight)}`], ['Style', info.style], ['Format', info.format.toUpperCase()], info.glyphs ? ['Glyphs', String(info.glyphs)] : null]
    : [['Format', (info?.format ?? 'unknown').toUpperCase()], ['Family, weight, style', info?.format === 'woff2' ? 'read by the studio when the font is saved' : 'not readable here']];
  const facts = h('dl.facts', { 'data-testid': 'font-facts' }, read.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v)]));
  const form = h('form.form.font-form', { novalidate: true, 'data-testid': 'font-form' },
    h('p.muted', h('b', file.name), ` · ${fmtBytes(file.size)}`),
    h('div.field', h('span.field-label', 'What the file says'), facts),
    h('div.field', h('label', { for: `${id}-name` }, 'Name in the library'), name, h('p.hint', 'Lowercase letters, digits and dashes. Uploading the same name again makes a new version.')),
    prov.nodes[0],
    info?.license ? h('p.hint', { 'data-testid': 'font-embedded-license' }, `The file says: ${info.license.slice(0, 160)}`) : h('p.hint', 'A font needs a licence: what it is licensed under. It is kept with the font.'),
    prov.nodes.slice(1),
    err.el,
    h('div.dialog-foot.inline', cancel, add));
  const d = openDialog({ title: 'Add a font', body: form, testid: 'font-dialog' });
  cancel.addEventListener('click', () => d.close(null));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hide();
    if (!name.value.trim()) { err.show('Give the font a name in the library.'); name.focus(); return; }
    if (!license.value.trim()) { err.show('A licence is required: say what the font is licensed under (OFL-1.1, Apache-2.0, or your own words).'); license.focus(); return; }
    add.disabled = true; add.textContent = 'Adding';
    try {
      d.close(await sendFont(file, { name: name.value.trim(), provenance: prov.values() }));
    } catch (e2) {
      err.show(e2.message);
      add.disabled = false; add.textContent = 'Add font';
    }
  });
  license.focus();
  return d.closed;
}

/**
 * uploader({ target, onUploaded, onOpen }) → { button, input, status, dropZone, destroy }
 * target: the element that accepts drops; onUploaded(asset) after each new file; onOpen(slug) when a row is clicked.
 * @param {{ target: HTMLElement, onUploaded?: (asset: any, duplicate: boolean) => void, onOpen?: (slug: string) => void }} o
 */
export function uploader({ target, onUploaded, onOpen }) {
  const input = h('input.visually-hidden', { type: 'file', multiple: true, accept: ACCEPT, 'data-testid': 'upload-input', tabindex: -1, 'aria-hidden': 'true' });
  const button = h('button.btn', { type: 'button', 'data-testid': 'upload-button', onclick: () => input.click() }, icon('plus', 16), 'Upload');
  // what the next images and video are recorded with (null: nothing said, so unknown)
  let prov = null;
  const licenseButton = h('button.btn', { type: 'button', 'data-testid': 'upload-license', onclick: () => licenseDialog() });
  const drawLicense = () => {
    const said = provenanceSummary(prov);
    licenseButton.classList.toggle('on', !!said);
    licenseButton.title = said ? `Images and video are added as: ${said}` : 'Say what licence the next images and video are under';
    fill(licenseButton, said ? `Licence: ${said}` : 'Licence');
  };
  /** The licence and source of the next uploads. */
  function licenseDialog() {
    const form = provenanceFields({ value: prov ?? {}, compact: true, hint: 'Applies to the images and video you add next, until you change it here. Fonts ask for theirs.' });
    const save = h('button.btn.primary', { type: 'submit', 'data-testid': 'upload-license-save' }, 'Use for the next uploads');
    const clearBtn = h('button.btn', { type: 'button', 'data-testid': 'upload-license-clear' }, 'Clear');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const f = h('form.form.prov-form', { novalidate: true, 'data-testid': 'upload-license-form' },
      h('p.notice.info', { 'data-testid': 'upload-license-note' }, `Without a licence, an image or a video is added with an unknown licence. ${UNKNOWN_NOTE}`),
      form.nodes,
      h('div.dialog-foot.inline', cancel, clearBtn, save));
    const d = openDialog({ title: 'Licence and source of uploads', body: f, testid: 'upload-license-dialog' });
    cancel.addEventListener('click', () => d.close());
    clearBtn.addEventListener('click', () => { prov = null; drawLicense(); d.close(); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = form.values();
      prov = Object.values(v).some((x) => x === true || (typeof x === 'string' && x)) ? v : null;
      drawLicense();
      d.close();
    });
    form.focus();
  }
  drawLicense();
  /** How a row ends about the licence the file went in under. */
  const licenseNote = () => (isUnknownLicense(prov?.license) ? 'Licence unknown: a final render will refuse it' : `Licence: ${prov.license}`);
  const rows = h('ul.upload-rows');
  const summary = h('span.upload-sum');
  const dismiss = h('button.icon-btn.small', { type: 'button', 'aria-label': 'Close the upload list', 'data-testid': 'upload-dismiss', onclick: () => { status.hidden = true; fill(rows); } }, icon('close', 16));
  const status = h('section.upload-status', { 'data-testid': 'upload-status', 'aria-label': 'Uploads', hidden: true },
    h('header.upload-head', summary, dismiss), rows);
  const dropZone = h('div.drop-zone', { 'data-testid': 'drop-zone', hidden: true, 'aria-hidden': 'true' },
    h('div.drop-zone-inner', icon('download', 32), h('b', 'Drop images, video or fonts to add them to the library'), h('span', 'Images: PNG, JPEG, WebP or SVG up to 25 MB · video: MP4, MOV, WebM or MKV · fonts: TTF, OTF or WOFF2 (asks for the licence). Images and video go in with the licence set under Licence, or with an unknown one.')));

  let pending = 0, done = 0, failed = 0;
  const count = () => { summary.textContent = pending ? `Uploading ${done + 1} of ${done + pending}` : `${plural(done - failed, 'file')} uploaded${failed ? `, ${failed} failed` : ''}`; };

  function row(file) {
    const state = h('span.upload-state', 'Waiting');
    const note = h('span.upload-note');
    const bar = h('i');
    const progress = h('span.upload-progress', { role: 'progressbar', 'aria-label': `Uploading ${file.name}`, 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true, 'data-testid': 'upload-progress' }, bar);
    const el = h('li.upload-row', { 'data-testid': 'upload-row', 'data-name': file.name, 'data-state': 'queued', 'data-kind': kindOfFile(file) ?? 'other' },
      h('span.upload-name', file.name), state, progress, note);
    rows.prepend(el);
    return {
      set(s, text, extra) {
        el.dataset.state = s;
        state.textContent = text;
        progress.hidden = s !== 'uploading' && s !== 'reading';
        fill(note, extra ?? null);
      },
      /** Bytes sent: the bar fills, then the studio reads the file (it is on disk, but not yet in the library). */
      progress(sent, total) {
        const pct = total ? Math.round((sent / total) * 100) : 0;
        progress.hidden = false;
        bar.style.width = `${pct}%`;
        progress.setAttribute('aria-valuenow', String(pct));
        el.dataset.progress = String(pct);
        state.textContent = sent >= total ? 'Reading the video' : `Uploading ${pct}%`;
        if (sent >= total) el.dataset.state = 'reading';
      },
      link(slug) {
        if (!onOpen) return;
        const open = h('button.btn.small', { type: 'button', 'data-testid': 'upload-open', onclick: () => onOpen(slug) }, 'Show');
        el.append(open);
      },
    };
  }

  async function one(file, r) {
    const kind = kindOfFile(file);
    r.set('uploading', 'Uploading');
    if (kind === 'image') {
      if (file.size > MAX_IMAGE) throw new Error('Larger than 25 MB');
      const type = IMAGE_TYPES.includes(file.type) ? file.type : BY_EXT[extOf(file.name)];
      const res = await sendImage(file, type, prov);
      const removed = res.removed ?? [];
      if (res.duplicate) r.set('duplicate', 'Already in the library', `as ${res.asset.slug}`);
      else r.set('done', 'Added', [removed.length ? `Removed from the SVG: ${removed.join(', ')}` : 'Needs a description', licenseNote()].join(' · '));
      r.link(res.asset.slug);
      onUploaded?.(res.asset, !!res.duplicate);
    } else if (kind === 'video') {
      if (file.size > MAX_VIDEO) throw new Error('Larger than 2 GB');
      r.progress(0, file.size);
      const res = await sendVideo(file, (sent, total) => r.progress(sent, total), prov);
      const m = res.asset.meta ?? {};
      const facts = [m.width ? `${m.width}×${m.height}` : null, m.fps ? `${Math.round(m.fps * 100) / 100} fps` : null, res.asset.duration ? `${Math.round(res.asset.duration * 100) / 100} s` : null, m.audio ? 'with sound' : 'no sound'].filter(Boolean).join(' · ');
      r.set('done', res.asset.version > 1 ? `Added as version ${res.asset.version}` : 'Added', `${res.asset.slug}${facts ? ` · ${facts}` : ''} · ${licenseNote()}`);
      r.link(res.asset.slug);
      onUploaded?.(res.asset, false);
    } else if (kind === 'font') {
      if (file.size > MAX_FONT) throw new Error('Larger than 25 MB');
      r.set('waiting', 'Waiting for the licence');
      const info = await readFontInfo(file).catch(() => null);
      if (!info) throw new Error('Not a TTF, OTF or WOFF2 font file');
      const res = await fontDialog(file, info);
      if (!res) throw new Error('Cancelled: no licence was given');
      const a = res.asset, m = a.meta ?? {};
      const covers = res.coverage ? `${res.coverage.latinExtendedA ? 'with' : 'without all of'} Latin Extended-A` : null;
      r.set('done', a.version > 1 ? `Added as version ${a.version}` : 'Added', [`${m.family ?? a.title} ${m.weight ?? ''} ${m.style ?? ''}`.replace(/\s+/g, ' ').trim(), m.license, covers].filter(Boolean).join(' · '));
      r.link(a.slug);
      // the font menus of the editor and the playground list it from now on
      getStatus({ fresh: true }).catch(() => {});
      onUploaded?.(a, false);
    } else {
      throw new Error('Not an image, a video or a font file');
    }
  }

  async function upload(files) {
    if (!files.length) return;
    status.hidden = false;
    const jobs = [...files].map((file) => ({ file, r: row(file) }));
    pending += jobs.length;
    count();
    // one at a time: the server rasterises, decodes and measures each file
    for (const { file, r } of jobs) {
      try {
        await one(file, r);
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
    button, licenseButton, input, status, dropZone, upload,
    destroy() {
      target.removeEventListener('dragenter', onEnter);
      target.removeEventListener('dragover', onOver);
      target.removeEventListener('dragleave', onLeave);
      target.removeEventListener('drop', onDrop);
    },
  };
}
