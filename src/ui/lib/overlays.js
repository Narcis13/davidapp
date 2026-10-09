// Overlays for the clip editor's preview: a grid, the safe areas (title-safe, action-safe and the
// safe zone assets read as f.safe), the platform profiles' zone, the caption lane, and the measured
// text boxes of the frame on screen. They are drawn in an SVG layer above the canvas, in frame
// pixels, so they scale with the preview and never touch the pixels the renderer makes.

import { h, s, trim } from '/ui/lib/util.js';

const TOGGLES = [
  ['grid', 'overlay-grid', 'Grid', 'Thirds and the centre'],
  ['safe', 'overlay-safe', 'Safe areas', 'Title-safe, action-safe and the safe zone assets read as f.safe'],
  ['platform', 'overlay-platform', 'Platform', 'The zone the clip\'s platform profiles leave free'],
  ['lane', 'overlay-lane', 'Caption lane', 'Where captions go'],
  ['text', 'overlay-text', 'Text boxes', 'The measured box of every text drawn in this frame'],
];

/** Raw recorded words → one box per text block, as the layout report groups them. */
function blocksOf(texts, width, height) {
  const short = Math.min(width, height);
  const map = new Map();
  for (const t of texts ?? []) {
    if (!t?.box) continue;
    const key = `${t.item}|${t.kind}|${t.block ?? t.text}|${t.mask ? 'm' : ''}`;
    let b = map.get(key);
    if (!b) map.set(key, (b = { item: t.item, text: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, size: null }));
    b.text.push(t.text);
    b.x0 = Math.min(b.x0, t.box.x); b.y0 = Math.min(b.y0, t.box.y);
    b.x1 = Math.max(b.x1, t.box.x + t.box.width); b.y1 = Math.max(b.y1, t.box.y + t.box.height);
    if (typeof t.screenSize === 'number') b.size = b.size === null ? t.screenSize : Math.min(b.size, t.screenSize);
  }
  return [...map.values()].map((b) => ({ item: b.item, text: b.text.join(' '), x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0, pct: b.size === null ? null : (b.size / short) * 100 }));
}

/**
 * @param {{ host: HTMLElement, size: () => { width: number, height: number }, safeMode?: () => string | undefined, onText?: (on: boolean) => void }} o
 *   host: the element that holds the canvas (the layer fills it). onText: the text toggle changed (ask the preview to measure, or stop).
 */
export function createOverlays({ host, size, safeMode = () => undefined, onText = () => {} }) {
  const on = { grid: false, safe: false, platform: false, lane: false, text: false };
  let zones = null, texts = [];

  const layer = s('svg', { class: 'ov-layer', preserveAspectRatio: 'none', 'aria-hidden': 'true', 'data-testid': 'overlay-layer' });
  host.append(layer);

  const buttons = new Map();
  const bar = h('div.ov-bar', { role: 'group', 'aria-label': 'Overlays on the preview' },
    h('span.ov-title', 'Overlays'),
    TOGGLES.map(([key, testid, label, title]) => {
      const b = h('button.btn.small.toggle', { type: 'button', 'data-testid': testid, 'aria-pressed': 'false', title }, label);
      b.addEventListener('click', () => set(key, !on[key]));
      buttons.set(key, b);
      return b;
    }));

  function set(key, value) {
    if (key === 'platform' && value && !zones?.platform) return;
    on[key] = value;
    const b = buttons.get(key);
    b.setAttribute('aria-pressed', String(value));
    b.classList.toggle('on', value);
    if (key === 'text') { if (!value) texts = []; onText(value); }
    draw();
  }

  const rect = (cls, r, extra = {}) => s('rect', { class: cls, x: r.x, y: r.y, width: r.width, height: r.height, ...extra });

  function draw() {
    const { width, height } = size();
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.replaceChildren();
    // one css pixel in frame units: labels stay readable however small the preview is
    const scale = host.clientWidth ? host.clientWidth / width : 0.4;
    const px = 1 / scale;
    const label = (x, y, text, anchor = 'start', cls = '') => s('text', { class: `ov-label ${cls}`, x, y, 'font-size': 11 * px, 'text-anchor': anchor, 'stroke-width': 3 * px }, text);
    const pad = 5 * px;
    if (on.grid) {
      const g = s('g', { class: 'ov-grid', 'data-testid': 'overlay-grid-lines' });
      for (const k of [1 / 3, 2 / 3]) g.append(s('line', { x1: width * k, y1: 0, x2: width * k, y2: height }), s('line', { x1: 0, y1: height * k, x2: width, y2: height * k }));
      const c = 10 * px;
      g.append(s('line', { class: 'cross', x1: width / 2 - c, y1: height / 2, x2: width / 2 + c, y2: height / 2 }), s('line', { class: 'cross', x1: width / 2, y1: height / 2 - c, x2: width / 2, y2: height / 2 + c }));
      layer.append(g);
    }
    if (zones && on.platform && zones.platform) {
      const p = zones.platform;
      const g = s('g', { class: 'ov-platform', 'data-testid': 'overlay-zone', 'data-zone': 'platform' });
      g.append(
        s('path', { class: 'shade', 'fill-rule': 'evenodd', d: `M0 0H${width}V${height}H0Z M${p.x} ${p.y}v${p.height}h${p.width}v${-p.height}Z` }),
        rect('edge', p),
        label(p.x + pad, p.y + 14 * px, `platform: ${p.platforms.join(', ')}`));
      layer.append(g);
    }
    if (zones && on.lane) {
      const g = s('g', { class: 'ov-lane', 'data-testid': 'overlay-zone', 'data-zone': 'lane' });
      g.append(rect('fill', zones.lane), label(zones.lane.x + pad, zones.lane.y + 14 * px, 'caption lane'));
      layer.append(g);
    }
    if (zones && on.safe) {
      const fsafe = safeMode() === 'platform' && zones.platform ? zones.platform : zones.format;
      const t = zones.titleSafe, a = zones.actionSafe;
      layer.append(
        s('g', { class: 'ov-title-safe', 'data-testid': 'overlay-zone', 'data-zone': 'title-safe' }, rect('edge', t), label(t.x + pad, t.y + 14 * px, 'title safe')),
        s('g', { class: 'ov-action-safe', 'data-testid': 'overlay-zone', 'data-zone': 'action-safe' }, rect('edge', a), label(a.x + a.width - pad, a.y + 14 * px, 'action safe', 'end')),
        s('g', { class: 'ov-fsafe', 'data-testid': 'overlay-zone', 'data-zone': 'f-safe' }, rect('edge', fsafe), label(fsafe.x + fsafe.width - pad, fsafe.y + fsafe.height - pad, 'f.safe', 'end')));
    }
    if (on.text) {
      const g = s('g', { class: 'ov-texts', 'data-testid': 'overlay-texts' });
      for (const b of blocksOf(texts, width, height)) {
        const y = b.y > 16 * px ? b.y - 4 * px : b.y + b.height + 12 * px;
        g.append(s('g', { class: 'ov-text', 'data-testid': 'overlay-text-box', 'data-item': b.item },
          rect('edge', b),
          label(b.x, y, `${b.item}${b.pct === null ? '' : ` · ${trim(b.pct, 1)}%`}`)));
      }
      layer.append(g);
    }
  }

  const resize = new ResizeObserver(() => draw());
  resize.observe(host);
  draw();

  return {
    bar, layer,
    /** The zones of the frame in frame pixels (the server's `zones`), or null. */
    setZones(next) {
      zones = next ?? null;
      const b = buttons.get('platform');
      b.disabled = !zones?.platform;
      b.title = zones?.platform ? TOGGLES[2][3] : 'Choose platforms in the clip settings first';
      if (!zones?.platform && on.platform) set('platform', false); else draw();
    },
    /** The measured text of the frame on screen (frame pixels, as the preview worker records it). */
    setTexts(next) { texts = next ?? []; if (on.text) draw(); },
    /** The frame size or the safe mode changed. */
    redraw: draw,
    get textOn() { return on.text; },
    destroy() { resize.disconnect(); layer.remove(); },
  };
}
