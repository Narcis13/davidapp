// Development data for the iteration-2 studio screens: on top of a data dir (empty, or built with
// `serve.sh seed`), add assets of every new kind, 3D, a baked sequence, uploads (one described,
// two waiting), a preset, a precomp, a v2 clip (transforms, keyframes, formats, motions, effects,
// a transition, a mask, 3D between text) and requests in several states. Test fixtures only.
//
//   STUDIO_DATA=<dir> node scripts/dev-seed-v2.mjs

import { createStudio } from '../src/studio/studio.js';
import { createCanvas } from '../src/render/host.js';
import { EASING, LABEL } from '../test/helpers.js';
import * as K from '../test/fixtures/kinds.js';
import { BALL, HILLS, LETTERS } from '../test/fixtures/solid.js';
import { BLOCK, BACKDROP } from './lib/parity-cases.mjs';

const studio = createStudio({ role: 'seed' });
const A = 'dev-seed';
const have = (slug) => !!studio.library.versionRow(slug);
const make = async (slug, source) => { if (!have(slug)) await studio.library.createAsset({ slug, source, author: A, forClip: 'v2-demo' }); };

if (!studio.db.prepare("SELECT 1 FROM clips WHERE slug = 'v2-demo'").get()) await studio.clips.createClip({ slug: 'v2-demo', title: 'Iteration 2 demo', author: A, format: 'horizontal', fps: 30, duration: 8 });
if (!have('easing')) await studio.library.createAsset({ slug: 'easing', source: EASING, author: A });
for (const [slug, src] of [['label', LABEL], ['block', BLOCK], ['backdrop', BACKDROP], ['pop', K.MOTION_POP], ['slide', K.MOTION_SLIDE], ['wiggle', K.MOTION_WIGGLE], ['bounce', K.MOTION_BOUNCE],
  ['wipe', K.TRANSITION_WIPE], ['push', K.TRANSITION_PUSH], ['iris', K.TRANSITION_IRIS], ['glow', K.EFFECT_GLOW], ['grain', K.EFFECT_GRAIN], ['duotone', K.EFFECT_DUOTONE], ['blur', K.EFFECT_BLUR], ['circle', K.MASK_CIRCLE],
  ['ball', BALL], ['hills', HILLS], ['letters', LETTERS]]) await make(slug, src);
if (!have('ball-spin')) await studio.bakeSequence({ ref: 'ball', slug: 'ball-spin', params: { color: '#2dd4bf' }, width: 360, height: 360, fps: 30, duration: 2, author: A, forClip: 'v2-demo' });
if (!have('label-shout')) await studio.library.createPreset({ base: 'label', slug: 'label-shout', params: { text: 'SHOUT', color: '#ffd166' }, author: A });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><path d="M20 100 C40 20, 120 20, 140 100" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/><rect x="50" y="60" width="60" height="40" rx="10" fill="#7b5cff" stroke="#16121f" stroke-width="4"/><circle cx="80" cy="40" r="14" fill="#ff5c8a"/><script>alert(1)</script></svg>`;
const pic = (a, b) => { const c = createCanvas(640, 360); const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 640, 360); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 640, 360); g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(470, 120, 60, 0, Math.PI * 2); g.fill(); return c.toBuffer('image/png'); };
const up1 = await studio.uploads.upload({ name: 'dev-logo.svg', data: Buffer.from(svg), author: 'studio-user' });
const up2 = await studio.uploads.upload({ name: 'dusk-skyline.png', data: pic('#1b1f3b', '#ff5c8a'), author: 'studio-user' });
await studio.uploads.upload({ name: 'teal-morning.png', data: pic('#06241f', '#2dd4bf'), author: 'studio-user' });
if (up2.asset.needsDescription) studio.uploads.describe({ slug: up2.asset.slug, title: 'Dusk skyline', description: 'A soft gradient sky from navy to pink with a pale sun: a calm background.', tags: ['sky', 'dusk', 'background'], uses: ['full-frame background', 'slow Ken Burns'], author: 'claude-code' });
const item = (id, asset, extra = {}) => ({ id, asset, start: 0, duration: 8, ...extra });
await studio.clips.updateClip('v2-demo', { composition: {
  format: 'horizontal', fps: 30, duration: 8, background: '#101018', tracks: [
    { id: 'bg', name: 'Background', items: [item('sky', up2.asset.slug, { params: { fit: 'cover' }, effects: [{ asset: 'grain', params: { amount: 0.06 } }] })] },
    { id: 'behind', name: 'Text behind', type: 'text', items: [item('behind', 'label', { params: { text: 'BEHIND THE BALL', color: '#7cf5c0' }, transform: { height: 0.5 } })] },
    { id: '3d', name: '3D', items: [item('ball', 'ball', { duration: 4, transform: { x: 0.5, width: 0.5, height: 0.9 }, motions: [{ asset: 'pop', phase: 'in' }] }), item('spin', 'ball-spin', { start: 4, duration: 4, params: { loop: true }, transform: { x: 0.5, width: 0.45, height: 0.8 }, transition: { asset: 'iris', duration: 0.8 } })] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      item('title', 'label', { start: 0.5, duration: 3, params: { text: 'Free layout', color: '#ffffff' }, transform: { space: 'safe', x: 0.5, y: 0.15, width: 0.8, height: 0.25 }, keyframes: { rotation: [{ t: 0, v: -6 }, { t: 3, v: 0, ease: 'outCubic' }] }, motions: [{ asset: 'slide', phase: 'in', params: { from: 'up', distance: 0.3 } }], formats: { vertical: { transform: { y: 0.1, width: 1 } } } }),
      item('logo', up1.asset.slug, { start: 4, duration: 4, transform: { x: 0.85, y: 0.82, width: 0.2, height: 0.25 }, mask: { asset: 'circle', mode: 'alpha', params: { radius: 0.9 } }, motions: [{ asset: 'wiggle', phase: 'loop', params: { angle: 6 } }] }),
    ] },
    { id: 'front', name: 'Text in front', type: 'text', effects: [{ asset: 'glow', params: { radius: 14 } }], items: [item('front', 'label-shout', { start: 1, duration: 6, params: { text: 'In front' }, transform: { y: 0.88, height: 0.2 } })] },
  ],
} });
if (!have('v2-title-card')) await studio.clips.savePrecomp({ clip: 'v2-demo', items: ['title'], slug: 'v2-title-card', expose: [{ item: 'title', param: 'text', name: 'headline' }], author: A });
// requests in a few states
const R = studio.requests;
if (!R.list({}).length) {
  const r1 = R.create({ asset: 'block', params: { color: '#ff5c8a' }, message: 'Give the block a soft drop shadow and round the corners a little more.', author: 'studio-user' });
  R.claim({ id: r1.id, agent: 'claude-code' });
  await R.propose({ id: r1.id, agent: 'claude-code', kind: 'asset-version', source: BLOCK.replace("f.ctx.lineWidth = 4;", "f.ctx.lineWidth = 6;").replace('0.12)', '0.2)'), note: 'Rounder corners, heavier border.', summary: 'Rounder corners and a heavier border; the shadow is next if you like this.' });
  R.create({ clip: 'v2-demo', items: ['title'], at: 3, message: 'add a lower third at 0:03', author: 'studio-user' });
  R.create({ scope: 'library', message: 'Is there a confetti or sparkle asset I could reuse?', author: 'studio-user' });
}
for (const s of ['ball', 'glow', 'label-shout']) studio.library.setFavorite(s, true);
studio.library.setFeatured('v2-title-card', true);
studio.library.addToCollection('Iteration 2', ['pop', 'slide', 'wipe', 'iris', 'glow', 'ball', 'ball-spin']);
console.log(`dev seed v2: ${studio.library.search({ limit: 1 }).total} assets, clips: ${studio.clips.listClips().map((c) => c.slug).join(', ')}, requests: ${R.list({}).length}`);
await studio.close();
