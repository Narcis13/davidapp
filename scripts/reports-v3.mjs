// Evidence for iteration 3, from a data dir with the showcase (built by `npm run showcase`) and the journals:
//
//   STUDIO_DATA=<dir> node scripts/reports-v3.mjs [out-dir]     default out: docs/showcase/v3
//
//   compounding.md / .json   the compounding table for clips 1 to 8 (clips 4 to 8 timed from their journals)
//   check-clips.md / .json   check_clip on every showcase clip (clip 7 in both formats), the findings on clips 1 to 6
//                            reviewed, and the still of clip 5's low-contrast REUSE letters
//   clip-7-voice.json        the narration: words, transcript check, anchors, caption pages, the mix
//   clip-8-cuts-on-beats.txt each cut marker of clip 8 against the nearest beat the studio detects
// Exits 1 when a check fails; every report says which.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { ROOT } from '../src/render/host.js';
import { checkTranscripts } from '../src/core/words.js';

const LIVE = ['clip-4-direct-the-studio', 'clip-5-a-library-in-3d', 'clip-6-what-the-library-holds', 'clip-7-a-video-that-checks-itself', 'clip-8-cuvinte-pe-ritm'];
const C7 = 'clip-7-a-video-that-checks-itself', C8 = 'clip-8-cuvinte-pe-ritm';
const out = process.argv[2] ?? join(ROOT, 'docs', 'showcase', 'v3');
for (const d of ['reports', 'studio']) mkdirSync(join(out, d), { recursive: true });
const write = (name, value) => writeFileSync(join(out, 'reports', name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 1)}\n`);
const journal = (clip) => readFileSync(join(ROOT, 'showcase', 'journal', `${clip}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pct = (x) => `${Math.round(x * 100)} %`;


const studio = createStudio({ role: 'evidence' });
const { clips, compounding, checks, audio } = studio;
const failures = [];
const check = (report, name, ok) => { if (!ok) failures.push(`${report}: ${name}`); return !!ok; };
try {
  // ---- compounding: clips 4 to 8 were built live; their journals keep every call with its time
  {
    const rows = clips.listClips().filter((c) => /^clip-\d/.test(c.slug)).map((c) => {
      const m = compounding.metrics(c.slug);
      const row = { clip: c.slug, title: m.title, seconds: m.duration, format: m.format, mcpCalls: m.mcpCalls, studioActions: 0, newAssets: m.newAssets, newCodeLines: m.newCodeLines, generatedLines: m.generatedLines, items: m.items, reuseShare: m.reuseShare, reusedFrom: m.reusedFrom, buildSeconds: null, perOutputSecond: null };
      if (LIVE.includes(c.slug)) {
        const J = journal(c.slug);
        // the build runs to the last render request in the clip's own format (renders in other formats come after the
        // build; clips 7 and 8 rendered again at their final gate after fixing what the first render's report found)
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
    const c7 = by[C7], c8 = by[C8];
    const tests = {
      'clip 8 reuses assets clip 7 made': (c8.reusedFrom[C7] ?? 0) >= 1,
      'clip 8 writes no new asset code': c8.newCodeLines === 0,
      'clip 8 takes fewer MCP calls and less build time than clip 7': c8.mcpCalls < c7.mcpCalls && c8.buildSeconds < c7.buildSeconds,
    };
    for (const [n, ok] of Object.entries(tests)) check('compounding', n, ok);
    const md = [
      '# Compounding: what each clip cost to build',
      '',
      'Written by `scripts/reports-v3.mjs`. Lines of asset code and the reuse share are read from the database after `npm run showcase`. For clips 4 to 8 the MCP calls and the build time come from their journals (`showcase/journal/*.jsonl`), which recorded every call of the live build with its time: the build runs from the first call to the last render request in the clip\'s own format (for clips 7 and 8 that is the final gate: the time spent fixing what a first render\'s report found is counted). Reading calls are counted. Clips 1 to 3 were built before calls were logged.',
      '',
      '| # | clip | length | MCP calls | studio actions | new lines of asset code | reuse share | build time | per second of output |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r, i) => `| ${i + 1} | ${r.clip} | ${r.seconds} s | ${r.mcpCalls} | ${r.studioActions || '–'} | ${r.newCodeLines}${r.generatedLines ? ` (+${r.generatedLines} generated)` : ''} | ${pct(r.reuseShare)} (${r.items - Math.round(r.items * (1 - r.reuseShare))} of ${r.items} items) | ${r.buildSeconds !== null ? `${r.buildSeconds} s` : '–'} | ${r.perOutputSecond !== null ? `${r.perOutputSecond} s` : '–'} |`),
      '',
      '## Clips 7 and 8',
      '',
      ...Object.entries(tests).map(([n, ok]) => `- ${ok ? 'yes' : 'NO'}: ${n}`),
      '',
      `Clip 7 is the first video of iteration 3: it wrote ${c7.newAssets.length} assets (${c7.newCodeLines} lines; each was revised at a gate where looking or measuring found a problem) and spent its calls on the checks (${Object.entries(c7.mcpCallsByTool).map(([t, n]) => `${t} ${n}`).join(', ')}). Clip 8 told the same story for a feed from what clip 7 left: ${c8.mcpCalls} calls (${Object.entries(c8.mcpCallsByTool).map(([t, n]) => `${t} ${n}`).join(', ')}), no new code, ${c8.perOutputSecond} s of work per second of video against ${c7.perOutputSecond} s.`,
      '',
    ].join('\n');
    write('compounding.md', md);
    write('compounding.json', { tests, clips: rows });
    console.log(`${Object.values(tests).every(Boolean) ? '✓' : '✖'} compounding: ${rows.map((r) => `${r.clip.replace(/^clip-(\d).*/, '$1')}: ${r.mcpCalls} calls, ${r.newCodeLines} lines, ${pct(r.reuseShare)}, ${r.buildSeconds ?? '–'} s`).join(' · ')}`);
  }

  // ---- check_clip on every showcase clip
  {
    const runs = [];
    for (const c of clips.listClips().filter((x) => /^clip-\d/.test(x.slug))) {
      const formats = c.slug === C7 ? [undefined, 'vertical'] : [undefined];
      for (const format of formats) {
        const r = await checks.checkClip({ clip: c.slug, format, stills: c.slug === 'clip-5-a-library-in-3d' });
        runs.push({ clip: c.slug, format: r.format, frames: r.frames, seconds: r.seconds, counts: r.counts, issues: r.issues });
        console.log(`  check ${c.slug}${format ? ` (${format})` : ''}: ${r.issues.length} issues in ${r.seconds} s`);
      }
    }
    const reuse = runs.find((r) => r.clip === 'clip-5-a-library-in-3d').issues.find((i) => i.check === 'contrast' && i.item === 'letters-photo');
    if (check('checks', "clip 5's REUSE letters are found low-contrast", !!reuse) && reuse.still) copyFileSync(reuse.still, join(out, 'studio', 'check-clip-5-reuse-letters.png'));
    for (const r of runs.filter((x) => [C7, C8].includes(x.clip))) check('checks', `${r.clip} (${r.format}) has no issues`, r.issues.length === 0);
    const names = Object.keys(runs[0].counts);
    const md = [
      '# check_clip on the showcase clips',
      '',
      'Written by `scripts/reports-v3.mjs`: `check_clip` on every clip of the showcase (frames every 0.5 s), clip 7 in both of its formats. Clips 1 to 6 were made before the studio could check them; their findings are listed and reviewed below. Clips 7 and 8 were made through the checks.',
      '',
      `| clip | format | frames | seconds | ${names.join(' | ')} |`,
      `|---|---|---|---|${names.map(() => '---').join('|')}|`,
      ...runs.map((r) => `| ${r.clip} | ${r.format} | ${r.frames} | ${r.seconds} | ${names.map((n) => r.counts[n] || '·').join(' | ')} |`),
      '',
      '## Review of clips 1 to 6',
      '',
      'Each finding was looked at against its still or the frame. All are real by the rules; none is a measuring error:',
      '',
      '- **contrast** — mostly bare text over moving gradients, glows and photos (titles, labels, the logo sting\'s tagline), measured against the worst 5 % of the pixels behind each text box. The iteration 2 audit saw two of them by eye: **clip 5\'s REUSE letters** (3D block letters used as the mask of a photo, ' + (reuse ? `${reuse.numbers.ratio}:1 from ${reuse.t} s to ${reuse.until} s` : 'NOT FOUND') + ', still: `studio/check-clip-5-reuse-letters.png`) and clip 6\'s faint lower third over the terrain.',
      '- **size** — small labels under 2.5 % of the short side: the watermark (2 %), chart and formats labels (1.3–2.3 %), lower-third subtitles (2.1 %).',
      '- **hold** — words flashed one at a time by kinetic title cards (clip 1\'s "VIDEO WAS WRITTEN NOT…", clip 5\'s title card) and short-lived subtitles: on screen for less than words / 3 + 1 s.',
      '- **glyphs** — an arrow (→) in clip 2 and an emoji (🚀) in clip 3 that the bundled fonts do not have (drawn with a system font).',
      '- **last-frame** — every one of clips 1 to 6 animates to its very last frame (logo stings, grain): none holds its end for 2 s.',
      '',
      'None of these were changed: old clips keep their pixels (their versions are pinned). The rules are what clips 7 and 8 were made to pass.',
      '',
      '## Every finding',
      '',
      ...runs.filter((r) => r.issues.length).flatMap((r) => [`### ${r.clip} (${r.format})`, '', ...r.issues.map((i) => `- ${i.check} · ${i.t}${i.until !== i.t ? `–${i.until}` : ''} s · ${i.item ?? '–'} · ${i.message}`), '']),
    ].join('\n');
    write('check-clips.md', md);
    write('check-clips.json', runs.map(({ issues, ...r }) => ({ ...r, issues: issues.map(({ still: _s, box: _b, ...i }) => i) })));
  }

  // ---- clip 7's voice: words, transcript, anchors, captions, the mix
  {
    const comp = clips.getClip(C7).composition;
    const row = studio.library.versionRow(comp.tracks.find((t) => t.role === 'narration').items[0].asset);
    const narration = JSON.parse(row.meta).narration;
    const transcripts = ['clip-7-narration.transcript.txt', 'clip-7-narration.small.txt'].map((f) => readFileSync(join(ROOT, 'showcase', 'voice', f), 'utf8'));
    const tc = checkTranscripts(narration.script, transcripts);
    const anchors = clips.anchorReport(comp);
    const pages = { horizontal: clips.captionPages(comp), vertical: clips.captionPages({ ...comp, format: 'vertical' }) };
    const mix = await audio.report(comp);
    check('voice', 'the transcript check passes', tc.ok);
    check('voice', 'every anchor within 2 frames of its word', anchors.every((a) => Math.abs(a.deltaFrames) <= 2));
    check('voice', 'caption pages break no rule', !pages.horizontal.problems.length && !pages.vertical.problems.length);
    check('voice', 'music 16–20 LU under the voice', mix.underVoice && mix.underVoice.lu >= 16 && mix.underVoice.lu <= 20);
    write('clip-7-voice.json', {
      narration: { asset: `${row.slug}@${row.version}`, words: narration.words.length, stats: narration.stats, source: narration.source, voice: narration.voice },
      transcriptCheck: { ok: tc.ok, counts: tc.counts, disputed: tc.disputed },
      anchors: { count: anchors.length, maxFramesOff: Math.max(...anchors.map((a) => Math.abs(a.deltaFrames))), list: anchors },
      captions: Object.fromEntries(Object.entries(pages).map(([f, p]) => [f, { pages: p.pages.length, problems: p.problems, settings: { ...p.settings, pages: undefined } }])),
      mix: { master: mix.master, loudness: mix.loudness, underVoice: mix.underVoice, speech: mix.speech, silences: mix.silences, clipping: mix.clipping },
    });
    console.log(`  clip 7 voice: transcript ${tc.ok ? 'ok' : 'NOT ok'}, ${anchors.length} anchors (max ${Math.max(...anchors.map((a) => Math.abs(a.deltaFrames)))} frames), music ${mix.underVoice?.lu} LU under the voice`);
  }

  // ---- clip 8: cut on the music's bars
  {
    const comp = clips.getClip(C8).composition;
    const { beats } = await clips.prepareAudio(comp);
    const cuts = comp.markers.filter((m) => m.type === 'cut').map((m) => m.t);
    const lines = cuts.map((c) => { const near = beats.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a), Infinity); return { cut: c, beat: near, offMs: Math.round((near - c) * 1000) }; });
    check('clip 8', 'every cut within one frame of a detected beat', lines.every((l) => Math.abs(l.offMs) <= 34));
    write('clip-8-cuts-on-beats.txt', [`${beats.length} beats detected in the music (100 bpm, a bar is 2.4 s); each cut marker against the nearest one:`, ...lines.map((l) => `cut at ${l.cut} s · nearest beat ${l.beat} s · ${l.offMs} ms off`), ''].join('\n'));
  }
} finally {
  await studio.close();
}
if (failures.length) { console.error(`✖ ${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('✓ all report checks pass');
console.log(`  (reports in ${join(out, 'reports')})`);

