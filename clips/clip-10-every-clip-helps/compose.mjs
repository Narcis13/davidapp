// Clip 10, "Every clip helps the next": a marketing video of about 30 s for Fablecut, square with a vertical render from
// the same composition. The outcome first (every video leaves pieces behind), the product doing it (a recording of the
// studio's library in a browser frame, three icons), proof from this repo's own compounding report (the library after
// each clip), and the call to action on the last frame with the Fablecut logo as given (an SVG with an internal style
// sheet and gradients, drawn as vectors).
// Words and numbers come from script.json, times from timing.mjs (the narration's words), colours from the theme.
// Built gate by gate through MCP (showcase/journal/clip-10-every-clip-helps.jsonl).

import { readFileSync } from 'node:fs';
import { SCENES, VOICE, DURATION, sceneEnd, wordAt, f, BEATS, LEAD, CHART, TITLE_HOLD } from './timing.mjs';

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));
const beat = (id) => script.beats.find((b) => b.id === id);
const theme = 'theme-tide';
/** The theme's tokens, read from its source (the same file the library holds), so no colour is written here. */
const T = (() => {
  let def;
  new Function('asset', readFileSync(new URL(`../../assets/${theme}.js`, import.meta.url), 'utf8'))((d) => { def = d; });
  return def.render();
})();
const alpha = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;

/** The narration word a beat's visual lands on, as an anchor on the narration item that speaks it. */
const wordOf = (id, text) => {
  const b = BEATS.find((x) => x.id === id);
  const at = beat(id).voice.trim().split(/\s+/).findIndex((w) => w.toLowerCase().replace(/[^\p{L}-]/gu, '') === text.toLowerCase());
  if (at < 0) throw new Error(`no word "${text}" in beat ${id}`);
  return b.first + at;
};
const on = (id, text, offset = 0) => ({ item: `vo-${id}`, word: wordOf(id, text), offset });

/** A box in the square frame and its place in the vertical one (fractions of each frame). */
const place = (square, vertical) => ({ transform: square, formats: { vertical: { transform: vertical } } });
const until = (id, start) => f(sceneEnd(id) - start);
/** A slow drift on every scene item, so a held headline or a drawn chart is never a frozen frame. */
const drift = { motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.004, tilt: 0.3, period: 5 } }] };

// ── the outcome: a headline, three icons popping one per word: the video, the making, the pieces it leaves ──────
const outcome = beat('outcome');
/** The outcome leaves as the browser fades in over it (the two never sit on each other at full strength). */
const outcomeEnd = f(SCENES.product.start + LEAD.out);
const icons = [['film', 'video'], ['layers', 'make'], ['package', 'pieces']].map(([name, word], k) => ({
  id: `icon-${name}`, asset: 'kit-icon', start: 0, anchor: on('outcome', word, -LEAD.pop), duration: f(outcomeEnd - wordAt(wordOf('outcome', word)) + LEAD.pop),
  ...place({ x: 0.3 + k * 0.2, y: 0.22, width: 0.14, height: 0.14 }, { x: 0.3 + k * 0.2, y: 0.2, width: 0.16, height: 0.07 }),
  params: { name, weight: 2, draw: 0.6, pop: 0.35, outDur: 0.3, theme }, ...drift,
}));

// ── the product: the library in a browser frame; three labels, each with its icon, on their words ────────────────
const product = beat('product');
const labels = product.screen.labels.map((text, k) => {
  const word = ['searchable', 'versioned', 'ready'][k];
  const at = wordAt(wordOf('product', word)) - LEAD.label;
  const x = 0.2 + k * 0.3;
  return [
    { id: `label-icon-${k}`, asset: 'kit-icon', start: f(at), duration: until('product', f(at)), ...place({ x, y: 0.615, width: 0.07, height: 0.07 }, { x, y: 0.418, width: 0.1, height: 0.04 }),
      params: { name: ['search', 'history', 'repeat'][k], weight: 2, draw: 0.5, pop: 0.3, outDur: 0.3, theme } },
    { id: `label-${k}`, asset: 'title-plate', start: f(at), anchor: on('product', word, -LEAD.label), duration: until('product', f(at)), ...place({ x, y: 0.698, width: 0.28, height: 0.07 }, { x, y: 0.462, width: 0.29, height: 0.035 }),
      params: { text, theme, size: 3.4, align: 'center', font: 'body', weight: 600, inDur: 0.3, outDur: 0.3 } },
  ];
}).flat();

// ── the proof: the library after each clip, from this repo's compounding report ────────────────────────────────
const proof = beat('proof');
const chart = proof.screen.chart;
const nine = wordAt(wordOf('proof', 'nine'));
const two = wordAt(wordOf('proof', 'two'));

// ── the call to action on the last frame ──────────────────────────────────────────────────────────
const cta = beat('cta');
const make = wordAt(wordOf('cta', 'make'));
/** The proof stays until the end card is in over it (no empty beat between them). */
const proofEnd = f(make - LEAD.card + 0.4);

export default {
  format: 'square', fps: 30, duration: DURATION, background: T.bg, seed: 10,
  theme,
  loudness: { target: -14, truePeak: -1 },
  platforms: ['reels'],
  safe: 'platform',
  captions: { burnIn: true },
  markers: [
    { t: 0, type: 'hold', duration: TITLE_HOLD, label: 'the headline is read' },
    ...Object.entries(SCENES).slice(1).map(([id, s]) => ({ t: s.start, type: 'cut', label: id })),
    { t: f(make - LEAD.card), type: 'hold', duration: f(DURATION - make + LEAD.card), label: 'end card holds' },
  ],
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [
      { id: 'drift', asset: 'bg-gradient-drift', start: 0, duration: f(make + 0.6), fadeOut: 1, params: { base: T.bg, colors: [T.bgAlt, T.surface, T.bgAlt], intensity: 0.4, speed: 0.3, beatPulse: 0, vignette: 0.5 } },
    ] },
    { id: 'scenes', name: 'Scenes', type: 'visual', items: [
      { id: 'browser', asset: 'kit-ui-frame', start: SCENES.product.start, duration: until('product', SCENES.product.start),
        // in the narrow vertical window the tab has no room for its title at the size floor: the tab stays empty there
        transform: { x: 0.5, y: 0.31, width: 0.94, height: 0.5 }, formats: { vertical: { transform: { x: 0.5, y: 0.265, width: 0.94, height: 0.25 }, params: { title: '' } } },
        // it fades in (an opacity, not a scale: its chrome text is at its size floor)
        fadeIn: 0.4,
        params: { device: 'browser', content: 'studio-library-search', url: product.screen.url, title: product.screen.title, theme, inDur: 0 },
        motions: [{ asset: 'motion-drift', phase: 'loop', params: { amount: 0.004, tilt: 0.3, period: 5 } }] },
      { id: 'plate', asset: 'kit-plate', start: SCENES.proof.start, duration: f(proofEnd - SCENES.proof.start),
        ...place({ x: 0.5, y: 0.47, width: 0.9, height: 0.6 }, { x: 0.5, y: 0.35, width: 0.92, height: 0.29 }),
        params: { eyebrow: '', title: '', theme, inDur: 0.45, outDur: 0.35 }, ...drift },
      { id: 'end', asset: 'end-card', start: f(make - LEAD.card), anchor: on('cta', 'make', -LEAD.card), duration: f(DURATION - make + LEAD.card),
        ...place({ x: 0.5, y: 0.42, width: 0.9, height: 0.66 }, { x: 0.5, y: 0.34, width: 0.92, height: 0.36 }),
        params: { logo: 'fablecut-logo', logoMode: 'svg', title: cta.screen.title, line: cta.screen.line, cta: cta.screen.cta, url: cta.screen.url, theme, clipTheme: true, size: 6.6, plate: true } },
    ] },
    { id: 'graphics', name: 'Graphics', type: 'visual', items: [
      ...icons,
      ...labels.filter((x) => x.asset === 'kit-icon'),
      { id: 'chart', asset: 'kit-chart-line', start: f(nine - 0.4), anchor: on('proof', 'nine', -0.4), duration: f(proofEnd - f(nine - 0.4)),
        ...place({ x: 0.5, y: 0.48, width: 0.82, height: 0.5 }, { x: 0.5, y: 0.355, width: 0.82, height: 0.26 }),
        params: { title: chart.title, labels: chart.labels, series: [{ label: chart.label, values: chart.values }], theme, delay: 0.4, draw: CHART.draw, size: 3, titleSize: 4.4 }, ...drift },
    ] },
    { id: 'titles', name: 'Titles', type: 'text', items: [
      { id: 'headline', asset: 'title-plate', start: 0, duration: outcomeEnd, ...place({ x: 0.5, y: 0.5, width: 0.86, height: 0.34 }, { x: 0.5, y: 0.34, width: 0.86, height: 0.16 }),
        params: { text: outcome.screen.title, theme, size: 7.6, align: 'center', inDur: 0, outDur: 0.3 }, ...drift },
      ...labels.filter((x) => x.asset === 'title-plate'),
      { id: 'no-new-code', asset: 'title-plate', start: f(two - LEAD.label), anchor: on('proof', 'two', -LEAD.label), duration: f(proofEnd - f(two - LEAD.label)),
        ...place({ x: 0.5, y: 0.1, width: 0.84, height: 0.08 }, { x: 0.5, y: 0.178, width: 0.86, height: 0.04 }),
        params: { text: proof.screen.callout, theme, size: 4, align: 'center', inDur: 0.35, outDur: 0.3 }, ...drift },
    ] },
    { id: 'caps', name: 'Captions', type: 'text', role: 'captions', items: [
      { id: 'cap', asset: 'text-captions', start: 0, duration: DURATION, params: { pill: alpha(T.bg, 0.94), active: T.accent, size: 4.6, floor: 3.2 } },
    ] },
    { id: 'voice', name: 'Narration', type: 'audio', role: 'narration', items: VOICE.map((v) => ({ id: v.id, asset: 'clip-10-voice', start: v.start, offset: v.offset, duration: v.duration })) },
    { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{
      id: 'bed', asset: 'music-loop', start: 0, duration: DURATION, gain: 0.42, fadeOut: 1, params: { bpm: 112, scale: 'major' },
      beats: true,
      duck: { by: 18, attack: 0.15, release: 0.45, hold: 0.25, source: 'words' },
    }] },
  ],
};
