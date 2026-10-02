// Clip editor: preview with scrubbing and overlays, a timeline with draggable items, an inspector
// with the same generated controls as the playground, and save / render / remix.
// Edits go to a local draft composition that the preview draws live; changes to the set of assets
// are pinned and bundled by the server first.

import { api, getStatus, renderQueue } from '/ui/lib/api.js';
import { openDialog } from '/ui/lib/dialog.js';
import { createParamControls } from '/ui/lib/params.js';
import { pickAsset } from '/ui/lib/picker.js';
import { createStage } from '/ui/lib/stage.js';
import { createTimeline } from '/ui/lib/timeline.js';
import { assetHref, clamp, clone, errorBlock, fill, fmtDuration, h, icon, nextId, notice, plural, splitRef } from '/ui/lib/util.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const RELATION = { created: 'created here', reused: 'reused', 'new-version': 'new version', library: 'library' };
const round = (v) => Math.round(v * 1000) / 1000;

const hasRefParams = (schema) => Object.values(schema ?? {}).some((d) => d.type === 'asset' || d.type === 'image' || ((d.type === 'array' || d.type === 'object') && /"type":"(asset|image)"/.test(JSON.stringify(d))));

export async function mount(view, ctx) {
  const slug = ctx.params[0];
  let clip, status;
  try {
    [clip, status] = await Promise.all([api.get(`/api/clips/${slug}`), getStatus()]);
  } catch (e) {
    fill(view, errorBlock(e.message, h('a.btn', { href: '/clips' }, 'Back to clips')));
    return;
  }
  if (!ctx.alive()) return;
  ctx.setTitle(clip.title);
  const fonts = status.fonts.map((f) => f.family);

  let draft = clone(clip.composition);
  let bundle = clip.bundle, beats = clip.beats, info = clip.assets;
  let selected = null, selectedTrack = null, dirty = false, busy = false;

  const msg = notice('editor-error');
  const unsaved = h('span.badge.warn', { hidden: true, 'data-testid': 'unsaved' }, 'Unsaved changes');
  // sits in the title row, so a save confirmation does not move the page
  const saved = h('span.badge.ok', { hidden: true, 'data-testid': 'save-status', role: 'status' });
  const meta = h('p.sub', { 'data-testid': 'clip-meta' });
  const saveBtn = h('button.btn', { type: 'button', 'data-testid': 'save', disabled: true }, 'Save');
  const renderBtn = h('button.btn.primary', { type: 'button', 'data-testid': 'render-button' }, 'Render');
  const remixBtn = h('button.btn', { type: 'button', 'data-testid': 'remix' }, 'Remix');
  const addBtn = h('button.btn.small', { type: 'button', 'data-testid': 'add-item' }, icon('plus', 14), 'Add item');
  const inspector = h('section.panel.inspector', { 'data-testid': 'inspector' });
  const assetsPanel = h('section.panel', { 'data-testid': 'clip-assets' }, h('h2', 'Assets in this clip'));

  const position = h('span.timecode', { 'data-testid': 'tl-position' });
  const showPosition = (t) => { position.textContent = `frame ${Math.round(t * draft.fps)} of ${Math.round(draft.duration * draft.fps)} · ${draft.fps} fps`; };
  const stage = createStage({ guides: true, compact: true, onTime(t) { timeline.setTime(t, stage.pv.playing); showPosition(t); } });
  ctx.onCleanup(() => stage.destroy());
  const timeline = createTimeline({
    onSeek(t) { stage.pv.pause(); stage.pv.seek(t); },
    onSelect(itemId, trackId) { selected = itemId; selectedTrack = trackId; drawInspector(); },
    onChange(itemId) { if (itemId === selected) syncTiming(); live(); },
  });
  ctx.onCleanup(() => timeline.destroy());
  ctx.setGuard(() => (dirty ? 'This clip has unsaved changes. Leave without saving?' : null));

  const findItem = (id, comp = draft) => {
    for (const track of comp.tracks) { const item = track.items.find((i) => i.id === id); if (item) return { track, item }; }
    return null;
  };

  function setDirty(on) { dirty = on; unsaved.hidden = !on; if (on) saved.hidden = true; saveBtn.disabled = !on || busy; }
  function setBusy(on) { busy = on; saveBtn.disabled = !dirty || on; renderBtn.disabled = on; remixBtn.disabled = on; addBtn.disabled = on; }
  /** A change the loaded bundle can draw as it is: timing, fades, plain parameters. */
  function live() { setDirty(true); stage.pv.setComposition(draft); }

  function drawMeta() {
    fill(meta, 
      h('span.ref', clip.slug), ' · ', status.formats[draft.format]?.label ?? 'Custom size', ` · ${draft.width}×${draft.height} · ${fmtDuration(draft.duration)} · ${draft.fps} fps · `,
      h('span', { 'data-testid': 'revision' }, `revision ${clip.revision}`),
      clip.remixedFrom ? [' · remix of ', h('a', { href: `/clips/${clip.remixedFrom}` }, clip.remixedFrom)] : null);
  }

  async function showClip() {
    stage.setSize(draft.width, draft.height);
    stage.setDuration(draft.duration, draft.fps);
    const hasAudio = clip.composition.tracks.some((t) => t.type === 'audio' && t.items.length);
    await stage.show((pv) => pv.showClip({ composition: draft, bundle, audioUrl: hasAudio ? `/api/clips/${slug}/audio.wav?r=${clip.revision}` : null }));
    timeline.setTime(stage.pv.time);
  }

  /** Take a pinned composition, its bundle and asset facts from the server. */
  function adopt(r) {
    draft = clone(r.composition);
    bundle = r.bundle; beats = r.beats; info = r.assets;
    if (selected && !findItem(selected)) selected = null;
    if (selectedTrack && !draft.tracks.some((t) => t.id === selectedTrack)) selectedTrack = null;
    timeline.setData({ composition: draft, beats });
    timeline.setSelected(selected, selected ? undefined : selectedTrack);
  }

  /** The set of assets changed: have the server pin and bundle `next`, then show it. */
  async function rebundle(next, select) {
    msg.hide();
    setBusy(true);
    try {
      const r = await api.post(`/api/clips/${slug}/bundle`, { composition: next });
      if (!ctx.alive()) return false;
      if (select !== undefined) selected = select;
      adopt(r);
      setDirty(true);
      await showClip();
      drawInspector();
      return true;
    } catch (e) {
      msg.show(e.message);
      drawInspector();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    msg.hide();
    setBusy(true);
    try {
      const r = await api.put(`/api/clips/${slug}`, { composition: draft });
      if (!ctx.alive()) return false;
      clip = r;
      adopt(r);
      setDirty(false);
      drawMeta(); drawAssets(); drawInspector();
      await showClip();
      saved.textContent = `Saved as revision ${clip.revision}`;
      saved.hidden = false;
      return true;
    } catch (e) {
      msg.show(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  saveBtn.addEventListener('click', save);
  renderBtn.addEventListener('click', async () => {
    if (dirty && !(await save())) return;
    msg.hide();
    setBusy(true);
    try {
      await api.post(`/api/clips/${slug}/render`);
      renderQueue.refresh();
      if (ctx.alive()) await ctx.navigate('/renders', { force: true });
    } catch (e) {
      msg.show(e.message);
      setBusy(false);
    }
  });

  remixBtn.addEventListener('click', () => {
    const others = Object.entries(status.formats).filter(([k]) => k !== draft.format);
    const format = h('select', { id: 'rx-format', 'data-testid': 'remix-format' }, others.map(([k, f]) => h('option', { value: k }, `${f.label} · ${f.width}×${f.height}`)));
    const name = h('input', { type: 'text', id: 'rx-name', value: `${slug}-${others[0]?.[0] ?? 'remix'}`.slice(0, 64), 'data-testid': 'remix-name', autocomplete: 'off', spellcheck: false });
    format.addEventListener('change', () => { name.value = `${slug}-${format.value}`.slice(0, 64); });
    const err = notice('remix-error');
    const go = h('button.btn.primary', { type: 'submit', 'data-testid': 'remix-create' }, 'Create remix');
    const form = h('form.form', { novalidate: true },
      h('p.muted', dirty ? 'The remix copies the saved clip. Your unsaved changes are not included.' : 'A remix is a new clip with the same timeline in another format. The assets re-flow to the new frame.'),
      h('div.field', h('label', { for: 'rx-format' }, 'Format'), format),
      h('div.field', h('label', { for: 'rx-name' }, 'Name of the new clip'), name),
      err.el,
      h('div.dialog-foot.inline', go));
    const d = openDialog({ title: 'Remix this clip', body: form, testid: 'remix-dialog' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hide();
      const newSlug = name.value.trim();
      if (!SLUG.test(newSlug)) { err.show('The name needs 2 to 64 lowercase letters, digits or dashes.'); return; }
      go.disabled = true;
      try {
        const made = await api.post(`/api/clips/${slug}/remix`, { name: newSlug, format: format.value });
        d.close();
        ctx.navigate(`/clips/${made.slug}`, { force: true });
      } catch (e2) {
        err.show(e2.message);
        go.disabled = false;
      }
    });
  });

  addBtn.addEventListener('click', async () => {
    const picked = await pickAsset({ title: 'Add an item', kinds: ['visual', 'audio'] });
    if (!picked || !ctx.alive()) return;
    const next = clone(draft);
    const audio = picked.kind === 'audio';
    const fits = (t) => (t.type === 'audio') === audio;
    let track = next.tracks.find((t) => t.id === selectedTrack && fits(t)) ?? (audio ? next.tracks.find(fits) : [...next.tracks].reverse().find(fits));
    if (!track) {
      const base = audio ? 'audio' : 'visual';
      let id = base, n = 1;
      while (next.tracks.some((t) => t.id === id)) id = `${base}-${++n}`;
      track = { id, type: base, items: [] };
      next.tracks.push(track);
    }
    const ids = new Set(next.tracks.flatMap((t) => t.items.map((i) => i.id)));
    let id = picked.slug, n = 1;
    while (ids.has(id)) id = `${picked.slug}-${++n}`;
    const duration = round(Math.min(picked.duration ?? 3, next.duration));
    const start = round(clamp(Math.round(stage.pv.time / 0.05) * 0.05, 0, next.duration - duration));
    track.items.push({ id, asset: picked.ref, start, duration, params: {} });
    selectedTrack = track.id;
    await rebundle(next, id);
  });

  // ── inspector ────────────────────────────────────────────────────────────────────────────
  let timing = null;   // the inputs that mirror a drag on the timeline

  function syncTiming() {
    const found = selected ? findItem(selected) : null;
    if (!found || !timing) return;
    timing.start.value = String(found.item.start);
    timing.duration.value = String(found.item.duration);
  }

  function numField(label, testid, value, { min, max, step, slider = false }, apply) {
    const id = nextId('f');
    const fix = (v) => round(clamp(v, min, max));
    const box = h('input.num', { type: 'number', id, min, max, step, value: String(value), 'data-testid': testid, inputMode: 'decimal' });
    const range = slider ? h('input', { type: 'range', min, max, step, value: String(value), 'aria-label': `${label} slider` }) : null;
    box.addEventListener('input', () => {
      const v = Number(box.value);
      if (box.value.trim() === '' || !Number.isFinite(v)) return;
      if (range) range.value = String(fix(v));
      apply(fix(v));
    });
    box.addEventListener('change', () => {
      const v = Number(box.value);
      const x = box.value.trim() === '' || !Number.isFinite(v) ? value : fix(v);
      const actual = apply(x) ?? x;
      box.value = String(actual);
      if (range) range.value = String(actual);
    });
    range?.addEventListener('input', () => { box.value = range.value; apply(fix(Number(range.value))); });
    return { el: h('div.field', h('label', { for: id }, label), h('div.ctl-number', range, box)), input: box };
  }

  function drawClipSettings() {
    timing = null;
    const end = Math.max(0.1, ...draft.tracks.flatMap((t) => t.items.map((i) => i.start + i.duration)));
    const duration = numField('Clip duration in seconds', 'clip-duration', draft.duration, { min: Math.ceil(end * 100) / 100, max: 120, step: 0.5 }, (v) => {
      if (v === draft.duration) return;
      draft.duration = v;
      stage.setDuration(v, draft.fps);
      timeline.setData({ composition: draft, beats });
      drawMeta();
      live();
    });
    const bgId = nextId('f');
    const bg = h('input.mono', { type: 'text', id: bgId, value: draft.background ?? '#000000', 'data-testid': 'clip-background', spellcheck: false, autocomplete: 'off' });
    bg.addEventListener('input', () => {
      const ok = CSS.supports('color', bg.value.trim());
      bg.classList.toggle('invalid', !ok);
      if (!ok) return;
      draft.background = bg.value.trim();
      live();
    });
    fill(inspector, 
      h('h2', 'Inspector'),
      h('p.muted', { 'data-testid': 'inspector-empty' }, draft.tracks.some((t) => t.items.length) ? 'Select an item on the timeline to edit its timing and parameters.' : 'This clip is empty. Use "Add item" to place an asset at the playhead.'),
      h('h3', 'Clip'),
      duration.el,
      h('div.field', h('label', { for: bgId }, 'Background colour'), bg));
  }

  function drawInspector() {
    const found = selected ? findItem(selected) : null;
    if (!found) { drawClipSettings(); return; }
    const { track, item } = found;
    const a = info[item.asset] ?? { slug: splitRef(item.asset).slug, version: splitRef(item.asset).version, latestVersion: splitRef(item.asset).version, schema: {}, title: item.asset, kind: track.type === 'audio' ? 'audio' : 'visual' };
    const audio = track.type === 'audio';

    const start = numField('Start', 'item-start', item.start, { min: 0, max: round(draft.duration - 0.1), step: 0.05 }, (v) => {
      item.start = round(Math.min(v, draft.duration - item.duration));
      timeline.refresh(); live();
      return item.start;
    });
    const duration = numField('Duration', 'item-duration', item.duration, { min: 0.1, max: draft.duration, step: 0.05 }, (v) => {
      item.duration = round(Math.min(v, draft.duration - item.start));
      timeline.refresh(); live();
      return item.duration;
    });
    timing = { start: start.input, duration: duration.input };
    const optional = (key, v, zero) => { if (v === zero) delete item[key]; else item[key] = v; live(); };
    const fadeIn = numField('Fade in', 'item-fadein', item.fadeIn ?? 0, { min: 0, max: 10, step: 0.05 }, (v) => optional('fadeIn', v, 0));
    const fadeOut = numField('Fade out', 'item-fadeout', item.fadeOut ?? 0, { min: 0, max: 10, step: 0.05 }, (v) => optional('fadeOut', v, 0));
    const level = audio
      ? numField('Gain', 'item-gain', item.gain ?? 1, { min: 0, max: 4, step: 0.05, slider: true }, (v) => { item.gain = v; live(); })
      : numField('Opacity', 'item-opacity', item.opacity ?? 1, { min: 0, max: 1, step: 0.01, slider: true }, (v) => optional('opacity', v, 1));

    const structural = hasRefParams(a.schema);
    const controls = createParamControls({
      schema: a.schema, values: item.params, fonts,
      onChange(next, m) {
        if (m.structural) {
          const copy = clone(draft);
          findItem(item.id, copy).item.params = clone(next);
          rebundle(copy);
        } else {
          item.params = next;
          live();
        }
      },
    });
    const resetBtn = h('button.btn.small', { type: 'button', 'data-testid': 'reset-params' }, 'Reset');
    resetBtn.addEventListener('click', () => {
      if (structural) { const copy = clone(draft); findItem(item.id, copy).item.params = {}; rebundle(copy); return; }
      item.params = {};
      controls.reset({});
      live();
    });

    const behind = a.latestVersion > a.version;
    const upgrade = behind ? h('button.btn.small', { type: 'button', 'data-testid': 'upgrade' }, 'Upgrade') : null;
    upgrade?.addEventListener('click', () => {
      const copy = clone(draft);
      findItem(item.id, copy).item.asset = `${a.slug}@${a.latestVersion}`;
      rebundle(copy);
    });
    const change = h('button.btn.small', { type: 'button', 'data-testid': 'change-asset' }, 'Change asset');
    change.addEventListener('click', async () => {
      const picked = await pickAsset({ title: 'Change the asset', kinds: [audio ? 'audio' : 'visual'] });
      if (!picked || !ctx.alive()) return;
      const copy = clone(draft);
      const target = findItem(item.id, copy).item;
      target.asset = picked.ref;
      target.params = {};
      rebundle(copy);
    });
    const del = h('button.btn.small.danger', { type: 'button', 'data-testid': 'delete-item' }, icon('trash', 14), 'Delete item');
    del.addEventListener('click', () => {
      track.items.splice(track.items.indexOf(item), 1);
      selected = null;
      timeline.setData({ composition: draft, beats });
      timeline.setSelected(null, track.id);
      drawInspector();
      live();
    });

    fill(inspector, 
      h('div.panel-head', h('h2', 'Inspector'), h('span.ref', { 'data-testid': 'selected-id' }, item.id)),
      h('div.inspector-asset',
        h('a.asset-link', { href: assetHref(item.asset), 'data-testid': 'item-asset' },
          a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '' }) : null,
          h('span', h('b', a.title), h('span.ref', item.asset))),
        h('p.version-state', { 'data-testid': 'version-state' }, behind ? `pinned v${a.version}, latest v${a.latestVersion} → ` : `pinned v${a.version}, the latest`, upgrade),
        h('div.row', change, del)),
      h('h3', `Timing · ${track.name ?? track.id} track`),
      h('div.field-grid', start.el, duration.el, fadeIn.el, fadeOut.el),
      level.el,
      h('div.panel-head', h('h3', 'Parameters'), Object.keys(a.schema ?? {}).length ? resetBtn : null),
      controls.el);
  }

  /** The saved clip's pinned assets, with how the clip came by each. */
  async function drawAssets() {
    let used;
    try {
      used = (await api.get(`/api/clips/${slug}/assets`)).assets;
    } catch (e) {
      fill(assetsPanel, h('h2', 'Assets in this clip'), h('p.notice.error', e.message));
      return;
    }
    if (!ctx.alive()) return;
    const list = used.filter((a) => a.type !== 'font');
    const fontsUsed = used.filter((a) => a.type === 'font');
    fill(assetsPanel, 
      h('div.panel-head', h('h2', 'Assets in this clip'), h('span.count', plural(list.length, 'asset'))),
      list.length
        ? h('ul.used-assets', list.map((a) => h('li', { 'data-testid': 'clip-asset', 'data-relation': a.relation },
          h('a.mono', { href: assetHref(a.ref) }, a.ref),
          h(`span.badge.rel-${a.relation}`, RELATION[a.relation] ?? a.relation),
          h('span.muted', [a.relation !== 'created' && a.originClip ? `from ${a.originClip}` : null, a.direct ? null : 'nested'].filter(Boolean).join(' · ')))))
        : h('p.muted', 'Saved items and the assets they compose are listed here.'),
      fontsUsed.length ? h('p.muted', `Fonts: ${fontsUsed.map((f) => f.title).join(', ')}`) : null);
  }

  // ── layout ───────────────────────────────────────────────────────────────────────────────
  fill(view, 
    h('div.page-head',
      h('div',
        h('a.back', { href: '/clips' }, icon('back', 16), 'Clips'),
        h('div.title-row', h('h1', clip.title), unsaved, saved),
        meta),
      h('div.page-head-side', saveBtn, remixBtn, renderBtn)),
    msg.el,
    h('div.editor',
      h('div.ed-main',
        h('section.panel.stage-panel', stage.el),
        h('section.panel.timeline-panel',
          h('div.panel-head', h('div.row', h('h2', 'Timeline'), position), h('div.row', addBtn, timeline.toolbar)),
          timeline.el,
          h('p.hint', `Drag an item to move it, drag its edges to trim. ${plural(beats.length, 'beat')} detected in the audio.`))),
      h('aside.ed-side', inspector, assetsPanel)));

  drawMeta();
  drawAssets();
  drawInspector();
  timeline.setData({ composition: draft, beats });
  showPosition(0);
  await showClip();
}
