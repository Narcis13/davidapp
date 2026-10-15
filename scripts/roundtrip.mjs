// The repo and the library agree (contract items D11, D20): clips are exported from the library that made them into a fresh
// repo, imported into a new empty library, and compared: the same composition JSON (so the same refs) and the same frames.
//
//   STUDIO_DATA=<library holding the clips> node scripts/roundtrip.mjs <clip>… [--clone] [--files <dir>]… [--out report.txt] [--keep]
//
// The repo is a new temp folder, or with --clone a `git clone --local` of this checkout (what a clean checkout is). The new
// library is a new temp data dir. Files kept out of git (external) are looked up in the original library's files/ and in any
// --files folder. The report goes to stdout (and --out); the exit code is 1 when anything differs. --keep keeps the temp folders.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { ROOT } from '../src/render/host.js';
import { machineId } from '../src/studio/exchange.js';

const argv = process.argv.slice(2);
const clipsWanted = [], files = [], flags = new Set();
let out = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--files') files.push(argv[++i]);
  else if (argv[i] === '--out') out = argv[++i];
  else if (argv[i].startsWith('--')) flags.add(argv[i].slice(2));
  else clipsWanted.push(argv[i]);
}
if (!clipsWanted.length || !process.env.STUDIO_DATA) {
  console.error('usage: STUDIO_DATA=<library holding the clips> node scripts/roundtrip.mjs <clip>… [--clone] [--files <dir>]… [--out report.txt] [--keep]\n(STUDIO_DATA is required: the default data dir is the user\'s studio)');
  process.exit(2);
}

const dataDir = resolve(process.env.STUDIO_DATA);
const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'roundtrip-'));
const repo = join(scratch, 'repo'), library = join(scratch, 'library-data');
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const bytesOf = (dir) => { let n = 0; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else n += statSync(p).size; } }; try { walk(dir); } catch { /* none */ } return n; };
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;

let failed = false;
const original = createStudio({ dataDir, role: 'cli', poolSize: 8 });
let imported = null;
try {
  if (flags.has('clone')) {
    const r = spawnSync('git', ['clone', '--quiet', '--local', ROOT, repo], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr}`);
  }
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  say(`Round trip of ${clipsWanted.length} clip${clipsWanted.length === 1 ? '' : 's'}: ${clipsWanted.join(', ')}`);
  say(`machine ${machineId()}, code ${head || 'unknown'}, repo ${flags.has('clone') ? `a fresh clone of this checkout (${repo})` : `a new empty folder (${repo})`}`);
  say(`original library ${dataDir}`);
  say(`new library      ${library} (empty)`);
  say();

  // 1. export from the original library
  const exported = new Map();
  for (const slug of clipsWanted) {
    const t0 = Date.now();
    const r = await original.exchange.exportClip(slug, { root: repo });
    exported.set(slug, r);
    const why = {};
    for (const x of r.external) why[x.why] = (why[x.why] ?? 0) + 1;
    say(`export ${slug}: ${r.closure} refs in the closure (${r.versions} versions, ${r.external.length} files left out of git${r.external.length ? `: ${Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}), ${r.check.frames} frame hashes, ${r.wrote.length} files written, ${sec(Date.now() - t0)}`);
  }
  say(`  the store: ${mb(bytesOf(join(repo, 'library')))} in library/, ${mb(bytesOf(join(repo, 'clips')))} in clips/`);
  say();

  // 2. import into a new empty library, one clip after another (they share versions)
  imported = createStudio({ dataDir: library, role: 'cli', poolSize: 8 });
  for (const slug of clipsWanted) {
    const t0 = Date.now();
    const r = await imported.exchange.importClip(join(repo, 'clips', slug), { files: [join(dataDir, 'files'), ...files], verify: true });
    const orig = original.clips.getClip(slug), got = imported.clips.getClip(slug);
    const sameComposition = JSON.stringify(orig.composition) === JSON.stringify(got.composition);
    const refsOf = (s, c) => s.clips.clipAssets(c).map((a) => a.ref).sort();
    const a = refsOf(original, slug), b = refsOf(imported, slug);
    const sameRefs = JSON.stringify(a) === JSON.stringify(b);
    const v = r.verify;
    const ok = sameComposition && sameRefs && v.differ.length === 0 && v.checked > 0;
    if (!ok) failed = true;
    say(`import ${slug}: ${r.versions.created.length} versions created, ${r.versions.reused.length} reused (made by the clips imported before), ${r.rebaked.length} sequences baked again, ${r.copied} files copied${r.external ? ` (${r.external} from outside the repo)` : ''}, ${sec(Date.now() - t0)}`);
    say(`  composition JSON  ${sameComposition ? `identical (${JSON.stringify(orig.composition).length} bytes)` : 'DIFFERENT'}`);
    say(`  pinned refs       ${sameRefs ? `identical (${a.length} versions: ${a.slice(0, 6).join(', ')}${a.length > 6 ? ', …' : ''})` : `DIFFERENT (${a.filter((x) => !b.includes(x)).join(', ') || 'none missing'} / ${b.filter((x) => !a.includes(x)).join(', ') || 'none extra'})`}`);
    say(`  frame hashes      ${v.same} of ${v.checked} identical${v.machine.same ? '' : ` (exported on ${v.machine.exported}, checked on ${v.machine.here}: emoji and system fonts draw per OS)`}${v.differ.length ? `; DIFFERENT: frames ${v.differ.map((d) => d.frame).join(', ')}` : ''}`);
    if (v.checked === 0) say('  (the export has no frame hashes to compare)');
  }
  say();
  if (flags.has('clone')) {
    const st = spawnSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    say(`git status of the clone: ${st.length} new entries (${st.slice(0, 4).join('; ')}${st.length > 4 ? '; …' : ''})`);
  }
  say(failed ? 'RESULT: the library and the repo DISAGREE (see above).' : 'RESULT: every clip came back with the same refs and the same frames.');
} catch (e) {
  failed = true;
  say(`✖ ${e.message}`);
} finally {
  await original.close();
  if (imported) await imported.close();
  if (out) writeFileSync(resolve(out), `${lines.join('\n')}\n`);
  if (flags.has('keep')) console.log(`kept: ${scratch}`);
  else try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold a file */ }
}
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 300).unref();
