// Interactive compositions: a composition that is played, not rendered to MP4. Its tracks are the
// design timeline, so every tool reads them as usual; `interactive` adds scenes (time ranges of that
// timeline), variables and wires:
//
//   interactive: {
//     start: 'intro',                                   // the first scene (default: the first listed)
//     vars: { score: 0, sound: true },                  // numbers, booleans or strings
//     scenes: [{ id: 'intro', start: 0, duration: 3, end: 'hold' }, …],   // end: hold | loop | next | <scene id>
//     wires: [{ on: 'play.press', do: [{ go: 'quiz' }] }, { on: 'key:ArrowRight', scene: 'quiz', do: … }],
//     transition: { asset: 'tx-crossfade@1', params: {}, duration: 0.4 },  // the default for go (optional)
//     music: ['m1'],                                    // audio items that loop for the whole session (optional)
//   }
//
// Events: `<item>.<event>` (a hit region an asset declared with f.ui.hit), `key:<key>` (KeyboardEvent.key, or
// key:any), `tap` (a press on no region), `start`, `enter:<scene>`, `end:<scene>` (its playhead reached the end).
// Actions: go, set, add, toggle, send, play, if, restart. Params bind to variables with { $var: "score" } and a
// visual item shows only `when` a condition holds; an audio item with `cue: true` plays only on a `play` action.
//
// What a viewer sees is a pure function of the composition and the input log: the state at frame n is the
// fold of every input event stamped before n, and an event stamped with frame j is read against the hit
// regions frame j drew. The live player draws frame j before it reads the events stamped j; a replay draws
// frame j again; both get the same regions, so both reach the same state. Nothing here keeps hidden state.

export const SCENE_ENDS = ['hold', 'loop', 'next'];
export const ACTIONS = ['go', 'set', 'add', 'toggle', 'send', 'play', 'if', 'restart'];
export const INPUT_TYPES = ['down', 'move', 'up', 'cancel', 'leave', 'key'];
const COMPARE = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
const NAME_RE = /^[A-Za-z_][\w-]*$/;
/** "$value.lane": a field of the event's value (a region's value may be an object). */
const FIELD_RE = /^\$value(\.[A-Za-z_]\w*)+$/;
/** Actions one event may run, nested wires included: a wire loop stops here instead of hanging the player. */
const MAX_ACTIONS = 256;
const KEEP = 48;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const scalar = (v) => num(v) || typeof v === 'boolean' || typeof v === 'string';
const round = (v) => Math.round(v * 1000) / 1000;
const list = (v) => (Array.isArray(v) ? v : [v]);

// ── validation ──────────────────────────────────────────────────────────────────────────────────

/** A value in a wire: a literal, { $var }, or { $event: 'value' } (the event's value; also the string "$value"). */
function checkValue(v, path, err, ctx) {
  if (typeof v === 'string' && FIELD_RE.test(v)) { if (!ctx.event) err(path, `"${v}" is a field of the event's value; it means nothing here`); return; }
  if (v === '$value') { if (!ctx.event) err(path, '"$value" is the value of the event that ran the wire; it means nothing here'); return; }
  if (isPlain(v)) {
    if (typeof v.$var === 'string') { if (!ctx.vars.has(v.$var)) err(path, `unknown variable "${v.$var}" (declared: ${[...ctx.vars].join(', ') || 'none'})`); return; }
    if (v.$event === 'value') { if (!ctx.event) err(path, '{ $event: "value" } only works inside a wire'); return; }
  }
  if (!scalar(v)) err(path, 'a value is a number, a boolean, a string, { $var: "name" }, "$value" (the event\'s value) or "$value.field" (a field of it)');
}

/** A condition: { var, eq|ne|gt|gte|lt|lte }, { scene }, { all }, { any }, { not }. */
function checkCondition(c, path, err, ctx) {
  if (!isPlain(c)) return err(path, 'a condition is { var: "score", gte: 3 }, { scene: "quiz" }, { all: [...] }, { any: [...] } or { not: {...} }');
  const keys = Object.keys(c);
  if (c.all !== undefined || c.any !== undefined) {
    const k = c.all !== undefined ? 'all' : 'any';
    if (keys.length !== 1 || !Array.isArray(c[k]) || !c[k].length) return err(path, `${k} is a non-empty list of conditions, alone in its object`);
    return c[k].forEach((x, i) => checkCondition(x, `${path}.${k}[${i}]`, err, ctx));
  }
  if (c.not !== undefined) { if (keys.length !== 1) err(path, 'not stands alone in its object'); return checkCondition(c.not, `${path}.not`, err, ctx); }
  if (c.scene !== undefined) {
    if (keys.length !== 1) err(path, 'scene stands alone in its object');
    for (const s of list(c.scene)) if (!ctx.scenes.has(s)) err(`${path}.scene`, `unknown scene "${s}"`);
    return;
  }
  if (typeof c.var !== 'string' || !ctx.vars.has(c.var)) return err(`${path}.var`, `var names a declared variable (declared: ${[...ctx.vars].join(', ') || 'none'})`);
  const ops = keys.filter((k) => k !== 'var');
  if (ops.length !== 1 || !COMPARE.includes(ops[0])) return err(path, `compare with exactly one of ${COMPARE.join(', ')}`);
  checkValue(c[ops[0]], `${path}.${ops[0]}`, err, ctx);
}

const TRANSITION_KEYS = ['asset', 'params', 'duration'];
function checkTransition(t, path, err) {
  if (t === false) return false;
  if (!isPlain(t) || typeof t.asset !== 'string' || !/^[a-z0-9][a-z0-9-]*(@\d+)?$/.test(t.asset)) { err(path, 'a transition is { asset: "tx-crossfade", params: {}, duration: 0.4 } (or false for a cut)'); return undefined; }
  if (t.params !== undefined && !isPlain(t.params)) err(`${path}.params`, 'params must be an object');
  if (!num(t.duration) || t.duration <= 0 || t.duration > 10) err(`${path}.duration`, 'duration is seconds (0–10]');
  for (const k of Object.keys(t)) if (!TRANSITION_KEYS.includes(k)) err(`${path}.${k}`, 'unknown field (use asset, params, duration)');
  return { asset: t.asset, params: isPlain(t.params) ? t.params : {}, duration: t.duration };
}

function checkActions(actions, path, err, ctx) {
  const out = [];
  list(actions).forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (!isPlain(a)) return err(p, `an action is an object with one of ${ACTIONS.join(', ')}`);
    const kind = ACTIONS.find((k) => a[k] !== undefined);
    if (!kind) return err(p, `an action names one of ${ACTIONS.join(', ')}`);
    const allowed = { go: ['go', 'transition'], set: ['set'], add: ['add', 'min', 'max', 'wrap'], toggle: ['toggle'], send: ['send', 'event', 'value'], play: ['play'], if: ['if', 'then', 'else'], restart: ['restart'] }[kind];
    for (const k of Object.keys(a)) if (!allowed.includes(k)) err(`${p}.${k}`, `unknown field for a ${kind} action (use ${allowed.join(', ')})`);
    const x = { ...a };
    if (kind === 'go') {
      if (!(ctx.scenes.has(a.go) || a.go === 'next' || a.go === 'back')) err(`${p}.go`, `go names a scene (${[...ctx.scenes].join(', ')}), "next" or "back"`);
      if (a.transition !== undefined) x.transition = checkTransition(a.transition, `${p}.transition`, err);
    } else if (kind === 'set' || kind === 'add') {
      if (!isPlain(a[kind]) || !Object.keys(a[kind]).length) err(`${p}.${kind}`, `${kind} maps variables to ${kind === 'set' ? 'values' : 'amounts'}: { score: ${kind === 'set' ? '0' : '1'} }`);
      else for (const [name, v] of Object.entries(a[kind])) {
        if (!ctx.vars.has(name)) err(`${p}.${kind}.${name}`, `unknown variable "${name}"`);
        checkValue(v, `${p}.${kind}.${name}`, err, ctx);
        if (kind === 'add' && ctx.vars.has(name) && !num(ctx.initial[name])) err(`${p}.add.${name}`, `"${name}" is not a number`);
      }
      for (const k of ['min', 'max']) if (a[k] !== undefined && !num(a[k])) err(`${p}.${k}`, `${k} must be a number`);
      if (a.wrap !== undefined && typeof a.wrap !== 'boolean') err(`${p}.wrap`, 'wrap is true or false');
    } else if (kind === 'toggle') {
      for (const name of list(a.toggle)) if (!ctx.vars.has(name) || typeof ctx.initial[name] !== 'boolean') err(`${p}.toggle`, `toggle names boolean variables; "${name}" is not one`);
    } else if (kind === 'send') {
      if (!ctx.items.has(a.send)) err(`${p}.send`, `no visual item "${a.send}"`);
      if (typeof a.event !== 'string' || !NAME_RE.test(a.event)) err(`${p}.event`, 'event is the name the item reacts to, e.g. "burst"');
      if (a.value !== undefined) checkValue(a.value, `${p}.value`, err, ctx);
      ctx.sends.push({ item: a.send, event: a.event, path: p });
    } else if (kind === 'play') {
      if (!ctx.audio.has(a.play)) err(`${p}.play`, `no audio item "${a.play}"`);
    } else if (kind === 'if') {
      checkCondition(a.if, `${p}.if`, err, ctx);
      x.then = a.then === undefined ? [] : checkActions(a.then, `${p}.then`, err, ctx);
      if (a.else !== undefined) x.else = checkActions(a.else, `${p}.else`, err, ctx);
    } else if (kind === 'restart' && a.restart !== true) err(`${p}.restart`, 'restart is true');
    out.push(x);
  });
  return out;
}

/** Where an event comes from, parsed: { kind: item|key|tap|start|enter|end, item, event, key, scene }. */
export function parseOn(on) {
  if (typeof on !== 'string' || !on) return null;
  if (on === 'tap' || on === 'start') return { kind: on };
  let m = /^key:(.+)$/.exec(on);
  if (m) return { kind: 'key', key: m[1] };
  m = /^(enter|end):(.+)$/.exec(on);
  if (m) return { kind: m[1], scene: m[2] };
  const dot = on.lastIndexOf('.');
  if (dot > 0 && dot < on.length - 1) return { kind: 'item', item: on.slice(0, dot), event: on.slice(dot + 1) };
  return null;
}

/**
 * Normalize `interactive` against the composition it belongs to. ctx: { duration, fps, visual: Set of visual
 * item ids, audio: Set of audio item ids }. Reports problems through err(path, message); returns the section.
 */
export function normalizeInteractive(input, { duration, fps, visual, audio }, err) {
  if (!isPlain(input)) { err('interactive', 'interactive is { start, vars, scenes, wires, transition, music }'); return undefined; }
  const known = ['start', 'vars', 'scenes', 'wires', 'transition', 'music'];
  for (const k of Object.keys(input)) if (!known.includes(k)) err(`interactive.${k}`, `unknown field (use ${known.join(', ')})`);
  const vars = {};
  if (input.vars !== undefined) {
    if (!isPlain(input.vars)) err('interactive.vars', 'vars maps names to their first values: { score: 0, sound: true }');
    else for (const [name, v] of Object.entries(input.vars)) {
      if (!NAME_RE.test(name)) err(`interactive.vars.${name}`, 'a variable name is letters, digits, _ and -, starting with a letter');
      else if (!scalar(v)) err(`interactive.vars.${name}`, 'a variable starts as a number, a boolean or a string');
      else vars[name] = v;
    }
  }
  const scenes = [];
  const ids = new Set();
  if (!Array.isArray(input.scenes) || !input.scenes.length) err('interactive.scenes', 'scenes is a non-empty list of { id, start, duration, end }');
  else input.scenes.forEach((s, i) => {
    const p = `interactive.scenes[${i}]`;
    if (!isPlain(s)) return err(p, 'a scene is { id, start, duration, end }');
    if (typeof s.id !== 'string' || !NAME_RE.test(s.id)) return err(`${p}.id`, 'id names the scene: letters, digits, _ and -');
    if (ids.has(s.id)) return err(`${p}.id`, `duplicate scene "${s.id}"`);
    ids.add(s.id);
    if (!num(s.start) || s.start < 0) err(`${p}.start`, 'start is where the scene begins on the timeline, in seconds ≥ 0');
    if (!num(s.duration) || s.duration <= 0) err(`${p}.duration`, 'duration is the scene\'s length in seconds (> 0)');
    else if (num(s.start) && s.start + s.duration > duration + 0.0011) err(p, `the scene ends at ${round(s.start + s.duration)}s, after the timeline ends (${duration}s)`);
    else if (Math.round(s.duration * fps) < 1) err(`${p}.duration`, 'the scene is shorter than one frame');
    const scene = { id: s.id, start: num(s.start) ? round(s.start) : 0, duration: num(s.duration) ? round(s.duration) : 1, end: s.end ?? 'hold' };
    if (typeof s.label === 'string') scene.label = s.label;
    if (s.final !== undefined) scene.final = !!s.final;
    if (s.transition !== undefined) scene.transition = checkTransition(s.transition, `${p}.transition`, err);
    for (const k of Object.keys(s)) if (!['id', 'start', 'duration', 'end', 'label', 'final', 'transition'].includes(k)) err(`${p}.${k}`, 'unknown field (use id, start, duration, end, label, final, transition)');
    scenes.push(scene);
  });
  for (const [i, s] of scenes.entries()) {
    if (typeof s.end !== 'string' || !(SCENE_ENDS.includes(s.end) || ids.has(s.end))) err(`interactive.scenes[${i}].end`, `end is ${SCENE_ENDS.join(', ')} or the id of the scene that follows`);
    else if (s.end === 'next' && i === scenes.length - 1) err(`interactive.scenes[${i}].end`, 'the last scene has no next scene');
  }
  const sorted = [...scenes].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].start + sorted[i - 1].duration - 0.0011) err('interactive.scenes', `scenes "${sorted[i - 1].id}" and "${sorted[i].id}" overlap on the timeline`);
  const start = input.start ?? scenes[0]?.id;
  if (input.start !== undefined && !ids.has(input.start)) err('interactive.start', `start names a scene (${[...ids].join(', ')})`);
  const ctx = { vars: new Set(Object.keys(vars)), initial: vars, scenes: ids, items: visual, audio, sends: [], event: true };
  const wires = [];
  if (input.wires !== undefined && !Array.isArray(input.wires)) err('interactive.wires', 'wires is a list of { on, scene, if, do }');
  else (input.wires ?? []).forEach((w, i) => {
    const p = `interactive.wires[${i}]`;
    if (!isPlain(w)) return err(p, 'a wire is { on, scene, if, do }');
    for (const k of Object.keys(w)) if (!['on', 'scene', 'if', 'do'].includes(k)) err(`${p}.${k}`, 'unknown field (use on, scene, if, do)');
    const on = parseOn(w.on);
    if (!on) return err(`${p}.on`, 'on is "<item>.<event>", "key:<key>", "tap", "start", "enter:<scene>" or "end:<scene>"');
    if (on.kind === 'item' && !visual.has(on.item)) err(`${p}.on`, `no visual item "${on.item}"`);
    if ((on.kind === 'enter' || on.kind === 'end') && !ids.has(on.scene)) err(`${p}.on`, `unknown scene "${on.scene}"`);
    const wire = { on: w.on };
    if (w.scene !== undefined) {
      if (!list(w.scene).every((s) => ids.has(s))) err(`${p}.scene`, `scene names the scenes the wire listens in (${[...ids].join(', ')})`);
      else wire.scene = w.scene;
    }
    if (w.if !== undefined) { checkCondition(w.if, `${p}.if`, err, ctx); wire.if = w.if; }
    if (w.do === undefined) err(`${p}.do`, 'do is the action (or list of actions) the wire runs');
    else wire.do = checkActions(w.do, `${p}.do`, err, ctx);
    wires.push(wire);
  });
  // a restart runs the start wires again: one among them would restart for ever
  const restarts = (actions) => (actions ?? []).some((a) => a.restart || restarts(a.then) || restarts(a.else));
  wires.forEach((w, i) => { if ((w.on === 'start' || w.on === `enter:${start}`) && restarts(w.do)) err(`interactive.wires[${i}].do`, `a restart in a "${w.on}" wire would restart the clip for ever: the restart runs it again`); });
  const out = { start, vars, scenes, wires };
  if (input.transition !== undefined) { const t = checkTransition(input.transition, 'interactive.transition', err); if (t) out.transition = t; }
  if (input.music !== undefined) {
    if (!Array.isArray(input.music) || !input.music.every((id) => audio.has(id))) err('interactive.music', 'music lists the audio items that loop for the whole session');
    else if (input.music.length) out.music = [...input.music];
  }
  // what the studio checks against the assets' declared events (it knows their definitions; this module does not)
  Object.defineProperty(out, 'sends', { value: ctx.sends, enumerable: false });
  return out;
}

/** Every scene transition the section names (the objects themselves, so the studio can pin them in place). */
export function transitionsOf(I) {
  const out = [];
  const walk = (actions) => {
    for (const a of actions ?? []) {
      if (isPlain(a.transition)) out.push(a.transition);
      walk(a.then); walk(a.else);
    }
  };
  if (isPlain(I.transition)) out.push(I.transition);
  for (const s of I.scenes) if (isPlain(s.transition)) out.push(s.transition);
  for (const w of I.wires) walk(w.do);
  return out;
}

/** Normalize an item's `when` (visual items of an interactive composition). */
export function checkWhen(when, path, err, vars, scenes) {
  checkCondition(when, path, err, { vars: new Set(Object.keys(vars)), scenes, initial: vars });
}

// ── binding: variables into params, `when` into hidden ──────────────────────────────────────────

const hasVar = (v) => (Array.isArray(v) ? v.some(hasVar) : isPlain(v) ? typeof v.$var === 'string' || Object.values(v).some(hasVar) : false);
const fill = (v, vars) => (Array.isArray(v) ? v.map((x) => fill(x, vars)) : isPlain(v) ? (typeof v.$var === 'string' ? vars[v.$var] : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)]))) : v);

/** The value of a wire value or condition operand. */
function valueOf(v, vars, event) {
  if (v === '$value') return event?.value;
  // "$value.combo": a field of an event whose value is an object (a region's value may be one)
  if (typeof v === 'string' && FIELD_RE.test(v)) return v.slice(7).split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), event?.value);
  if (isPlain(v)) {
    if (typeof v.$var === 'string') return vars[v.$var];
    if (v.$event === 'value') return event?.value;
  }
  return v;
}

/** Does a condition hold? */
export function holds(c, vars, scene, event) {
  if (c.all) return c.all.every((x) => holds(x, vars, scene, event));
  if (c.any) return c.any.some((x) => holds(x, vars, scene, event));
  if (c.not) return !holds(c.not, vars, scene, event);
  if (c.scene !== undefined) return list(c.scene).includes(scene);
  const a = vars[c.var];
  const op = COMPARE.find((k) => c[k] !== undefined);
  const b = valueOf(c[op], vars, event);
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    default: return a <= b;
  }
}

const bound = new WeakMap();
/**
 * The composition as one state draws it: every { $var } in item params filled with the variable's value and every
 * item whose `when` fails marked hidden. Items keep their ids; a composition without bindings comes back as is.
 * The bound composition carries a non-enumerable `links` map (item id → { param: variable }) for f.ui.changed: by id,
 * because an item laid out for a format is a copy.
 */
export function bindComposition(comp, vars, scene = null) {
  if (!comp.interactive) return comp;
  let plan = bound.get(comp);
  if (!plan) {
    plan = { items: new Set(), cache: null };
    for (const tr of comp.tracks) for (const item of tr.items) {
      if (item.when || hasVar(item.params) || Object.values(item.formats ?? {}).some((o) => hasVar(o.params))) plan.items.add(item);
    }
    bound.set(comp, plan);
  }
  if (!plan.items.size) return comp;
  const key = JSON.stringify([vars, scene]);
  if (plan.cache?.key === key) return plan.cache.comp;
  const links = new Map();
  const tracks = comp.tracks.map((tr) => {
    if (!tr.items.some((it) => plan.items.has(it))) return tr;
    return { ...tr, items: tr.items.map((it) => {
      if (!plan.items.has(it)) return it;
      const out = { ...it, params: fill(it.params, vars) };
      const hide = it.when && !holds(it.when, vars, scene);
      // a format's own hidden: false must not show an item whose `when` fails
      if (it.formats) out.formats = Object.fromEntries(Object.entries(it.formats).map(([f, o]) => [f, { ...o, ...(o.params ? { params: fill(o.params, vars) } : {}), ...(hide ? { hidden: true } : {}) }]));
      if (hide) out.hidden = true;
      links.set(it.id, Object.fromEntries(Object.entries(it.params).filter(([, v]) => isPlain(v) && typeof v.$var === 'string').map(([k, v]) => [k, v.$var])));
      return out;
    }) };
  });
  const out = { ...comp, tracks };
  Object.defineProperty(out, 'links', { value: links, enumerable: false });
  plan.cache = { key, comp: out };
  return out;
}

// ── the fold ────────────────────────────────────────────────────────────────────────────────────

/** The scene covering a timeline time (the design timeline: what a still, a check or the editor shows). */
export function sceneAt(comp, t) {
  const scenes = comp.interactive?.scenes ?? [];
  return scenes.find((s) => t >= s.start - 1e-9 && t < s.start + s.duration - 1e-9) ?? null;
}

const framesOf = (s, fps) => Math.max(1, Math.round(s.duration * fps));
const sceneOf = (comp, id) => comp.interactive.scenes.find((s) => s.id === id);

/**
 * The first state: the start scene entered at session frame `at` (0, or a restart's frame), `start` and
 * `enter:<start>` wires run. A restart carries the sounds already played over (carry).
 */
export function initialState(comp, at = 0, carry = null) {
  const I = comp.interactive;
  /** @type {any} */
  const s = {
    f: at, scene: I.start, entered: at, ended: false, history: [], tx: null,
    vars: { ...I.vars }, changed: {},
    pointer: carry?.pointer ?? null, capture: null, hover: null, focus: null, focusVisible: false,
    pressed: {}, inbox: {}, sounds: carry?.sounds ?? [], n: carry?.n ?? 0,
  };
  // a restart here would start again for ever: the runner refuses it
  const run = runner(comp, s, at, { starting: true });
  run.emit('start');
  run.emit(`enter:${s.scene}`);
  return s;
}

/**
 * Run wires and actions on state `s` (changed in place) at session frame `at`. Returns { emit(on, value) }.
 * Every effect is stamped with `at`, the first frame that shows it. A restart ends the event: nothing after it runs.
 */
function runner(comp, s, at, { starting = false } = {}) {
  const I = comp.interactive;
  const fps = comp.fps;
  let budget = MAX_ACTIONS, stopped = false;
  // the frame on screen when the event came, before any action ran: what a transition leaves (and holds)
  const prior = structuredClone(s);
  let leaving = null;
  const enter = (id, transition, remember = true) => {
    const from = (leaving ??= { scene: prior.scene, frame: playheadOf(comp, prior, at - 1), ui: viewOf(comp, prior, at - 1).ui });
    if (remember) { s.history.push(s.scene); if (s.history.length > 32) s.history.shift(); }
    const tx = transition === false ? null : (transition ?? sceneOf(comp, id).transition ?? I.transition ?? null);
    s.tx = tx ? { asset: tx.asset, params: tx.params ?? {}, frames: Math.max(1, Math.round(tx.duration * fps)), start: at, from } : null;
    s.scene = id; s.entered = at; s.ended = false;
    s.capture = null; s.focus = null; s.focusVisible = false; s.hover = null;
    emit(`enter:${id}`);
  };
  const set = (name, v) => {
    if (s.vars[name] === v) return;
    s.changed[name] = { from: s.vars[name], f: at };
    s.vars[name] = v;
  };
  function act(actions, event) {
    for (const a of actions) {
      if (stopped) return;
      if (--budget < 0) throw new Error(`the wires ran more than ${MAX_ACTIONS} actions for one event: do two wires trigger each other?`);
      if (a.go === 'back') {
        const id = s.history.pop();
        if (id) enter(id, a.transition, false);
      } else if (a.go !== undefined) {
        const scenes = I.scenes;
        enter(a.go === 'next' ? scenes[(scenes.findIndex((x) => x.id === s.scene) + 1) % scenes.length].id : a.go, a.transition);
      } else if (a.set) for (const [k, v] of Object.entries(a.set)) set(k, valueOf(v, s.vars, event));
      else if (a.add) {
        for (const [k, v] of Object.entries(a.add)) {
          let x = s.vars[k] + Number(valueOf(v, s.vars, event) ?? 0);
          if (a.wrap && a.min !== undefined && a.max !== undefined) { const span = a.max - a.min + 1; x = a.min + ((((x - a.min) % span) + span) % span); }
          if (a.min !== undefined) x = Math.max(a.min, x);
          if (a.max !== undefined) x = Math.min(a.max, x);
          set(k, round(x));
        }
      } else if (a.toggle) for (const k of list(a.toggle)) set(k, !s.vars[k]);
      else if (a.send) {
        const box = (s.inbox[a.send] ??= {});
        const prev = box[a.event];
        box[a.event] = { f: at, value: a.value === undefined ? event?.value ?? null : valueOf(a.value, s.vars, event), count: (prev?.count ?? 0) + 1 };
      } else if (a.play) {
        s.sounds.push({ item: a.play, f: at, n: ++s.n });
        if (s.sounds.length > KEEP) s.sounds.shift();
      } else if (a.if) act(holds(a.if, s.vars, s.scene, event) ? a.then : (a.else ?? []), event);
      else if (a.restart) {
        if (starting) throw new Error('a restart in a start or enter wire of the first scene would restart the clip for ever');
        // the rest of the event is dropped: it was written for the state the restart left
        const fresh = initialState(comp, at, s);
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, fresh);
        stopped = true;
        return;
      }
    }
  }
  function emit(on, value) {
    const scene = s.scene;
    const event = { value };
    for (const w of I.wires) {
      if (stopped) return;
      if (w.on !== on && !(w.on === 'key:any' && on.startsWith('key:'))) continue;
      if (w.scene !== undefined && !list(w.scene).includes(scene)) continue;
      if (w.if && !holds(w.if, s.vars, scene, event)) continue;
      act(w.do, event);
    }
  }
  return { emit, act };
}

/** The playhead frame (on the design timeline) state `s` shows at session frame n. */
export function playheadOf(comp, s, n) {
  const scene = sceneOf(comp, s.scene);
  const len = framesOf(scene, comp.fps);
  let k = Math.max(0, n - s.entered);
  k = scene.end === 'loop' ? k % len : Math.min(k, len - 1);
  return Math.round(scene.start * comp.fps) + k;
}

/**
 * Advance state `s` (not changed; a new state is returned) through the time triggers up to and including
 * session frame n: `end:<scene>` wires and each scene's end rule.
 */
export function advance(comp, s, n) {
  if (n < s.f) throw new Error(`the session cannot go back in time (at frame ${s.f}, asked for ${n})`);
  const out = structuredClone(s);
  // every pass ends a scene or stops: a scene's end moves `entered` forward (a scene lasts at least a frame)
  for (;;) {
    const scene = sceneOf(comp, out.scene);
    const due = out.entered + framesOf(scene, comp.fps);
    if (out.ended || due > n) break;
    out.ended = true;
    const run = runner(comp, out, due);
    run.emit(`end:${scene.id}`);
    if (out.scene === scene.id && out.entered < due) {
      if (scene.end === 'next') run.act([{ go: 'next' }]);
      else if (!SCENE_ENDS.includes(scene.end)) run.act([{ go: scene.end }]);
    }
  }
  if (out.tx && n >= out.tx.start + out.tx.frames) out.tx = null;
  out.f = n;
  return out;
}

// ── input ───────────────────────────────────────────────────────────────────────────────────────

/** Map a frame-pixel point into a region's own rectangle: [lx, ly]. */
function local(r, x, y) {
  const [a, b, c, d, e, f] = r.m;
  const det = a * d - b * c || 1e-12;
  const dx = x - e, dy = y - f;
  return [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
}

/** Is a frame-pixel point inside region r? */
export function inside(r, x, y) {
  const [lx, ly] = local(r, x, y);
  if (r.shape === 'circle') {
    const rx = r.w / 2, ry = r.h / 2;
    const nx = (lx - r.x - rx) / rx, ny = (ly - r.y - ry) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h;
}

/** The value a range region takes at a frame-pixel point. */
function rangeValue(r, x, y) {
  const [lx, ly] = local(r, x, y);
  const { min, max, step } = r.range;
  const u = r.range.axis === 'y' ? 1 - (ly - r.y) / r.h : (lx - r.x) / r.w;
  let v = min + Math.min(1, Math.max(0, u)) * (max - min);
  if (step) v = min + Math.round((v - min) / step) * step;
  return round(Math.min(max, Math.max(min, v)));
}

/** The regions input can reach: a modal region (a dialog's scrim) puts everything drawn before it out of reach. */
export function reachable(regions) {
  const i = regions.findLastIndex((r) => r.modal);
  return i >= 0 ? regions.slice(i) : regions;
}

/** The regions Tab walks through, in drawing order (the player lets Tab leave the clip past the last one). */
export const focusables = (regions) => reachable(regions).filter((r) => r.focus !== false);

const topmost = (regions, x, y) => { for (let i = regions.length - 1; i >= 0; i--) if (inside(regions[i], x, y)) return regions[i]; return null; };

/**
 * Apply the input events stamped with session frame j to state `s` (already advanced to j), reading each against
 * `regions`, the hit regions frame j drew. Returns the new state; its effects start at frame j + 1.
 * An event: { f, type: down|move|up|cancel|leave|key, x, y (frame pixels), pointer: mouse|touch|pen, key, shift }.
 */
export function applyInput(comp, s, j, events, drawn = []) {
  const regions = reachable(drawn);
  const out = structuredClone(s);
  const at = j + 1;
  const run = runner(comp, out, at);
  const byKey = (k) => regions.find((r) => r.key === k) ?? null;
  const activate = (r) => {
    out.pressed[r.key] = at;
    run.emit(`${r.item}.${r.name}`, r.value ?? null);
  };
  // a range's value as this frame's events leave it (two arrow presses in one frame make two steps)
  const ranged = new Map();
  const valueNow = (r) => ranged.get(r.key) ?? r.range.value;
  const change = (r, v) => {
    if (v === valueNow(r)) return;
    ranged.set(r.key, v);
    out.pressed[r.key] = at;
    run.emit(`${r.item}.${r.name}`, v);
  };
  const hoverAt = (x, y) => {
    const r = topmost(regions, x, y);
    const key = r?.key ?? null;
    if ((out.hover?.key ?? null) !== key) out.hover = key ? { key, f: at } : null;
  };
  const scene = out.scene, entered = out.entered;
  for (const ev of events) {
    // a scene change earlier in this frame's events: the regions belong to the scene that was drawn
    if ((out.scene !== scene || out.entered !== entered) && ev.type !== 'move' && ev.type !== 'leave') continue;
    if (ev.type === 'key') {
      const key = ev.key;
      if (key === 'Tab') {
        const stops = focusables(drawn);
        if (!stops.length) continue;
        const i = stops.findIndex((r) => r.key === out.focus);
        const next = i < 0 ? (ev.shift ? stops.length - 1 : 0) : (i + (ev.shift ? -1 : 1) + stops.length) % stops.length;
        out.focus = stops[next].key; out.focusVisible = true;
        continue;
      }
      const focused = out.focus ? byKey(out.focus) : null;
      if (focused && !focused.range && (key === 'Enter' || key === ' ')) { out.focusVisible = true; activate(focused); continue; }
      if (focused?.range && /^Arrow(Left|Right|Up|Down)$/.test(key)) {
        const { min, max } = focused.range;
        const step = focused.range.step || (max - min) / 20;
        const v = round(Math.min(max, Math.max(min, valueNow(focused) + (key === 'ArrowRight' || key === 'ArrowUp' ? step : -step))));
        out.focusVisible = true;
        change(focused, v);
        continue;
      }
      const hot = [...regions].reverse().find((r) => r.keys?.includes(key));
      if (hot) { if (hot.range) continue; activate(hot); continue; }
      run.emit(`key:${key}`);
      continue;
    }
    const { x, y } = ev;
    if (ev.type === 'leave') { out.pointer = null; out.hover = null; continue; }
    // a cancel has no position: the pointer stays where it was, released
    if (ev.type === 'cancel') { out.capture = null; if (out.pointer) out.pointer = { ...out.pointer, down: false }; continue; }
    out.pointer = { x, y, down: ev.type === 'down' ? true : ev.type === 'up' ? false : !!out.pointer?.down, type: ev.pointer ?? out.pointer?.type ?? 'mouse' };
    if (ev.type === 'move') {
      hoverAt(x, y);
      const cap = out.capture ? byKey(out.capture.key) ?? out.capture.region : null;
      if (cap?.range && out.pointer.down) change(cap, rangeValue(cap, x, y));
    } else if (ev.type === 'down') {
      hoverAt(x, y);
      const r = topmost(regions, x, y);
      if (!r) { out.focus = null; out.focusVisible = false; run.emit('tap'); continue; }
      out.capture = { key: r.key, region: r };
      if (r.focus !== false) { out.focus = r.key; out.focusVisible = false; }
      if (r.range) change(r, rangeValue(r, x, y));
      else if (r.press === 'down') activate(r);
    } else if (ev.type === 'up') {
      const cap = out.capture;
      out.capture = null;
      if (!cap) continue;
      const r = byKey(cap.key);
      if (r && !r.range && r.press !== 'down' && inside(r, x, y)) activate(r);
      if (ev.pointer === 'touch') out.hover = null;
    }
  }
  out.f = Math.max(out.f, at);
  return out;
}

// ── what a frame draws ──────────────────────────────────────────────────────────────────────────

/**
 * What frame n of a session draws, from state `s` (advanced to n): the playhead frame on the design timeline, the
 * `ui` the runtime turns into each item's f.ui, and the scene transition in progress (the outgoing frame and the asset).
 */
export function viewOf(comp, s, n) {
  const fps = comp.fps;
  const since = (f) => (n - f) / fps;
  const ui = {
    live: true, frame: n, now: n / fps, scene: s.scene, sceneT: since(s.entered), fps,
    vars: s.vars,
    changed: Object.fromEntries(Object.entries(s.changed).map(([k, c]) => [k, { from: c.from, since: since(c.f) }])),
    pointer: s.pointer, capture: s.capture?.key ?? null, focus: s.focus, focusVisible: s.focusVisible,
    hover: s.hover ? { key: s.hover.key, since: since(s.hover.f) } : null,
    pressed: Object.fromEntries(Object.entries(s.pressed).map(([k, f]) => [k, since(f)])),
    inbox: Object.fromEntries(Object.entries(s.inbox).map(([item, box]) => [item, Object.fromEntries(Object.entries(box).map(([e, x]) => [e, { since: since(x.f), value: x.value, count: x.count }]))])),
  };
  const view = { frame: playheadOf(comp, s, n), ui, transition: null };
  if (s.tx && n < s.tx.start + s.tx.frames) {
    const t = (n - s.tx.start) / fps;
    view.transition = { asset: s.tx.asset, params: s.tx.params, t, duration: s.tx.frames / fps, from: s.tx.from.frame, fromScene: s.tx.from.scene, fromUi: s.tx.from.ui };
  }
  return view;
}

/** The `ui` of a still: the design timeline at frame `frame`, nobody playing. */
export function staticUi(comp, frame) {
  const t = frame / comp.fps;
  const scene = sceneAt(comp, t);
  return { live: false, frame, now: t, scene: scene?.id ?? null, sceneT: scene ? t - scene.start : t, fps: comp.fps, vars: { ...(comp.interactive?.vars ?? {}) }, changed: {}, pointer: null, capture: null, focus: null, focusVisible: false, hover: null, pressed: {}, inbox: {} };
}

// ── sessions and replays ────────────────────────────────────────────────────────────────────────

/**
 * Replay a log: draw(view) → regions (async or not) draws a frame and returns its hit regions; `frames` are the
 * session frames to report. Calls back onFrame(n, view, state) for each. Returns the final state.
 * The same log gives the same states and the same views; with a pure draw, the same pixels.
 */
/** @param {any} comp @param {any[]} log @param {{ frames?: number[], draw: (view: any) => any, onFrame?: (n: number, view: any, state: any) => any }} o */
export async function replay(comp, log, { frames = [], draw, onFrame = async () => {} }) {
  const byFrame = new Map();
  for (const ev of log) { if (!byFrame.has(ev.f)) byFrame.set(ev.f, []); byFrame.get(ev.f).push(ev); }
  const marks = [...new Set([...byFrame.keys(), ...frames])].sort((a, b) => a - b);
  const want = new Set(frames);
  let s = initialState(comp);
  for (const n of marks) {
    s = advance(comp, s, n);
    const view = viewOf(comp, s, n);
    const evs = byFrame.get(n);
    if (want.has(n)) await onFrame(n, view, s);
    if (evs) {
      const regions = await draw(view);
      s = applyInput(comp, s, n, evs, regions ?? []);
    }
  }
  return s;
}

/**
 * Scripted steps (what an agent or a test writes) → a raw input log. A step is one of:
 *   { wait: seconds }                       let time run
 *   { tap: "<item>" | { item, region?, id? } }   press and release the middle of that item's region (found in the frame)
 *   { key: "ArrowRight", shift? }           a key press
 *   { down|move|up: { x, y } }              raw pointer input in frame pixels; pointer: mouse|touch|pen
 * Taps are resolved against the regions the frame draws, so `draw` is needed (as in replay). The log starts at frame
 * `from` (default 1); each step takes a frame (a tap two: press, then release). Returns { log, frames, state }.
 */
/** @param {any} comp @param {any[]} steps @param {{ draw: (view: any) => any, from?: number, pointer?: string }} o */
export async function stepsToLog(comp, steps, { draw, from = 1, pointer = 'mouse' }) {
  const log = [];
  let s = initialState(comp);
  // each logged frame is drawn and read exactly as a replay will: advance, draw, apply
  const at = async (n, make) => {
    s = advance(comp, s, n);
    const regions = (await draw(viewOf(comp, s, n))) ?? [];
    const events = make(regions);
    log.push(...events);
    s = applyInput(comp, s, n, events, regions);
  };
  let n = from;
  for (const [i, step] of steps.entries()) {
    if (!isPlain(step)) throw new Error(`step ${i}: a step is { wait }, { tap }, { key }, { down }, { move } or { up }`);
    if (step.wait !== undefined) { if (!num(step.wait) || step.wait < 0) throw new Error(`step ${i}: wait is seconds ≥ 0`); n += Math.max(1, Math.round(step.wait * comp.fps)); continue; }
    const kind = step.pointer ?? pointer;
    if (step.key !== undefined) { await at(n++, () => [{ f: n - 1, type: 'key', key: String(step.key), ...(step.shift ? { shift: true } : {}) }]); continue; }
    const raw = ['down', 'move', 'up'].find((k) => step[k] !== undefined);
    if (raw) { const p = step[raw]; await at(n++, () => [{ f: n - 1, type: raw, x: p.x, y: p.y, pointer: kind }]); continue; }
    if (step.tap === undefined) throw new Error(`step ${i}: unknown step ${JSON.stringify(step)}`);
    const want = typeof step.tap === 'string' ? { item: step.tap } : step.tap;
    let point = null;
    await at(n, (regions) => {
      const r = regions.find((x) => x.item === want.item && (want.region === undefined || x.name === want.region) && (want.id === undefined || String(x.id) === String(want.id)));
      if (!r) throw new Error(`step ${i}: nothing to tap on "${want.item}"${want.region ? ` (${want.region})` : ''} at ${(n / comp.fps).toFixed(2)}s in scene "${s.scene}"; regions there: ${regions.map((x) => `${x.item}.${x.name}${x.id !== undefined ? `#${x.id}` : ''}`).join(', ') || 'none'}`);
      const [a, b, c, d, e, f] = r.m;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      point = { x: Math.round((a * cx + c * cy + e) * 10) / 10, y: Math.round((b * cx + d * cy + f) * 10) / 10 };
      return [{ f: n, type: 'move', ...point, pointer: kind }, { f: n, type: 'down', ...point, pointer: kind }];
    });
    n += 1;
    await at(n, () => [{ f: n, type: 'up', ...point, pointer: kind }]);
    n += 1;
  }
  return { log, frames: n, state: s };
}

/** A short, comparable summary of a state: scene, variables, focus, and what is pressed. */
export function summary(s) {
  return { frame: s.f, scene: s.scene, vars: s.vars, focus: s.focus, history: s.history.slice(-4) };
}

/** Check a raw input log's shape; returns the sorted, normalized log. */
export function normalizeLog(log) {
  if (!Array.isArray(log)) throw new Error('a log is a list of input events { f, type, x, y, key, pointer }');
  return log.map((ev, i) => {
    if (!isPlain(ev) || !Number.isInteger(ev.f) || ev.f < 0) throw new Error(`log[${i}]: f is the session frame (an integer ≥ 0)`);
    if (!INPUT_TYPES.includes(ev.type)) throw new Error(`log[${i}]: type is one of ${INPUT_TYPES.join(', ')}`);
    if (ev.type === 'key') { if (typeof ev.key !== 'string' || !ev.key) throw new Error(`log[${i}]: a key event names its key`); return { f: ev.f, type: 'key', key: ev.key, ...(ev.shift ? { shift: true } : {}) }; }
    if (ev.type === 'leave' || ev.type === 'cancel') return { f: ev.f, type: ev.type };
    if (!num(ev.x) || !num(ev.y)) throw new Error(`log[${i}]: a pointer event has x and y in frame pixels`);
    return { f: ev.f, type: ev.type, x: ev.x, y: ev.y, pointer: ['mouse', 'touch', 'pen'].includes(ev.pointer) ? ev.pointer : 'mouse' };
  }).map((ev, i) => ({ ev, i })).sort((a, b) => a.ev.f - b.ev.f || a.i - b.i).map((x) => x.ev);
}
