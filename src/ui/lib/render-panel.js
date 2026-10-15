// The editor's Render panel: which shapes (one or several = one request), a normal render, a draft (a fast, smaller one
// to review the cut) or a final one (the sources are checked first and the credits are written), how many workers, and
// the poster time. The server's answer is shown as it comes: a final render that is refused lists each asset that is not
// ready, with a link to its page. POST /api/clips/<slug>/render { format | formats, draft, final, workers, posterAt }.

import { api } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { assetHref, fill, h, nextId, notice, plural, trim } from '/ui/lib/util.js';

const SHAPES = ['horizontal', 'vertical', 'square'];
const MODES = [
  ['normal', 'Normal', 'Full size, with the clip\'s own settings. Sources are not checked.'],
  ['draft', 'Draft', 'Two thirds of the size and fast: a quick look at the cut. Labelled a draft; the frames are the final\'s, just smaller.'],
  ['final', 'Final', 'Full size for publishing. The sources are checked first: a placeholder or a file with no licence stops it, and the credits are written next to the video.'],
];

/** The size a draft of a w×h shape gets: the largest of 2/3, 1/2 and 1/3 that gives whole, even pixels (as the studio picks it). */
export function draftSizeOf(w, hgt) {
  const whole = (v) => Math.abs(v - Math.round(v)) < 0.01 && Math.round(v) >= 2 && Math.round(v) % 2 === 0;
  for (const k of [2 / 3, 1 / 2, 1 / 3]) if (whole(w * k) && whole(hgt * k)) return { width: Math.round(w * k), height: Math.round(hgt * k) };
  return null;
}

/** A message with the asset refs in it as links (they close the panel and open the asset's page). */
function linked(text, close) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/\b([a-z0-9][a-z0-9-]*@\d+)\b/g)) {
    parts.push(text.slice(last, m.index));
    parts.push(h('a', { href: assetHref(m[1]), onclick: () => close() }, m[1]));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/**
 * @param {{ slug: string, clip: any, status: any, getTime: () => number, duration: number, onQueued: (r: any) => void }} o
 */
export function openRenderPanel({ slug, clip, status, getTime, duration, onQueued }) {
  const id = nextId('render');
  const formats = status.formats ?? {};
  const shapes = SHAPES.filter((s) => formats[s]);
  const chosen = new Set([shapes.includes(clip.format) ? clip.format : shapes[0]]);
  let mode = 'normal';

  const shapeBtns = shapes.map((s) => h('button.chip', { type: 'button', 'data-testid': 'render-shape', 'data-shape': s, 'aria-pressed': 'false', onclick: () => { if (chosen.has(s)) chosen.delete(s); else chosen.add(s); draw(); } },
    s, h('span.n', `${formats[s].width}×${formats[s].height}`)));
  const modeBtns = MODES.map(([m, label]) => h('button.btn.seg', { type: 'button', 'data-testid': 'render-mode', 'data-mode': m, 'aria-pressed': 'false', onclick: () => { mode = m; draw(); } }, label));
  const modeNote = h('p.hint', { 'data-testid': 'render-mode-note' });
  const shapeNote = h('p.hint', { 'data-testid': 'render-shape-note' });
  const workers = h('input.num', { type: 'number', id: `${id}-workers`, min: 1, max: 16, step: 1, placeholder: 'auto', 'data-testid': 'render-workers', inputMode: 'numeric' });
  const t = getTime();
  const poster = h('input.num', { type: 'number', id: `${id}-poster`, min: 0, max: duration, step: 0.1, placeholder: 'auto', value: t > 0.04 ? String(trim(t, 2)) : '', 'data-testid': 'render-poster', inputMode: 'decimal' });
  const err = notice('render-error');
  const go = h('button.btn.primary', { type: 'submit', 'data-testid': 'render-start' }, 'Render');
  const cancel = h('button.btn', { type: 'button', 'data-testid': 'render-cancel' }, 'Cancel');

  function draw() {
    for (const b of shapeBtns) { const on = chosen.has(b.dataset.shape); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of modeBtns) { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    modeNote.textContent = MODES.find(([m]) => m === mode)[2];
    const picked = shapes.filter((s) => chosen.has(s));
    if (mode === 'draft') {
      shapeNote.textContent = picked.length ? `Sizes: ${picked.map((s) => { const d = draftSizeOf(formats[s].width, formats[s].height); return `${s} ${d ? `${d.width}×${d.height}` : 'cannot be a draft'}`; }).join(', ')}` : '';
    } else shapeNote.textContent = picked.length ? picked.map((s) => `${s} ${formats[s].width}×${formats[s].height}`).join(', ') : 'Pick at least one shape.';
    go.disabled = !picked.length;
    const n = picked.length;
    go.textContent = mode === 'normal' ? `Render${n > 1 ? ` ${plural(n, 'shape')}` : ''}` : `Render ${n > 1 ? `${n} ${mode}s` : mode}`;
  }

  const form = h('form.form.render-form', { novalidate: true, 'data-testid': 'render-form' },
    h('div.field', h('span.field-label', { id: `${id}-shapes` }, 'Shapes'), h('div.chips', { role: 'group', 'aria-labelledby': `${id}-shapes` }, shapeBtns), shapeNote,
      h('p.hint', 'Several shapes are one request: each is drawn from the same saved clip.')),
    h('div.field', h('span.field-label', { id: `${id}-mode` }, 'Quality'), h('div.seg-group', { role: 'group', 'aria-labelledby': `${id}-mode` }, modeBtns), modeNote),
    h('div.field-grid',
      h('div.field', h('label', { for: `${id}-workers` }, 'Workers', h('span.type', 'optional')), workers, h('p.hint', '1 to 16; empty uses the studio\'s count.')),
      h('div.field', h('label', { for: `${id}-poster` }, 'Poster time', h('span.type', 'seconds')), poster, h('p.hint', 'The playhead; empty lets the studio pick a frame.'))),
    err.el,
    h('div.dialog-foot.inline', cancel, go));
  const d = openDialog({ title: 'Render this clip', body: form, testid: 'render-dialog' });
  cancel.addEventListener('click', () => d.close());
  draw();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hide();
    const picked = shapes.filter((s) => chosen.has(s));
    if (!picked.length) return;
    const body = picked.length > 1 ? { formats: picked } : { format: picked[0] };
    if (mode === 'draft') body.draft = true;
    if (mode === 'final') body.final = true;
    if (workers.value.trim()) {
      const n = Number(workers.value);
      if (!Number.isInteger(n) || n < 1 || n > 16) { err.show('Workers is a whole number from 1 to 16, or empty.'); workers.focus(); return; }
      body.workers = n;
    }
    if (poster.value.trim()) {
      const p = Number(poster.value);
      if (!Number.isFinite(p) || p < 0 || p > duration) { err.show(`The poster time is a number of seconds from 0 to ${trim(duration, 2)}, or empty.`); poster.focus(); return; }
      body.posterAt = p;
    }
    go.disabled = true;
    try {
      const r = await api.post(`/api/clips/${slug}/render`, body);
      d.close(r);
      onQueued(r);
    } catch (e2) {
      fill(err.el, linked(e2.message, () => d.close()));
      err.el.className = 'notice error';
      err.el.setAttribute('role', 'alert');
      err.el.hidden = false;
      go.disabled = false;
    }
  });
  return d;
}
