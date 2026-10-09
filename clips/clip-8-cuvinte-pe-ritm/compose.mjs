// Clip 8, "Cuvinte pe ritm" (words on the beat): a text-and-music video for a feed, vertical, its words in
// Romanian, every scene cut on a bar of the music (100 bpm: a bar is 2.4 s). No voice. Built from what clip 7
// left behind: title-plate, check-list, end-card, the particles and the drift, theme Tide.
// Built gate by gate through MCP (showcase/journal/clip-8-cuvinte-pe-ritm.jsonl).

const BAR = 2.4;
const bar = (n) => Math.round(n * BAR * 1000) / 1000;
const theme = 'theme-tide';
// the content band of a Reels frame: y 269–1248 of 1920, x 72–1008 of 1080 (the tightest of f.safe and the Reels zone)
const place = { transform: { x: 0.5, y: 0.37, width: 0.84, height: 0.3 } };
const panel = { transform: { x: 0.5, y: 0.4, width: 0.84, height: 0.34 } };
const drift = (n) => ({ motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.005, tilt: 0.5, period: 5 + (n % 3) } }] });

/** A plate from bar a to bar b, cut on both. */
const slide = (id, text, eyebrow, a, b, extra = {}) => ({
  id, asset: 'title-plate', start: bar(a), duration: bar(b - a), ...place, ...drift(a),
  params: { text, eyebrow, theme, size: 8, inDur: 0.3, outDur: 0.2, ...extra },
});
/** Check rows ticking in on beats: progress keys (a beat is a quarter of a bar). */
const ticks = (from, beats) => [{ t: 0, v: 0 }, ...beats.flatMap((k, i) => [{ t: bar(from + k / 4) - bar(from), v: i }, { t: bar(from + k / 4) - bar(from) + 0.3, v: i + 1 }])];

export default {
  format: 'vertical', fps: 30, duration: bar(16), background: '#07111f', seed: 8,
  theme,
  loudness: { target: -14, truePeak: -1 },
  platforms: ['reels'],
  safe: 'platform',
  markers: [
    ...[0, 2, 4, 6, 8, 11, 13].map((n) => ({ t: bar(n), type: 'cut', label: `bar ${n + 1}` })),
    ...[1, 3, 5, 7, 9, 10, 12, 14, 15].map((n) => ({ t: bar(n), type: 'beat', label: `bar ${n + 1}` })),
    { t: 32.4, type: 'hold', duration: bar(16) - 32.4, label: 'end card holds' },
  ],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'drift', asset: 'bg-gradient-drift', start: 0, duration: 32.4, fadeOut: 1.2, params: { base: '#07111f', colors: ['#0f2c4d', '#3a1d55', '#123b5c'], intensity: 0.4, speed: 0.18, beatPulse: 0, vignette: 0.5 } },
    ] },
    { id: 'life', name: 'Particles', type: 'visual', items: [
      { id: 'motes', asset: 'sparkle-field', start: 0, duration: 32.4, params: { count: 70, colors: ['#5ce1e6', '#eef4ff', '#ffb347'], size: 6, speed: 0.04, twinkle: 1.2, shape: 'dot', opacity: 0.45, inDur: 0, outDur: 1.2 } },
      { id: 'pulse', asset: 'beat-bars', start: 0, duration: bar(13), transform: { x: 0.5, y: 0.625, width: 0.8, height: 0.05 }, params: { bars: 28, color: '#5ce1e6', color2: '#b39cff', height: 1, position: 'middle', fallbackBpm: 100, inDur: 0.3 } },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      slide('titlu', 'Un video care\n*se verifică singur*', 'Fablecut · iterația 3', 0, 2, { inDur: 0 }),
      slide('cuvinte', 'Fiecare cuvânt\nare *clipa lui*', 'Cuvinte la timp', 2, 4),
      slide('subtitrari', 'Subtitrările\nvin din *cuvinte*', 'Două rânduri', 4, 6),
      slide('muzica', 'Muzica face loc\n*vocii*', 'Mixaj', 6, 8),
      { id: 'verificari', asset: 'check-list', start: bar(8), duration: bar(3), ...panel, ...drift(8),
        params: { heading: 'Înainte de randare', theme, size: 5, items: [{ text: 'În zona sigură' }, { text: 'Destul de mare' }, { text: 'Contrast 4,5:1' }, { text: 'Destul timp pe ecran' }] },
        keyframes: { 'params.progress': ticks(8, [2, 4, 6, 8]) } },
      { id: 'masurat', asset: 'check-list', start: bar(11), duration: bar(2), ...panel, ...drift(11),
        params: { heading: 'Măsurat pe fișier', theme, size: 5, items: [{ text: 'Intensitate −14 LUFS' }, { text: 'Fără flash-uri' }, { text: 'Fără cadre înghețate' }] },
        keyframes: { 'params.progress': ticks(11, [1, 3, 5]) } },
      { id: 'final', asset: 'end-card', start: bar(13), duration: bar(3), transform: { x: 0.5, y: 0.4, width: 0.84, height: 0.3 },
        params: { title: 'Verificat\n*de studio*', line: 'Fablecut · iterația 3', theme, size: 8.5, plate: true } },
    ] },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      // synthesised a bar longer than the clip, so its thin outro bar falls after the end and the clip ends on music
      id: 'beat', asset: 'music-loop', start: 0, duration: bar(16), assetDuration: bar(17), gain: 0.8, fadeOut: 0.6, beats: true,
      params: { bpm: 100, scale: 'minor', drums: 0.8, bass: 0.7, arp: 0.45, arpWave: 'triangle', root: 43, build: true, outroBars: 1 },
      keyframes: { volume: [{ t: 0, v: 0 }, { t: bar(15), v: 0 }, { t: bar(16), v: -4, ease: 'inSine' }] },
    }] },
  ],
};
