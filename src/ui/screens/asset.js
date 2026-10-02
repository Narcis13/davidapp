// Asset playground: live preview with generated controls, versions, source (view, validate,
// save as a new version), the renderer's exact frame for comparison, and the asset's lineage.

import { api, getStatus, qs } from '/ui/lib/api.js';
import { clearAssetOptions, createParamControls, referencedAssets } from '/ui/lib/params.js';
import { createStage } from '/ui/lib/stage.js';
import { assetHref, assetIcon, clamp, errorBlock, fill, fmtDate, fmtDuration, fmtTime, h, icon, notice, plural } from '/ui/lib/util.js';

const PREVIEW_FPS = 30;

const clipLink = (slug) => h('a.chip.link', { href: `/clips/${slug}` }, icon('film', 14), slug);
const refLink = (ref) => h('a.chip.link.mono', { href: assetHref(ref) }, ref);

function detailsPanel(a) {
  const row = (label, ...content) => (content.some((c) => c !== null && c !== undefined && c !== false && !(Array.isArray(c) && !c.length)) ? [h('dt', label), h('dd', content)] : null);
  const deps = [...new Set(Object.values(a.deps ?? {}))];
  return h('section.panel', { 'data-testid': 'details' },
    h('h2', 'Details'),
    h('p.desc', a.description ?? ''),
    h('dl.facts',
      row('Tags', a.tags?.length ? h('div.chips', a.tags.map((t) => h('a.chip.link', { href: `/${qs({ tag: t })}` }, t))) : null),
      row('Type', a.type === 'function' ? `function · ${a.kind}` : a.type),
      a.type === 'function' ? row('Natural duration', fmtDuration(a.duration)) : null,
      row('Formats', a.formats?.length ? a.formats.join(', ') : null),
      row('Author', a.author ? `${a.author}${a.versionCreatedAt ? ` · ${fmtDate(a.versionCreatedAt)}` : ''}` : null),
      row('Uses', deps.length ? h('div.chips', { 'data-testid': 'deps' }, deps.map(refLink)) : null),
      row('Used inside', a.dependents?.length ? h('div.chips', { 'data-testid': 'dependents' }, a.dependents.map(refLink)) : null),
      row('Used by clips', a.usedBy?.length ? h('div.chips', { 'data-testid': 'used-by' }, a.usedBy.map((u) => h('a.chip.link', { href: `/clips/${u.clip}`, title: u.direct ? 'Placed on the timeline' : 'Used inside another asset' }, icon('film', 14), `${u.clip} · v${u.version}${u.direct ? '' : ' · nested'}`))) : null),
      row('Made for clip', a.madeForClip ? clipLink(a.madeForClip) : null),
      row('Origin clip', a.originClip ? clipLink(a.originClip) : null),
      row('Forked from', a.forkedFrom ? refLink(a.forkedFrom) : null),
      row('Forks', a.forks?.length ? h('div.chips', a.forks.map((slug) => h('a.chip.link.mono', { href: `/assets/${slug}` }, slug))) : null),
      row('License', a.meta?.license ?? null)),
    !a.usedBy?.length ? h('p.muted', 'No clip uses this asset yet.') : null);
}

function versionsPanel(a) {
  return h('section.panel', { 'data-testid': 'versions' },
    h('h2', 'Versions'),
    h('ol.versions', [...a.versions].reverse().map((v) => h('li',
      h(`a.version${v.version === a.version ? '.current' : ''}`, { href: `/assets/${a.slug}?v=${v.version}`, 'data-testid': 'version', 'data-version': v.version, 'aria-current': v.version === a.version ? 'true' : undefined },
        h('span.version-n', `v${v.version}`, v.version === a.latestVersion ? h('span.badge', 'latest') : null),
        h('span.version-note', v.note ?? (v.version === 1 ? 'First version' : 'No note')),
        h('span.version-meta', [v.author, fmtDate(v.createdAt), v.madeForClip ? `for ${v.madeForClip}` : null].filter(Boolean).join(' · ')))))));
}

function header(a) {
  const badge = a.type === 'function' ? a.kind : a.type;
  return h('div.page-head',
    h('div',
      h('a.back', { href: '/' }, icon('back', 16), 'Library'),
      h('div.title-row', h('h1', a.title), h('span.ref', { 'data-testid': 'asset-ref' }, a.ref), h(`span.badge.${badge}`, badge),
        a.version !== a.latestVersion ? h('a.badge.warn', { href: `/assets/${a.slug}` }, `latest is v${a.latestVersion}`) : null)));
}

/** Image, sound and font assets: show the file itself. */
async function mediaView(a, status) {
  if (a.type === 'image' && a.file) return h('div.media-view', h('img', { src: `/media/${a.file}`, alt: a.title, 'data-testid': 'asset-image' }));
  if (a.type === 'sound' && a.file) {
    return h('div.media-view',
      a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '' }) : h('span.thumb-icon', icon('sound', 48)),
      h('audio', { controls: true, src: `/media/${a.file}`, preload: 'metadata', 'data-testid': 'asset-audio' }));
  }
  if (a.type === 'font') {
    const fam = status.fonts.find((f) => f.slug === a.slug);
    const lines = [];
    for (const f of fam?.files ?? []) {
      const face = new FontFace(fam.family, `url(${f.url})`, { weight: String(f.weight), style: f.style });
      try { document.fonts.add(await face.load()); } catch { continue; }
      lines.push(h('div.specimen-line',
        h('span.muted', `${f.weight} ${f.style}`),
        h('p', { style: { fontFamily: `"${fam.family}", sans-serif`, fontWeight: String(f.weight), fontStyle: f.style } }, 'Every frame is a function 0123456789')));
    }
    return h('div.media-view.specimen', { 'data-testid': 'font-specimen' }, lines.length ? lines : a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: a.title }) : h('span.thumb-icon', icon('font', 48)));
  }
  return h('div.media-view', a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: a.title }) : h('span.thumb-icon', icon(assetIcon(a), 48)));
}

/** Source with line numbers; switches between a read-only view and an editor. */
function sourceView(text) {
  const count = (t) => t.split('\n').length;
  const numbers = (n) => Array.from({ length: n }, (_, i) => i + 1).join('\n');
  const gutter = h('pre.gutter', { 'aria-hidden': 'true' }, numbers(count(text)));
  const code = h('pre.code-text', { 'data-testid': 'source-view', tabIndex: 0 }, text);
  const editor = h('textarea.code-text', { 'data-testid': 'source-editor', spellcheck: false, wrap: 'off', hidden: true, 'aria-label': 'Asset source', autocapitalize: 'off', autocomplete: 'off' });
  const el = h('div.code', gutter, code, editor);
  editor.addEventListener('input', () => { gutter.textContent = numbers(count(editor.value)); });
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return {
    el, editor,
    edit(on) {
      el.classList.toggle('editing', on);
      code.hidden = on; editor.hidden = !on;
      if (on) { editor.value = text; editor.style.height = `${clamp(count(text) * 20 + 32, 240, 560)}px`; }
      gutter.textContent = numbers(count(on ? editor.value : text));
      gutter.scrollTop = 0;
    },
  };
}

async function playground(view, ctx, a, status) {
  const formats = (a.formats?.length ? a.formats : Object.keys(status.formats)).filter((f) => status.formats[f]);
  if (!formats.length) formats.push('horizontal');
  const fonts = status.fonts.map((f) => f.family);
  let format = formats.includes(ctx.query.get('format')) ? ctx.query.get('format') : formats[0];
  let duration = a.duration ?? 3;
  let values = {};
  // what the preview is showing: the saved version, or a validated draft of the source
  const saved = { ref: a.ref, bundle: null, schema: a.schema, draft: false };
  let current = saved;

  const stage = createStage();
  ctx.onCleanup(() => stage.destroy());
  const stageNote = notice('stage-note');
  const draftFlag = h('span.badge.warn', { hidden: true, 'data-testid': 'draft-flag' }, 'Previewing the draft source');

  const size = () => status.formats[format];
  async function show() {
    const f = size();
    stage.setSize(f.width, f.height);
    stage.setDuration(duration, PREVIEW_FPS);
    await stage.show((pv) => pv.showAsset({ ref: current.ref, bundle: current.bundle, params: values, duration, width: f.width, height: f.height, fps: PREVIEW_FPS }));
  }

  /** The bundle of the saved version plus whatever the parameter values point at. */
  async function fetchBundle(refs) {
    return (await api.get(`/api/assets/${a.slug}/bundle${qs({ version: a.version, with: refs.join(',') })}`)).bundle;
  }
  async function rebundle() {
    stageNote.hide();
    try {
      const b = await fetchBundle(referencedAssets(current.schema, values));
      if (!ctx.alive()) return;
      current.bundle = current.draft ? { ...b, assets: { ...b.assets, ...current.own.assets }, images: { ...b.images, ...current.own.images } } : b;
      await show();
    } catch (e) {
      stageNote.show(e.message);
    }
  }

  // parameters
  const controls = createParamControls({
    schema: a.schema, values, fonts,
    onChange(next, { structural }) {
      values = next;
      if (structural) rebundle(); else stage.pv.setParams(values);
    },
  });
  const resetBtn = h('button.btn.small', { type: 'button', 'data-testid': 'reset-params', onclick: () => { values = {}; controls.reset({}); rebundle(); } }, 'Reset');

  // tools under the stage
  const formatBtns = formats.map((name) => h(`button.btn.small.seg${name === format ? '.on' : ''}`, { type: 'button', 'data-testid': `format-${name}`, 'aria-pressed': String(name === format), title: status.formats[name].label }, name));
  formatBtns.forEach((btn, i) => btn.addEventListener('click', () => {
    format = formats[i];
    formatBtns.forEach((b, j) => { b.classList.toggle('on', i === j); b.setAttribute('aria-pressed', String(i === j)); });
    const f = size();
    stage.hideExact();
    stage.setSize(f.width, f.height);
    stage.pv.setView({ width: f.width, height: f.height });
  }));
  const durationInput = h('input.num', { type: 'number', min: 0.1, max: 60, step: 0.1, value: String(duration), 'data-testid': 'duration', id: 'pg-duration', inputMode: 'decimal' });
  durationInput.addEventListener('change', () => {
    const v = Number(durationInput.value);
    duration = Number.isFinite(v) && durationInput.value.trim() !== '' ? clamp(Math.round(v * 100) / 100, 0.1, 60) : a.duration ?? 3;
    durationInput.value = String(duration);
    stage.pv.setView({ duration });
    stage.setDuration(duration, PREVIEW_FPS);
  });

  const exactBtn = h('button.btn.small', { type: 'button', 'data-testid': 'exact-frame', title: 'Draw this frame with the renderer that makes the MP4' }, 'Exact frame');
  exactBtn.addEventListener('click', async () => {
    stageNote.hide();
    exactBtn.disabled = true;
    const t = Math.min(stage.pv.time, Math.max(0, duration - 1 / PREVIEW_FPS));
    try {
      // a validated draft is drawn by the renderer from its source, a saved version by its ref
      const what = current.draft ? { source: current.source, name: a.slug } : { ref: a.ref };
      const blob = await api.blob('/api/frame/asset', { ...what, params: values, t, duration, format });
      if (!ctx.alive()) return;
      stage.pv.pause();
      stage.showExact(blob, `Renderer · ${current.draft ? 'draft' : a.ref} at ${fmtTime(t)}`);
    } catch (e) {
      stageNote.show(e.message);
    } finally {
      exactBtn.disabled = false;
    }
  });

  let audioUrl = null;
  const audioSlot = h('div.audio-slot');
  ctx.onCleanup(() => { if (audioUrl) URL.revokeObjectURL(audioUrl); });
  const audioBtn = a.kind === 'audio' ? h('button.btn.small', { type: 'button', 'data-testid': 'play-audio' }, icon('sound', 16), 'Play audio') : null;
  audioBtn?.addEventListener('click', async () => {
    stageNote.hide();
    audioBtn.disabled = true;
    try {
      const blob = await api.blob('/api/audio/asset', { ref: a.ref, params: values, duration });
      if (!ctx.alive()) return;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob);
      const player = h('audio', { controls: true, src: audioUrl, 'data-testid': 'audio-player' });
      fill(audioSlot, player);
      player.play().catch(() => {});
    } catch (e) {
      stageNote.show(e.message);
    } finally {
      audioBtn.disabled = false;
    }
  });

  // source: view, edit, validate, save as a new version
  const src = sourceView(a.source ?? '');
  const srcError = notice('source-error');
  const srcOk = notice('source-ok');
  const editBtn = h('button.btn.small', { type: 'button', 'data-testid': 'edit-source' }, 'Edit source');
  const validateBtn = h('button.btn.small', { type: 'button', 'data-testid': 'validate' }, 'Validate');
  const saveBtn = h('button.btn.small.primary', { type: 'button', 'data-testid': 'save-version' }, 'Save as new version');
  const cancelBtn = h('button.btn.small', { type: 'button', 'data-testid': 'cancel-edit' }, 'Cancel');
  const noteInput = h('input', { type: 'text', placeholder: 'What changed (version note)', 'data-testid': 'version-note', 'aria-label': 'Version note', maxLength: 200 });
  const editTools = h('div.source-tools', { hidden: true }, noteInput, validateBtn, saveBtn, cancelBtn);
  let editing = false;
  const dirty = () => editing && src.editor.value !== (a.source ?? '');
  ctx.setGuard(() => (dirty() ? 'The source has edits that are not saved as a version. Leave anyway?' : null));

  function setEditing(on) {
    editing = on;
    src.edit(on);
    editTools.hidden = !on;
    editBtn.hidden = on;
    srcError.hide(); srcOk.hide();
  }
  async function useSaved() {
    current = saved;
    draftFlag.hidden = true;
    exactBtn.disabled = false;
    values = Object.fromEntries(Object.entries(values).filter(([k]) => k in a.schema));
    controls.reset(values, a.schema);
    await rebundle();
  }
  editBtn.addEventListener('click', () => setEditing(true));
  cancelBtn.addEventListener('click', async () => {
    setEditing(false);
    if (current.draft) await useSaved();
  });
  validateBtn.addEventListener('click', async () => {
    srcError.hide(); srcOk.hide();
    validateBtn.disabled = true;
    try {
      const r = await api.post('/api/assets/validate', { name: a.slug, source: src.editor.value });
      if (!ctx.alive()) return;
      // keep the values the new schema still declares
      values = Object.fromEntries(Object.entries(values).filter(([k]) => k in r.schema));
      current = { ref: r.ref, bundle: r.bundle, own: r.bundle, schema: r.schema, draft: true, source: src.editor.value };
      controls.reset(values, r.schema);
      draftFlag.hidden = false;
      stage.hideExact();
      const refs = referencedAssets(r.schema, values);
      if (refs.length) await rebundle(); else await show();
      srcOk.show(`The source is valid${r.warnings?.length ? `, with ${plural(r.warnings.length, 'warning')}:\n- ${r.warnings.join('\n- ')}` : '.'} The preview now shows this draft.`, 'ok');
    } catch (e) {
      srcError.show(e.message);
    } finally {
      validateBtn.disabled = false;
    }
  });
  saveBtn.addEventListener('click', async () => {
    srcError.hide(); srcOk.hide();
    saveBtn.disabled = true;
    try {
      const r = await api.post(`/api/assets/${a.slug}/versions`, { source: src.editor.value, note: noteInput.value.trim() || undefined });
      clearAssetOptions();
      if (ctx.alive()) await ctx.navigate(`/assets/${a.slug}?v=${r.asset.version}`, { force: true });
    } catch (e) {
      srcError.show(e.message);
      saveBtn.disabled = false;
    }
  });

  fill(view, 
    header(a),
    h('div.playground',
      h('div.pg-main',
        h('section.panel.stage-panel',
          stage.el,
          h('div.stage-tools',
            h('div.seg-group', { role: 'group', 'aria-label': 'Format' }, formatBtns),
            stage.safeBtn,
            h('label.inline-field', { for: 'pg-duration' }, 'Duration', durationInput, h('span.unit', 's')),
            exactBtn, audioBtn, draftFlag),
          stageNote.el,
          audioSlot),
        h('section.panel.source-panel',
          h('div.panel-head', h('h2', 'Source'), editBtn),
          editTools, srcError.el, srcOk.el, src.el)),
      h('aside.pg-side',
        h('section.panel', h('div.panel-head', h('h2', 'Parameters'), resetBtn), controls.el),
        versionsPanel(a),
        detailsPanel(a))));

  try {
    saved.bundle = await fetchBundle([]);
  } catch (e) {
    stageNote.show(e.message);
    return;
  }
  if (!ctx.alive()) return;
  await show();
  // open on a frame that shows the asset, not on its empty first one
  if (a.kind === 'visual') stage.pv.seek(Math.round(duration * 0.6 * PREVIEW_FPS) / PREVIEW_FPS);
}

export async function mount(view, ctx) {
  const slug = ctx.params[0];
  const version = ctx.query.get('v');
  let a, status;
  try {
    [a, status] = await Promise.all([api.get(`/api/assets/${slug}${version && /^\d+$/.test(version) ? `?version=${version}` : ''}`), getStatus()]);
  } catch (e) {
    fill(view, errorBlock(e.message, h('a.btn', { href: '/' }, 'Back to the library')));
    return;
  }
  if (!ctx.alive()) return;
  ctx.setTitle(a.title);
  if (a.type === 'function') return playground(view, ctx, a, status);
  const media = await mediaView(a, status);
  if (!ctx.alive()) return;
  fill(view, 
    header(a),
    h('div.playground',
      h('div.pg-main', h('section.panel', media)),
      h('aside.pg-side', versionsPanel(a), detailsPanel(a))));
}
