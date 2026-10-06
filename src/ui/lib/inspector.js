// The clip editor's inspector sections for a visual item: transform and opacity with keyframe
// toggles and per-format override markers, the keyframe list with easing, parameters (numeric and
// colour ones can be keyframed), and attachments (motions, effects, transition, mask). Plus the
// layout model the editor and the on-canvas handles share: where an edit is written (the base, an
// override for one format, or a keyframe at the playhead) and what a field shows at a time.

import { BLEND_MODES, MASK_MODES, MOTION_PHASES } from '/core/composition.js';
import { TRANSFORM_DEFAULTS, boxToTransform, forFormat, sampleItem, spaceRect } from '/core/transform.js';
import { createParamControls } from '/ui/lib/params.js';
import { clamp, clone, fill, fmtTime, h, icon, nextId, splitRef } from '/ui/lib/util.js';

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
