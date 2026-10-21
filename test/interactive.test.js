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
    await assert.rejects(studio.clips.updateClip('game', { composition: bad, by: AUTHOR }), (e) => /item "count" \(ui-count@1\) does not emit "press"/.test(e.message) && /does not react to "flash"/.test(e.message));
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
