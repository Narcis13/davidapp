// The real run of the studio's speech tools, with the tools of this machine (nothing is mocked):
//
//   STUDIO_DATA=<dir> STUDIO_WHISPER_CLI=… STUDIO_WHISPER_MODEL=… [STUDIO_WHISPER_MODEL_2=…] STUDIO_KOKORO_DIR=… \
//     node scripts/speech-check.mjs [out-dir] [exact|samples|clip7|natural|generate ...]
//
//   default out: docs/showcase/v4/reports; with no step named, every step runs.
//   speech-status.json         speech_status
//   speech-exact-times.json    a take made word by word (every word's true start and end known), aligned by the studio's
//                              aligner with each whisper model; the share of starts and ends within 2 frames at 30 fps
//   speech-voice-samples.json  voice_samples: one line in three voices (the files stay in the data dir)
//   speech-clip-7-transcript.json  a real transcription of iteration 3's take, the transcript check against clip 7's
//                              script, and its word times against the ones the manual whisper run gave
//   speech-generate.json       generate_narration end to end with the local voice
// Exits 1 when a check fails (starts within 2 frames under 95 %, the transcript check, an error).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { createTools } from '../src/mcp/tools.js';
import { ROOT } from '../src/render/host.js';
import { alignWords, importWords } from '../src/core/words.js';
import { kokoroAdapter } from '../src/studio/speech/kokoro.js';
import { readWav, soundSpan } from '../src/studio/speech/wav.js';

if (!process.env.STUDIO_DATA) { console.error('Set STUDIO_DATA to a scratch data directory (this script creates assets).'); process.exit(2); }
const args = process.argv.slice(2);
const out = args[0] && !['exact', 'samples', 'clip7', 'natural', 'generate'].includes(args[0]) ? args.shift() : join(ROOT, 'docs', 'showcase', 'v4', 'reports');
const steps = args.length ? args : ['exact', 'samples', 'clip7', 'natural', 'generate'];
mkdirSync(out, { recursive: true });
const write = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 1)}\n`);
const FPS = 30, TOL = 2 / FPS;
const r3 = (v) => Math.round(v * 1000) / 1000;
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const studio = createStudio({ role: 'evidence' });
const { speech } = studio;
const { call } = createTools(studio, { author: 'speech-check' });
const failures = [];
const check = (name, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failures.push(name); };
const tool = async (name, a) => {
  const r = await call(name, a);
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

// 54 words with no number and no abbreviation Kokoro's sentence splitter would join to its neighbour
const EXACT_SCRIPT = 'Every frame is a function of time. Nothing moves unless the clock says so, and the clock belongs to the studio. '
  + 'A voice is read word by word, each word alone, so we know exactly when it starts and when it stops. '
  + 'Then an aligner listens to the whole take and tells us where it thinks every word begins. The difference between the two is the error we measure.';

function errorsOf(known, aligned) {
  const rows = known.map((k, i) => ({ i, word: k.text, knownStart: k.start, knownEnd: k.end, start: aligned[i].start, end: aligned[i].end, startError: r3(aligned[i].start - k.start), endError: r3(aligned[i].end - k.end), missing: !!aligned[i].missing }));
  const stat = (key) => {
    const e = rows.map((r) => r[key]), abs = e.map(Math.abs);
    return { within2Frames: rows.filter((r) => Math.abs(r[key]) <= TOL + 1e-9).length, share: r3(abs.filter((v) => v <= TOL + 1e-9).length / rows.length), meanAbsMs: Math.round(1000 * abs.reduce((s, v) => s + v, 0) / abs.length), medianAbsMs: Math.round(1000 * quantile(abs, 0.5)), p95AbsMs: Math.round(1000 * quantile(abs, 0.95)), maxAbsMs: Math.round(1000 * Math.max(...abs)), biasMs: Math.round(1000 * e.reduce((s, v) => s + v, 0) / e.length) };
  };
  return { words: rows.length, starts: stat('startError'), ends: stat('endError'), perWord: rows.map((r) => [r.word, r.knownStart, r.start, r.knownEnd, r.end]), worstStarts: [...rows].sort((a, b) => Math.abs(b.startError) - Math.abs(a.startError)).slice(0, 6) };
}

console.log('speech_status');
const status = await tool('speech_status', {});
write('speech-status.json', status);
check('transcription is available', status.transcription.available);
check('a voice engine is available', status.voice.available);

if (steps.includes('exact')) {
  console.log('exact-times take');
  const words = EXACT_SCRIPT.split(/\s+/);
  check(`the script has at least 40 words (${words.length})`, words.length >= 40);
  const kokoro = kokoroAdapter({ dir: process.env.STUDIO_KOKORO_DIR, work: join(process.env.STUDIO_DATA, 'speech', 'tmp'), timeout: 900000 });
  mkdirSync(join(process.env.STUDIO_DATA, 'speech', 'takes'), { recursive: true });
  const wav = join(process.env.STUDIO_DATA, 'speech', 'takes', 'exact-times.wav');
  const gap = 0.2;
  const take = await kokoro.synthesize({ text: EXACT_SCRIPT, voice: 'af_heart', speed: 1, out: wav, exactTimes: true, gap });
  console.log(`  take: ${take.words.length} words, ${take.words.at(-1).end} s, made in ${take.seconds} s`);
  const report = { script: EXACT_SCRIPT, voice: 'af_heart', engine: 'kokoro (kokoro-js, each word synthesised alone)', gapSeconds: gap, toleranceMs: Math.round(TOL * 1000), fps: FPS, note: 'The true times are those of the word-by-word take: each word alone, its silence trimmed at a threshold, fixed gaps between. The take has real pauses between words, which is what the studio moves word times onto, so this measures the pipeline (which sound belongs to which word, and where it starts) on a take with known times; it is not a measure of accuracy on continuous speech (see speech-clip-7-transcript.json for what the same step does there). perWord rows: [word, known start, found start, known end, found end].', take: { words: take.words.length, seconds: take.words.at(-1).end, synthesisSeconds: take.seconds }, aligners: {} };
  for (const model of ['primary', 'secondary']) {
    let t;
    try { t = await speech.transcribe({ path: wav, model, cache: false }); } catch (e) { if (model === 'secondary') continue; throw e; }
    const aligned = alignWords(EXACT_SCRIPT, t.words);
    const e = errorsOf(take.words, aligned.words);
    // what whisper's own token times give, without moving them onto the sound
    const rawAligned = alignWords(EXACT_SCRIPT, t.rawWords);
    const raw = errorsOf(take.words, rawAligned.words);
    report.aligners[t.model] = { model: t.model, role: model, transcribeSeconds: t.seconds, alignment: aligned.stats, ...e, whisperTokenTimes: { alignment: rawAligned.stats, starts: raw.starts, ends: raw.ends } };
    const line = (label, x) => console.log(`  ${t.model} ${label}: starts within 2 frames ${x.starts.within2Frames}/${x.words} (${Math.round(x.starts.share * 100)} %), ends ${x.ends.within2Frames}/${x.words} (${Math.round(x.ends.share * 100)} %), start median ${x.starts.medianAbsMs} ms, max ${x.starts.maxAbsMs} ms`);
    line('as whisper gives them', raw);
    line('on the sound (studio)', e);
    if (model === 'primary') {
      check(`${t.model}: at least 95 % of word starts within 2 frames (${Math.round(e.starts.share * 100)} %)`, e.starts.share >= 0.95);
      report.requirement = { startsShare: e.starts.share, required: 0.95, pass: e.starts.share >= 0.95 };
    }
  }
  write('speech-exact-times.json', report);
}

if (steps.includes('samples')) {
  console.log('voice_samples');
  const line = 'Every frame is a function of time.';
  const r = await tool('voice_samples', { line, count: 3 });
  write('speech-voice-samples.json', { ...r, note: 'The WAV files are in the data directory; this report keeps their names, durations and voices.' });
  check('three samples, three different voices', r.samples.length === 3 && new Set(r.samples.map((s) => s.voice)).size === 3);
  for (const s of r.samples) console.log(`  ${s.voice.padEnd(11)} ${s.language} ${s.gender} grade ${s.grade}  ${s.seconds} s`);
}

if (steps.includes('clip7')) {
  console.log('clip 7 take');
  const dir = join(ROOT, 'clips', 'clip-7-a-video-that-checks-itself');
  const script = readFileSync(join(dir, 'narration.txt'), 'utf8').trim();
  const m4a = join(ROOT, 'showcase', 'voice', 'clip-7-narration.m4a');
  const each = [];
  for (const model of ['primary', 'secondary']) {
    try { const t = await speech.transcribe({ path: m4a, model, cache: false }); each.push({ role: model, model: t.model, seconds: t.seconds, words: t.words.length, text: t.text }); } catch (e) { if (model === 'primary') throw e; }
  }
  const verdict = await tool('check_transcript', { script, path: m4a, transcribe: true });
  check(`the transcript check against clip 7's script passes (${verdict.counts.slips} slips, ${verdict.counts.drops} drops, ${verdict.counts.insertions} insertions, ${verdict.counts.disputed} disputed)`, verdict.ok);
  // the studio's run against the manual whisper.cpp run of iteration 3 (same model): word starts after alignment to the script
  const manual = alignWords(script, importWords(JSON.parse(readFileSync(join(ROOT, 'showcase', 'voice', 'clip-7-narration.whisper.json'), 'utf8'))).words).words;
  const run = await speech.transcribe({ path: m4a, model: 'primary', cache: false });
  const rawRun = alignWords(script, run.rawWords).words, refinedRun = alignWords(script, run.words).words;
  const stat = (a, b, key) => {
    const d = a.map((w, i) => Math.abs(w[key] - b[i][key])).sort((x, y) => x - y);
    return { medianMs: Math.round(1000 * d[d.length >> 1]), p95Ms: Math.round(1000 * d[Math.floor(d.length * 0.95)]), maxMs: Math.round(1000 * d.at(-1)), over1Frame: d.filter((v) => v > 1 / FPS).length, over2Frames: d.filter((v) => v > 2 / FPS).length };
  };
  // whisper's own times from the studio's run against the manual run of iteration 3 (the same model, the take as AAC)
  const sameRun = stat(manual, rawRun, 'start');
  // what moving the word times onto the sound's pauses changes in natural speech
  const shifts = { starts: stat(rawRun, refinedRun, 'start'), ends: stat(rawRun, refinedRun, 'end'), boundariesMoved: run.refined?.boundaries ?? 0, boundaries: run.refined?.of ?? 0 };
  console.log(`  whisper times on the m4a with DTW on, vs the iteration 3 run on the original WAV: ${manual.length} words, largest start difference ${sameRun.maxMs} ms (a different input: AAC decoded)`);
  console.log(`  moved onto pauses: ${shifts.boundariesMoved} of ${shifts.boundaries} boundaries; word starts shift by a median ${shifts.starts.medianMs} ms, p95 ${shifts.starts.p95Ms} ms, max ${shifts.starts.maxMs} ms`);
  write('speech-clip-7-transcript.json', {
    take: 'showcase/voice/clip-7-narration.m4a', script: 'clips/clip-7-a-video-that-checks-itself/narration.txt', models: each,
    transcriptCheck: { ok: verdict.ok, counts: verdict.counts, slips: verdict.slips, drops: verdict.drops, insertions: verdict.insertions, disputed: verdict.disputed, models: verdict.models, seconds: verdict.seconds },
    againstManualRun: { words: manual.length, ...sameRun, note: "not the same input: iteration 3 ran on the WAV, this is the committed AAC take", source: 'showcase/voice/clip-7-narration.whisper.json (iteration 3, whisper-cli small.en -ojf)' },
    movedOntoPauses: { note: 'Word times moved from whisper\'s token times onto the pauses of the sound (src/studio/speech/refine.js); shifts are the differences after alignment to the script.', ...shifts },
  });
}

if (steps.includes('natural')) {
  // Continuous speech has no word times to compare with, but Kokoro knows where each sentence lies in its file: the first
  // word of a sentence must start where the sound of the sentence starts, the last must end where it stops.
  console.log('natural speech: sentence edges');
  const script = readFileSync(join(ROOT, 'clips', 'clip-7-a-video-that-checks-itself', 'narration.txt'), 'utf8').trim();
  const kokoro = kokoroAdapter({ dir: process.env.STUDIO_KOKORO_DIR, work: join(process.env.STUDIO_DATA, 'speech', 'tmp'), timeout: 900000 });
  mkdirSync(join(process.env.STUDIO_DATA, 'speech', 'takes'), { recursive: true });
  const wav = join(process.env.STUDIO_DATA, 'speech', 'takes', 'natural.wav');
  const take = await kokoro.synthesize({ text: script, voice: 'af_heart', speed: 1, out: wav });
  const pcm = readWav(wav);
  const edges = [];
  let at = 0;
  for (const s of take.sentences) {
    const n = s.text.split(/\s+/).filter(Boolean).length;
    const span = soundSpan(pcm.samples.subarray(Math.round(s.start * pcm.sampleRate), Math.round(s.end * pcm.sampleRate)), pcm.sampleRate, { share: 0.03 });
    edges.push({ first: at, last: at + n - 1, start: s.start + span[0] / pcm.sampleRate, end: s.start + span[1] / pcm.sampleRate, text: s.text });
    at += n;
  }
  check(`the sentences hold all ${script.split(/\s+/).length} words (${at})`, at === script.split(/\s+/).length);
  const report = { script: 'clips/clip-7-a-video-that-checks-itself/narration.txt', voice: 'af_heart', sentences: edges.length, boundaries: edges.length * 2, toleranceMs: Math.round(TOL * 1000), note: 'Truth: Kokoro knows where each sentence lies in the file; the sound of the sentence starts and stops where its 5 ms RMS crosses 3 % of the loudest window. The first word of a sentence must start there and its last word end there. Inner words have no reference.', aligners: {} };
  for (const model of ['primary', 'secondary']) {
    let t;
    try { t = await speech.transcribe({ path: wav, model, cache: false }); } catch (e) { if (model === 'secondary') continue; throw e; }
    const score = (words) => {
      const a = alignWords(script, words).words;
      const errs = edges.flatMap((e) => [a[e.first].start - e.start, a[e.last].end - e.end]);
      const abs = errs.map(Math.abs).sort((x, y) => x - y);
      return { within2Frames: errs.filter((v) => Math.abs(v) <= TOL + 1e-9).length, of: errs.length, share: r3(errs.filter((v) => Math.abs(v) <= TOL + 1e-9).length / errs.length), medianAbsMs: Math.round(1000 * abs[abs.length >> 1]), p95AbsMs: Math.round(1000 * abs[Math.floor(abs.length * 0.95)]), maxAbsMs: Math.round(1000 * abs.at(-1)), biasMs: Math.round(1000 * errs.reduce((s, v) => s + v, 0) / errs.length) };
    };
    const raw = score(t.rawWords), refined = score(t.words);
    report.aligners[t.model] = { whisperTokenTimes: raw, onTheSound: refined };
    console.log(`  ${t.model}: sentence edges within 2 frames: whisper ${raw.within2Frames}/${raw.of} (median ${raw.medianAbsMs} ms, max ${raw.maxAbsMs} ms), studio ${refined.within2Frames}/${refined.of} (median ${refined.medianAbsMs} ms, max ${refined.maxAbsMs} ms)`);
    if (model === 'primary') check('the studio\'s sentence edges are at least as good as whisper\'s own times', refined.share >= raw.share);
  }
  write('speech-natural-speech.json', report);
}

if (steps.includes('generate')) {
  console.log('generate_narration');
  const script = 'The studio can read this line aloud, time every word, and check what it said against what was written.';
  const r = await tool('generate_narration', { script, voice: 'af_heart', name: 'speech-check-voice', title: 'Speech check voice' });
  console.log(`  ${r.added}: ${r.words} words, ${r.duration} s, timed by ${r.timedBy}, voice ${r.seconds.voice} s, transcription ${r.seconds.transcription} s`);
  check('every word matched the script', r.stats.matched === r.words && r.transcript.ok);
  write('speech-generate.json', { script, ...r });
}

await studio.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('\nall speech checks passed');
