// A synthetic library of thousands of assets in a scratch data dir, to measure the library at
// scale (see scripts/lib/synth.mjs for what it contains). Seeded, so the same command makes the same library.
//
//   node scripts/synth-library.mjs <data-dir> [--count 5000]

import { createStudio } from '../src/studio/studio.js';
import { buildSynthetic } from './lib/synth.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/synth-library.mjs <data-dir> [--count 5000]'); process.exit(2); }
const count = process.argv.includes('--count') ? Number(process.argv[process.argv.indexOf('--count') + 1]) : 5000;
const studio = createStudio({ dataDir: dir, role: 'synth' });
const t0 = performance.now();
const { made } = await buildSynthetic(studio, { count });
console.log(`library: ${studio.library.search({ limit: 1 }).total} assets (${made.length} synthetic rows, ${Math.round(performance.now() - t0)} ms) in ${dir}`);
await studio.close();
