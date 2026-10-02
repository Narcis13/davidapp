// Shared test fixtures: a studio on a throwaway data directory, and a few small assets.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';

export function tempStudio(opts = {}) {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-test-'));
  const studio = createStudio({ dataDir, role: 'test', ...opts });
  return {
    studio,
    dataDir,
    async cleanup() {
      await studio.close();
      try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
    },
  };
}

export const AUTHOR = 'test-suite';

export const EASING = `asset({
  kind: 'value',
  description: 'Easing curves by name; returns an object of functions of x in 0..1.',
  tags: ['easing', 'motion'],
  render() {
    return { linear: (x) => x, outCubic: (x) => 1 - (1 - x) ** 3, inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) };
  },
});`;

export const DOT = `asset({
  description: 'A dot that slides from left to right across the frame.',
  tags: ['shape', 'test'],
  duration: 2,
  uses: ['easing'],
  params: {
    color: { type: 'color', default: '#ff3366' },
    radius: { type: 'number', default: 20, min: 1, max: 200 },
    curve: { type: 'enum', options: ['linear', 'outCubic', 'inOutQuad'], default: 'outCubic' },
  },
  render(f, p) {
    const k = f.use('easing')[p.curve](f.progress);
    f.ctx.fillStyle = p.color;
    f.ctx.beginPath();
    f.ctx.arc(p.radius + k * (f.width - 2 * p.radius), f.height / 2, p.radius, 0, Math.PI * 2);
    f.ctx.fill();
  },
});`;

export const LABEL = `asset({
  description: 'A line of text that fades in, auto-fitted to the safe zone.',
  tags: ['text', 'test'],
  duration: 2,
  params: {
    text: { type: 'string', default: 'Hello' },
    color: { type: 'color', default: '#ffffff' },
    font: { type: 'font', default: 'Inter' },
  },
  render(f, p) {
    const L = f.lib.text.layout(f.ctx, p.text, { font: p.font, weight: 800, size: f.height * 0.3, maxWidth: f.safe.width, fit: true, align: 'center' });
    f.ctx.globalAlpha = f.lib.clamp01(f.t / 0.5);
    f.ctx.fillStyle = p.color;
    f.lib.text.fill(f.ctx, L, f.safe.x, (f.height - L.height) / 2);
  },
});`;

// scene → badge → label: three levels, and the scene composes two different assets
export const BADGE = `asset({
  description: 'A rounded badge with a label inside it.',
  tags: ['badge', 'test'],
  duration: 2,
  uses: ['label'],
  params: { text: { type: 'string', default: 'Badge' }, fill: { type: 'color', default: '#2244ff' } },
  render(f, p) {
    f.ctx.fillStyle = p.fill;
    f.ctx.beginPath();
    f.ctx.roundRect(0, 0, f.width, f.height, f.height / 4);
    f.ctx.fill();
    f.use('label', { text: p.text });
  },
});`;

export const SCENE = `asset({
  description: 'A test scene: a sliding dot under a badge with a label.',
  tags: ['scene', 'test'],
  duration: 2,
  uses: ['dot', 'badge'],
  params: { title: { type: 'string', default: 'Scene' }, seedJitter: { type: 'boolean', default: false } },
  render(f, p) {
    f.use('dot', { color: '#ffd166' });
    const jitter = p.seedJitter ? f.rng.range(-10, 10) : 0;
    f.use('badge', { text: p.title }, { x: f.width * 0.25 + jitter, y: f.height * 0.1, width: f.width * 0.5, height: f.height * 0.3 });
  },
});`;

export const TONE = `asset({
  kind: 'audio',
  description: 'A steady kick drum pattern at a given tempo, for tests.',
  tags: ['audio', 'drums', 'test'],
  params: { bpm: { type: 'number', default: 120, min: 40, max: 240 } },
  render(f, p) {
    const A = f.lib.audio;
    const out = A.buffer(f.duration);
    const step = 60 / p.bpm;
    for (let t = 0; t < f.duration; t += step) {
      A.mix(out, A.tone({ freq: (x) => 50 + 110 * Math.exp(-x * 30), dur: 0.3, decay: 0.09, gain: 0.9 }), t);
    }
    return out;
  },
});`;

/** Create the fixture assets in dependency order. */
export async function seedAssets(studio, forClip) {
  for (const [slug, source] of [['easing', EASING], ['dot', DOT], ['label', LABEL], ['badge', BADGE], ['scene', SCENE], ['kick', TONE]]) {
    await studio.library.createAsset({ slug, source, author: AUTHOR, forClip });
  }
}

export const smallComposition = (extra = {}) => ({
  width: 320, height: 180, fps: 10, duration: 2, background: '#101018',
  tracks: [
    { id: 'main', type: 'visual', items: [{ id: 'scene', asset: 'scene', start: 0, duration: 2, params: { title: 'Hi' } }] },
    { id: 'titles', type: 'text', items: [{ id: 'label', asset: 'label', start: 0.5, duration: 1.5, params: { text: 'Over', color: '#00ffaa' }, fadeOut: 0.3, box: { x: 0, y: 0.6, width: 1, height: 0.4 } }] },
    { id: 'music', type: 'audio', items: [{ id: 'kick', asset: 'kick', start: 0, duration: 2, gain: 0.8, fadeOut: 0.2 }] },
  ],
  ...extra,
});
