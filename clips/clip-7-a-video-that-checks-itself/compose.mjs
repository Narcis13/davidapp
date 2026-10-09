// Clip 7, "A video that checks itself": a voiced explainer, horizontal, with a vertical render from the
// same composition (per-format layouts). The visuals are anchored to the narration's words, the captions
// are built from them, the music ducks under the voice, and the clip is mastered to −14 LUFS.
// Built gate by gate through MCP (showcase/journal/clip-7-a-video-that-checks-itself.jsonl).

const VO = 'vo';
const on = (word, offset = 0) => ({ item: VO, word, offset });
const theme = 'theme-tide';

// where things go: a horizontal box (fractions of 1920×1080) and its vertical override (of 1080×1920);
// the horizontal content band is y 108–756 (above the caption lane), the vertical one y 250–1232
const box = (h, v) => ({ transform: h, formats: { vertical: { transform: v } } });
const upper = box({ x: 0.5, y: 0.3, width: 0.8, height: 0.32 }, { x: 0.464, y: 0.27, width: 0.78, height: 0.18 });
const middle = box({ x: 0.5, y: 0.38, width: 0.8, height: 0.42 }, { x: 0.464, y: 0.4, width: 0.78, height: 0.28 });
const lower = box({ x: 0.5, y: 0.58, width: 0.86, height: 0.2 }, { x: 0.464, y: 0.55, width: 0.78, height: 0.12 });
const panel = box({ x: 0.5, y: 0.4, width: 0.62, height: 0.5 }, { x: 0.464, y: 0.42, width: 0.78, height: 0.34 });

/** The same layout with bigger type in the vertical frame (its short side is the same 1080 px, its width much less busy). */
const bigger = (place, params) => ({ ...place, formats: { vertical: { ...place.formats.vertical, params } } });

const plate = (id, text, eyebrow, anchor, duration, place = upper, extra = {}) => ({
  id, asset: 'title-plate', start: 0, duration, anchor, ...bigger(place, { size: extra.size ? extra.size * 1.15 : 7.6 }), ...drift(id.length),
  params: { text, eyebrow, theme, size: 6.4, ...extra },
});

/** A slow drift on every scene item: the picture keeps moving a little, so no stretch reads as a frozen frame. */
const drift = (n) => ({ motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.005, tilt: 0.5, period: 5 + (n % 3) } }] });

/** A check list whose rows come in on their words: progress keys at each word (and 0.35 s after it). */
const rowsOn = (words) => [{ t: 0, v: 0 }, ...words.flatMap((w, i) => [{ t: 0, v: i, anchor: on(w) }, { t: 0, v: i + 1, anchor: on(w, 0.35) }])];

export default {
  format: 'horizontal', fps: 30, duration: 62, background: '#07111f', seed: 7,
  theme,
  loudness: { target: -14, truePeak: -1 },
  platforms: ['youtube', 'shorts'],
  safe: 'platform',
  captions: { burnIn: true },
  markers: [
    { t: 0, type: 'cut', label: 'open' },
    { t: 0, type: 'cut', label: 'the voice', anchor: on(12, -0.1) },
    { t: 0, type: 'cut', label: 'captions', anchor: on(37, -0.1) },
    { t: 0, type: 'cut', label: 'visuals', anchor: on(58, -0.2) },
    { t: 0, type: 'word', label: 'contrast', anchor: on(67) },
    { t: 0, type: 'cut', label: 'the mix', anchor: on(82, -0.2) },
    { t: 0, type: 'cut', label: 'checks', anchor: on(95, -0.2) },
    { t: 0, type: 'cut', label: 'measured', anchor: on(135, -0.2) },
    { t: 0, type: 'cut', label: 'end card', anchor: on(155, -0.3) },
    { t: 58, type: 'hold', duration: 4, label: 'end card holds' },
  ],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'drift', asset: 'bg-gradient-drift', start: 0, duration: 58, fadeOut: 1.2, params: { base: '#07111f', colors: ['#0f2c4d', '#163a5e', '#1d2a52'], intensity: 0.38, speed: 0.16, beatPulse: 0, vignette: 0.5 } },
    ] },
    // a little life behind the plates: the picture never stands still until the end card holds
    { id: 'life', name: 'Particles', type: 'visual', items: [
      { id: 'motes', asset: 'sparkle-field', start: 0, duration: 58, params: { count: 70, colors: ['#5ce1e6', '#eef4ff', '#b39cff'], size: 5, speed: 0.035, twinkle: 1.2, shape: 'dot', opacity: 0.45, inDur: 0, outDur: 1.2 } },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      { id: 'title', asset: 'title-plate', start: 0, duration: 6.4, ...bigger(upper, { size: 8.4 }), params: { text: 'A video that\n*checks itself*', eyebrow: 'Fablecut · iteration 3', theme, size: 7.2, inDur: 0 }, ...drift(0) },
      { id: 'strip', asset: 'word-strip', start: 0, duration: 11.3, anchor: on(5, -0.3), ...bigger(lower, { size: 4.6 }), params: { theme, size: 4 } },
      plate('knows', 'The studio knows\n*every word*', 'Word timings', on(26, -0.2), 4.4),
      plate('captions-from', 'Captions come\nfrom the *words*', 'Two lines at a time', on(38, -0.2), 6.2, middle),
      plate('visuals', 'Visuals land\non their *words*', 'Word anchors', on(58, -0.15), 2.95, middle),
      plate('contrast', 'CONTRAST', '', on(67), 5.5, middle, { font: 'display', weight: 400, size: 14, align: 'center' }),
      { id: 'ducking', asset: 'duck-meter', start: 0, duration: 4.6, anchor: on(83, -0.3), ...bigger(middle, { size: 3.8, seconds: 6 }), params: { theme, by: 18, attack: 0.15, release: 0.45, seconds: 8 }, ...drift(1) },
      { id: 'checks', asset: 'check-list', start: 0, duration: 13.3, anchor: on(95, -0.2), ...bigger(panel, { size: 5 }),
        params: { heading: 'Before a render', theme, items: [{ text: 'Inside the safe zone' }, { text: 'Big enough to read' }, { text: 'Contrast 4.5:1 or more' }, { text: 'On screen long enough' }] },
        keyframes: { 'params.progress': rowsOn([107, 109, 115, 127]) }, ...drift(2) },
      { id: 'measured', asset: 'check-list', start: 0, duration: 8.3, anchor: on(135, -0.2), ...bigger(panel, { size: 5 }),
        params: { heading: 'Measured on the file', theme, items: [{ text: 'Loudness −14 LUFS' }, { text: 'No flashes' }, { text: 'No frozen frames' }] },
        keyframes: { 'params.progress': rowsOn([140, 147, 150]) }, ...drift(3) },
      { id: 'end', asset: 'end-card', start: 0, duration: 4.61, anchor: on(155, -0.3), ...box({ x: 0.5, y: 0.4, width: 0.56, height: 0.5 }, { x: 0.464, y: 0.42, width: 0.78, height: 0.3 }), params: { title: 'Checked by *the studio*', line: 'Fablecut · iteration 3', theme, size: 7.4, plate: true } },
    ] },
    { id: 'caps', name: 'Captions', type: 'text', role: 'captions', items: [
      { id: 'cap', asset: 'text-captions', start: 0, duration: 62, params: { pill: 'rgba(6,14,26,0.94)', active: '#5ce1e6', size: 4.2, floor: 3 } },
    ] },
    { id: 'voice', name: 'Narration', type: 'audio', role: 'narration', items: [{ id: VO, asset: 'clip-7-voice', start: 1, duration: 61 }] },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      id: 'bed', asset: 'music-loop', start: 0, duration: 62, gain: 0.5, fadeOut: 0.9,
      params: { bpm: 96, scale: 'dorian', drums: 0.35, bass: 0.5, arp: 0.35, arpWave: 'triangle', root: 45, outroBars: 2 },
      keyframes: { volume: [{ t: 0, v: -12 }, { t: 1.2, v: 0, ease: 'outCubic' }, { t: 59, v: 0 }, { t: 62, v: -9, ease: 'inSine' }] },
      duck: { by: 18, attack: 0.15, release: 0.45, hold: 0.25, source: 'words' },
    }] },
  ],
};
