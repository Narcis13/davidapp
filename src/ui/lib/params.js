// Controls generated from an asset's parameter schema (src/core/schema.js). Used by the asset
// playground and by the clip editor's inspector, so a parameter looks the same in both.
//
//   const controls = createParamControls({ schema, values, fonts, onChange });
//   onChange(values, { structural })   structural: an asset/image reference changed, so the set
//                                      of assets the preview needs may have changed
//
// `values` holds only what differs from the defaults (the shape a clip item stores).

import { isColor } from '/core/schema.js';
import { api } from '/ui/lib/api.js';
import { clone, fill, h, icon, nextId } from '/ui/lib/util.js';

const optionCache = new Map();
/**
 * Function assets of a kind (visual, value, audio, motion, transition, effect; narrowed by `tag`),
 * or image assets, as select options, by name. Cached per page load.
 */
function assetOptions(def) {
  const q = new URLSearchParams({ type: def.type === 'image' ? 'image' : 'function', limit: '200', sort: 'name' });
  if (def.type === 'asset' && def.kind) q.set('kind', def.kind);
  if (def.type === 'asset' && def.tag) q.set('tag', def.tag);
  const url = `/api/assets?${q}`;
  if (!optionCache.has(url)) {
    const p = api.get(url).then((r) => r.assets.map((a) => ({ value: a.ref, label: `${a.title === a.slug ? a.slug : `${a.title} · ${a.slug}`} @${a.version}${def.type === 'asset' && !def.kind && a.kind && a.kind !== 'visual' ? ` (${a.kind})` : ''}` })));
    optionCache.set(url, p);
    p.catch(() => optionCache.delete(url));
  }
  return optionCache.get(url);
}
export const clearAssetOptions = () => optionCache.clear();

let probe = null;
/** Any CSS colour → { hex: '#rrggbb', alpha }. Uses a canvas only to normalise the colour string. */
export function parseColor(css) {
  probe ??= document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000000';
  probe.fillStyle = String(css);
  const out = probe.fillStyle;
  if (out.startsWith('#')) return { hex: out, alpha: 1 };
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(out);
  if (!m) return { hex: '#000000', alpha: 1 };
  const hex = `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return { hex, alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

const niceStep = (def) => {
  if (def.step) return def.step;
  if (def.type === 'integer') return 1;
  if (def.min === undefined || def.max === undefined) return 'any';
  const raw = (def.max - def.min) / 200;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((x) => x >= raw) ?? raw;
};

const labelOf = (name, def) => def.label ?? name;

/** One control. `set(value, meta)` commits a new value. Returns the element to place under the label. */
function control(def, value, set, path, ctx, id) {
  const testid = `param-${path}`;
  switch (def.type) {
    case 'number':
    case 'integer': {
      const ranged = Number.isFinite(def.min) && Number.isFinite(def.max);
      const step = niceStep(def);
      const fix = (v) => {
        let x = def.type === 'integer' ? Math.round(v) : v;
        if (Number.isFinite(def.min)) x = Math.max(def.min, x);
        if (Number.isFinite(def.max)) x = Math.min(def.max, x);
        return x;
      };
      const box = h('input.num', { type: 'number', id, min: def.min, max: def.max, step, value: String(value), 'data-testid': testid, inputMode: 'decimal' });
      const slider = ranged ? h('input', { type: 'range', min: def.min, max: def.max, step, value: String(value), 'aria-label': `${path} slider`, 'data-testid': `${testid}-range` }) : null;
      box.addEventListener('input', () => {
        const v = Number(box.value);
        if (box.value.trim() === '' || !Number.isFinite(v)) return;
        const x = fix(v);
        if (slider) slider.value = String(x);
        set(x);
      });
      box.addEventListener('change', () => {
        const v = Number(box.value);
        const x = box.value.trim() === '' || !Number.isFinite(v) ? def.default : fix(v);
        box.value = String(x);
        if (slider) slider.value = String(x);
        set(x);
      });
      slider?.addEventListener('input', () => { const x = fix(Number(slider.value)); box.value = String(x); set(x); });
      return h('div.ctl-number', slider, box, def.unit ? h('span.unit', def.unit) : null);
    }
    case 'boolean': {
      const input = h('input', { type: 'checkbox', id, checked: !!value, 'data-testid': testid, role: 'switch' });
      input.addEventListener('change', () => set(input.checked));
      return h('label.switch', input, h('span.switch-track', { 'aria-hidden': 'true' }));
    }
    case 'string': {
      const input = h('input', { type: 'text', id, value: value ?? '', maxLength: def.maxLength, placeholder: def.placeholder, 'data-testid': testid, spellcheck: false, autocomplete: 'off' });
      input.addEventListener('input', () => set(input.value));
      return input;
    }
    case 'text': {
      const input = h('textarea', { id, rows: 3, value: value ?? '', maxLength: def.maxLength, placeholder: def.placeholder, 'data-testid': testid, spellcheck: false });
      input.addEventListener('input', () => set(input.value));
      return input;
    }
    case 'enum': {
      const input = h('select', { id, 'data-testid': testid }, def.options.map((o) => h('option', { value: o }, o)));
      input.value = value;
      input.addEventListener('change', () => set(input.value));
      return input;
    }
    case 'color': {
      // the text field is authoritative: it keeps rgba() and 8-digit hex that <input type=color> cannot hold
      const first = parseColor(value);
      const picker = h('input', { type: 'color', value: first.hex, 'aria-label': `${path} colour picker`, tabIndex: -1 });
      const chip = h('span.swatch', { style: { '--c': value } }, picker);
      const text = h('input.mono', { type: 'text', id, value, 'data-testid': testid, spellcheck: false, autocomplete: 'off' });
      text.addEventListener('input', () => {
        const v = text.value.trim();
        const ok = isColor(v);
        text.classList.toggle('invalid', !ok);
        text.setAttribute('aria-invalid', String(!ok));
        if (!ok) return;
        chip.style.setProperty('--c', v);
        picker.value = parseColor(v).hex;
        set(v);
      });
      picker.addEventListener('input', () => {
        const { alpha } = parseColor(text.value);
        const hex = picker.value;
        const v = alpha < 1 ? `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})` : hex;
        text.value = v;
        text.classList.remove('invalid');
        text.setAttribute('aria-invalid', 'false');
        chip.style.setProperty('--c', v);
        set(v);
      });
      return h('div.ctl-color', chip, text);
    }
    case 'font': {
      const families = ctx.fonts.includes(value) ? ctx.fonts : [value, ...ctx.fonts];
      const input = h('select', { id, 'data-testid': testid }, families.map((f) => h('option', { value: f }, f)));
      input.value = value;
      input.addEventListener('change', () => set(input.value));
      return input;
    }
    case 'asset':
    case 'image': {
      const NONE = '';
      const input = h('select.mono', { id, 'data-testid': testid });
      const setOptions = (options) => {
        const list = [...options];
        if (value && !list.some((o) => o.value === value)) list.unshift({ value, label: value });
        fill(input, 
          def.default === null || value === null ? h('option', { value: NONE }, 'None') : null,
          list.map((o) => h('option', { value: o.value }, o.label)));
        input.value = value ?? NONE;
      };
      setOptions([]);
      assetOptions(def).then(setOptions, () => {});
      input.addEventListener('change', () => { value = input.value === NONE ? null : input.value; set(value, { structural: true }); });
      return input;
    }
    case 'array': {
      const items = Array.isArray(value) ? clone(value) : [];
      const wrap = h('div.ctl-array', { 'data-testid': testid });
      const commit = () => { set(clone(items)); draw(); };
      const draw = () => {
        const canAdd = def.maxItems === undefined || items.length < def.maxItems;
        const canRemove = def.minItems === undefined || items.length > def.minItems;
        fill(wrap, 
          items.map((item, i) => h('div.array-row',
            h('div.array-item', control(def.of, item, (v, meta) => { items[i] = v; set(clone(items), meta); }, `${path}.${i}`, ctx, nextId('p'))),
            h('div.array-tools',
              h('button.icon-btn.small', { type: 'button', title: 'Move up', 'aria-label': `Move item ${i + 1} up`, disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; commit(); } }, icon('up', 14)),
              h('button.icon-btn.small', { type: 'button', title: 'Move down', 'aria-label': `Move item ${i + 1} down`, disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; commit(); } }, icon('down', 14)),
              h('button.icon-btn.small', { type: 'button', title: 'Remove', 'aria-label': `Remove item ${i + 1}`, disabled: !canRemove, 'data-testid': `${testid}-remove`, onclick: () => { items.splice(i, 1); commit(); } }, icon('close', 14))))),
          h('button.btn.small', { type: 'button', disabled: !canAdd, 'data-testid': `${testid}-add`, onclick: () => { items.push(clone(def.of.default)); commit(); } }, icon('plus', 14), 'Add item'));
      };
      draw();
      return wrap;
    }
    case 'object': {
      const obj = value && typeof value === 'object' ? clone(value) : {};
      return h('div.ctl-object', fields(def.fields, obj, (name, v, meta) => { obj[name] = v; set(clone(obj), meta); }, path, ctx));
    }
    default:
      return h('span.muted', `Unsupported type ${def.type}`);
  }
}

/** Label + control for every entry of a schema (or of an object parameter's fields). */
function fields(schema, values, setField, prefix, ctx) {
  const groups = new Map();
  for (const [name, def] of Object.entries(schema)) {
    const g = def.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([name, def]);
  }
  const out = [];
  for (const [group, list] of groups) {
    if (group) out.push(h('h4.param-group', group));
    for (const [name, def] of list) {
      const id = nextId('p');
      const path = prefix ? `${prefix}.${name}` : name;
      const value = values?.[name] === undefined ? clone(def.default) : values[name];
      const inline = def.type === 'boolean';
      const complex = def.type === 'array' || def.type === 'object';
      out.push(h(`div.field${inline ? '.inline' : ''}${complex ? '.complex' : ''}`, { 'data-param': path },
        h('label', { for: complex ? undefined : id, title: def.description }, labelOf(name, def), h('span.type', def.type)),
        control(def, value, (v, meta) => setField(name, v, meta), path, ctx, id),
        def.description ? h('p.hint', def.description) : null));
    }
  }
  return out;
}

/**
 * @param {{ schema: object, values?: object, fonts?: string[], onChange: (values: object, meta: { structural: boolean }) => void }} o
 */
export function createParamControls({ schema, values = {}, fonts = [], onChange }) {
  const el = h('div.params', { 'data-testid': 'params' });
  let current = clone(values) ?? {};
  const ctx = { fonts };
  const draw = () => {
    const names = Object.keys(schema ?? {});
    fill(el, names.length
      ? fields(schema, current, (name, v, meta) => { current[name] = v; onChange(current, { structural: !!meta?.structural }); }, '', ctx)
      : h('p.muted', 'This asset has no parameters.'));
  };
  draw();
  return {
    el,
    get values() { return current; },
    /** Replace the values (and optionally the schema) and redraw the controls. */
    reset(next = {}, nextSchema) { current = clone(next) ?? {}; if (nextSchema) schema = nextSchema; draw(); },
  };
}

/** Pinned asset/image references among parameter values (for bundling what a preview needs). */
export function referencedAssets(schema, values) {
  const refs = new Set();
  const one = (def, value) => {
    if (value === undefined || value === null) return;
    if (def.type === 'asset' || def.type === 'image') { if (typeof value === 'string' && /@\d+$/.test(value)) refs.add(value); }
    else if (def.type === 'array' && Array.isArray(value)) value.forEach((v) => one(def.of, v));
    else if (def.type === 'object' && typeof value === 'object') for (const [k, d] of Object.entries(def.fields)) one(d, value[k]);
  };
  for (const [name, def] of Object.entries(schema ?? {})) one(def, values?.[name]);
  return [...refs];
}
