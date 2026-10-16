// fablecut-doodle-tour: a 90 s hand-drawn tour of Fablecut's most ambitious features, for people who make videos or
// build with code; the takeaway: every frame is code, and every clip makes the next one easier.
// Words come from script.json, times from timing.mjs, colours from the theme: this file writes none of its own.
// Push it with `node .claude/skills/new-video/scripts/push-clip.mjs fablecut-doodle-tour`.
//
// Tracks, bottom to top: the paper; the art of each beat (one item per beat, so each scribble cut has the scene before
// it to take); extras that belong to one beat and leave on their own (undraw or fade); the hand-lettered title of each
// beat (one per beat, the same scribble); then the sound.

import { readFileSync, readdirSync } from 'node:fs';
import { SCENES, DURATION, FPS, f, sceneEnd, HOLD, TRANS, BAR } from './timing.mjs';

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));
const beat = (id) => script.beats.find((b) => b.id === id);
const S = (id) => beat(id).screen;

export const title = script.title;
const theme = script.theme;
/** The theme's tokens, read from its newest source in assets/ (the file the library holds), so no colour is written here. */
const T = (() => {
  let def;
  const dir = new URL('../../assets/', import.meta.url);
  const newest = readdirSync(dir).filter((n) => n === `${theme}.js` || (n.startsWith(`${theme}.v`) && n.endsWith('.js')))
    .sort((a, b) => Number(/.v(d+).js$/.exec(a)?.[1] ?? 1) - Number(/.v(d+).js$/.exec(b)?.[1] ?? 1)).pop();
  new Function('asset', readFileSync(new URL(newest, dir), 'utf8'))((d) => { def = d; });
  return def.render();
})();

const ids = Object.keys(SCENES);
const start = (id) => SCENES[id].start;
/** From a scene's start to its end (the next scene's start plus the overlap the scribble needs). */
const span = (id) => ({ start: f(start(id)), duration: f(sceneEnd(id) - start(id)) });
/** An item that belongs to one beat and leaves by itself, a little after the scribble has crossed it. */
const extra = (id, from = 0, tail = 0.35) => {
  const next = ids[ids.indexOf(id) + 1];
  const end = next ? start(next) + tail : DURATION;
  return { start: f(start(id) + from), duration: f(end - start(id) - from) };
};
/** The cut: a marker scribble that paints the next beat in. The title track (the top one) draws the band and the rim, so
 *  they pass over the old title too; the same stroke on the art track only swaps the art. The presets this clip made
 *  (trans-scribble-band here, text-handwrite-doodle-title for the titles) hold these params as their defaults. */
const scribbleTitle = { asset: 'trans-scribble-band', duration: TRANS, params: { rows: 4, angle: -9, rim: 2.2, body: 0.6, tail: 0.24 } };
const scribble = { ...scribbleTitle, params: { ...scribbleTitle.params, rim: 0, body: 0 } };

// the grid, in fractions of the format's safe zone (96, 54, 1728 × 972), kept inside YouTube's zone (y 108 to 972)
const TITLE_BOX = { space: 'safe', x: 0.5, y: 0.135, width: 0.985, height: 0.15 };
const ART_BOX = { space: 'safe', x: 0.5, y: 0.585, width: 1, height: 0.71 };
const box = (o) => ({ ...ART_BOX, ...o });

/** A hand-lettered beat title, left aligned on the title line. */
const titleItem = (id, o = {}) => ({
  id: `title-${id}`, asset: 'text-handwrite-doodle-title', ...span(id), transform: TITLE_BOX,
  ...(id === 'hook' ? {} : { transition: scribbleTitle }),
  // the title starts writing once the scribble has crossed the title line
  params: { text: S(id).title, theme, font: T.fonts.headline, weight: 700, size: 92, floor: 7, align: 'left', valign: 'middle', delay: id === 'hook' ? 0 : 0.4, writeDur: 1.1, underline: 'none', jitter: 0.8, ...o },
});

const hook = S('hook'), fn = S('function'), lib = S('library'), reuse = S('reuse'), agent = S('agent'), shapes = S('shapes');
const solid = S('solid'), checks = S('checks'), sound = S('sound'), cta = S('cta');
/** The hook's doodles: shape, centre (safe-zone fractions), width, idle. */
const HOOK_DOODLES = [['star', 0.87, 0.27, 0.11, 'beat'], ['notes', 0.88, 0.7, 0.11, 'bob'], ['lightbulb', 0.14, 0.2, 0.09, 'sway'], ['rocket', 0.22, 0.84, 0.09, 'bob'], ['heart', 0.73, 0.88, 0.07, 'beat']];
/** The close's two stars: drawn from the cut (after a delay), still for the last seconds. */
const END_STARS = [[0.1, 0.2, 0.12], [0.9, 0.78, 0.1]];
const endStar = (i, more = {}) => {
  const [x, y, w] = END_STARS[i], s0 = f(start('cta')), late = 0.6 + i * 0.25;
  return {
    id: `end-star-${i}`, asset: 'sketch-doodle', start: s0, duration: f(DURATION - s0), transform: { space: 'safe', x, y, width: w, height: w * 1.8 },
    keyframes: { 'params.boil': [{ t: 0, v: 8, ease: 'hold' }, { t: f(DURATION - s0 - HOLD), v: 0 }] },
    params: { shape: 'star', theme, delay: late, drawDur: 0.8, idle: 'none', pencil: false, weight: 1.4 }, ...more };
};
const tickAt = (i) => 1.6 + i * 0.75;   // checklist ticks, seconds into the beat

export default {
  format: script.format, fps: FPS, duration: DURATION, background: T.bg, seed: 1716,
  theme,
  loudness: { target: -14, truePeak: -1 },
  platforms: script.platforms,
  safe: 'platform',
  checks: { minTextSize: 4, contrast: 4.5 },
  markers: [
    { t: 0, type: 'note', label: 'the hook writes itself' },
    ...ids.slice(1).map((id) => ({ t: start(id), type: 'cut', label: id })),
    // the push-in eases out, so its last few frames already read as still: the hold starts 0.2 s before it ends
    { t: f(DURATION - HOLD - 0.2), type: 'hold', duration: f(HOLD + 0.2), label: 'end card holds' },
  ],
  tracks: [
    { id: 'paper', name: 'Paper', type: 'visual', items: [
      { id: 'paper', asset: 'bg-paper', start: 0, duration: DURATION, params: { theme, pattern: 'dots', margin: false, rings: false, stain: false, grainBoil: 0, vignette: 0.22 } },
    ] },
    { id: 'art', name: 'Art', type: 'visual', items: [
      // hook: the clapperboard draws itself to the left of the title
      { id: 'art-hook', asset: 'sketch-doodle', ...span('hook'), transform: { space: 'safe', x: 0.11, y: 0.55, width: 0.18, height: 0.36 },
        params: { shape: 'clapper', theme, delay: 0.5, drawDur: 1.6, idle: 'sway', weight: 1.6 } },
      { id: 'art-function', asset: 'sketch-code', ...span('function'), transform: box({ x: 0.27, width: 0.53, height: 0.56 }), transition: scribble,
        params: { lines: fn.code, file: fn.file, theme, size: 4.4, floor: 4, delay: 0.35, cps: 30, highlight: fn.highlight, highlightAt: 4.2, outDur: 0 } },
      { id: 'art-library', asset: 'sketch-notes', ...span('library'), transform: box({ width: 0.84 }), transition: scribble,
        params: { notes: lib.notes, cols: 3, theme, size: 5.6, floor: 4, delay: 0.5, stagger: 0.24, tilt: 4, outDur: 0 } },
      { id: 'art-reuse', asset: 'sketch-bars', ...span('reuse'), transform: box({ width: 0.72 }), transition: scribble,
        params: { bars: reuse.bars, caption: reuse.caption, focus: 2, theme, size: 5, floor: 4, delay: 0.4, stagger: 0.45, growDur: 1, outDur: 0 } },
      { id: 'art-agent', asset: 'sketch-chat', ...span('agent'), transform: box({ width: 0.8 }), transition: scribble,
        params: { messages: agent.messages, theme, font: T.fonts.body, size: 66, delay: 0.6, cps: 24, wps: 4, think: 1.0, gap: 0.5 } },
      { id: 'art-shapes', asset: 'sketch-formats', ...span('shapes'), transform: box({ width: 0.9 }), transition: scribble,
        params: { labels: shapes.labels, theme, size: 5, floor: 4, delay: 0.45, stagger: 0.3, bounce: 0.5, outDur: 0 } },
      // the baked word fills the art box (cover: its transparent margins are what is cropped)
      { id: 'art-solid', asset: 'doodle-3d-word', ...span('solid'), transform: ART_BOX, transition: scribble,
        params: { fit: 'cover' } },
      { id: 'art-checks', asset: 'sketch-checklist', ...span('checks'), transform: box({ width: 0.56 }), transition: scribble,
        params: { items: checks.items, ticks: checks.items.map((_, i) => tickAt(i)), theme, size: 5.2, floor: 4, delay: 0.45, stagger: 0.12, outDur: 0 } },
      { id: 'art-sound', asset: 'sketch-doodle', ...span('sound'), transform: box({ x: 0.34, y: 0.6, width: 0.36, height: 0.62 }), transition: scribble,
        params: { shape: 'speaker', theme, delay: 0.45, drawDur: 1.2, idle: 'beat', beatScale: 0.08, weight: 1.5 } },
      // the close: a star takes the speaker's place (it stops boiling before the last two seconds)
      endStar(0, { transition: scribble }),
    ] },
    { id: 'extras', name: 'Extras', type: 'visual', items: [
      // hook: the logo as given, at once (the first frame is never empty), a star and the notes doodle
      { id: 'hook-logo', asset: cta.logo, ...extra('hook', 0, 0.2), transform: { space: 'safe', x: 0.5, y: 0.13, width: 0.34, height: 0.12 }, fadeOut: 0.3,
        params: { fit: 'contain' } },
      // a burst of doodles drawn around the title, one on each beat, then bobbing, swaying or pulsing with the music
      ...HOOK_DOODLES.map(([shape, x, y, w, idle], i) => ({
        id: `hook-${shape}`, asset: 'sketch-doodle', ...extra('hook', 1 + i * 0.5), transform: { space: 'safe', x, y, width: w, height: w * 1.78 },
        params: { shape, theme, drawDur: 0.8, idle, beatScale: 0.09, exit: 'undraw', outDur: 0.35, pencil: false, weight: 1.5 } })),
      // function: the frames that code draws, beside it
      { id: 'fn-film', asset: 'sketch-filmstrip', ...extra('function', 1.4), transform: box({ x: 0.79, width: 0.4, height: 0.7 }),
        params: { labels: fn.frames, subject: 'ball', direction: 'vertical', theme, labelSize: 4.6, floor: 4, delay: 2.2, stagger: 0.3, step: 0.8, outDur: 0.35 } },
      // 3D: what makes it special, pointed at
      { id: 'solid-notes', asset: 'sketch-callouts', ...extra('solid', 0.6), transform: ART_BOX,
        params: { callouts: [
          { text: solid.callouts[0], x: 0.1, y: 0.2, tx: 0.28, ty: 0.4 },
          { text: solid.callouts[1], x: 0.84, y: 0.88, tx: 0.71, ty: 0.64 }], theme, size: 5.2, floor: 4, delay: 1.2, stagger: 0.9, outDur: 0.35 } },
      // sound: the notes pulse on the beat beside the speaker, and the line that matters
      { id: 'sound-notes', asset: 'sketch-doodle', ...extra('sound', 1.4), transform: box({ x: 0.68, y: 0.52, width: 0.24, height: 0.44 }),
        params: { shape: 'notes', theme, drawDur: 1, idle: 'beat', beatScale: 0.1, exit: 'undraw', outDur: 0.35, pencil: false } },
      { id: 'sound-line', asset: 'text-handwrite', ...extra('sound', 2.2), transform: box({ x: 0.66, y: 0.9, width: 0.6, height: 0.14 }),
        params: { text: sound.note, theme, font: T.fonts.body, weight: 700, size: 60, floor: 4.5, align: 'center', color: 'accent', writeDur: 0.8, underline: 'none', exit: 'fade', outDur: 0.35 } },
      // the close: two stars that stop boiling before the last two seconds
      endStar(1),
    ] },
    { id: 'titles', name: 'Titles', type: 'visual', items: [
      { ...titleItem('hook', { size: 150, floor: 9, align: 'center', underline: 'scribble', writeDur: 1.0, emColor: 'accent' }),
        transform: { space: 'safe', x: 0.5, y: 0.52, width: 0.6, height: 0.5 },
        // a slow push-in while the doodles gather
        // (from the end of the writing: the text is measured as one block while it grows)
        keyframes: { scale: [{ t: 1.3, v: 1, ease: 'inOutQuad' }, { t: f(SCENES.function.start + 0.7), v: 1.06 }] } },
      titleItem('function'),
      titleItem('library'),
      titleItem('reuse'),
      titleItem('agent'),
      titleItem('shapes'),
      titleItem('solid'),
      titleItem('checks'),
      titleItem('sound'),
      // the close: the logo as given (vector), the takeaway, the call to action; in within a second, a slow push-in while
      // it is read, then still for the last HOLD seconds
      { id: 'end', asset: 'end-card', start: f(start('cta')), duration: f(DURATION - start('cta')), transform: { space: 'safe', x: 0.5, y: 0.485, width: 0.9, height: 0.9 }, transition: scribbleTitle,
        keyframes: { scale: [{ t: 1.4, v: 1, ease: 'inOutQuad' }, { t: f(DURATION - HOLD - start('cta')), v: 1.03 }] },
        params: { logo: cta.logo, logoMode: 'svg', title: cta.title, line: cta.line, cta: cta.cta, url: cta.url, clipTheme: true, plate: false, size: 11.2, inDur: 0.7, ctaDelay: 0.4, arrow: true } },
    ] },
    { id: 'sfx', name: 'SFX', type: 'audio', role: 'sfx', items: [
      { id: 'pencil-hook', asset: 'sfx-pencil', start: 0.05, duration: 1.1, gain: 0.3, params: { rate: 7 } },
      { id: 'pencil-clapper', asset: 'sfx-pencil', start: 0.55, duration: 1.5, gain: 0.22, params: { rate: 5, brightness: 0.8 } },
      // the scribble at every cut: a short marker swish, a few frames before the stroke
      ...ids.slice(1).map((id) => ({ id: `swish-${id}`, asset: 'sfx-whoosh', start: f(start(id) - 0.08), duration: 0.6, gain: 0.22, params: { peak: 0.45, brightness: 2600 } })),
      // a pluck on every tick, and on the zero
      ...checks.items.map((_, i) => ({ id: `tick-${i}`, asset: 'synth-note', start: f(start('checks') + tickAt(i) + 0.08), duration: 0.5, gain: 0.3, params: { note: 76 + [0, 2, 4, 7, 9][i % 5], wave: 'triangle', decay: 0.16, cutoff: 5000 } })),
      { id: 'zero-hit', asset: 'synth-note', start: f(start('reuse') + 0.4 + 0.35 + 2 * 0.45 + 1 + 0.1), duration: 0.8, gain: 0.32, params: { note: 81, wave: 'triangle', decay: 0.3, cutoff: 6000 } },
      // the end card lands on a chord
      ...[69, 73, 76].map((note, i) => ({ id: `end-chord-${i}`, asset: 'synth-note', start: f(start('cta') + 0.1), duration: 2.2, gain: 0.2, params: { note, wave: 'triangle', attack: 0.01, decay: 0.9, cutoff: 3200 } })),
    ] },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      id: 'bed', asset: 'music-loop', start: 0, duration: DURATION, gain: 0.5, fadeOut: 1, beats: true,
      params: { bpm: script.bpm, root: 45, scale: 'major', arpWave: 'triangle', drums: 0.7, bass: 0.6, arp: 0.42, swing: 0.08, build: true, outroBars: 2 },
    }] },
  ],
};

export const assets = ['easing'];
export { BAR };
