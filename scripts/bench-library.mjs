// The library at scale, measured: run against a studio serving a big library (scripts/synth-library.mjs).
//   1. Search API latency over a mix of queries, filters, sorts and facets (p50, p95, max), over HTTP.
//   2. The library screen in headless Chrome: time from navigation to the first results on screen,
//      and the DOM node count at the top and after scrolling to the end (it must stay bounded).
//
//   node scripts/bench-library.mjs http://127.0.0.1:8796 [out.json]

import { writeFileSync } from 'node:fs';
import { openBrowser } from './lib/parity.mjs';
import { createRng } from '../src/core/rng.js';

const base = process.argv[2] ?? 'http://127.0.0.1:8796';
const out = process.argv[3];
const rng = createRng(7);
const pick = (l) => l[Math.floor(rng() * l.length)];
const WORDS = ['neon', 'title', 'chart', 'lower third', 'badge', 'logo', 'retro', 'calm', 'sparkles', 'map', 'quote', 'ticker', 'warm', 'paper', 'dots', 'ring'];
const FILTERS = [{}, { kind: 'visual' }, { tag: 'text' }, { tag: 'title,overlay' }, { format: 'vertical' }, { author: 'mia' }, { origin: 'launch-teaser' }, { usedBy: 'quarterly-numbers' }, { favorite: '1' }, { needsDescription: '1' }, { collection: 'brand' }, { type: 'image' }];
const SORTS = ['relevance', 'newest', 'used', 'name'];

const total = (await (await fetch(`${base}/api/assets?limit=1`)).json()).total;
const times = [];
for (let i = 0; i < 300; i++) {
  const q = new URLSearchParams({ limit: '60', ...pick(FILTERS), sort: pick(SORTS) });
  if (rng() < 0.6) q.set('query', pick(WORDS));
  if (rng() < 0.5) q.set('facets', '1');
  if (rng() < 0.2) q.set('offset', String(Math.floor(rng() * Math.max(1, total - 60))));
  const t0 = performance.now();
  const res = await fetch(`${base}/api/assets?${q}`);
  await res.json();
  times.push({ ms: performance.now() - t0, q: q.toString(), status: res.status });
}
const sorted = times.map((x) => x.ms).sort((a, b) => a - b);
const pct = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10;
const api = { requests: times.length, assets: total, p50: pct(0.5), p95: pct(0.95), max: pct(1), failed: times.filter((x) => x.status !== 200).length, slowest: times.sort((a, b) => b.ms - a.ms).slice(0, 3).map((x) => ({ ms: Math.round(x.ms), q: x.q })) };
console.log(`search API on ${total} assets: p50 ${api.p50} ms, p95 ${api.p95} ms, max ${api.max} ms (${api.requests} requests, ${api.failed} failed)`);

// the screen
const browser = await openBrowser('about:blank');
let screen;
try {
  screen = await browser.evaluate(`(async () => {
    const t0 = performance.now();
    location.href = ${JSON.stringify(`${base}/`)};
  })()`).then(() => null).catch(() => null);
  await new Promise((r) => setTimeout(r, 300));
  screen = await browser.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 300 && !document.querySelector('[data-testid=asset-card]'); i++) await sleep(10);
    const firstCards = performance.now();
    const nav = performance.getEntriesByType('navigation')[0];
    const shown = Math.round(firstCards - (nav ? nav.startTime : 0));
    const nodesTop = document.querySelectorAll('*').length;
    const cardsTop = document.querySelectorAll('[data-testid=asset-card]').length;
    // scroll whatever scrolls the grid to the very end, a screenful at a time
    const grid = document.querySelector('[data-testid=asset-grid]');
    let pane = grid.querySelector('.vgrid-scroll') ?? grid;
    while (pane && pane !== document.body && !(pane.scrollHeight > pane.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement;
    const scroller = pane && pane !== document.body ? pane : document.scrollingElement;
    let maxNodes = nodesTop, steps = 0, last = -1;
    for (; steps < 20000; steps++) {
      scroller.scrollTop += scroller.clientHeight * 0.9;
      await sleep(25);
      maxNodes = Math.max(maxNodes, document.querySelectorAll('*').length);
      if (scroller.scrollTop === last && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) { await sleep(400); if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break; }
      last = scroller.scrollTop;
    }
    await sleep(500);
    const cards = [...document.querySelectorAll('[data-testid=asset-card]')];
    return { shownMs: shown, nodesTop, cardsTop, nodesEnd: document.querySelectorAll('*').length, maxNodes, cardsEnd: cards.length, steps, lastCard: cards.at(-1)?.dataset.slug ?? null, resultCount: document.querySelector('[data-testid=result-count]')?.textContent ?? null };
  })()`);
} finally {
  await browser.close();
}
console.log(`screen: results in ${screen.shownMs} ms; DOM nodes ${screen.nodesTop} at the top, ${screen.nodesEnd} at the end (max ${screen.maxNodes}) after ${screen.steps} scroll steps; cards in the DOM ${screen.cardsTop} → ${screen.cardsEnd}; ${screen.resultCount}; console problems: ${browser.problems.length}`);
const report = { method: 'HTTP GET /api/assets with random queries, filters, sorts, facets and offsets (300 requests, sequential, warm server); headless Chrome loading / and scrolling the result grid to its end in 90% screenfuls', api, screen, consoleProblems: browser.problems };
if (out) writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
