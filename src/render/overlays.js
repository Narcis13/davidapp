// Guides drawn over a frame for people to look at (never into a render): a grid, title-safe and
// action-safe, the format's safe zone, the platform zones, the caption lane, the measured text boxes,
// and a highlighted box with a label (the stills of check_clip issues).

import { createCanvas, loadImage, registerFonts } from './host.js';

export const OVERLAYS = ['grid', 'safe', 'platform', 'lane', 'text'];

const COLORS = { grid: 'rgba(255,255,255,0.22)', title: 'rgba(255,255,255,0.85)', action: 'rgba(255,255,255,0.5)', format: '#5ce1e6', platform: '#ffb347', lane: 'rgba(255,92,205,0.22)', laneEdge: '#ff5ccd', text: '#7cf5a0', highlight: '#ff3b3b' };

/**
 * Draw overlays on a frame PNG. o: { width (the frame's own width: the PNG may be smaller), zones (studio/inspect.js zonesOf),
 * texts (layout-report blocks), show: names from OVERLAYS (default all), highlight: { box, label } | [..] }. → PNG Buffer at the PNG's size.
 * @param {Buffer} png @param {{ width: number, height?: number, zones?: any, texts?: any[], show?: string[], highlight?: any }} o
 */
export async function drawOverlays(png, { width, zones, texts = [], show = OVERLAYS, highlight = [] }) {
  registerFonts();
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const k = img.width / width;
  /** @returns {[number, number, number, number]} */
  const R = (r) => [r.x * k, r.y * k, r.width * k, r.height * k];
  const line = Math.max(1, Math.round(img.width / 640));
  const label = (text, x, y, color) => {
    g.font = `600 ${Math.max(10, Math.round(img.width / 80))}px "JetBrains Mono"`;
    const w = g.measureText(text).width;
    const h = Math.max(12, Math.round(img.width / 60));
    const lx = Math.min(Math.max(0, x), img.width - w - 8), ly = Math.min(Math.max(0, y), img.height - h);
    g.fillStyle = 'rgba(0,0,0,0.72)';
    g.fillRect(lx, ly, w + 8, h);
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, lx + 4, ly + h / 2);
  };
  const rect = (r, color, dash = []) => { g.save(); g.strokeStyle = color; g.lineWidth = line; g.setLineDash(dash.map((d) => d * line)); g.strokeRect(...R(r)); g.restore(); };
  if (show.includes('grid')) {
    g.save();
    g.strokeStyle = COLORS.grid; g.lineWidth = line;
    for (let i = 1; i < 10; i++) {
      g.globalAlpha = i % 10 === 0 ? 1 : 0.5;
      g.beginPath(); g.moveTo((img.width * i) / 10, 0); g.lineTo((img.width * i) / 10, img.height); g.moveTo(0, (img.height * i) / 10); g.lineTo(img.width, (img.height * i) / 10); g.stroke();
    }
    g.globalAlpha = 1; g.lineWidth = line * 2;
    for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(img.width * f, 0); g.lineTo(img.width * f, img.height); g.moveTo(0, img.height * f); g.lineTo(img.width, img.height * f); g.stroke(); }
    g.restore();
  }
  if (show.includes('lane') && zones?.lane) {
    g.fillStyle = COLORS.lane; g.fillRect(...R(zones.lane));
    rect(zones.lane, COLORS.laneEdge, [4, 3]);
    label('caption lane', zones.lane.x * k + 4, zones.lane.y * k + 4, COLORS.laneEdge);
  }
  if (show.includes('safe') && zones) {
    rect(zones.actionSafe, COLORS.action, [2, 3]);
    rect(zones.titleSafe, COLORS.title, [6, 4]);
    rect(zones.format, COLORS.format);
    label('f.safe', zones.format.x * k + 4, zones.format.y * k + 4, COLORS.format);
  }
  if (show.includes('platform') && zones?.platform) {
    rect(zones.platform, COLORS.platform, [8, 4]);
    label(`platform: ${zones.platform.platforms.join(' + ')}`, zones.platform.x * k + 4, (zones.platform.y + zones.platform.height) * k - 22, COLORS.platform);
  }
  if (show.includes('text')) {
    for (const t of texts) {
      rect(t.box, COLORS.text, t.approximate ? [3, 3] : []);
      label(`${t.item ?? '?'} · ${t.screenSize === null ? '' : `${Math.round(t.screenSize)}px`}`, t.box.x * k, t.box.y * k - Math.max(12, Math.round(img.width / 60)) - 2, COLORS.text);
    }
  }
  for (const h of [highlight].flat().filter(Boolean)) {
    g.save(); g.strokeStyle = COLORS.highlight; g.lineWidth = line * 3; g.strokeRect(...R(h.box)); g.restore();
    if (h.label) label(h.label, h.box.x * k, (h.box.y + h.box.height) * k + 4, COLORS.highlight);
  }
  return c.toBuffer('image/png');
}
