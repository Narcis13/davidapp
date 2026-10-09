// Clip editor: the preview with on-canvas handles and a format switcher, a timeline with track
// controls, keyframe markers and waveforms, a layers view, an inspector (timing, layout with
// keyframes and per-format overrides, parameters, attachments), undo and redo, clipboard, split,
// saving layers as one asset, the agent panel, and save / render / remix. Since iteration 3: the
// narration's words and the markers on the timeline, items that start on a word, gain automation
// and ducking, the clip's loudness, captions and platforms, the issues panel, and overlays on the preview.
// Edits go to a local draft composition that the preview draws live; changes to the set of assets
// are pinned and bundled by the server first.

import { FORMAT_NAMES, forFormat } from '/core/transform.js';
import { mountAgentPanel } from '/ui/lib/agent-panel.js';
import { api, getStatus, renderQueue } from '/ui/lib/api.js';
import { confirmDialog, openDialog } from '/ui/lib/dialog.js';
import { createCanvasHandles } from '/ui/lib/canvas-handles.js';
import { createHistory } from '/ui/lib/history.js';
import { anchorSection, attachmentsSection, audioSection, captionsSection, itemTime, keyMarks, keyframesSection, loudnessSection, markerSection, paramsSection, platformsSection, prune, sampled, setProp, transformSection } from '/ui/lib/inspector.js';
import { mountIssues } from '/ui/lib/issues.js';
import { live as liveEvents } from '/ui/lib/live.js';
import { createOverlays } from '/ui/lib/overlays.js';
import { pickAsset } from '/ui/lib/picker.js';
import { createStage } from '/ui/lib/stage.js';
import { createTimeline } from '/ui/lib/timeline.js';
import { loadPeaks } from '/ui/lib/waveform.js';
import { MARKER_TYPES } from '/core/composition.js';
import { assetHref, clamp, clone, debounce, errorBlock, fill, fmtDuration, fmtTime, h, icon, nextId, notice, plural, splitRef } from '/ui/lib/util.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const RELATION = { created: 'created here', reused: 'reused', 'new-version': 'new version', library: 'library' };
const FORMAT_LABEL = { vertical: 'Vertical', horizontal: 'Horizontal', square: 'Square' };
const round = (v) => Math.round(v * 1000) / 1000;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl+';
const OPEN_CLIP_KEY = 'fablecut.openClip';

const SHORTCUTS = [
  ['Space', 'Play or pause'],
  ['← / →', 'One frame back or forward'],
  ['S', 'Split the selected items at the playhead'],
  ['M', 'Add a note marker at the playhead'],
  [`${MOD}Z`, 'Undo'],
  [isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z or Ctrl+Y', 'Redo'],
  [`${MOD}C`, 'Copy the selected items'],
  [`${MOD}V`, 'Paste at the playhead'],
  [`${MOD}D`, 'Duplicate the selected items'],
  ['Delete or Backspace', 'Delete the selected items or marker'],
  ['Shift or ⌘ click', 'Add an item to the selection'],
  ['Escape', 'Clear the selection'],
  ['Arrow keys on the preview', 'Nudge the selected layer one pixel (Shift: ten)'],
  ['Shift while dragging a corner', 'Keep the proportions'],
  ['Shift while rotating', 'Rotate in 15° steps'],
  ['Shift while moving on the preview', 'Move along one axis'],
  ['Alt while dragging', 'Do not snap'],
  ['↑ / ↓ on a track handle', 'Move the track forward or back'],
  ['Alt+↑ / Alt+↓ on a layer', 'Move the layer forward or back'],
  ['?', 'This list'],
];

const hasRefParams = (schema) => Object.values(schema ?? {}).some((d) => d.type === 'asset' || d.type === 'image' || ((d.type === 'array' || d.type === 'object') && /"type":"(asset|image)"/.test(JSON.stringify(d))));
const isTyping = (el) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Every asset reference a composition draws with (items, attachments, easing, refs in params). */
function refsOf(comp) {
  const refs = new Set();
  const att = (a) => { if (a?.asset) refs.add(a.asset); for (const m of JSON.stringify(a?.params ?? {}).matchAll(/"([a-z0-9][a-z0-9-]*@\d+)"/g)) refs.add(m[1]); };
  for (const a of comp.effects ?? []) att(a);
  if (comp.easing) refs.add(comp.easing);
  for (const tr of comp.tracks) {
    for (const a of tr.effects ?? []) att(a);
    for (const it of tr.items) {
      att(it);
      for (const a of [...(it.motions ?? []), ...(it.effects ?? []), it.mask, it.transition]) if (a) att(a);
      for (const o of Object.values(it.formats ?? {})) att({ params: o.params });
    }
  }
  return refs;
}
const byTime = (a, b) => a.t - b.t;
const audioItems = (comp) => comp.tracks.some((t) => t.type === 'audio' && t.items.length);
/** What the mix depends on: when this changes, the preview's audio is made again. */
const audioSig = (c) => JSON.stringify([c.loudness, c.duration, c.tracks.filter((t) => t.type === 'audio').map((t) => [t.id, t.role, t.hidden, t.muted, t.solo, t.items])]);
const needsEasing = (comp) => !comp.easing && /"ease":"(?!linear"|hold")/.test(JSON.stringify(comp.tracks));

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
  // what the studio measured about the draft: the narration's words (clip time), caption pages, anchors, zones in frame pixels
  let words = clip.words ?? [], captionPages = clip.captions ?? null, anchors = clip.anchors ?? [], zones = clip.zones ?? null;
  let selMarker = null;
  const resolved = new Map();   // anchored item id → where the studio last put it (so a word that moves takes the item along)
  let bundled = refsOf(draft);
  let fmt = draft.format;
  let sel = { ids: [], primary: null, track: null };
  let dirty = false, busy = false, pendingRevision = 0, keptRevision = 0;
  let saveError = '';   // why the last save failed, for a dialog that saves first
  let proposal = null, showProposal = false;
  let clipboard = [];

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
  const layersList = h('ol.layers', { 'data-testid': 'layers-list' });
  const layersPanel = h('section.panel.layers-panel', { 'data-testid': 'layers-panel' }, h('div.panel-head', h('h2', 'Layers at the playhead'), h('span.count', { 'data-testid': 'layers-count' })), layersList);
  const agentBox = h('div.ed-agent');
  const changedBanner = h('div.notice.info.clip-changed', { hidden: true, 'data-testid': 'clip-changed', role: 'status' });

  // edit toolbar
  const tool = (testid, label, iconText, title) => h('button.btn.small.ed-tool', { type: 'button', 'data-testid': testid, title, 'aria-label': label }, iconText ? h('span.ed-glyph', { 'aria-hidden': 'true' }, iconText) : null, h('span.ed-tool-label', label));
  const undoBtn = tool('undo', 'Undo', '↶', `Undo (${MOD}Z)`);
  const redoBtn = tool('redo', 'Redo', '↷', `Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`);
  const splitBtn = tool('split', 'Split', '✂', 'Split at the playhead (S)');
  const copyBtn = tool('copy', 'Copy', null, `Copy (${MOD}C)`);
  const pasteBtn = tool('paste', 'Paste', null, `Paste at the playhead (${MOD}V)`);
  const dupBtn = tool('duplicate', 'Duplicate', null, `Duplicate (${MOD}D)`);
  const assetBtn = tool('save-as-asset', 'Save as asset', null, 'Save the selected layers as one asset in the library');
  const keysBtn = h('button.btn.small.ed-tool', { type: 'button', 'data-testid': 'shortcuts', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts' }, '?');
  undoBtn.disabled = true; redoBtn.disabled = true;
  const history = createHistory({ onChange(s) { undoBtn.disabled = !s.canUndo; redoBtn.disabled = !s.canRedo; } });

  // format switcher
  const fmtLabel = h('span.fmt-label', { 'data-testid': 'layout-format' });
  const fmtBtns = FORMAT_NAMES.map((name) => {
    const b = h('button.btn.small.toggle', { type: 'button', 'data-testid': `format-${name}`, 'data-format': name }, FORMAT_LABEL[name]);
    b.addEventListener('click', () => setFormat(name));
    return b;
  });
  const proposalBar = h('div.proposal-bar', { hidden: true, 'data-testid': 'proposal-bar' });
  const frameLabel = h('div.frame-label', { hidden: true, 'data-testid': 'proposal-label' }, 'Proposal');

  const position = h('span.timecode', { 'data-testid': 'tl-position' });
  const audioStatus = h('span.badge.warn', { hidden: true, role: 'status', 'data-testid': 'audio-status' }, 'Mixing audio');
  const showPosition = (t) => { position.textContent = `frame ${Math.round(t * draft.fps)} of ${Math.round(draft.duration * draft.fps)} · ${draft.fps} fps`; };

  let rafSync = 0, lastStored = 0;
  const stage = createStage({
    guides: true, compact: true,
    onState(playing) { if (!playing) applyAudio(); },
    onTime(t) {
      timeline.setTime(t, stage.pv.playing);
      showPosition(t);
      cancelAnimationFrame(rafSync);
      rafSync = requestAnimationFrame(() => { handles.redraw(); syncInspector(); drawLayers(); });
      if (performance.now() - lastStored > 1000) remember();
    },
  });
  ctx.onCleanup(() => { cancelAnimationFrame(rafSync); stage.destroy(); });
  stage.frame.append(frameLabel);
  const time = () => stage.pv.time;

  const timeline = createTimeline({
    onSeek(t) { stage.pv.pause(); stage.pv.seek(t); },
    onSelect(ids, primary, trackId) { select(ids, primary, trackId, 'timeline'); },
    onBegin(key) { if (busy) return false; history.checkpoint(draft, key); return true; },
    onChange(itemId, patch, done) {
      if (sel.primary === itemId) syncTiming();
      live({ timeline: false });
      if (done) { history.seal(); drawLayers(); }
    },
    onMoveItem(itemId, trackId) {
      const f = findItem(itemId), to = draft.tracks.find((t) => t.id === trackId);
      if (!f || !to) return;
      f.track.items.splice(f.track.items.indexOf(f.item), 1);
      to.items.push(f.item);
      history.seal();
      sel.track = trackId;
      live();
      drawInspector();
    },
    onSelectMarker(i) { selectMarker(i); },
    onMoveMarker(i, t, done) {
      if (selMarker !== i) selectMarker(i);
      live({ timeline: false, inspector: 'none' });
      const m = draft.markers[i];
      const box = inspector.querySelector('[data-testid=marker-t]');
      if (box && m && document.activeElement !== box) box.value = String(m.t);
      if (done) {
        history.seal();
        draft.markers.sort(byTime);
        selMarker = draft.markers.indexOf(m);
        timeline.refresh();
        timeline.setSelectedMarker(selMarker);
      }
    },
    onTrack(trackId, patch) {
      if (busy) return;
      edit(`track:${trackId}:${Object.keys(patch).join()}`, (c) => {
        const t = c.tracks.find((x) => x.id === trackId);
        if (!t) return;
        for (const [k, v] of Object.entries(patch)) { if (k === 'name') t.name = v; else if (v) t[k] = true; else delete t[k]; }
      }, { inspector: 'redraw' });
    },
    onReorderTracks(ids) {
      edit('tracks-order', (c) => { c.tracks = ids.map((id) => c.tracks.find((t) => t.id === id)).filter(Boolean); });
    },
    onAddTrack(type) {
      if (busy) return;
      let id = type, n = 1;
      while (draft.tracks.some((t) => t.id === id)) id = `${type}-${++n}`;
      edit('track-add', (c) => { c.tracks.push({ id, name: `${type[0].toUpperCase()}${type.slice(1)} ${n}`, type, items: [] }); });
      select([], null, id);
    },
    async onDeleteTrack(trackId) {
      const t = draft.tracks.find((x) => x.id === trackId);
      if (!t || t.locked || busy) return;
      if (t.items.length && !(await confirmDialog(`Delete the track "${t.name ?? t.id}" and its ${plural(t.items.length, 'item')}?`, { ok: 'Delete', title: 'Delete track' }))) return;
      if (busy) return;
      edit('track-del', (c) => { c.tracks = c.tracks.filter((x) => x.id !== trackId); });
      select(sel.ids.filter((id) => findItem(id)), null, null);
    },
    keyframesOf: (item) => keyMarks(item, fmt),
  });
  ctx.onCleanup(() => timeline.destroy());
  ctx.setGuard(() => (dirty ? 'This clip has unsaved changes. Leave without saving?' : null));

  const findItem = (id, comp = draft) => {
    for (const track of comp.tracks) { const item = track.items.find((i) => i.id === id); if (item) return { track, item }; }
    return null;
  };
  const allIds = () => new Set(draft.tracks.flatMap((t) => t.items.map((i) => i.id)));
  const freeId = (base, taken = allIds()) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; };
  const formatSize = (name) => status.formats[name] ?? { width: draft.width, height: draft.height };
  /** The composition as the preview draws it: the draft in the format being laid out. */
  const viewOf = (comp) => (fmt === comp.format || !status.formats[fmt] ? comp : { ...comp, format: fmt, width: formatSize(fmt).width, height: formatSize(fmt).height });
  const viewSize = () => { const v = viewOf(draft); return { width: v.width, height: v.height }; };
  const seekTo = (t) => { stage.pv.pause(); stage.pv.seek(clamp(t, 0, draft.duration)); };

  // overlays are drawn in an SVG layer over the canvas, never into its pixels; the text boxes need the worker to measure
  const overlays = createOverlays({ host: stage.frame, size: viewSize, safeMode: () => draft.safe, onText: (on) => stage.pv.setRecord(on) });
  stage.pv.onTexts = (texts) => overlays.setTexts(texts);
  overlays.setZones(zones);
  ctx.onCleanup(() => overlays.destroy());

  const issues = mountIssues({ slug, getComposition: () => draft, onSeek: seekTo, onPick(id) { if (id && findItem(id)) select([id], id); } });

  // ── on-canvas handles ────────────────────────────────────────────────────────────────────
  /** Visual items drawn at the playhead, front to back. */
  function activeLayers() {
    const t = time();
    const solo = draft.tracks.some((tr) => tr.type !== 'audio' && tr.solo);
    const out = [];
    for (const track of draft.tracks) {
      if (track.type === 'audio' || track.hidden || (solo && !track.solo)) continue;
      for (const item of track.items) {
        if (!(t >= item.start - 1e-6 && t < item.start + item.duration - 1e-6) || forFormat(item, fmt).hidden) continue;
        out.push({ id: item.id, item, track, transform: sampled(item, fmt, itemTime(item, t)).transform, editable: !track.locked });
      }
    }
    return out.reverse();
  }
  const handles = createCanvasHandles({
    host: stage.frame,
    size: viewSize,
    layers: activeLayers,
    selection: () => ({ ids: new Set(sel.ids), primary: sel.primary }),
    onSelect(id, additive) {
      if (!id) { select([], null, sel.track, 'canvas'); return; }
      if (additive) {
        const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
        select(ids, ids.includes(id) ? id : ids[ids.length - 1] ?? null, undefined, 'canvas');
      } else select([id], id, undefined, 'canvas');
    },
    onTransform(id, patch, { begin, done }) {
      const f = findItem(id);
      if (!f || f.track.locked) return;
      if (busy) return false;
      if (begin) history.checkpoint(draft, `canvas:${id}:${performance.now()}`);
      const lt = itemTime(f.item, time());
      for (const [k, v] of Object.entries(patch)) setProp(f.item, fmt, draft.format, k, v, lt);
      live({ timeline: done, handles: false });
      if (done) history.seal();
    },
  });
  ctx.onCleanup(() => handles.destroy());

  // ── state changes ────────────────────────────────────────────────────────────────────────
  function setDirty(on) { dirty = on; unsaved.hidden = !on; if (on) saved.hidden = true; saveBtn.disabled = !on || busy; }
  /** The server is working on the draft and its answer replaces it: no edits meanwhile, and news of other revisions waits. */
  function setBusy(on) {
    busy = on;
    saveBtn.disabled = !dirty || on; renderBtn.disabled = on; remixBtn.disabled = on; addBtn.disabled = on;
    inspector.inert = on;
    if (!on && pendingRevision > clip.revision) onRevision(pendingRevision);
  }

  /** The draft changed and the loaded bundle can draw it: show it everywhere. */
  function live({ timeline: tl = true, handles: hd = true, inspector: insp = 'sync' } = {}) {
    setDirty(true);
    issues.markStale();
    refreshMeta();
    if (audioSig(draft) !== lastAudioSig) { lastAudioSig = audioSig(draft); refreshAudio(); }
    if (!showProposal) stage.pv.setComposition(viewOf(draft));
    if (tl) timeline.refresh();
    if (hd) handles.redraw();
    if (insp === 'redraw') drawInspector(); else if (insp === 'sync') syncInspector();
    drawLayers();
  }

  /**
   * One edit of the draft: a checkpoint for undo, the change, then either a live redraw or (when
   * the edit needs assets the bundle does not have) a round trip to the server for a new bundle.
   * Each edit is its own undo step; with `burst` (a drag, typing in one field) the edits that
   * follow under the same key share one.
   */
  function edit(key, mutate, { structural = false, inspector: insp = 'sync', burst = false } = {}) {
    if (showProposal || busy) return;
    const before = JSON.stringify(draft);
    const took = history.checkpoint(draft, burst ? key : null);
    mutate(draft);
    if (JSON.stringify(draft) === before) { if (took) history.discard(); return; }
    if (structural || needsBundle(draft)) {
      // the server may refuse: the draft and the timeline stay as they were until it answers
      const next = draft;
      draft = JSON.parse(before);
      timeline.setData({ composition: draft, beats });
      rebundle(next).then((ok) => { if (!ok && took) history.discard(); });
      return;
    }
    live({ inspector: insp });
  }
  /** An inspector edit of the item it shows. */
  const commitItem = (id) => (key, fn, o = {}) => edit(key, (c) => { const f = findItem(id, c); if (f && !f.track.locked) fn(f.item); }, o);

  function needsBundle(comp) {
    for (const r of refsOf(comp)) if (!bundled.has(r) || !/@\d+$/.test(r)) return true;
    return needsEasing(comp);
  }

  /** Replace the whole draft (undo, redo): bundle again only if its assets changed. */
  async function replaceDraft(next) {
    if (needsBundle(next)) { await rebundle(next); return; }
    draft = next;
    selectionStillThere();
    timeline.setData({ composition: draft, beats });
    live({ inspector: 'redraw' });
  }

  function selectionStillThere() {
    const ids = sel.ids.filter((id) => findItem(id));
    sel = { ids, primary: ids.includes(sel.primary) ? sel.primary : ids[ids.length - 1] ?? null, track: draft.tracks.some((t) => t.id === sel.track) ? sel.track : null };
    timeline.setSelected(sel.ids, sel.primary, sel.track);
    if (selMarker !== null && !draft.markers?.[selMarker]) { selMarker = null; timeline.setSelectedMarker(null); }
    updateTools();
  }

  function select(ids, primary, trackId, from) {
    if (selMarker !== null) { selMarker = null; timeline.setSelectedMarker(null); }
    sel = { ids: [...ids], primary, track: trackId === undefined ? (primary ? findItem(primary)?.track.id ?? sel.track : sel.track) : trackId };
    if (from !== 'timeline') timeline.setSelected(sel.ids, sel.primary, sel.track);
    handles.redraw();
    drawLayers();
    drawInspector();
    updateTools();
  }

  function updateTools() {
    const any = sel.ids.length > 0;
    for (const b of [copyBtn, dupBtn, splitBtn]) b.disabled = !any || showProposal;
    pasteBtn.disabled = !clipboard.length || showProposal;
    assetBtn.disabled = !visualSelected() || showProposal;
  }

  function drawMeta() {
    fill(meta,
      h('span.ref', clip.slug), ' · ', status.formats[draft.format]?.label ?? 'Custom size', ` · ${draft.width}×${draft.height} · ${fmtDuration(draft.duration)} · ${draft.fps} fps · `,
      h('span', { 'data-testid': 'revision' }, `revision ${clip.revision}`),
      clip.remixedFrom ? [' · remix of ', h('a', { href: `/clips/${clip.remixedFrom}` }, clip.remixedFrom)] : null);
  }

  function drawFormat() {
    const override = fmt !== draft.format;
    fill(fmtLabel, `Laying out: ${FORMAT_LABEL[fmt] ?? 'Custom'}`, override ? h('span.fmt-ovr', ' (override)') : null);
    for (const b of fmtBtns) { const on = b.dataset.format === fmt; b.dataset.active = String(on); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); }
  }

  async function setFormat(name) {
    if (name === fmt) return;
    fmt = name;
    drawFormat();
    const v = viewSize();
    stage.setSize(v.width, v.height);
    overlays.redraw();
    refreshMeta();
    if (showProposal && proposal) await showProposalView();
    else stage.pv.setComposition(viewOf(draft));
    timeline.refresh();
    handles.redraw();
    drawInspector();
  }

  async function showClip() {
    const v = viewSize();
    stage.setSize(v.width, v.height);
    overlays.redraw();
    stage.setDuration(draft.duration, draft.fps);
    // the saved clip's mix; edits to the draft make a new one (refreshAudio)
    audioToken++;
    if (pendingAudio) URL.revokeObjectURL(pendingAudio);
    pendingAudio = undefined;
    freeDraftAudio();
    lastAudioSig = audioSig(draft);
    audioUrl = audioItems(clip.composition) ? `/api/clips/${slug}/audio.wav?r=${clip.revision}` : null;
    await stage.show((pv) => pv.showClip({ composition: viewOf(draft), bundle, audioUrl }));
    timeline.setTime(stage.pv.time);
    handles.redraw();
    if (audioUrl) loadPeaks(audioUrl).then((p) => { if (ctx.alive() && p) timeline.setPeaks(p); });
    else timeline.setPeaks(null);
  }

  // ── the audio follows the draft ──────────────────────────────────────────────────────────
  let audioUrl = null, lastAudioSig = '', audioToken = 0, draftAudio = null, pendingAudio;
  function freeDraftAudio() { if (draftAudio) { URL.revokeObjectURL(draftAudio); draftAudio = null; } }
  /** Use a new mix for the preview: after the pause when it is playing (a swap would jump). */
  function applyAudio() {
    if (pendingAudio === undefined || stage.pv.playing) return;
    const url = pendingAudio;
    pendingAudio = undefined;
    const previous = draftAudio;
    stage.pv.setAudio(url);
    audioUrl = url;
    draftAudio = url;
    if (previous) URL.revokeObjectURL(previous);
    if (url) loadPeaks(url).then((p) => { if (ctx.alive() && url === audioUrl) timeline.setPeaks(p); });
    else timeline.setPeaks(null);
  }
  /** The mix of the draft, made by the studio (the same mixer the render uses). */
  const refreshAudio = debounce(async () => {
    if (showProposal) return;
    const token = ++audioToken;
    audioStatus.hidden = false;
    try {
      const url = audioItems(draft) ? URL.createObjectURL(await api.blob(`/api/clips/${slug}/audio`, { composition: draft })) : null;
      if (token !== audioToken || !ctx.alive()) { if (url) URL.revokeObjectURL(url); return; }
      if (pendingAudio) URL.revokeObjectURL(pendingAudio);
      pendingAudio = url;
      applyAudio();
    } catch (e) {
      if (token === audioToken) msg.show(`The audio of the draft could not be mixed: ${e.message}`, 'info');
    } finally {
      if (token === audioToken) audioStatus.hidden = true;
    }
  }, 700);
  ctx.onCleanup(() => { audioToken++; refreshAudio.cancel(); refreshMeta.cancel(); if (pendingAudio) URL.revokeObjectURL(pendingAudio); freeDraftAudio(); });

  // ── what the studio measures about the draft: words, caption pages, anchors, zones ───────
  let metaToken = 0;
  const refreshMeta = debounce(async () => {
    if (busy || showProposal) return;
    const token = ++metaToken;
    try {
      const r = await api.post(`/api/clips/${slug}/bundle`, { composition: viewOf(draft) });
      if (ctx.alive() && token === metaToken && !busy) applyMeta(r);
    } catch { /* the draft may not be valid yet: keep what is shown */ }
  }, 600);

  /** Anchored starts the studio resolved: an item that sat on its word follows it when the word moves; a marker on a word always does. */
  function follow(pinned) {
    let moved = false;
    for (const track of pinned.tracks) for (const p of track.items) {
      if (!p.anchor) { resolved.delete(p.id); continue; }
      const f = findItem(p.id);
      const was = resolved.get(p.id);
      if (f?.item.anchor && was !== undefined && Math.abs(f.item.start - was) < 1e-3 && Math.abs(p.start - was) > 1e-3) { f.item.start = p.start; f.item.duration = p.duration; moved = true; }
      resolved.set(p.id, p.start);
    }
    for (const m of draft.markers ?? []) {
      if (!m.anchor) continue;
      const p = pinned.markers?.find((x) => JSON.stringify(x.anchor) === JSON.stringify(m.anchor) && x.label === m.label);
      if (p && Math.abs(p.t - m.t) > 1e-3) { m.t = p.t; moved = true; }
    }
    if (moved) {
      const m = selMarker === null ? null : draft.markers[selMarker];
      draft.markers?.sort(byTime);
      if (m) selMarker = draft.markers.indexOf(m);
    }
    return moved;
  }

  function applyMeta(r) {
    // the bundle's captions and lane depend on the viewed format too (line length, platform zones), not only on the words
    const sig = (b, w) => JSON.stringify([w ?? [], b?.captions ?? null, b?.lane ?? null]);
    const same = sig(r.bundle, r.words) === sig(bundle, words);
    words = r.words ?? []; captionPages = r.captions ?? null; anchors = r.anchors ?? []; zones = r.zones ?? null;
    overlays.setZones(zones);
    const moved = follow(r.composition);
    timeline.setMeta({ words, anchors, base: r.composition });
    timeline.setSelectedMarker(selMarker);
    if (moved && !showProposal) { stage.pv.setComposition(viewOf(draft)); handles.redraw(); drawLayers(); }
    // the captions the preview draws come from the bundle: a narration that changed needs the new one
    if (!same && !showProposal) { bundle = r.bundle; stage.pv.showClip({ composition: viewOf(draft), bundle, audioUrl }); }
    if (!inspector.contains(document.activeElement)) drawInspector();
  }

  /** Take a pinned composition, its bundle and asset facts from the server. */
  function adopt(r) {
    draft = clone(r.composition);
    bundle = r.bundle; beats = r.beats; info = r.assets;
    words = r.words ?? []; captionPages = r.captions ?? null; anchors = r.anchors ?? []; zones = r.zones ?? null;
    overlays.setZones(zones);
    resolved.clear();
    for (const track of draft.tracks) for (const item of track.items) if (item.anchor) resolved.set(item.id, item.start);
    bundled = refsOf(draft);
    if (!FORMAT_NAMES.includes(fmt)) fmt = draft.format;
    selectionStillThere();
    timeline.setData({ composition: draft, beats, words, anchors });
  }

  /** The set of assets changed: have the server pin and bundle `next`, then show it. */
  async function rebundle(next, select2) {
    msg.hide();
    setBusy(true);
    try {
      const r = await api.post(`/api/clips/${slug}/bundle`, { composition: next });
      if (!ctx.alive()) return false;
      if (select2 !== undefined) sel = { ids: [select2], primary: select2, track: sel.track };
      adopt(r);
      setDirty(true);
      await showClip();
      drawInspector(); drawLayers();
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
    saveError = '';
    setBusy(true);
    try {
      const r = await api.put(`/api/clips/${slug}`, { composition: draft, revision: clip.revision });
      if (!ctx.alive()) return false;
      clip = r;
      adopt(r);
      setDirty(false);
      drawMeta(); drawAssets(); drawInspector(); drawLayers();
      await showClip();
      saved.textContent = `Saved as revision ${clip.revision}`;
      saved.hidden = false;
      hideChanged();
      return true;
    } catch (e) {
      saveError = e.message;
      if (e.status === 409) showChanged(pendingRevision || clip.revision + 1, e.message);
      else msg.show(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Load the saved clip again (after a change elsewhere, an accepted proposal, or layers replaced by an asset) → did it load. */
  async function reload() {
    setBusy(true);
    try {
      const r = await api.get(`/api/clips/${slug}`);
      if (!ctx.alive()) return false;
      clip = r;
      adopt(r);
      history.clear();
      setDirty(false);
      saved.hidden = true;
      hideChanged();
      drawMeta(); drawAssets(); drawInspector(); drawLayers(); drawFormat();
      await showClip();
      return true;
    } catch (e) {
      msg.show(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ── changes made elsewhere (live) ────────────────────────────────────────────────────────
  function showChanged(revision, detail) {
    const reloadBtn = h('button.btn.small', { type: 'button', 'data-testid': 'clip-reload' }, 'Reload');
    const keepBtn = h('button.btn.small', { type: 'button', 'data-testid': 'clip-keep' }, 'Keep mine');
    reloadBtn.addEventListener('click', () => { if (!busy) reload(); });
    keepBtn.addEventListener('click', () => { keptRevision = revision; clip.revision = Math.max(clip.revision, revision); drawMeta(); hideChanged(); });
    fill(changedBanner, h('span', `This clip was changed elsewhere (revision ${revision}).`, detail ? h('span.muted', ` ${detail}`) : null), h('span.row', reloadBtn, keepBtn));
    changedBanner.hidden = false;
  }
  function hideChanged() { changedBanner.hidden = true; changedBanner.replaceChildren(); }
  function onRevision(revision) {
    if (revision <= clip.revision || revision <= keptRevision) return;
    // a save, bundle or reload is in flight: look again when it is back (setBusy)
    if (busy) { pendingRevision = Math.max(pendingRevision, revision); return; }
    pendingRevision = 0;
    if (!dirty) reload(); else showChanged(revision);
  }
  ctx.onCleanup(liveEvents.on('clip', (e) => {
    if (e.key === slug && Number(e.data?.revision) > 0) onRevision(Number(e.data.revision));
  }));

  // ── the open clip, for the library's "add to the open clip" ──────────────────────────────
  function remember() {
    lastStored = performance.now();
    try { localStorage.setItem(OPEN_CLIP_KEY, JSON.stringify({ slug, at: round(time()) })); } catch { /* storage may be unavailable */ }
  }

  // ── markers ──────────────────────────────────────────────────────────────────────────────
  const markerType = h('select.small', { 'data-testid': 'add-marker-type', 'aria-label': 'Type of the new marker' }, MARKER_TYPES.map((t) => h('option', { value: t }, t)));
  markerType.value = 'note';
  const markerBtn = h('button.btn.small.ed-tool', { type: 'button', 'data-testid': 'add-marker', title: 'Add a marker at the playhead (M)' }, icon('plus', 14), h('span.ed-tool-label', 'Add marker'));

  function selectMarker(i) {
    selMarker = i;
    sel = { ids: [], primary: null, track: sel.track };
    timeline.setSelected([], null, sel.track);
    timeline.setSelectedMarker(i);
    handles.redraw();
    drawLayers();
    drawInspector();
    updateTools();
  }

  function addMarker(type = 'note') {
    if (busy || showProposal) return;
    let made = null;
    if (type === 'word' && !words.length) { msg.show('There are no narration words to put a word marker on.', 'info'); return; }
    edit('marker-add', (c) => {
      made = { t: round(clamp(time(), 0, c.duration)), label: '' };
      if (type !== 'note') made.type = type;
      if (type === 'hold') made.duration = 1;
      if (type === 'word') {
        // on the word nearest to the playhead
        const w = words.reduce((best, x) => (!best || Math.abs(x.start - made.t) < Math.abs(best.start - made.t) ? x : best), null);
        made.anchor = { item: w.item, word: w.i };
        made.t = round(w.start);
      }
      (c.markers ??= []).push(made);
      c.markers.sort(byTime);
    }, { inspector: 'none' });
    if (made && draft.markers?.includes(made)) selectMarker(draft.markers.indexOf(made));
  }
  markerBtn.addEventListener('click', () => addMarker(markerType.value));

  /** An edit of the marker the inspector shows (the list stays sorted by time). */
  function commitMarker(key, fn, o = {}) {
    edit(key, (c) => {
      const m = c.markers?.[selMarker];
      if (!m) return;
      fn(m);
      c.markers.sort(byTime);
      selMarker = c.markers.indexOf(m);
    }, o);
    timeline.setSelectedMarker(selMarker);
  }

  function removeMarker() {
    if (selMarker === null || busy) return;
    edit('marker-del', (c) => { c.markers.splice(selMarker, 1); if (!c.markers.length) delete c.markers; }, { inspector: 'none' });
    select([], null, sel.track);
  }

  // ── toolbar actions ──────────────────────────────────────────────────────────────────────
  async function undo() { if (busy) return; const prev = history.undo(draft); if (prev) await replaceDraft(prev); }
  async function redo() { if (busy) return; const next = history.redo(draft); if (next) await replaceDraft(next); }
  const editable = (id) => { const f = findItem(id); return f && !f.track.locked ? f : null; };
  const visualSelected = () => sel.ids.some((id) => { const f = findItem(id); return !!f && f.track.type !== 'audio'; });

  function copy() {
    clipboard = sel.ids.map((id) => findItem(id)).filter(Boolean).map((f) => ({ track: f.track.id, type: f.track.type, item: clone(f.item) }));
    updateTools();
    if (clipboard.length) msg.show(`Copied ${plural(clipboard.length, 'item')}.`, 'ok');
  }

  function paste() {
    if (!clipboard.length || busy) return;
    const t0 = Math.min(...clipboard.map((c) => c.item.start));
    const at = time();
    const taken = allIds();
    const added = [];
    edit('paste', (c) => {
      for (const entry of clipboard) {
        const ok = (t) => t && !t.locked && (t.type === 'audio') === (entry.type === 'audio');
        let track = c.tracks.find((t) => t.id === entry.track);
        if (!ok(track)) track = c.tracks.find((t) => t.id === sel.track && ok(t)) ?? c.tracks.find(ok);
        if (!track) { track = { id: freeId(entry.type === 'audio' ? 'audio' : 'visual', new Set(c.tracks.map((t) => t.id))), type: entry.type, items: [] }; c.tracks.push(track); }
        const item = clone(entry.item);
        item.id = freeId(`${entry.item.id}-copy`, taken);
        item.duration = round(Math.min(item.duration, c.duration));
        item.start = round(clamp(at + item.start - t0, 0, c.duration - item.duration));
        track.items.push(item);
        added.push(item.id);
      }
    }, { inspector: 'none' });
    select(added, added[added.length - 1] ?? null);
  }

  function duplicate() {
    if (busy) return;
    const taken = allIds();
    const added = [];
    edit('duplicate', (c) => {
      for (const id of sel.ids) {
        const f = findItem(id, c);
        if (!f || f.track.locked) continue;
        const copyItem = { ...clone(f.item), id: freeId(`${id}-copy`, taken) };
        const after = round(f.item.start + f.item.duration);
        if (after + f.item.duration <= c.duration + 1e-6) copyItem.start = after;
        f.track.items.splice(f.track.items.indexOf(f.item) + 1, 0, copyItem);
        added.push(copyItem.id);
      }
    }, { inspector: 'none' });
    if (added.length) select(added, added[added.length - 1]);
  }

  function removeSelected() {
    const ids = sel.ids.filter((id) => editable(id));
    if (!ids.length || busy) return;
    edit('delete', (c) => { for (const id of ids) { const f = findItem(id, c); if (f) f.track.items.splice(f.track.items.indexOf(f.item), 1); } }, { inspector: 'none' });
    select([], null, sel.track);
  }

  /**
   * Split at the playhead exactly like the server's split_item: the second part continues the asset
   * (same offset timeline, the first part's seed, so random-driven assets carry on across the cut)
   * and does not transition in again.
   */
  function split() {
    if (busy) return;
    const at = round(time());
    const targets = sel.ids.map((id) => editable(id)).filter((f) => f && at > f.item.start + 1e-6 && at < f.item.start + f.item.duration - 1e-6);
    if (!targets.length) { msg.show(sel.ids.length ? 'The playhead is not inside the selected items.' : 'Select an item under the playhead to split it.', 'info'); return; }
    msg.hide();
    const taken = allIds();
    const seconds = [];
    edit('split', (c) => {
      for (const { item: orig } of targets) {
        const f = findItem(orig.id, c);
        const it = f.item;
        const offset = it.offset ?? 0;
        const whole = it.assetDuration ?? offset + it.duration;
        const cut = round(at - it.start);
        const second = { ...clone(it), id: freeId(`${it.id}-b`, taken), start: at, duration: round(it.duration - cut), offset: round(offset + cut), assetDuration: whole, seedId: it.seedId ?? it.id };
        delete second.fadeIn;
        delete second.transition;
        Object.assign(it, { duration: cut, assetDuration: whole });
        delete it.fadeOut;
        f.track.items.splice(f.track.items.indexOf(it) + 1, 0, second);
        seconds.push(second.id);
      }
    }, { inspector: 'none' });
    select(seconds, seconds[seconds.length - 1]);
  }

  /** Save the selected layers as one asset (a precomp), and optionally put it in their place. */
  function precompDialog() {
    if (busy || showProposal || !visualSelected() || document.querySelector('dialog[open]')) return;
    const ids = [...sel.ids];
    const name = h('input', { type: 'text', id: 'pc-name', value: `${slug}-${ids[0]}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, ''), 'data-testid': 'precomp-name', autocomplete: 'off', spellcheck: false });
    const title = h('input', { type: 'text', id: 'pc-title', value: `${clip.title}: ${plural(ids.length, 'layer')}`, 'data-testid': 'precomp-title', autocomplete: 'off' });
    const replace = h('input', { type: 'checkbox', id: 'pc-replace', 'data-testid': 'precomp-replace', role: 'switch' });
    const err = notice('precomp-error');
    const go = h('button.btn.primary', { type: 'submit', 'data-testid': 'precomp-save' }, 'Save');
    const cancel = h('button.btn', { type: 'button', 'data-testid': 'precomp-cancel' }, 'Cancel');
    const form = h('form.form', { novalidate: true },
      h('p.muted', 'The selected layers become one asset in the library, with their timing, layout and attachments.'),
      dirty ? h('p.notice.info', { 'data-testid': 'precomp-unsaved' }, 'This clip has unsaved changes. They are saved first.') : null,
      h('div.field', h('label', { for: 'pc-name' }, 'Name'), name, h('p.hint', 'Lowercase letters, digits and dashes.')),
      h('div.field', h('label', { for: 'pc-title' }, 'Title'), title),
      h('div.field', h('label', { id: 'pc-items' }, plural(ids.length, 'layer')),
        h('ul.multi-list', { 'data-testid': 'precomp-items', 'aria-labelledby': 'pc-items' }, ids.map((id) => h('li.ref', id, findItem(id)?.track.type === 'audio' ? ' (audio)' : null)))),
      h('div.field.inline', h('label', { for: 'pc-replace' }, 'Replace the selected layers with it'), h('label.switch', replace, h('span.switch-track', { 'aria-hidden': 'true' })),
        h('p.hint', 'Saves the clip as a new revision. Undo starts again from there.')),
      err.el,
      h('div.dialog-foot.inline', cancel, go));
    const d = openDialog({ title: 'Save as asset', body: form, testid: 'precomp-dialog' });
    cancel.addEventListener('click', () => d.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hide();
      const newSlug = name.value.trim();
      if (!SLUG.test(newSlug)) { err.show('The name needs 2 to 64 lowercase letters, digits or dashes.'); name.focus(); return; }
      if (replace.checked) {
        // the new item takes the asset's name as its id, and only unlocked layers can be taken out
        const locked = ids.find((id) => findItem(id)?.track.locked);
        if (locked) { err.show(`"${locked}" is on a locked track. Unlock it to replace the layers.`); return; }
        if (findItem(newSlug) && !ids.includes(newSlug)) { err.show(`An item named "${newSlug}" is already on the timeline. Pick another name.`); name.focus(); return; }
      }
      if (busy) return;
      go.disabled = true;
      try {
        // the server reads the saved clip: save first, as Render does
        if (dirty && !(await save())) throw new Error(`The clip could not be saved first. ${saveError}`);
        setBusy(true);
        const r = await api.post(`/api/clips/${slug}/precomp`, { items: ids, name: newSlug, title: title.value.trim() || undefined, replace: replace.checked });
        d.close();
        if (!ctx.alive()) return;
        // replaced: the server saved a new revision, so load it (and start undo again) like any reload
        if (r.clip && !(await reload())) return;
        if (r.clip && findItem(newSlug)) select([newSlug], newSlug);
        msg.show('', 'ok');
        fill(msg.el, h('span', { 'data-testid': 'precomp-status' }, r.clip ? 'Saved and placed in the clip: ' : 'Saved to the library: ', h('a', { href: `/assets/${r.asset.slug}`, 'data-testid': 'precomp-link' }, r.asset.ref)));
        // on a phone the toolbar is a screen or two below the message: bring the link into view
        const at = msg.el.getBoundingClientRect();
        if (at.top < 0 || at.bottom > window.innerHeight) msg.el.scrollIntoView({ block: 'center' });
      } catch (e2) {
        err.show(e2.message);
        go.disabled = false;
      } finally {
        setBusy(false);
      }
    });
    name.focus();
    name.select();
  }

  function shortcutsSheet() {
    if (document.querySelector('dialog[open]')) return;
    openDialog({ title: 'Keyboard shortcuts', testid: 'shortcuts-sheet', body: h('dl.shortcut-list', SHORTCUTS.map(([k, what]) => [h('dt', h('kbd', k)), h('dd', what)])) });
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  splitBtn.addEventListener('click', split);
  copyBtn.addEventListener('click', copy);
  pasteBtn.addEventListener('click', paste);
  dupBtn.addEventListener('click', duplicate);
  assetBtn.addEventListener('click', precompDialog);
  keysBtn.addEventListener('click', shortcutsSheet);

  const onKey = (e) => {
    if (e.defaultPrevented || document.querySelector('dialog[open]') || isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 'c') { if (sel.ids.length && !getSelection()?.toString()) { e.preventDefault(); copy(); } }
    else if (mod && k === 'v') { if (clipboard.length) { e.preventDefault(); paste(); } }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
    else if (mod || e.altKey) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.ids.length) { e.preventDefault(); removeSelected(); } else if (selMarker !== null) { e.preventDefault(); removeMarker(); } }
    else if (k === 's') { e.preventDefault(); split(); }
    else if (k === 'm') { e.preventDefault(); addMarker('note'); }
    else if (e.key === '?') { e.preventDefault(); shortcutsSheet(); }
    else if (e.key === 'Escape' && (sel.ids.length || selMarker !== null)) { select([], null, sel.track); }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

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
    if (!picked || !ctx.alive() || busy) return;
    const next = clone(draft);
    const audio = picked.kind === 'audio';
    const fits = (t) => (t.type === 'audio') === audio && !t.locked;
    let track = next.tracks.find((t) => t.id === sel.track && fits(t)) ?? (audio ? next.tracks.find(fits) : [...next.tracks].reverse().find(fits));
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
    const start = round(clamp(Math.round(time() / 0.05) * 0.05, 0, next.duration - duration));
    track.items.push({ id, asset: picked.ref, start, duration, params: {} });
    sel.track = track.id;
    history.checkpoint(draft);
    if (!(await rebundle(next, id))) history.discard();
    else timeline.setSelected([id], id, track.id);
  });

  // ── layers view ──────────────────────────────────────────────────────────────────────────
  let layersKey = '';
  function drawLayers(force = false) {
    const list = activeLayers();
    const key = JSON.stringify([list.map((l) => [l.id, l.editable, l.track.name]), sel.ids, sel.primary, info && Object.keys(info).length]);
    if (!force && key === layersKey) return;
    layersKey = key;
    layersPanel.querySelector('[data-testid=layers-count]').textContent = plural(list.length, 'layer');
    fill(layersList, list.length ? list.map((L, i) => {
      const a = info[L.item.asset];
      const row = h(`li.layer-row${sel.ids.includes(L.id) ? '.selected' : ''}${L.editable ? '' : '.locked'}`, { 'data-testid': 'layer-row', 'data-id': L.id, tabIndex: 0, role: 'button', 'aria-pressed': String(sel.ids.includes(L.id)), 'aria-label': `${L.item.label ?? a?.title ?? L.item.asset}, layer ${i + 1} from the front` },
        h('span.layer-grip', { 'aria-hidden': 'true' }, '⋮⋮'),
        h('span.layer-thumb', a?.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '', loading: 'lazy' }) : null),
        h('span.layer-text', h('b', L.item.label ?? a?.title ?? splitRef(L.item.asset).slug), h('span.ref', `${L.id} · ${L.track.name ?? L.track.id}`)));
      row.addEventListener('pointerdown', (e) => layerDrag(e, L, row, list));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select([L.id], L.id); }
        else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const j = i + (e.key === 'ArrowUp' ? -1 : 1);
          if (list[j]) moveLayer(L.id, list[j].id, e.key === 'ArrowUp');
        }
      });
      return row;
    }) : h('li.muted.layers-empty', 'Nothing is drawn at the playhead.'));
  }

  /** Put layer `id` just in front of (or behind) layer `target`: same track or the target's. */
  function moveLayer(id, target, front) {
    const a = findItem(id), b = findItem(target);
    if (!a || !b || a.track.locked || b.track.locked) return;
    edit('layers', (c) => {
      const A = findItem(id, c), B = findItem(target, c);
      A.track.items.splice(A.track.items.indexOf(A.item), 1);
      const idx = B.track.items.indexOf(B.item);
      B.track.items.splice(front ? idx + 1 : idx, 0, A.item);
    });
    drawLayers(true);
    requestAnimationFrame(() => layersList.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus());
  }

  function layerDrag(e, L, row, list) {
    if (e.button !== undefined && e.button > 0) return;
    const y0 = e.clientY;
    let moved = false, over = null;
    const rowsEls = [...layersList.querySelectorAll('.layer-row')];
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      if (!L.editable) return;
      moved = true;
      row.classList.add('dragging');
      row.style.transform = `translateY(${ev.clientY - y0}px)`;
      over = null;
      for (const [i, r] of rowsEls.entries()) {
        const b = r.getBoundingClientRect();
        r.classList.remove('drop-above', 'drop-below');
        if (r !== row && ev.clientY >= b.top && ev.clientY < b.bottom) { over = { i, above: ev.clientY < b.top + b.height / 2 }; r.classList.add(over.above ? 'drop-above' : 'drop-below'); }
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      row.style.transform = '';
      for (const r of rowsEls) r.classList.remove('drop-above', 'drop-below');
      if (!moved) { select([L.id], L.id); return; }
      // the list runs front to back: dropping above a row puts the layer in front of it
      if (over) moveLayer(L.id, list[over.i].id, over.above);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ── inspector ────────────────────────────────────────────────────────────────────────────
  let timing = null;   // the inputs that mirror a drag on the timeline
  let sections = [];   // { sync() } of the sections on screen

  function syncTiming() {
    const found = sel.primary ? findItem(sel.primary) : null;
    if (!found || !timing) return;
    timing.start.value = String(found.item.start);
    timing.duration.value = String(found.item.duration);
  }
  function syncInspector() {
    for (const s of sections) s.sync();
    drawOverrideState();
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
    timing = null; sections = [];
    const end = Math.max(0.1, ...draft.tracks.flatMap((t) => t.items.map((i) => i.start + i.duration)));
    const duration = numField('Clip duration in seconds', 'clip-duration', draft.duration, { min: Math.ceil(end * 100) / 100, max: 120, step: 0.5 }, (v) => {
      if (v === draft.duration) return;
      edit('clip-duration', (c) => { c.duration = v; }, { inspector: 'none', burst: true });
      stage.setDuration(draft.duration, draft.fps);
      timeline.setData({ composition: draft, beats });
      drawMeta();
    });
    const bgId = nextId('f');
    const bg = h('input.mono', { type: 'text', id: bgId, value: draft.background ?? '#000000', 'data-testid': 'clip-background', spellcheck: false, autocomplete: 'off' });
    bg.addEventListener('input', () => {
      const ok = CSS.supports('color', bg.value.trim());
      bg.classList.toggle('invalid', !ok);
      if (ok) edit('clip-background', (c) => { c.background = bg.value.trim(); }, { inspector: 'none', burst: true });
    });
    fill(inspector,
      h('h2', 'Inspector'),
      h('p.muted', { 'data-testid': 'inspector-empty' }, draft.tracks.some((t) => t.items.length) ? 'Select an item on the timeline or on the preview to edit it.' : 'This clip is empty. Use "Add item" to place an asset at the playhead.'),
      h('h3', 'Clip'),
      duration.el,
      h('div.field', h('label', { for: bgId }, 'Background colour'), bg),
      h('h3', 'Loudness'), loudnessSection({ comp: () => draft, edit }).el,
      h('h3', 'Captions'), captionsSection({ comp: () => draft, pages: captionPages, edit }).el,
      h('h3', 'Platforms'), platformsSection({ comp: () => draft, edit }).el);
  }

  function drawMarker() {
    timing = null; sections = [];
    const m = draft.markers[selMarker];
    fill(inspector,
      h('div.panel-head', h('h2', 'Inspector'), h('span.ref', { 'data-testid': 'selected-id' }, `marker ${selMarker + 1} of ${draft.markers.length}`)),
      markerSection({ marker: m, words, duration: draft.duration, commit: commitMarker, seek: seekTo, remove: removeMarker }).el);
  }

  function drawMulti() {
    timing = null; sections = [];
    const del = h('button.btn.small.danger', { type: 'button', 'data-testid': 'delete-item' }, icon('trash', 14), 'Delete');
    del.addEventListener('click', removeSelected);
    fill(inspector,
      h('div.panel-head', h('h2', 'Inspector'), h('span.ref', { 'data-testid': 'selected-id' }, sel.primary)),
      h('p', { 'data-testid': 'selection-count' }, `${plural(sel.ids.length, 'item')} selected.`),
      h('ul.multi-list', sel.ids.map((id) => h('li.ref', id))),
      h('div.row', del),
      h('p.hint', 'Copy, paste, duplicate, split, delete and save as asset work on all of them. Shift or ⌘ click to change the selection.'));
  }

  let overrideState = null;   // the reset-override button and its label, while an item is shown
  function drawOverrideState() {
    if (!overrideState) return;
    const f = findItem(overrideState.id);
    const has = !!(f && fmt !== draft.format && f.item.formats?.[fmt]);
    overrideState.reset.hidden = !has;
  }

  const schemaCache = new Map();
  function schemaOf(ref) {
    if (info[ref]?.schema) return Promise.resolve(info[ref].schema);
    if (!schemaCache.has(ref)) {
      const { slug: s, version } = splitRef(ref);
      const p = api.get(`/api/assets/${s}${version ? `?version=${version}` : ''}`).then((a) => a.schema ?? {});
      p.catch(() => schemaCache.delete(ref));
      schemaCache.set(ref, p);
    }
    return schemaCache.get(ref);
  }
  const optionCache = new Map();
  function options(what) {
    if (!optionCache.has(what)) {
      const urls = what === 'mask' ? ['/api/assets?type=function&kind=visual&limit=100', '/api/assets?type=image&limit=100', '/api/assets?type=sequence&limit=100'] : [`/api/assets?type=function&kind=${what}&limit=100`];
      const p = Promise.all(urls.map((u) => api.get(u).catch(() => ({ assets: [] }))))
        .then((rs) => rs.flatMap((r) => r.assets.map((a) => ({ value: a.ref, label: `${a.title === a.slug ? a.slug : `${a.title} · ${a.slug}`} @${a.version}` }))));
      optionCache.set(what, p);
    }
    return optionCache.get(what);
  }

  function drawInspector() {
    overrideState = null;
    if (selMarker !== null && draft.markers?.[selMarker]) { drawMarker(); return; }
    if (sel.ids.length > 1) { drawMulti(); return; }
    const found = sel.primary ? findItem(sel.primary) : null;
    if (!found) { drawClipSettings(); return; }
    const { track, item } = found;
    const a = info[item.asset] ?? { slug: splitRef(item.asset).slug, version: splitRef(item.asset).version, latestVersion: splitRef(item.asset).version, schema: {}, title: item.asset, kind: track.type === 'audio' ? 'audio' : 'visual' };
    const audio = track.type === 'audio';
    const locked = !!track.locked;
    const commit = commitItem(item.id);

    const start = numField('Start', 'item-start', item.start, { min: 0, max: round(draft.duration - 0.1), step: 0.05 }, (v) => {
      const x = round(Math.min(v, draft.duration - item.duration));
      commit(`start:${item.id}`, (it) => { it.start = x; }, { inspector: 'none', burst: true });
      return x;
    });
    const duration = numField('Duration', 'item-duration', item.duration, { min: 0.1, max: draft.duration, step: 0.05 }, (v) => {
      const x = round(Math.min(v, draft.duration - item.start));
      commit(`duration:${item.id}`, (it) => { it.duration = x; if (it.assetDuration !== undefined && it.assetDuration < (it.offset ?? 0) + x) it.assetDuration = round((it.offset ?? 0) + x); }, { inspector: 'none', burst: true });
      return x;
    });
    timing = { start: start.input, duration: duration.input };
    const optional = (key, v, zero) => commit(`${key}:${item.id}`, (it) => { if (v === zero) delete it[key]; else it[key] = v; }, { inspector: 'none', burst: true });
    const fadeIn = numField('Fade in', 'item-fadein', item.fadeIn ?? 0, { min: 0, max: 10, step: 0.05 }, (v) => optional('fadeIn', v, 0));
    const fadeOut = numField('Fade out', 'item-fadeout', item.fadeOut ?? 0, { min: 0, max: 10, step: 0.05 }, (v) => optional('fadeOut', v, 0));
    const gain = audio ? numField('Gain', 'item-gain', item.gain ?? 1, { min: 0, max: 4, step: 0.05, slider: true }, (v) => commit(`gain:${item.id}`, (it) => { it.gain = v; }, { inspector: 'none', burst: true })) : null;

    const env = { item, fmt, own: draft.format, size: viewSize(), lt: () => itemTime(item, time()), t: time, commit, seek: seekTo, hasEasing: !!draft.easing };
    sections = [];
    const tf = audio ? null : transformSection(env);
    const kfs = audio ? null : keyframesSection(env);
    const params = paramsSection({ ...env, schema: a.schema, fonts, visual: !audio });
    const mix = audio ? audioSection({ ...env, tracks: draft.tracks.filter((t) => t.type === 'audio' && t.id !== track.id).map((t) => ({ id: t.id, name: t.name, role: t.role })) }) : null;
    const onWord = anchorSection({ item, words, report: anchors.find((x) => x.kind === 'item' && x.id === item.id), fps: draft.fps, duration: draft.duration, commit });
    for (const s of [tf, kfs, params, mix]) if (s) sections.push(s);

    const structural = hasRefParams(a.schema);
    const resetBtn = h('button.btn.small', { type: 'button', 'data-testid': 'reset-params' }, 'Reset');
    resetBtn.addEventListener('click', () => {
      commit(`reset:${item.id}`, (it) => { it.params = {}; for (const o of Object.values(it.formats ?? {})) delete o.params; prune(it); }, { structural, inspector: 'redraw' });
    });

    const behind = a.latestVersion > a.version;
    const upgrade = behind ? h('button.btn.small', { type: 'button', 'data-testid': 'upgrade' }, 'Upgrade') : null;
    upgrade?.addEventListener('click', () => commit('upgrade', (it) => { it.asset = `${a.slug}@${a.latestVersion}`; }, { structural: true }));
    const change = h('button.btn.small', { type: 'button', 'data-testid': 'change-asset' }, 'Change asset');
    change.addEventListener('click', async () => {
      const picked = await pickAsset({ title: 'Change the asset', kinds: [audio ? 'audio' : 'visual'] });
      if (!picked || !ctx.alive()) return;
      commit('change-asset', (it) => { it.asset = picked.ref; it.params = {}; }, { structural: true });
    });
    const del = h('button.btn.small.danger', { type: 'button', 'data-testid': 'delete-item' }, icon('trash', 14), 'Delete item');
    del.addEventListener('click', removeSelected);

    const reset = h('button.btn.small', { type: 'button', 'data-testid': 'reset-override', hidden: true, title: `Use the ${FORMAT_LABEL[draft.format]?.toLowerCase() ?? 'base'} layout in ${FORMAT_LABEL[fmt]?.toLowerCase()}` }, 'Reset override');
    reset.addEventListener('click', () => commit(`reset-override:${fmt}`, (it) => { if (it.formats) delete it.formats[fmt]; prune(it); }, { inspector: 'redraw' }));
    overrideState = { id: item.id, reset };

    const body = h('fieldset.ed-fields', { disabled: locked },
      h('h3', `Timing · ${track.name ?? track.id} track`),
      h('div.field-grid', start.el, duration.el, fadeIn.el, fadeOut.el),
      item.offset !== undefined ? h('p.hint', { 'data-testid': 'item-offset' }, `Starts ${fmtTime(item.offset)} into the asset${item.assetDuration ? ` (of ${fmtTime(item.assetDuration)})` : ''}.`) : null,
      gain?.el,
      onWord.el,
      mix?.el,
      tf ? [
        h('div.panel-head', h('h3', 'Layout ', h('span.muted', `· ${FORMAT_LABEL[fmt] ?? 'Custom'}${fmt !== draft.format ? ' (override)' : ''}`)), reset),
        tf.el,
        h('h3', 'Keyframes'), kfs.el,
      ] : null,
      h('div.panel-head', h('h3', 'Parameters'), Object.keys(a.schema ?? {}).length ? resetBtn : null),
      params.el,
      audio ? null : attachmentsSection({ item, readOnly: locked, fonts, schemaOf, options, pick: pickAsset, commit }));

    fill(inspector,
      h('div.panel-head', h('h2', 'Inspector'), h('span.ref', { 'data-testid': 'selected-id' }, item.id)),
      h('div.inspector-asset',
        h('a.asset-link', { href: assetHref(item.asset), 'data-testid': 'item-asset' },
          a.thumb ? h('img', { src: `/media/${a.thumb}`, alt: '' }) : null,
          h('span', h('b', a.title), h('span.ref', item.asset))),
        h('p.version-state', { 'data-testid': 'version-state' }, behind ? `pinned v${a.version}, latest v${a.latestVersion} → ` : `pinned v${a.version}, the latest`, upgrade),
        h('div.row', change, del)),
      locked ? h('p.notice.info', { 'data-testid': 'track-locked' }, 'This track is locked. Unlock it on the timeline to edit.') : null,
      body);
    if (locked) { change.disabled = true; del.disabled = true; if (upgrade) upgrade.disabled = true; }
    drawOverrideState();
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

  // ── proposals from the agent ─────────────────────────────────────────────────────────────
  async function showProposalView() {
    const p = proposal;
    const comp = viewOf(p.composition);
    stage.setSize(comp.width, comp.height);
    overlays.redraw();
    stage.setDuration(comp.duration, comp.fps);
    await stage.show((pv) => pv.showClip({ composition: comp, bundle: p.bundle, audioUrl: null }));
  }
  async function setProposalShown(on) {
    showProposal = on && !!proposal;
    frameLabel.hidden = !showProposal;
    handles.setEnabled(!showProposal);
    drawProposalBar();
    updateTools();
    if (showProposal) await showProposalView(); else await showClip();
  }
  function drawProposalBar() {
    if (!proposal) { proposalBar.hidden = true; proposalBar.replaceChildren(); return; }
    const toggle = h('button.btn.small.toggle', { type: 'button', 'data-testid': 'proposal-toggle', 'data-showing': showProposal ? 'proposal' : 'current', 'aria-pressed': String(showProposal) }, showProposal ? 'Show current' : 'Show proposal');
    toggle.addEventListener('click', () => setProposalShown(!showProposal));
    const close = h('button.icon-btn.small', { type: 'button', 'data-testid': 'proposal-close', 'aria-label': 'Close the proposal preview' }, icon('close', 16));
    close.addEventListener('click', () => { proposal = null; setProposalShown(false); });
    const pr = proposal.proposal ?? {};
    fill(proposalBar,
      h('span.proposal-tag', showProposal ? 'Proposal' : 'Current'),
      h('span.proposal-text', pr.summary ?? pr.note ?? `Proposal #${pr.id ?? ''}`, proposal.current && proposal.current !== clip.revision ? h('span.muted', ` · made against revision ${proposal.current}`) : null),
      toggle, close);
    proposalBar.hidden = false;
  }

  const agent = mountAgentPanel(agentBox, {
    scope: 'clip', clip: slug,
    getContext: () => ({ at: round(time()), items: [...sel.ids] }),
    onPreview(p) { if (!p?.composition || !p.bundle) return; proposal = p; setProposalShown(true); },
    onAccepted() { proposal = null; frameLabel.hidden = true; showProposal = false; handles.setEnabled(true); drawProposalBar(); if (dirty) showChanged(clip.revision + 1); else reload(); },
  });
  ctx.onCleanup(() => agent.destroy());

  // ── layout ───────────────────────────────────────────────────────────────────────────────
  fill(view,
    h('div.page-head',
      h('div',
        h('a.back', { href: '/clips' }, icon('back', 16), 'Clips'),
        h('div.title-row', h('h1', clip.title), unsaved, saved),
        meta),
      h('div.page-head-side', saveBtn, remixBtn, renderBtn)),
    msg.el,
    changedBanner,
    h('div.editor',
      h('div.ed-main',
        h('section.panel.stage-panel',
          h('div.fmt-bar', fmtLabel, h('div.fmt-switch', { role: 'group', 'aria-label': 'Format to lay out' }, fmtBtns)),
          overlays.bar,
          proposalBar,
          stage.el),
        h('section.panel.timeline-panel',
          h('div.panel-head', h('div.row', h('h2', 'Timeline'), position, audioStatus), h('div.row', addBtn, timeline.toolbar)),
          h('div.ed-toolbar', { role: 'toolbar', 'aria-label': 'Edit' }, undoBtn, redoBtn, splitBtn, copyBtn, pasteBtn, dupBtn, assetBtn, h('span.ed-marker-add', markerType, markerBtn), keysBtn),
          timeline.el,
          h('p.hint', `Drag an item to move it (also to another track), drag its edges to trim. Moves snap to the playhead, beats and other items; hold Alt to move freely. ${plural(beats.length, 'beat')} detected in the audio.`)),
        layersPanel),
      h('aside.ed-side', agentBox, inspector, issues.el, assetsPanel)));

  drawMeta();
  drawFormat();
  drawAssets();
  drawInspector();
  updateTools();
  timeline.setData({ composition: draft, beats, words, anchors });
  for (const track of draft.tracks) for (const item of track.items) if (item.anchor) resolved.set(item.id, item.start);
  showPosition(0);
  remember();
  await showClip();
  drawLayers(true);
}
