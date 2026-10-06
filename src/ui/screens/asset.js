// Asset playground: live preview with generated controls, tweak and keep (new defaults, presets,
// metadata edits), the source in a real editor (validate, save as a new version), version diffs,
// the renderer's exact frame, the asset's lineage, and the agent: ask for a change and compare its
// proposal with the current version side by side.

import { api, getStatus, qs } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { clearAssetOptions, createParamControls, referencedAssets } from '/ui/lib/params.js';
import { createStage } from '/ui/lib/stage.js';
import { createCodeEditor } from '/ui/lib/code-editor.js';
import { createDiffView, framePair } from '/ui/lib/diff-view.js';
import { assetHref, assetIcon, clamp, errorBlock, fill, fmtBytes, fmtDate, fmtDuration, fmtTime, h, icon, nextId, notice, plural } from '/ui/lib/util.js';

const PREVIEW_FPS = 30;
const PREVIEWED_KINDS = new Set(['visual', 'motion', 'transition', 'effect', 'value', 'audio']);
const DERIVATION = {
  preset: 'Preset',
  precomp: 'Precomp',
  fork: 'Fork',
  bake: 'Baked sequence',
};

/** A bundle with another bundle's assets on top (a draft's or a proposal's own code wins). */
const mergeBundles = (base, own) => ({ ...base, assets: { ...base.assets, ...own.assets }, images: { ...base.images, ...own.images }, sequences: { ...base.sequences, ...own.sequences } });

const clipLink = (slug) => h('a.chip.link', { href: `/clips/${slug}` }, icon('film', 14), slug);
const refLink = (ref) => h('a.chip.link.mono', { href: assetHref(ref) }, ref);
const hasContent = (c) => c !== null && c !== undefined && c !== false && !(Array.isArray(c) && !c.length);

/** How this asset came to be, in a sentence with links. */
function derivationNote(a) {
  const base = a.uses?.base ?? a.forkedFrom;
  switch (a.derivation) {
    case 'preset':
      return h('p.derivation', { 'data-testid': 'derivation', 'data-derivation': 'preset' }, 'A preset of ', base ? refLink(base) : 'another asset',
        ': the same render with other defaults. Changing the base does not change this preset; it stays pinned to that version.');
    case 'precomp':
      return h('p.derivation', { 'data-testid': 'derivation', 'data-derivation': 'precomp' }, 'A precomp: clip layers saved as one asset',
        a.originClip ? [' from ', clipLink(a.originClip)] : null, '. It draws ',
        Object.values(a.deps ?? {}).length ? Object.values(a.deps).map((r, i) => [i ? ', ' : '', refLink(r)]) : 'its layers', '.');
    case 'fork':
      return h('p.derivation', { 'data-testid': 'derivation', 'data-derivation': 'fork' }, 'Forked from ', base ? refLink(base) : 'another asset', '.');
    case 'bake':
      return h('p.derivation', { 'data-testid': 'derivation', 'data-derivation': 'bake' }, 'Baked from ', base ? refLink(base) : 'a visual asset',
        a.meta?.params && Object.keys(a.meta.params).length ? ` with ${Object.entries(a.meta.params).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}` : '', '.');
    default:
      return null;
  }
}

function detailsPanel(a) {
  const row = (label, ...content) => (content.some(hasContent) ? [h('dt', label), h('dd', content)] : null);
  const deps = [...new Set(Object.values(a.deps ?? {}))];
  return h('section.panel', { 'data-testid': 'details' },
    h('h2', 'Details'),
    derivationNote(a),
    h('dl.facts',
      row('Type', a.type === 'function' ? `function · ${a.kind}` : a.type),
      a.type === 'function' ? row('Natural duration', fmtDuration(a.duration)) : null,
      row('Formats', a.formats?.length ? a.formats.join(', ') : null),
      row('Author', a.author ? `${a.author}${a.versionCreatedAt ? ` · ${fmtDate(a.versionCreatedAt)}` : ''}` : null),
      row('Uses', deps.length ? h('div.chips', { 'data-testid': 'deps' }, deps.map(refLink)) : null),
      row('Used inside', a.dependents?.length ? h('div.chips', { 'data-testid': 'dependents' }, a.dependents.map(refLink)) : null),
      row('Used by clips', a.usedBy?.length ? h('div.chips', { 'data-testid': 'used-by' }, a.usedBy.map((u) => h('a.chip.link', { href: `/clips/${u.clip}`, title: u.direct ? 'Placed on the timeline' : 'Used inside another asset' }, icon('film', 14), `${u.clip} · v${u.version}${u.direct ? '' : ' · nested'}`))) : null),
      row('Made for clip', a.madeForClip ? clipLink(a.madeForClip) : null),
      row('Origin clip', a.originClip ? clipLink(a.originClip) : null),
      row(a.derivation === 'preset' ? 'Base' : a.derivation === 'bake' ? 'Baked from' : 'Forked from', a.forkedFrom ? h('span', { 'data-testid': 'forked-from' }, refLink(a.forkedFrom)) : null),
      row('Forks', a.forks?.length ? h('div.chips', a.forks.map((slug) => h('a.chip.link.mono', { href: `/assets/${slug}` }, slug))) : null),
      row('License', a.meta?.license ?? null)),
    !a.usedBy?.length ? h('p.muted', 'No clip uses this asset yet.') : null);
}

/** Title, description and tags: an overlay on the asset, not a new version. */
function metadataPanel(a, { onSaved }) {
  const el = h('section.panel.meta-panel', { 'data-testid': 'metadata' });
  const msg = notice('meta-error');
  const declared = a.declared ?? {};
  const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

  function readView() {
    const differs = a.edited ? [
      !same(a.title, declared.title ?? a.slug) ? ['Title', declared.title ?? a.slug] : null,
      !same(a.description, declared.description) ? ['Description', declared.description || 'none'] : null,
      !same(a.tags, declared.tags ?? []) ? ['Tags', declared.tags?.length ? declared.tags.join(', ') : 'none'] : null,
    ].filter(Boolean) : [];
    fill(el,
      h('div.panel-head', h('h2', 'About'),
        a.edited ? h('span.badge.warn', { 'data-testid': 'meta-edited', title: a.metadataEdit ? `Edited by ${a.metadataEdit.by} · ${fmtDate(a.metadataEdit.at)}` : undefined }, 'edited') : null,
        h('button.btn.small', { type: 'button', 'data-testid': 'meta-edit', onclick: () => editView() }, 'Edit')),
      h('p.desc', { 'data-testid': 'meta-description-text' }, a.description || h('span.muted', 'No description.')),
      a.tags?.length ? h('div.chips', { 'data-testid': 'meta-tags-list' }, a.tags.map((t) => h('a.chip.link', { href: `/${qs({ tag: t })}` }, t))) : null,
      differs.length ? h('div.declared', { 'data-testid': 'meta-declared' },
        h('h3', 'The source declares'),
        h('dl.facts', differs.map(([k, v]) => [h('dt', k), h('dd', v)]))) : null,
      msg.el);
  }

  function editView() {
    const ids = { t: nextId('m'), d: nextId('m'), g: nextId('m') };
    const title = h('input', { type: 'text', id: ids.t, value: a.title ?? '', maxLength: 120, 'data-testid': 'meta-title', autocomplete: 'off' });
    const description = h('textarea', { id: ids.d, rows: 3, value: a.description ?? '', maxLength: 1000, 'data-testid': 'meta-description' });
    const tags = h('input', { type: 'text', id: ids.g, value: (a.tags ?? []).join(', '), 'data-testid': 'meta-tags', autocomplete: 'off', spellcheck: false, placeholder: 'comma, separated' });
    const save = h('button.btn.small.primary', { type: 'submit', 'data-testid': 'meta-save' }, 'Save');
    const cancel = h('button.btn.small', { type: 'button', 'data-testid': 'meta-cancel', onclick: () => readView() }, 'Cancel');
    const reset = h('button.btn.small', { type: 'button', 'data-testid': 'meta-reset', disabled: !a.edited, title: 'Use what the source declares' }, 'Reset to source');
    const put = async (body, btn) => {
      msg.hide();
      btn.disabled = true;
      try {
        const next = await api.put(`/api/assets/${a.slug}/metadata`, body);
        onSaved(next);
      } catch (e) {
        msg.show(e.message);
        btn.disabled = false;
      }
    };
    const form = h('form.form.meta-form', {
      onsubmit: (e) => {
        e.preventDefault();
        const list = [...new Set(tags.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
        put({ title: title.value.trim() || null, description: description.value.trim() || null, tags: list }, save);
      },
    },
    h('div.field', h('label', { for: ids.t }, 'Title'), title, declared.title && declared.title !== a.title ? h('p.hint', `Source: ${declared.title}`) : null),
    h('div.field', h('label', { for: ids.d }, 'Description'), description),
    h('div.field', h('label', { for: ids.g }, 'Tags'), tags, h('p.hint', 'Saved on the asset for every version; no new version is made.')),
    h('div.row.meta-actions', save, cancel, reset));
    reset.addEventListener('click', () => put({ title: null, description: null, tags: null }, reset));
    fill(el, h('div.panel-head', h('h2', 'About'), a.edited ? h('span.badge.warn', 'edited') : null), form, msg.el);
    title.focus();
  }

  readView();
  return { el, update(next) { a = next; readView(); } };
}

function versionsPanel(a, diffBtn) {
  return h('section.panel', { 'data-testid': 'versions' },
    h('div.panel-head', h('h2', 'Versions'), diffBtn),
    h('ol.versions', [...a.versions].reverse().map((v) => h('li',
      h(`a.version${v.version === a.version ? '.current' : ''}`, { href: `/assets/${a.slug}?v=${v.version}`, 'data-testid': 'version', 'data-version': v.version, 'aria-current': v.version === a.version ? 'true' : undefined },
        h('span.version-n', `v${v.version}`, v.version === a.latestVersion ? h('span.badge', 'latest') : null),
        h('span.version-note', v.note ?? (v.version === 1 ? 'First version' : 'No note')),
        h('span.version-meta', [v.author, fmtDate(v.createdAt), v.madeForClip ? `for ${v.madeForClip}` : null].filter(Boolean).join(' · ')))))));
}

/** Favourite and featured: two toggles that write through at once. */
function toggles(a, initialFavorite) {
  const make = (testid, label, on, url) => {
    const btn = h('button.btn.small.toggle', { type: 'button', 'data-testid': testid, 'aria-pressed': String(on) }, label);
    btn.classList.toggle('on', on);
    const set = (v) => { on = v; btn.setAttribute('aria-pressed', String(v)); btn.classList.toggle('on', v); };
    btn.addEventListener('click', async () => {
      const next = !on;
      set(next);
      btn.disabled = true;
      try { await api.put(url, { on: next }); } catch { set(!next); } finally { btn.disabled = false; }
    });
    return { btn, set };
  };
  const fav = make('favorite', 'Favourite', !!initialFavorite, `/api/assets/${a.slug}/favorite`);
  const feat = make('featured', 'Featured', !!a.featured, `/api/assets/${a.slug}/featured`);
  return { el: h('div.pg-toggles', fav.btn, feat.btn), fav, feat };
}

function header(a, tg) {
  const badge = a.type === 'function' ? a.kind : a.type;
  return h('div.page-head',
    h('div',
      h('a.back', { href: '/' }, icon('back', 16), 'Library'),
      h('div.title-row', h('h1', { 'data-testid': 'asset-title' }, a.title), h('span.ref', { 'data-testid': 'asset-ref' }, a.ref), h(`span.badge.${badge}`, badge),
        a.derivation ? h('span.badge', { 'data-testid': 'derivation-badge' }, DERIVATION[a.derivation] ?? a.derivation) : null,
        a.edited ? h('span.badge.warn', { title: 'Title, description or tags edited in the studio' }, 'edited') : null,
        a.needsDescription ? h('span.badge.warn', { 'data-testid': 'needs-description', title: 'Waiting for the agent to describe it' }, 'needs description') : null,
        a.version !== a.latestVersion ? h('a.badge.warn', { href: `/assets/${a.slug}` }, `latest is v${a.latestVersion}`) : null)),
    h('div.page-head-side', tg.el));
}

/** Image: the picture, its palette, what the SVG sanitiser removed, suggested uses. */
function imageView(a) {
  const m = a.meta ?? {};
  const removed = m.sanitized?.removed ?? [];
  const w = m.natural?.width ?? m.width, ht = m.natural?.height ?? m.height;
  return [
    h('section.panel', h('div.media-view.checker', h('img', { src: `/media/${a.file}`, alt: a.description || a.title, 'data-testid': 'asset-image' }))),
    h('section.panel.image-facts', { 'data-testid': 'image-facts' },
      h('h2', 'Image'),
      h('dl.facts',
        w && ht ? [h('dt', 'Size'), h('dd', `${w}×${ht}${m.format ? ` · ${m.format.toUpperCase()}` : ''}${m.bytes ? ` · ${fmtBytes(m.bytes)}` : ''}`)] : null,
        m.originalName ? [h('dt', 'File'), h('dd.mono', m.originalName)] : null),
      m.palette?.length ? [h('h3', 'Palette'), h('div.palette', { 'data-testid': 'palette' }, m.palette.map((c) => h('span.palette-swatch', { 'data-testid': 'palette-swatch', style: { '--c': c }, title: c }, h('span.mono', c))))] : null,
      m.format === 'svg' ? [h('h3', 'Sanitised SVG'), removed.length
        ? h('div', { 'data-testid': 'sanitized' }, h('p.muted', `Removed on upload (${plural(removed.length, 'item')}):`), h('ul.removed', removed.map((r) => h('li.mono', r))))
        : h('p.muted', { 'data-testid': 'sanitized' }, 'Nothing unsafe was found; the drawing was kept as uploaded.')] : null,
      [h('h3', 'Suggested uses'), a.suggestedUses?.length
        ? h('div.chips', { 'data-testid': 'suggested-uses' }, a.suggestedUses.map((u) => h('span.chip', u)))
        : h('p.muted', { 'data-testid': 'suggested-uses' }, a.needsDescription ? 'Waiting for a description: the agent adds suggested uses when it describes the image.' : 'None yet.')]),
  ];
}

/** Sequence: a frame scrubber over its PNG frames. */
function sequenceView(a, ctx) {
  const m = a.meta ?? {};
  const frames = Math.max(1, m.frames ?? 1), fps = m.fps ?? 30;
  const url = (i) => `/media/${a.file}/${String(i).padStart(6, '0')}.png`;
  const img = h('img', { src: url(0), alt: `${a.title}, frame 1`, 'data-testid': 'sequence-image', width: m.width, height: m.height });
  const scrub = h('input.scrub', { type: 'range', min: 0, max: frames - 1, step: 1, value: '0', 'data-testid': 'sequence-scrub', 'aria-label': 'Frame' });
  const readout = h('span.timecode', { 'data-testid': 'sequence-frame' });
  const play = h('button.icon-btn.play', { type: 'button', 'data-testid': 'sequence-play', 'aria-label': 'Play' }, icon('play', 20));
  // load every frame once so playback does not flicker (a bake is at most a few hundred frames)
  const cache = Array.from({ length: Math.min(frames, 900) }, (_, i) => { const im = new Image(); im.src = url(i); return im; });
  let frame = 0, raf = 0, start = 0;
  const show = (i) => {
    frame = clamp(i, 0, frames - 1);
    img.src = cache[frame]?.src ?? url(frame);
    img.alt = `${a.title}, frame ${frame + 1}`;
    scrub.value = String(frame);
    readout.textContent = `${frame + 1} / ${frames} · ${fmtTime(frame / fps)}`;
  };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; fill(play, icon('play', 20)); play.setAttribute('aria-label', 'Play'); };
  const tick = (now) => {
    const i = Math.floor(((now - start) / 1000) * fps);
    show(m.loop === false ? Math.min(i, frames - 1) : i % frames);
    raf = requestAnimationFrame(tick);
  };
  play.addEventListener('click', () => {
    if (raf) { stop(); return; }
    start = performance.now() - (frame / fps) * 1000;
    fill(play, icon('pause', 20)); play.setAttribute('aria-label', 'Pause');
    raf = requestAnimationFrame(tick);
  });
  scrub.addEventListener('input', () => { stop(); show(Number(scrub.value)); });
  ctx.onCleanup(stop);
  show(0);
  return [
    h('section.panel.sequence-panel', { 'data-testid': 'sequence' },
      h('div.media-view.checker', img),
      h('div.transport', play, scrub, readout),
      h('p.muted', `${frames} frames at ${fps} fps, ${m.width}×${m.height}, ${fmtDuration(frames / fps)}, transparent background.`)),
    a.thumb ? h('section.panel', h('h2', 'Thumbnail'), h('img.seq-thumb', { src: `/media/${a.thumb}`, alt: '', 'data-testid': 'sequence-thumb' })) : null,
  ];
}

/** Sound and font assets: the file itself. */
async function mediaView(a, status) {
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

/** The agent panel (lib/agent-panel.js, written alongside); a missing module leaves the slot empty. */
async function mountAgent(slot, opts) {
  try {
    const mod = await import('/ui/lib/agent-panel.js');
    return mod.mountAgentPanel(slot, opts);
  } catch {
    slot.hidden = true;
    return null;
  }
}

async function playground(view, ctx, a, status, favorite) {
  const formats = (a.formats?.length ? a.formats : Object.keys(status.formats)).filter((f) => status.formats[f]);
  if (!formats.length) formats.push('horizontal');
  const fonts = status.fonts.map((f) => f.family);
  let format = formats.includes(ctx.query.get('format')) ? ctx.query.get('format') : formats[0];
  let duration = a.duration ?? 3;
  let values = {};
  // what the preview is showing: the saved version, or a validated draft of the source
  const saved = { ref: a.ref, bundle: null, schema: a.schema, draft: false };
  let current = saved;
  let diff = null, compare = null;

  const stage = createStage({
    onTime(t) { diff?.seek(t); compare?.pair.seek(t); },
  });
  ctx.onCleanup(() => stage.destroy());
  const stageNote = notice('stage-note');
  const draftFlag = h('span.badge.warn', { hidden: true, 'data-testid': 'draft-flag' }, 'Previewing the draft source');

  const size = () => status.formats[format];
  const viewState = () => ({ params: values, duration, width: size().width, height: size().height, t: stage.pv.time });
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
      current.bundle = current.draft ? mergeBundles(b, current.own) : b;
      await show();
    } catch (e) {
      stageNote.show(e.message);
    }
  }

  // parameters, and keeping them: new defaults or a preset
  const keepMsg = notice('keep-error');
  const changedCount = h('span.count', { 'data-testid': 'changed-count' });
  const saveDefaultsBtn = h('button.btn.small.primary', { type: 'button', 'data-testid': 'save-defaults', title: 'Make these values the defaults of a new version' }, 'Save as new version');
  const savePresetBtn = h('button.btn.small', { type: 'button', 'data-testid': 'save-preset', 'aria-expanded': 'false', title: 'A new asset with these values as its defaults' }, 'Save as preset');
  const presetId = nextId('preset');
  const presetName = h('input.mono', { type: 'text', id: presetId, 'data-testid': 'preset-name', placeholder: `${a.slug}-preset`, autocomplete: 'off', spellcheck: false, autocapitalize: 'off', maxLength: 60 });
  const presetTitle = h('input', { type: 'text', 'data-testid': 'preset-title', placeholder: 'Title (optional)', 'aria-label': 'Preset title', maxLength: 120 });
  const presetCreate = h('button.btn.small.primary', { type: 'submit', 'data-testid': 'preset-create' }, 'Create preset');
  const presetForm = h('form.preset-form', { hidden: true },
    h('label', { for: presetId }, 'Preset name'), h('div.row', presetName, presetCreate), presetTitle,
    h('p.hint', 'Lower case letters, digits and dashes. The preset keeps a link to this version.'));
  const keepHint = h('p.hint.keep-hint');
  const keep = h('div.keep', { 'data-testid': 'keep' }, h('div.keep-head', h('h3', 'Keep these values'), changedCount), keepHint, h('div.row', saveDefaultsBtn, savePresetBtn), presetForm, keepMsg.el);

  function updateKeep() {
    const n = Object.keys(values).length;
    changedCount.textContent = n ? `${plural(n, 'change')}` : '';
    const latest = a.version === a.latestVersion;
    saveDefaultsBtn.disabled = !n || current.draft || !latest;
    savePresetBtn.disabled = current.draft;
    keepHint.textContent = current.draft ? 'Save or cancel the source draft first.'
      : !n ? 'Change a parameter, then keep it as the new defaults or as a preset.'
        : !latest ? `New defaults go on the latest version; open v${a.latestVersion} to save them.` : 'New defaults rewrite only the default values in the source.';
  }

  const controls = createParamControls({
    schema: a.schema, values, fonts,
    onChange(next, { structural }) {
      values = next;
      updateKeep();
      if (structural) { rebundle(); diff?.refresh({ structural: true }); compare?.refresh(true); } else { stage.pv.setParams(values); diff?.refresh(); compare?.refresh(false); }
    },
  });
  const resetBtn = h('button.btn.small', { type: 'button', 'data-testid': 'reset-params', onclick: () => { values = {}; controls.reset({}); updateKeep(); rebundle(); diff?.refresh({ structural: true }); compare?.refresh(true); } }, 'Reset');

  saveDefaultsBtn.addEventListener('click', async () => {
    keepMsg.hide();
    saveDefaultsBtn.disabled = true;
    try {
      const r = await api.post(`/api/assets/${a.slug}/defaults`, { params: values, note: `New defaults: ${Object.keys(values).join(', ')}` });
      clearAssetOptions();
      if (ctx.alive()) await ctx.navigate(`/assets/${a.slug}?v=${r.asset.version}`, { force: true, replace: false });
    } catch (e) {
      keepMsg.show(e.message);
      updateKeep();
    }
  });
  savePresetBtn.addEventListener('click', () => {
    presetForm.hidden = !presetForm.hidden;
    savePresetBtn.setAttribute('aria-expanded', String(!presetForm.hidden));
    if (!presetForm.hidden) presetName.focus();
  });
  presetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    keepMsg.hide();
    const name = presetName.value.trim() || presetName.placeholder;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { keepMsg.show('A preset name uses lower case letters, digits and dashes, and starts with a letter or digit.'); presetName.focus(); return; }
    presetCreate.disabled = true;
    try {
      const r = await api.post(`/api/assets/${a.slug}/preset`, { name, params: values, version: a.version, title: presetTitle.value.trim() || undefined });
      clearAssetOptions();
      if (ctx.alive()) await ctx.navigate(`/assets/${r.asset.slug}`, { force: true });
    } catch (err) {
      keepMsg.show(err.message);
      presetCreate.disabled = false;
    }
  });

  // tools under the stage
  const formatBtns = formats.map((name) => h(`button.btn.small.seg${name === format ? '.on' : ''}`, { type: 'button', 'data-testid': `format-${name}`, 'aria-pressed': String(name === format), title: status.formats[name].label }, name));
  formatBtns.forEach((btn, i) => btn.addEventListener('click', () => {
    format = formats[i];
    formatBtns.forEach((b, j) => { b.classList.toggle('on', i === j); b.setAttribute('aria-pressed', String(i === j)); });
    const f = size();
    stage.hideExact();
    stage.setSize(f.width, f.height);
    stage.pv.setView({ width: f.width, height: f.height });
    diff?.refresh();
    compare?.refresh(false);
  }));
  const durationInput = h('input.num', { type: 'number', min: 0.1, max: 60, step: 0.1, value: String(duration), 'data-testid': 'duration', id: 'pg-duration', inputMode: 'decimal' });
  durationInput.addEventListener('change', () => {
    const v = Number(durationInput.value);
    duration = Number.isFinite(v) && durationInput.value.trim() !== '' ? clamp(Math.round(v * 100) / 100, 0.1, 60) : a.duration ?? 3;
    durationInput.value = String(duration);
    stage.pv.setView({ duration });
    stage.setDuration(duration, PREVIEW_FPS);
    diff?.refresh();
    compare?.refresh(false);
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

  // source: a read-only view, and an editor (validate with ⌘S, save as a new version)
  const srcError = notice('source-error');
  const srcOk = notice('source-ok');
  const editBtn = h('button.btn.small', { type: 'button', 'data-testid': 'edit-source' }, 'Edit source');
  const validateBtn = h('button.btn.small', { type: 'button', 'data-testid': 'validate', title: 'Validate and preview the draft (Ctrl+S or ⌘S)' }, 'Validate');
  const saveBtn = h('button.btn.small.primary', { type: 'button', 'data-testid': 'save-version' }, 'Save as new version');
  const cancelBtn = h('button.btn.small', { type: 'button', 'data-testid': 'cancel-edit' }, 'Cancel');
  const noteInput = h('input', { type: 'text', placeholder: 'What changed (version note)', 'data-testid': 'version-note', 'aria-label': 'Version note', maxLength: 200 });
  const editTools = h('div.source-tools', { hidden: true }, noteInput, validateBtn, saveBtn, cancelBtn);
  const reader = createCodeEditor({ value: a.source ?? '', readOnly: true, label: 'Asset source', testid: 'source-view' });
  const editor = createCodeEditor({ value: a.source ?? '', label: 'Asset source, editable', testid: 'source-editor', onSave: () => validateBtn.click() });
  ctx.onCleanup(() => { reader.destroy(); editor.destroy(); });
  editor.el.hidden = true;
  const srcBox = h('div.source-box', reader.el, editor.el);
  let editing = false;
  const dirty = () => editing && editor.value !== (a.source ?? '');
  ctx.setGuard(() => (dirty() ? 'The source has edits that are not saved as a version. Leave anyway?' : null));
  editor.el.addEventListener('input', () => { editor.clearErrors(); });

  function setEditing(on) {
    editing = on;
    reader.el.hidden = on;
    editor.el.hidden = !on;
    editTools.hidden = !on;
    editBtn.hidden = on;
    srcError.hide(); srcOk.hide();
    editor.clearErrors();
    if (on) { editor.value = a.source ?? ''; editor.focus(); }
  }
  async function useSaved() {
    current = saved;
    draftFlag.hidden = true;
    exactBtn.disabled = false;
    values = Object.fromEntries(Object.entries(values).filter(([k]) => k in a.schema));
    controls.reset(values, a.schema);
    updateKeep();
    await rebundle();
  }
  editBtn.addEventListener('click', () => setEditing(true));
  cancelBtn.addEventListener('click', async () => {
    setEditing(false);
    if (current.draft) await useSaved();
  });
  let validating = false;
  validateBtn.addEventListener('click', async () => {
    if (validating || !editing) return;
    validating = true;
    srcError.hide(); srcOk.hide();
    editor.clearErrors();
    validateBtn.disabled = true;
    const source = editor.value;
    try {
      const r = await api.post('/api/assets/validate', { name: a.slug, source });
      if (!ctx.alive()) return;
      // keep the values the new schema still declares
      values = Object.fromEntries(Object.entries(values).filter(([k]) => k in r.schema));
      current = { ref: r.ref, bundle: r.bundle, own: r.bundle, schema: r.schema, draft: true, source };
      controls.reset(values, r.schema);
      updateKeep();
      draftFlag.hidden = false;
      stage.hideExact();
      const refs = referencedAssets(r.schema, values);
      if (refs.length) await rebundle(); else await show();
      srcOk.show(`The source is valid${r.warnings?.length ? `, with ${plural(r.warnings.length, 'warning')}:\n- ${r.warnings.join('\n- ')}` : '.'} The preview now shows this draft.`, 'ok');
    } catch (e) {
      const line = editor.markError(e.message, e.body?.details?.problems ?? []);
      srcError.show(line ? `Line ${line}: ${e.message}` : e.message);
    } finally {
      validating = false;
      validateBtn.disabled = false;
    }
  });
  saveBtn.addEventListener('click', async () => {
    srcError.hide(); srcOk.hide();
    saveBtn.disabled = true;
    try {
      const r = await api.post(`/api/assets/${a.slug}/versions`, { source: editor.value, note: noteInput.value.trim() || undefined });
      clearAssetOptions();
      if (ctx.alive()) await ctx.navigate(`/assets/${a.slug}?v=${r.asset.version}`, { force: true });
    } catch (e) {
      const line = editor.markError(e.message, e.body?.details?.problems ?? []);
      srcError.show(line ? `Line ${line}: ${e.message}` : e.message);
      saveBtn.disabled = false;
    }
  });

  // version diff
  const diffBtn = a.versions.length > 1 ? h('button.btn.small', { type: 'button', 'data-testid': 'diff-open', 'aria-expanded': 'false' }, 'Compare versions') : null;
  const diffPanel = h('section.panel.diff-section', { hidden: true, 'data-testid': 'diff' });
  if (diffBtn) {
    diff = createDiffView({ asset: a, getView: viewState });
    ctx.onCleanup(() => diff.destroy());
    const closeDiff = h('button.btn.small', { type: 'button', 'data-testid': 'diff-close' }, 'Close');
    fill(diffPanel, h('div.panel-head', h('h2', 'Compare versions'), closeDiff), diff.el);
    const setDiff = (on) => {
      diff.toggle(on);
      diffPanel.hidden = !on;
      diffBtn.setAttribute('aria-expanded', String(on));
      diffBtn.classList.toggle('on', on);
      if (on) diffPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    diffBtn.addEventListener('click', () => setDiff(diffPanel.hidden));
    closeDiff.addEventListener('click', () => { setDiff(false); diffBtn.focus(); });
  }

  // an agent's proposal next to the current version: same frame, same params
  const comparePanel = h('section.panel.compare-section', { hidden: true, 'data-testid': 'compare-view' });
  function closeCompare() {
    compare?.pair.destroy();
    compare = null;
    comparePanel.hidden = true;
    comparePanel.replaceChildren();
  }
  ctx.onCleanup(() => compare?.pair.destroy());
  async function openCompare(p) {
    closeCompare();
    const next = (a.latestVersion ?? a.version) + 1;
    const isNew = p.proposal?.kind === 'new-asset';
    const labels = [`Current v${a.version}`, isNew ? `Proposal → ${p.ref?.split('@')[0] ?? 'new asset'}` : `Proposal → v${next}`];
    const pair = framePair({ testid: 'compare-frames', labels, cellTestids: ['compare-current', 'compare-proposal'] });
    const closeBtn = h('button.btn.small', { type: 'button', 'data-testid': 'compare-close', onclick: () => closeCompare() }, 'Close');
    const both = () => Object.fromEntries(Object.entries(values).filter(([k]) => k in (current.schema ?? {}) && k in (p.schema ?? {})));
    const msg = notice('compare-error');
    const summary = p.proposal?.summary ?? p.proposal?.note ?? p.proposal?.title ?? null;
    fill(comparePanel,
      h('div.panel-head', h('h2', `Proposal #${p.proposal?.id ?? ''}`.trim()), closeBtn),
      summary ? h('p.desc', summary) : null,
      pair.el,
      h('p.hint', 'Same frame and the same parameters on both sides; play and scrub move both.'),
      msg.el);
    comparePanel.hidden = false;
    compare = {
      pair,
      async refresh(structural) {
        const v = viewState();
        if (!structural) {
          pair.setView({ width: v.width, height: v.height, duration: v.duration });
          pair.el.style.setProperty('--ar', String(v.width / v.height));
          pair.el.classList.toggle('portrait', v.height > v.width);
          pair.setParams([both(), both()]);
          return;
        }
        await draw();
      },
    };
    async function draw() {
      const v = viewState();
      const params = both();
      try {
        const extra = referencedAssets(p.schema, params);
        const pb = extra.length ? mergeBundles(await fetchBundle(extra), p.bundle) : p.bundle;
        await pair.show([{ ref: current.ref, bundle: current.bundle, params }, { ref: p.ref, bundle: pb, params }], { ...v, duration: v.duration });
      } catch (e) {
        msg.show(e.message);
      }
    }
    stage.pv.pause();
    await draw();
    comparePanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ask the agent
  const agentSlot = h('div.pg-agent', { 'data-testid': 'agent-slot' });
  mountAgent(agentSlot, {
    scope: 'asset',
    asset: a.slug,
    getContext: () => ({ version: a.version, params: values, at: Math.round(stage.pv.time * 1000) / 1000 }),
    onPreview: (p) => { if (ctx.alive()) openCompare(p); },
    onAccepted: () => { if (ctx.alive() && !dirty()) ctx.navigate(`/assets/${a.slug}`, { force: true, replace: true }); },
  }).then((panel) => { if (panel) ctx.onCleanup(() => panel.destroy()); });

  const tg = toggles(a, favorite);
  const headSlot = h('div', header(a, tg));
  const meta = metadataPanel(a, {
    onSaved(next) {
      a = { ...a, ...next };
      meta.update(a);
      fill(headSlot, header(a, tg));
      ctx.setTitle(a.title);
    },
  });
  const liveNote = notice('live-note');
  watchLive(ctx, a, { tg, meta, headSlot, dirty, liveNote, onMeta: (next) => { a = { ...a, ...next }; } });
  updateKeep();

  fill(view,
    headSlot,
    liveNote.el,
    h('div.playground',
      h('div.pg-main',
        h('section.panel.stage-panel',
          stage.el,
          h('div.stage-tools',
            h('div.seg-group', { role: 'group', 'aria-label': 'Format' }, formatBtns),
            stage.safeBtn,
            h('label.inline-field', { for: 'pg-duration' }, 'Duration', durationInput, h('span.unit', 's')),
            exactBtn, audioBtn, draftFlag),
          !PREVIEWED_KINDS.has(a.kind) ? h('p.hint', `A ${a.kind} asset.`) : null,
          ['motion', 'transition', 'effect'].includes(a.kind) ? h('p.hint.kind-hint', a.kind === 'motion' ? 'Shown moving a demo card.' : a.kind === 'transition' ? 'Shown between two demo scenes.' : 'Shown on a demo scene.') : null,
          stageNote.el,
          audioSlot),
        comparePanel,
        h('section.panel.source-panel',
          h('div.panel-head', h('h2', 'Source'), editBtn),
          editTools, srcError.el, srcOk.el, srcBox),
        diffPanel),
      h('aside.pg-side',
        h('section.panel', h('div.panel-head', h('h2', 'Parameters'), resetBtn), controls.el, Object.keys(a.schema ?? {}).length ? keep : null),
        agentSlot,
        meta.el,
        versionsPanel(a, diffBtn),
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
  if (a.kind !== 'value' && a.kind !== 'audio') stage.pv.seek(Math.round(duration * 0.6 * PREVIEW_FPS) / PREVIEW_FPS);
}

/**
 * Live events for this asset: favourite/featured flip the toggles, metadata redraws the panel, and
 * a new version (from the agent, the MCP server or another tab) reloads unless there are unsaved edits.
 */
function watchLive(ctx, a, { tg, meta, headSlot, dirty = () => false, liveNote, onMeta = () => {} }) {
  const off = live.on('asset', async (e) => {
    if (e.key !== a.slug || !ctx.alive()) return;
    if (e.action === 'favorite') tg.fav.set(!!e.data?.on);
    else if (e.action === 'featured') tg.feat.set(!!e.data?.on);
    else if (e.action === 'metadata') {
      try {
        const next = await api.get(`/api/assets/${a.slug}${qs({ version: a.version })}`);
        if (!ctx.alive()) return;
        Object.assign(a, next);
        onMeta(next);
        meta?.update(a);
        fill(headSlot, header(a, tg));
        ctx.setTitle(a.title);
      } catch { /* the next event or a reload shows it */ }
    } else if (e.action === 'version') {
      if (e.data?.ref === a.ref) return;   // our own save, already on screen
      if (dirty()) {
        liveNote.show(`A new version arrived (${e.data?.ref ?? 'latest'}). Your source edits are kept; save or cancel them to see it.`, 'info');
        return;
      }
      if (a.version === a.latestVersion) ctx.navigate(`/assets/${a.slug}`, { force: true, replace: true });
      else {
        liveNote.show(`A new version arrived: ${e.data?.ref ?? 'latest'}.`, 'info');
        a.latestVersion = Number(String(e.data?.ref ?? '').split('@')[1]) || a.latestVersion;
      }
    }
  });
  ctx.onCleanup(off);
}

async function isFavorite(slug) {
  try {
    const r = await api.get(`/api/assets${qs({ favorite: 1, query: slug, limit: 50 })}`);
    return r.assets.some((x) => x.slug === slug);
  } catch {
    return false;
  }
}

export async function mount(view, ctx) {
  const slug = ctx.params[0];
  const version = ctx.query.get('v');
  let a, status, favorite;
  try {
    [a, status] = await Promise.all([api.get(`/api/assets/${slug}${version && /^\d+$/.test(version) ? `?version=${version}` : ''}`), getStatus()]);
    favorite = a.favorite ?? await isFavorite(slug);
  } catch (e) {
    fill(view, errorBlock(e.message, h('a.btn', { href: '/' }, 'Back to the library')));
    return;
  }
  if (!ctx.alive()) return;
  ctx.setTitle(a.title);
  // recently used: once per visit
  api.post(`/api/assets/${slug}/opened`).catch(() => {});
  if (a.type === 'function') return playground(view, ctx, a, status, favorite);

  const tg = toggles(a, favorite);
  const headSlot = h('div', header(a, tg));
  const meta = metadataPanel(a, {
    onSaved(next) { Object.assign(a, next); meta.update(a); fill(headSlot, header(a, tg)); ctx.setTitle(a.title); },
  });
  const liveNote = notice('live-note');
  watchLive(ctx, a, { tg, meta, headSlot, liveNote });
  let main;
  if (a.type === 'image' && a.file) main = imageView(a);
  else if (a.type === 'sequence' && a.file) main = sequenceView(a, ctx);
  else main = [h('section.panel', await mediaView(a, status))];
  if (!ctx.alive()) return;
  const agentSlot = h('div.pg-agent', { 'data-testid': 'agent-slot' });
  mountAgent(agentSlot, { scope: 'asset', asset: a.slug, getContext: () => ({ version: a.version }), onAccepted: () => { if (ctx.alive()) ctx.navigate(`/assets/${a.slug}`, { force: true, replace: true }); } })
    .then((panel) => { if (panel) ctx.onCleanup(() => panel.destroy()); });
  fill(view,
    headSlot,
    liveNote.el,
    h('div.playground.media',
      h('div.pg-main', main),
      h('aside.pg-side', meta.el, agentSlot, versionsPanel(a, null), detailsPanel(a))));
}
