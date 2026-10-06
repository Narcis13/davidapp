// The parity cases: one composition per thing iteration 2 draws, and the frames to compare.
// Shared by test/parity.test.js (thresholds) and scripts/parity.mjs (evidence with diff images).

import { createCanvas } from '../../src/render/host.js';
import { EASING, LABEL } from '../../test/helpers.js';
import * as K from '../../test/fixtures/kinds.js';
import { BALL, LETTERS } from '../../test/fixtures/solid.js';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">
  <path d="M20 100 C40 20, 120 20, 140 100" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  <rect x="50" y="60" width="60" height="40" rx="10" fill="#7b5cff" stroke="#16121f" stroke-width="4"/>
  <circle cx="80" cy="40" r="14" fill="#ff5c8a"/>
</svg>`;

export const BLOCK = `asset({
  description: 'A rounded block with a darker border, for parity tests.',
  tags: ['shape', 'test'],
  duration: 2,
  params: { color: { type: 'color', default: '#ff5c8a' }, size: { type: 'number', default: 1 } },
  render(f, p) {
    f.ctx.fillStyle = p.color;
    f.ctx.beginPath();
    f.ctx.roundRect(0, 0, f.width * p.size, f.height * p.size, Math.min(f.width, f.height) * 0.12);
    f.ctx.fill();
    f.ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    f.ctx.lineWidth = 4;
    f.ctx.stroke();
  },
});`;
const BACKDROP = `asset({
  description: 'A gradient backdrop with a few circles, for parity tests.',
  tags: ['background', 'test'],
  render(f) {
    const g = f.ctx.createLinearGradient(0, 0, f.width, f.height);
    g.addColorStop(0, '#1b1f3b'); g.addColorStop(1, '#2a6f97');
    f.ctx.fillStyle = g;
    f.ctx.fillRect(0, 0, f.width, f.height);
    f.ctx.fillStyle = 'rgba(255,209,102,0.8)';
    for (let i = 0; i < 5; i++) { f.ctx.beginPath(); f.ctx.arc(f.width * (0.15 + i * 0.18), f.height * (0.3 + (i % 2) * 0.4), f.height * 0.08, 0, Math.PI * 2); f.ctx.fill(); }
  },
});`;
const CARD = `const LAYERS = [
  { asset: 'block', start: 0, duration: 2, params: { color: { $param: 'accent' } }, transform: { x: 0.5, y: 0.55, width: 0.7, height: 0.5 } },
  { asset: 'label', start: 0.2, duration: 1.8, params: { text: { $param: 'title' }, color: '#ffffff' }, transform: { y: 0.55, width: 0.6, height: 0.3 }, motions: [{ asset: 'pop', phase: 'in' }] },
];
asset({
  description: 'A card precomp: a block with a title that pops in, for parity tests.',
  tags: ['precomp', 'test'],
  duration: 2,
  uses: ['block', 'label', 'pop'],
  params: { title: { type: 'string', default: 'Card' }, accent: { type: 'color', default: '#7b5cff' } },
  render(f, p) { f.layers(LAYERS, p); },
});`;


/** The assets the cases use, created in a studio. */
export async function seedParity(studio, author = 'parity') {
  for (const [slug, source] of [['easing', EASING], ['label', LABEL], ['block', BLOCK], ['backdrop', BACKDROP], ['pop', K.MOTION_POP], ['slide', K.MOTION_SLIDE], ['wiggle', K.MOTION_WIGGLE],
    ['wipe', K.TRANSITION_WIPE], ['push', K.TRANSITION_PUSH], ['iris', K.TRANSITION_IRIS], ['glow', K.EFFECT_GLOW], ['grain', K.EFFECT_GRAIN], ['duotone', K.EFFECT_DUOTONE], ['blur', K.EFFECT_BLUR], ['circle', K.MASK_CIRCLE], ['card', CARD],
    ['ball', BALL], ['letters', LETTERS]]) {
    await studio.library.createAsset({ slug, source, author });
  }
  await studio.bakeSequence({ ref: 'ball', slug: 'ball-seq', params: { color: '#2dd4bf' }, width: 200, height: 200, fps: 10, duration: 2, author });
  const logo = (await studio.uploads.upload({ name: 'parity-logo.svg', author, data: Buffer.from(LOGO_SVG) })).asset;
  await studio.library.createAsset({ slug: 'svg-draw', author, source: `asset({
    description: 'An uploaded SVG drawn on: strokes trace in, then the fills fade in; recolourable.',
    tags: ['svg', 'test'],
    duration: 2,
    params: { logo: { type: 'image', default: '${logo.ref}' }, fill: { type: 'color', default: '#ffd166' } },
    render(f, p) { f.svg(p.logo).draw(f.ctx, { width: f.width, height: f.height, progress: f.progress * 1.25, fill: p.fill }); },
  });` });
  const c = createCanvas(64, 32);
  const g = c.getContext('2d');
  g.fillStyle = '#00c2a8'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#ffd166'; g.fillRect(32, 0, 32, 32);
  await studio.library.addFileAsset({ slug: 'tiles', type: 'image', data: c.toBuffer('image/png'), ext: '.png', description: 'Two coloured tiles side by side (test image).', tags: ['test'], author });
}

const W = 480, H = 270;
const comp = (tracks, extra = {}) => ({ width: W, height: H, fps: 10, duration: 2, background: '#101018', tracks: [{ id: 'bg', items: [{ id: 'bg', asset: 'backdrop', start: 0, duration: 2 }] }, ...tracks], ...extra });
const item = (id, asset, extra = {}) => ({ id, asset, start: 0, duration: 2, ...extra });

/** Thresholds: mean difference per channel (0–255), and the share of pixels (%) differing by more than 64. */
export const LIMIT = { meanDiff: 1.5, over64: 1.0 };

/** @type {Record<string, [any, number[]]>} */
export const CASES = {
  transform: [comp([{ id: 'v', items: [
    item('b', 'block', { transform: { x: 0.3, y: 0.4, width: 0.3, height: 0.4, rotation: 25, scale: 0.9 }, keyframes: { x: [{ t: 0, v: 0.2 }, { t: 2, v: 0.7, ease: 'outCubic' }], rotation: [{ t: 0, v: -20 }, { t: 2, v: 40 }], 'params.color': [{ t: 0, v: '#ff5c8a' }, { t: 2, v: '#ffd166' }] } }),
    item('l', 'label', { params: { text: 'Parity' }, transform: { space: 'safe', x: 0.5, y: 0.8, width: 0.6, height: 0.25, anchorY: 1, rotation: -6 } }),
  ] }]), [7, 15]],
  motion: [comp([{ id: 'v', items: [item('b', 'block', { transform: { width: 0.4, height: 0.4 }, motions: [{ asset: 'slide', phase: 'in', duration: 1 }, { asset: 'wiggle', phase: 'loop', params: { angle: 12 } }, { asset: 'pop', phase: 'out' }] })] }]), [4, 12, 18]],
  transition: [comp([{ id: 'v', items: [item('a', 'block', { duration: 0.6, transform: { width: 0.5, height: 0.5 } }), item('b', 'block', { start: 0.6, duration: 1.4, params: { color: '#00c2a8' }, transform: { width: 0.5, height: 0.5 }, transition: { asset: 'push', duration: 0.8 } })] },
    { id: 'w', items: [item('i', 'label', { params: { text: 'Iris' }, transform: { y: 0.2, height: 0.3 }, transition: { asset: 'iris', duration: 1.5 } })] }]), [10]],
  effect: [comp([{ id: 'v', items: [item('b', 'block', { transform: { width: 0.4, height: 0.5 }, effects: [{ asset: 'blur', params: { radius: 5 } }, { asset: 'glow', params: { radius: 16 } }] }), item('l', 'label', { params: { text: 'Duo' }, transform: { y: 0.8, height: 0.3 }, effects: [{ asset: 'duotone', params: { dark: '#1b1f3b', light: '#ffd166' } }] })], effects: [] }], { effects: [{ asset: 'grain', params: { amount: 0.1 } }] }), [5, 15]],
  mask: [comp([{ id: 'v', items: [item('b', 'block', { transform: { width: 0.8, height: 0.8 }, mask: { asset: 'circle', mode: 'alpha', params: { radius: 0.8 } } }), item('l', 'label', { params: { text: 'Masked' }, mask: { asset: 'circle', mode: 'luma-inverted', transform: { x: 0.5, y: 0.5, width: 0.3, height: 0.5 } } })] }]), [10]],
  precomp: [comp([{ id: 'v', items: [item('c', 'card', { params: { title: 'Precomp' }, transform: { x: 0.5, y: 0.5, width: 0.8, height: 0.8 } })] }]), [3, 15]],
  '3d': [comp([{ id: 'behind', items: [item('t', 'label', { params: { text: 'BEHIND THE BALL', color: '#7cf5c0' }, transform: { height: 0.5 } })] },
    { id: '3d', items: [item('b', 'ball', { transform: { x: 0.35, width: 0.6, height: 0.9 } }), item('w', 'letters', { params: { text: '3D' }, transform: { x: 0.75, width: 0.4, height: 0.6 } })] },
    { id: 'front', items: [item('f', 'label', { params: { text: 'In front', color: '#ffffff' }, transform: { y: 0.85, height: 0.25 } })] }]), [5, 15]],
  sequence: [comp([{ id: 'v', items: [item('s', 'ball-seq', { transform: { x: 0.3, width: 0.45, height: 0.8 } }), item('l', 'ball-seq', { params: { loop: true }, offset: 0.5, transform: { x: 0.75, width: 0.3, height: 0.5, rotation: 20 } })] }]), [3, 12]],
  svg: [comp([{ id: 'v', items: [item('a', 'svg-draw', { transform: { x: 0.3, width: 0.45, height: 0.8 } }), item('b', 'svg-draw', { params: { fill: '#2dd4bf' }, offset: 1, transform: { x: 0.72, width: 0.4, height: 0.7, rotation: -8 } })] }]), [6, 14]],
  image: [comp([{ id: 'v', items: [item('i', 'tiles', { transform: { width: 0.5, height: 0.5, rotation: 15 } }), item('j', 'tiles', { params: { fit: 'cover' }, transform: { x: 0.2, y: 0.25, width: 0.2, height: 0.3 } })] }]), [10]],
};

