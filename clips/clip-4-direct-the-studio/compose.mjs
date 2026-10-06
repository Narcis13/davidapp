// Clip 4 · "Direct the studio" · horizontal 1920×1080 (vertical and square layouts by override) · 30 s.
// Four scenes: an uploaded photo with the title and the logo drawn on · titles behind and in front
// of a 3D orb · the numbers with a glow · the end card opening in an iris mask.

const tide = 'theme-tide';
const v = (o) => ({ vertical: o });

export default {
  format: 'horizontal', fps: 30, duration: 30, seed: 4, background: '#07111f', theme: tide,
  effects: [{ asset: 'fx-grain', params: { amount: 0.045 } }],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', effects: [{ asset: 'fx-vignette', params: { amount: 0.5 } }], items: [
      { id: 'photo', asset: 'harbour-at-dusk', start: 0, duration: 7.8, params: { fit: 'cover' },
        keyframes: { scale: [{ t: 0, v: 1 }, { t: 7.8, v: 1.14, ease: 'inOutCubic' }] },
        effects: [{ asset: 'fx-duotone', params: { mix: 0.35 } }] },
      { id: 'drift', asset: 'bg-gradient-drift', start: 7, duration: 23, params: { base: '#07111f', colors: ['#1b4dff', '#5ce1e6', '#7b3ff2'], intensity: 0.32, speed: 0.12 },
        transition: { asset: 'trans-wipe', duration: 0.8, params: { accent: '#5ce1e6' } } },
    ] },
    // the titles start in front of the orb; the build moves this track behind it (move_track)
    { id: 'behind', name: 'Titles behind', type: 'text', items: [
      { id: 'behind-title', asset: 'text-word-reveal', start: 7.6, duration: 7.2, params: { text: 'Titles go *behind* it', size: 170, color: '#eef4ff', accent: '#ffb347' },
        transform: { x: 0.5, y: 0.5, width: 0.94, height: 0.42 }, formats: v({ transform: { width: 0.96, height: 0.3, y: 0.5 }, params: { size: 120 } }) },
    ] },
    { id: '3d', name: '3D', type: 'visual', items: [
      { id: 'orb', asset: 'orb-3d', start: 7, duration: 8, transform: { x: 0.5, y: 0.5, width: 0.56, height: 1 },
        transition: { asset: 'trans-iris', duration: 0.9, params: { ring: '#5ce1e6' } },
        motions: [{ asset: 'motion-pop', phase: 'out', duration: 0.5 }],
        formats: v({ transform: { width: 1, height: 0.62 } }) },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      { id: 'numbers', asset: 'stat-trio', start: 15, duration: 8, transform: { space: 'safe', x: 0.5, y: 0.5, width: 1, height: 1 },
        params: { heading: 'Iteration 2, by the numbers', theme: tide, stats: [{ value: 6, label: 'new asset kinds' }, { value: 46, label: 'MCP tools' }, { value: 5021, label: 'assets in one search' }] },
        transition: { asset: 'trans-push', duration: 0.7 },
        effects: [{ asset: 'fx-glow', params: { radius: 1.6, strength: 0.7, threshold: 0.55 } }] },
      { id: 'end', asset: 'logo-sting', start: 23, duration: 7, params: { theme: tide, tagline: 'A studio you *direct*', outDur: 0.6 },
        mask: { asset: 'mask-iris', mode: 'alpha', params: { open: 1.1, size: 0.95 } } },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'title', asset: 'text-kinetic', start: 0.4, duration: 6.6, params: { words: ['DIRECT', 'THE', 'STUDIO'], interval: 0.7, colors: ['#eef4ff', '#5ce1e6', '#ffb347'] },
        transform: { space: 'safe', x: 0.42, y: 0.5, width: 0.8, height: 0.75 },
        keyframes: { rotation: [{ t: 0, v: -5, ease: 'outBack' }, { t: 0.8, v: 0 }] },
        motions: [{ asset: 'motion-slide', phase: 'in', params: { from: 'left', distance: 0.2 } }],
        formats: { vertical: { transform: { x: 0.5, y: 0.42, width: 1, height: 0.5 } }, square: { transform: { x: 0.5, width: 0.95, height: 0.6 } } } },
      { id: 'front-caption', asset: 'lower-third-studio', start: 8.4, duration: 6.2, params: { title: '…and in front of it', subtitle: 'drag a track: the 3D sits between' } },
    ] },
    { id: 'overlay', name: 'Logo', type: 'visual', items: [
      { id: 'logo', asset: 'svg-draw-on', start: 0.6, duration: 6.4, params: { logo: 'studio-logo', drawFor: 1.8 },
        transform: { space: 'safe', x: 0.92, y: 0.14, width: 0.13, height: 0.22 },
        // added through the request flow: the user asked for a gentle float, the agent proposed this
        motions: [{ asset: 'motion-drift', phase: 'emphasis', at: 1.9, duration: 4, params: { amount: 0.01, tilt: 3, period: 3 } }, { asset: 'motion-pop', phase: 'out', duration: 0.4 }],
        formats: { vertical: { transform: { x: 0.85, y: 0.08, width: 0.22, height: 0.12 } }, square: { transform: { x: 0.88, y: 0.12, width: 0.18 } } } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', items: [{ id: 'music', asset: 'music-loop', start: 0, duration: 30, gain: 0.8, fadeOut: 1.5, params: { bpm: 120, arpWave: 'triangle' } }] },
  ],
};
