// Clip 5 · "A library in 3D" · vertical 1080×1920 · 60 s. Built mostly from clip 4's pieces (the
// title-card precomp, motions, transitions, effects, the lower-third preset, the orb) plus new 3D
// terrain and type, a baked orb sequence and an uploaded photo seen through 3D letters.

const tide = 'theme-tide';
const full = { x: 0.5, y: 0.5, width: 1, height: 1 };

export default {
  format: 'vertical', fps: 30, duration: 60, seed: 5, background: '#07111f', theme: tide,
  effects: [{ asset: 'fx-grain', params: { amount: 0.04 } }],
  tracks: [
    { id: 'bg', name: 'Backgrounds', type: 'visual', effects: [{ asset: 'fx-vignette', params: { amount: 0.45 } }], items: [
      { id: 'lake', asset: 'mountain-lake-dawn', start: 0, duration: 8.4, params: { fit: 'cover' }, keyframes: { scale: [{ t: 0, v: 1.08 }, { t: 8.4, v: 1, ease: 'outCubic' }] }, effects: [{ asset: 'fx-duotone', params: { mix: 0.4 } }] },
      { id: 'terrain', asset: 'terrain-3d', start: 8, duration: 10.4, params: { speed: 0.45 }, transition: { asset: 'trans-glitch', duration: 0.5 } },
      { id: 'drift', asset: 'bg-gradient-drift', start: 18, duration: 42, params: { base: '#07111f', colors: ['#1b4dff', '#5ce1e6', '#7b3ff2'], intensity: 0.3, speed: 0.1 }, transition: { asset: 'trans-wipe', duration: 0.8, params: { accent: '#ffb347', angle: -15 } } },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      { id: 'grows', asset: 'block-text-3d', start: 9, duration: 9, params: { text: 'GROWS', swingFor: 1.6 }, transform: { x: 0.5, y: 0.62, width: 1, height: 0.42 }, motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.008 } }, { asset: 'motion-pop', phase: 'out' }] },
      { id: 'orb', asset: 'orb-spin', start: 18.4, duration: 9.6, params: { loop: true }, transform: { x: 0.5, y: 0.48, width: 0.9, height: 0.51 }, transition: { asset: 'trans-iris', duration: 0.8 },
        motions: [{ asset: 'motion-orbit', phase: 'loop', params: { radius: 0.05 } }], effects: [{ asset: 'fx-chromatic', params: { amount: 0.25, beatKick: 0.8 } }] },
      { id: 'numbers', asset: 'stat-trio', start: 28, duration: 12, transform: { space: 'safe', ...full }, transition: { asset: 'trans-push', duration: 0.7, params: { direction: 'up' } },
        params: { heading: 'What each clip left behind', theme: tide, stats: [{ value: 28, label: 'assets from clip 1' }, { value: 14, label: 'new in clip 4' }, { value: 6, label: 'new in clip 5' }] },
        motions: [{ asset: 'motion-bounce', phase: 'in', params: { height: 0.25 } }], effects: [{ asset: 'fx-glow', params: { radius: 1.5, strength: 0.6 } }] },
      { id: 'letters-photo', asset: 'mountain-lake-dawn', start: 40, duration: 10, params: { fit: 'cover' }, transition: { asset: 'trans-glitch', duration: 0.5 },
        mask: { asset: 'block-text-3d', mode: 'alpha', params: { text: 'REUSE', swingFor: 1.2 }, transform: { x: 0.5, y: 0.5, width: 1, height: 0.4 } } },
      { id: 'end', asset: 'logo-sting', start: 50, duration: 10, params: { theme: tide, tagline: 'Every clip makes the *next one* cheaper', outDur: 0.6 }, transition: { asset: 'trans-iris', duration: 0.9 } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'opener', asset: 'studio-title-card', start: 0.3, duration: 7.7, params: { words: ['A', 'LIBRARY', 'IN 3D'], logo: 'studio-logo' } },
      { id: 'terrain-line', asset: 'text-line-reveal', start: 10, duration: 7.5, params: { text: 'Land made\nfrom a *seed*', size: 110, color: '#eef4ff', accent: '#ffb347', align: 'left' }, transform: { space: 'safe', x: 0.5, y: 0.16, width: 1, height: 0.26 } },
      // added through the request flow ("add a lower third at 0:03"), proposed by the agent and accepted
      { id: 'intro-third', asset: 'lower-third-studio', start: 3, duration: 4.6, params: { title: 'Clip 5 · vertical', subtitle: 'a minute built mostly from clip 4', scale: 1.5 } },
      { id: 'baked', asset: 'lower-third-studio', start: 19.5, duration: 7.5, params: { title: 'Baked once', subtitle: 'the 3D orb, as frames: reused for free', scale: 1.5 } },
      { id: 'reuse-line', asset: 'text-word-reveal', start: 41, duration: 8, params: { text: 'An uploaded photo, *through 3D letters*', size: 74, color: '#eef4ff', accent: '#5ce1e6' }, transform: { space: 'safe', x: 0.5, y: 0.86, width: 1, height: 0.2 } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', items: [{ id: 'music', asset: 'music-loop', start: 0, duration: 60, gain: 0.8, fadeOut: 2, params: { bpm: 110, root: 43, arpWave: 'triangle' } }] },
  ],
};
