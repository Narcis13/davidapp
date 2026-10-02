// Clip 2 · "The library compounds" · horizontal 1920×1080 · 32 s at 120 bpm.
// Five chapters: title · the numbers · lineage · versions · end card. It is built mostly from
// what clip 1 left behind; the word reveal it uses is version 2, edited for this clip.

const MAIN = { x: 0.05, y: 0.21, width: 0.9, height: 0.6 };
const left = { x: MAIN.x, y: MAIN.y, width: 0.56, height: MAIN.height };
const right = { x: 0.64, y: MAIN.y + 0.06, width: 0.31, height: MAIN.height - 0.12 };
// lower thirds scale with their box, so they get the whole area under the progress bar
const label = { x: 0.05, y: 0.095, width: 0.9, height: 0.75 };

const chapters = [0, 5, 13, 21, 27];
const tide = 'theme-tide';
const third = (id, start, duration, title, subtitle) => (
  { id, asset: 'lower-third', start, duration, box: label, params: { title, subtitle, theme: tide, corner: 'top-right', plate: false, scale: 0.9 } }
);

export default {
  format: 'horizontal', fps: 30, duration: 32, seed: 11, background: '#07111f',
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'bg', asset: 'bg-gradient-drift', start: 0, duration: 32, params: { base: '#07111f', colors: ['#1b4dff', '#5ce1e6', '#7b3ff2'], intensity: 0.3, beatPulse: 0.1, speed: 0.1 } },
      { id: 'grid', asset: 'bg-grid', start: 0, duration: 32, params: { color: '#5ce1e6', opacity: 0.16 } },
    ] },
    { id: 'main', name: 'Scenes', type: 'visual', items: [
      { id: 'chart', asset: 'chart-bars', start: 5, duration: 8, box: MAIN, params: { title: 'Assets behind each clip', theme: tide, rows: [{ label: 'Clip 1', value: 28, value2: 0 }, { label: 'Clip 2', value: 7, value2: 24 }], series: ['written for it', 'reused'] } },
      { id: 'flow', asset: 'lineage-flow', start: 13, duration: 8, box: left, params: { theme: tide, columns: [{ label: 'Clip 1', created: 28, reused: 0 }, { label: 'Clip 2', created: 7, reused: 24 }], perRow: 6, columnDur: 1.6 } },
      { id: 'pins', asset: 'pin-diagram', start: 21, duration: 6, box: left, params: { theme: tide, asset: 'text-word-reveal', clipA: 'clip 1', clipB: 'clip 2' } },
      { id: 'logo', asset: 'logo-sting', start: 27, duration: 5, box: MAIN, params: { theme: tide, tagline: 'The library *compounds*', outDur: 0.6 } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'title', asset: 'text-scramble', start: 0, duration: 5, box: { x: MAIN.x, y: 0.25, width: MAIN.width, height: 0.3 }, params: { text: 'THE LIBRARY *COMPOUNDS*', size: 190 } },
      { id: 'subtitle', asset: 'text-word-reveal', start: 1.5, duration: 3.5, box: { x: 0.15, y: 0.56, width: 0.7, height: 0.16 }, params: { text: 'Clip two starts with *28 assets* already written', size: 60, color: '#eef4ff', accent: '#ffb347', stagger: 0.07 } },
      { id: 'remember', asset: 'text-line-reveal', start: 14, duration: 7, box: right, params: { text: 'Every asset\nremembers\n*where it\ncame from*', size: 84, align: 'left', color: '#eef4ff', accent: '#5ce1e6' } },
      { id: 'never', asset: 'text-highlight', start: 22.2, duration: 4.8, box: right, params: { text: 'Edit an asset.\nOld clips\n*never change.*', size: 84, align: 'left', style: 'underline', color: '#eef4ff', accent: '#ffb347', lineHeight: 1.25, sweepDelay: 1.6 } },
    ] },
    { id: 'overlay', name: 'Overlay', type: 'text', items: [
      { id: 'mark', asset: 'watermark', start: 0.5, duration: 26.5, params: { size: 52, offsetY: 40, label: 'fablecut', opacity: 0.85, labelColor: '#eef4ff' } },
      third('l1', 0.6, 4.4, 'Clip 2', 'horizontal · 1920×1080'),
      third('l2', 5, 8, 'By the numbers', 'reuse, counted from the database'),
      third('l3', 13, 8, 'Lineage', 'which clip made what'),
      third('l4', 21, 6, 'Versions', 'immutable, pinned per clip'),
      { id: 'progress', asset: 'progress-segments', start: 0, duration: 32, params: { starts: chapters, inset: 10, color: '#eef4ff' } },
      { id: 'captions', asset: 'text-captions', start: 0, duration: 32, params: { size: 46, active: '#5ce1e6', pill: 'rgba(7,17,31,0.8)', cues: [
        { start: 0.4, end: 4.6, text: 'This clip started from a library, not a blank page' },
        { start: 5.3, end: 12.6, text: 'Most of what you see was written for clip one' },
        { start: 13.3, end: 20.6, text: 'The database records where every asset came from' },
        { start: 21.3, end: 26.6, text: 'Edits make new versions. Old clips keep the ones they pinned' },
        { start: 27.6, end: 31.5, text: 'Next clip: reuse all of it' },
      ] } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', items: [
      { id: 'music', asset: 'music-loop', start: 0, duration: 32, gain: 0.8, beats: true, fadeOut: 1.2, params: { bpm: 120, root: 41, scale: 'dorian', arpWave: 'triangle', swing: 0.1 } },
    ] },
    { id: 'sfx', name: 'Effects', type: 'audio', items: chapters.slice(1).map((t, i) => (
      { id: `whoosh-${i + 1}`, asset: 'sfx-whoosh', start: t - 0.48, duration: 0.8, gain: 0.45, beats: false, params: { brightness: 2400 } }
    )) },
  ],
};
