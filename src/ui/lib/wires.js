// An interactive composition's wires, scenes and variables as short plain sentences, for the editor's Interactive
// panel. Pure functions of the composition's `interactive` section (core/interactive.js has its shape): no DOM, no
// imports, so a test can run them in Node.

const OPS = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : [v]);
/** "demo-wipe@1" → "demo-wipe": the version is the studio's business, not the reader's. */
const slugOf = (ref) => String(ref).replace(/@\d+$/, '');
const seconds = (n) => `${Math.round(n * 100) / 100} s`;

/** A number, boolean or string as written, a variable by its name, the event's value as words. */
export function valueText(v) {
  if (v === '$value') return 'the event\'s value';
  if (isPlain(v)) {
    if (typeof v.$var === 'string') return v.$var;
    if (v.$event === 'value') return 'the event\'s value';
  }
  return typeof v === 'string' ? `"${v}"` : String(v);
}

/** A condition: `score ≥ 3`, `in play or win`, `a and (b or c)`. */
export function conditionText(c, nested = false) {
  if (!isPlain(c)) return String(c);
  if (c.all || c.any) {
    const parts = (c.all ?? c.any).map((x) => conditionText(x, true));
    const text = parts.join(c.all ? ' and ' : ' or ');
    return nested && parts.length > 1 ? `(${text})` : text;
  }
  if (c.not !== undefined) return `not ${conditionText(c.not, true)}`;
  if (c.scene !== undefined) return `in ${list(c.scene).join(' or ')}`;
  const op = Object.keys(OPS).find((k) => c[k] !== undefined);
  return op ? `${c.var} ${OPS[op]} ${valueText(c[op])}` : String(c.var);
}

/** One action: `go to play through demo-wipe 0.4 s`, `add 1 to score (max 5)`, `if score ≥ 3: go to win`. */
export function actionText(a) {
  if (a.go !== undefined) {
    const where = a.go === 'back' ? 'go back' : a.go === 'next' ? 'go to the next scene' : `go to ${a.go}`;
    if (a.transition === false) return `${where} (a cut)`;
    return isPlain(a.transition) ? `${where} through ${slugOf(a.transition.asset)} ${seconds(a.transition.duration)}` : where;
  }
  if (a.set) return `set ${Object.entries(a.set).map(([k, v]) => `${k} to ${valueText(v)}`).join(', ')}`;
  if (a.add) {
    const limits = [a.min !== undefined ? `min ${a.min}` : null, a.max !== undefined ? `max ${a.max}` : null, a.wrap ? 'wraps' : null].filter(Boolean);
    return `add ${Object.entries(a.add).map(([k, v]) => `${valueText(v)} to ${k}`).join(', ')}${limits.length ? ` (${limits.join(', ')})` : ''}`;
  }
  if (a.toggle !== undefined) return `toggle ${list(a.toggle).join(', ')}`;
  if (a.send !== undefined) return `send ${a.event} to ${a.send}${a.value !== undefined ? ` with ${valueText(a.value)}` : ''}`;
  if (a.play !== undefined) return `play ${a.play}`;
  if (a.if !== undefined) {
    const then = (a.then ?? []).map(actionText).join('; ') || 'nothing';
    return `if ${conditionText(a.if)}: ${then}${a.else ? `; otherwise ${a.else.map(actionText).join('; ')}` : ''}`;
  }
  if (a.restart) return 'restart';
  return JSON.stringify(a);
}

/** The event a wire listens to, as a short phrase for its tooltip. */
export function onText(on) {
  if (on === 'tap') return 'a press on nothing';
  if (on === 'start') return 'the session starts';
  let m = /^key:(.+)$/.exec(on);
  if (m) return m[1] === 'any' ? 'any key' : `the ${m[1] === ' ' ? 'Space' : m[1]} key`;
  m = /^(enter|end):(.+)$/.exec(on);
  if (m) return m[1] === 'enter' ? `scene ${m[2]} begins` : `scene ${m[2]} reaches its end`;
  return `${on.slice(0, on.lastIndexOf('.'))} fires ${on.slice(on.lastIndexOf('.') + 1)}`;
}

/** A wire as parts: { on, where ("in play"), when ("score ≥ 3"), actions: [sentence] }. */
export function wireParts(w) {
  return {
    on: w.on,
    where: w.scene !== undefined ? `in ${list(w.scene).join(' or ')}` : '',
    when: w.if ? conditionText(w.if) : '',
    actions: list(w.do ?? []).map(actionText),
  };
}

/** What a scene does at its end: `loops`, `holds`, `goes to play`; a final scene says so. */
export function endText(scene) {
  const end = scene.end === 'hold' ? 'holds' : scene.end === 'loop' ? 'loops' : scene.end === 'next' ? 'goes to the next scene' : `goes to ${scene.end}`;
  return scene.final ? `${end}, final` : end;
}

/** A scene's time range on the design timeline: `3 to 7 s`. */
export function rangeText(scene) {
  const n = (x) => String(Math.round(x * 100) / 100);
  return `${n(scene.start)} to ${n(scene.start + scene.duration)} s`;
}

/** Variables as `[name, first value]` pairs, in the order written. */
export const varsOf = (I) => Object.entries(I?.vars ?? {});

/** The scene whose range holds time `t` (the design timeline), else null. */
export function sceneAtTime(I, t) {
  return (I?.scenes ?? []).find((s) => t >= s.start - 1e-9 && t < s.start + s.duration - 1e-9) ?? null;
}
