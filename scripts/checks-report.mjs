// The motion prompt's <checks> for a finished clip, measured by the studio's own tools over MCP, written as
// work/<slug>/checks/report.md (craft/CHECKS.md says which tool measures what). Checks that are a person's call
// (takeaway, spelling-and-facts, literals, frame-sheet viewing) are listed with what was done for them in `--notes`.
//
//   STUDIO_DATA=<data dir> node scripts/checks-report.mjs <clip> <out.md> [--final <render id>] [--second <render id>]
//                                                          [--formats horizontal,vertical] [--notes notes.json]
//
// --final is the final render (default: the newest final render of the clip), --second a render of it made with
// another workers count (the determinism check).

import { readFileSync, writeFileSync } from 'node:fs';
import { connect, callTool } from './mcp.mjs';

const argv = process.argv.slice(2);
const [clip, out] = argv;
if (!clip || !out) { console.error('usage: node scripts/checks-report.mjs <clip> <out.md> [--final id] [--second id] [--formats a,b] [--notes file]'); process.exit(2); }
if (!process.env.STUDIO_DATA) { console.error('Set STUDIO_DATA (never ./data by accident).'); process.exit(2); }
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const notes = opt('--notes') ? JSON.parse(readFileSync(opt('--notes'), 'utf8')) : {};

const client = await connect({ author: 'checks-report' });
const call = async (name, args) => {
  const r = await callTool(client, name, args);
  if (r.isError) throw new Error(`${name}: ${r.text}`);
  return r.json ?? r.text;
};
const rows = [];
const row = (check, status, evidence, note = '') => rows.push({ check, status, evidence, note });
const fmt = (n, d = 1) => (typeof n === 'number' ? n.toFixed(d) : String(n));

try {
  const got = await call('get_clip', { clip });
  const comp = got.composition;
  const renders = (await call('list_renders', { clip, status: 'done', limit: 100 })).renders;
  const finals = renders.filter((r) => r.options?.final);
  const final = opt('--final') ? await call('get_render', { id: Number(opt('--final')) }) : finals[0] ? await call('get_render', { id: finals[0].id }) : null;
  if (!final) throw new Error(`no final render of ${clip}`);
  const all = finals.filter((r) => r.format === final.format || !r.format);
  const formats = (opt('--formats') ?? comp.format).split(',');

  // script-lock: the render's captions are the script; the take says the script
  const narrations = [...new Set(comp.tracks.filter((t) => t.role === 'narration').flatMap((t) => t.items.map((i) => i.asset)))];
  for (const n of narrations) {
    const t = await call('check_transcript', { narration: n, transcribe: true });
    const bad = (t.slips?.length ?? 0) + (t.drops?.length ?? 0) + (t.insertions?.length ?? 0);
    row('script-lock (voice)', bad ? 'open' : 'pass', `check_transcript { narration: "${n}", transcribe: true }: ${bad} slips/drops/insertions, ${t.disputed?.length ?? 0} disputed (${(t.models ?? []).join(' + ') || 'models'})`);
  }
  if (final.srt) {
    const srt = readFileSync(`${process.env.STUDIO_DATA}/${final.srt}`, 'utf8');
    const said = srt.split(/\r?\n/).filter((l) => l && !/^\d+$/.test(l) && !/-->/.test(l)).join(' ');
    const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const script = narrations.map((n) => n).length ? (await Promise.all(narrations.map(async (n) => (await call('get_asset', { ref: n })).meta?.narration?.script ?? ''))).join(' ') : '';
    row('script-lock (captions)', norm(said) === norm(script) ? 'pass' : 'open', `the final render's SRT (${final.srt}) against the narration's script: ${norm(said) === norm(script) ? 'equal' : 'different'} after normalising case and punctuation`);
  }

  // determinism
  const second = opt('--second') ? await call('get_render', { id: Number(opt('--second')) }) : null;
  const ha = final.stats.frameHashes ?? {};
  const frames = Object.keys(ha);
  const fh = (await call('frame_hashes', { clip, times: frames.map((k) => Number(k) / comp.fps) })).frames;
  const sameNow = fh.filter((x) => ha[x.frame] === x.hash).length;
  let det = `frame_hashes at the final's ${frames.length} sampled frames: ${sameNow}/${frames.length} equal the hashes render #${final.id} took (${final.stats.workers} workers)`;
  let detOk = sameNow === frames.length;
  if (second) {
    const hb = second.stats.frameHashes ?? {};
    const same = frames.filter((k) => hb[k] === ha[k]).length;
    det += `; render #${second.id} with ${second.stats.workers} workers: ${same}/${frames.length} equal`;
    detOk = detOk && same === frames.length && second.stats.workers !== final.stats.workers;
  }
  row('determinism', detOk ? 'pass' : 'open', det);

  // check_clip on every shape
  for (const format of formats) {
    const r = await call('check_clip', { clip, format: format === comp.format ? undefined : format, stills: false });
    const by = {};
    for (const i of r.issues) by[i.check] = (by[i.check] ?? 0) + 1;
    row(`glyphs, text-safe-area, no-collisions, text-contrast, read-time, captions (${format})`, r.issues.length ? 'open' : 'pass',
      `check_clip${format === comp.format ? '' : ` { format: "${format}" }`}: ${r.issues.length} issues over ${r.frames} frames${r.issues.length ? ` (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  }

  // the encoded file: format, loudness, frame sheet problems
  for (const r of formats.map((f) => all.find((x) => (x.format ?? comp.format) === f) ?? (f === comp.format ? final : null)).filter(Boolean)) {
    const rep = await call('render_report', { id: r.id });
    const p = rep.report?.probe ?? r.stats.probe;
    const v = p.video ?? {}, a = p.audio ?? {};
    const bt709 = p.color && ['primaries', 'transfer', 'space'].every((k) => p.color[k] === 'bt709');
    const okFormat = v.codec === 'h264' && a.codec === 'aac' && a.sampleRate === 48000 && v.pixFmt === 'yuv420p' && bt709 && p.faststart === true && v.height >= 1080 && Math.min(v.width, v.height) >= 1080 && Math.abs(p.duration - comp.duration) / comp.duration <= 0.05;
    row(`format (${r.format ?? comp.format})`, okFormat ? 'pass' : 'open', `render_report #${r.id}: ${v.width}×${v.height}, ${fmt(v.fps, 0)} fps, ${v.codec} ${v.pixFmt}, ${a.codec} ${a.sampleRate} Hz ${a.channels} ch, ${fmt(p.duration, 2)} s, ${(p.size / 1e6).toFixed(1)} MB, colour ${p.color ? `${p.color.primaries}/${p.color.transfer}/${p.color.space} ${p.color.range}` : 'untagged'}, faststart ${p.faststart}`);
    const L = r.stats.loudness?.measured ?? rep.loudness;
    const okLoud = Math.abs(L.integrated + 14) <= 1 && L.truePeak <= -1;
    row(`loudness (${r.format ?? comp.format})`, okLoud ? 'pass' : 'open', `on the encoded file: ${fmt(L.integrated)} LUFS, true peak ${fmt(L.truePeak)} dBTP, LRA ${fmt(L.range)} LU${r.stats.loudness?.correction ? `; ${r.stats.loudness.correction}` : ''}`);
    row(`frame-sheet (${r.format ?? comp.format})`, r.stats.problems?.length ? 'open' : 'pass', `render_report #${r.id}: black frames (down to 1 frame), freezes (down to 0.5 s, outside named holds), brightness jumps away from cuts, flashes, silences: ${r.stats.problems?.length ? r.stats.problems.join('; ') : 'none'}; sheets ${(r.stats.files?.sheets ?? []).join(', ')}`);
  }
  const audio = await call('audio_report', { clip });
  if (audio.underVoice) {
    const lu = audio.underVoice.lu;
    row('loudness (music under the voice)', lu >= 16 && lu <= 20 ? 'pass' : 'open', `audio_report: music ${fmt(lu)} LU under the voice where it speaks; silences over 1 s: ${(audio.silences ?? []).filter((s) => s.duration > 1).length}; clipping samples: ${audio.clipping?.samples ?? 0}`);
  }

  // sync
  const anchors = (await call('anchor_report', { clip })).anchors ?? [];
  if (anchors.length) {
    const worst = Math.max(...anchors.map((a) => Math.abs(a.deltaFrames)));
    row('sync (key words)', worst <= 2 ? 'pass' : 'open', `anchor_report: ${anchors.length} anchors, worst ${fmt(worst, 2)} frames from its word (${anchors.map((a) => `${a.id} on "${a.word.text}" ${fmt(a.deltaFrames, 2)}`).join(', ')})`);
  }

  // sources
  const prov = await call('check_provenance', { clip });
  const credits = await call('clip_credits', { clip });
  row('sources', prov.ready ? 'pass' : 'open', `check_provenance: ${prov.problems.length} problems, ${prov.warnings.length} warnings; clip_credits lists ${credits.sources?.length ?? 0} sources; the final render (final: true) passed the same check and wrote ${final.stats.files?.credits ?? 'its credits'}`);

  for (const [check, v] of Object.entries(notes)) row(check, v.status, v.evidence, v.note ?? '');
} finally {
  await client.close();
}

const md = [
  `# Checks — ${clip}`,
  '',
  `Measured ${new Date().toISOString().slice(0, 10)} by \`scripts/checks-report.mjs\` through the studio's MCP tools (see \`craft/CHECKS.md\`). Status: pass, fixed, n/a or open.`,
  '',
  '| check | status | evidence | note |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.check} | ${r.status} | ${String(r.evidence).replace(/\|/g, '\\|')} | ${String(r.note).replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
writeFileSync(out, md);
console.log(md);
process.exit(rows.some((r) => r.status === 'open') ? 1 : 0);
