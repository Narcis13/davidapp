// The ui-* assets: the controls and scene transitions of interactive compositions (button, card, menu, toggle, slider,
// progress, score, dialog, hotspot, toast, three transitions, a backdrop). Each is created and validated in a temp studio,
// declares its events, draws under three themes in vertical and horizontal frames, records its hit regions under the
// names it declares, changes its pixels on hover, focus and press (or on the events it accepts), emits what it
// declares (wires on its events change variables), and draws its text through f.lib.text at or above its floor.
// Frames are small (180 x 320 and 320 x 180) so the file stays fast; the contact sheets are scripts/ui-sheets.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempStudio, AUTHOR } from './helpers.js';
import { registerFonts, ROOT } from '../src/render/host.js';

registerFonts();

const src = (name) => readFileSync(join(ROOT, 'assets', `${name}.js`), 'utf8');
const BASE = ['easing', 'theme-tide', 'theme-ember', 'theme-sketchbook', 'kit-icon'];
const CONTROLS = ['ui-button', 'ui-card', 'ui-menu', 'ui-toggle', 'ui-slider', 'ui-progress', 'ui-score', 'ui-dialog', 'ui-hotspot', 'ui-toast'];
const TRANSITIONS = ['ui-tx-push', 'ui-tx-iris', 'ui-tx-zoom'];
const ALL = ['ui-backdrop', ...CONTROLS, ...TRANSITIONS];
const THEMES = ['theme-tide', 'theme-ember', 'theme-sketchbook'];
const FPS = 30;
const WAIT = { wait: 0.6 };
const F = 1 + Math.round(0.6 * FPS);   // the session frame a { wait: 0.6 } step reaches

const safe = (x, y, width, height) => ({ space: 'safe', x, y, width, height });

/**
 * What each control is checked with: its params and box, the events it declares, the texts it draws, and acts (steps
 * and the variables they must leave) through wires on its events. `pokes` are steps whose effect is only on the pixels.
 */
const SPECS = {
  'ui-button': {
    params: { label: 'Go on', hotkey: 'g', value: 'went', icon: 'arrow-right' }, transform: safe(0.5, 0.5, 0.95, 0.3),
    emits: ['press'], accepts: ['pulse', 'shake'], texts: ['Go on'],
    vars: { got: '' }, wires: [{ on: 'x.press', do: { set: { got: '$value' } } }, { on: 'key:s', do: { send: 'x', event: 'shake' } }],
    acts: [{ steps: [WAIT, { tap: 'x' }], expect: { got: 'went' } }, { steps: [WAIT, { key: 'g' }], expect: { got: 'went' } }, { steps: [WAIT, { key: 'Tab' }, { key: 'Enter' }], expect: { got: 'went' } }],
    pokes: [{ key: 's' }],
  },
  'ui-card': {
    params: { title: 'Lyon', badge: 'B', detail: 'Two rivers', value: 'lyon', choice: { $var: 'pick' }, hotkey: '2' }, transform: safe(0.5, 0.5, 0.95, 0.5),
    emits: ['select'], accepts: ['flip', 'pop', 'shake'], texts: ['Lyon', 'B', 'Two rivers'],
    vars: { pick: '' }, wires: [{ on: 'x.select', do: { set: { pick: '$value' } } }, { on: 'key:f', do: { send: 'x', event: 'flip' } }],
    acts: [{ steps: [WAIT, { tap: 'x' }], expect: { pick: 'lyon' } }, { steps: [WAIT, { key: '2' }], expect: { pick: 'lyon' } }],
    pokes: [{ key: 'f' }],
  },
  'ui-menu': {
    params: { options: [{ label: 'Play', value: 'play', icon: 'play' }, { label: 'Quit', value: 'quit', detail: 'now' }], highlight: { $var: 'row' } }, transform: safe(0.5, 0.5, 0.98, 0.7),
    emits: ['select'], accepts: ['shake'], texts: ['Play', 'Quit', 'now'], regions: 2,
    vars: { pick: '', row: 0 }, wires: [{ on: 'x.select', do: { set: { pick: '$value' } } }, { on: 'key:ArrowDown', do: { add: { row: 1 }, min: 0, max: 1 } }],
    acts: [{ steps: [WAIT, { tap: { item: 'x', id: 1 } }], expect: { pick: 'quit' } }, { steps: [WAIT, { key: '2' }], expect: { pick: 'quit' } }, { steps: [WAIT, { key: 'Tab' }, { key: 'Tab' }, { key: 'Enter' }], expect: { pick: 'quit' } }],
    pokes: [{ key: 'ArrowDown' }],
  },
  'ui-toggle': {
    params: { label: 'Sound', on: { $var: 'snd' } }, transform: safe(0.5, 0.5, 0.98, 0.3),
    emits: ['change'], accepts: ['shake'], texts: ['Sound'],
    vars: { snd: true }, wires: [{ on: 'x.change', do: { set: { snd: '$value' } } }],
    acts: [{ steps: [WAIT, { tap: 'x' }], expect: { snd: false } }, { steps: [WAIT, { key: 'Tab' }, { key: 'Enter' }, { key: 'Enter' }], expect: { snd: true } }],
  },
  'ui-slider': {
    params: { label: 'Volume', value: { $var: 'v' }, step: 0.1 }, transform: safe(0.5, 0.5, 0.98, 0.35),
    emits: ['change'], accepts: ['pulse'], texts: ['Volume', '50%'],
    vars: { v: 0.5 }, wires: [{ on: 'x.change', do: { set: { v: '$value' } } }],
    acts: [{ steps: [WAIT, { key: 'Tab' }, { key: 'ArrowRight' }], expect: { v: 0.6 } }, { steps: [WAIT, { key: 'Tab' }, { key: 'ArrowLeft' }, { key: 'ArrowLeft' }], expect: { v: 0.3 } }],
  },
  'ui-dialog': {
    params: { title: 'Quit?', body: 'Your run is saved.', confirm: 'Quit', cancel: 'Stay', icon: 'log-out' },
    emits: ['block', 'cancel', 'confirm'], accepts: ['open', 'shake'], texts: ['Quit?', 'Your run is saved.', 'Quit', 'Stay'],
    vars: { r: '' }, wires: [{ on: 'x.confirm', do: { set: { r: 'yes' } } }, { on: 'x.cancel', do: { set: { r: 'no' } } }, { on: 'tap', do: { set: { r: 'through' } } }],
    acts: [
      { steps: [WAIT, { key: 'Enter' }], expect: { r: 'yes' } }, { steps: [WAIT, { key: 'Escape' }], expect: { r: 'no' } },
      { steps: [WAIT, { tap: { item: 'x', region: 'confirm' } }], expect: { r: 'yes' } }, { steps: [WAIT, { tap: { item: 'x', region: 'cancel', id: 'button' } }], expect: { r: 'no' } },
      // the scrim takes a tap outside the panel (it never reaches what is under it, nor the clip's tap wire); one on the panel is swallowed
      { steps: [WAIT, { down: { x: 4, y: 4 } }, { up: { x: 4, y: 4 } }], expect: { r: 'no' } }, { steps: [WAIT, { tap: { item: 'x', region: 'block', id: 'panel' } }], expect: { r: '' } },
    ],
  },
  'ui-hotspot': {
    params: { label: 'Look here', labelOn: 'always' },
    emits: ['press'], accepts: ['ping'], texts: ['Look here'],
    vars: { n: 0 }, wires: [{ on: 'x.press', do: { add: { n: 1 } } }],
    acts: [{ steps: [WAIT, { tap: 'x' }, { tap: 'x' }], expect: { n: 2 } }, { steps: [WAIT, { key: 'Tab' }, { key: 'Enter' }], expect: { n: 1 } }],
  },
  'ui-progress': {
    params: { value: { $var: 'q' }, max: 5, label: 'Quiz' }, transform: safe(0.5, 0.5, 0.98, 0.3),
    emits: [], accepts: ['pulse'], texts: ['Quiz', '2 / 5'],
    vars: { q: 2 }, wires: [{ on: 'key:n', do: { add: { q: 1 }, max: 5 } }, { on: 'key:p', do: { send: 'x', event: 'pulse' } }],
    acts: [{ steps: [WAIT, { key: 'n' }, { key: 'n' }, { key: 'n' }, { key: 'n' }], expect: { q: 5 } }],
    pokes: [{ key: 'n' }, { key: 'p' }],
  },
  'ui-score': {
    params: { value: { $var: 's' }, label: 'Score', icon: 'star' }, transform: safe(0.5, 0.5, 0.98, 0.3),
    emits: [], accepts: ['bump'], texts: ['Score', '1,250'],
    vars: { s: 1250 }, wires: [{ on: 'key:a', do: { add: { s: 10 } } }, { on: 'key:b', do: { send: 'x', event: 'bump' } }],
    acts: [{ steps: [WAIT, { key: 'a' }, { key: 'a' }], expect: { s: 1270 } }],
    pokes: [{ key: 'a' }, { key: 'b' }],
  },
  'ui-toast': {
    params: { text: 'Saved', hold: 0 },
    emits: [], accepts: ['error', 'show', 'success'], texts: ['Saved'],
    vars: {}, wires: [{ on: 'key:s', do: { send: 'x', event: 'success', value: 'Correct' } }, { on: 'key:e', do: { send: 'x', event: 'show', value: 'error: Not quite' } }],
    acts: [],
    pokes: [{ key: 's' }, { key: 'e' }],
  },
};

let t;
before(async () => {
  t = tempStudio();
  for (const name of [...BASE, ...ALL]) await t.studio.library.createAsset({ slug: name, source: src(name), author: AUTHOR });
});
after(async () => { await t.cleanup(); });

/** An interactive composition with one scene that holds: the backdrop, then the item under test (id "x"). */
function comp(name, { format = 'vertical', theme = 'theme-tide', params = {}, extra = {} } = {}) {
  const s = SPECS[name];
  const item = { id: 'x', asset: name, start: 0, duration: 4, params: { ...s.params, ...params }, ...(s.transform ? { transform: s.transform } : {}), ...extra };
  return {
    ...(format === 'vertical' ? { width: 180, height: 320 } : { width: 320, height: 180 }), fps: FPS, duration: 4, background: '#000000', theme,
    tracks: [
      { id: 'bg', type: 'visual', items: [{ id: 'bg', asset: 'ui-backdrop', start: 0, duration: 4 }] },
      { id: 'ui', type: 'visual', items: [item] },
    ],
    interactive: { vars: s.vars, scenes: [{ id: 'main', start: 0, duration: 4, end: 'hold' }], wires: s.wires },
  };
}

const play = (c, steps, frames, o = {}) => t.studio.play({ composition: c, steps, frames, ...o });
const hashAt = async (c, steps, frame) => (await play(c, steps, [frame])).frames[0].hash;
/** The centre of a region in frame pixels. */
const centre = (r) => { const [a, b, c, d, e, f] = r.m; const x = r.x + r.w / 2, y = r.y + r.h / 2; return { x: a * x + c * y + e, y: b * x + d * y + f }; };

test('ui assets: created and validated, described, tagged ui + interactive, with a usage example, events and a theme', () => {
  const { library } = t.studio;
  for (const name of ALL) {
    const a = library.getAsset(name);
    assert.equal(a.ref, `${name}@1`, `${name} is in the library`);
    assert.ok(a.declared.tags.includes('ui') && a.declared.tags.includes('interactive'), `${name} is tagged ui and interactive`);
    assert.ok(a.declared.title, `${name} has a title`);
    assert.ok(a.declared.description.length > 150, `${name} says what it is for`);
    assert.match(a.source, /\/\/ Usage\./, `${name} has a usage example in its header`);
    if (name === 'ui-tx-push') continue;   // black shadows and dimming only: nothing to take from a theme
    assert.equal(a.schema.theme?.type, 'asset', `${name} takes a theme`);
    assert.equal(a.schema.theme?.default, 'theme-tide');
  }
  for (const name of TRANSITIONS) assert.equal(library.getAsset(name).kind, 'transition');
  for (const name of CONTROLS) {
    const a = library.getAsset(name);
    const ev = a.meta.events;
    assert.ok(ev, `${name} declares its events`);
    assert.deepEqual(Object.keys(ev.emits).sort(), SPECS[name].emits, `${name} emits`);
    assert.deepEqual(Object.keys(ev.accepts).sort(), SPECS[name].accepts, `${name} accepts`);
    for (const d of [...Object.values(ev.emits), ...Object.values(ev.accepts)]) assert.ok(d.length > 8, `${name}: every event is described`);
    assert.match(a.source, /const FLOOR = 2\.6;[\s\S]*floor: FLOOR/, `${name} declares its text floor`);
    assert.match(a.source, /const th = f\.theme \?\? f\.use\(p\.theme\)/, `${name} reads the clip's theme first`);
  }
  // every control a dialog may cover can be disabled
  for (const name of ['ui-button', 'ui-card', 'ui-menu', 'ui-toggle', 'ui-slider', 'ui-hotspot']) assert.equal(library.getAsset(name).schema.disabled?.type, 'boolean', `${name} has disabled`);
});

test('ui assets: each control draws under three themes, in vertical and horizontal frames, differently per theme', async () => {
  for (const format of ['vertical', 'horizontal']) {
    const empty = comp('ui-button', { format });
    const bare = (await t.studio.frameHashes({ composition: { ...empty, tracks: empty.tracks.slice(0, 1), interactive: { scenes: empty.interactive.scenes } }, times: [1] }))[0].hash;
    for (const name of CONTROLS) {
      const hashes = [];
      for (const theme of THEMES) hashes.push((await t.studio.frameHashes({ composition: comp(name, { format, theme }), times: [1] }))[0].hash);
      assert.equal(new Set(hashes).size, THEMES.length, `${name} (${format}) looks different under each theme`);
      assert.notEqual(hashes[0], bare, `${name} (${format}) draws something over the backdrop`);
    }
  }
});

test('ui assets: hit regions are recorded under the declared event names, with labels', async () => {
  for (const name of CONTROLS) {
    const s = SPECS[name];
    const r = await play(comp(name), [WAIT], [F], { regions: true });
    const mine = r.frames[0].regions.filter((x) => x.item === 'x');
    if (!s.emits.length) { assert.equal(mine.length, 0, `${name} has no regions`); continue; }
    assert.ok(mine.length >= (s.regions ?? 1), `${name} records its regions (${mine.length})`);
    for (const x of mine) {
      assert.ok(s.emits.includes(x.name), `${name}: region "${x.name}" is a declared event`);
      assert.ok(typeof x.label === 'string' && x.label.length, `${name}: region "${x.name}" has an accessible label`);
    }
    // a disabled control is drawn but not hittable
    if (name !== 'ui-dialog' && SPECS[name].emits.length) {
      const off = await play(comp(name, { params: { disabled: true } }), [WAIT], [F], { regions: true });
      assert.equal(off.frames[0].regions.filter((x) => x.item === 'x').length, 0, `${name} disabled has no regions`);
    }
  }
  // the dialog: a scrim over the whole frame under the panel, then the panel, then confirm and cancel (Tab order)
  const d = (await play(comp('ui-dialog'), [WAIT], [F], { regions: true })).frames[0].regions;
  assert.deepEqual(d.map((x) => `${x.name}#${x.id ?? ''}`), ['cancel#scrim', 'block#panel', 'confirm#', 'cancel#button']);
  assert.deepEqual([d[0].x, d[0].y, d[0].w, d[0].h], [0, 0, 180, 320]);
  assert.deepEqual([d[0].focus, d[1].focus], [false, false]);
  assert.deepEqual(d.find((x) => x.name === 'confirm').keys, ['Enter']);
  // the menu: one region per option, its index as the id, the number keys as hotkeys
  const m = (await play(comp('ui-menu'), [WAIT], [F], { regions: true })).frames[0].regions;
  assert.deepEqual(m.map((x) => [x.id, x.value, x.keys]), [[0, 'play', ['1']], [1, 'quit', ['2']]]);
  // the slider is a range region; the hotspot a circle
  const sl = (await play(comp('ui-slider'), [WAIT], [F], { regions: true })).frames[0].regions[0];
  assert.deepEqual(sl.range, { min: 0, max: 1, step: 0.1, value: 0.5, axis: 'x' });
  assert.equal((await play(comp('ui-hotspot'), [WAIT], [F], { regions: true })).frames[0].regions[0].shape, 'circle');
});

test('ui assets: hover, keyboard focus and a held press change the pixels; so do the events a control accepts', async () => {
  for (const name of CONTROLS) {
    const s = SPECS[name];
    const c = comp(name);
    const at = F + 6;
    const rest = await hashAt(c, [WAIT], at);
    if (s.emits.length) {
      const regions = (await play(c, [WAIT], [F], { regions: true })).frames[0].regions.filter((x) => x.item === 'x' && x.focus !== false);
      const p = centre(regions[0]);
      assert.notEqual(await hashAt(c, [WAIT, { move: p }], at), rest, `${name}: hover shows`);
      assert.notEqual(await hashAt(c, [WAIT, { key: 'Tab' }], at), rest, `${name}: focus shows`);
      assert.notEqual(await hashAt(c, [WAIT, { move: p }, { down: p }], at), rest, `${name}: a held press shows`);
    }
    for (const poke of s.pokes ?? []) assert.notEqual(await hashAt(c, [WAIT, poke], at), rest, `${name}: ${JSON.stringify(poke)} shows`);
  }
});

test('ui assets: wires on their events change variables as they declare (tap, hotkeys, Tab + Enter, arrows)', async () => {
  for (const name of CONTROLS) {
    for (const act of SPECS[name].acts) {
      const r = await play(comp(name), act.steps, []);
      for (const [k, v] of Object.entries(act.expect)) assert.equal(r.end.vars[k], v, `${name} after ${JSON.stringify(act.steps.slice(1))}: ${k}`);
    }
  }
  // a disabled button emits nothing
  const off = await play(comp('ui-button', { params: { disabled: true } }), [WAIT, { key: 'g' }, { key: 'Tab' }, { key: 'Enter' }], []);
  assert.equal(off.end.vars.got, '');
});

test('ui assets: their text is in the layout report, at or above the floor, in both shapes', async () => {
  for (const format of ['vertical', 'horizontal']) {
    for (const name of CONTROLS) {
      const r = await t.studio.inspect.layoutReport({ composition: comp(name, { format }), t: 1.5 });
      const mine = r.texts.filter((x) => x.item === 'x');
      for (const want of SPECS[name].texts) assert.ok(mine.some((x) => x.text === want), `${name} (${format}): "${want}" is in the layout report (got ${mine.map((x) => x.text).join(' | ')})`);
      for (const x of mine) {
        assert.equal(x.floor, 2.6, `${name}: "${x.text}" carries the floor`);
        assert.ok(x.screenPct >= 2.6 - 0.05, `${name} (${format}): "${x.text}" is ${x.screenPct}% of the short side`);
      }
    }
  }
  // a label that cannot fit its box at the floor fails loudly instead of shrinking under it
  const tight = comp('ui-button', { params: { label: 'A label far too long for this little box' }, extra: { transform: safe(0.5, 0.5, 0.25, 0.3) } });
  await assert.rejects(t.studio.frameHashes({ composition: tight, times: [1] }), /size floor/);
});

/** Two scenes: a Play button that goes to the second one through a transition (or a cut). */
function scenes(transition) {
  return {
    width: 180, height: 320, fps: FPS, duration: 4, background: '#000000', theme: 'theme-tide',
    tracks: [
      { id: 'bg', type: 'visual', items: [{ id: 'bg', asset: 'ui-backdrop', start: 0, duration: 4 }] },
      { id: 'ui', type: 'visual', items: [
        { id: 'go', asset: 'ui-button', start: 0, duration: 2, params: { label: 'Play' }, transform: safe(0.3, 0.8, 0.5, 0.2) },
        { id: 'score', asset: 'ui-score', start: 2, duration: 2, params: { value: 980, style: 'stack' }, transform: safe(0.5, 0.4, 0.9, 0.3) },
      ] },
    ],
    interactive: { scenes: [{ id: 'a', start: 0, duration: 2, end: 'hold' }, { id: 'b', start: 2, duration: 2, end: 'hold' }], wires: [{ on: 'go.press', do: { go: 'b', transition } }] },
  };
}

test('ui transitions: they run between scenes, end on the incoming scene, and the iris opens from the tap', async () => {
  const steps = [WAIT, { tap: 'go' }];
  const start = F + 2;                 // the press fires on the release (frame F + 1): the next scene from F + 2
  const mid = start + 7, end = start + 20;
  const cut = await play(scenes(false), steps, [end]);
  assert.equal(cut.end.scene, 'b');
  for (const asset of TRANSITIONS) {
    const r = await play(scenes({ asset, duration: 0.5 }), steps, [F, mid, end]);
    const [before, during, after] = r.frames.map((x) => x.hash);
    assert.notEqual(during, before, `${asset} changes the picture`);
    assert.notEqual(during, after, `${asset} is still running half way`);
    assert.equal(after, cut.frames[0].hash, `${asset} ends on exactly the incoming scene`);
  }
  // the iris aims at the tap (the Play button sits low and left), not at the centre
  const tap = await play(scenes({ asset: 'ui-tx-iris', duration: 0.5 }), steps, [mid]);
  const centred = await play(scenes({ asset: 'ui-tx-iris', duration: 0.5, params: { origin: 'center' } }), steps, [mid]);
  assert.notEqual(tap.frames[0].hash, centred.frames[0].hash);
  // a push either way, a zoom in or out: different pictures half way
  const left = await play(scenes({ asset: 'ui-tx-push', duration: 0.5 }), steps, [mid]);
  const right = await play(scenes({ asset: 'ui-tx-push', duration: 0.5, params: { direction: 'right' } }), steps, [mid]);
  assert.notEqual(left.frames[0].hash, right.frames[0].hash);
  const zin = await play(scenes({ asset: 'ui-tx-zoom', duration: 0.5 }), steps, [mid]);
  const zout = await play(scenes({ asset: 'ui-tx-zoom', duration: 0.5, params: { mode: 'out' } }), steps, [mid]);
  assert.notEqual(zin.frames[0].hash, zout.frames[0].hash);
});

test('ui assets: the same input log replays to the same pixels (pure, no state between frames)', async () => {
  const c = comp('ui-menu');
  const steps = [WAIT, { move: { x: 90, y: 160 } }, { key: 'Tab' }, { tap: { item: 'x', id: 1 } }, { wait: 0.2 }];
  const a = await play(c, steps, [F + 2, F + 5, F + 9]);
  const b = await t.studio.play({ composition: c, log: a.log, frames: [F + 2, F + 5, F + 9] });
  assert.deepEqual(b.frames.map((x) => x.hash), a.frames.map((x) => x.hash));
  assert.equal(new Set(a.frames.map((x) => x.hash)).size, 3);
});
