// Clip 12, "Tap the beat": an interactive clip, a rhythm game played in the browser from a share link. A title
// (play, how to play, options), a 12-bar song on a neon highway (tap the lanes or press D F J K as the notes cross the
// line), and the results (rank, score, stats, play again). Vertical, 60 fps, never rendered to MP4: its design
// timeline holds the three scenes one after another. Built through MCP (showcase/journal/clip-12-tap-the-beat.jsonl).

import { readFileSync } from 'node:fs';

const theme = 'theme-neon';
const source = (name) => readFileSync(new URL(`../../assets/${name}.js`, import.meta.url), 'utf8');
/** The theme's tokens, read from its source (the same file the library holds), so no colour is written here. */
const T = (() => {
  let def;
  new Function('asset', source(theme))((d) => { def = d; });
  return def.render();
})();

const FPS = 60;
const BPM = 120, BEAT = 60 / BPM, COUNT_IN = 4, BARS = 12, SEED = 7;
/** The notes of the song, from beat-lanes' own chart (the same source the library holds): the results card needs the total. */
const NOTES = new Function('asset', `${source('beat-lanes')}\nreturn chart;`)(() => {})({ bars: BARS, countIn: COUNT_IN, seed: SEED }, BEAT).length;
const f = (s) => Math.round(s * FPS) / FPS;

/** The design timeline: the title holds while it waits, the song runs to its end, the results hold. */
const TITLE = { start: 0, duration: 4 };
const GAME = { start: 4, duration: f((COUNT_IN + BARS * 4) * BEAT + 2.5) };
const RESULTS = { start: f(GAME.start + GAME.duration), duration: 3 };
const DURATION = f(RESULTS.start + RESULTS.duration);
const span = (s) => ({ start: s.start, duration: s.duration });
/** A box in frame fractions: its centre, width and height. */
const box = (x, y, width, height) => ({ transform: { x, y, width, height } });

/** One hit sound per lane, a minor pentatonic chord from the left lane to the right. */
const LANE_NOTES = [69, 72, 76, 79];
const zero = { score: 0, combo: 0, best: 0, hits: 0, perfects: 0 };
/** A caught note: points, the combo bonus, the best combo, the lane's own note, and a toast at a few combos. */
const catchWire = (event, points) => ({
  on: `field.${event}`,
  do: [
    { add: { score: points, combo: 1, hits: 1, ...(event === 'perfect' ? { perfects: 1 } : {}) } },
    { add: { score: { $var: 'combo' } } },
    { if: { var: 'combo', gt: { $var: 'best' } }, then: [{ set: { best: { $var: 'combo' } } }] },
    // the lane comes with the event: each lane sounds its own note
    { set: { lane: '$value' } },
    ...LANE_NOTES.map((_, lane) => ({ if: { var: 'lane', eq: lane }, then: [{ play: `hit-${lane}` }] })),
    ...[10, 25, 40].map((n) => ({ if: { var: 'combo', eq: n }, then: [{ send: 'toast', event: 'success', value: `${n} in a row` }, { send: 'score', event: 'bump' }] })),
  ],
});

export default {
  format: 'vertical', fps: FPS, duration: DURATION, background: T.bg, seed: 12,
  theme,
  tracks: [
    { id: 'stage', name: 'Stage', type: 'visual', items: [
      { id: 'title', asset: 'beat-title', ...span(TITLE), params: { title: 'TAP\nTHE\nBEAT', subtitle: 'A rhythm game you play in the browser', bpm: BPM, size: 26, sun: 15, horizon: 0.615, theme } },
      { id: 'field', asset: 'beat-lanes', ...span(GAME), params: { bpm: BPM, countIn: COUNT_IN, bars: BARS, seed: SEED, combo: { $var: 'combo' }, speed: { $var: 'speed' }, showKeys: { $var: 'keys' }, theme } },
      { id: 'horizon', asset: 'beat-title', ...span(RESULTS), params: { title: '', subtitle: '', bpm: BPM, horizon: 0.76, theme } },
      { id: 'results', asset: 'beat-results', ...span(RESULTS), params: { score: { $var: 'score' }, hits: { $var: 'hits' }, perfects: { $var: 'perfects' }, best: { $var: 'best' }, total: NOTES, theme } },
    ] },
    { id: 'controls', name: 'Controls', type: 'visual', items: [
      { id: 'play', asset: 'ui-button', ...span(TITLE), ...box(0.5, 0.675, 0.72, 0.09), params: { label: 'Play', icon: 'play', variant: 'primary', hotkey: 'Enter', width: 100, size: 13, disabled: { $var: 'help' }, delay: 0.8, theme } },
      { id: 'how', asset: 'ui-button', ...span(TITLE), ...box(0.5, 0.765, 0.72, 0.075), params: { label: 'How to play', icon: 'book-open', variant: 'secondary', hotkey: 'h', size: 12.5, width: 100, disabled: { $var: 'help' }, delay: 0.9, theme } },
      { id: 'keys', asset: 'ui-toggle', ...span(TITLE), ...box(0.5, 0.85, 0.84, 0.075), params: { label: 'Key letters', detail: 'D F J K on the pads', on: { $var: 'keys' }, disabled: { $var: 'help' }, delay: 1.0, theme } },
      { id: 'speed', asset: 'ui-slider', ...span(TITLE), ...box(0.5, 0.925, 0.84, 0.075), params: { label: 'Note speed', value: { $var: 'speed' }, min: 0.6, max: 1.6, step: 0.1, decimals: 1, suffix: '×', disabled: { $var: 'help' }, delay: 1.1, theme } },
      { id: 'again', asset: 'ui-button', ...span(RESULTS), ...box(0.5, 0.82, 0.72, 0.09), params: { label: 'Play again', icon: 'rotate-ccw', variant: 'primary', hotkey: 'Enter', width: 100, size: 13, delay: 1.6, theme } },
      { id: 'menu', asset: 'ui-button', ...span(RESULTS), ...box(0.5, 0.91, 0.72, 0.075), params: { label: 'Menu', variant: 'ghost', hotkey: 'm', size: 12.5, width: 100, delay: 1.7, theme } },
    ] },
    { id: 'overlays', name: 'Overlays', type: 'visual', items: [
      { id: 'score', asset: 'ui-score', ...span(GAME), ...box(0.5, 0.09, 0.6, 0.08), params: { value: { $var: 'score' }, label: 'Score', icon: 'zap', theme } },
      { id: 'toast', asset: 'ui-toast', ...span(GAME), ...box(0.5, 0.35, 0.9, 0.12), params: { edge: 'center', hold: 1.2, theme } },
      { id: 'help', asset: 'ui-dialog', ...span(TITLE), when: { var: 'help', eq: true }, params: {
        title: 'How to play', icon: 'music', confirm: 'Got it', cancel: '', tone: 'accent', theme,
        body: 'Notes ride down four lanes. Tap a lane, or press D F J K (or the arrows), as its note crosses the line.\nRight on the beat is perfect. Keep the combo going.' } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [
      // two bars that loop while the title waits; the song starts with the game scene, on its first frame
      { id: 'title-loop', asset: 'music-loop', ...span(TITLE), loop: true, gain: 0.55, params: { bpm: BPM, root: 45, scale: 'minor', build: false, outroBars: 0, drums: 0.55, bass: 0.6, arp: 0.55, arpWave: 'triangle' } },
      { id: 'song', asset: 'music-loop', ...span(GAME), gain: 0.8, params: { bpm: BPM, root: 45, scale: 'minor', build: true, outroBars: 1, drums: 0.9, bass: 0.75, arp: 0.5, arpWave: 'square' } },
    ] },
    { id: 'sfx', name: 'Sounds', type: 'audio', role: 'sfx', items: [
      ...LANE_NOTES.map((note, lane) => ({ id: `hit-${lane}`, asset: 'synth-note', start: GAME.start, duration: 0.3, cue: true, gain: 0.5, params: { note, wave: 'triangle', decay: 0.09, cutoff: 6000, gain: 0.5 } })),
      { id: 'miss', asset: 'synth-note', start: GAME.start, duration: 0.25, cue: true, gain: 0.45, params: { note: 38, wave: 'square', decay: 0.07, cutoff: 900, gain: 0.5 } },
      { id: 'click', asset: 'synth-note', start: TITLE.start, duration: 0.2, cue: true, gain: 0.4, params: { note: 84, wave: 'sine', decay: 0.05, cutoff: 8000, gain: 0.5 } },
    ] },
  ],
  interactive: {
    start: 'title',
    vars: { ...zero, lane: 0, help: false, keys: true, speed: 1 },
    scenes: [
      { id: 'title', ...span(TITLE), end: 'hold', label: 'Title' },
      { id: 'game', ...span(GAME), end: 'next', label: 'Song' },
      { id: 'results', ...span(RESULTS), end: 'hold', final: true, label: 'Results' },
    ],
    transition: { asset: 'ui-tx-iris', params: { zoom: 0 }, duration: 0.6 },
    wires: [
      { on: 'play.press', do: [{ play: 'click' }, { set: zero }, { go: 'game' }] },
      { on: 'how.press', do: [{ play: 'click' }, { set: { help: true } }, { send: 'help', event: 'open' }] },
      { on: 'help.confirm', do: [{ play: 'click' }, { set: { help: false } }] },
      { on: 'help.cancel', do: { set: { help: false } } },
      { on: 'keys.change', do: [{ play: 'click' }, { set: { keys: '$value' } }] },
      { on: 'speed.change', do: { set: { speed: '$value' } } },
      catchWire('perfect', 100),
      catchWire('good', 50),
      { on: 'field.miss', do: [{ set: { combo: 0 } }, { play: 'miss' }] },
      { on: 'key:Escape', scene: 'game', do: { go: 'title' } },
      { on: 'again.press', do: [{ play: 'click' }, { set: zero }, { go: 'game' }] },
      { on: 'menu.press', do: [{ play: 'click' }, { go: 'title' }] },
    ],
  },
};
