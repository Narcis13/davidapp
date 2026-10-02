// Clip 1 · "Every frame is a function" · vertical 1080×1920 · 32 s at 120 bpm (a bar is 2 s).
// Six chapters: hook · the idea · the code · the numbers · determinism · end card.

// The band between the progress bar and the captions, as fractions of the frame.
const MAIN = { x: 0.0667, y: 0.172, width: 0.8667, height: 0.52 };
const upper = { x: MAIN.x, y: MAIN.y, width: MAIN.width, height: 0.17 };
const lower = { x: MAIN.x, y: MAIN.y + 0.19, width: MAIN.width, height: 0.33 };

const chapters = [0, 4, 10, 16, 22, 27.5];

export default {
  format: 'vertical', fps: 30, duration: 32, seed: 7, background: '#0b0b12',
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'bg', asset: 'bg-gradient-drift', start: 0, duration: 32, params: { colors: ['#ff5c8a', '#ffd166', '#5b6cff'], intensity: 0.36, beatPulse: 0.12 } },
    ] },
    { id: 'fx', name: 'Effects', type: 'visual', items: [
      { id: 'bars', asset: 'beat-bars', start: 0, duration: 4.2, params: { height: 0.8, bars: 28, decay: 0.26 }, box: { x: MAIN.x, y: 0.56, width: MAIN.width, height: 0.12 } },
      { id: 'sparks', asset: 'sparkle-field', start: 21.6, duration: 6.2, params: { count: 110 } },
    ] },
    { id: 'main', name: 'Scenes', type: 'visual', items: [
      { id: 'code', asset: 'code-window', start: 10.4, duration: 5.6, box: lower, params: { filename: 'word-reveal.js', heightFraction: 1, fontSize: 64, cps: 16, code: 'asset({\n  render(f, p) {\n    *draw*(f.t, p)\n  }\n})' } },
      { id: 'stats', asset: 'stat-trio', start: 16, duration: 6, box: MAIN, params: { heading: 'One clip, *by the numbers*', stats: [{ value: 960, label: 'frames rendered' }, { value: 0, label: 'keyframes set by hand' }, { value: 28, label: 'assets left in the library' }] } },
      { id: 'logo', asset: 'logo-sting', start: 27.5, duration: 4.5, box: MAIN, params: { tagline: 'Every clip leaves *building blocks* behind', outDur: 0.6 } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'hook', asset: 'text-kinetic', start: 0, duration: 4, box: { x: MAIN.x, y: MAIN.y, width: MAIN.width, height: 0.36 }, params: { words: ['THIS', 'VIDEO', 'WAS', 'WRITTEN', 'NOT', 'EDITED'], interval: 0.5 } },
      { id: 'idea', asset: 'text-word-reveal', start: 4, duration: 6, box: MAIN, params: { text: 'Every frame is a *function* of time', size: 190, stagger: 0.12 } },
      { id: 'nokeys', asset: 'text-line-reveal', start: 10, duration: 6, box: upper, params: { text: 'No timeline.\nNo keyframes.\n*Just code.*', size: 110 } },
      { id: 'same', asset: 'text-char-reveal', start: 22, duration: 5.5, box: { x: MAIN.x, y: MAIN.y + 0.03, width: MAIN.width, height: 0.25 }, params: { text: 'Same input.\n*Same pixels.*', size: 170, order: 'random' } },
      { id: 'determinism', asset: 'text-highlight', start: 23.4, duration: 4.1, box: { x: MAIN.x, y: MAIN.y + 0.32, width: MAIN.width, height: 0.16 }, params: { text: 'Rendering is *deterministic* by design', size: 84, style: 'marker', accent: '#7cf5c0' } },
    ] },
    { id: 'overlay', name: 'Overlay', type: 'text', items: [
      { id: 'mark', asset: 'watermark', start: 4, duration: 23.5, params: { size: 52, offsetY: 44, label: 'fablecut', opacity: 0.85 } },
      { id: 'progress', asset: 'progress-segments', start: 0, duration: 32, params: { starts: chapters, inset: 10 } },
      { id: 'captions', asset: 'text-captions', start: 0, duration: 32, params: { size: 50, cues: [
        { start: 0.3, end: 3.8, text: 'No editor was opened to make this' },
        { start: 4.3, end: 9.6, text: 'Each asset is a JavaScript function of time and parameters' },
        { start: 10.3, end: 15.6, text: 'The studio calls it once for every frame' },
        { start: 16.3, end: 21.6, text: 'Thirty frames a second, straight into FFmpeg' },
        { start: 22.3, end: 27.2, text: 'Seeded randomness: render it twice, get the same pixels' },
        { start: 28.2, end: 31.5, text: 'And every asset stays in the library' },
      ] } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', items: [
      { id: 'music', asset: 'music-loop', start: 0, duration: 32, gain: 0.8, beats: true, fadeOut: 1.2, params: { bpm: 120, root: 45, scale: 'minor' } },
    ] },
    { id: 'sfx', name: 'Effects', type: 'audio', items: chapters.slice(1).map((t, i) => (
      { id: `whoosh-${i + 1}`, asset: 'sfx-whoosh', start: t - 0.48, duration: 0.8, gain: 0.5, beats: false }
    )) },
  ],
};
