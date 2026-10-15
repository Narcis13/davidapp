// Clip 9, "Your first clip": an onboarding video about the studio itself, built from screen recordings of the real
// studio (showcase/footage/clip-9/, made by scripts/record-studio.mjs). The result first, then four steps (find,
// tune, place, render), each a recording with the kit's cursor (from the recording's sidecar), a spotlight on the
// element it touches and a camera that zooms until the UI text can be read; then a recap and the next step.
// Words come from script.json, times from timing.mjs (the narration's words), colours from the theme.
// Built gate by gate through MCP (showcase/journal/clip-9-your-first-clip.jsonl).

import { readFileSync } from 'node:fs';
import { SCENES, VOICE, FOOTAGE, DURATION, sceneLength, wordAt, f, BEATS } from './timing.mjs';

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));
const beat = (id) => script.beats.find((b) => b.id === id);
const sidecar = (name) => JSON.parse(readFileSync(new URL(`../../showcase/footage/clip-9/${name}.mp4.json`, import.meta.url), 'utf8'));
const theme = 'theme-tide';
/** The theme's tokens, read from its source (the same file the library holds), so no colour is written here. */
const T = (() => {
  let def;
  new Function('asset', readFileSync(new URL(`../../assets/${theme}.js`, import.meta.url), 'utf8'))((d) => { def = d; });
  return def.render();
})();
/** A token with an alpha, as CSS. */
const alpha = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;

// where things go (fractions of the 1920×1080 frame): the recording on the right at 0.74 of its size, above the caption lane; the steps on the left
const SHOT = { x: 0.671, y: 0.38, width: 0.5573, height: 0.6192 };
const STEPS = { x: 0.185, y: 0.38, width: 0.24, height: 0.5 };

/** A sidecar's box of the element a selector names (its first appearance). */
const box = (side, selector) => {
  const b = side.boxes.find((x) => x.selector === selector);
  if (!b) throw new Error(`no box for ${selector}`);
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
};
const centre = (b) => ({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });

/** The camera: a kit-camera emphasis (its region in the window's shape, 1.6:1, so it never shows past the recording's edge) at recording time t (seconds into the file), held for `hold` seconds of clip. */
const camera = (scene, t, hold, region, fill = 0.85) => ({
  asset: 'kit-camera', phase: 'emphasis', at: f((t - FOOTAGE[scene].in) / FOOTAGE[scene].speed), duration: hold,
  params: { region, fill, zoomIn: 0.7, zoomOut: 0.7 },
});

const CARRIER = 0.5;

/** One step: the recording, cropped to its window, with the cursor, a spotlight and a callout over it, all on the recording's transform and camera. */
function step(scene, { regions, camera: cam, callout }) {
  const { asset, in: from, speed } = FOOTAGE[scene];
  const side = sidecar(asset.replace(/^studio-/, ''));
  const start = SCENES[scene].start, duration = sceneLength(scene);
  const motions = cam ? [cam] : [];
  // what sits on the recording moves with its camera and stays inside its window
  const window = { asset: 'mask-rect', mode: 'alpha', transform: SHOT, params: { radius: 1.2 } };
  // the marks come once the recording has wiped in
  const over = { start: f(start + CARRIER), duration: f(duration - CARRIER), transform: SHOT, motions: motions.map((m) => ({ ...m, at: f(m.at - CARRIER) })), mask: window };
  const recording = { at: f(from + CARRIER * speed), speed };
  return {
    shot: {
      id: `shot-${scene}`, asset, start, duration, transform: SHOT, motions,
      params: { fit: 'fill', in: from, speed },
      // the last recording gives way to the recap, which comes in over it (the screen never empties)
      ...(scene === 'render' ? { fadeOut: 0.5 } : {}),
      mask: window,
      // the carrier: a soft diagonal wipe inside the window, its edge line off (it would cross the steps beside it)
      transition: { asset: 'trans-wipe', duration: CARRIER, params: { angle: 14, feather: 0.12, accent: alpha(T.bg, 0) } },
    },
    spot: { id: `spot-${scene}`, asset: 'kit-spotlight', ...over, params: { ...recording, regions, dim: 0.55, padding: 10, in: 0.4, out: 0.3 } },
    cursor: { id: `cursor-${scene}`, asset: 'kit-cursor', ...over, params: { ...recording, path: side.cursor, clicks: side.clicks.map((c) => ({ t: c.t })), size: 3 } },
    // a callout holds still while it is read: it stays off the camera, and comes before the camera moves
    callout: callout && { id: `callout-${scene}`, asset: 'kit-callout', ...over, motions: [], mask: undefined, start: f(start + callout.after), duration: f(callout.hold), params: { text: beat(scene).screen.callout, point: callout.point, side: callout.side ?? 'auto', size: 3.4, theme } },
  };
}

const find = sidecar('library-search'), tune = sidecar('playground-param'), place = sidecar('editor-place'), render = sidecar('render-check');
const steps = {
  find: step('find', {
    regions: [{ t: 0.9, ...box(find, '[data-testid=search]') }, { t: 3.3, ...box(find, '[data-testid=filter-kind] [data-value=visual]') }, { t: 7.4, ...box(find, '[data-testid=asset-card]:nth-of-type(3)') }],
    camera: camera('find', 7.2, 3.2, { x: 700, y: 120, width: 640, height: 400 }, 0.95),
    callout: { after: 0.9, hold: 3.6, point: centre(box(find, '[data-testid=search]')), side: 'bottom' },
  }),
  tune: step('tune', {
    regions: [{ t: 5.0, ...box(tune, '[data-testid=param-text]') }, { t: 10.9, ...box(tune, '[data-testid=param-size-range]') }, { t: 13.3, ...box(tune, '[data-testid=param-weight-range]') }],
    camera: camera('tune', 10.0, 3.6, { x: 430, y: 110, width: 840, height: 470 }, 0.92),
    callout: { after: 1.2, hold: 3.2, point: centre(box(tune, '[data-testid=param-text]')), side: 'left' },
  }),
  place: step('place', {
    regions: [{ t: 0.9, ...box(place, '[data-testid=add-item]') }, { t: 4.2, ...box(place, '[data-testid=picker-option][data-slug=text-word-reveal]') }, { t: 5.6, ...box(place, '[data-testid=timeline]') }],
    camera: camera('place', 6.2, 3.8, { x: 190, y: 410, width: 770, height: 481 }, 1),
  }),
  render: step('render', {
    // the second row is the voiced clip, whose loudness met its target: the zoom goes there
    regions: [{ t: 1.2, ...box(render, '[data-testid=render-button]') }, { t: 2.0, ...box(render, '[data-testid=render-row]') }, { t: 8.2, x: 183, y: 192, width: 1074, height: 96 }],
    camera: camera('render', 8.4, 3.3, { x: 183, y: 170, width: 517, height: 323 }, 0.95),
    callout: { after: 1.8, hold: 2.9, point: { x: 300, y: 150 }, side: 'bottom' },
  }),
};
const ids = ['find', 'tune', 'place', 'render'];

// the steps on the left: each becomes current on its scene's cut; the extra time ticks the last one
const stepsStart = SCENES.find.start;

// the recap: the four steps tick on their words ("Find, tune, place, render."), then the end card on "Open"
const recap = BEATS.find((b) => b.id === 'next');
// the steps beside the recordings: each lights on its scene's cut (0.5 s to move on), ticked once the next one starts;
// for the recap they glide to the centre, start again, and tick on each spoken step ("Find, tune, place, render.")
const local = (t) => f(t - stepsStart);
const recapStart = SCENES.next.start;
const stepKeys = [
  { t: 0, v: 0 },
  ...ids.slice(1).flatMap((id, k) => [{ t: local(SCENES[id].start), v: k }, { t: local(SCENES[id].start + 0.5), v: k + 1, ease: 'outCubic' }]),
  { t: local(recapStart - 0.6), v: 3 }, { t: local(recapStart - 0.1), v: 4, ease: 'outCubic' },
  { t: local(recapStart + 0.2), v: 4 }, { t: local(recapStart + 0.5), v: -1, ease: 'inOutCubic' },
  ...[0, 1, 2, 3].flatMap((k) => [{ t: local(wordAt(recap.first + k) - 0.15), v: k - 1 }, { t: local(wordAt(recap.first + k) + 0.2), v: k, ease: 'outCubic' }]),
  { t: local(wordAt(recap.first + 3) + 0.5), v: 4, ease: 'outCubic' },
];
const glide = (from, to) => [{ t: local(recapStart - 0.1), v: from }, { t: local(recapStart + 0.6), v: to, ease: 'inOutCubic' }];
const open = wordAt(recap.first + 4);

const next = beat('next').screen;

export default {
  format: 'horizontal', fps: 30, duration: DURATION, background: T.bg, seed: 9,
  theme,
  loudness: { target: -14, truePeak: -1 },
  platforms: ['youtube'],
  safe: 'platform',
  captions: { burnIn: true },
  markers: [
    ...Object.entries(SCENES).map(([id, s]) => ({ t: s.start, type: 'cut', label: id })),
    { t: f(DURATION - 2.2), type: 'hold', duration: 2.2, label: 'end card holds' },
  ],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'drift', asset: 'bg-gradient-drift', start: 0, duration: f(open + 0.9), fadeOut: 1.2, params: { base: T.bg, colors: [T.bgAlt, T.surface, T.bgAlt], intensity: 0.32, speed: 0.12, beatPulse: 0, vignette: 0.5 }, effects: [{ asset: 'fx-grain', params: { amount: 0.03 } }] },
    ] },
    { id: 'shots', name: 'Recordings', type: 'visual', items: [
      // the result first: a finished clip playing in the studio's gallery, the camera moving in on the player
      { id: 'shot-result', asset: FOOTAGE.result.asset, start: 0, duration: sceneLength('result'), transform: SHOT,
        params: { fit: 'fill', in: FOOTAGE.result.in, speed: FOOTAGE.result.speed },
        mask: { asset: 'mask-rect', mode: 'alpha', transform: SHOT, params: { radius: 1.2 } },
        motions: [camera('result', 2.2, sceneLength('result'), box(sidecar('render-check'), '[data-testid=player]'), 0.94)] },
      ...ids.map((id) => steps[id].shot),
    ] },
    { id: 'spots', name: 'Spotlights', type: 'visual', items: ids.map((id) => steps[id].spot) },
    { id: 'callouts', name: 'Callouts', type: 'text', items: ids.map((id) => steps[id].callout).filter(Boolean) },
    { id: 'cursor', name: 'Cursor', type: 'visual', items: ids.map((id) => steps[id].cursor) },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'title', asset: 'title-plate', start: 0, duration: f(SCENES.find.start - 0.4), transform: { x: 0.185, y: 0.38, width: 0.25, height: 0.34 },
        params: { text: beat('result').screen.title, eyebrow: beat('result').screen.eyebrow, theme, size: 5.2, inDur: 0 } },
      { id: 'steps', asset: 'kit-steps', start: stepsStart, duration: f(open - stepsStart - 0.1), transform: STEPS,
        params: { steps: ids.map((id) => beat(id).screen.step), direction: 'column', theme, size: 3.6, current: 0 },
        keyframes: { 'params.current': stepKeys, x: glide(STEPS.x, 0.5), y: glide(STEPS.y, 0.4), scale: glide(1, 1.15) } },
      { id: 'end', asset: 'end-card', start: f(open - 0.3), duration: f(DURATION - open + 0.3), transform: { x: 0.5, y: 0.42, width: 0.6, height: 0.56 },
        params: { title: next.title, line: next.line, cta: next.cta, url: next.url, logo: 'fablecut-mark', theme, size: 6.4, plate: true } },
    ] },
    { id: 'caps', name: 'Captions', type: 'text', role: 'captions', items: [
      { id: 'cap', asset: 'text-captions', start: 0, duration: DURATION, params: { pill: alpha(T.bg, 0.94), active: T.accent, size: 4.2, floor: 3 } },
    ] },
    { id: 'voice', name: 'Narration', type: 'audio', role: 'narration', items: VOICE.map((v) => ({ id: v.id, asset: 'clip-9-voice', start: v.start, offset: v.offset, duration: v.duration })) },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      id: 'bed', asset: 'music-loop', start: 0, duration: DURATION, gain: 0.35, fadeOut: 1,
      beats: true,
      duck: { by: 18, attack: 0.15, release: 0.45, hold: 0.25, source: 'words' },
    }] },
  ],
};
