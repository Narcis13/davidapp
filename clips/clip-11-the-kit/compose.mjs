// Clip 11, "The kit": a short tour of the kit pieces clips 9 and 10 did not show, so every kit asset appears in the
// showcase. kit-ui-frame@2 scales in at its text floor (the entrance v1 could not draw), kit-arrow points at it, and a
// kit-plate holds kit-chart-donut (clip 10's items, reused or new, from compounding_report) beside kit-steps.
// Music only, no voice. Built through MCP (showcase/journal/clip-11-the-kit.jsonl).

import { readFileSync } from 'node:fs';

const theme = 'theme-tide';
/** The theme's tokens, read from its source (the same file the library holds), so no colour is written here. */
const T = (() => {
  let def;
  new Function('asset', readFileSync(new URL(`../../assets/${theme}.js`, import.meta.url), 'utf8'))((d) => { def = d; });
  return def.render();
})();

const FPS = 30;
const f = (s) => Math.round(s * FPS) / FPS;
/** The two scenes and the overlap between them; the last holds still for HOLD. */
const FRAME = { start: 0, end: 8.4 };
const DATA = { start: 8.0 };
const HOLD = 2.4;
const STEPS = ['Find', 'Tune', 'Place', 'Render'];
/** The steps tick after the ring has swept (delay + sweep of the donut), one every STEP seconds. */
const STEP = 0.7;
const stepsAt = STEPS.map((_, k) => f(DATA.start + 2.4 + k * STEP)).concat(f(DATA.start + 2.4 + STEPS.length * STEP));
const DURATION = f(stepsAt[stepsAt.length - 1] + 0.5 + HOLD);
const drift = { motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.004, tilt: 0.3, period: 5 } }] };
/** Clip 10 in compounding_report: 22 items, 17 of them assets an earlier clip made. */
const CLIP10 = { items: 22, reused: 17 };

export default {
  format: 'horizontal', fps: FPS, duration: DURATION, background: T.bg, seed: 11,
  theme,
  loudness: { target: -14, truePeak: -1 },
  markers: [
    { t: DATA.start, type: 'cut', label: 'data' },
    { t: f(DURATION - HOLD), type: 'hold', duration: HOLD, label: 'the last frame holds' },
  ],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'drift', asset: 'bg-gradient-drift', start: 0, duration: DURATION, params: { base: T.bg, colors: [T.bgAlt, T.surface, T.bgAlt], intensity: 0.4, speed: 0.3, beatPulse: 0, vignette: 0.5 } },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      // the browser scales in with its chrome text at the floor (size 2.6): v2 keeps the text there while it scales
      { id: 'browser', asset: 'kit-ui-frame@2', start: 0.3, duration: f(FRAME.end - 0.3), transform: { x: 0.45, y: 0.565, width: 0.8, height: 0.75 },
        params: { device: 'browser', content: 'studio-library-search', url: '127.0.0.1:8787', title: 'Library', theme, size: 2.6, inDur: 0.6 }, ...drift },
      { id: 'plate', asset: 'kit-plate', start: DATA.start, duration: f(DURATION - DATA.start), transform: { x: 0.5, y: 0.53, width: 0.86, height: 0.78 },
        params: { eyebrow: 'Clip 10', title: 'Most of it *reused*', theme, size: 4.4, inDur: 0.45, outDur: 0 }, ...drift },
    ] },
    { id: 'graphics', name: 'Graphics', type: 'visual', items: [
      // the arrow's points are frame pixels (space 1920 x 1080 over the whole frame)
      { id: 'arrow', asset: 'kit-arrow', start: 1.4, duration: f(FRAME.end - 1.4), transform: { x: 0.5, y: 0.5, width: 1, height: 1 },
        params: { from: { x: 1690, y: 930 }, to: { x: 1220, y: 650 }, space: { width: 1920, height: 1080 }, label: 'The real studio', theme, curve: 0.3, size: 3, draw: 0.8 } },
      { id: 'donut', asset: 'kit-chart-donut', start: f(DATA.start + 0.3), duration: f(DURATION - DATA.start - 0.3), transform: { x: 0.33, y: 0.6, width: 0.4, height: 0.52 },
        params: { segments: [{ label: 'Reused', value: CLIP10.reused }, { label: 'New', value: CLIP10.items - CLIP10.reused }], center: 'first', caption: 'of its items', legend: 'bottom', theme, delay: 0.3, sweep: 1.5, outDur: 0 } },
      { id: 'steps', asset: 'kit-steps', start: f(DATA.start + 0.5), duration: f(DURATION - DATA.start - 0.5), transform: { x: 0.72, y: 0.6, width: 0.28, height: 0.52 },
        params: { steps: STEPS, at: stepsAt.map((x) => f(x - DATA.start - 0.5)), direction: 'column', theme, size: 3.4, outDur: 0 } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'title', asset: 'title-plate', start: 0, duration: f(FRAME.end), transform: { x: 0.5, y: 0.11, width: 0.8, height: 0.11 },
        params: { text: 'The kit: frame a *recording*', theme, size: 5, align: 'center', inDur: 0, outDur: 0.3 }, ...drift },
    ] },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      id: 'bed', asset: 'music-loop', start: 0, duration: DURATION, gain: 0.8, fadeOut: 1.2, params: { bpm: 112, scale: 'major' }, beats: true,
    }] },
  ],
};
