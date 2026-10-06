// Clip 6 · "What the library holds" · square 1080×1080 · 90 s. No new asset code: every piece comes
// from clips 1 to 5 (the title card precomp and preset of clip 4, the 3D terrain, block text and
// baked orb of clip 5, the chart of clip 2, the type, music and end card of clip 1).

const tide = 'theme-tide';

export default {
  format: 'square', fps: 30, duration: 90, seed: 6, background: '#07111f', theme: tide,
  effects: [{ asset: 'fx-grain', params: { amount: 0.04 } }],
  tracks: [
    { id: 'bg', name: 'Backgrounds', type: 'visual', effects: [{ asset: 'fx-vignette', params: { amount: 0.45 } }], items: [
      { id: 'land', asset: 'terrain-3d', start: 0, duration: 10, params: { speed: 0.3 } },
      { id: 'drift', asset: 'bg-gradient-drift', start: 9.4, duration: 30, params: { base: '#07111f', colors: ['#1b4dff', '#5ce1e6', '#7b3ff2'], intensity: 0.3, speed: 0.1 }, transition: { asset: 'trans-wipe', duration: 0.8 } },
      { id: 'land2', asset: 'terrain-3d', start: 39, duration: 15.4, params: { speed: 0.5, height: 1.8 }, transition: { asset: 'trans-glitch', duration: 0.5 } },
      { id: 'harbour', asset: 'harbour-at-dusk', start: 67, duration: 13.4, params: { fit: 'cover' }, transition: { asset: 'trans-push', duration: 0.7, params: { direction: 'up' } },
        keyframes: { scale: [{ t: 0, v: 1 }, { t: 13.4, v: 1.12, ease: 'inOutCubic' }] }, effects: [{ asset: 'fx-duotone', params: { mix: 0.55 } }] },
      { id: 'drift3', asset: 'bg-gradient-drift', start: 54, duration: 13.4, params: { base: '#07111f', colors: ['#1b4dff', '#5ce1e6', '#7b3ff2'], intensity: 0.3, speed: 0.1 }, transition: { asset: 'trans-push', duration: 0.7, params: { direction: 'up' } } },
      { id: 'drift2', asset: 'bg-gradient-drift', start: 80, duration: 10, params: { base: '#07111f', colors: ['#1b4dff', '#5ce1e6', '#7b3ff2'], intensity: 0.3, speed: 0.1 }, transition: { asset: 'trans-iris', duration: 0.9 } },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      { id: 'chart', asset: 'chart-bars', start: 10, duration: 14, transform: { space: 'safe', x: 0.5, y: 0.5, width: 1, height: 0.85 }, transition: { asset: 'trans-push', duration: 0.7 },
        params: { title: 'New lines of asset code, per clip', theme: tide, series: ['lines written'], rows: [{ label: 'Clip 1', value: 1288 }, { label: 'Clip 2', value: 577 }, { label: 'Clip 3', value: 206 }, { label: 'Clip 4', value: 242 }, { label: 'Clip 5', value: 123 }] } },
      { id: 'orb', asset: 'orb-spin', start: 24, duration: 15, params: { loop: true }, transform: { x: 0.5, y: 0.62, width: 0.68, height: 0.68 }, transition: { asset: 'trans-iris', duration: 0.9 },
        motions: [{ asset: 'motion-orbit', phase: 'loop', params: { radius: 0.04 } }, { asset: 'motion-pop', phase: 'out' }], effects: [{ asset: 'fx-chromatic', params: { amount: 0.2, beatKick: 0.6 } }] },
      { id: 'compound', asset: 'block-text-3d', start: 40, duration: 14, params: { text: 'COMPOUND', swingFor: 1.8 }, transform: { x: 0.5, y: 0.58, width: 1, height: 0.45 },
        motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.006 } }, { asset: 'motion-pop', phase: 'out' }] },
      { id: 'numbers', asset: 'stat-trio', start: 54.6, duration: 13, transform: { space: 'safe', x: 0.5, y: 0.5, width: 1, height: 1 }, transition: { asset: 'trans-wipe', duration: 0.8 },
        params: { heading: 'Clip 6, by the numbers', theme: tide, stats: [{ value: 90, label: 'seconds long' }, { value: 5, label: 'clips to draw on' }, { value: 0, label: 'assets written for it' }] },
        motions: [{ asset: 'motion-bounce', phase: 'in', params: { height: 0.2 } }], effects: [{ asset: 'fx-glow', params: { radius: 1.4, strength: 0.6 } }] },
      { id: 'end', asset: 'logo-sting', start: 80, duration: 10, params: { theme: tide, tagline: 'The library *compounds*', outDur: 0.6 }, mask: { asset: 'mask-iris', mode: 'alpha', params: { open: 1, size: 0.95 } } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'opener', asset: 'studio-title-card', start: 0.3, duration: 9, params: { words: ['WHAT', 'THE LIBRARY', 'HOLDS'], logo: 'studio-logo' } },
      { id: 'third', asset: 'lower-third-studio', start: 3, duration: 5.5, params: { title: 'Clip 6 · square', subtitle: 'ninety seconds, nothing written for it', scale: 1.2 } },
      { id: 'orb-line', asset: 'text-line-reveal', start: 25, duration: 13, params: { text: 'Baked in clip 5,\n*reused here*', size: 92, color: '#eef4ff', accent: '#ffb347' }, transform: { space: 'safe', x: 0.5, y: 0.12, width: 1, height: 0.24 } },
      { id: 'compound-line', asset: 'text-word-reveal', start: 41, duration: 12, params: { text: 'Every clip leaves the next one *more to start from*', size: 64, color: '#eef4ff', accent: '#5ce1e6' }, transform: { space: 'safe', x: 0.5, y: 0.14, width: 1, height: 0.26 } },
      { id: 'captions', asset: 'text-captions', start: 68, duration: 11.5, params: { cues: [
        { start: 0.2, end: 3.6, text: 'Presets, precomps and a theme' },
        { start: 3.8, end: 7.4, text: 'made clips 4 and 5 richer' },
        { start: 7.6, end: 11.2, text: 'and made this one cheap' },
      ] } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', items: [{ id: 'music', asset: 'music-loop', start: 0, duration: 90, gain: 0.8, fadeOut: 2.5, params: { bpm: 116, root: 45, arpWave: 'triangle' } }] },
  ],
};
