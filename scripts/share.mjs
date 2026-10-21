// Export a clip as a share page: one folder that plays the clip from any static server, under any path.
//
//   STUDIO_DATA=<dir> node scripts/share.mjs <clip> [--out <dir>] [--base-url <url>] [--poster-at <s>] [--quality <1-100>]
//
// Default folder: output/share/<clip>. --base-url (where the folder will be published) only makes og:image and og:url
// absolute, for link previews. Nothing is published: check it with node scripts/serve-static.mjs <dir>.

import { createStudio } from '../src/studio/studio.js';
import { shareOf } from '../src/studio/share.js';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const clip = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!clip) {
  console.error('usage: STUDIO_DATA=<dir> node scripts/share.mjs <clip> [--out <dir>] [--base-url <url>] [--poster-at <s>] [--quality <1-100>]');
  process.exit(2);
}
const num = (v) => (v === undefined ? undefined : Number(v));
const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} kB`);

const studio = createStudio({ role: 'share' });
let code = 0;
try {
  const r = await shareOf(studio).exportClip(clip, { out: opt('out'), baseUrl: opt('base-url'), posterAt: num(opt('poster-at')), quality: num(opt('quality')) });
  console.log(`${r.title} (${r.clip}) → ${r.dir}`);
  console.log(`${r.files} files, ${kb(r.bytes)} in ${r.seconds} s${r.url ? `; link previews point at ${r.url}` : ''}`);
  for (const [part, bytes] of Object.entries(r.breakdown)) if (bytes) console.log(`  ${part.padEnd(10)} ${kb(bytes).padStart(10)}`);
  for (const f of r.frames) console.log(`  ${f.kind} ${f.ref}: ${f.shown} frames shown, ${f.unique} kept (${f.format} q${f.quality})`);
  console.log(`fonts: ${r.fonts.join(', ')}; sound: ${r.audio ?? (r.sounds ? `${r.sounds} sounds, one per audio item` : 'none')}; ${r.modules} modules`);
  for (const w of r.warnings ?? []) console.log(`warning: ${w}`);
  console.log(`check it with the studio stopped: node scripts/serve-static.mjs "${r.dir}"`);
} catch (e) {
  console.error(e.message);
  code = 1;
} finally {
  await studio.close();
}
process.exit(code);
