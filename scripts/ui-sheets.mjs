// Contact sheets of the ui-* assets (the controls of interactive compositions): the states a viewer puts them in
// (rest, hover, held down, just released, keyboard focus, selected, changed…), under several themes and in vertical,
// horizontal and square frames. Every cell is a session frame drawn by studio.play: the same fold of scripted input
// and the same runtime as the browser player. Writes docs/showcase/v5/studio/ui-<name>.png.
//
//   node scripts/ui-sheets.mjs                    every sheet
//   node scripts/ui-sheets.mjs ui-button ui-menu  some of them
//   OUT=<dir> node scripts/ui-sheets.mjs          somewhere else
//
// It makes a throwaway studio under the system temp folder (TMPDIR / TEMP): nothing touches ./data.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStudio } from '../src/studio/studio.js';
import { createCanvas, loadImage, registerFonts, ROOT } from '../src/render/host.js';

registerFonts();

const OUT = process.env.OUT ?? join(ROOT, 'docs', 'showcase', 'v5', 'studio');
const FPS = 30;
const SIZES = { vertical: [1080, 1920], horizontal: [1920, 1080], square: [1080, 1080] };
const BASE = ['easing', 'theme-tide', 'theme-ember', 'theme-sketchbook', 'theme-neon', 'kit-icon'];
export const UI = ['ui-backdrop', 'ui-button', 'ui-card', 'ui-menu', 'ui-toggle', 'ui-slider', 'ui-progress', 'ui-score', 'ui-dialog', 'ui-hotspot', 'ui-toast', 'ui-tx-push', 'ui-tx-iris', 'ui-tx-zoom'];
const src = (name) => readFileSync(join(ROOT, 'assets', `${name}.js`), 'utf8');

/**
 * An interactive composition with one scene that holds (or the scenes given): a backdrop under the items.
 * @param {{ format?: string, theme?: string, items: any[], vars?: any, wires?: any[], duration?: number, scenes?: any[], transition?: any, backdrop?: any, under?: any[] }} o
 */
export function stage({ format = 'vertical', theme = 'theme-tide', items, vars = {}, wires = [], duration = 6, scenes, transition, backdrop = {}, under = [] }) {
  const [width, height] = SIZES[format];
  return {
    width, height, fps: FPS, duration, background: '#000000', theme,
    tracks: [
      { id: 'bg', type: 'visual', items: [{ id: 'bg', asset: 'ui-backdrop', start: 0, duration, params: backdrop }, ...under.map((i) => ({ start: 0, duration, ...i }))] },
      { id: 'ui', type: 'visual', items: items.map((i) => ({ start: 0, duration, ...i })) },
    ],
    interactive: { vars, scenes: scenes ?? [{ id: 'main', start: 0, duration, end: 'hold' }], wires, ...(transition ? { transition } : {}) },
  };
}

/**
 * The session frame a list of steps reaches (each step as core/interactive.js stepsToLog counts it).
 * @param {any[]} steps @param {number} [from]
 */
export function framesOf(steps, from = 1) {
  let n = from;
  for (const s of steps) n += s.wait !== undefined ? Math.max(1, Math.round(s.wait * FPS)) : s.tap !== undefined ? 2 : 1;
  return n;
}

/** A point of a region in frame pixels (u, v: fractions across it; the centre by default). */
export const pointOf = (r, u = 0.5, v = 0.5) => { const [a, b, c, d, e, f] = r.m; const x = r.x + r.w * u, y = r.y + r.h * v; return { x: Math.round((a * x + c * y + e) * 10) / 10, y: Math.round((b * x + d * y + f) * 10) / 10 }; };

export async function makeStudio() {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'ui-sheets-'));
  const studio = createStudio({ dataDir, role: 'test' });
  for (const name of [...BASE, ...UI]) await studio.library.createAsset({ slug: name, source: src(name), author: 'ui-sheets' });
  await studio.library.addFileAsset({ slug: 'lake', type: 'image', path: join(ROOT, 'showcase', 'uploads', 'mountain-lake-dawn.jpg'), description: 'A mountain lake at dawn, drawn by showcase/uploads/make.mjs, for the hotspot sheet.', author: 'ui-sheets', license: 'original' });
  return { studio, async close() { await studio.close(); try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may hold the db */ } } };
}

/** Grid of PNG cells (each with a label and an optional crop in fractions of the frame), rows of one height. */
async function sheet(cells, file, { rowH = 280, maxW = 2100 } = {}) {
  const gap = 14, label = 28;
  const items = [];
  for (const c of cells) {
    const img = await loadImage(c.png);
    const cr = c.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const sw = img.width * cr.w, sh = img.height * cr.h;
    items.push({ img, sx: img.width * cr.x, sy: img.height * cr.y, sw, sh, w: Math.round((sw / sh) * rowH), label: c.label });
  }
  const rows = [[]];
  let x = gap;
  for (const it of items) {
    if (x + it.w + gap > maxW && rows.at(-1).length) { rows.push([]); x = gap; }
    rows.at(-1).push(it);
    x += it.w + gap;
  }
  const W = Math.min(maxW, Math.max(...rows.map((r) => r.reduce((a, c) => a + c.w + gap, gap))));
  const H = rows.length * (rowH + label + gap) + gap;
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = 'high';
  rows.forEach((row, ri) => {
    let cx = gap;
    const y = gap + ri * (rowH + label + gap);
    for (const c of row) {
      g.drawImage(c.img, c.sx, c.sy, c.sw, c.sh, cx, y, c.w, rowH);
      g.fillStyle = '#9aa8bd';
      g.font = '600 15px Inter';
      g.fillText(c.label, cx + 2, y + rowH + 20, c.w - 4);
      cx += c.w + gap;
    }
  });
  mkdirSync(OUT, { recursive: true });
  const png = cv.toBuffer('image/png');
  writeFileSync(join(OUT, file), png);
  return { file: join(OUT, file), bytes: png.length, width: W, height: H };
}

// ── the cells of each asset ────────────────────────────────────────────────────────────────────
// A cell: { label, comp, steps, after (seconds after the steps), hover / down / drag: a region { item, id?, at: [u, v] } to
// move onto, hold down on, or press and drag along (drag: { item, from: [u, v], to: [u, v] }), crop (fractions; null: the
// whole frame) }.

const safe = (x, y, width, height) => ({ space: 'safe', x, y, width, height });
/** A crop of a vertical frame between two heights of its safe area (250 to 1520 px of 1920). */
const vcrop = (y0, y1) => ({ x: 0, y: (250 + 1270 * y0) / 1920, w: 1, h: (1270 * (y1 - y0)) / 1920 });
const W1 = [{ wait: 1 }];

const SPECS = {
  'ui-button': () => {
    const items = (extra = {}) => [
      { id: 'go', asset: 'ui-button', params: { label: 'Start the quiz', icon: 'arrow-right', hotkey: 'Enter', width: 100, ...extra }, transform: safe(0.5, 0.46, 0.86, 0.12) },
      { id: 'more', asset: 'ui-button', params: { label: 'How to play', variant: 'secondary', icon: 'book-open', iconSide: 'left', width: 100, delay: 0.08 }, transform: safe(0.5, 0.585, 0.86, 0.1) },
      { id: 'skip', asset: 'ui-button', params: { label: 'Skip for now', variant: 'ghost', delay: 0.16 }, transform: safe(0.5, 0.69, 0.86, 0.08) },
    ];
    const wires = [{ on: 'key:x', do: { send: 'go', event: 'shake' } }, { on: 'key:p', do: { send: 'go', event: 'pulse' } }];
    const c = (o = {}) => stage({ items: items(o.extra), wires, ...o });
    const crop = vcrop(0.38, 0.74);
    return { crop, sheet: { rowH: 224 }, cells: [
      { label: 'rest (tide), idle sheen', comp: c(), steps: [{ wait: 1.25 }] },
      { label: 'hover', comp: c(), steps: W1, hover: { item: 'go' }, after: 0.3 },
      { label: 'held down: sunk on its lip', comp: c(), steps: W1, down: { item: 'go' }, after: 0.1 },
      { label: 'released: ripple, spring', comp: c(), steps: [...W1, { tap: 'go' }], after: 0.1 },
      { label: 'Tab: focus ring', comp: c(), steps: [...W1, { key: 'Tab' }], after: 0.2 },
      { label: 'pulse (sent)', comp: c(), steps: [...W1, { key: 'p' }], after: 0.2 },
      { label: 'secondary hovered', comp: c(), steps: W1, hover: { item: 'more' }, after: 0.3 },
      { label: 'disabled', comp: c({ extra: { disabled: true } }), steps: W1 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: W1 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: W1 },
      { label: 'neon, hovered', comp: c({ theme: 'theme-neon' }), steps: W1, hover: { item: 'go' }, after: 0.3 },
      { label: 'horizontal 1920 x 1080, hugging their labels', comp: stage({ format: 'horizontal', items: [
        { id: 'a', asset: 'ui-button', params: { label: 'Play again', icon: 'rotate-ccw', iconSide: 'left' }, transform: safe(0.36, 0.5, 0.3, 0.2) },
        { id: 'b', asset: 'ui-button', params: { label: 'Share', variant: 'secondary', icon: 'share-2', iconSide: 'left' }, transform: safe(0.64, 0.5, 0.3, 0.2) }] }), steps: W1, crop: null },
      { label: 'square, icon only', comp: stage({ format: 'square', items: [
        { id: 'p', asset: 'ui-button', params: { label: '', icon: 'play', size: 16 }, transform: { x: 0.3, y: 0.5, width: 0.3, height: 0.3 } },
        { id: 'q', asset: 'ui-button', params: { label: '', icon: 'heart', variant: 'secondary', size: 16 }, transform: { x: 0.5, y: 0.5, width: 0.3, height: 0.3 } },
        { id: 'r', asset: 'ui-button', params: { label: '', icon: 'x', variant: 'ghost', size: 16 }, transform: { x: 0.7, y: 0.5, width: 0.3, height: 0.3 } }] }), steps: W1, hover: { item: 'q' }, after: 0.3, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } },
    ] };
  },

  'ui-card': () => {
    const answers = [['a', 'Paris', 'A'], ['b', 'Lyon', 'B'], ['c', 'Marseille', 'C'], ['d', 'Bordeaux', 'D']];
    const pos = [[0.26, 0.46], [0.74, 0.46], [0.26, 0.66], [0.74, 0.66]];
    const items = (extra = {}) => answers.map(([id, title, badge], i) => ({ id, asset: 'ui-card', params: { title, badge, hotkey: String(i + 1), detail: ['Seine', 'Rhône and Saône', 'Mediterranean', 'Garonne'][i], choice: { $var: 'pick' }, answer: 'Lyon', reveal: { $var: 'shown' }, back: 'Two rivers meet here', delay: i * 0.07, ...extra }, transform: safe(...pos[i], 0.47, 0.19) }));
    const wires = [...answers.map(([id]) => ({ on: `${id}.select`, do: { set: { pick: '$value' } } })), { on: 'key:r', do: { set: { shown: true } } }, { on: 'key:f', do: answers.map(([id]) => ({ send: id, event: 'flip' })) }];
    const c = (o = {}) => stage({ items: items(o.extra), vars: { pick: '', shown: false }, wires, ...o });
    const crop = vcrop(0.34, 0.78);
    return { crop, sheet: { rowH: 200 }, cells: [
      { label: 'rest', comp: c(), steps: W1 },
      { label: 'hover B: lift, glow under the pointer', comp: c(), steps: W1, hover: { item: 'b', at: [0.35, 0.3] }, after: 0.3 },
      { label: 'A picked (choice bound)', comp: c(), steps: [...W1, { tap: 'a' }], after: 0.5 },
      { label: 'revealed: A wrong (shaking), B right', comp: c(), steps: [...W1, { tap: 'a' }, { wait: 0.3 }, { key: 'r' }], after: 0.12 },
      { label: 'revealed, settled', comp: c(), steps: [...W1, { tap: 'a' }, { wait: 0.3 }, { key: 'r' }], after: 0.9 },
      { label: 'Tab, Tab: focus on B', comp: c(), steps: [...W1, { key: 'Tab' }, { key: 'Tab' }], after: 0.2 },
      { label: 'flip (sent): half way', comp: c(), steps: [...W1, { key: 'f' }], after: 0.2 },
      { label: 'flipped', comp: c(), steps: [...W1, { key: 'f' }], after: 0.8 },
      { label: 'ember, B picked', comp: c({ theme: 'theme-ember' }), steps: [...W1, { tap: 'b' }], after: 0.5 },
      { label: 'sketchbook, revealed', comp: c({ theme: 'theme-sketchbook' }), steps: [...W1, { tap: 'c' }, { wait: 0.2 }, { key: 'r' }], after: 0.9 },
      { label: 'neon, hover C', comp: c({ theme: 'theme-neon' }), steps: W1, hover: { item: 'c' }, after: 0.3 },
      { label: 'horizontal: icon cards', comp: stage({ format: 'horizontal', vars: { lvl: 'normal' }, wires: [{ on: 'e.select', do: { set: { lvl: '$value' } } }], items: [
        { id: 'e', asset: 'ui-card', params: { title: 'Easy', detail: 'Three lives, no timer', icon: 'heart', badge: '', value: 'easy', choice: { $var: 'lvl' } }, transform: safe(0.2, 0.5, 0.28, 0.62) },
        { id: 'n', asset: 'ui-card', params: { title: 'Normal', detail: 'Two lives, 20 s a round', icon: 'target', badge: '', value: 'normal', choice: { $var: 'lvl' }, delay: 0.08 }, transform: safe(0.5, 0.5, 0.28, 0.62) },
        { id: 'h', asset: 'ui-card', params: { title: 'Hard', detail: 'One life, 10 s a round', icon: 'flame', badge: '', value: 'hard', choice: { $var: 'lvl' }, delay: 0.16 }, transform: safe(0.8, 0.5, 0.28, 0.62) }] }), steps: W1, hover: { item: 'h' }, after: 0.3, crop: null },
      { label: 'square: picture cards', comp: stage({ format: 'square', items: [
        { id: 'p', asset: 'ui-card', params: { title: 'Lake at dawn', detail: 'Alps, 6:10', image: 'lake', badge: '1' }, transform: { x: 0.27, y: 0.5, width: 0.44, height: 0.62 } },
        { id: 'q', asset: 'ui-card', params: { title: 'Lake at dawn', detail: 'Picked', image: 'lake', badge: '2', state: 'selected' }, transform: { x: 0.73, y: 0.5, width: 0.44, height: 0.62 } }] }), steps: W1, crop: { x: 0, y: 0.15, w: 1, h: 0.7 } },
    ] };
  },

  'ui-menu': () => {
    const options = [
      { label: 'New game', icon: 'play', value: 'new' },
      { label: 'Continue', detail: 'Level 3', icon: 'history', value: 'continue' },
      { label: 'Leaderboard', detail: '#12', icon: 'trophy', value: 'board' },
      { label: 'Settings', icon: 'settings', value: 'settings' },
      { label: 'Bonus round', icon: 'gift', value: 'bonus', locked: true },
    ];
    const item = (extra = {}) => ({ id: 'menu', asset: 'ui-menu', params: { title: 'Main menu', options, highlight: { $var: 'row' }, emit: 'index', ...extra }, transform: safe(0.5, 0.52, 0.92, 0.5) });
    const wires = [{ on: 'menu.select', do: { set: { row: '$value' } } }, { on: 'key:ArrowDown', do: { add: { row: 1 }, min: 0, max: 3, wrap: true } }, { on: 'key:x', do: { send: 'menu', event: 'shake', value: 2 } }];
    const c = (o = {}) => stage({ items: [item(o.extra)], vars: { row: 0 }, wires, ...o });
    const crop = { x: 0, y: 0.25, w: 1, h: 0.53 };
    return { crop, cells: [
      { label: 'rest: highlight bound to row 0', comp: c(), steps: W1 },
      { label: 'hover Leaderboard', comp: c(), steps: W1, hover: { item: 'menu', id: 2 }, after: 0.3 },
      { label: 'Settings held down', comp: c(), steps: W1, down: { item: 'menu', id: 3 }, after: 0.1 },
      { label: 'tap Settings: the indicator slides', comp: c(), steps: [...W1, { tap: { item: 'menu', id: 3 } }], after: 0.1 },
      { label: 'settled, ripple gone', comp: c(), steps: [...W1, { tap: { item: 'menu', id: 3 } }], after: 0.7 },
      { label: 'Tab, Tab: focus on Continue', comp: c(), steps: [...W1, { key: 'Tab' }, { key: 'Tab' }], after: 0.2 },
      { label: 'shake row 2 (sent)', comp: c(), steps: [...W1, { key: 'x' }], after: 0.1 },
      { label: 'keycaps instead of chevrons', comp: c({ extra: { keycaps: true } }), steps: W1 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: W1 },
      { label: 'sketchbook, separate pills', comp: c({ theme: 'theme-sketchbook', extra: { panel: false } }), steps: W1 },
      { label: 'neon, hover', comp: c({ theme: 'theme-neon' }), steps: W1, hover: { item: 'menu', id: 1 }, after: 0.3 },
      { label: 'entrance, 0.3 s', comp: c(), steps: [{ wait: 0.3 }] },
      { label: 'horizontal 1920 x 1080', comp: stage({ format: 'horizontal', vars: { row: 1 }, wires, items: [{ ...item({ title: '' }), transform: safe(0.3, 0.5, 0.45, 0.9) }] }), steps: W1, crop: null },
    ] };
  },

  'ui-toggle': () => {
    const items = (extra = {}) => [
      { id: 'snd', asset: 'ui-toggle', params: { label: 'Sound', detail: 'Music and effects', on: { $var: 'sound' }, ...extra }, transform: safe(0.5, 0.4, 0.92, 0.11) },
      { id: 'vib', asset: 'ui-toggle', params: { label: 'Vibration', on: { $var: 'vibe' }, delay: 0.06 }, transform: safe(0.5, 0.525, 0.92, 0.11) },
      { id: 'hint', asset: 'ui-toggle', params: { label: 'Show hints', detail: 'After 10 seconds', on: { $var: 'hints' }, delay: 0.12 }, transform: safe(0.5, 0.65, 0.92, 0.11) },
    ];
    const wires = ['snd', 'vib', 'hint'].map((id, i) => ({ on: `${id}.change`, do: { set: { [['sound', 'vibe', 'hints'][i]]: '$value' } } }));
    const c = (o = {}) => stage({ items: items(o.extra), vars: { sound: true, vibe: false, hints: true }, wires, ...o });
    const crop = vcrop(0.32, 0.73);
    return { crop, sheet: { rowH: 250 }, cells: [
      { label: 'rest: on, off, on', comp: c(), steps: W1 },
      { label: 'hover Vibration', comp: c(), steps: W1, hover: { item: 'vib' }, after: 0.3 },
      { label: 'Vibration held: the thumb stretches', comp: c(), steps: W1, down: { item: 'vib' }, after: 0.1 },
      { label: 'tapped: sliding over', comp: c(), steps: [...W1, { tap: 'vib' }], after: 0.06 },
      { label: 'switched on', comp: c(), steps: [...W1, { tap: 'vib' }], after: 0.6 },
      { label: 'Tab: focus ring on Sound', comp: c(), steps: [...W1, { key: 'Tab' }], after: 0.2 },
      { label: 'disabled', comp: c({ extra: { disabled: true } }), steps: W1 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: W1 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: W1 },
      { label: 'neon', comp: c({ theme: 'theme-neon' }), steps: W1 },
      { label: 'horizontal, bare (no plate)', comp: stage({ format: 'horizontal', vars: { a: true, b: false }, items: [
        { id: 'x1', asset: 'ui-toggle', params: { label: 'Captions', on: { $var: 'a' }, plate: false }, transform: safe(0.5, 0.42, 0.5, 0.16) },
        { id: 'x2', asset: 'ui-toggle', params: { label: 'Autoplay', on: { $var: 'b' }, plate: false }, transform: safe(0.5, 0.58, 0.5, 0.16) }] }), steps: W1, crop: null },
    ] };
  },

  'ui-slider': () => {
    const items = (extra = {}) => [
      { id: 'vol', asset: 'ui-slider', params: { label: 'Volume', value: { $var: 'vol' }, ...extra }, transform: safe(0.5, 0.44, 0.86, 0.12) },
      { id: 'spd', asset: 'ui-slider', params: { label: 'Speed', value: { $var: 'spd' }, min: 0.5, max: 2, step: 0.25, decimals: 2, suffix: '×', delay: 0.08 }, transform: safe(0.5, 0.58, 0.86, 0.12) },
    ];
    const wires = [{ on: 'vol.change', do: { set: { vol: '$value' } } }, { on: 'spd.change', do: { set: { spd: '$value' } } }, { on: 'key:p', do: { send: 'vol', event: 'pulse' } }];
    const c = (o = {}) => stage({ items: items(o.extra), vars: { vol: 0.6, spd: 1 }, wires, ...o });
    const crop = vcrop(0.35, 0.67);
    return { crop, sheet: { rowH: 236 }, cells: [
      { label: 'rest', comp: c(), steps: W1 },
      { label: 'hover: halo', comp: c(), steps: W1, hover: { item: 'vol', at: [0.6, 0.5] }, after: 0.3 },
      { label: 'dragging: the value bubble', comp: c(), steps: W1, drag: { item: 'vol', from: [0.6, 0.5], to: [0.85, 0.5] }, after: 0 },
      { label: 'released', comp: c(), steps: W1, drag: { item: 'vol', from: [0.6, 0.5], to: [0.85, 0.5], release: true }, after: 0.6 },
      { label: 'Tab, Tab, right arrow twice: speed by steps', comp: c(), steps: [...W1, { key: 'Tab' }, { key: 'Tab' }, { key: 'ArrowRight' }, { key: 'ArrowRight' }], after: 0.08 },
      { label: 'pulse (sent)', comp: c(), steps: [...W1, { key: 'p' }], after: 0.25 },
      { label: 'disabled', comp: c({ extra: { disabled: true } }), steps: W1 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: W1 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: W1 },
      { label: 'neon, dragging', comp: c({ theme: 'theme-neon' }), steps: W1, drag: { item: 'vol', from: [0.6, 0.5], to: [0.3, 0.5] }, after: 0 },
      { label: 'horizontal 1920 x 1080', comp: stage({ format: 'horizontal', vars: { vol: 0.6, spd: 1 }, wires, items: items().map((i) => ({ ...i, transform: { ...i.transform, width: 0.5 } })) }), steps: W1, crop: null },
    ] };
  },

  'ui-progress': () => {
    const items = (extra = {}) => [
      { id: 'bar', asset: 'ui-progress', params: { value: { $var: 'q' }, max: 5, label: 'Quiz', showValue: 'percent', ...extra }, transform: safe(0.5, 0.36, 0.86, 0.07) },
      { id: 'dots', asset: 'ui-progress', params: { value: { $var: 'q' }, max: 5, style: 'dots', label: 'Question', delay: 0.06, ...extra }, transform: safe(0.5, 0.47, 0.86, 0.08) },
      { id: 'ring', asset: 'ui-progress', params: { value: { $var: 'q' }, max: 5, style: 'ring', label: 'done', showValue: 'percent', size: 2.4, delay: 0.12, ...extra }, transform: safe(0.5, 0.64, 0.5, 0.2) },
    ];
    const wires = [{ on: 'key:n', do: [{ add: { q: 1 }, max: 5 }] }, { on: 'key:p', do: [{ send: 'bar', event: 'pulse' }, { send: 'dots', event: 'pulse' }, { send: 'ring', event: 'pulse' }] }];
    const c = (o = {}) => stage({ items: items(o.extra), vars: { q: 2 }, wires, ...o });
    const crop = { x: 0, y: 0.26, w: 1, h: 0.5 };
    return { crop, cells: [
      { label: 'entrance: filling in (0.4 s)', comp: c(), steps: [{ wait: 0.4 }] },
      { label: 'rest: 2 of 5', comp: c(), steps: [{ wait: 1.2 }] },
      { label: 'n: gliding to 3', comp: c(), steps: [{ wait: 1.2 }, { key: 'n' }], after: 0.15 },
      { label: '3 of 5', comp: c(), steps: [{ wait: 1.2 }, { key: 'n' }], after: 0.9 },
      { label: 'complete', comp: c(), steps: [{ wait: 1.2 }, { key: 'n' }, { key: 'n' }, { key: 'n' }], after: 1 },
      { label: 'pulse (sent)', comp: c(), steps: [{ wait: 1.2 }, { key: 'p' }], after: 0.15 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: [{ wait: 1.2 }] },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: [{ wait: 1.2 }] },
      { label: 'neon', comp: c({ theme: 'theme-neon' }), steps: [{ wait: 1.2 }] },
      { label: 'horizontal: a quiz header', comp: stage({ format: 'horizontal', vars: { q: 3 }, items: [
        { id: 'dots', asset: 'ui-progress', params: { value: { $var: 'q' }, max: 8, style: 'dots', label: 'Round', showValue: 'count' }, transform: safe(0.5, 0.1, 0.7, 0.14) },
        { id: 'bar', asset: 'ui-progress', params: { value: 0.72, max: 1, label: 'Time left', showValue: 'none', color: '#ffb347' }, transform: safe(0.5, 0.9, 0.7, 0.1) }] }), steps: [{ wait: 1.2 }], crop: null },
    ] };
  },

  'ui-score': () => {
    const items = (extra = {}) => [
      { id: 'pill', asset: 'ui-score', params: { value: { $var: 'score' }, label: 'Score', icon: 'star', ...extra }, transform: safe(0.5, 0.36, 0.7, 0.1) },
      { id: 'big', asset: 'ui-score', params: { value: { $var: 'score' }, label: 'Points', style: 'stack', size: 14, ...extra }, transform: safe(0.5, 0.52, 0.8, 0.18) },
      { id: 'lives', asset: 'ui-score', params: { value: { $var: 'lives' }, label: '', icon: 'heart', style: 'plain', size: 7, color: '#ff5c8a', ...extra }, transform: safe(0.5, 0.67, 0.6, 0.08) },
    ];
    const wires = [{ on: 'key:a', do: { add: { score: 250 } } }, { on: 'key:l', do: { add: { lives: -1 }, min: 0 } }, { on: 'key:b', do: { send: 'pill', event: 'bump' } }];
    const c = (o = {}) => stage({ items: items(o.extra), vars: { score: 1250, lives: 3 }, wires, ...o });
    const crop = { x: 0, y: 0.27, w: 1, h: 0.46 };
    return { crop, cells: [
      { label: 'rest', comp: c(), steps: W1 },
      { label: '+250: pop (0.06 s)', comp: c(), steps: [...W1, { key: 'a' }], after: 0.06 },
      { label: 'ticking (0.25 s), +250 floats', comp: c(), steps: [...W1, { key: 'a' }], after: 0.25 },
      { label: 'settled (0.9 s)', comp: c(), steps: [...W1, { key: 'a' }], after: 0.9 },
      { label: 'a life lost: red flash', comp: c(), steps: [...W1, { key: 'l' }], after: 0.15 },
      { label: 'bump (sent)', comp: c(), steps: [...W1, { key: 'b' }], after: 0.08 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: W1 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: W1 },
      { label: 'neon, +250', comp: c({ theme: 'theme-neon' }), steps: [...W1, { key: 'a' }], after: 0.25 },
      { label: 'horizontal: a HUD', comp: stage({ format: 'horizontal', vars: { score: 980, lives: 3 }, items: [
        { id: 's', asset: 'ui-score', params: { value: { $var: 'score' }, label: 'Score', icon: 'trophy', align: 'right' }, transform: safe(0.8, 0.08, 0.4, 0.14) },
        { id: 'l', asset: 'ui-score', params: { value: { $var: 'lives' }, label: 'Lives', icon: 'heart', align: 'left', color: '#ff5c8a' }, transform: safe(0.2, 0.08, 0.4, 0.14) },
        { id: 't', asset: 'ui-score', params: { value: 42, label: 'seconds left', style: 'stack', suffix: '', size: 18 }, transform: safe(0.5, 0.5, 0.5, 0.4) }] }), steps: W1, crop: null },
    ] };
  },

  'ui-dialog': () => {
    const under = [{ id: 'm', asset: 'ui-menu', params: { title: 'Main menu' }, transform: safe(0.5, 0.5, 0.92, 0.5) }];
    const dlg = (extra = {}) => ({ id: 'dlg', asset: 'ui-dialog', params: { ...extra } });
    const wires = [{ on: 'key:x', do: { send: 'dlg', event: 'shake' } }];
    const c = (o = {}) => stage({ items: [...under, dlg(o.extra)], wires, ...o });
    return { crop: { x: 0, y: 0.2, w: 1, h: 0.6 }, cells: [
      { label: 'entrance (0.15 s)', comp: c(), steps: [{ wait: 0.15 }] },
      { label: 'open over a menu (the scrim blocks it)', comp: c(), steps: W1 },
      { label: 'hover Leave', comp: c(), steps: W1, hover: { item: 'dlg', name: 'confirm' }, after: 0.3 },
      { label: 'Stay held down', comp: c(), steps: W1, down: { item: 'dlg', name: 'cancel', id: 'button' }, after: 0.1 },
      { label: 'Tab: focus on Leave', comp: c(), steps: [...W1, { key: 'Tab' }], after: 0.2 },
      { label: 'shake (sent)', comp: c(), steps: [...W1, { key: 'x' }], after: 0.1 },
      { label: 'danger, ember', comp: c({ theme: 'theme-ember', extra: { tone: 'danger', title: 'Delete this run?', body: 'Your best time and the replay go with it.', confirm: 'Delete', cancel: 'Keep it', icon: 'trash-2' } }), steps: W1 },
      { label: 'success, one button, neon', comp: c({ theme: 'theme-neon', extra: { tone: 'success', title: 'Level complete', body: '3 stars, 12,480 points.\nThe next level is open.', confirm: 'Next level', cancel: '', icon: 'trophy' } }), steps: W1 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: W1 },
      { label: 'horizontal: buttons side by side', comp: stage({ format: 'horizontal', items: [{ ...under[0], transform: safe(0.3, 0.5, 0.45, 0.9) }, dlg({ width: 70 })] }), steps: W1, crop: null },
    ] };
  },

  'ui-hotspot': () => {
    const pic = { id: 'pic', asset: 'lake', params: { fit: 'cover' } };
    const spot = (id, x, y, extra = {}) => ({ id, asset: 'ui-hotspot', params: { point: { x, y }, space: { width: 1600, height: 1200 }, fit: 'cover', ...extra } });
    const items = (extra = {}) => [
      spot('peak', 800, 330, { label: 'The north face', ...extra }),
      spot('lake', 640, 820, { label: 'Still water at 6:10', mark: '2', icon: '', ...extra }),
      spot('pine', 1010, 700, { label: 'Old pines', visited: { $var: 'seen' }, ...extra }),
    ];
    const wires = [{ on: 'peak.press', do: { set: { seen: true } } }, { on: 'key:g', do: { send: 'lake', event: 'ping' } }];
    const c = (o = {}) => stage({ items: items(o.extra), under: [pic], vars: { seen: true }, wires, ...o });
    const crop = { x: 0, y: 0.1, w: 1, h: 0.62 };
    return { crop, cells: [
      { label: 'rest: pulsing (one visited)', comp: c(), steps: [{ wait: 1.3 }] },
      { label: 'hover: the label', comp: c(), steps: W1, hover: { item: 'peak' }, after: 0.3 },
      { label: 'held down', comp: c(), steps: W1, down: { item: 'peak' }, after: 0.1 },
      { label: 'tapped: burst', comp: c(), steps: [...W1, { tap: 'peak' }], after: 0.15 },
      { label: 'Tab, Tab: focus shows its label', comp: c(), steps: [...W1, { key: 'Tab' }, { key: 'Tab' }], after: 0.2 },
      { label: 'ping (sent)', comp: c(), steps: [...W1, { key: 'g' }], after: 0.2 },
      { label: 'labels always (phones)', comp: c({ extra: { labelOn: 'always' } }), steps: W1 },
      { label: 'ember', comp: c({ theme: 'theme-ember' }), steps: W1, hover: { item: 'lake' }, after: 0.3 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: W1 },
      { label: 'neon', comp: c({ theme: 'theme-neon' }), steps: W1 },
      { label: 'horizontal 1920 x 1080', comp: c({ format: 'horizontal' }), steps: W1, hover: { item: 'lake' }, after: 0.3, crop: null },
    ] };
  },

  'ui-toast': () => {
    const t = (extra = {}) => ({ id: 'toast', asset: 'ui-toast', params: { ...extra } });
    const wires = [
      { on: 'key:s', do: { send: 'toast', event: 'success', value: 'Correct, +10' } },
      { on: 'key:e', do: { send: 'toast', event: 'show', value: 'error: Not quite, try again' } },
      { on: 'key:i', do: { send: 'toast', event: 'show', value: 'info: Two tries left' } },
      { on: 'key:w', do: { send: 'toast', event: 'show', value: 'warn: 5 seconds' } },
    ];
    const c = (o = {}) => stage({ items: [t(o.extra)], wires, ...o });
    const crop = { x: 0.04, y: 0.125, w: 0.92, h: 0.085 };
    return { crop, sheet: { rowH: 140 }, cells: [
      { label: 'success: dropping in (0.12 s)', comp: c(), steps: [...W1, { key: 's' }], after: 0.12 },
      { label: 'success: sparkle (0.35 s)', comp: c(), steps: [...W1, { key: 's' }], after: 0.35 },
      { label: 'holding, the timer runs (1 s)', comp: c(), steps: [...W1, { key: 's' }], after: 1 },
      { label: 'leaving (1.95 s)', comp: c(), steps: [...W1, { key: 's' }], after: 1.95 },
      { label: 'error: shaking (0.2 s)', comp: c(), steps: [...W1, { key: 'e' }], after: 0.2 },
      { label: 'info', comp: c(), steps: [...W1, { key: 'i' }], after: 0.8 },
      { label: 'warn', comp: c(), steps: [...W1, { key: 'w' }], after: 0.8 },
      { label: 'sketchbook', comp: c({ theme: 'theme-sketchbook' }), steps: [...W1, { key: 'e' }], after: 0.8 },
      { label: 'neon', comp: c({ theme: 'theme-neon' }), steps: [...W1, { key: 's' }], after: 0.8 },
      { label: 'at the bottom', comp: c({ theme: 'theme-neon', extra: { edge: 'bottom' } }), steps: [...W1, { key: 'i' }], after: 0.8, crop: { x: 0.04, y: 0.7, w: 0.92, h: 0.085 } },
      { label: 'horizontal, text from the start', comp: stage({ format: 'horizontal', items: [t({ text: 'ok: Saved to your library', hold: 0 })] }), steps: W1, crop: { x: 0.15, y: 0.04, w: 0.7, h: 0.16 } },
    ] };
  },
};

// the scene transitions: two scenes (a menu, a results screen) and a tap on a button that goes between them
function txSpec(asset, label, params = {}, back = null) {
  return () => {
    const comp = (theme = 'theme-tide', format = 'vertical', p = params) => {
        return {
        ...stage({ format, theme, duration: 8, items: [
          { id: 'menu', asset: 'ui-menu', start: 0, duration: 4, params: { title: 'Main menu' }, transform: safe(0.5, 0.45, 0.92, 0.5) },
          { id: 'go', asset: 'ui-button', start: 0, duration: 4, params: { label: 'Play', icon: 'play', width: 100 }, transform: safe(0.68, 0.82, 0.56, 0.12) },
          { id: 'score', asset: 'ui-score', start: 4, duration: 4, params: { value: 12480, label: 'Points', style: 'stack', size: 14 }, transform: safe(0.5, 0.4, 0.9, 0.2) },
          { id: 'prog', asset: 'ui-progress', start: 4, duration: 4, params: { value: 5, max: 5, style: 'dots', label: 'Level 3', showValue: 'none' }, transform: safe(0.5, 0.58, 0.8, 0.08) },
        ], scenes: [{ id: 'menu', start: 0, duration: 4, end: 'hold' }, { id: 'done', start: 4, duration: 4, end: 'hold' }],
        wires: [{ on: 'go.press', do: { go: 'done', transition: { asset, duration: 0.6, params: p } } }, { on: 'key:Escape', do: { go: 'back', transition: { asset, duration: 0.6, params: back ?? p } } }] }),
      };
    };
    // the second scene on another backdrop: give the done scene its own colours
    const two = (theme, format, p) => {
      const c = comp(theme, format, p);
      c.tracks[0].items[0] = { ...c.tracks[0].items[0], duration: 4 };
      c.tracks[0].items.push({ id: 'bg2', asset: 'ui-backdrop', start: 4, duration: 4, params: { style: 'grid', colorA: '#ff5c8a' } });
      return c;
    };
    const go = [{ wait: 1 }, { tap: 'go' }];
    /** @type {any[]} */
    const cells = [0.1, 0.25, 0.4, 0.55].map((s) => ({ label: `${label}: ${Math.round((s / 0.6) * 100)} %`, comp: two(), steps: go, after: s - 0.03 }));
    cells.unshift({ label: 'before: the tap on Play', comp: two(), steps: W1, down: { item: 'go' }, after: 0.05 });
    cells.push({ label: 'after', comp: two(), steps: go, after: 0.9 });
    if (back) cells.push({ label: 'Escape: back, 40 %', comp: two(), steps: [...go, { wait: 1 }, { key: 'Escape' }], after: 0.24 });
    cells.push({ label: 'neon, 45 %', comp: two('theme-neon'), steps: go, after: 0.25 });
    cells.push({ label: 'horizontal, 45 %', comp: two('theme-tide', 'horizontal'), steps: go, after: 0.25 });
    return { crop: null, cells };
  };
}
SPECS['ui-tx-push'] = txSpec('ui-tx-push', 'push', {}, { direction: 'right' });
SPECS['ui-tx-iris'] = txSpec('ui-tx-iris', 'iris from the tap');
SPECS['ui-tx-zoom'] = txSpec('ui-tx-zoom', 'zoom-through', {}, { mode: 'out' });

/**
 * Steps for a cell: its own, then a move onto a region (hover), a press held on it (down), or a press and drag.
 * @param {any} studio @param {any} cell
 */
async function stepsOf(studio, cell) {
  const steps = [...cell.steps];
  const want = cell.hover ?? cell.down ?? cell.drag;
  if (!want) return steps;
  const reach = framesOf(steps);
  const r0 = await studio.play({ composition: cell.comp, steps, frames: [reach], regions: true });
  const regions = r0.frames[0].regions;
  const r = regions.find((x) => x.item === want.item && (want.name === undefined || x.name === want.name) && (want.id === undefined || String(x.id) === String(want.id)));
  if (!r) throw new Error(`${cell.label}: no region ${JSON.stringify(want)}; regions: ${regions.map((x) => `${x.item}.${x.name}#${x.id ?? ''}`).join(', ')}`);
  if (cell.hover) return [...steps, { move: pointOf(r, ...(cell.hover.at ?? [])) }];
  if (cell.down) { const p = pointOf(r, ...(cell.down.at ?? [])); return [...steps, { move: p }, { down: p }]; }
  const a = pointOf(r, ...cell.drag.from), b = pointOf(r, ...cell.drag.to);
  const path = [1, 2, 3, 4, 5, 6].map((i) => ({ move: { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 } }));
  return [...steps, { move: a }, { down: a }, ...path, ...(cell.drag.release ? [{ up: b }] : [])];
}

/**
 * One cell's PNG.
 * @param {any} studio @param {any} cell @param {number} [maxSize]
 */
export async function cellPng(studio, cell, maxSize = 960) {
  const steps = await stepsOf(studio, cell);
  const at = framesOf(steps) + Math.round((cell.after ?? 0) * FPS);
  const r = await studio.play({ composition: cell.comp, steps, frames: [at], stills: true, maxSize });
  return r.frames[0].png;
}

export async function buildSheet(studio, name) {
  const spec = SPECS[name]();
  const out = [];
  for (const cell of spec.cells) out.push({ label: cell.label, png: await cellPng(studio, cell), crop: cell.crop === undefined ? spec.crop : cell.crop });
  return sheet(out, `${name}.png`, spec.sheet);
}

export const SHEETS = Object.keys(SPECS);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = want.length ? want : SHEETS;
  const t = await makeStudio();
  try {
    for (const name of names) {
      const t0 = Date.now();
      const r = await buildSheet(t.studio, name);
      console.log(`${name}: ${r.file} ${r.width}x${r.height} ${Math.round(r.bytes / 1024)} KB (${Date.now() - t0} ms)`);
    }
  } finally {
    await t.close();
  }
}
