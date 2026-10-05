// Clip 3 · "What's new" · square 1080×1080 · 32 s at 120 bpm.
// Release notes built from a template. It reuses clip 1 (kinetic words, captions, music, logo…)
// and clip 2 (chart, lower third, scramble, grid, the v2 word reveal), and adds only a bullet
// template, a badge, a formats diagram, a baked whoosh and a confetti burst forked from clip 1's
// sparkle field.

const MAIN = { x: 0.0556, y: 0.15, width: 0.8889, height: 0.66 };
const label = { x: 0.0556, y: 0.085, width: 0.8889, height: 0.75 };
const chapters = [0, 4, 13, 20, 27];
const third = (id, start, duration, title, subtitle) => (
  { id, asset: 'lower-third', start, duration, box: label, params: { title, subtitle, theme: 'theme-ember', corner: 'top-right', plate: false, scale: 0.72 } }
);

export default {
  format: 'square', fps: 30, duration: 32, seed: 23, background: '#0b0b12',
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'bg', asset: 'bg-gradient-drift', start: 0, duration: 32, params: { colors: ['#7b3ff2', '#3d5afe', '#ffd166'], intensity: 0.3, beatPulse: 0.14, speed: 0.14 } },
      { id: 'grid', asset: 'bg-grid', start: 0, duration: 32, params: { color: '#ffd166', opacity: 0.1, cell: 90 } },
      { id: 'sparks', asset: 'sparkle-field', start: 26.6, duration: 5.4, params: { count: 70, shape: 'diamond' } },
      { id: 'confetti', asset: 'confetti-burst', start: 27.05, duration: 3.6, params: { originY: 0.4 } },
    ] },
    { id: 'main', name: 'Scenes', type: 'visual', items: [
      { id: 'bars', asset: 'beat-bars', start: 0, duration: 4.2, params: { height: 0.8, bars: 24, decay: 0.26 }, box: { x: MAIN.x, y: 0.72, width: MAIN.width, height: 0.1 } },
      { id: 'notes', asset: 'template-bullets', start: 4, duration: 9, box: MAIN, params: { kicker: 'RELEASE NOTES', title: 'Three ideas,\n*one studio*', bullets: ['Assets are *functions* with parameters', 'Clips *pin* the versions they use', 'An AI edits both through *MCP*'], stagger: 1.5, firstAt: 1.4 } },
      { id: 'chart', asset: 'chart-bars', start: 13, duration: 7, box: { x: MAIN.x, y: 0.2, width: MAIN.width, height: 0.6 }, params: { title: 'Assets behind each clip', rows: [{ label: 'Clip 1', value: 28, value2: 0 }, { label: 'Clip 2', value: 7, value2: 24 }, { label: 'Clip 3', value: 5, value2: 29 }], series: ['written for it', 'reused'] } },
      { id: 'formats', asset: 'format-frames', start: 20, duration: 7, box: { x: MAIN.x, y: 0.36, width: MAIN.width, height: 0.45 }, params: { cycle: 1.5 } },
      { id: 'logo', asset: 'logo-sting', start: 27, duration: 5, box: MAIN, params: { tagline: 'Made with *code*, built from *parts*', outDur: 0.6 } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'hook', asset: 'text-kinetic', start: 0, duration: 4, box: { x: MAIN.x, y: 0.14, width: MAIN.width, height: 0.56 }, params: { words: ["WHAT'S", 'NEW', 'IN', 'FABLECUT'], interval: 0.5, stack: true, colors: ['#f4f1ea', '#ffd166', '#f4f1ea', '#ff5c8a'] } },
      { id: 'remix', asset: 'text-scramble', start: 20.2, duration: 6.8, box: { x: MAIN.x, y: 0.17, width: MAIN.width, height: 0.17 }, params: { text: 'ONE CLIP, *ANY FORMAT*', size: 92, color: '#f4f1ea', accent: '#7cf5c0', resolveDur: 1.2 } },
    ] },
    { id: 'overlay', name: 'Overlay', type: 'text', items: [
      { id: 'mark', asset: 'watermark', start: 4, duration: 23, params: { size: 46, offsetY: 34, label: 'fablecut', opacity: 0.85 } },
      third('l2', 13, 7, 'Reuse', 'counted from the database'),
      third('l3', 20, 7, 'Remix', 'vertical · horizontal · square'),
      { id: 'progress', asset: 'progress-segments', start: 0, duration: 32, params: { starts: chapters, inset: 6 } },
      { id: 'captions', asset: 'text-captions', start: 0, duration: 32, params: { size: 42, cues: [
        { start: 0.4, end: 3.8, text: 'Clip three: mostly borrowed parts' },
        { start: 4.4, end: 12.6, text: 'A template with content slots: fill in the copy, keep the motion' },
        { start: 13.3, end: 19.6, text: 'Each clip writes less and reuses more' },
        { start: 20.3, end: 26.6, text: 'Assets lay out from the frame, so a remix just re-flows' },
        { start: 27.6, end: 31.5, text: 'Every clip leaves the next one a head start 🚀' },
      ] } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', items: [
      { id: 'music', asset: 'music-loop', start: 0, duration: 32, gain: 0.8, beats: true, fadeOut: 1.2, params: { bpm: 120, root: 48, scale: 'major', arpWave: 'saw', swing: 0.05 } },
    ] },
    { id: 'sfx', name: 'Effects', type: 'audio', items: chapters.slice(1).map((t, i) => (
      { id: `whoosh-${i + 1}`, asset: 'whoosh-hit', start: t - 0.48, duration: 0.8, gain: 0.5, beats: false }
    )) },
  ],
};
