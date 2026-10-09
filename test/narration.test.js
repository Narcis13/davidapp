// Narration, words, anchors, captions and the mix, end to end through the studio: a voice with imported word
// timings, an asset that reads f.clip.words, items, keyframes and markers anchored to words (and still on them
// after a re-timed take), the caption pages and their exports, gain automation and ducking (the same samples in
// the preview and the render), a loudness target met on the encoded file, stems and the audio report.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { encodeWav } from '../src/render/wav.js';
import { ebur128 } from '../src/render/loudness.js';
import { parseSrt, parseVtt } from '../src/core/captions.js';
import { tempStudio, seedAssets, AUTHOR } from './helpers.js';

const SCRIPT = 'Fourteen frames make the point quickly.';
const TIMES = [[0.5, 0.9], [0.95, 1.3], [1.4, 1.6], [1.62, 1.7], [1.75, 2.1], [2.2, 2.8]];
const WORDS = ['Fourteen', 'frames', 'make', 'the', 'point', 'quickly.'];
const SR = 48000;

/** A stand-in voice: a buzzy tone during every word, silence between and after (written as a WAV). */
function voice(path, shift = 0, duration = 4) {
  const n = duration * SR, l = new Float32Array(n);
  for (const [a, b] of TIMES) for (let i = Math.round((a + shift) * SR); i < Math.round((b + shift) * SR) && i < n; i++) {
    const t = i / SR;
    l[i] = 0.25 * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 900 * t));
  }
  writeFileSync(path, encodeWav(l, l, SR));
}

/** whisper.cpp -ojf output for the words, shifted (tokens begin a word with a space; special tokens are skipped). */
const whisperJson = (shift) => ({
  transcription: [{
    offsets: { from: 0, to: 4000 }, text: ` ${SCRIPT}`,
    tokens: [{ text: '[_BEG_]', offsets: { from: 0, to: 0 } }, ...WORDS.map((w, i) => ({ text: ` ${w}`, offsets: { from: Math.round((TIMES[i][0] + shift) * 1000), to: Math.round((TIMES[i][1] + shift) * 1000) } })), { text: '[_TT_200]', offsets: { from: 4000, to: 4000 } }],
  }],
});

const LIT = `asset({
  description: 'Fills its box with white while a narration word is being spoken, for tests.',
  tags: ['test', 'narration'],
  render(f) {
    const on = (f.clip.words ?? []).some((w) => f.clip.t >= w.start && f.clip.t < w.end);
    if (on) { f.ctx.fillStyle = '#ffffff'; f.ctx.fillRect(0, 0, f.width, f.height); }
  },
});`;
const SQUARE = `asset({
  description: 'A red square filling its box, for anchor tests.',
  tags: ['test'],
  render(f) { f.ctx.fillStyle = '#ff0000'; f.ctx.fillRect(0, 0, f.width, f.height); },
});`;
const HUM = `asset({
  kind: 'audio',
  description: 'A steady hum at a fixed level, the music bed of the tests.',
  tags: ['audio', 'test'],
  params: { level: { type: 'number', default: 0.2, min: 0, max: 1 } },
  render(f, p) {
    const out = f.lib.audio.buffer(f.duration);
    for (let i = 0; i < out.length; i++) out[i] = p.level * Math.sin(2 * Math.PI * 110 * (i / f.sampleRate));
    return out;
  },
});`;

let env, studio, dir;
before(async () => {
  env = tempStudio();
  studio = env.studio;
  dir = env.dataDir;
  await seedAssets(studio);
  studio.renders.startRunner();
  for (const [slug, source] of [['lit', LIT], ['square', SQUARE], ['hum', HUM]]) await studio.library.createAsset({ slug, source, author: AUTHOR });
  // the captions asset eases with the real easing asset's curves
  await studio.library.updateAsset({ slug: 'easing', source: readFileSync(new URL('../assets/easing.js', import.meta.url), 'utf8'), author: AUTHOR });
  await studio.library.createAsset({ slug: 'text-captions', source: readFileSync(new URL('../assets/text-captions.v2.js', import.meta.url), 'utf8'), author: AUTHOR });
  voice(join(dir, 'take1.wav'));
  voice(join(dir, 'take2.wav'), 0.37);
});
after(() => env.cleanup());

const composition = (extra = {}) => ({
  width: 320, height: 180, fps: 30, duration: 4, background: '#000000',
  markers: [{ t: 0, type: 'word', label: 'quickly', anchor: { item: 'vo', word: 5 } }],
  captions: { maxChars: 20 },
  tracks: [
    { id: 'lights', type: 'visual', items: [{ id: 'lit', asset: 'lit', start: 0, duration: 4, transform: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }] },
    { id: 'hits', type: 'visual', items: [
      { id: 'hit', asset: 'square', start: 0, duration: 1, anchor: { item: 'vo', word: 4 }, transform: { x: 0.9, y: 0.1, width: 0.1, height: 0.1 } },
      { id: 'fade', asset: 'square', start: 0, duration: 4, transform: { x: 0.9, y: 0.5, width: 0.1, height: 0.1 }, keyframes: { opacity: [{ t: 0, v: 0 }, { t: 0, v: 1, anchor: { item: 'vo', word: 1 } }] } },
    ] },
    { id: 'caps', type: 'text', role: 'captions', items: [{ id: 'cap', asset: 'text-captions', start: 0, duration: 4 }] },
    { id: 'voice', type: 'audio', role: 'narration', items: [{ id: 'vo', asset: 'vo', start: 0, duration: 4 }] },
    { id: 'music', type: 'audio', role: 'music', items: [{ id: 'bed', asset: 'hum', start: 0, duration: 4, gain: 1, keyframes: { volume: [{ t: 0, v: -12 }, { t: 0.4, v: 0, ease: 'outCubic' }] }, duck: { by: 18, attack: 0.1, release: 0.3 } }] },
  ],
  ...extra,
});

test('a narration imports whisper.cpp word timings, aligned to its script; the transcript check runs', async () => {
  const r = await studio.audio.addNarration({ slug: 'vo', path: join(dir, 'take1.wav'), script: SCRIPT, timings: whisperJson(0), transcript: 'fourteen frames make the point quickly', author: AUTHOR, voice: { name: 'test tone', license: 'original' } });
  assert.equal(r.words, 6);
  assert.equal(r.source, 'whisper.cpp');
  assert.equal(r.transcript.ok, true);
  const row = studio.library.versionRow('vo');
  const words = JSON.parse(row.meta).narration.words;
  assert.deepEqual(words.map((w) => [w.text, w.start, w.end]), WORDS.map((w, i) => [w, ...TIMES[i]]));
  // a transcript with a slip, a drop and an insertion is named word by word
  const bad = await studio.audio.addNarration({ slug: 'vo-check', path: join(dir, 'take1.wav'), script: SCRIPT, timings: whisperJson(0), transcript: '14 frame make point really quickly', author: AUTHOR });
  assert.equal(bad.transcript.ok, false);
  assert.deepEqual(bad.transcript.slips.map((s) => s.i), [1]);
  assert.deepEqual(bad.transcript.drops.map((s) => s.i), [3]);
  assert.deepEqual(bad.transcript.insertions.map((s) => s.heard), ['really']);
  await assert.rejects(studio.audio.addNarration({ slug: 'vo-bad', path: join(dir, 'take1.wav'), script: SCRIPT, timings: { nonsense: true }, author: AUTHOR }), /timings:/);
});

test('words reach assets as f.clip.words; anchors land within 2 frames of their words, and stay after a re-timed take', async () => {
  const r = await studio.clips.createClip({ slug: 'voiced', author: AUTHOR, composition: composition() });
  const c = r.clip.composition;
  const at = (t) => studio.frameHashes({ clip: 'voiced', times: [t] }).then((x) => x[0].hash);
  // the "lit" asset shows during a word and not between words
  assert.notEqual(await at(0.7), await at(0.3));
  const report = studio.clips.anchorReport(c);
  assert.equal(report.length, 3);
  for (const x of report) assert.ok(Math.abs(x.deltaFrames) <= 2, `${x.kind} ${x.id} is ${x.deltaFrames} frames from its word`);
  assert.equal(c.tracks[1].items[0].start, 1.75);
  assert.equal(c.markers[0].t, 2.2);
  // a new take of the same script, 0.37 s later: re-pin the clip and everything follows its words
  await studio.audio.addNarration({ slug: 'vo', path: join(dir, 'take2.wav'), script: SCRIPT, timings: whisperJson(0.37), author: AUTHOR, take: 'slower start' });
  const moved = (await studio.clips.repinClip({ slug: 'voiced', only: ['vo'], author: AUTHOR })).clip.composition;
  assert.equal(moved.tracks.find((t) => t.id === 'voice').items[0].asset, 'vo@2');
  assert.equal(moved.tracks[1].items[0].start, 2.12);
  assert.equal(moved.markers[0].t, 2.57);
  for (const x of studio.clips.anchorReport(moved)) assert.ok(Math.abs(x.deltaFrames) <= 2, `after the new take, ${x.kind} ${x.id} is ${x.deltaFrames} frames off`);
  // anchors that point nowhere are refused with the reason
  await assert.rejects(studio.clips.editClip('voiced', [{ op: 'update_item', id: 'hit', patch: { anchor: { item: 'vo', word: 99 } } }]), /there is no word 99/);
  await assert.rejects(studio.clips.editClip('voiced', [{ op: 'update_item', id: 'hit', patch: { anchor: { item: 'lit', word: 1 } } }]), /not a narration/);
});

test('caption pages come from the words; the highlight follows the real word times; edits keep the words the source of times', async () => {
  const c = studio.clips.getClip('voiced').composition;
  const pages = studio.clips.captionPages(c);
  assert.ok(pages.pages.length >= 1);
  assert.deepEqual(pages.pages.flatMap((p) => p.lines.flat().map((w) => w.text)), WORDS);
  for (const p of pages.pages) {
    assert.ok(p.lines.length <= 2);
    for (const line of p.lines) assert.ok(line.map((w) => w.text).join(' ').length <= 20);
    const first = p.lines[0][0];
    assert.ok(p.start <= first.start + 1e-9 && p.start >= first.start - 2 / 30 - 1e-9, 'a page starts on its first word or up to 2 frames before');
  }
  // take 2: "point" is spoken from 2.12 to 2.47; at 2.3 it is the lit word, at 2.05 ("the") it is still dim
  const lit = async (t) => (await studio.inspect.layoutReport({ clip: 'voiced', t })).texts;
  const fills = async (t) => {
    const r = await studio.inspect.recordFrame(studio.clips.getClip('voiced').composition, Math.round(t * 30));
    return Object.fromEntries(r.texts.filter((x) => x.item === 'cap').map((x) => [x.text, x.fill]));
  };
  const f1 = await fills(2.3);
  assert.match(f1.point, /#ffd166/i);
  assert.doesNotMatch(f1.make ?? f1.frames ?? '#f4f1ea', /#ffd166/i);
  const f2 = await fills(2.05);
  assert.match(f2.the, /#ffd166/i);
  assert.doesNotMatch(f2.point, /#ffd166/i);
  assert.ok((await lit(2.3)).some((x) => x.item === 'cap'));
  // split the first page at "make": the structure is stored, the times still come from the words
  const r = await studio.clips.editClip('voiced', [{ op: 'caption_split', at: 'vo:2' }]);
  const after = studio.clips.captionPages(r.clip.composition);
  assert.ok(r.clip.composition.captions.pages.some((p) => p.start === 'vo:2'));
  const page = after.pages.find((p) => p.keys.start === 'vo:2');
  assert.ok(page && Math.abs(page.lines[0][0].start - (1.4 + 0.37)) < 1e-6);
  await assert.rejects(studio.clips.editClip('voiced', [{ op: 'caption_split', at: 'vo:42' }]), /caption_split/);
  await studio.clips.editClip('voiced', [{ op: 'caption_auto' }]);
});

test('the mix: gain keyframes and ducking are in the WAV the preview plays, which is the one the render encodes', async () => {
  const c = studio.clips.getClip('voiced').composition;
  const wav = await studio.clipAudio({ clip: 'voiced' });
  const { left } = await studio.audio.decode(wav);
  const rms = (a, b) => { let s = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += left[i] ** 2; return Math.sqrt(s / ((b - a) * SR)); };
  const music = await studio.audio.mix(c, { tracks: ['music'], master: false });
  const mrms = (a, b) => { let s = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += music.left[i] ** 2; return Math.sqrt(s / ((b - a) * SR)); };
  // the bed starts 12 dB down and rises; under the voice (take 2: 0.87–3.17 s) it sits 18 dB under its level after the voice
  assert.ok(mrms(0, 0.05) < mrms(0.42, 0.5) / 3, `the bed rises: ${mrms(0, 0.05)} → ${mrms(0.42, 0.5)}`);
  const ducked = mrms(1.6, 1.9), free = mrms(3.6, 3.95);
  assert.ok(Math.abs(20 * Math.log10(ducked / free) + 18) < 0.5, `ducked by ${(20 * Math.log10(ducked / free)).toFixed(2)} dB`);
  // ducking starts before the first word (attack) so the first syllable is never loud
  assert.ok(mrms(0.86, 0.87) < free * 0.2, `at the first word the bed is at ${mrms(0.86, 0.87)} (free ${free})`);
  assert.ok(rms(1.0, 1.2) > 0.05, `voice in the mix: ${rms(1.0, 1.2)}`);
  // the render encodes exactly this file
  const job = studio.renders.enqueue({ clip: 'voiced' });
  const done = await studio.renders.wait(job.id, 300000);
  assert.equal(done.status, 'done', done.error ?? '');
  const sha = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');
  assert.equal(done.stats.files.mix ? sha(join(dir, done.stats.files.mix)) : sha(wav), sha(wav));
  assert.equal(done.stats.mixSha1, sha(wav));
  assert.equal(done.stats.loudness.master.mode, 'safety');
  assert.ok(Number.isFinite(done.stats.loudness.measured.integrated));
  // subtitles and words: SRT and VTT parse back to the script; the words JSON has every word
  const srt = parseSrt(readFileSync(join(dir, done.srt), 'utf8')), vtt = parseVtt(readFileSync(join(dir, done.stats.files.vtt), 'utf8'));
  for (const cues of [srt, vtt]) assert.equal(cues.map((x) => x.text.replace(/\n/g, ' ')).join(' '), SCRIPT);
  assert.equal(JSON.parse(readFileSync(join(dir, done.stats.files.words), 'utf8')).words.length, 6);
  assert.ok(done.stats.files.report && done.stats.files.sheets.length >= 1);
});

test('captions burned in or file only: a captions track is not drawn when burnIn is false', async () => {
  const c = studio.clips.getClip('voiced').composition;
  const burned = await studio.frameHashes({ composition: c, times: [2.3] });
  const fileOnly = await studio.frameHashes({ composition: { ...c, captions: { ...c.captions, burnIn: false } }, times: [2.3] });
  const none = await studio.frameHashes({ composition: { ...c, tracks: c.tracks.filter((t) => t.id !== 'caps') }, times: [2.3] });
  assert.notEqual(burned[0].hash, fileOnly[0].hash);
  assert.equal(fileOnly[0].hash, none[0].hash);
});

test('a loudness target is met on the encoded file (FFmpeg ebur128), and a mix that needs the limiter says so', async () => {
  // a hot, spiky bed: one gain to −14 LUFS would push its peaks over −1 dBTP
  const spiky = `asset({
    kind: 'audio', description: 'A quiet hum with sharp clicks, for loudness tests.', tags: ['audio', 'test'],
    render(f) {
      const out = f.lib.audio.buffer(f.duration);
      for (let i = 0; i < out.length; i++) out[i] = 0.05 * Math.sin(2 * Math.PI * 220 * (i / f.sampleRate)) + (i % 12000 < 40 ? 0.9 : 0);
      return out;
    },
  });`;
  await studio.library.createAsset({ slug: 'spiky', source: spiky, author: AUTHOR });
  for (const [slug, music, limited] of [['loud-plain', 'hum', false], ['loud-limited', 'spiky', true]]) {
    await studio.clips.createClip({ slug, author: AUTHOR, composition: { width: 320, height: 180, fps: 30, duration: 4, loudness: true,
      tracks: [{ id: 'v', type: 'visual', items: [{ id: 's', asset: 'square', start: 0, duration: 4 }] }, { id: 'm', type: 'audio', items: [{ id: 'b', asset: music, start: 0, duration: 4 }] }] } });
    const job = studio.renders.enqueue({ clip: slug });
    const done = await studio.renders.wait(job.id, 300000);
    assert.equal(done.status, 'done', done.error ?? '');
    const m = await ebur128(done.outputPath);
    assert.ok(Math.abs(m.integrated + 14) <= 1, `${slug}: ${m.integrated} LUFS`);
    assert.ok(m.truePeak <= -1, `${slug}: true peak ${m.truePeak} dBTP`);
    assert.equal(done.stats.loudness.master.limited, limited);
    if (limited) assert.match(done.stats.loudness.master.note, /limited/);
    assert.equal(done.stats.loudness.met, true);
  }
});

test('stems export without editing the clip, measured; the audio report finds the voice, the music under it and the silences', async () => {
  const stems = await studio.audio.stems(studio.clips.getClip('voiced').composition, { voice: ['voice'], music: ['music'] }, { minSilence: 0.5 });
  assert.deepEqual(stems.map((s) => s.name), ['voice', 'music']);
  for (const s of stems) { assert.ok(readFileSync(s.path).length > 1000); assert.ok(Number.isFinite(s.loudness.integrated)); }
  assert.ok(stems[0].silences.some((x) => x.start >= 3.1 && x.duration >= 0.8), 'the voice stem is silent after the last word');
  const r = await studio.audio.report(studio.clips.getClip('voiced').composition, { minSilence: 0.5 });
  assert.ok(r.underVoice && r.underVoice.lu > 10, `music sits ${r.underVoice?.lu} LU under the voice`);
  assert.equal(r.clipping.samples, 0);
  assert.equal(r.speech.regions >= 1, true);
  await assert.rejects(studio.audio.stems(studio.clips.getClip('voiced').composition, { x: ['nope'] }), /No audio track "nope"/);
});
