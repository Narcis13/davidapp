// Speech inside the studio: what is configured and what is missing, transcription and alignment, voice samples, and
// generate_narration, through the stand-in engines (no Kokoro and no whisper needed), a stand-in Kokoro script that
// tests the real adapter's process handling and the word-by-word take, the ElevenLabs adapter against a stubbed
// fetch, the errors, and the MCP tools over stdio.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, callTool } from '../scripts/mcp.mjs';
import { createTools } from '../src/mcp/tools.js';
import { parseDotenv } from '../src/studio/speech/config.js';
import { readWav, wavBytes } from '../src/studio/speech/wav.js';
import { tempStudio, AUTHOR } from './helpers.js';

const STUB = { PATH: '', STUDIO_SPEECH_STUB: '1' };
const SCRIPT = 'Every frame is a function of time.';

let env, studio, speech, scratch;
before(() => {
  env = tempStudio();
  studio = env.studio;
  speech = studio.speech;
  scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'speech-test-'));
});
after(async () => {
  await env.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

/** A Kokoro stand-in: `node say.mjs` that lists voices, and writes a tone per line with 50 ms of silence around it. */
const FAKE_SAY = `
import { readFileSync, writeFileSync } from 'node:fs';
const a = process.argv.slice(2);
const opt = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
if (opt.list) { console.log('af_heart     en-us  Female  grade A\\nbm_george    en-gb  Male    grade C\\nam_adam      en-us  Male    grade F+'); process.exit(0); }
const text = readFileSync(opt['text-file'], 'utf8').trim();
if (text === 'SLEEP') await new Promise((r) => setTimeout(r, 20000));
if (text === 'CRASH') { console.error('model exploded'); process.exit(3); }
const SR = 24000, lines = text.split('\\n');
const chunks = [], sentences = [];
let t = 0;
for (const line of lines) {
  const n = Math.round(0.4 * SR), pcm = new Float32Array(n);
  for (let i = Math.round(0.05 * SR); i < n - Math.round(0.05 * SR); i++) pcm[i] = 0.3 * Math.sin(2 * Math.PI * 200 * i / SR);
  sentences.push({ text: line, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.4) * 1000) / 1000 });
  chunks.push(pcm, new Float32Array(Math.round(0.18 * SR)));
  t += 0.4 + 0.18;
}
chunks.pop();
const total = chunks.reduce((n, c) => n + c.length, 0);
const wav = Buffer.alloc(44 + total * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(total * 2, 40);
let o = 44;
for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) wav.writeInt16LE(Math.round(c[i] * 32767), o);
writeFileSync(opt.out, wav);
if (opt.timings) writeFileSync(opt.timings, JSON.stringify({ sentences }));
console.log('wrote ' + opt.out);
`;

function fakeKokoro() {
  const dir = join(scratch, `kokoro-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, 'tts', 'node_modules', 'kokoro-js'), { recursive: true });
  writeFileSync(join(dir, 'tts', 'say.mjs'), FAKE_SAY);
  return dir;
}

test('with nothing configured, every missing piece says what to set', () => {
  speech.configure({ env: { PATH: '' } });
  const s = speech.status();
  assert.equal(s.transcription.available, false);
  assert.deepEqual(s.transcription.missing.map((m) => m.set), ['STUDIO_WHISPER_CLI', 'STUDIO_WHISPER_MODEL']);
  for (const m of [...s.transcription.missing, ...s.voice.missing]) assert.ok(m.how.length > 30 && m.set, `${m.piece} explains itself`);
  assert.match(s.transcription.missing[0].how, /whisper-cli/);
  assert.equal(s.voice.engine, 'none');
  assert.equal(s.voice.available, false);
  assert.match(s.voice.missing[0].how, /STUDIO_KOKORO_DIR[\s\S]*ELEVENLABS_API_KEY/);
  assert.match(s.note, /add_narration with timings/);
  assert.deepEqual(s.config.set, []);
});

test('the .env file supplies the keys, the environment wins, and the key is never reported', () => {
  assert.deepEqual(parseDotenv('# a comment\nSTUDIO_TTS=kokoro\nexport STUDIO_KOKORO_DIR="C:/voice dir" # where\nELEVENLABS_API_KEY=\'sk-secret\'\nOTHER=1\n'),
    { STUDIO_TTS: 'kokoro', STUDIO_KOKORO_DIR: 'C:/voice dir', ELEVENLABS_API_KEY: 'sk-secret' });
  const file = join(scratch, '.env');
  writeFileSync(file, 'STUDIO_TTS=elevenlabs\nELEVENLABS_API_KEY=sk-secret-key\nSTUDIO_WHISPER_MODEL=C:/nowhere/model.bin\n');
  speech.configure({ env: { PATH: '', STUDIO_WHISPER_MODEL: 'C:/other/model.bin' }, dotenv: file });
  const s = speech.status();
  assert.equal(s.voice.engine, 'elevenlabs');
  assert.equal(s.voice.available, true);
  assert.deepEqual(s.config.set.sort(), ['ELEVENLABS_API_KEY', 'STUDIO_TTS', 'STUDIO_WHISPER_MODEL']);
  assert.equal(s.config.dotenv, file);
  assert.equal(s.transcription.models[0].path, 'C:/other/model.bin');
  assert.ok(!JSON.stringify(s).includes('sk-secret'), 'the key is not in the status');
});

test('whisper-cli is found on PATH, and no other path is guessed', () => {
  const bin = join(scratch, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'), 'not really');
  speech.configure({ env: { PATH: bin } });
  const s = speech.status();
  assert.equal(s.transcription.cli.source, 'PATH');
  assert.equal(s.transcription.cli.found, true);
  assert.deepEqual(s.transcription.missing.map((m) => m.set), ['STUDIO_WHISPER_MODEL']);
  speech.configure({ env: { PATH: '' } });
  assert.equal(speech.status().transcription.cli, null);
});

test('transcription errors say what is wrong: no tool, a missing binary, a missing model, bad audio', async () => {
  const audioFile = join(scratch, 'x.wav');
  writeFileSync(audioFile, wavBytes(new Float32Array(2400), 24000));
  speech.configure({ env: { PATH: '' } });
  await assert.rejects(speech.transcribe({ path: audioFile }), /Transcription is not set up[\s\S]*STUDIO_WHISPER_CLI[\s\S]*STUDIO_WHISPER_MODEL/);
  speech.configure({ env: { PATH: '', STUDIO_WHISPER_CLI: join(scratch, 'nope.exe'), STUDIO_WHISPER_MODEL: join(scratch, 'nope.bin') } });
  await assert.rejects(speech.transcribe({ path: audioFile }), /nope\.exe is not a file/);
  // a binary and a model that exist (any file will do: the audio is refused before whisper would start)
  speech.configure({ env: { PATH: '', STUDIO_WHISPER_CLI: process.execPath, STUDIO_WHISPER_MODEL: audioFile } });
  const bad = join(scratch, 'bad.wav');
  writeFileSync(bad, 'this is text, not audio');
  await assert.rejects(speech.transcribe({ path: bad }), /Could not read .*bad\.wav as audio/);
  await assert.rejects(speech.transcribe({ path: join(scratch, 'missing.wav') }), /Audio file not found/);
  await assert.rejects(speech.transcribe({}), /Give ref .* or path/);
  await assert.rejects(speech.transcribe({ path: audioFile, model: 'secondary' }), /no second model/);
  const english = join(scratch, 'ggml-small.en.bin');
  writeFileSync(english, 'model');
  speech.configure({ env: { PATH: '', STUDIO_WHISPER_CLI: process.execPath, STUDIO_WHISPER_MODEL: english } });
  await assert.rejects(speech.transcribe({ path: audioFile, language: 'ro' }), /ggml-small\.en\.bin is an English-only model/);
});

test('voice samples: that many takes of one line in different voices, saved with their durations', async () => {
  speech.configure({ env: STUB });
  const r = await speech.voiceSamples({ line: 'Every frame is a function of time.' });
  assert.equal(r.engine, 'stub');
  assert.equal(r.samples.length, 3);
  assert.equal(new Set(r.samples.map((s) => s.voice)).size, 3, 'three different voices');
  assert.ok(new Set(r.samples.map((s) => `${s.language}|${s.gender}`)).size >= 3, 'spread over language and gender');
  for (const s of r.samples) {
    assert.ok(existsSync(s.path) && s.path.includes(join('speech', 'samples')) && s.path.endsWith('.wav'));
    assert.ok(s.seconds > 1, `${s.voice} lasts ${s.seconds} s`);
  }
  assert.deepEqual(r.samples.map((s) => s.cached), [false, false, false]);
  assert.deepEqual((await speech.voiceSamples({ line: 'Every frame is a function of time.' })).samples.map((s) => s.cached), [true, true, true], 'a take already made is reused');
  const two = await speech.voiceSamples({ line: 'Hello there.', voices: ['stub-deep', 'stub-low'], speed: 1.5 });
  assert.deepEqual(two.samples.map((s) => s.voice), ['stub-deep', 'stub-low']);
  assert.equal((await speech.voiceSamples({ line: 'Hello there.', count: 5 })).samples.length, 5);
});

test('voice samples refuse an empty line, an unknown voice, a bad count and a missing engine', async () => {
  speech.configure({ env: STUB });
  await assert.rejects(speech.voiceSamples({ line: '   ' }), /line: the sentence to speak/);
  await assert.rejects(speech.voiceSamples({ line: 'x'.repeat(601) }), /at most 600 characters/);
  await assert.rejects(speech.voiceSamples({ line: 'Hello', voices: ['af_nope'] }), /Unknown voice "af_nope" for stub\. Voices: stub-low/);
  await assert.rejects(speech.voiceSamples({ line: 'Hello', count: 0 }), /count: a whole number/);
  await assert.rejects(speech.voiceSamples({ line: 'Hello', speed: 9 }), /speed: a number between/);
  speech.configure({ env: { PATH: '' } });
  await assert.rejects(speech.voiceSamples({ line: 'Hello' }), /No voice engine is ready[\s\S]*STUDIO_KOKORO_DIR/);
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'festival' } });
  await assert.rejects(speech.voices(), /STUDIO_TTS is "festival"; use kokoro, elevenlabs or none/);
});

test('transcribe gives the words of a take with their times, and refuses audio it does not know', async () => {
  speech.configure({ env: STUB });
  const [take] = (await speech.voiceSamples({ line: SCRIPT, voices: ['stub-mid'] })).samples;
  const t = await speech.transcribe({ path: take.path });
  assert.equal(t.text, SCRIPT);
  assert.deepEqual(t.words.map((w) => w.text), SCRIPT.split(' '));
  assert.equal(t.words[0].start, 0.2);
  assert.ok(t.words.every((w, i) => w.end > w.start && (i === 0 || w.start > t.words[i - 1].end)));
  assert.equal((await speech.transcribe({ path: take.path, model: 'secondary' })).model, 'stub-base');
  const other = join(scratch, 'other.wav');
  writeFileSync(other, wavBytes(new Float32Array(24000), 24000));
  await assert.rejects(speech.transcribe({ path: other }), /only knows audio made by the stub voice/);
  await assert.rejects(speech.transcribe({ ref: 'no-such-sound' }), /no-such-sound|not found/i);
});

test('generate_narration with a voice that gives no word times: transcribed, aligned, checked', async () => {
  speech.configure({ env: STUB });
  const r = await speech.generateNarration({ script: SCRIPT, voice: 'stub-low', speed: 1, name: 'gen-voice', title: 'Generated voice', forClip: undefined, author: AUTHOR });
  assert.equal(r.asset.ref, 'gen-voice@1');
  assert.equal(r.asset.type, 'sound');
  assert.equal(r.words, 7);
  assert.deepEqual(r.stats, { matched: 7, substituted: 0, missing: 0, extra: 0 });
  assert.equal(r.transcript.ok, true);
  assert.equal(r.transcript.from, 'transcripts', 'both stub models are the independent transcripts');
  assert.equal(r.timedBy, 'stub-small');
  const meta = JSON.parse(studio.library.versionRow('gen-voice').meta);
  assert.equal(meta.narration.script, SCRIPT);
  assert.deepEqual(meta.narration.words.map((w) => w.text), SCRIPT.split(' '));
  assert.equal(meta.narration.words[0].start, 0.2);
  assert.equal(meta.narration.voice.voice, 'stub-low');
  assert.ok(meta.narration.words.every((w, i) => w.i === i && w.end > w.start));
  assert.match(JSON.parse(studio.library.versionRow('gen-voice').meta).license, /Test stand-in/);
  assert.deepEqual(r.seconds && Object.keys(r.seconds).sort(), ['transcription', 'voice']);
  // a generated take is AI-generated and made by its voice; what the caller says about it wins
  assert.equal(meta.provenance.aiGenerated, true);
  assert.match(meta.provenance.creator, /stub-low/);
  const said = await speech.generateNarration({ script: SCRIPT, voice: 'stub-low', name: 'gen-said', provenance: { license: 'Apache-2.0', credit: 'Voice: a stand-in', redistributable: true }, author: AUTHOR });
  const p = JSON.parse(studio.library.versionRow(said.asset.ref).meta).provenance;
  assert.deepEqual([p.license, p.credit, p.redistributable, p.aiGenerated], ['Apache-2.0', 'Voice: a stand-in', true, true]);
});

test('generate_narration with a voice that times its own words uses those times; a new take is a new version', async () => {
  speech.configure({ env: STUB });
  const a = await speech.generateNarration({ script: SCRIPT, voice: 'stub-timed', name: 'gen-timed', author: AUTHOR });
  assert.equal(a.timedBy, 'stub');
  const words = JSON.parse(studio.library.versionRow('gen-timed').meta).narration.words;
  assert.equal(words[1].text, 'frame');
  const b = await speech.generateNarration({ script: SCRIPT, voice: 'stub-timed', speed: 1.25, name: 'gen-timed', author: AUTHOR });
  assert.equal(b.asset.ref, 'gen-timed@2', 'the same name again is a new take');
  const faster = JSON.parse(studio.library.versionRow('gen-timed').meta).narration.words;
  assert.ok(faster.at(-1).end < words.at(-1).end, 'the faster take is shorter');
  assert.deepEqual(faster.map((w) => w.i), words.map((w) => w.i), 'the same word ids');
  const noCheck = await speech.generateNarration({ script: 'Short line here.', voice: 'stub-mid', name: 'gen-nocheck', check: false, author: AUTHOR });
  assert.equal(noCheck.transcript.from, 'timings');
});

test('generate_narration refuses bad input before it spends any time', async () => {
  speech.configure({ env: STUB });
  const base = { script: SCRIPT, voice: 'stub-mid', name: 'gen-bad', author: AUTHOR };
  await assert.rejects(speech.generateNarration({ ...base, name: 'Bad Name' }), /not a valid asset name/);
  await assert.rejects(speech.generateNarration({ ...base, script: '  ' }), /script: the text to speak/);
  await assert.rejects(speech.generateNarration({ ...base, script: 'x '.repeat(20000) }), /at most 30000 characters/);
  await assert.rejects(speech.generateNarration({ ...base, voice: 'nobody' }), /Unknown voice "nobody" for stub/);
  await assert.rejects(speech.generateNarration({ ...base, voice: '' }), /voice: a voice id/);
  await assert.rejects(speech.generateNarration({ ...base, speed: 5 }), /speed: a number between/);
  speech.configure({ env: { PATH: '' } });
  await assert.rejects(speech.generateNarration(base), /No voice engine is ready/);
  assert.equal(studio.library.versionRow('gen-bad'), undefined);
});

test('a voice without word times and no transcriber says what is missing, before the voice is made', async () => {
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'kokoro', STUDIO_KOKORO_DIR: fakeKokoro() } });
  await assert.rejects(speech.generateNarration({ script: SCRIPT, voice: 'af_heart', name: 'gen-notrans', author: AUTHOR }), /gives no word times[\s\S]*STUDIO_WHISPER_CLI/);
});

test('add_narration with align times a recording by transcribing it; without timings or align it asks for them', async () => {
  speech.configure({ env: STUB });
  const { call } = createTools(studio);
  const [take] = (await speech.voiceSamples({ line: 'Align this take now please.', voices: ['stub-high'] })).samples;
  const r = await call('add_narration', { name: 'aligned-take', path: take.path, script: 'Align this take now please.', align: true, author: AUTHOR });
  assert.ok(!r.isError, r.content[0].text);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.added, 'aligned-take@1');
  assert.equal(out.words, 5);
  assert.deepEqual(out.aligned.models, ['stub-small', 'stub-base']);
  assert.equal(out.transcript.ok, true);
  const words = JSON.parse(studio.library.versionRow('aligned-take').meta).narration.words;
  assert.equal(words[0].start, 0.2);
  // the extension of bytes sent inline names a temp file: anything but a short suffix is refused before a byte is written
  const data = (await import('node:fs')).readFileSync(take.path).toString('base64');
  for (const ext of ['/../../../escape.txt', '.wav/../../x', '..']) {
    const bad = await call('add_narration', { name: 'aligned-ext', data_base64: data, ext, script: 'Align this take now please.', align: true, author: AUTHOR });
    assert.equal(bad.isError, true, ext);
    assert.match(bad.content[0].text, /extension/, ext);
    await assert.rejects(speech.timingsFor({ data: Buffer.from(data, 'base64'), ext }), /ext must be a file extension/);
  }
  const none = await call('add_narration', { name: 'aligned-none', path: take.path, script: 'Align this take now please.', author: AUTHOR });
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /align: true/);
  // no transcriber: a clear error, and timings still work as before
  speech.configure({ env: { PATH: '' } });
  const missing = await call('add_narration', { name: 'aligned-none', path: take.path, script: 'Align this take now please.', align: true, author: AUTHOR });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Transcription is not set up[\s\S]*STUDIO_WHISPER_CLI/);
  const timed = await call('add_narration', { name: 'aligned-given', path: take.path, script: 'Align this take now please.', timings: [{ text: 'Align', start: 0.2, end: 0.5 }, { text: 'this', start: 0.6, end: 0.8 }, { text: 'take', start: 0.9, end: 1.1 }, { text: 'now', start: 1.2, end: 1.4 }, { text: 'please.', start: 1.5, end: 1.9 }], author: AUTHOR });
  assert.ok(!timed.isError, timed.content[0].text);
});

test('check_transcript with transcribe makes the transcripts itself and finds a changed word', async () => {
  speech.configure({ env: STUB });
  const { call } = createTools(studio);
  const ok = await call('check_transcript', { narration: 'gen-voice', transcribe: true });
  assert.ok(!ok.isError, ok.content[0].text);
  const good = JSON.parse(ok.content[0].text);
  assert.equal(good.ok, true);
  assert.deepEqual(good.models, ['stub-small', 'stub-base']);
  assert.equal(good.counts.transcripts, 2);
  const wrong = JSON.parse((await call('check_transcript', { narration: 'gen-voice', script: 'Every frame is a function of space.', transcribe: true })).content[0].text);
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.slips.map((s) => [s.script, s.heard]), [['space.', 'time.']]);
  const noAudio = await call('check_transcript', { script: SCRIPT, transcribe: true });
  assert.equal(noAudio.isError, true);
  assert.match(noAudio.content[0].text, /needs the audio/);
});

test('the Kokoro adapter runs the script as a child process, lists voices, and fails clearly', async () => {
  const dir = fakeKokoro();
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'kokoro', STUDIO_KOKORO_DIR: dir } });
  const v = await speech.voices();
  assert.equal(v.engine, 'kokoro');
  assert.deepEqual(v.voices.map((x) => [x.id, x.language, x.gender, x.grade]), [['af_heart', 'en-us', 'female', 'A'], ['bm_george', 'en-gb', 'male', 'C'], ['am_adam', 'en-us', 'male', 'F+']]);
  const r = await speech.voiceSamples({ line: 'One line.' });
  assert.deepEqual(r.samples.map((s) => s.voice), ['af_heart', 'bm_george', 'am_adam'], 'best grade first, spread over language and gender');
  assert.ok(r.samples.every((s) => existsSync(s.path) && s.seconds > 0.3));
  await assert.rejects(speech.voiceSamples({ line: 'One line.', voices: ['af_nope'] }), /Unknown voice "af_nope" for kokoro\. Voices: af_heart, bm_george, am_adam/);
  await assert.rejects(speech.voiceSamples({ line: 'CRASH' }), /Kokoro \(af_heart\) failed \(exit code 3\): model exploded/);
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'kokoro', STUDIO_KOKORO_DIR: dir }, timeout: 700 });
  await assert.rejects(speech.voiceSamples({ line: 'SLEEP' }), /did not finish within 1 s and was stopped/);
  // status: a folder without the script, then without kokoro-js
  const bare = join(scratch, 'bare');
  mkdirSync(bare, { recursive: true });
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'kokoro', STUDIO_KOKORO_DIR: bare } });
  assert.match(speech.status().voice.missing[0].how, /say\.mjs was not found/);
  await assert.rejects(speech.voiceSamples({ line: 'Hello' }), /No voice engine is ready[\s\S]*say\.mjs/);
  mkdirSync(join(bare, 'tts'), { recursive: true });
  writeFileSync(join(bare, 'tts', 'say.mjs'), '');
  assert.match(speech.status().voice.missing[0].how, /kokoro-js is not installed/);
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'kokoro' } });
  assert.match(speech.status().voice.missing[0].how, /STUDIO_KOKORO_DIR/);
});

test('exactTimes: each word is spoken alone, trimmed, and placed with a fixed gap, so its time is known', async () => {
  const { kokoroAdapter } = await import('../src/studio/speech/kokoro.js');
  const dir = fakeKokoro();
  const k = kokoroAdapter({ dir, work: join(scratch, 'work') });
  const out = join(scratch, 'exact.wav');
  const script = 'Alpha, beta -- gamma! delta (epsilon) zeta';
  const r = await k.synthesize({ text: script, voice: 'af_heart', out, exactTimes: true, gap: 0.2 });
  assert.deepEqual(r.words.map((w) => w.text), ['Alpha,', 'beta', 'gamma!', 'delta', '(epsilon)', 'zeta'], 'words as written; a lone dash is not a word');
  assert.equal(r.words[0].start, 0.3);
  for (const [i, w] of r.words.entries()) {
    assert.ok(Math.abs(w.end - w.start - 0.3) < 0.012, `word ${i} lasts ${(w.end - w.start).toFixed(3)} s: its 50 ms of silence either side is trimmed`);
    if (i) assert.ok(Math.abs(w.start - r.words[i - 1].end - 0.2) < 0.0015, 'a fixed gap');
  }
  // the sound really is where the times say
  const { samples, sampleRate } = readWav(out);
  const rms = (a, b) => Math.sqrt(samples.slice(Math.round(a * sampleRate), Math.round(b * sampleRate)).reduce((s, x) => s + x * x, 0) / Math.max(1, Math.round((b - a) * sampleRate)));
  for (const w of r.words) {
    assert.ok(rms(w.start + 0.02, w.end - 0.02) > 0.15, 'sound inside the word');
    assert.ok(rms(w.start - 0.15, w.start - 0.01) < 0.01, 'silence before it');
    assert.ok(rms(w.end + 0.01, w.end + 0.15) < 0.01, 'silence after it');
  }
  assert.ok(samples.length / sampleRate > r.words.at(-1).end + 0.25);
});

test('an exact take refuses a word whose take is silent', async () => {
  const { exactTake } = await import('../src/studio/speech/kokoro.js');
  assert.throws(() => exactTake({ samples: new Float32Array(24000), sampleRate: 24000 }, [{ start: 0, end: 0.5 }], ['quiet']), /silent/);
});

/** A fetch stand-in for ElevenLabs: records the calls, answers like the service. */
function elevenFetch({ status = 200, fail = false } = {}) {
  const calls = [];
  const text = 'Hello brave world';
  const pcm = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 24000)), i * 2);
  const characters = [...text];
  const starts = characters.map((_, i) => 0.1 + i * 0.05), ends = starts.map((s) => s + 0.05);
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (fail) throw new TypeError('fetch failed');
    if (status !== 200) return { ok: false, status, json: async () => ({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }) };
    if (String(url).endsWith('/v1/voices')) return { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: 'v-rachel', name: 'Rachel', labels: { gender: 'female', accent: 'american' } }, { voice_id: 'v-adam', name: 'Adam', labels: { gender: 'male', language: 'en' } }] }) };
    return { ok: true, status: 200, json: async () => ({ audio_base64: pcm.toString('base64'), alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: ends }, normalized_alignment: null }) };
  };
  return { fn, calls, text, starts, ends };
}

test('the ElevenLabs adapter against a stubbed fetch: voices, the request, its alignment imported, and the errors', async () => {
  const f = elevenFetch();
  const cfg = { env: { PATH: '', ELEVENLABS_API_KEY: 'sk-test-key' }, fetch: f.fn };
  speech.configure(cfg);
  assert.equal(speech.status().voice.engine, 'elevenlabs');
  assert.deepEqual((await speech.voices()).voices.map((v) => [v.id, v.label, v.gender]), [['v-rachel', 'Rachel', 'female'], ['v-adam', 'Adam', 'male']]);
  assert.equal(f.calls[0].url, 'https://api.elevenlabs.io/v1/voices');
  assert.equal(f.calls[0].init.headers['xi-api-key'], 'sk-test-key');
  // no transcriber is configured, and none is needed: the service times the words
  const r = await speech.generateNarration({ script: f.text, voice: 'v-rachel', speed: 1.1, name: 'gen-eleven', title: 'Eleven', author: AUTHOR });
  const call = f.calls.find((c) => c.url.includes('with-timestamps'));
  assert.match(call.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/v-rachel\/with-timestamps\?output_format=pcm_24000$/);
  assert.equal(call.init.method, 'POST');
  const body = JSON.parse(call.init.body);
  assert.equal(body.text, f.text);
  assert.equal(body.voice_settings.speed, 1.1);
  assert.equal(r.timedBy, 'elevenlabs');
  assert.equal(r.transcript.from, 'timings');
  const words = JSON.parse(studio.library.versionRow('gen-eleven').meta).narration.words;
  assert.deepEqual(words.map((w) => w.text), ['Hello', 'brave', 'world']);
  // the word starts at its first character and ends with its last
  assert.deepEqual(words.map((w) => [w.start, w.end]), [[0.1, 0.35], [0.4, 0.65], [0.7, 0.95]].map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]));
  assert.equal(JSON.parse(studio.library.versionRow('gen-eleven').meta).narration.voice.engine, 'elevenlabs');
  assert.equal(JSON.stringify(JSON.parse(studio.library.versionRow('gen-eleven').meta)).includes('sk-test-key'), false);
  // speed outside ElevenLabs' range, a refused key, a network failure
  await assert.rejects(speech.generateNarration({ script: f.text, voice: 'v-rachel', speed: 1.5, name: 'gen-eleven2', author: AUTHOR }), /between 0\.7 and 1\.2/);
  speech.configure({ ...cfg, fetch: elevenFetch({ status: 401 }).fn });
  await assert.rejects(speech.voiceSamples({ line: 'Hello' }), (/** @type {Error} */ e) => /ElevenLabs answered 401 \(check ELEVENLABS_API_KEY\): Invalid API key/.test(e.message) && !e.message.includes('sk-test-key'));
  speech.configure({ ...cfg, fetch: elevenFetch({ fail: true }).fn });
  await assert.rejects(speech.voices(), /Could not reach ElevenLabs: fetch failed/);
  // without a key the engine is not offered
  speech.configure({ env: { PATH: '', STUDIO_TTS: 'elevenlabs' } });
  assert.match(speech.status().voice.missing[0].how, /ELEVENLABS_API_KEY/);
});

test('the speech tools over MCP stdio: status, samples, generate, align, check', async () => {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-speech-mcp-'));
  process.env.STUDIO_SPEECH_STUB = '1';
  const client = await connect({ dataDir, author: 'speech-test' });
  delete process.env.STUDIO_SPEECH_STUB;
  const call = (name, args) => callTool(client, name, args);
  try {
    const { tools } = await client.listTools();
    for (const n of ['speech_status', 'transcribe', 'voice_samples', 'generate_narration', 'add_narration', 'check_transcript']) assert.ok(tools.some((t) => t.name === n), `missing tool ${n}`);
    assert.ok(tools.find((t) => t.name === 'add_narration').inputSchema.properties.align);
    assert.ok(tools.find((t) => t.name === 'check_transcript').inputSchema.properties.transcribe);

    const status = await call('speech_status');
    assert.ok(!status.isError, status.text);
    assert.equal(status.json.voice.engine, 'stub');
    assert.equal(status.json.transcription.available, true);

    const samples = await call('voice_samples', { line: 'Every frame is a function of time.' });
    assert.ok(!samples.isError, samples.text);
    assert.equal(samples.json.samples.length, 3);
    assert.ok(samples.json.samples.every((s) => existsSync(s.path) && s.path.includes('samples')));
    const bad = await call('voice_samples', { line: 'Hello', voices: ['nobody'] });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Unknown voice "nobody"/);
    assert.equal((await call('voice_samples', { line: '' })).isError, true);

    const gen = await call('generate_narration', { script: SCRIPT, voice: 'stub-mid', name: 'mcp-voice', title: 'MCP voice' });
    assert.ok(!gen.isError, gen.text);
    assert.equal(gen.json.added, 'mcp-voice@1');
    assert.equal(gen.json.words, 7);
    assert.equal(gen.json.transcript.ok, true);
    assert.deepEqual(gen.json.models, ['stub-small', 'stub-base']);
    const asset = await call('get_asset', { ref: 'mcp-voice' });
    assert.equal(asset.json.type, 'sound');
    assert.ok(asset.json.tags.includes('narration'));

    const tr = await call('transcribe', { ref: 'mcp-voice' });
    assert.ok(!tr.isError, tr.text);
    assert.equal(tr.json.text, SCRIPT);
    assert.equal(tr.json.words.length, 7);

    const aligned = await call('add_narration', { name: 'mcp-aligned', path: samples.json.samples[0].path, script: 'Every frame is a function of time.', align: true });
    assert.ok(!aligned.isError, aligned.text);
    assert.equal(aligned.json.words, 7);
    const check = await call('check_transcript', { narration: 'mcp-voice', transcribe: true });
    assert.equal(check.json.ok, true);
    const unknown = await call('generate_narration', { script: SCRIPT, voice: 'nobody', name: 'mcp-never' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /Unknown voice/);
    assert.equal((await call('get_asset', { ref: 'mcp-never' })).isError, true);
  } finally {
    await client.close();
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
  }
});

test('GET /api/speech answers with the status', async () => {
  const { createStudioServer } = await import('../src/server/http.js');
  speech.configure({ env: { PATH: '', ELEVENLABS_API_KEY: 'sk-http-secret' }, fetch: elevenFetch().fn });
  const server = /** @type {any} */ (createStudioServer(studio));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const s = await (await fetch(`${base}/api/speech`)).json();
    assert.equal(s.voice.engine, 'elevenlabs');
    assert.equal(s.transcription.available, false);
    assert.ok(!JSON.stringify(s).includes('sk-http-secret'));
    const v = await (await fetch(`${base}/api/speech/voices`)).json();
    assert.deepEqual(v.voices.map((x) => x.id), ['v-rachel', 'v-adam']);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('word times are moved onto the pauses between words, and left alone where speech is continuous', async () => {
  const { refineWords } = await import('../src/studio/speech/refine.js');
  const SR = 16000;
  const samples = new Float32Array(2.2 * SR);
  for (const [a, b] of [[0.3, 0.7], [0.8, 1.2], [1.2, 1.6]]) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / SR);
  // whisper-like times: starts in the silence before the word, far off for the second
  const heard = [{ text: 'one', start: 0, end: 0.9 }, { text: 'two', start: 0.9, end: 1.3 }, { text: 'three', start: 1.3, end: 2.1 }];
  const { words, moved } = refineWords(heard, [0.65, 1.15, 1.55], samples, SR);
  assert.equal(moved, 3, 'before one, between one and two, after three');
  const near = (a, b) => Math.abs(a - b) <= 0.011;
  assert.ok(near(words[0].start, 0.3) && near(words[0].end, 0.7), JSON.stringify(words[0]));
  assert.ok(near(words[1].start, 0.8), 'the pause before two');
  assert.equal(words[1].end, 1.3, 'two runs into three: whisper\'s own time stays');
  assert.equal(words[2].start, 1.3);
  assert.ok(near(words[2].end, 1.6), 'the end of the sound after three');
  // a word without an anchor keeps its times
  const none = refineWords(heard, [null, null, null], samples, SR);
  assert.deepEqual(none.words, heard);
  assert.equal(none.moved, 0);
});

test('whisper DTW anchors are read per word, and only for models with a DTW preset', async () => {
  const { wordAnchors, dtwPreset } = await import('../src/studio/speech/whisper.js');
  assert.equal(dtwPreset('C:/m/ggml-small.en.bin'), 'small.en');
  assert.equal(dtwPreset('ggml-base.bin'), 'base');
  assert.equal(dtwPreset('ggml-medium.en-q5_0.bin'), 'medium.en');
  assert.equal(dtwPreset('my-finetune.bin'), null);
  const tok = (text, from, to, dtw) => ({ text, offsets: { from, to }, t_dtw: dtw });
  const raw = { transcription: [{ offsets: { from: 0, to: 2000 }, text: ' Hi there, friend.', tokens: [tok('[_BEG_]', 0, 0, -1), tok(' Hi', 100, 300, 25), tok(' the', 300, 500, 40), tok('re', 500, 600, 52), tok(',', 600, 600, 90), tok(' friend', 700, 1000, 88), tok('.', 1000, 1000, 120)] }] };
  const heard = [{ text: 'Hi' }, { text: 'there,' }, { text: 'friend.' }];
  assert.deepEqual(wordAnchors(raw, heard), [0.25, 0.52, 0.88], 'the last token with a letter, not the comma');
  assert.equal(wordAnchors(raw, [{ text: 'Hi' }, { text: 'there,' }]), null, 'words that do not line up');
  assert.equal(wordAnchors({ transcription: [{ offsets: { from: 0, to: 10 }, text: ' Hi', tokens: [tok(' Hi', 0, 10, -1)] }] }, [{ text: 'Hi' }]), null, 'no DTW time');
});
