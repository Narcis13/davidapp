// Interactive compositions: the section's validation, the state fold (scenes, wires, variables, input read
// against the hit regions a frame drew), f.ui in assets, scene transitions, and determinism: the same input
// log replayed twice gives the same frames. The runtime runs in-process on Skia at a small size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeComposition } from '../src/core/composition.js';
import { createRuntime, normalizeDefinition } from '../src/core/runtime.js';
import { initialState, advance, applyInput, viewOf, replay, stepsToLog, playheadOf, bindComposition, normalizeLog, parseOn } from '../src/core/interactive.js';
import { nodeHost, registerFonts, createCanvas } from '../src/render/host.js';
import { createSession, keyFor } from '../src/player/session.js';

registerFonts();

const ASSETS = {
  'ui-button@1': `asset({
    description: 'A test button that fires press when tapped.', tags: ['ui'],
    params: { label: { type: 'string', default: 'Go' }, x: { type: 'number', default: 20 }, color: { type: 'color', default: '#3366ff' } },
    events: { emits: { press: 'when tapped' }, accepts: { flash: 'blinks' } },
    render(f, p) {
      const s = f.ui.hit('press', p.x, 20, 80, 40, { keys: ['Enter'], label: p.label });
      const flash = f.ui.since('flash') < 0.2;
      f.ctx.fillStyle = flash ? '#ffffff' : s.down ? '#112266' : s.hover ? '#5577ff' : p.color;
      f.ctx.fillRect(p.x, 20, 80, 40);
      if (s.focus) { f.ctx.strokeStyle = '#ffcc00'; f.ctx.lineWidth = 3; f.ctx.strokeRect(p.x, 20, 80, 40); }
    },
  })`,
  'ui-count@1': `asset({
    description: 'A test counter that draws n squares.', tags: ['ui'],
    params: { n: { type: 'number', default: 0 } },
    render(f, p) {
      const c = f.ui.changed('n');
      f.ctx.fillStyle = c && c.since < 0.1 ? '#ff0000' : '#00ff00';
      for (let i = 0; i < p.n; i++) f.ctx.fillRect(10 + i * 12, 100, 10, 10);
    },
  })`,
  'ui-slider@1': `asset({
    description: 'A test slider that reports a value as it is dragged.', tags: ['ui'],
    params: { value: { type: 'number', default: 0.5 } },
    events: { emits: { change: 'the new value' } },
    render(f, p) {
      f.ui.hit('change', 20, 140, 200, 20, { range: { min: 0, max: 1, step: 0.1, value: p.value } });
      f.ctx.fillStyle = '#888'; f.ctx.fillRect(20, 148, 200, 4);
      f.ctx.fillStyle = '#fff'; f.ctx.fillRect(20 + p.value * 200 - 4, 140, 8, 20);
    },
  })`,
  'bg@1': `asset({ description: 'A flat test background in one colour.', tags: ['bg'], params: { color: { type: 'color', default: '#101018' } },
    render(f, p) { f.ctx.fillStyle = p.color; f.ctx.fillRect(0, 0, f.width, f.height); } })`,
  'tx-wipe@1': `asset({ kind: 'transition', description: 'A test wipe from left to right between two layers.', tags: ['tx'],
    render(f) { f.ctx.drawImage(f.from.canvas, 0, 0); const w = f.width * f.progress; f.ctx.drawImage(f.to.canvas, 0, 0, w, f.height, 0, 0, w, f.height); } })`,
};

function runtime() {
  const rt = createRuntime(nodeHost);
  rt.load(Object.fromEntries(Object.entries(ASSETS).map(([ref, source]) => [ref, { source }])));
  return rt;
}

/** A small game: a menu scene with a start button, a play scene where the button counts, a slider, a win scene. */
const RAW = {
  width: 320, height: 180, fps: 30, duration: 6, background: '#000000',
  tracks: [
    { id: 'bg', items: [{ id: 'bg1', asset: 'bg@1', start: 0, duration: 6, params: { color: '#101018' } }] },
    { id: 'ui', items: [
      { id: 'start', asset: 'ui-button@1', start: 0, duration: 2, params: { label: 'Start' } },
      { id: 'hit', asset: 'ui-button@1', start: 2, duration: 2, params: { label: 'Hit', x: 120 } },
      { id: 'count', asset: 'ui-count@1', start: 2, duration: 2, params: { n: { $var: 'score' } } },
      { id: 'level', asset: 'ui-slider@1', start: 2, duration: 2, params: { value: { $var: 'level' } } },
      { id: 'won', asset: 'bg@1', start: 4, duration: 2, params: { color: '#225522' }, when: { var: 'score', gte: 3 } },
    ] },
  ],
  interactive: {
    vars: { score: 0, level: 0.5 },
    scenes: [{ id: 'menu', start: 0, duration: 2, end: 'loop' }, { id: 'play', start: 2, duration: 2 }, { id: 'win', start: 4, duration: 2, final: true }],
    wires: [
      { on: 'start.press', do: { go: 'play', transition: { asset: 'tx-wipe@1', duration: 0.2 } } },
      { on: 'hit.press', do: [{ add: { score: 1 }, max: 5 }, { send: 'hit', event: 'flash' }, { if: { var: 'score', gte: 3 }, then: [{ go: 'win' }] }] },
      { on: 'level.change', do: { set: { level: '$value' } } },
      { on: 'key:Escape', scene: 'play', do: { go: 'back' } },
      { on: 'key:r', do: { restart: true } },
    ],
  },
};

const comp = () => {
  const { composition, errors } = normalizeComposition(RAW);
  assert.deepEqual(errors, []);
  return composition;
};

/** draw(view) as a player or a replay calls it: render the frame, return its regions (and keep the pixels' hash). */
function drawer(rt, c) {
  const canvas = createCanvas(c.width, c.height);
  const hashes = [];
  const draw = (view) => {
    const r = rt.renderClipFrame(canvas.getContext('2d'), c, view.frame, { ui: view.ui, transition: view.transition });
    hashes.push(createHash('sha256').update(canvas.data()).digest('hex'));
    return r.regions;
  };
  return { draw, hashes, canvas };
}

test('a reserved id is refused, and a send to one does not change Object.prototype', () => {
  const bad = normalizeComposition(JSON.parse(`{
    "width": 320, "height": 180, "duration": 1, "fps": 30,
    "tracks": [{ "id": "__proto__", "type": "visual", "items": [{ "id": "constructor", "asset": "text@1", "start": 0, "duration": 1, "params": {} }] }],
    "interactive": { "vars": { "__proto__": 1, "score": 0 }, "scenes": [{ "id": "prototype", "start": 0, "duration": 1, "end": "hold" }],
      "wires": [{ "on": "start", "do": [{ "send": "constructor", "event": "__proto__" }] }] }
  }`));
  const paths = bad.errors.map((e) => e.path);
  for (const p of ['tracks[0].id', 'tracks[0].items[0].id', 'interactive.vars.__proto__', 'interactive.scenes[0].id', 'interactive.wires[0].do[0].event']) assert.ok(paths.includes(p), paths.join(', '));
  const comp = {
    fps: 30,
    interactive: {
      start: 'main', vars: { score: 0 },
      scenes: [{ id: 'main', start: 0, duration: 1, end: 'hold' }],
      wires: [{ on: 'start', do: [{ send: '__proto__', event: 'pwned', value: 1 }] }],
    },
  };
  try {
    const s = initialState(comp);
    const proto = /** @type {any} */ (Object.prototype);
    assert.equal(s.inbox['__proto__'].pwned.value, 1);
    assert.equal(proto.pwned, undefined);
    assert.equal((/** @type {any} */ ({})).pwned, undefined);
  } finally {
    delete (/** @type {any} */ (Object.prototype)).pwned;
  }
});

test('interactive: the section normalizes, and its mistakes are named with their paths', () => {
  const c = comp();
  assert.equal(c.interactive.start, 'menu');
  assert.equal(c.tracks[1].items[4].when.var, 'score');
  const bad = normalizeComposition({ ...RAW, interactive: { ...RAW.interactive, start: 'nope', wires: [{ on: 'ghost.press', do: { go: 'nowhere' } }, { on: 'start.press', do: { add: { lives: 1 } } }] } });
  const paths = bad.errors.map((e) => e.path);
  assert.ok(paths.includes('interactive.start'));
  assert.ok(paths.includes('interactive.wires[0].on'));
  assert.ok(paths.includes('interactive.wires[0].do[0].go'));
  assert.ok(paths.includes('interactive.wires[1].do[0].add.lives'));
  // when and cue only exist in interactive compositions; a video composition normalizes as before
  const video = normalizeComposition({ ...RAW, interactive: undefined });
  assert.ok(video.errors.some((e) => e.path.endsWith('.when')));
  const plain = normalizeComposition({ width: 320, height: 180, duration: 1, tracks: [] });
  assert.equal(plain.composition.interactive, undefined);
  assert.deepEqual(parseOn('a.b.press'), { kind: 'item', item: 'a.b', event: 'press' });
  assert.deepEqual(parseOn('key:ArrowRight'), { kind: 'key', key: 'ArrowRight' });
});

test('interactive: asset definitions declare their events', () => {
  const def = normalizeDefinition({ description: 'A button for the tests here.', tags: ['ui'], events: { emits: ['press'] }, render() {} });
  assert.deepEqual(def.events, { emits: { press: '' }, accepts: {} });
  assert.equal(normalizeDefinition({ description: 'No events declared at all.', tags: ['ui'], render() {} }).events, null);
  assert.throws(() => normalizeDefinition({ description: 'Bad events declared here.', tags: ['ui'], events: { fires: [] }, render() {} }), /events is/);
});

test('interactive: binding fills { $var } params and hides items whose when fails', () => {
  const c = comp();
  const b = bindComposition(c, { score: 2, level: 0.3 }, 'play');
  const items = Object.fromEntries(b.tracks[1].items.map((i) => [i.id, i]));
  assert.equal(items.count.params.n, 2);
  assert.equal(items.level.params.value, 0.3);
  assert.equal(items.won.hidden, true);
  assert.equal(bindComposition(c, { score: 2, level: 0.3 }, 'play'), b, 'the same state binds once');
  assert.equal(bindComposition(c, { score: 3, level: 0.3 }, 'win').tracks[1].items[4].hidden, undefined);
});

test('interactive: scenes hold, loop and move on with time', () => {
  const c = comp();
  let s = initialState(c);
  assert.equal(s.scene, 'menu');
  // menu loops: 60 frames, playhead wraps
  assert.equal(playheadOf(c, advance(c, s, 75), 75), 15);
  s = applyInput(c, advance(c, s, 10), 10, [{ f: 10, type: 'key', key: 'r' }], []);
  assert.equal(s.entered, 11, 'restart enters the start scene on the next frame');
});

test('interactive: input is read against the regions the frame drew', async () => {
  const c = comp();
  const rt = runtime();
  const { draw } = drawer(rt, c);
  let s = advance(c, initialState(c), 5);
  const regions = draw(viewOf(c, s, 5));
  assert.deepEqual(regions.map((r) => r.key), ['start:press:']);
  assert.equal(regions[0].label, 'Start');
  // a press outside every region is a tap; a press and release on the button fires press → play
  s = applyInput(c, s, 5, [{ f: 5, type: 'down', x: 300, y: 170 }, { f: 5, type: 'up', x: 300, y: 170 }], regions);
  assert.equal(s.scene, 'menu');
  s = applyInput(c, advance(c, s, 6), 6, [{ f: 6, type: 'down', x: 50, y: 40 }, { f: 6, type: 'up', x: 50, y: 40 }], regions);
  assert.equal(s.scene, 'play');
  assert.equal(s.entered, 7);
  const v = viewOf(c, s, 8);
  assert.equal(v.frame, 61, 'the playhead is one frame into the play scene');
  assert.ok(v.transition && v.transition.asset === 'tx-wipe@1', 'the wipe runs');
  // keyboard: Tab focuses the first region, Enter fires it
  s = advance(c, s, 20);
  const r2 = draw(viewOf(c, s, 20));
  assert.deepEqual(r2.map((r) => `${r.item}.${r.name}`), ['hit.press', 'level.change']);
  s = applyInput(c, s, 20, [{ f: 20, type: 'key', key: 'Tab' }, { f: 20, type: 'key', key: 'Enter' }], r2);
  assert.equal(s.vars.score, 1);
  assert.equal(s.focus, 'hit:press:');
  // a hotkey fires the region that declares it; the slider takes the value under the pointer and arrow keys
  s = applyInput(c, advance(c, s, 21), 21, [{ f: 21, type: 'down', x: 20 + 0.8 * 200, y: 150 }, { f: 21, type: 'up', x: 180, y: 150 }], r2);
  assert.equal(s.vars.level, 0.8);
  assert.equal(viewOf(c, s, 23).ui.changed.score.from, 0);
});

test('interactive: f.ui reports hover, focus and what the clip sent the item', () => {
  const c = comp();
  const rt = runtime();
  const { draw, canvas } = drawer(rt, c);
  const g = canvas.getContext('2d');
  const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
  let s = advance(c, initialState(c), 3);
  s = applyInput(c, s, 3, [{ f: 3, type: 'move', x: 50, y: 40 }], draw(viewOf(c, s, 3)));
  draw(viewOf(c, s, 4));
  assert.deepEqual(at(50, 40), [0x55, 0x77, 0xff], 'hovered');
  s = applyInput(c, s, 4, [{ f: 4, type: 'down', x: 50, y: 40 }], draw(viewOf(c, s, 4)));
  draw(viewOf(c, s, 5));
  assert.deepEqual(at(50, 40), [0x11, 0x22, 0x66], 'held down');
  // in the play scene, a press on "hit" sends it flash: white for 0.2 s
  s = applyInput(c, advance(c, s, 5), 5, [{ f: 5, type: 'up', x: 50, y: 40 }], draw(viewOf(c, s, 5)));
  s = advance(c, s, 30);
  const regions = draw(viewOf(c, s, 30));
  s = applyInput(c, s, 30, [{ f: 30, type: 'down', x: 150, y: 40 }, { f: 30, type: 'up', x: 150, y: 40 }], regions);
  draw(viewOf(c, s, 31));
  assert.deepEqual(at(130, 30), [255, 255, 255], 'flash just received');
  draw(viewOf(c, advance(c, s, 40), 40));
  assert.notDeepEqual(at(130, 30), [255, 255, 255], 'flash over');
  // the still (no session): f.ui is quiet and the design timeline draws with the first values
  const still = rt.renderClipFrame(g, c, 70, {});
  assert.equal(still.regions.length, 2);
});

test('interactive: the same log replayed twice gives identical frames (and a whole game is scripted by steps)', async () => {
  const c = comp();
  const steps = [{ wait: 0.2 }, { tap: 'start' }, { wait: 0.4 }, { tap: 'hit' }, { tap: 'hit' }, { key: 'Tab' }, { key: 'Enter' }, { wait: 0.5 }];
  const a = drawer(runtime(), c);
  const { log, frames, state } = await stepsToLog(c, steps, { draw: a.draw });
  assert.equal(state.scene, 'win');
  assert.equal(state.vars.score, 3);
  const sample = Array.from({ length: Math.ceil(frames / 3) }, (_, i) => i * 3);
  const run = async () => {
    const d = drawer(runtime(), c);
    const out = [];
    const end = await replay(c, normalizeLog(JSON.parse(JSON.stringify(log))), { frames: sample, draw: d.draw, onFrame: (n, view) => { d.draw(view); out.push(d.hashes.at(-1)); } });
    return { out, end };
  };
  const one = await run(), two = await run();
  assert.equal(one.end.scene, 'win');
  assert.deepEqual(one.out, two.out);
  assert.ok(new Set(one.out).size > 4, 'the frames change along the way');
});

test('interactive: a wire loop is stopped with a message, not a hang', () => {
  const { composition, errors } = normalizeComposition({ ...RAW, interactive: { ...RAW.interactive, wires: [{ on: 'enter:play', do: { go: 'play' } }, { on: 'start.press', do: { go: 'play' } }] } });
  assert.deepEqual(errors, []);
  const s = advance(composition, initialState(composition), 2);
  const regions = [{ key: 'start:press:', item: 'start', name: 'press', m: [1, 0, 0, 1, 0, 0], x: 0, y: 0, w: 100, h: 100, value: null }];
  assert.throws(() => applyInput(composition, s, 2, [{ f: 2, type: 'down', x: 5, y: 5 }, { f: 2, type: 'up', x: 5, y: 5 }], regions), /more than 256 actions/);
});

test('interactive: the studio saves, checks and plays an interactive clip, and refuses to render it to MP4', async () => {
  const { tempStudio, AUTHOR } = await import('./helpers.js');
  const t = tempStudio();
  const { studio } = t;
  try {
    await studio.clips.createClip({ slug: 'game', title: 'Game', author: AUTHOR, width: 320, height: 180, fps: 30, duration: 6 });
    for (const [ref, source] of Object.entries(ASSETS)) await studio.library.createAsset({ slug: ref.split('@')[0], source, author: AUTHOR, forClip: 'game' });
    const unpinned = JSON.parse(JSON.stringify(RAW).replace(/@1"/g, '"'));
    // a wire on an event the asset does not emit, and a send it does not accept, are refused with the item named
    const bad = structuredClone(unpinned);
    bad.interactive.wires.push({ on: 'count.press', do: { go: 'win' } }, { on: 'start.press', do: { send: 'count', event: 'flash' } });
    await assert.rejects(studio.clips.updateClip('game', { composition: bad, by: AUTHOR }), (/** @type {any} */ e) => /item "count" \(ui-count@1\) does not emit "press"/.test(e.message) && /does not react to "flash"/.test(e.message));
    const saved = await studio.clips.updateClip('game', { composition: unpinned, by: AUTHOR });
    assert.equal(saved.clip.composition.interactive.wires[0].do[0].transition.asset, 'tx-wipe@1', 'scene transitions are pinned');
    assert.deepEqual(saved.clip.composition.tracks[1].items[2].params, { n: { $var: 'score' } }, 'bindings are saved as written');
    assert.throws(() => studio.renders.enqueue({ clip: 'game' }), /interactive: it is played, not rendered/);
    const steps = [{ wait: 0.2 }, { tap: 'start' }, { wait: 0.4 }, { tap: 'hit' }, { tap: 'hit' }, { tap: 'hit' }, { wait: 0.2 }];
    const a = await studio.play({ clip: 'game', steps, frames: [0, 10, 40, 60], stills: true });
    assert.equal(a.end.scene, 'win');
    assert.equal(a.frames.length, 4);
    assert.ok(a.frames[0].png.length > 100);
    const b = await studio.play({ clip: 'game', log: a.log, frames: [0, 10, 40, 60] });
    assert.deepEqual(b.frames.map((x) => x.hash), a.frames.map((x) => x.hash), 'the log replays to the same frames');
  } finally {
    await t.cleanup();
  }
});

test('interactive: a transition holds the frame that was on screen, before the event\'s own actions', () => {
  const raw = /** @type {any} */ (structuredClone(RAW));
  raw.interactive.wires[0] = { on: 'start.press', do: [{ add: { score: 2 } }, { go: 'play', transition: { asset: 'tx-wipe@1', duration: 0.2 } }] };
  const { composition: c } = normalizeComposition(raw);
  const r = [{ key: 'start:press:', item: 'start', name: 'press', m: [1, 0, 0, 1, 0, 0], x: 0, y: 0, w: 100, h: 100, value: null }];
  const s = applyInput(c, advance(c, initialState(c), 10), 10, [{ f: 10, type: 'down', x: 5, y: 5 }, { f: 10, type: 'up', x: 5, y: 5 }], r);
  assert.equal(s.vars.score, 2);
  const tx = viewOf(c, s, 12).transition;
  assert.equal(tx.fromScene, 'menu');
  assert.equal(tx.from, 10, 'the playhead frame that was on screen');
  assert.equal(tx.fromUi.vars.score, 0, 'the variables as that frame drew them');
});

test('interactive: a restart ends the event; one in a start wire is refused', () => {
  const raw = /** @type {any} */ (structuredClone(RAW));
  raw.interactive.wires = [{ on: 'key:r', do: [{ add: { score: 1 } }, { restart: true }, { add: { score: 5 } }] }, { on: 'key:r', do: { go: 'win' } }];
  const { composition: c } = normalizeComposition(raw);
  const s = applyInput(c, advance(c, initialState(c), 10), 10, [{ f: 10, type: 'key', key: 'r' }], []);
  assert.equal(s.scene, 'menu');
  assert.equal(s.vars.score, 0, 'nothing after the restart ran, neither in its list nor in other wires');
  const bad = normalizeComposition({ ...RAW, interactive: { ...RAW.interactive, wires: [{ on: 'enter:menu', do: { if: { var: 'score', eq: 0 }, then: [{ restart: true }] } }] } });
  assert.ok(bad.errors.some((e) => /restart the clip for ever/.test(e.message)));
});

test('interactive: a cancel keeps the pointer where it was; a modal region keeps focus and keys inside it', () => {
  const c = comp();
  const at = (k, x) => ({ key: k, item: k.split(':')[0], name: k.split(':')[1], m: [1, 0, 0, 1, 0, 0], x, y: 0, w: 10, h: 10, value: null });
  let s = applyInput(c, advance(c, initialState(c), 2), 2, [{ f: 2, type: 'down', x: 50, y: 40 }, { f: 2, type: 'cancel' }], []);
  assert.deepEqual([s.pointer.x, s.pointer.y, s.pointer.down], [50, 40, false]);
  const regions = [at('start:press:', 0), { ...at('level:change:', 20), modal: true, focus: false }, at('hit:press:', 40)];
  s = applyInput(c, s, 3, [{ f: 3, type: 'key', key: 'Tab' }, { f: 3, type: 'key', key: 'Tab' }], regions);
  assert.equal(s.focus, 'hit:press:', 'Tab never reaches a region behind the modal');
});

test('interactive: f.ui.changed follows a bound param on an item laid out for its format', () => {
  const raw = /** @type {any} */ (structuredClone(RAW));
  raw.tracks[1].items[2].formats = { horizontal: { opacity: 1 } };
  const { composition: c } = normalizeComposition(raw);
  const rt = runtime();
  const { canvas } = drawer(rt, c);
  const g = canvas.getContext('2d');
  let s = { ...advance(c, initialState(c), 70), scene: 'play', entered: 60 };
  s = { ...s, vars: { ...s.vars, score: 1 }, changed: { score: { from: 0, f: 70 } } };
  const v = viewOf(c, s, 71);
  rt.renderClipFrame(g, c, v.frame, { ui: v.ui });
  assert.deepEqual(Array.from(g.getImageData(15, 105, 1, 1).data.slice(0, 3)), [255, 0, 0], 'the counter flashes on its change');
});

test('interactive: the live session draws a frame back just after its slot without losing the next; a slow one skips by the clock', async () => {
  let t = 0;
  const rafs = [], replies = [], shown = [];
  const s = createSession(comp(), {
    now: () => t,
    raf: (fn) => rafs.push(fn),
    cancel: () => {},
    draw: () => new Promise((resolve) => replies.push(() => resolve([]))),
    onFrame: (n) => shown.push(n),
  });
  const settle = () => new Promise((r) => setImmediate(r));
  const vsync = async (at) => { t = at; for (const fn of rafs.splice(0)) fn(); await settle(); };
  const reply = async (at) => { t = at; replies.shift()(); await settle(); };
  const slot = 1000 / 30;
  s.start();
  await vsync(0); await reply(5);
  await vsync(slot + 0.1);
  await vsync(2 * slot + 0.1);       // frame 1 is not back yet: this animation frame finds the session busy
  await reply(2 * slot + 0.5);       // back just after the slot
  assert.deepEqual(shown, [0, 1]);
  assert.equal(replies.length, 1, 'frame 2 is asked for at once, not at the next animation frame');
  await reply(2 * slot + 6);
  assert.deepEqual(shown, [0, 1, 2]);
  // a draw that takes two slots: the clock has moved on, and the frame it passed is skipped
  await vsync(3 * slot + 0.1);
  await vsync(4 * slot + 0.1);
  await reply(5 * slot + 1);
  await reply(5 * slot + 6);
  assert.deepEqual(shown, [0, 1, 2, 3, 5]);
  s.stop();
});

test('interactive: the live session sets its clock between animation frames, so their jitter neither skips nor repeats a frame', async () => {
  const slot = 1000 / 30;
  const run = async (stamped) => {
    let t = 0;
    const rafs = [], shown = [];
    const s = createSession(comp(), { now: () => t, raf: (fn) => rafs.push(fn), cancel: () => {}, draw: async () => [], onFrame: (n) => shown.push(n) });
    s.start();
    for (let k = 1; k <= 30; k++) {
      // animation frames right at the clip's frame boundaries, a little early or late each time
      const ts = k * slot + (k % 2 ? 0.4 : -0.3);
      t = ts;
      for (const fn of rafs.splice(0)) fn(stamped ? ts : undefined);
      await new Promise((r) => setImmediate(r));
    }
    s.stop();
    return shown;
  };
  const aligned = await run(true);
  assert.equal(aligned.length, 30, 'a frame for every animation frame');
  assert.ok(aligned.every((n, i) => i === 0 || n === aligned[i - 1] + 1), `none skipped or repeated: ${aligned}`);
  const unaligned = await run(false);
  assert.ok(unaligned.length < 30, 'read at the boundary, the same jitter skips frames');
});

test('interactive: on a screen at twice the clip\'s rate the live session holds each frame two refreshes, evenly', async () => {
  const slot = 1000 / 30;
  let t = 0, k = 0;
  const rafs = [], at = [];
  const s = createSession(comp(), { now: () => t, raf: (fn) => rafs.push(fn), cancel: () => {}, draw: async () => [], onFrame: () => at.push(k) });
  s.start();
  for (k = 1; k <= 60; k++) {
    // every other animation frame lands on a frame boundary of the clip, a little early or late by turns
    const ts = (k * slot) / 2 + (k % 4 === 0 ? -0.3 : 0.3);
    t = ts;
    for (const fn of rafs.splice(0)) fn(ts);
    await new Promise((r) => setImmediate(r));
  }
  s.stop();
  const holds = at.slice(2).map((x, i) => x - at[i + 1]);
  assert.ok(holds.length > 25 && holds.every((h) => h === 2), `two refreshes each: ${holds}`);
});

// ── production review, 22 October 2026: each defect the review found, proven fixed ───────────────────────

test('interactive: a region drawn at scale 0 is not hittable, and a tap there is a tap on nothing', () => {
  const raw = /** @type {any} */ (structuredClone(RAW));
  raw.tracks[1].items[0].transform = { x: 0.5, y: 0.5, width: 1, height: 1, scale: 0 };
  raw.interactive.wires.push({ on: 'tap', do: { set: { level: 0.1 } } });
  const { composition: c, errors } = normalizeComposition(raw);
  assert.deepEqual(errors, []);
  const { draw } = drawer(runtime(), c);
  const s = advance(c, initialState(c), 5);
  const regions = draw(viewOf(c, s, 5));
  assert.deepEqual(regions, [], 'a box squashed to a point has no region');
  // a region that came in with a singular matrix (a log made before this fix) maps every point outside itself
  const flat = [{ key: 'start:press:', item: 'start', name: 'press', m: [0, 0, 0, 0, 160, 90], x: 0, y: 0, w: 80, h: 40, value: null }];
  const after = applyInput(c, s, 5, [{ f: 5, type: 'down', x: 5, y: 5 }, { f: 5, type: 'up', x: 5, y: 5 }], flat);
  assert.equal(after.scene, 'menu', 'the start button did not fire');
  assert.equal(after.vars.level, 0.1, 'the press landed on nothing');
});

test('interactive: an item called toString gets what is sent to it, and the maps stay null-prototype across copies', () => {
  const c = {
    fps: 30,
    interactive: {
      start: 'main', vars: { toString: 0 },
      scenes: [{ id: 'main', start: 0, duration: 1, end: 'hold' }],
      wires: [{ on: 'key:f', do: [{ send: 'toString', event: 'flash', value: 2 }, { add: { toString: 1 } }] }],
    },
  };
  let s = initialState(c);
  s = applyInput(c, advance(c, s, 3), 3, [{ f: 3, type: 'key', key: 'f' }], []);
  s = applyInput(c, advance(c, s, 4), 4, [{ f: 4, type: 'key', key: 'f' }], []);
  assert.equal(s.inbox.toString.flash.count, 2);
  assert.equal(s.vars.toString, 2);
  for (const k of ['vars', 'changed', 'pressed', 'inbox']) assert.equal(Object.getPrototypeOf(s[k]), null, `${k} after two copies`);
  assert.equal(/** @type {any} */ (Object.prototype.toString).flash, undefined);
});

test('interactive: a restart the start wires reach through another scene is refused when the clip is saved', () => {
  const raw = /** @type {any} */ (structuredClone(RAW));
  raw.interactive.wires = [{ on: 'start', do: { go: 'play' } }, { on: 'enter:play', do: { go: 'next' } }, { on: 'enter:win', do: { restart: true } }];
  const bad = normalizeComposition(raw);
  assert.ok(bad.errors.some((e) => e.path === 'interactive.wires[2].do' && /restart the clip for ever/.test(e.message)), JSON.stringify(bad.errors));
  // the same restart behind a press is fine: the clip starts, and a press restarts it once
  raw.interactive.wires = [{ on: 'start', do: { go: 'play' } }, { on: 'hit.press', do: { restart: true } }];
  assert.deepEqual(normalizeComposition(raw).errors, []);
});

test('interactive: variables never become NaN, and wrap works on fractions', () => {
  const at = (raw) => normalizeComposition({ ...RAW, interactive: { ...RAW.interactive, vars: { ...RAW.interactive.vars, name: 'x', hue: 0.9 }, wires: raw } });
  const paths = (wires) => at(wires).errors.map((e) => e.path);
  assert.ok(paths([{ on: 'key:a', do: { add: { score: 'abc' } } }]).includes('interactive.wires[0].do[0].add.score'));
  assert.ok(paths([{ on: 'key:a', do: { set: { score: 'ten' } } }]).includes('interactive.wires[0].do[0].set.score'));
  assert.ok(paths([{ on: 'key:a', do: { set: { score: { $var: 'name' } } } }]).includes('interactive.wires[0].do[0].set.score'));
  assert.ok(paths([{ on: 'key:a', do: { add: { score: 1 }, min: 5, max: 4 } }]).includes('interactive.wires[0].do[0].min'));
  assert.deepEqual(paths([{ on: 'level.change', do: { set: { level: '$value' } } }]), [], 'an event value may set any variable');
  // at run time: a value that is not a finite number changes nothing; 0.9 + 0.2 in 0–1 wraps to 0.1; lanes 0–3 wrap 3 + 1 to 0
  const { composition: c } = at([
    { on: 'key:n', do: { set: { level: '$value' } } },
    { on: 'key:h', do: { add: { hue: 0.2 }, min: 0, max: 1, wrap: true } },
    { on: 'key:l', do: { add: { score: 1 }, min: 0, max: 3, wrap: true } },
  ]);
  let s = advance(c, initialState(c), 2);
  const fire = (key) => { s = applyInput(c, advance(c, s, s.f + 1), s.f + 1, [{ f: s.f + 1, type: 'key', key }], []); };
  fire('h');
  assert.equal(s.vars.hue, 0.1);
  for (let i = 0; i < 4; i++) fire('l');
  assert.equal(s.vars.score, 0);
  // an event value of NaN (a broken slider): the wire leaves the variable alone
  const region = { key: 'level:change:', item: 'level', name: 'change', m: [1, 0, 0, 1, 0, 0], x: 0, y: 0, w: 100, h: 20, value: null, range: { min: NaN, max: NaN, step: 0, value: 0.5, axis: 'x' } };
  const { composition: c2 } = at([{ on: 'level.change', do: { set: { level: '$value' } } }]);
  const s2 = applyInput(c2, advance(c2, initialState(c2), 2), 2, [{ f: 2, type: 'down', x: 50, y: 10 }, { f: 2, type: 'up', x: 50, y: 10 }], [region]);
  assert.equal(s2.vars.level, 0.5);
});

test('interactive: each input event has its own action budget; one event that loops is still stopped', () => {
  const raw = /** @type {any} */ (structuredClone(RAW));
  raw.interactive.wires = [{ on: 'key:a', do: [{ add: { score: 1 } }, { add: { score: -1 } }] }];
  const { composition: c } = normalizeComposition(raw);
  const keys = Array.from({ length: 300 }, () => ({ f: 3, type: 'key', key: 'a' }));
  const s = applyInput(c, advance(c, initialState(c), 3), 3, keys, []);
  assert.equal(s.vars.score, 0, '300 presses in one frame, 600 actions, none refused');
});

test('interactive: a log or steps past an hour are refused, and steps make a log a replay accepts', async () => {
  const c = comp();
  assert.throws(() => normalizeLog([{ f: 1e9, type: 'key', key: 'a' }], { fps: 30 }), /past the longest session/);
  assert.throws(() => normalizeLog(Array.from({ length: 20001 }, () => ({ f: 1, type: 'key', key: 'a' }))), /at most 20000/);
  const { draw } = drawer(runtime(), c);
  await assert.rejects(stepsToLog(c, [{ wait: 1e6 }, { key: 'a' }], { draw }), /past the longest session/);
  await assert.rejects(stepsToLog(c, [{ down: { x: '5', y: 5 } }], { draw }), /\{ x, y \} in frame pixels/);
  const { log } = await stepsToLog(c, [{ down: { x: 5, y: 5 }, pointer: 'finger' }, { up: { x: 5, y: 5 } }], { draw });
  assert.deepEqual(normalizeLog(log), log, 'the log steps make is already what a replay reads');
});

test('interactive: the share page and the editor read keys by one rule, so the same keystrokes make the same log', () => {
  const session = { tabLeaves: (shift) => shift, regions: [{ key: 'level:change:', range: { min: 0, max: 1 } }], state: { focus: null } };
  const key = (k, o = {}) => /** @type {any} */ ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...o });
  assert.equal(keyFor(key('d'), session), 'clip');
  for (const k of ['Shift', 'Control', 'CapsLock', 'Dead', 'F5']) assert.equal(keyFor(key(k), session), 'page', k);
  assert.equal(keyFor(key('c', { ctrlKey: true }), session), 'page');
  assert.equal(keyFor(key('Tab'), session), 'clip', 'Tab walks the controls');
  assert.equal(keyFor(key('Tab', { shiftKey: true }), session), 'page', 'past the first control Shift+Tab leaves the clip');
  assert.equal(keyFor(key('d', { repeat: true }), session), 'drop', 'a held lane key is one press');
  assert.equal(keyFor(key('ArrowRight', { repeat: true }), session), 'drop', 'arrows repeat only on a focused slider');
  assert.equal(keyFor(key('ArrowRight', { repeat: true }), { ...session, state: { focus: 'level:change:' } }), 'clip');
});
