// The clip editor's inspector sections for a visual item: transform and opacity with keyframe
// toggles and per-format override markers, the keyframe list with easing, parameters (numeric and
// colour ones can be keyframed), and attachments (motions, effects, transition, mask); for an audio
// item its gain automation and ducking; for a marker or an anchored item its words; and the clip's
// loudness, captions and platforms. Plus the
// layout model the editor and the on-canvas handles share: where an edit is written (the base, an
// override for one format, or a keyframe at the playhead) and what a field shows at a time.

import { AUDIO_EASINGS, BLEND_MODES, DUCK_SOURCES, MARKER_TYPES, MASK_MODES, MOTION_PHASES } from '/core/composition.js';
import { PLATFORMS } from '/core/platforms.js';
import { TRANSFORM_DEFAULTS, boxToTransform, forFormat, sampleItem, spaceRect } from '/core/transform.js';
import { createParamControls } from '/ui/lib/params.js';
import { clamp, clone, fill, fmtTime, h, icon, nextId, plural, s, splitRef } from '/ui/lib/util.js';

export const EASES = ['linear', 'hold', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outQuart', 'outQuint', 'inExpo', 'outExpo', 'inOutExpo', 'inBack', 'outBack', 'outElastic', 'outBounce'];
const TF_KEYS = ['x', 'y', 'width', 'height', 'scale', 'scaleX', 'scaleY', 'rotation', 'anchorX', 'anchorY'];
// parameter types set in one go (a switch, a choice): each change is its own undo step, while typing and sliders share one
const DISCRETE = ['boolean', 'enum', 'font', 'asset', 'image'];
const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;

// The editor shows interpolated values with the usual curves; the render takes them from the
// composition's easing asset (pinned by the server when a keyframe first needs one). This is the
// table of assets/easing.js, formula for formula, so handles and fields sit where the render draws.
const c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3;
const CURVES = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outQuart: (x) => 1 - (1 - x) ** 4,
  outQuint: (x) => 1 - (1 - x) ** 5,
  inExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  inBack: (x) => c3 * x ** 3 - c1 * x * x,
  outElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  outBounce: (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  },
};
export const localEase = (name) => CURVES[name] ?? CURVES.linear;

// ── the layout model ─────────────────────────────────────────────────────────────────────────

/** Item time (seconds into the asset) at clip time t; outside the item, the time at its nearer end. */
export const itemTime = (item, t) => round3(clamp(t - item.start, 0, item.duration) + (item.offset ?? 0));
/** Is clip time t inside the item? */
export const inside = (item, t) => t >= item.start - 1e-6 && t <= item.start + item.duration + 1e-6;

/** The item laid out in a format and sampled at item time lt: { transform (full), opacity, params }. */
export const sampled = (item, fmt, lt) => sampleItem(forFormat(item, fmt), lt, localEase);

/** A legacy item with a `box` and no transform gets the same geometry as a transform. */
export function ensureTransform(item) {
  if (item.transform) return;
  item.transform = item.box ? boxToTransform(item.box) : {};
  delete item.box;
}

/** Where a layout edit goes: the item (its own format) or its override for `fmt`. */
export function layoutOf(item, fmt, own, create = true) {
  if (fmt === own) return item;
  if (!create) return item.formats?.[fmt] ?? null;
  item.formats ??= {};
  return (item.formats[fmt] ??= {});
}

/** Drop empty overrides and keyframe maps so an item edited back to plain stays plain. */
export function prune(item) {
  for (const L of [item, ...Object.values(item.formats ?? {})]) {
    if (L.keyframes) { for (const [k, v] of Object.entries(L.keyframes)) if (!v?.length) delete L.keyframes[k]; if (!Object.keys(L.keyframes).length) delete L.keyframes; }
  }
  for (const [k, o] of Object.entries(item.formats ?? {})) {
    if (o.transform && !Object.keys(o.transform).length) delete o.transform;
    if (!Object.keys(o).length) delete item.formats[k];
  }
  if (item.formats && !Object.keys(item.formats).length) delete item.formats;
}

/** The keys a property follows in a format (the override's own, else the base's), or null. */
export function keysFor(item, fmt, prop) {
  const keys = forFormat(item, fmt).keyframes?.[prop];
  return keys?.length ? keys : null;
}
const near = (a, b) => Math.abs(a - b) < 1e-3;
export const keyAt = (keys, lt) => keys?.find((k) => near(k.t, lt)) ?? null;

/** The key list to edit for prop in this layout (copied from the base into an override first). */
function editableKeys(item, fmt, own, prop) {
  const L = layoutOf(item, fmt, own);
  L.keyframes ??= {};
  if (!L.keyframes[prop]) L.keyframes[prop] = clone(keysFor(item, fmt, prop) ?? []);
  return L.keyframes[prop];
}

/** Write a value: a keyframe at lt when the property is animated, else the static value. */
export function setProp(item, fmt, own, prop, value, lt) {
  if (TF_KEYS.includes(prop)) ensureTransform(item);
  if (keysFor(item, fmt, prop)) {
    const keys = editableKeys(item, fmt, own, prop);
    const k = keyAt(keys, lt);
    if (k) k.v = value; else { keys.push({ t: lt, v: value }); keys.sort((a, b) => a.t - b.t); }
  } else if (TF_KEYS.includes(prop)) {
    const L = layoutOf(item, fmt, own);
    L.transform = { ...(L.transform ?? {}), [prop]: value };
  } else if (prop === 'opacity') {
    if (fmt === own) { if (value >= 1) delete item.opacity; else item.opacity = value; }
    else layoutOf(item, fmt, own).opacity = value;
  } else if (prop.startsWith('params.')) {
    item.params = { ...item.params, [prop.slice(7)]: value };
  }
  prune(item);
}

/** Add a keyframe at lt with the value shown there, or remove the one that is there. */
export function toggleKey(item, fmt, own, prop, lt, value) {
  if (TF_KEYS.includes(prop)) ensureTransform(item);
  const keys = editableKeys(item, fmt, own, prop);
  const k = keyAt(keys, lt);
  if (k) {
    keys.splice(keys.indexOf(k), 1);
    // the last key gone: the property keeps the value it had there
    if (!keys.length) { prune(item); setProp(item, fmt, own, prop, k.v, lt); }
  } else {
    keys.push({ t: lt, v: value });
    keys.sort((a, b) => a.t - b.t);
  }
  prune(item);
}

/** Set the easing of the key at time t. */
export function setEase(item, fmt, own, prop, t, ease) {
  const keys = editableKeys(item, fmt, own, prop);
  const k = keyAt(keys, t);
  if (k) { if (ease === 'linear') delete k.ease; else k.ease = ease; }
  prune(item);
}

/** Every keyframe of an item in a format: [{ prop, t }] (for the timeline markers). */
export function keyMarks(item, fmt) {
  const out = [];
  for (const [prop, keys] of Object.entries(forFormat(item, fmt).keyframes ?? {})) for (const k of keys ?? []) out.push({ prop, t: k.t });
  return out;
}

/** Fields the override for this format sets. */
export function overridden(item, fmt, own) {
  if (fmt === own) return new Set();
  const o = item.formats?.[fmt];
  return new Set([...Object.keys(o?.transform ?? {}), ...Object.keys(o?.keyframes ?? {}), ...(o?.opacity !== undefined ? ['opacity'] : [])]);
}

// ── controls ─────────────────────────────────────────────────────────────────────────────────

function kfToggle(prop, onClick) {
  const b = h('button.kf-toggle', { type: 'button', 'data-testid': 'kf-toggle', 'data-prop': prop, 'aria-pressed': 'false', 'aria-label': `Keyframe ${prop} at the playhead`, title: 'Add or remove a keyframe at the playhead' }, '◆');
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The transform and opacity of a visual item.
 * @param {{ item: any, fmt: string, own: string, size: { width: number, height: number }, lt: () => number, t: () => number,
 *   commit: (key: string, fn: (item: any) => void, o?: { structural?: boolean, burst?: boolean }) => void }} env
 */
export function transformSection(env) {
  const { item, fmt, own } = env;
  const fields = new Map();   // prop → { input, toggle, wrap }
  const num = (label, prop, testid, { step, min, max, title }) => {
    const id = nextId('tf');
    const input = h('input.num', { type: 'number', id, step, min, max, 'data-testid': testid, inputMode: 'decimal', title });
    const toggle = kfToggle(prop, () => {
      const v = Number(input.value);
      env.commit(`kf:${prop}`, (it) => toggleKey(it, fmt, own, prop, env.lt(), Number.isFinite(v) ? v : current(prop)));
    });
    const commitValue = (final) => {
      const v = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(v)) { if (final) sync(); return; }
      const x = clamp(v, min ?? -Infinity, max ?? Infinity);
      env.commit(`tf-${prop}:${item.id}`, (it) => setProp(it, fmt, own, prop, x, env.lt()), { burst: true });
    };
    input.addEventListener('input', () => commitValue(false));
    input.addEventListener('change', () => commitValue(true));
    const wrap = h('div.tf-field', { 'data-prop': prop }, h('label', { for: id }, label, h('span.ovr-mark', { title: 'Set for this format only' }, '•')), h('div.tf-ctl', input, toggle));
    fields.set(prop, { input, toggle, wrap });
    return wrap;
  };
  const current = (prop) => {
    const s = sampled(item, fmt, env.lt());
    return prop === 'opacity' ? s.opacity : s.transform[prop];
  };

  const spaceSel = h('select', { 'data-testid': 'tf-space', id: nextId('tf'), 'aria-label': 'Position relative to' }, h('option', { value: 'frame' }, 'Frame'), h('option', { value: 'safe' }, 'Safe zone'));
  spaceSel.addEventListener('change', () => env.commit(`tf-space:${item.id}`, (it) => {
    // keep the layer where it is: convert the static geometry to the other rectangle
    ensureTransform(it);
    const L = layoutOf(it, fmt, own);
    const full = { ...TRANSFORM_DEFAULTS, ...forFormat(it, fmt).transform };
    const { width, height } = env.size;
    const A = spaceRect(full.space, width, height), B = spaceRect(spaceSel.value, width, height);
    L.transform = { ...(L.transform ?? {}), space: spaceSel.value,
      x: round4((A.x + full.x * A.width - B.x) / B.width), y: round4((A.y + full.y * A.height - B.y) / B.height),
      width: round4((full.width * A.width) / B.width), height: round4((full.height * A.height) / B.height) };
  }));
  const blendSel = h('select', { 'data-testid': 'item-blend', id: nextId('tf'), 'aria-label': 'Blend mode' }, BLEND_MODES.map((m) => h('option', { value: m }, m === 'source-over' ? 'normal' : m)));
  blendSel.value = item.blend ?? 'source-over';
  blendSel.addEventListener('change', () => env.commit(`blend:${item.id}`, (it) => { if (blendSel.value === 'source-over') delete it.blend; else it.blend = blendSel.value; }));

  const el = h('div.tf-grid',
    num('X', 'x', 'tf-x', { step: 0.01, title: 'Anchor position across, as a fraction of the frame or safe zone' }),
    num('Y', 'y', 'tf-y', { step: 0.01, title: 'Anchor position down' }),
    num('Width', 'width', 'tf-width', { step: 0.01, min: 0.001 }),
    num('Height', 'height', 'tf-height', { step: 0.01, min: 0.001 }),
    num('Scale', 'scale', 'tf-scale', { step: 0.01 }),
    num('Rotation', 'rotation', 'tf-rotation', { step: 1, title: 'Degrees, clockwise' }),
    num('Scale X', 'scaleX', 'tf-scale-x', { step: 0.01 }),
    num('Scale Y', 'scaleY', 'tf-scale-y', { step: 0.01 }),
    num('Anchor X', 'anchorX', 'tf-anchor-x', { step: 0.05 }),
    num('Anchor Y', 'anchorY', 'tf-anchor-y', { step: 0.05 }),
    num('Opacity', 'opacity', 'item-opacity', { step: 0.01, min: 0, max: 1 }),
    h('div.tf-field', h('label', { for: spaceSel.id }, 'Relative to'), spaceSel),
    h('div.tf-field', h('label', { for: blendSel.id }, 'Blend'), blendSel));

  function sync() {
    const lt = env.lt();
    const s = sampled(item, fmt, lt);
    const ovr = overridden(item, fmt, own);
    const live = inside(item, env.t());
    for (const [prop, f] of fields) {
      const v = prop === 'opacity' ? s.opacity : s.transform[prop];
      if (document.activeElement !== f.input) f.input.value = String(round4(v));
      const keys = keysFor(item, fmt, prop);
      const on = !!keyAt(keys, lt);
      f.toggle.setAttribute('aria-pressed', String(on));
      f.toggle.dataset.on = String(on);
      f.toggle.classList.toggle('animated', !!keys);
      f.toggle.disabled = !live;
      f.wrap.classList.toggle('overridden', ovr.has(prop));
    }
    spaceSel.value = s.transform.space;
  }
  sync();
  return { el, sync };
}

/**
 * Parameters (generated controls); numeric and colour ones get a keyframe toggle.
 * @param {{ item: any, fmt: string, own: string, schema: any, fonts: string[], lt: () => number, t: () => number, visual: boolean,
 *   commit: (key: string, fn: (item: any) => void, o?: { structural?: boolean, burst?: boolean }) => void }} env
 */
export function paramsSection(env) {
  const { item, fmt, own, schema } = env;
  const animatable = env.visual ? Object.entries(schema ?? {}).filter(([, d]) => ['number', 'integer', 'color'].includes(d.type)).map(([n]) => n) : [];
  let shown = clone(item.params) ?? {};
  const controls = createParamControls({
    schema, values: shown, fonts: env.fonts,
    onChange(next, m) {
      const changed = Object.keys({ ...shown, ...next }).filter((k) => JSON.stringify(shown[k]) !== JSON.stringify(next[k]));
      shown = clone(next);
      env.commit(`params:${item.id}:${changed.join(',')}`, (it) => {
        for (const k of changed) {
          if (env.visual && keysFor(it, fmt, `params.${k}`)) setProp(it, fmt, own, `params.${k}`, next[k], env.lt());
          else { it.params = { ...it.params }; if (next[k] === undefined) delete it.params[k]; else it.params[k] = clone(next[k]); }
        }
      }, { structural: m.structural, burst: !changed.some((k) => DISCRETE.includes(schema?.[k]?.type)) });
    },
  });
  const toggles = new Map();
  function decorate() {
    toggles.clear();
    for (const name of animatable) {
      const field = controls.el.querySelector(`.field[data-param="${CSS.escape(name)}"]`);
      if (!field) continue;
      const prop = `params.${name}`;
      const b = kfToggle(prop, () => {
        const v = sampled(item, fmt, env.lt()).params[name] ?? schema[name].default;
        env.commit(`kf:${prop}`, (it) => toggleKey(it, fmt, own, prop, env.lt(), v));
      });
      field.querySelector('label')?.append(b);
      toggles.set(name, b);
    }
  }
  decorate();
  function sync() {
    const lt = env.lt();
    const live = inside(item, env.t());
    let animated = false;
    for (const [name, b] of toggles) {
      const keys = keysFor(item, fmt, `params.${name}`);
      if (keys) animated = true;
      const on = !!keyAt(keys, lt);
      b.setAttribute('aria-pressed', String(on));
      b.dataset.on = String(on);
      b.classList.toggle('animated', !!keys);
      b.disabled = !live;
    }
    // animated params show their value at the playhead (unless the user is typing in them)
    if (animated && !controls.el.contains(document.activeElement)) {
      const s = sampled(item, fmt, lt).params;
      const next = { ...clone(item.params) };
      for (const name of toggles.keys()) if (keysFor(item, fmt, `params.${name}`)) next[name] = typeof s[name] === 'number' ? round4(s[name]) : s[name];
      shown = next;
      controls.reset(next);
      decorate();
      for (const [name, b] of toggles) {
        const keys = keysFor(item, fmt, `params.${name}`);
        const on = !!keyAt(keys, lt);
        b.setAttribute('aria-pressed', String(on)); b.dataset.on = String(on); b.classList.toggle('animated', !!keys); b.disabled = !live;
      }
    }
  }
  sync();
  return {
    el: controls.el, sync,
    reset() { shown = {}; controls.reset({}); decorate(); sync(); },
  };
}

/**
 * Every keyframe of the item in this format, with its easing.
 * @param {{ item: any, fmt: string, own: string, lt: () => number, seek: (t: number) => void, hasEasing: boolean,
 *   commit: (key: string, fn: (item: any) => void, o?: { structural?: boolean, burst?: boolean }) => void }} env
 */
export function keyframesSection(env) {
  const { item, fmt, own } = env;
  const el = h('div.kf-list', { 'data-testid': 'keyframes-list' });
  function draw() {
    const kf = forFormat(item, fmt).keyframes ?? {};
    const props = Object.keys(kf).filter((p) => kf[p]?.length);
    const lt = env.lt();
    fill(el, props.length ? props.map((prop) => h('div.kf-prop',
      h('span.kf-name', prop),
      h('ul', kf[prop].map((k, i) => {
        // a curve this table does not have (a custom easing asset's) stays selectable under its own name
        const names = EASES.includes(k.ease ?? 'linear') ? EASES : [...EASES, k.ease];
        const ease = h('select.small', { 'data-testid': 'kf-ease', 'data-prop': prop, 'data-t': String(k.t), 'aria-label': `Easing after the ${prop} key at ${fmtTime(k.t)}`, disabled: i === kf[prop].length - 1 }, names.map((e) => h('option', { value: e }, e)));
        ease.value = k.ease ?? 'linear';
        ease.addEventListener('change', () => {
          const needs = ease.value !== 'linear' && ease.value !== 'hold' && !env.hasEasing;
          env.commit(`kf-ease:${item.id}:${prop}:${k.t}`, (it) => setEase(it, fmt, own, prop, k.t, ease.value), { structural: needs });
        });
        const go = h('button.kf-time', { type: 'button', 'data-testid': 'kf-goto', 'data-prop': prop, 'data-t': String(k.t), title: 'Go to this keyframe', class: near(k.t, lt) ? 'at' : null }, fmtTime(k.t));
        go.addEventListener('click', () => env.seek(item.start + k.t - (item.offset ?? 0)));
        const del = h('button.icon-btn.small', { type: 'button', 'data-testid': 'kf-remove', 'data-prop': prop, 'data-t': String(k.t), 'aria-label': `Remove the ${prop} key at ${fmtTime(k.t)}` }, icon('close', 14));
        del.addEventListener('click', () => env.commit(`kf-del:${prop}`, (it) => toggleKey(it, fmt, own, prop, k.t, k.v)));
        return h('li', go, h('span.kf-v', typeof k.v === 'number' ? String(round4(k.v)) : k.v), ease, del);
      }))))
      : h('p.muted', 'No keyframes. Use ◆ beside a field to add one at the playhead.'));
  }
  draw();
  return { el, sync: draw };
}

/**
 * Motions, effects, transition and mask of an item.
 * @param {{ item: any, readOnly: boolean, fonts: string[],
 *   schemaOf: (ref: string) => Promise<any>, options: (what: string) => Promise<{ value: string, label: string }[]>,
 *   pick: (o: { title: string, kinds: string[] }) => Promise<any>,
 *   commit: (key: string, fn: (item: any) => void, o?: { structural?: boolean, burst?: boolean }) => void }} env
 */
export function attachmentsSection(env) {
  const { item } = env;
  const paramsOf = (att, key) => {
    const box = h('div.att-params');
    env.schemaOf(att.asset).then((schema) => {
      if (!schema || !Object.keys(schema).length) return;
      const c = createParamControls({ schema, values: att.params ?? {}, fonts: env.fonts, onChange(next, m) { env.commit(`${key}:params`, (it) => { const a = locate(it); if (a) a.params = clone(next); }, { structural: m.structural, burst: !m.structural }); } });
      // attachment params get their own test ids so they do not collide with the item's
      for (const n of c.el.querySelectorAll('[data-testid^="param-"]')) n.dataset.testid = `${key.split(':')[0]}-${n.dataset.testid}`;
      box.append(c.el);
    }).catch(() => {});
    const locate = (it) => {
      const [kind, i] = key.split(':');
      return kind === 'motion' ? it.motions?.[Number(i)] : kind === 'effect' ? it.effects?.[Number(i)] : kind === 'mask' ? it.mask : it.transition;
    };
    return box;
  };
  const title = (ref) => h('a.mono.att-ref', { href: `/assets/${splitRef(ref).slug}${splitRef(ref).version ? `?v=${splitRef(ref).version}` : ''}` }, ref);

  // motions
  const motions = h('ul.att-list', { 'data-testid': 'motions-list' }, (item.motions ?? []).map((m, i) => {
    const phase = h('select.small', { 'data-testid': 'motion-phase', 'aria-label': 'Phase' }, MOTION_PHASES.map((p) => h('option', { value: p }, p)));
    phase.value = m.phase ?? 'in';
    phase.addEventListener('change', () => env.commit(`motion:${i}:phase`, (it) => { it.motions[i].phase = phase.value; if (phase.value !== 'emphasis') delete it.motions[i].at; }));
    const dur = h('input.num.small', { type: 'number', min: 0.05, step: 0.05, value: m.duration ?? '', placeholder: 'auto', 'data-testid': 'motion-duration', 'aria-label': 'Duration in seconds' });
    dur.addEventListener('change', () => env.commit(`motion:${i}:duration`, (it) => { const v = Number(dur.value); if (dur.value.trim() === '' || !(v > 0)) delete it.motions[i].duration; else it.motions[i].duration = v; }));
    const at = m.phase === 'emphasis' ? h('input.num.small', { type: 'number', min: 0, step: 0.05, value: m.at ?? 0, 'data-testid': 'motion-at', 'aria-label': 'Starts at (item time)' }) : null;
    at?.addEventListener('change', () => env.commit(`motion:${i}:at`, (it) => { it.motions[i].at = Math.max(0, Number(at.value) || 0); }));
    const del = h('button.icon-btn.small', { type: 'button', 'data-testid': 'motion-remove', 'aria-label': `Remove motion ${m.asset}` }, icon('trash', 14));
    del.addEventListener('click', () => env.commit(`motion-del:${i}`, (it) => { it.motions.splice(i, 1); if (!it.motions.length) delete it.motions; }, { structural: true }));
    return h('li.att-row', { 'data-testid': 'motion-row', 'data-asset': m.asset },
      h('div.att-head', title(m.asset), del),
      h('div.att-ctl', h('label', 'Phase', phase), h('label', 'Duration', dur), at ? h('label', 'At', at) : null),
      paramsOf(m, `motion:${i}`));
  }));
  const addMotion = h('button.btn.small', { type: 'button', 'data-testid': 'add-motion' }, icon('plus', 14), 'Add motion');
  addMotion.addEventListener('click', async () => {
    const a = await env.pick({ title: 'Add a motion', kinds: ['motion'] });
    if (a) env.commit('motion-add', (it) => { it.motions = [...(it.motions ?? []), { asset: a.ref, phase: 'in', params: {} }]; }, { structural: true });
  });

  // effects
  const effects = h('ul.att-list', { 'data-testid': 'effects-list' }, (item.effects ?? []).map((fx, i) => {
    const del = h('button.icon-btn.small', { type: 'button', 'data-testid': 'effect-remove', 'aria-label': `Remove effect ${fx.asset}` }, icon('trash', 14));
    del.addEventListener('click', () => env.commit(`effect-del:${i}`, (it) => { it.effects.splice(i, 1); if (!it.effects.length) delete it.effects; }, { structural: true }));
    return h('li.att-row', { 'data-testid': 'effect-row', 'data-asset': fx.asset }, h('div.att-head', title(fx.asset), del), paramsOf(fx, `effect:${i}`));
  }));
  const addEffect = h('button.btn.small', { type: 'button', 'data-testid': 'add-effect' }, icon('plus', 14), 'Add effect');
  addEffect.addEventListener('click', async () => {
    const a = await env.pick({ title: 'Add an effect', kinds: ['effect'] });
    if (a) env.commit('effect-add', (it) => { it.effects = [...(it.effects ?? []), { asset: a.ref, params: {} }]; }, { structural: true });
  });

  // transition and mask: selects filled from the library
  const select = (testid, label, current, what) => {
    const sel = h('select', { 'data-testid': testid, id: nextId('att'), 'aria-label': label }, h('option', { value: '' }, 'None'), current ? h('option', { value: current }, current) : null);
    sel.value = current ?? '';
    env.options(what).then((opts) => {
      for (const o of opts) if (o.value !== current && splitRef(o.value).slug !== splitRef(current ?? '').slug) sel.append(h('option', { value: o.value }, o.label));
    }).catch(() => {});
    return sel;
  };
  const trSel = select('transition-select', 'Transition', item.transition?.asset, 'transition');
  trSel.addEventListener('change', () => env.commit('transition', (it) => { if (!trSel.value) delete it.transition; else it.transition = { asset: trSel.value, duration: it.transition?.duration ?? 0.5, params: {} }; }, { structural: true }));
  const trDur = h('input.num', { type: 'number', min: 0.05, step: 0.05, value: item.transition?.duration ?? 0.5, 'data-testid': 'transition-duration', 'aria-label': 'Transition duration', disabled: !item.transition });
  trDur.addEventListener('change', () => env.commit('transition-duration', (it) => { if (it.transition) it.transition.duration = Math.max(0.05, Number(trDur.value) || 0.5); }));
  const maskSel = select('mask-select', 'Mask', item.mask?.asset, 'mask');
  maskSel.addEventListener('change', () => env.commit('mask', (it) => { if (!maskSel.value) delete it.mask; else it.mask = { asset: maskSel.value, mode: it.mask?.mode ?? 'alpha', params: {} }; }, { structural: true }));
  const maskMode = h('select', { 'data-testid': 'mask-mode', 'aria-label': 'Mask mode', disabled: !item.mask }, MASK_MODES.map((m) => h('option', { value: m }, m)));
  maskMode.value = item.mask?.mode ?? 'alpha';
  maskMode.addEventListener('change', () => env.commit('mask-mode', (it) => { if (it.mask) it.mask.mode = maskMode.value; }));

  return h('div.attachments',
    h('div.panel-head', h('h3', 'Motions'), addMotion), motions,
    h('div.panel-head', h('h3', 'Effects'), addEffect), effects,
    h('h3', 'Transition in'),
    h('div.att-ctl', h('label.grow', 'Asset', trSel), h('label', 'Duration', trDur)),
    h('h3', 'Mask'),
    h('div.att-ctl', h('label.grow', 'Asset', maskSel), h('label', 'Mode', maskMode)),
    item.mask ? paramsOf(item.mask, 'mask:0') : null);
}

// ── audio items, markers, anchors and the clip's own settings (v3) ────────────────────────────

const round1 = (v) => Math.round(v * 10) / 10;
const trim2 = (v) => String(Math.round(v * 100) / 100);

/** A labelled switch (a checkbox with role switch); onChange gets the new state. */
export function switchField(label, testid, checked, onChange, { hint, disabled = false } = {}) {
  const id = nextId('sw');
  const input = h('input', { type: 'checkbox', id, checked: !!checked, disabled, 'data-testid': testid, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return { input, el: h('div.field.inline', h('label', { for: id }, label), h('label.switch', input, h('span.switch-track', { 'aria-hidden': 'true' })), hint ? h('p.hint', hint) : null) };
}

/** A labelled number box: `apply(v, final)` runs on every valid input (clamped); the box shows the clamped value when it is left. */
export function numberField(label, testid, value, { min, max, step, unit, disabled = false, integer = false }, apply) {
  const id = nextId('nf');
  const fix = (v) => { const x = clamp(v, min ?? -Infinity, max ?? Infinity); return integer ? Math.round(x) : round3(x); };
  const input = h('input.num', { type: 'number', id, min, max, step, value: String(value), disabled, 'data-testid': testid, inputMode: 'decimal' });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) return;
    apply(fix(v), false);
  });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) { input.value = String(value); return; }
    value = fix(v);
    input.value = String(value);
    apply(value, true);
  });
  return { input, el: h('div.field', h('label', { for: id }, label, unit ? h('span.unit', unit) : null), input) };
}

/** Narration words as select options: "12 · the · 0:05.63" (with the item when there is more than one narration). */
function wordOptions(words, skipItem) {
  const list = words.filter((w) => w.item !== skipItem);
  const many = new Set(list.map((w) => w.item)).size > 1;
  return list.map((w) => h('option', { value: w.key }, `${w.i} · ${w.text}${w.missing ? ' (not in the take)' : ''} · ${fmtTime(w.start)}${many ? ` · ${w.item}` : ''}`));
}

// the mixer's gain curves (src/render/mix.js, formula for formula: the preview mix is made from the same table)
const AUDIO_CURVES = {
  linear: (x) => x,
  hold: (x) => (x < 1 ? 0 : 1),
  smooth: (x) => x * x * (3 - 2 * x),
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => (1 - Math.cos(Math.PI * x)) / 2,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
};

/** Gain in dB of keys [{ t, v, ease? }] at item time t: the first value before the first key, the last after the last. */
export function volumeAt(keys, t) {
  if (!keys.length) return 0;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].v;
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (sorted[i + 1].t <= t) i++;
  const a = sorted[i], b = sorted[i + 1];
  return a.v + (b.v - a.v) * (AUDIO_CURVES[a.ease ?? 'linear'] ?? AUDIO_CURVES.linear)((t - a.t) / (b.t - a.t));
}

/**
 * Gain automation and ducking of an audio item (its plain gain field stays with the timing fields).
 * @param {{ item: any, tracks: { id: string, name?: string, role?: string }[], lt: () => number, t: () => number,
 *   commit: (key: string, fn: (item: any) => void, o?: { inspector?: string, burst?: boolean }) => void }} env
 *   tracks: the clip's other audio tracks (what this item can duck under).
 */
export function audioSection(env) {
  const { item } = env;
  const keys = () => item.keyframes?.volume ?? [];
  const span = () => [item.offset ?? 0, (item.offset ?? 0) + item.duration];
  const quiet = { inspector: 'none', burst: true };

  // ── gain automation
  const rows = h('ul.vol-keys');
  const curve = s('svg', { class: 'vol-curve', viewBox: '0 0 300 96', role: 'img', 'aria-label': 'Gain in dB across the item', 'data-testid': 'volume-curve' });
  const addBtn = h('button.btn.small', { type: 'button', 'data-testid': 'volume-add', title: 'Add a gain key at the playhead' }, icon('plus', 14), 'Add key');
  addBtn.addEventListener('click', () => {
    const lt = env.lt();
    if (keys().some((k) => near(k.t, lt))) return;
    const v = round1(volumeAt(keys(), lt));
    env.commit(`vol-add:${item.id}`, (it) => {
      it.keyframes ??= {};
      (it.keyframes.volume ??= []).push({ t: round3(lt), v });
      it.keyframes.volume.sort((a, b) => a.t - b.t);
    });
    drawKeys();
  });

  function drawCurve() {
    const [t0, t1] = span();
    const W = 300, H = 96, L = 30, R = 8, T = 8, B = 18;
    const ks = keys();
    const lo = Math.max(-90, Math.min(-24, ...ks.map((k) => k.v - 3))), hi = Math.min(24, Math.max(6, ...ks.map((k) => k.v + 3)));
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const y = (db) => T + ((hi - db) / (hi - lo)) * (H - T - B);
    const d = [];
    for (let i = 0; i <= 120; i++) { const t = t0 + ((t1 - t0) * i) / 120; d.push(`${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(volumeAt(ks, t)).toFixed(1)}`); }
    const ticks = [hi, 0, lo].filter((v, i, a) => a.indexOf(v) === i);
    const at = clamp(env.lt(), t0, t1);
    fill(curve,
      s('rect', { class: 'vc-bg', x: L, y: T, width: W - L - R, height: H - T - B }),
      ticks.map((db) => [s('line', { class: db === 0 ? 'vc-zero' : 'vc-grid', x1: L, x2: W - R, y1: y(db), y2: y(db) }), s('text', { class: 'vc-label', x: L - 4, y: y(db) + 3.5, 'text-anchor': 'end' }, `${Math.round(db)}`)]),
      s('text', { class: 'vc-label', x: L, y: H - 4 }, fmtTime(t0).replace(/\.00$/, '')),
      s('text', { class: 'vc-label', x: W - R, y: H - 4, 'text-anchor': 'end' }, fmtTime(t1).replace(/\.00$/, '')),
      s('path', { class: 'vc-line', d: d.join('') }),
      ks.filter((k) => k.t >= t0 && k.t <= t1).map((k) => s('circle', { class: 'vc-key', cx: x(k.t), cy: y(k.v), r: 3.5 })),
      inside(item, env.t()) ? s('line', { class: 'vc-head', 'data-testid': 'volume-playhead', x1: x(at), x2: x(at), y1: T, y2: H - B }) : null);
  }

  function drawKeys() {
    const ks = keys();
    fill(rows, ks.length ? ks.map((k, i) => {
      const t = h('input.num', { type: 'number', min: 0, step: 0.05, value: String(round3(k.t)), 'data-testid': 'volume-key-t', 'aria-label': `Key ${i + 1}: time in seconds into the asset`, inputMode: 'decimal' });
      const db = h('input.num', { type: 'number', min: -90, max: 24, step: 0.5, value: String(round1(k.v)), 'data-testid': 'volume-key-db', 'aria-label': `Key ${i + 1}: gain in dB`, inputMode: 'decimal' });
      const names = AUDIO_EASINGS.includes(k.ease ?? 'linear') ? AUDIO_EASINGS : [...AUDIO_EASINGS, k.ease];
      const ease = h('select.small', { 'data-testid': 'volume-key-ease', 'aria-label': `Key ${i + 1}: easing to the next key`, disabled: i === ks.length - 1 }, names.map((e) => h('option', { value: e }, e)));
      ease.value = k.ease ?? 'linear';
      const del = h('button.icon-btn.small', { type: 'button', 'data-testid': 'volume-key-remove', 'aria-label': `Remove key ${i + 1} (${fmtTime(k.t)})` }, icon('close', 14));
      const key = (fn) => (it) => { const at = it.keyframes?.volume?.[i]; if (at) fn(at); };
      const read = (input, lo, hi) => { const v = Number(input.value); return input.value.trim() === '' || !Number.isFinite(v) ? null : clamp(v, lo, hi); };
      t.addEventListener('input', () => { const v = read(t, 0, span()[1]); if (v !== null) { env.commit(`vol-t:${item.id}:${i}`, key((at) => { at.t = v; }), quiet); drawCurve(); } });
      // the order of the keys follows their times once the box is left
      t.addEventListener('change', () => { env.commit(`vol-sort:${item.id}`, (it) => { it.keyframes?.volume?.sort((a, b) => a.t - b.t); }, quiet); drawKeys(); });
      db.addEventListener('input', () => { const v = read(db, -90, 24); if (v !== null) { env.commit(`vol-v:${item.id}:${i}`, key((at) => { at.v = v; }), quiet); drawCurve(); } });
      db.addEventListener('change', drawKeys);
      ease.addEventListener('change', () => { env.commit(`vol-ease:${item.id}:${i}`, key((at) => { if (ease.value === 'linear') delete at.ease; else at.ease = ease.value; })); drawCurve(); });
      del.addEventListener('click', () => {
        env.commit(`vol-del:${item.id}`, (it) => {
          it.keyframes.volume.splice(i, 1);
          if (!it.keyframes.volume.length) delete it.keyframes.volume;
          if (!Object.keys(it.keyframes).length) delete it.keyframes;
        });
        drawKeys();
      });
      return h('li', { 'data-testid': 'volume-key', 'data-index': String(i) }, t, db, ease, del);
    }) : h('li.muted.vol-empty', 'No gain keys. The item plays at its gain; add a key to shape the volume over time.'));
    drawCurve();
    syncAdd();
  }

  function syncAdd() { addBtn.disabled = !inside(item, env.t()) || keys().some((k) => near(k.t, env.lt())); }

  const automation = h('div.audio-auto', { 'data-testid': 'audio-automation' },
    h('div.panel-head', h('h3', 'Volume over time'), addBtn),
    curve,
    keys().length ? h('div.vol-head', { 'aria-hidden': 'true' }, h('span', 'Time (s)'), h('span', 'dB'), h('span', 'Then')) : null,
    rows);

  // ── ducking
  const duckEl = h('div.audio-duck', { 'data-testid': 'audio-duck' });
  const setDuck = (patch, o = quiet) => env.commit(`duck:${item.id}:${Object.keys(patch).join()}`, (it) => { if (it.duck) it.duck = { ...it.duck, ...patch }; }, o);
  function drawDuck() {
    const d = item.duck;
    const on = switchField('Duck under the narration', 'duck-on', !!d, (v) => {
      env.commit(`duck-on:${item.id}`, (it) => { if (v) it.duck = { by: 12, attack: 0.12, release: 0.4, hold: 0.25, source: 'words' }; else delete it.duck; }, { inspector: 'none' });
      drawDuck();
    });
    if (!d) { fill(duckEl, on.el, h('p.hint', 'The item gets quieter while the narration speaks, and comes back after.')); return; }
    const num = (label, testid, key, o) => numberField(label, testid, d[key], o, (v) => setDuck({ [key]: v }));
    const sourceId = nextId('ds');
    const source = h('select', { 'data-testid': 'duck-source', id: sourceId }, DUCK_SOURCES.map((x) => h('option', { value: x }, x === 'words' ? 'words (the narration)' : 'envelope (the track level)')));
    source.value = d.source;
    source.addEventListener('change', () => { setDuck({ source: source.value }, { inspector: 'none' }); drawDuck(); });
    const threshold = d.source === 'envelope' ? numberField('Level that counts as speech', 'duck-threshold', d.threshold ?? -40, { min: -90, max: 0, step: 1, unit: 'dBFS' }, (v) => setDuck({ threshold: v })) : null;
    const checks = env.tracks.map((tr) => {
      const box = h('input', { type: 'checkbox', checked: d.under?.includes(tr.id) ?? false, 'data-testid': 'duck-under-track', 'data-track': tr.id });
      box.addEventListener('change', () => {
        const next = env.tracks.map((x) => x.id).filter((id) => (id === tr.id ? box.checked : item.duck?.under?.includes(id)));
        env.commit(`duck-under:${item.id}`, (it) => { if (!it.duck) return; if (next.length) it.duck.under = next; else delete it.duck.under; }, { inspector: 'none' });
      });
      return h('label.check', box, h('span', tr.name ?? tr.id, tr.role ? h('span.muted', ` · ${tr.role}`) : null));
    });
    fill(duckEl,
      on.el,
      h('div.field-grid',
        num('Drops by', 'duck-by', 'by', { min: 0, max: 60, step: 1, unit: 'dB' }).el,
        num('Hold', 'duck-hold', 'hold', { min: 0, max: 2, step: 0.05, unit: 's' }).el,
        num('Attack', 'duck-attack', 'attack', { min: 0, max: 2, step: 0.01, unit: 's' }).el,
        num('Release', 'duck-release', 'release', { min: 0, max: 5, step: 0.05, unit: 's' }).el),
      h('div.field', h('label', { for: sourceId }, 'Speech is found from'), source),
      threshold?.el,
      h('div.field', h('span.field-label', { id: `${sourceId}-under` }, 'Ducks under'),
        checks.length ? h('div.checks', { role: 'group', 'aria-labelledby': `${sourceId}-under`, 'data-testid': 'duck-under' }, checks) : h('p.hint', { 'data-testid': 'duck-under' }, 'There is no other audio track.'),
        h('p.hint', 'Nothing checked: the narration tracks.')));
  }

  drawKeys();
  drawDuck();
  return {
    el: h('div.audio-section', automation, h('h3', 'Ducking'), duckEl),
    sync() { drawCurve(); syncAdd(); },
  };
}

/**
 * Start an item on a narration word.
 * @param {{ item: any, words: any[], report?: any, fps: number, duration: number, commit: (key: string, fn: (item: any) => void, o?: object) => void }} env
 */
export function anchorSection(env) {
  const { item } = env;
  const a = item.anchor;
  const words = env.words.filter((w) => w.item !== item.id);
  const id = nextId('an');
  const pick = h('select', { id, 'data-testid': 'anchor-word', disabled: !words.length }, h('option', { value: '' }, a ? 'Move to another word' : words.length ? 'Not on a word' : 'No narration words'), wordOptions(words, item.id));
  pick.value = '';
  pick.addEventListener('change', () => {
    const w = words.find((x) => x.key === pick.value);
    if (!w) return;
    env.commit(`anchor:${item.id}`, (it) => {
      it.anchor = { ...it.anchor, item: w.item, word: w.i };
      it.start = round3(Math.max(0, w.start + (it.anchor.offset ?? 0)));
      if (it.start + it.duration > env.duration) it.duration = round3(Math.max(1 / env.fps, env.duration - it.start));
    }, { inspector: 'redraw' });
  });
  let info = null;
  if (a) {
    // the report is the studio's last measurement: after a new word is picked, the words list is ahead of it
    const local = env.words.find((w) => w.item === a.item && w.i === a.word);
    const r = env.report && env.report.word?.i === a.word ? env.report : local ? { word: local, wordTime: (a.edge === 'end' ? local.end : local.start) + (a.offset ?? 0) } : env.report;
    const word = r?.word ?? local;
    if (r?.error) info = h('p.notice.error', { 'data-testid': 'anchor-info' }, r.error);
    else {
      // how far the item sits from its word in the draft (the studio puts it back on the word when the clip is saved)
      const delta = r ? Math.round((item.start - r.wordTime) * env.fps * 100) / 100 : null;
      info = h('p', { 'data-testid': 'anchor-info' },
        `Starts on word "${word?.text ?? a.word}" (${a.item}, word ${a.word})${word?.missing ? ', which is not in the take' : ''}`,
        delta === null ? null : `, Δ ${trim2(delta)} ${Math.abs(delta) === 1 ? 'frame' : 'frames'}`,
        delta !== null && Math.abs(delta) > 0.5 ? h('span.hint', ' Saving puts it back on the word. Detach to keep this start.') : null);
    }
  }
  const detach = a ? h('button.btn.small', { type: 'button', 'data-testid': 'anchor-detach' }, 'Detach') : null;
  detach?.addEventListener('click', () => env.commit(`anchor-off:${item.id}`, (it) => { delete it.anchor; }, { inspector: 'redraw' }));
  return { el: h('div.anchor', { 'data-testid': 'anchor-section' }, h('h3', 'Start on a word'), info, h('div.field', h('label', { for: id }, 'Narration word'), h('div.row.nowrap', h('div.grow', pick), detach))) };
}

/**
 * The marker the inspector shows.
 * @param {{ marker: any, words: any[], duration: number, commit: (key: string, fn: (marker: any) => void, o?: object) => void,
 *   seek: (t: number) => void, remove: () => void }} env
 */
export function markerSection(env) {
  const m = env.marker;
  const type = m.type ?? 'note';
  const quiet = { inspector: 'none', burst: true };
  const typeId = nextId('mk');
  const sel = h('select', { id: typeId, 'data-testid': 'marker-type' }, MARKER_TYPES.map((x) => h('option', { value: x, disabled: x === 'word' && !m.anchor && !env.words.length }, x)));
  sel.value = type;
  sel.addEventListener('change', () => {
    const next = sel.value;
    env.commit('marker-type', (mk) => {
      if (next === 'note') delete mk.type; else mk.type = next;
      if (next === 'hold') mk.duration ??= 1; else delete mk.duration;
      if (next === 'word' && !mk.anchor) {
        // a word marker needs a word: the one nearest to where the marker is
        const w = env.words.reduce((best, x) => (!best || Math.abs(x.start - mk.t) < Math.abs(best.start - mk.t) ? x : best), null);
        if (w) { mk.anchor = { item: w.item, word: w.i }; mk.t = round3(w.start); }
      } else if (next !== 'word') delete mk.anchor;
    }, { inspector: 'redraw' });
  });
  const labelId = nextId('mk');
  const label = h('input', { type: 'text', id: labelId, value: m.label ?? '', 'data-testid': 'marker-label', autocomplete: 'off', maxLength: 80 });
  label.addEventListener('input', () => env.commit('marker-label', (mk) => { mk.label = label.value; }, quiet));
  const t = numberField('Time', 'marker-t', round3(m.t), { min: 0, max: env.duration, step: 0.05, unit: 's', disabled: !!m.anchor }, (v) => env.commit('marker-t', (mk) => { mk.t = v; }, quiet));
  const dur = type === 'hold' ? numberField('Hold for', 'marker-duration', m.duration ?? 1, { min: 0.05, max: env.duration, step: 0.05, unit: 's' }, (v) => env.commit('marker-duration', (mk) => { mk.duration = v; }, quiet)) : null;

  let anchor = null;
  if (m.anchor) {
    const w = env.words.find((x) => x.item === m.anchor.item && x.i === m.anchor.word);
    const pickId = nextId('mk');
    const pick = h('select', { id: pickId, 'data-testid': 'marker-word' }, wordOptions(env.words, null));
    pick.value = `${m.anchor.item}:${m.anchor.word}`;
    pick.addEventListener('change', () => {
      const x = env.words.find((y) => y.key === pick.value);
      if (x) env.commit('marker-word', (mk) => { mk.anchor = { ...mk.anchor, item: x.item, word: x.i }; mk.t = round3(Math.max(0, x.start + (mk.anchor.offset ?? 0))); }, { inspector: 'redraw' });
    });
    anchor = h('div.field',
      h('p', { 'data-testid': 'marker-anchor' }, `on word "${w?.text ?? m.anchor.word}"`, h('span.muted', ` (${m.anchor.item}, word ${m.anchor.word})`)),
      h('label', { for: pickId }, 'Move to another word'), pick);
  }

  const goto = h('button.btn.small', { type: 'button', 'data-testid': 'marker-goto' }, 'Go to marker');
  goto.addEventListener('click', () => env.seek(m.t));
  const del = h('button.btn.small.danger', { type: 'button', 'data-testid': 'marker-delete' }, icon('trash', 14), 'Delete marker');
  del.addEventListener('click', env.remove);

  return {
    el: h('div.marker-editor', { 'data-testid': 'marker-editor' },
      h('div.field', h('label', { for: typeId }, 'Type'), sel),
      h('div.field', h('label', { for: labelId }, 'Label'), label),
      h('div.field-grid', t.el, dur?.el),
      anchor,
      h('div.row', goto, del)),
  };
}

// ── the clip's own settings: loudness, captions, platforms ────────────────────────────────────

/** @param {{ comp: () => any, edit: (key: string, fn: (comp: any) => void, o?: { inspector?: string, burst?: boolean }) => void }} env */
export function loudnessSection(env) {
  const l = env.comp().loudness;
  const set = (patch) => env.edit('loudness', (c) => { if (c.loudness) c.loudness = { ...c.loudness, ...patch }; }, { inspector: 'none', burst: true });
  const on = switchField('Normalise to a target', 'loudness-on', !!l, (v) => env.edit('loudness-on', (c) => { if (v) c.loudness = { target: -14, truePeak: -1 }; else delete c.loudness; }, { inspector: 'redraw' }), { hint: 'The mix is measured and brought to the target when the clip is rendered.' });
  const target = numberField('Target', 'loudness-target', l?.target ?? -14, { min: -40, max: -5, step: 0.5, unit: 'LUFS', disabled: !l }, (v) => set({ target: v }));
  const peak = numberField('True peak at most', 'loudness-peak', l?.truePeak ?? -1, { min: -9, max: 0, step: 0.5, unit: 'dBTP', disabled: !l }, (v) => set({ truePeak: v }));
  return { el: h('div.clip-loudness', { 'data-testid': 'clip-loudness' }, on.el, h('div.field-grid', target.el, peak.el)) };
}

/** @param {{ comp: () => any, pages: any[] | null, edit: Function }} env */
export function captionsSection(env) {
  const comp = env.comp();
  const c = comp.captions;
  const set = (patch) => env.edit('captions', (x) => { if (x.captions) x.captions = { ...x.captions, ...patch }; }, { inspector: 'none', burst: true });
  const on = switchField('Captions from the narration', 'captions-on', !!c, (v) => env.edit('captions-on', (x) => { if (v) x.captions = {}; else delete x.captions; }, { inspector: 'redraw' }));
  const burn = switchField('Burn into the video', 'captions-burn', c ? c.burnIn !== false : true, (v) => env.edit('captions-burn', (x) => { if (!x.captions) return; if (v) delete x.captions.burnIn; else x.captions.burnIn = false; }, { inspector: 'redraw' }),
    { disabled: !c, hint: c && c.burnIn === false ? 'File only: the captions go to the subtitle files and are not drawn on the picture.' : undefined });
  const chars = numberField('Characters in a line, at most', 'captions-chars', c?.maxChars ?? (comp.format === 'horizontal' ? 32 : 20), { min: 8, max: 80, step: 1, integer: true, disabled: !c }, (v) => set({ maxChars: v }));
  return { el: h('div.clip-captions', { 'data-testid': 'clip-captions' }, on.el, burn.el, chars.el,
    c ? h('p.hint', { 'data-testid': 'captions-pages' }, env.pages?.length ? `${plural(env.pages.length, 'caption page')} from the narration.` : 'No narration words yet: add a narration to get caption pages.') : null) };
}

/** @param {{ comp: () => any, edit: Function }} env */
export function platformsSection(env) {
  const comp = env.comp();
  const chosen = comp.platforms ?? [];
  const boxes = Object.entries(PLATFORMS).map(([id, p]) => {
    const box = h('input', { type: 'checkbox', checked: chosen.includes(id), 'data-testid': 'clip-platform', 'data-platform': id });
    box.addEventListener('change', () => env.edit('platforms', (c) => {
      const next = Object.keys(PLATFORMS).filter((x) => (x === id ? box.checked : (c.platforms ?? []).includes(x)));
      if (next.length) c.platforms = next; else { delete c.platforms; delete c.safe; }
    }, { inspector: 'redraw' }));
    return h('label.check', box, h('span', p.name));
  });
  const safe = switchField('Keep assets inside the platforms\' safe zone', 'safe-platform', comp.safe === 'platform', (v) => env.edit('safe', (c) => { if (v && c.platforms?.length) c.safe = 'platform'; else delete c.safe; }, { inspector: 'redraw' }),
    { disabled: !chosen.length, hint: chosen.length ? 'Assets read the tightest edge of the chosen platforms as f.safe.' : 'Choose a platform first.' });
  return { el: h('div.clip-platforms-box', h('div.checks', { role: 'group', 'aria-label': 'Platforms the clip is for', 'data-testid': 'clip-platforms' }, boxes), safe.el) };
}
