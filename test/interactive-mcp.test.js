// Interactive clips through the MCP server over stdio, the way an agent works: start a clip with create_clip { interactive: true },
// build it with edit_clip operations, play it with play_clip (steps, a log replayed to the same frames, regions, stills), look at it
// with layout_report and the overlays, check it across scenes and states with check_clip (a good clip passes; a planted
// unreachable scene, dead end, wire without a target, tiny and covered hit regions are found), and see start_render refuse it.
// The routes the editor uses (play, check-interactive) are tried against an in-process server.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, callTool } from '../scripts/mcp.mjs';
import { tempStudio } from './helpers.js';
import { createStudioServer } from '../src/server/http.js';
import { skeleton } from '../src/mcp/more/interactive.js';

const ASSETS = {
  'ui-button': `asset({
    description: 'A test button that fires press when tapped, with a label for screen readers.', tags: ['ui', 'test'],
    params: { label: { type: 'string', default: 'Go' }, x: { type: 'number', default: 20 }, y: { type: 'number', default: 100 }, w: { type: 'number', default: 80 }, h: { type: 'number', default: 40 }, color: { type: 'color', default: '#3366ff' } },
    events: { emits: { press: 'when tapped' } },
    render(f, p) {
      const s = f.ui.hit('press', p.x, p.y, p.w, p.h, { label: p.label });
      f.ctx.fillStyle = s.down ? '#112266' : s.hover ? '#5577ff' : p.color;
      f.ctx.fillRect(p.x, p.y, p.w, p.h);
    },
  })`,
  'ui-count': `asset({
    description: 'A test counter that draws n squares.', tags: ['ui', 'test'],
    params: { n: { type: 'number', default: 0 } },
    render(f, p) {
      f.ctx.fillStyle = '#00ff00';
      for (let i = 0; i < p.n; i++) f.ctx.fillRect(10 + i * 12, 70, 10, 10);
    },
  })`,
  'ui-slider': `asset({
    description: 'A test slider that reports a value as it is dragged.', tags: ['ui', 'test'],
    params: { value: { type: 'number', default: 0.5 } },
    events: { emits: { change: 'the new value' } },
    render(f, p) {
      f.ui.hit('change', 20, 140, 200, 24, { range: { min: 0, max: 1, step: 0.5, value: p.value }, label: 'Level' });
      f.ctx.fillStyle = '#888888'; f.ctx.fillRect(20, 150, 200, 4);
      f.ctx.fillStyle = '#ffffff'; f.ctx.fillRect(20 + p.value * 200 - 4, 142, 8, 20);
    },
  })`,
  'ui-title': `asset({
    description: 'A line of white text near the top left, for the tests.', tags: ['text', 'test'],
    params: { text: { type: 'string', default: 'Title' } },
    render(f, p) {
      const L = f.lib.text.layout(f.ctx, p.text, { font: 'Inter', weight: 800, size: f.height * 0.12 });
      f.ctx.fillStyle = '#ffffff';
      f.lib.text.fill(f.ctx, L, 24, 24);
    },
  })`,
  'ui-bg': `asset({ description: 'A flat test background in one colour.', tags: ['bg', 'test'], params: { color: { type: 'color', default: '#101018' } },
    render(f, p) { f.ctx.fillStyle = p.color; f.ctx.fillRect(0, 0, f.width, f.height); } })`,
};

/** The tracks of the game, before any variable exists: menu 0–2 s, play 2–4 s, win 4–6 s. */
const TRACKS = [
  { id: 'bg', items: [{ id: 'bg1', asset: 'ui-bg', start: 0, duration: 6, params: {} }] },
  { id: 'ui', items: [
    { id: 'menu-title', asset: 'ui-title', start: 0, duration: 2, params: { text: 'Tap to start' } },
    { id: 'start', asset: 'ui-button', start: 0, duration: 2, params: { label: 'Start' } },
    { id: 'hit', asset: 'ui-button', start: 2, duration: 2, params: { label: 'Hit', x: 120 } },
    { id: 'count', asset: 'ui-count', start: 2, duration: 2, params: {} },
    { id: 'level', asset: 'ui-slider', start: 2, duration: 2, params: {} },
    { id: 'win-title', asset: 'ui-title', start: 4, duration: 2, params: { text: 'You win' } },
    { id: 'again', asset: 'ui-button', start: 4, duration: 2, params: { label: 'Again' } },
  ] },
];

/** What turns the skeleton (one scene, "main", as long as the clip) into the game. */
const BUILD = [
  { op: 'update_scene', id: 'main', patch: { duration: 2 } },
  { op: 'add_scene', scene: { id: 'play', start: 2, duration: 2 } },
  { op: 'add_scene', scene: { id: 'win', start: 4, duration: 2, final: true } },
  { op: 'set_vars', vars: { score: 0, level: 0.5 } },
  { op: 'update_item', id: 'count', patch: { params: { n: { $var: 'score' } } } },
  { op: 'update_item', id: 'level', patch: { params: { value: { $var: 'level' } } } },
  { op: 'add_wire', wire: { on: 'start.press', do: [{ go: 'play' }] } },
  { op: 'add_wire', wire: { on: 'hit.press', do: [{ add: { score: 1 }, max: 5 }, { if: { var: 'score', gte: 3 }, then: [{ go: 'win' }] }] } },
  { op: 'add_wire', wire: { on: 'level.change', do: [{ set: { level: '$value' } }] } },
  { op: 'add_wire', wire: { on: 'again.press', do: [{ restart: true }] } },
];

const STEPS = [{ wait: 0.2 }, { tap: 'start' }, { wait: 0.4 }, { tap: 'hit' }, { tap: 'hit' }, { tap: 'hit' }, { wait: 0.2 }];

let client, dataDir, built;
const call = (name, args) => callTool(client, name, args);
const ok = async (name, args) => { const r = await call(name, args); assert.ok(!r.isError, `${name}: ${r.text}`); return r; };
const messages = (issues) => issues.map((i) => `${i.check}: ${i.message}`);

before(async () => {
  dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-imcp-'));
  client = await connect({ dataDir, author: 'imcp-test' });
  for (const [name, source] of Object.entries(ASSETS)) await ok('create_asset', { name, source });
});
after(async () => {
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
});

test('the interactive tools are listed, and create_clip { interactive: true } starts from one holding scene', async () => {
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'play_clip'));
  assert.ok(tools.find((t) => t.name === 'create_clip').inputSchema.properties.interactive);
  assert.ok(tools.find((t) => t.name === 'check_clip').inputSchema.properties.max_states);
  const made = await ok('create_clip', { name: 'quest', title: 'Quest', composition: { width: 320, height: 180, fps: 30, duration: 6, background: '#000000', tracks: TRACKS }, interactive: true });
  assert.equal(made.json.revision, 1);
  const { composition } = (await ok('get_clip', { clip: 'quest' })).json;
  assert.deepEqual(composition.interactive, { start: 'main', vars: {}, scenes: [{ id: 'main', start: 0, duration: 6, end: 'hold' }], wires: [] });
  // an empty interactive clip too, without a composition
  const empty = await ok('create_clip', { name: 'blank', interactive: true, fps: 10, duration: 4 });
  assert.equal(empty.json.duration, 4);
  assert.equal((await ok('get_clip', { clip: 'blank' })).json.composition.interactive.scenes[0].duration, 4);
});

test('edit_clip: scenes, wires and variables are edited by operations, and a mistake says what to do', async () => {
  const edited = await ok('edit_clip', { clip: 'quest', operations: BUILD });
  assert.equal(edited.json.revision, 2);
  // what comes back says where everything is: the wires by the index update_wire and remove_wire take
  assert.deepEqual(edited.json.interactive.scenes, ['main: 0s+2s, end hold', 'play: 2s+2s, end hold', 'win: 4s+2s, end hold, final']);
  assert.deepEqual(edited.json.interactive.wires, ['0: start.press', '1: hit.press', '2: level.change', '3: again.press']);
  assert.deepEqual(edited.json.interactive.vars, { score: 0, level: 0.5 });
  const { composition: c } = (await ok('get_clip', { clip: 'quest' })).json;
  built = structuredClone(c);
  assert.deepEqual(c.interactive.scenes.map((s) => `${s.id}@${s.start}+${s.duration}`), ['main@0+2', 'play@2+2', 'win@4+2']);
  assert.equal(c.interactive.scenes[2].final, true);
  assert.equal(c.interactive.wires.length, 4);
  assert.deepEqual(c.interactive.vars, { score: 0, level: 0.5 });
  assert.deepEqual(c.tracks[1].items.find((i) => i.id === 'count').params, { n: { $var: 'score' } });
  // the rest of the operations on a copy, one at a time
  await ok('create_clip', { name: 'ops', composition: structuredClone(c) });
  const bad = (operations) => call('edit_clip', { clip: 'ops', operations });
  assert.match((await bad([{ op: 'add_scene', scene: { id: 'play', start: 0, duration: 1 } }])).text, /already exists/);
  assert.match((await bad([{ op: 'remove_scene', id: 'nope' }])).text, /no scene with id "nope" \(scenes: main, play, win\)/);
  assert.match((await bad([{ op: 'update_wire', index: 9, patch: {} }])).text, /no wire at index 9 \(the clip has 4, numbered from 0\)/);
  assert.match((await bad([{ op: 'remove_scene', id: 'win' }])).text, /go names a scene \(main, play\)/, 'the saved clip is validated: what still names the scene is listed');
  assert.match((await bad([{ op: 'add_wire', wire: { on: 'hit.nope', do: [{ go: 'play' }] } }])).text, /does not emit "nope"/);
  await ok('edit_clip', { clip: 'ops', operations: [{ op: 'update_wire', index: 3, patch: { scene: 'win' } }, { op: 'remove_wire', index: 0 }, { op: 'add_wire', index: 0, wire: { on: 'start.press', do: [{ set: { score: 1 } }, { go: 'play' }] } }] });
  const after = (await ok('get_clip', { clip: 'ops' })).json.composition.interactive;
  assert.equal(after.wires[3].scene, 'win');
  assert.equal(after.wires[0].do[0].set.score, 1);
  // set_vars null removes a variable (still bound to the slider: refused), set_interactive null makes a video again
  assert.match((await bad([{ op: 'set_vars', vars: { level: null } }])).text, /unknown variable "level"/);
  await ok('edit_clip', { clip: 'ops', operations: [{ op: 'set_interactive', interactive: null }, { op: 'update_item', id: 'count', patch: { params: { n: 2 } } }, { op: 'update_item', id: 'level', patch: { params: { value: 0.5 } } }] });
  assert.equal((await ok('get_clip', { clip: 'ops' })).json.composition.interactive, undefined);
  assert.match((await bad([{ op: 'add_scene', scene: { id: 'x', start: 0, duration: 1 } }])).text, /needs an interactive clip: add the section first with/);
});

test('play_clip: steps give a trace with the scene and variables after each, stills, and a log that replays to the same frames', async () => {
  const r = await ok('play_clip', { clip: 'quest', steps: STEPS });
  const t = r.json.trace;
  assert.equal(t.length, STEPS.length, 'one entry after each step');
  assert.deepEqual(t.map((x) => x.scene), ['main', 'play', 'play', 'play', 'play', 'win', 'win']);
  assert.deepEqual(t.map((x) => x.vars.score), [0, 0, 0, 1, 2, 3, 3]);
  assert.equal(t[1].afterStep, 1);
  assert.deepEqual(t[1].step, { tap: 'start' });
  assert.equal(r.json.trace.at(-1).vars.level, 0.5);
  assert.equal(r.json.end.scene, 'win');
  assert.ok(r.json.events >= 8 && r.json.log.every((e) => Number.isInteger(e.f)), 'the log is the raw input');
  assert.ok(r.images.length >= 1 && r.images.length <= 6, `at most six stills of seven frames (got ${r.images.length})`);
  assert.equal(r.json.stills.length, r.images.length);
  assert.equal(r.images[0].subarray(1, 4).toString(), 'PNG');
  // the same log, the same frames: replayed in another call, and in the form the trace was asked for in seconds
  const again = await ok('play_clip', { clip: 'quest', log: r.json.log, times: t.map((x) => x.t), stills: false });
  assert.deepEqual(again.json.trace.map((x) => x.hash), t.map((x) => x.hash));
  assert.deepEqual(again.json.trace.map((x) => x.scene), t.map((x) => x.scene));
  assert.equal(again.images.length, 0);
  assert.ok(new Set(t.map((x) => x.hash)).size >= 5, 'the frames differ along the way');
  // few frames: every one gets its still; regions: true lists what the frame draws
  const few = await ok('play_clip', { clip: 'quest', steps: [{ wait: 0.2 }, { tap: 'start' }, { wait: 0.4 }], regions: true });
  assert.equal(few.images.length, 3);
  assert.deepEqual(few.json.trace[0].regions.map((x) => `${x.item}.${x.event}:${x.label}`), ['start.press:Start']);
  assert.deepEqual(few.json.trace[2].regions.map((x) => x.item), ['hit', 'level']);
  assert.ok(few.json.trace[2].regions[0].css.width > 24 && few.json.trace[2].regions[1].range.max === 1);
  // a draft composition plays too, in another format
  const draft = (await ok('get_clip', { clip: 'quest' })).json.composition;
  const vertical = await ok('play_clip', { composition: draft, format: 'vertical', steps: [{ wait: 0.1 }], stills: false });
  assert.equal(vertical.json.format, 'vertical');
});

test('play_clip: errors say what to do next', async () => {
  await ok('create_clip', { name: 'plain', format: 'horizontal', fps: 10, duration: 2 });
  assert.match((await call('play_clip', { clip: 'plain' })).text, /Clip "plain" is not interactive: it has no interactive section to play. Add one with edit_clip/);
  const early = await call('play_clip', { clip: 'quest', steps: [{ tap: 'hit' }] });
  assert.ok(early.isError);
  assert.match(early.text, /nothing to tap on "hit".*in scene "main"; regions there: start\.press.*Add a \{ wait \} step/);
  assert.match((await call('play_clip', { clip: 'quest', steps: [{ jump: 1 }] })).text, /step 0: unknown step/);
  assert.match((await call('play_clip', { clip: 'quest', steps: [], log: [] })).text, /steps or log, not both/);
  assert.match((await call('play_clip', { clip: 'quest', log: [{ f: 1, type: 'tap' }] })).text, /type is one of/);
});

test('layout_report lists the hit regions of a frame in CSS px at phone size; the overlays draw them', async () => {
  const menu = await ok('layout_report', { clip: 'quest', t: 0.5 });
  assert.equal(menu.json.scene, 'main');
  assert.equal(menu.json.phone.viewport.width, 844, 'a horizontal clip shows landscape');
  assert.equal(menu.json.texts.length, 1);
  assert.equal(menu.json.regions.length, 1);
  const [start] = menu.json.regions;
  assert.deepEqual({ item: start.item, event: start.event, label: start.label, box: start.box }, { item: 'start', event: 'press', label: 'Start', box: { x: 20, y: 100, width: 80, height: 40 } });
  assert.deepEqual(start.size, { width: 80, height: 40 });
  assert.ok(Math.abs(start.css.width - 80 * (390 / 180)) < 0.2 && Math.abs(start.css.height - 40 * (390 / 180)) < 0.2, JSON.stringify(start.css));
  const play = await ok('layout_report', { clip: 'quest', t: 3 });
  assert.deepEqual(play.json.regions.map((r) => r.item), ['hit', 'level']);
  assert.equal(play.json.regions[1].range.step, 0.5);
  const plain = await ok('render_clip_frame', { clip: 'quest', t: 3 });
  const over = await ok('render_clip_frame', { clip: 'quest', t: 3, overlays: ['text'] });
  assert.equal(over.json.sha256, plain.json.sha256, 'the guides are drawn on a copy');
  assert.equal(over.json.regions, 2);
  assert.notEqual(over.images[0].toString('base64'), plain.images[0].toString('base64'));
});

test('start_render refuses an interactive clip and says it is played', async () => {
  const r = await call('start_render', { clip: 'quest' });
  assert.ok(r.isError);
  assert.match(r.text, /interactive: it is played, not rendered/);
});

test('check_clip: a good interactive clip passes, and the state crawl is reported', async () => {
  const r = await ok('check_clip', { clip: 'quest' });
  assert.deepEqual(messages(r.json.issues.filter((i) => i.severity !== 'info')), []);
  assert.deepEqual(messages(r.json.issues), [], 'a clean game has nothing to say, not even advice');
  const { interactive } = r.json;
  assert.deepEqual(interactive.scenes.map((s) => `${s.id}:${s.reachable}`), ['main:true', 'play:true', 'win:true']);
  assert.equal(interactive.phone.viewport.height, 390);
  const { states, edges } = interactive.crawl;
  assert.equal(interactive.crawl.truncated, false);
  // menu, then play at 3 scores × 3 slider values, then win at 3 slider values
  assert.deepEqual([...new Set(states.map((s) => s.scene))].sort(), ['main', 'play', 'win']);
  assert.equal(states.length, 13, JSON.stringify(states.map((s) => `${s.scene}${JSON.stringify(s.vars)}`)));
  assert.ok(states.every((s) => s.reachesFinal === true));
  const actions = new Set(edges.map((e) => e.action));
  for (const a of ['tap start.press', 'tap hit.press', 'drag level.change to min', 'drag level.change to max', 'tap again.press']) assert.ok(actions.has(a), `${a} in ${[...actions]}`);
  assert.ok(edges.some((e) => e.from === 's0' && e.action === 'tap start.press' && e.to !== 's0'));
  assert.ok(r.json.frames > 13 && r.json.counts['hit-size'] === 0 && r.json.counts['unreachable-scene'] === 0);
  // the crawl stops where asked and says so; only: narrows the checks
  const short = await ok('check_clip', { clip: 'quest', max_states: 4, only: ['hit-size'] });
  assert.equal(short.json.interactive.crawl.states.length, 4);
  assert.equal(short.json.interactive.crawl.truncated, true);
});

test('check_clip finds a planted unreachable scene, dead end, wire without a target, tiny and covered hit regions', async () => {
  await ok('edit_clip', { clip: 'quest', operations: [
    { op: 'set', duration: 10 },
    { op: 'add_scene', scene: { id: 'secret', start: 6, duration: 2 } },
    { op: 'add_scene', scene: { id: 'limbo', start: 8, duration: 2 } },
    { op: 'add_wire', wire: { on: 'key:l', scene: 'play', do: [{ go: 'limbo' }] } },
    { op: 'add_wire', wire: { on: 'start.press', scene: 'win', do: [{ go: 'play' }] } },
    { op: 'set_vars', vars: { spare: 1 } },
    { op: 'add_item', track: 'ui', item: { id: 'tiny', asset: 'ui-button', start: 0, duration: 2, params: { label: 'Tiny', x: 250, y: 100, w: 8, h: 8 } } },
    { op: 'add_wire', wire: { on: 'tiny.press', do: [{ set: { level: 1 } }] } },
    { op: 'add_item', track: 'ui', item: { id: 'cover', asset: 'ui-button', start: 2, duration: 2, params: { label: 'Cover', x: 120 } } },
    { op: 'add_wire', wire: { on: 'cover.press', do: [{ set: { level: 0 } }] } },
  ] });
  const r = await ok('check_clip', { clip: 'quest' });
  const by = (check) => r.json.issues.filter((i) => i.check === check);
  assert.deepEqual(by('unreachable-scene').map((i) => i.scene), ['secret']);
  assert.deepEqual(by('dead-end').map((i) => i.scene), ['limbo']);
  assert.match(by('dead-end')[0].message, /holds forever/);
  const target = by('no-target');
  assert.equal(target.length, 1);
  assert.equal(target[0].item, 'start');
  assert.equal(target[0].scene, 'win');
  assert.match(target[0].message, /Wire 5 listens to "start\.press".*scene "win"/);
  const tiny = by('hit-size').filter((i) => i.severity === 'error');
  assert.deepEqual(tiny.map((i) => i.item), ['tiny']);
  assert.ok(tiny[0].numbers.css.width < 24 && tiny[0].numbers.frame.width === 8, JSON.stringify(tiny[0].numbers));
  assert.ok(tiny[0].still && existsSync(tiny[0].still), 'the hit issue comes with a still');
  assert.ok(by('hit-overlap').some((i) => /completely covered/.test(i.message) && i.item === 'hit' && i.state), 'the crawl finds the covered button');
  assert.ok(by('hit-overlap').some((i) => i.item === 'hit' && i.other === 'cover' && !i.state), 'and the frames show the overlap');
  assert.deepEqual(by('unused-variable').map((i) => i.numbers.initial), [1]);
  assert.ok(by('no-path-to-final').some((i) => i.scene === 'limbo'), 'a state of the scene nobody leaves cannot finish');
  assert.ok(by('no-path-to-final').every((i) => i.severity === 'info'));
  assert.ok(r.json.issues[0].severity === 'error' && r.json.issues.at(-1).severity !== 'error', 'errors come first');
  assert.equal(r.json.interactive.scenes.find((s) => s.id === 'secret').reachable, false);
  // the issues carry what an agent needs to act: scene, state, numbers, and a still where there is something to see
  for (const i of r.json.issues.filter((x) => x.check !== 'unused-variable')) assert.ok(i.message && i.numbers && Number.isInteger(i.frame), i.check);
  assert.ok(by('dead-end')[0].still && existsSync(by('dead-end')[0].still));
});

test('check_clip: a wire loop is a finding about the state it happens in, not a failed check', async () => {
  const loop = structuredClone(built);
  loop.interactive.wires.push({ on: 'enter:play', do: [{ go: 'play' }] });
  const r = await ok('check_clip', { composition: loop, stills: false });
  const [e] = r.json.issues.filter((i) => i.check === 'state-error');
  assert.ok(e, JSON.stringify(r.json.counts));
  assert.equal(e.severity, 'error');
  assert.equal(e.scene, 'main');
  assert.match(e.message, /"tap start.press" fails: the wires ran more than 256 actions for one event/);
  assert.equal(r.json.interactive.crawl.errors, 1);
});

test('check_clip: the crawl also presses keys and nothing, and waits for a timed scene to end', async () => {
  const timed = structuredClone(built);
  timed.interactive.scenes[0].end = 'next';
  timed.interactive.wires.push(
    { on: 'key:ArrowRight', scene: 'main', do: [{ set: { level: 1 } }] },
    { on: 'key:any', scene: 'play', do: [{ set: { level: 0 } }] },
    { on: 'tap', scene: 'main', do: [{ add: { score: 1 }, max: 1 }] },
  );
  const r = await ok('check_clip', { composition: timed, stills: false });
  const { states, edges } = r.json.interactive.crawl;
  const actions = new Set(edges.map((e) => e.action));
  for (const a of ['key ArrowRight', 'key x', 'tap on nothing', 'wait']) assert.ok(actions.has(a), `${a} in ${[...actions]}`);
  const wait = edges.find((e) => e.action === 'wait');
  assert.deepEqual([wait.from, states.find((x) => x.id === wait.to).scene], ['s0', 'play'], 'the first scene runs out into the second');
  assert.ok(states.some((x) => x.scene === 'main' && x.vars.score === 1 && x.vars.level === 1), 'a press on nothing and a key both changed the first scene');
  assert.deepEqual(messages(r.json.issues.filter((i) => i.severity === 'error')), []);
});

test('the editor routes: play (no pictures) and check-interactive', async () => {
  const t = tempStudio();
  const { studio } = t;
  const server = /** @type {any} */ (createStudioServer(t.studio));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await studio.clips.createClip({ slug: 'quest', author: 'imcp-test', width: 320, height: 180, fps: 30, duration: 6 });
    for (const [name, source] of Object.entries(ASSETS)) await studio.library.createAsset({ slug: name, source, author: 'imcp-test', forClip: 'quest' });
    const built = studio.clips.applyOps({ width: 320, height: 180, fps: 30, duration: 6, tracks: TRACKS, interactive: skeleton(6) }, BUILD);
    assert.equal((await studio.clips.updateClip('quest', { composition: built })).clip.composition.interactive.wires.length, 4);
    const played = await post('/api/clips/quest/play', { steps: STEPS, regions: true });
    assert.equal(played.status, 200);
    const body = await played.json();
    assert.equal(body.frames.length, STEPS.length);
    assert.ok(body.frames.every((f) => f.png === undefined && /^[0-9a-f]{64}$/.test(f.hash)));
    assert.equal(body.end.scene, 'win');
    assert.equal(body.frames[0].regions[0].label, 'Start');
    // an unsaved draft of the editor plays and is checked in place of the saved clip
    const draft = structuredClone(built);
    draft.interactive.scenes[0].end = 'next';
    const draftPlay = await (await post('/api/clips/quest/play', { composition: draft, times: [3] })).json();
    assert.equal(draftPlay.frames[0].state.scene, 'play', 'the draft\'s first scene ends by itself');
    assert.equal((await (await post('/api/clips/quest/play', { times: [3] })).json()).frames[0].state.scene, 'main', 'the saved clip\'s holds');
    // the route has play_clip's bounds: a frame an hour past the start, or a log of a frame far ahead, is refused at once
    const far = await post('/api/clips/quest/play', { frames: [1e9] });
    assert.equal(far.status, 400);
    assert.match((await far.json()).error, /not a session frame/);
    const farLog = await post('/api/clips/quest/play', { log: [{ f: 1e9, type: 'key', key: 'a' }], times: [0] });
    assert.ok(farLog.status >= 400 && farLog.status < 500, `a log far ahead is refused (${farLog.status})`);
    assert.match((await farLog.json()).error, /longest session/);
    const checked = await post('/api/clips/quest/check-interactive', { maxStates: 5 });
    assert.equal(checked.status, 200);
    const report = await checked.json();
    assert.equal(report.interactive.crawl.states.length, 5);
    assert.equal(report.interactive.crawl.truncated, true);
    assert.ok(report.issues.every((i) => i.still === null), 'stills are off unless asked for');
    await studio.clips.createClip({ slug: 'plain', author: 'imcp-test', width: 320, height: 180, fps: 10, duration: 2 });
    const refused = await post('/api/clips/plain/check-interactive', {});
    assert.equal(refused.status >= 400, true);
    assert.match((await refused.json()).error, /not interactive/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await t.cleanup();
  }
});
