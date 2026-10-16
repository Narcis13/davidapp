// <slug>: <one line on what the video is, for whom, and its takeaway>.
// Words come from script.json, times from timing.mjs, colours from the theme: this file writes none of its own.
// Push it with `node .claude/skills/new-video/scripts/push-clip.mjs <slug>`.

import { readFileSync } from 'node:fs';
import { SCENES, DURATION, FPS, f, sceneEnd, HOLD, OVERLAP } from './timing.mjs';

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));
const beat = (id) => script.beats.find((b) => b.id === id);

export const title = script.title;
const theme = script.theme;                 // 'theme-tide', or the clip's own theme-<slug>
/** The theme's tokens, read from its source (the same file the library holds), so no colour is written here. */
const T = (() => {
  let def;
  new Function('asset', readFileSync(new URL(`../../assets/${theme}.js`, import.meta.url), 'utf8'))((d) => { def = d; });
  return def.render();
})();

/** A box in the primary shape and its place in the others (fractions of each frame). */
const place = (primary, others = {}) => ({ transform: primary, ...(Object.keys(others).length ? { formats: Object.fromEntries(Object.entries(others).map(([k, v]) => [k, { transform: v }])) } : {}) });
/** A slow drift on held scene items, so a held headline is never a frozen frame. */
const drift = { motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.004, tilt: 0.3, period: 5 } }] };
/** From a scene's start to its end (the next scene's start plus the overlap). */
const span = (id, start = SCENES[id].start) => ({ start: f(start), duration: f(sceneEnd(id) - start) });

const hook = beat('hook'), body = beat('body'), cta = beat('cta');

export default {
  format: script.format, fps: FPS, duration: DURATION, background: T.bg, seed: 7,
  theme,
  loudness: { target: -14, truePeak: -1 },
  platforms: script.platforms,              // ['youtube'], ['shorts', 'reels'], ['feed'] … (empty: the format's own safe zone)
  safe: script.platforms?.length ? 'platform' : 'format',
  markers: [
    { t: 0, type: 'hold', duration: 0.6, label: 'the hook is read' },
    ...Object.entries(SCENES).slice(1).map(([id, s]) => ({ t: s.start, type: 'cut', label: id })),
    { t: f(DURATION - HOLD), type: 'hold', duration: HOLD, label: 'end card holds' },
  ],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual',
      effects: [{ asset: 'fx-grain', params: { amount: 0.05 } }],
      items: [
        // the drift fades under the close (the last frame must hold still for 2 s; the flat background colour stays)
        { id: 'bg', asset: 'bg-gradient-drift', start: 0, duration: f(SCENES.cta.start + 0.8), fadeOut: 0.8, params: { base: T.bg, colors: [T.bgAlt, T.surface, T.accent], intensity: 0.35, speed: 0.25, beatPulse: 0.08, vignette: 0.45 } },
      ] },
    // consecutive scenes on ONE track, so each transition has the scene before it to take
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      { id: 'hook', asset: 'title-plate', ...span('hook'), ...place({ space: 'safe', x: 0.5, y: 0.5, width: 0.86, height: 0.4 }, { vertical: { space: 'safe', x: 0.5, y: 0.4, width: 1, height: 0.3 } }),
        params: { text: hook.screen.title, eyebrow: hook.screen.eyebrow ?? '', theme, size: 7.5, align: 'center', inDur: 0.45, outDur: 0.3 }, ...drift },
      { id: 'body', asset: 'kit-plate', ...span('body'), ...place({ space: 'safe', x: 0.5, y: 0.5, width: 0.9, height: 0.7 }),
        transition: { asset: 'trans-push', duration: 0.6 },
        params: { eyebrow: body.screen.eyebrow ?? '', title: body.screen.title, theme, size: 5, align: 'left', inDur: 0.5, outDur: 0.35 }, ...drift },
      // the close: an end card when there is a logo (uploaded as given: upload_image, then its asset name here); the name in plain
      // type on a plate when there is none (never an invented logo)
      cta.screen.logo
        ? { id: 'end', asset: 'end-card', start: f(SCENES.cta.start), duration: f(DURATION - SCENES.cta.start), ...place({ space: 'safe', x: 0.5, y: 0.5, width: 0.9, height: 0.7 }),
            transition: { asset: 'trans-wipe', duration: 0.6 },
            params: { logo: cta.screen.logo, logoMode: 'auto', title: cta.screen.title, line: cta.screen.line ?? '', cta: cta.screen.cta ?? '', url: cta.screen.url ?? '', theme, clipTheme: true, plate: true, size: 7 } }
        : { id: 'end', asset: 'title-plate', start: f(SCENES.cta.start), duration: f(DURATION - SCENES.cta.start), ...place({ space: 'safe', x: 0.5, y: 0.5, width: 0.86, height: 0.5 }),
            transition: { asset: 'trans-wipe', duration: 0.6 },
            params: { text: [cta.screen.title, cta.screen.cta, cta.screen.url].filter(Boolean).join('\n'), eyebrow: cta.screen.line ?? '', theme, size: 6.5, align: 'center', inDur: 0.5, outDur: 0 } },
    ] },
    // graphics that land on the body beat: icons, charts, a stat row … each starts a little after the scene, staggered
    { id: 'graphics', name: 'Graphics', type: 'visual', items: (body.screen.icons ?? []).map((name, k) => ({
      id: `icon-${name}`, asset: 'kit-icon', start: f(SCENES.body.start + 0.5 + k * 0.1), duration: f(sceneEnd('body') - SCENES.body.start - 0.5 - k * 0.1),
      ...place({ space: 'safe', x: 0.25 + k * 0.25, y: 0.62, width: 0.12, height: 0.12 }),
      params: { name, weight: 2, draw: 0.6, pop: 0.35, outDur: 0.3, theme }, ...drift })) },
    { id: 'sfx', name: 'SFX', type: 'audio', role: 'sfx', items: [
      { id: 'whoosh-body', asset: 'sfx-whoosh', start: f(SCENES.body.start - 0.1), duration: 0.6, gain: 0.35 },
    ] },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      id: 'bed', asset: 'music-loop', start: 0, duration: DURATION, gain: 0.5, fadeOut: 1, beats: true,
      params: { bpm: script.bpm, scale: 'minor', build: true, outroBars: 1 },
    }] },
  ],
};
