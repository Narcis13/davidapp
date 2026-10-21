// What check_clip finds in the structure of an interactive composition, without drawing anything: the scenes a viewer can
// reach from the first one, the scenes they cannot leave, the variables nothing reads, and (given the hit regions the
// frames drew) the wires that listen to something no frame shows and the regions nothing listens to. Each finding is
// { check, key, severity, scene?, message, numbers, … }; checks.js adds the frame and the still.

import { SCENE_ENDS, parseOn } from '../core/interactive.js';

const list = (v) => (Array.isArray(v) ? v : [v]);

/** Every action of a list, the branches of nested `if` actions included. */
function* walk(actions) {
  for (const a of actions ?? []) {
    yield a;
    if (a.if !== undefined) { yield* walk(a.then); yield* walk(a.else); }
  }
}

/**
 * The scenes a wire can run in: those it listens in, narrowed by its event (`end:x` and `enter:x` belong to scene x, `start`
 * to the first scene).
 */
export function wireScenes(I, w) {
  const on = parseOn(w.on);
  const where = w.scene === undefined ? I.scenes.map((s) => s.id) : list(w.scene);
  if (on?.kind === 'end' || on?.kind === 'enter') return where.filter((id) => id === on.scene);
  if (on?.kind === 'start') return where.filter((id) => id === I.start);
  return where;
}

/**
 * How a viewer moves between scenes: the end rules (`next`, a scene id) and the `go` and `restart` actions of the wires, each
 * for every scene the wire runs in. `go: "back"` returns to a scene already visited, so it is no edge, only a way out (back).
 * A wire on an item event only runs in the scenes that draw a hit region for it (drawn: Map of scene id → Map of
 * "<item>.<event>" → true, as the frames showed; without it every scene counts).
 * → { edges: [{ from, to, via }], back: Set of scenes with a `go: "back"` }
 */
export function sceneGraph(I, drawn = null) {
  const ids = I.scenes.map((s) => s.id);
  const after = (id) => ids[(ids.indexOf(id) + 1) % ids.length];
  const edges = [], back = new Set();
  for (const s of I.scenes) {
    if (s.end === 'next') edges.push({ from: s.id, to: after(s.id), via: 'the scene ends' });
    else if (!SCENE_ENDS.includes(s.end)) edges.push({ from: s.id, to: s.end, via: 'the scene ends' });
  }
  for (const [i, w] of I.wires.entries()) {
    const item = parseOn(w.on)?.kind === 'item';
    for (const from of wireScenes(I, w).filter((id) => !drawn || !item || drawn.get(id)?.has(w.on))) for (const a of walk(w.do)) {
      if (a.go === 'back') back.add(from);
      else if (a.go !== undefined) edges.push({ from, to: a.go === 'next' ? after(from) : a.go, via: `wires[${i}] (${w.on})` });
      else if (a.restart) edges.push({ from, to: I.start, via: `wires[${i}] (${w.on})` });
    }
  }
  return { edges, back };
}

/** The scenes reachable from the first one through `edges`. */
export function reachable(I, edges) {
  const seen = new Set([I.start]);
  const queue = [I.start];
  while (queue.length) {
    const from = queue.shift();
    for (const e of edges) if (e.from === from && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  return seen;
}

/** Every variable something reads: a bound param ({ $var }), an item's `when`, a wire's `if`, an `if` action, a value ({ $var }). */
export function variablesRead(comp) {
  const I = comp.interactive;
  const read = new Set();
  const refs = (v) => {
    if (Array.isArray(v)) v.forEach(refs);
    else if (v !== null && typeof v === 'object') { if (typeof v.$var === 'string') read.add(v.$var); Object.values(v).forEach(refs); }
  };
  const condition = (c) => {
    if (c === null || typeof c !== 'object') return;
    if (typeof c.var === 'string') read.add(c.var);
    for (const x of [...(c.all ?? []), ...(c.any ?? [])]) condition(x);
    if (c.not !== undefined) condition(c.not);
  };
  for (const tr of comp.tracks) for (const it of tr.items) {
    refs(it.params); refs(it.formats); refs(it.when);
    if (it.when) condition(it.when);
  }
  for (const w of I.wires) {
    refs(w.if); refs(w.do);
    if (w.if) condition(w.if);
    for (const a of walk(w.do)) if (a.if !== undefined) condition(a.if);
  }
  return read;
}

/**
 * The findings about how the scenes connect: scenes no viewer can reach, scenes a viewer cannot leave, variables nothing reads
 * (drawn: see sceneGraph). → [{ check, key, severity, scene?, message, numbers }] (key tells findings of one check apart)
 */
export function structureIssues(comp, drawn = null) {
  const I = comp.interactive;
  const out = [];
  const { edges, back } = sceneGraph(I, drawn);
  const live = reachable(I, edges);
  for (const s of I.scenes) {
    if (!live.has(s.id)) {
      out.push({ check: 'unreachable-scene', key: s.id, severity: 'error', scene: s.id, message: `Scene "${s.id}" cannot be reached from the first scene ("${I.start}"): no go action, no end rule ("next" or a scene id) and no restart leads to it.`, numbers: { start: I.start, reachable: [...live] } });
      continue;
    }
    if (I.scenes.length < 2 || s.final || !['hold', 'loop'].includes(s.end)) continue;
    const exits = edges.filter((e) => e.from === s.id && e.to !== s.id);
    if (!exits.length && !back.has(s.id)) {
      out.push({ check: 'dead-end', key: s.id, severity: 'error', scene: s.id, message: `Scene "${s.id}" ${s.end === 'loop' ? 'loops' : 'holds'} forever: no wire running there goes to another scene, and its end is "${s.end}". Add a wire with a go action (on an item event, a key, a tap, or end:${s.id}), set end to "next" or a scene id, or mark the scene final: true if it is meant to be the last.`, numbers: { end: s.end } });
    }
  }
  const read = variablesRead(comp);
  for (const name of Object.keys(I.vars)) {
    if (!read.has(name)) out.push({ check: 'unused-variable', key: name, severity: 'info', message: `Variable "${name}" is never read: no param is bound to it ({ $var: "${name}" }), no item's when, wire condition or if action tests it.`, numbers: { initial: I.vars[name] } });
  }
  return out;
}

/**
 * The findings that need the hit regions the frames drew. drawn: Map of scene id → Map of "<item>.<event>" → true;
 * looked: { frames, states } how many were looked at (said in the message).
 * A wire that listens to an item event no frame of its scenes draws a region for can never run; a region no wire in its
 * scene listens to does nothing when it is pressed.
 * → [{ check, key, severity, scene?, item?, message, numbers }]
 */
export function wireIssues(comp, drawn, looked) {
  const I = comp.interactive;
  const out = [];
  const ids = I.scenes.map((s) => s.id);
  for (const [i, w] of I.wires.entries()) {
    const on = parseOn(w.on);
    if (on?.kind !== 'item') continue;
    const where = w.scene === undefined ? ids : list(w.scene);
    if (where.some((id) => drawn.get(id)?.has(w.on))) continue;
    const item = comp.tracks.flatMap((t) => t.items).find((it) => it.id === on.item);
    out.push({ check: 'no-target', key: `wire ${i}`, severity: 'error', item: on.item, ...(w.scene === undefined ? {} : { scene: where[0] }), message: `Wire ${i} listens to "${w.on}", but no frame of ${w.scene === undefined ? 'any scene' : `scene ${where.map((id) => `"${id}"`).join(', ')}`} draws a hit region "${on.event}" for item "${on.item}" (looked at ${looked.frames} frames and ${looked.states} states). Check that the item is on screen there (it runs ${item ? `${item.start}s to ${Math.round((item.start + item.duration) * 1000) / 1000}s${item.when ? ', with a when condition' : ''}` : 'nowhere'}) and that its asset calls f.ui.hit("${on.event}", …).`, numbers: { wire: w.on, scenes: where, item: item ? { start: item.start, duration: item.duration } : null } });
  }
  for (const [scene, events] of drawn) {
    for (const event of events.keys()) {
      const heard = I.wires.some((w) => w.on === event && wireScenes(I, w).includes(scene));
      if (!heard) out.push({ check: 'inert-region', key: `${scene}|${event}`, severity: 'info', item: event.slice(0, event.lastIndexOf('.')), scene, message: `Nothing listens to "${event}" in scene "${scene}": pressing it does nothing. Add a wire { on: "${event}", scene: "${scene}", do: [...] } or take the hit region out.`, numbers: { event } });
    }
  }
  return out;
}
