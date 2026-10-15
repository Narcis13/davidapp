// Evidence for iteration 4, from a data dir with the showcase (built by `npm run showcase`) and the journals:
//
//   STUDIO_DATA=<dir> node scripts/reports-v4.mjs [out-dir]     default out: docs/showcase/v4
//
//   compounding.md / .json   the compounding table for clips 1 to 11 (clips 4 to 11 timed from their journals)
//   check-clips-v4.md / .json check_clip on the clips of iteration 4 in every shape they render in (all must be clean)
//   sources.md / .json       check_provenance and clip_credits of clips 9 to 11 (no problem may stop a final render)
// Exits 1 when a check fails; every report says which.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { ROOT } from '../src/render/host.js';

const C7 = 'clip-7-a-video-that-checks-itself', C9 = 'clip-9-your-first-clip', C10 = 'clip-10-every-clip-helps', C11 = 'clip-11-the-kit';
/** The clips made in iteration 4 and the shapes each renders in. */
const NEW = { [C9]: [undefined], [C10]: [undefined, 'vertical'], [C11]: [undefined] };
const out = process.argv[2] ?? join(ROOT, 'docs', 'showcase', 'v4');
mkdirSync(join(out, 'reports'), { recursive: true });
const write = (name, value) => writeFileSync(join(out, 'reports', name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 1)}\n`);
const journal = (clip) => { try { return readFileSync(join(ROOT, 'showcase', 'journal', `${clip}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return null; } };
const pct = (x) => `${Math.round(x * 100)} %`;
const num = (slug) => Number(slug.match(/^clip-(\d+)/)[1]);

const studio = createStudio({ role: 'evidence' });
const { clips, compounding, checks, provenance } = studio;
const failures = [];
const check = (report, name, ok) => { if (!ok) failures.push(`${report}: ${name}`); return !!ok; };
try {
  // ---- compounding: clips 4 to 11 were built live; their journals keep every call with its time
  {
    const rows = clips.listClips().filter((c) => /^clip-\d/.test(c.slug)).sort((a, b) => num(a.slug) - num(b.slug)).map((c) => {
      const m = compounding.metrics(c.slug);
      const row = { clip: c.slug, title: m.title, seconds: m.duration, format: m.format, mcpCalls: m.mcpCalls, studioActions: 0, newAssets: m.newAssets, newCodeLines: m.newCodeLines, generatedLines: m.generatedLines, items: m.items, reuseShare: m.reuseShare, reusedFrom: m.reusedFrom, buildSeconds: null, perOutputSecond: null };
      const J = num(c.slug) >= 4 ? journal(c.slug) : null;
      if (J) {
        // the build runs to the last render request in the clip's own format (a request for several shapes counts)
        const own = (e) => e.name === 'start_render' && (!e.args.format || e.args.format === c.format);
        const end = J.map(own).lastIndexOf(true);
        const window = J.slice(0, end + 1);
        const calls = window.filter((e) => e.kind !== 'user');
        Object.assign(row, {
          mcpCalls: calls.length, mcpCallsByTool: Object.fromEntries([...calls.reduce((mm, e) => mm.set(e.name, (mm.get(e.name) ?? 0) + 1), new Map())].sort((x, y) => y[1] - x[1])),
          studioActions: window.filter((e) => e.kind === 'user').length, buildStart: J[0].at, buildEnd: J[end].at,
          buildSeconds: Math.round((Date.parse(J[end].at) - Date.parse(J[0].at)) / 100) / 10,
        });
        row.perOutputSecond = Math.round((row.buildSeconds / row.seconds) * 100) / 100;
      }
      return row;
    });
    const by = Object.fromEntries(rows.map((r) => [r.clip, r]));
    const c9 = by[C9], c10 = by[C10];
    const tests = {
      'clip 10 reuses assets clip 9 made': (c10.reusedFrom[C9] ?? 0) >= 1,
      'clip 10 writes less new asset code than clip 9': c10.newCodeLines < c9.newCodeLines,
      'clip 10 takes less build time per second of output than clip 9': c10.perOutputSecond < c9.perOutputSecond,
    };
    for (const [n, ok] of Object.entries(tests)) check('compounding', n, ok);
    const md = [
      '# Compounding: what each clip cost to build',
      '',
      'Written by `scripts/reports-v4.mjs` from a library rebuilt by `npm run showcase` (an empty data dir, no voice tools). Lines of asset code and the reuse share are read from the database. For clips 4 to 11 the MCP calls and the build time come from their journals (`showcase/journal/*.jsonl`), which recorded every call of the live build with its time: the build runs from the first call to the last render request in the clip\'s own format, so fixing what a check or a render report found is counted. Reading calls are counted. Clips 1 to 3 were built before calls were logged. Clip 11 is a short tour of the kit, not a motion-prompt clip.',
      '',
      '| # | clip | length | MCP calls | studio actions | new lines of asset code | reuse share | build time | per second of output |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${num(r.clip)} | ${r.clip} | ${Math.round(r.seconds * 10) / 10} s | ${r.mcpCalls} | ${r.studioActions || '–'} | ${r.newCodeLines}${r.generatedLines ? ` (+${r.generatedLines} generated)` : ''} | ${pct(r.reuseShare)} (${r.items - Math.round(r.items * (1 - r.reuseShare))} of ${r.items} items) | ${r.buildSeconds !== null ? `${r.buildSeconds} s` : '–'} | ${r.perOutputSecond !== null ? `${r.perOutputSecond} s` : '–'} |`),
      '',
      '## Clips 9 and 10',
      '',
      ...Object.entries(tests).map(([n, ok]) => `- ${ok ? 'yes' : 'NO'}: ${n}`),
      '',
      `Clip 9 is the first clip of iteration 4: it made the kit's UI half and five screen recordings, ${c9.newAssets.length} assets (${c9.newCodeLines} lines), in ${c9.mcpCalls} calls (${Object.entries(c9.mcpCallsByTool).slice(0, 6).map(([t, n]) => `${t} ${n}`).join(', ')}, …). Clip 10 told a marketing story from what clip 9 and earlier clips left: ${c10.mcpCalls} calls, ${c10.newCodeLines} new lines, ${pct(c10.reuseShare)} of its items reused, ${c10.perOutputSecond} s of work per second of video against ${c9.perOutputSecond} s.`,
      '',
    ].join('\n');
    write('compounding.md', md);
    write('compounding.json', { tests, clips: rows });
    console.log(`${Object.values(tests).every(Boolean) ? '✓' : '✖'} compounding: ${rows.map((r) => `${num(r.clip)}: ${r.mcpCalls} calls, ${r.newCodeLines} lines, ${pct(r.reuseShare)}, ${r.buildSeconds ?? '–'} s`).join(' · ')}`);
  }

  // ---- check_clip on the clips of iteration 4, in every shape they render in
  {
    const runs = [];
    for (const [clip, formats] of Object.entries(NEW)) {
      for (const format of formats) {
        const r = await checks.checkClip({ clip, format, stills: false });
        runs.push({ clip, format: r.format, frames: r.frames, seconds: r.seconds, counts: r.counts, issues: r.issues });
        check('checks', `${clip} (${r.format}) has no issues`, r.issues.length === 0);
        console.log(`  check ${clip} (${r.format}): ${r.issues.length} issues in ${r.seconds} s`);
      }
    }
    const names = Object.keys(runs[0].counts);
    write('check-clips-v4.md', [
      '# check_clip on the clips of iteration 4',
      '',
      'Written by `scripts/reports-v4.mjs`: `check_clip` (frames every 0.5 s) on clips 9, 10 and 11 as the showcase rebuilds them, in every shape each renders in. Each was made through these checks; none may have an issue.',
      '',
      `| clip | format | frames | seconds | ${names.join(' | ')} |`,
      `|---|---|---|---|${names.map(() => '---').join('|')}|`,
      ...runs.map((r) => `| ${r.clip} | ${r.format} | ${r.frames} | ${r.seconds} | ${names.map((n) => r.counts[n] || '·').join(' | ')} |`),
      '',
      ...runs.filter((r) => r.issues.length).flatMap((r) => [`## ${r.clip} (${r.format})`, '', ...r.issues.map((i) => `- ${i.check} · ${i.t} s · ${i.item ?? '–'} · ${i.message}`), '']),
    ].join('\n'));
    write('check-clips-v4.json', runs.map(({ issues, ...r }) => ({ ...r, issues: issues.map(({ still: _s, box: _b, ...i }) => i) })));
  }

  // ---- sources: what a final render of clips 7 to 11 would check, and their credits
  {
    const rows = [];
    for (const clip of [C7, 'clip-8-cuvinte-pe-ritm', C9, C10, C11]) {
      const { problems } = provenance.check({ clip });
      const credits = provenance.credits({ clip });
      rows.push({ clip, problems, credits: credits.credits, sources: credits.sources.length, warnings: credits.warnings });
      check('sources', `${clip} has no source problem`, problems.length === 0);
    }
    write('sources.md', [
      '# Sources and credits',
      '',
      'Written by `scripts/reports-v4.mjs`: for each clip of iteration 3 and 4, the problems a final render (`final: true`) would refuse (a placeholder, a file with no licence) and the credits `clip_credits` gives.',
      '',
      ...rows.flatMap((r) => [`## ${r.clip}`, '', `Problems: ${r.problems.length ? r.problems.map((p) => p.message).join('; ') : 'none'}. Sources listed: ${r.sources}.${r.warnings.length ? ` Warnings: ${r.warnings.join('; ')}.` : ''}`, '', ...r.credits.map((c) => `- ${c}`), '']),
    ].join('\n'));
    write('sources.json', rows);
    console.log(`  sources: ${rows.map((r) => `${num(r.clip)}: ${r.problems.length} problems, ${r.sources} sources`).join(' · ')}`);
  }
} finally {
  await studio.close();
}
if (failures.length) { console.error(`✖ ${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('✓ all report checks pass');
console.log(`  (reports in ${join(out, 'reports')})`);
