// Parameter schemas. An asset declares its parameters once; the studio builds controls from the
// declaration, the MCP layer validates against it, and the runtime fills defaults from it.
//
//   params: {
//     text:   { type: 'string', default: 'Hello' },
//     size:   { type: 'number', default: 96, min: 8, max: 400, step: 1 },
//     color:  { type: 'color', default: '#ffffff' },
//     font:   { type: 'font', default: 'Inter' },
//     mode:   { type: 'enum', options: ['up', 'down'], default: 'up' },
//     bullets:{ type: 'array', of: { type: 'string' }, default: ['One', 'Two'], maxItems: 6 },
//     reveal: { type: 'asset', kind: 'visual', default: 'text-word-reveal' },
//     logo:   { type: 'image', default: null },
//   }

import { REF_RE } from './engine.js';

export const PARAM_TYPES = ['number', 'integer', 'boolean', 'string', 'text', 'enum', 'color', 'font', 'image', 'asset', 'array', 'object'];

const COLOR_RE = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^()]+\)|hsla?\([^()]+\)|transparent)$/i;
export const isColor = (v) => typeof v === 'string' && COLOR_RE.test(v.trim());

export class SchemaError extends Error {
  constructor(message, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'SchemaError';
    this.path = path;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const COMMON = ['type', 'default', 'label', 'description', 'group'];
const EXTRA = {
  number: ['min', 'max', 'step', 'unit'],
  integer: ['min', 'max', 'step', 'unit'],
  boolean: [],
  string: ['maxLength', 'placeholder'],
  text: ['maxLength', 'placeholder'],
  enum: ['options'],
  color: [],
  font: [],
  image: [],
  asset: ['kind', 'tag'],
  array: ['of', 'minItems', 'maxItems'],
  object: ['fields'],
};

function typeDefault(def) {
  switch (def.type) {
    case 'number': case 'integer': return Math.min(Math.max(0, def.min ?? 0), def.max ?? Infinity);
    case 'boolean': return false;
    case 'string': case 'text': return '';
    case 'enum': return def.options[0];
    case 'color': return '#ffffff';
    case 'font': return 'Inter';
    case 'image': case 'asset': return null;
    case 'array': return [];
    case 'object': return Object.fromEntries(Object.entries(def.fields).map(([k, d]) => [k, d.default]));
    default: return null;
  }
}

function normalizeDef(raw, path) {
  if (!isPlain(raw)) throw new SchemaError('a parameter is declared as an object like { type: "number", default: 1 }', path);
  const def = clone(raw);
  if (!PARAM_TYPES.includes(def.type)) throw new SchemaError(`unknown type ${JSON.stringify(def.type)}; use one of ${PARAM_TYPES.join(', ')}`, path);
  const allowed = [...COMMON, ...EXTRA[def.type]];
  for (const k of Object.keys(def)) if (!allowed.includes(k)) throw new SchemaError(`unknown key "${k}" for type ${def.type} (allowed: ${allowed.join(', ')})`, path);
  if (def.type === 'number' || def.type === 'integer') {
    for (const k of ['min', 'max', 'step']) if (def[k] !== undefined && !Number.isFinite(def[k])) throw new SchemaError(`${k} must be a finite number`, path);
    if (def.min !== undefined && def.max !== undefined && def.min > def.max) throw new SchemaError('min is greater than max', path);
  }
  if (def.type === 'enum') {
    if (!Array.isArray(def.options) || !def.options.length || !def.options.every((o) => typeof o === 'string')) throw new SchemaError('enum needs options: a non-empty array of strings', path);
  }
  if (def.type === 'asset' && def.kind !== undefined && !['visual', 'value', 'audio'].includes(def.kind)) throw new SchemaError('kind must be visual, value or audio', path);
  if (def.type === 'array') {
    if (def.of === undefined) throw new SchemaError('array needs "of": the item declaration', path);
    def.of = normalizeDef(def.of, `${path}[]`);
  }
  if (def.type === 'object') {
    if (!isPlain(def.fields)) throw new SchemaError('object needs "fields": a map of parameter declarations', path);
    def.fields = normalizeSchema(def.fields, path);
  }
  if (def.default === undefined) def.default = typeDefault(def);
  const errors = [];
  def.default = check(def, def.default, `${path}.default`, errors, { strict: true });
  if (errors.length) throw new SchemaError(errors[0].message, errors[0].path);
  return def;
}

/** Validate a `params` declaration and return a normalized deep copy. Throws SchemaError. */
export function normalizeSchema(raw, path = 'params') {
  if (raw === undefined || raw === null) return {};
  if (!isPlain(raw)) throw new SchemaError('params must be an object mapping names to declarations', path);
  const out = {};
  for (const [name, def] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new SchemaError(`"${name}" is not a valid parameter name`, path);
    out[name] = normalizeDef(def, `${path}.${name}`);
  }
  return out;
}

function check(def, value, path, errors, opts) {
  const fail = (message) => { errors.push({ path, message }); return def.default; };
  if (value === undefined) return def.default;
  switch (def.type) {
    case 'number': case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`expected a number, got ${describe(value)}`);
      let v = value;
      if (def.type === 'integer' && !Number.isInteger(v)) {
        if (opts.strict) return fail(`expected an integer, got ${v}`);
        v = Math.round(v);
      }
      if (def.min !== undefined && v < def.min) { if (opts.strict) return fail(`${v} is below the minimum ${def.min}`); v = def.min; }
      if (def.max !== undefined && v > def.max) { if (opts.strict) return fail(`${v} is above the maximum ${def.max}`); v = def.max; }
      return v;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : fail(`expected true or false, got ${describe(value)}`);
    case 'string': case 'text':
      if (typeof value !== 'string') return fail(`expected a string, got ${describe(value)}`);
      if (def.maxLength !== undefined && value.length > def.maxLength) return fail(`longer than ${def.maxLength} characters`);
      return value;
    case 'enum':
      return def.options.includes(value) ? value : fail(`expected one of ${def.options.join(', ')}; got ${describe(value)}`);
    case 'color':
      return isColor(value) ? value : fail(`expected a CSS color such as #ff3366 or rgba(0,0,0,0.5), got ${describe(value)}`);
    case 'font':
      return typeof value === 'string' && value.trim() ? value : fail(`expected a font family name, got ${describe(value)}`);
    case 'image': case 'asset':
      if (value === null) return null;
      return typeof value === 'string' && REF_RE.test(value) ? value : fail(`expected an asset reference such as "name" or "name@2", got ${describe(value)}`);
    case 'array': {
      if (!Array.isArray(value)) return fail(`expected an array, got ${describe(value)}`);
      if (def.minItems !== undefined && value.length < def.minItems) return fail(`needs at least ${def.minItems} items`);
      if (def.maxItems !== undefined && value.length > def.maxItems) return fail(`takes at most ${def.maxItems} items`);
      return value.map((v, i) => check(def.of, v, `${path}[${i}]`, errors, opts));
    }
    case 'object': {
      if (!isPlain(value)) return fail(`expected an object, got ${describe(value)}`);
      return resolveInto(def.fields, value, path, errors, opts);
    }
    default:
      return value;
  }
}

function resolveInto(schema, values, path, errors, opts) {
  const out = {};
  for (const key of Object.keys(values)) {
    if (!(key in schema)) errors.push({ path: path ? `${path}.${key}` : key, message: `unknown parameter (known: ${Object.keys(schema).join(', ') || 'none'})` });
  }
  for (const [key, def] of Object.entries(schema)) out[key] = check(def, values[key], path ? `${path}.${key}` : key, errors, opts);
  return out;
}

const describe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'string' ? JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v) : typeof v === 'object' ? 'an object' : String(v));

/**
 * Fill defaults and validate `values` against a normalized schema.
 * strict: out-of-range numbers are errors (clip validation). Otherwise they are clamped (runtime calls).
 * Returns { values, errors: [{ path, message }] }.
 */
export function resolveParams(schema, values = {}, { strict = false, path = '' } = {}) {
  const errors = [];
  if (!isPlain(values)) return { values: resolveInto(schema, {}, path, [], { strict }), errors: [{ path, message: `expected an object of parameters, got ${describe(values)}` }] };
  return { values: resolveInto(schema, values, path, errors, { strict }), errors };
}

/** Visit every declared value of the given types (asset, image, font…), including nested ones. */
export function walkParams(schema, values, types, visit, path = '') {
  const one = (def, value, p) => {
    if (value === undefined || value === null) return;
    if (types.includes(def.type)) visit(value, def, p);
    else if (def.type === 'array' && Array.isArray(value)) value.forEach((v, i) => one(def.of, v, `${p}[${i}]`));
    else if (def.type === 'object' && isPlain(value)) walkParams(def.fields, value, types, visit, p);
  };
  for (const [key, def] of Object.entries(schema)) one(def, values?.[key] === undefined ? def.default : values[key], path ? `${path}.${key}` : key);
}

/** Return a copy of `values` with every value of the given types replaced by map(value, def). */
export function mapParams(schema, values, types, map) {
  const one = (def, value) => {
    if (value === undefined || value === null) return value;
    if (types.includes(def.type)) return map(value, def);
    if (def.type === 'array' && Array.isArray(value)) return value.map((v) => one(def.of, v));
    if (def.type === 'object' && isPlain(value)) return mapParams(def.fields, value, types, map);
    return value;
  };
  const out = { ...values };
  for (const [key, def] of Object.entries(schema)) if (key in out) out[key] = one(def, out[key]);
  return out;
}
