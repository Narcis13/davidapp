// The pictures the "user" uploads for clips 4 and 5, made here (never downloaded):
// a harbour at dusk (PNG), a mountain lake at dawn (JPEG). The SVG logo next to this file is handwritten.
//   node showcase/uploads/make.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '../../src/render/host.js';
import { createRng } from '../../src/core/rng.js';

const here = dirname(fileURLToPath(import.meta.url));
const rng = createRng(2026);

function harbour() {
  const c = createCanvas(1920, 1080), g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 620);
  sky.addColorStop(0, '#1b1f3b'); sky.addColorStop(0.6, '#7b3f6e'); sky.addColorStop(1, '#ff9a62');
  g.fillStyle = sky; g.fillRect(0, 0, 1920, 620);
  g.fillStyle = 'rgba(255,214,150,0.95)'; g.beginPath(); g.arc(1380, 560, 70, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.6})`; g.fillRect(rng() * 1920, rng() * 300, 2, 2); }
  g.fillStyle = '#141428';
  for (let x = 0; x < 1920; x += 60) { const h = 80 + rng() * 220; g.fillRect(x, 620 - h, 52, h); for (let y = 620 - h + 16; y < 600; y += 28) for (let k = 0; k < 2; k++) if (rng() < 0.4) { g.fillStyle = '#ffd166'; g.fillRect(x + 10 + k * 20, y, 8, 10); g.fillStyle = '#141428'; } }
  const sea = g.createLinearGradient(0, 620, 0, 1080);
  sea.addColorStop(0, '#2a2546'); sea.addColorStop(1, '#0b0b18');
  g.fillStyle = sea; g.fillRect(0, 620, 1920, 460);
  for (let i = 0; i < 90; i++) { const y = 640 + rng() * 420, w = 40 + rng() * 220; g.fillStyle = `rgba(255,170,110,${0.08 + rng() * 0.22})`; g.fillRect(1380 - w / 2 + (rng() - 0.5) * 200, y, w, 3); }
  return c.toBuffer('image/png');
}

function lake() {
  const c = createCanvas(1600, 1200), g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, '#0f2d3d'); sky.addColorStop(1, '#f6c8a0');
  g.fillStyle = sky; g.fillRect(0, 0, 1600, 700);
  const ridge = (base, amp, color) => { g.fillStyle = color; g.beginPath(); g.moveTo(0, 700); for (let x = 0; x <= 1600; x += 40) g.lineTo(x, base - Math.abs(Math.sin(x * 0.004 + base)) * amp - rng() * 30); g.lineTo(1600, 700); g.fill(); };
  ridge(560, 300, '#3b5a6b'); ridge(640, 180, '#24404d'); ridge(690, 90, '#16303b');
  const water = g.createLinearGradient(0, 700, 0, 1200);
  water.addColorStop(0, '#d9a98a'); water.addColorStop(1, '#0d2733');
  g.fillStyle = water; g.fillRect(0, 700, 1600, 500);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.15})`; g.fillRect(rng() * 1600, 720 + rng() * 460, 30 + rng() * 140, 2); }
  return c.toBuffer('image/jpeg', 90);
}

writeFileSync(join(here, 'harbour-at-dusk.png'), harbour());
writeFileSync(join(here, 'mountain-lake-dawn.jpg'), lake());
console.log('made harbour-at-dusk.png, mountain-lake-dawn.jpg');
