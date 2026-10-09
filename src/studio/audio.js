// The clip's sound, mixed in JS: every source decoded once by FFmpeg to 48 kHz stereo float, then
// placed, trimmed, faded, gained (gain × volume keyframes in dB) and ducked under the narration
// (src/render/mix.js). One function makes the WAV the preview plays and the WAV the render encodes,
// so they are the same samples. The master stage either reaches the clip's loudness target with one
// fixed gain (limiting the peaks first only when it must) or, without a target, holds sample peaks at
// 0.95 as the studio always did. Stems are the same mix restricted to some tracks.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_RATE } from '../core/engine.js';
import { itemsOf } from '../core/composition.js';
import { mixInputs, duckCurve, wordRegions, envelopeRegions, limit, reachTarget, applyGainDb, silences, clipping } from '../render/mix.js';
import { measureLoudness, loudnessOver } from '../render/loudness.js';
import { encodeWav } from '../render/wav.js';
import { ffmpegPath, run } from '../render/ffmpeg.js';
import { json } from '../db/db.js';
import { importWords, alignWords, checkTranscript } from '../core/words.js';
import { StudioError, SLUG_RE } from './library.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? v : Math.round(v * 100) / 100);
/** Without a loudness target, sample peaks are held at 0.95, as the FFmpeg graph (alimiter) did before. */
const SAFETY_CEILING_DB = 20 * Math.log10(0.95);
const CACHE_BYTES = 1.5e9;

/** The narration a sound asset carries, or null: { script, words: [{ i, text, start, end, missing? }], … }. */
export const narrationOf = (row) => (row?.type === 'sound' ? json(row.meta, {}).narration ?? null : null);

/**
 * The words of every narration on the clip's (audible) audio tracks, in clip time, sorted:
 * [{ key: "<item>:<i>", item, i, text, start, end, missing? }]. A word the item does not play (cut off by its
 * offset or end) is left out.
 */
export function clipWords(comp, library) {
  const out = [];
  const solo = comp.tracks.some((t) => t.type === 'audio' && t.solo);
  for (const { track, item } of itemsOf(comp)) {
    if (track.type !== 'audio' || track.hidden || track.muted || (solo && !track.solo)) continue;
    const n = narrationOf(library.versionRow(item.asset));
    if (!n) continue;
    const shift = item.start - (item.offset ?? 0);
    for (const w of n.words) {
      const start = w.start + shift, end = w.end + shift;
      if (start < item.start - 1e-6 || end > item.start + item.duration + 1e-6) continue;
      const word = { key: `${item.id}:${w.i}`, item: item.id, i: w.i, text: w.text, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
      if (w.missing) word.missing = true;
      out.push(word);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.i - b.i);
}

/** Prune a cache folder to `max` bytes, oldest files first (only files whose name matches `re`). */
function prune(dir, re, max) {
  let files;
  try { files = readdirSync(dir).filter((f) => re.test(f)).map((f) => { const p = join(dir, f); const s = statSync(p); return { p, size: s.size, at: s.mtimeMs }; }); } catch { return; }
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= max) break;
    try { unlinkSync(f.p); total -= f.size; } catch { /* in use */ }
  }
}

export function createAudio(ctx, library, clips) {
  const { dataDir } = ctx;
  const dir = join(dataDir, 'cache', 'audio');
  mkdirSync(dir, { recursive: true });
  const decoded = new Map();

  /** A source file as 48 kHz stereo float, decoded by FFmpeg (a few kept in memory). */
  async function decode(path) {
    const st = statSync(path);
    const key = `${path}|${st.size}|${st.mtimeMs}`;
    const hit = decoded.get(key);
    if (hit) { decoded.delete(key); decoded.set(key, hit); return hit; }
    const r = await run(ffmpegPath(), ['-v', 'error', '-guess_layout_max', '0', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', String(SAMPLE_RATE), 'pipe:1']);
    if (r.code !== 0) throw new StudioError(`Could not decode ${path}: ${r.stderr.trim()}`);
    const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 8) * 2);
    const n = all.length / 2, left = new Float32Array(n), right = new Float32Array(n);
    for (let i = 0; i < n; i++) { left[i] = all[i * 2]; right[i] = all[i * 2 + 1]; }
    const out = { left, right };
    decoded.set(key, out);
    while (decoded.size > 8) decoded.delete(decoded.keys().next().value);
    return out;
  }

  /** Track id of every audio item, and the tracks that hold narrations. */
  function layout(comp) {
    const trackOf = new Map(), narrationTracks = new Set(), narrationItems = new Set();
    for (const { track, item } of itemsOf(comp)) {
      if (track.type !== 'audio') continue;
      trackOf.set(item.id, track);
      if (track.role === 'narration' || narrationOf(library.versionRow(item.asset))) { narrationTracks.add(track.id); if (narrationOf(library.versionRow(item.asset))) narrationItems.add(item.id); }
    }
    return { trackOf, narrationTracks, narrationItems };
  }

  /**
   * The plan of a mix: the inputs (decoded later), the words, and a cache key. tracks: only these track ids (a stem);
   * ducking is always driven by the whole clip's narration, so a stem sounds exactly as it does in the mix.
   * @param {any} comp @param {{ tracks?: string[] }} [o]
   */
  async function plan(comp, { tracks } = {}) {
    const audio = await clips.prepareAudio(comp);
    const words = clipWords(comp, library);
    const { trackOf, narrationTracks } = layout(comp);
    const items = new Map();
    for (const { track, item } of itemsOf(comp)) if (track.type === 'audio') items.set(item.id, item);
    const inputs = audio.inputs.map((a) => {
      const item = items.get(a.id);
      return { ...a, track: trackOf.get(a.id)?.id, volume: item?.keyframes?.volume, duck: item?.duck };
    });
    for (const t of tracks ?? []) if (!comp.tracks.some((x) => x.id === t && x.type === 'audio')) throw new StudioError(`No audio track "${t}" in this clip (audio tracks: ${comp.tracks.filter((x) => x.type === 'audio').map((x) => x.id).join(', ') || 'none'})`, 'not_found');
    const key = sha1(JSON.stringify([2, comp.duration, inputs.map(({ path, start, duration, offset, gain, fadeIn, fadeOut, volume, duck, track }) => [path, start, duration, offset, gain, fadeIn, fadeOut, volume, duck, track]),
      inputs.some((i) => i.duck) ? words.map((w) => [w.item, w.start, w.end]) : null, comp.loudness ?? null, tracks ?? null]));
    return { inputs, words, narrationTracks, key, beats: audio.beats };
  }

  /** Speech regions the ducking of one input follows: the narration's words, or the envelope of the tracks it ducks under. */
  async function duckRegions(p, input, decodedInputs, comp) {
    const under = input.duck.under ?? [...p.narrationTracks];
    if (input.duck.source === 'envelope') {
      const trigger = decodedInputs.filter((d) => under.includes(d.track) && d !== input);
      if (!trigger.length) return [];
      const m = mixInputs(trigger.map(({ duck: _d, duckDb: _x, ...rest }) => rest), { duration: comp.duration });
      return envelopeRegions(m.left, m.right, SAMPLE_RATE, { threshold: input.duck.threshold ?? -40, hold: input.duck.hold });
    }
    const { trackOf } = layout(comp);
    const words = p.words.filter((w) => under.includes(trackOf.get(w.item)?.id));
    return wordRegions(words, { hold: input.duck.hold });
  }

  /**
   * Mix the clip (or some of its tracks) → { left, right, master, regions } where master describes the master stage:
   * { mode: 'target' | 'safety', before, after, gainDb, limited, limitDb, note }.
   * @param {any} comp @param {{ tracks?: string[], master?: boolean }} [o]
   */
  async function mix(comp, { tracks, master = true } = {}) {
    const p = await plan(comp, { tracks });
    const all = [];
    for (const input of p.inputs) all.push({ ...input, ...(await decode(input.path)) });
    const n = Math.round(comp.duration * SAMPLE_RATE);
    const regions = new Map();
    for (const input of all) {
      if (!input.duck) continue;
      const rs = await duckRegions(p, input, all, comp);
      regions.set(input.id, rs);
      input.duckDb = duckCurve(rs, input.duck, n, SAMPLE_RATE);
    }
    const chosen = tracks ? all.filter((i) => tracks.includes(i.track)) : all;
    const raw = mixInputs(chosen, { duration: comp.duration });
    if (!master) return { left: raw.left, right: raw.right, master: null, regions, words: p.words, key: p.key };
    let out;
    if (comp.loudness && tracks) {
      // a stem takes the master's gain (worked out on the whole mix) without its limiter, so stems add up to the mix before limiting
      const whole = await masterInfo(comp);
      const g = applyGainDb(raw.left, raw.right, whole.gainDb);
      out = { left: g.left, right: g.right, master: { mode: 'stem', gainDb: whole.gainDb, note: `The stem takes the master's gain of ${r2(whole.gainDb)} dB (no limiter).` } };
    } else if (comp.loudness) {
      const r = reachTarget(raw.left, raw.right, { target: comp.loudness.target, truePeak: comp.loudness.truePeak });
      out = { left: r.left, right: r.right, master: { mode: 'target', target: comp.loudness.target, truePeak: comp.loudness.truePeak, before: summary(r.before), after: summary(r.after), gainDb: r2(r.gainDb), limited: r.limited, limitDb: r2(r.limitDb), note: r.note } };
    } else {
      const l = limit(raw.left, raw.right, { ceilingDb: SAFETY_CEILING_DB, truePeak: false });
      out = { left: l.left, right: l.right, master: { mode: 'safety', gainDb: 0, limited: l.reductionDb > 0, limitDb: r2(SAFETY_CEILING_DB), note: l.reductionDb > 0 ? `No loudness target: sample peaks were held at 0.95 (up to ${r2(l.reductionDb)} dB of limiting).` : 'No loudness target: the mix is played as it is (peaks under 0.95).' } };
    }
    return { ...out, regions, words: p.words, key: p.key };
  }

  const summary = (m) => ({ integrated: r2(m.integrated), range: r2(m.range), truePeak: r2(m.truePeak), samplePeak: r2(m.samplePeak) });

  /** The master stage's numbers for a clip (cached next to its mix WAV). */
  async function masterInfo(comp) {
    const file = await mixFile(comp);
    return json(readFileSync(file.replace(/\.wav$/, '.json'), 'utf8'), {}).master;
  }

  const jobs = new Map();
  /**
   * The mix (or a stem) as a 16-bit WAV in the audio cache → path. The same file feeds the preview and the render.
   * A JSON next to it holds the master stage and the loudness of what was written.
   * @param {any} comp @param {{ tracks?: string[] }} [o]
   */
  async function mixFile(comp, { tracks } = {}) {
    const p = await plan(comp, { tracks });
    const file = join(dir, `${tracks ? 'stem' : 'mix'}-${p.key}.wav`);
    if (existsSync(file) && existsSync(file.replace(/\.wav$/, '.json'))) return file;
    let job = jobs.get(file);
    if (!job) {
      job = (async () => {
        const m = await mix(comp, { tracks });
        const tmp = file.replace(/\.wav$/, `.${process.pid}.${Date.now()}.tmp`);
        writeFileSync(tmp, encodeWav(m.left, m.right, SAMPLE_RATE));
        renameSync(tmp, file);
        writeFileSync(file.replace(/\.wav$/, '.json'), JSON.stringify({ master: m.master, loudness: summary(measureLoudness(m.left, m.right, SAMPLE_RATE)), tracks: tracks ?? null }));
        prune(dir, /^(mix|stem)-[0-9a-f]+(\.fix-[0-9a-f]+)?\.(wav|json)$/, CACHE_BYTES);
        return file;
      })().finally(() => jobs.delete(file));
      jobs.set(file, job);
    }
    return job;
  }

  /**
   * Stems: the mix of each group of tracks as a WAV, measured, without editing the clip.
   * groups: { name: [track ids] } (default: one stem per audio track) → [{ name, tracks, path, loudness, silences, clipping }]
   * @param {any} comp @param {Record<string, string[]>} [groups] @param {{ silence?: number, minSilence?: number }} [o]
   */
  async function stems(comp, groups, { silence = -50, minSilence = 1 } = {}) {
    const g = groups ?? Object.fromEntries(comp.tracks.filter((t) => t.type === 'audio').map((t) => [t.id, [t.id]]));
    const out = [];
    for (const [name, tracks] of Object.entries(g)) {
      if (!Array.isArray(tracks) || !tracks.length) throw new StudioError(`stem "${name}": give a list of audio track ids`);
      const path = await mixFile(comp, { tracks });
      const m = await mix(comp, { tracks });
      out.push({ name, tracks, path, loudness: summary(measureLoudness(m.left, m.right, SAMPLE_RATE)), silences: silences(m.left, m.right, SAMPLE_RATE, { threshold: silence, minDuration: minSilence }).slice(0, 50), clipping: clipping(m.left, m.right, SAMPLE_RATE) });
    }
    return out;
  }

  /**
   * What the mix sounds like, measured: loudness of the mix, where the narration speaks, how far the rest (music,
   * effects) sits under the voice there (LU, from gated loudness over the speech regions), silences over a
   * threshold and clipping. @param {any} comp @param {{ silence?: number, minSilence?: number }} [o]
   */
  async function report(comp, { silence = -50, minSilence = 1 } = {}) {
    const m = await mix(comp);
    const { narrationTracks } = layout(comp);
    const audioTracks = comp.tracks.filter((t) => t.type === 'audio').map((t) => t.id);
    const voiceTracks = audioTracks.filter((t) => narrationTracks.has(t)), otherTracks = audioTracks.filter((t) => !narrationTracks.has(t));
    const speech = wordRegions(m.words, { hold: 0.25 });
    let underVoice = null;
    if (voiceTracks.length && otherTracks.length && speech.length) {
      const voice = await mix(comp, { tracks: voiceTracks, master: false });
      const rest = await mix(comp, { tracks: otherTracks, master: false });
      const v = loudnessOver(voice.left, voice.right, SAMPLE_RATE, speech), r = loudnessOver(rest.left, rest.right, SAMPLE_RATE, speech);
      underVoice = { voice: r2(v), rest: r2(r), lu: v === null || r === null ? null : r2(v - r), voiceTracks, restTracks: otherTracks };
    }
    return {
      master: m.master, loudness: summary(measureLoudness(m.left, m.right, SAMPLE_RATE)),
      speech: { regions: speech.length, seconds: r2(speech.reduce((s, [a, b]) => s + b - a, 0)), first: speech[0]?.[0] ?? null, last: speech.at(-1)?.[1] ?? null },
      underVoice, silences: silences(m.left, m.right, SAMPLE_RATE, { threshold: silence, minDuration: minSilence }), clipping: clipping(m.left, m.right, SAMPLE_RATE),
      ducking: Object.fromEntries([...m.regions].map(([id, rs]) => [id, rs.length])),
    };
  }

  /**
   * The mix WAV corrected for what the encoded file measured (AAC moves peaks and loudness a little): one more fixed gain,
   * and the limiter first only if that gain would push the true peak over the ceiling (aiming 0.3 dB under it).
   * → { path, gainDb, limitDb, note }
   */
  async function correctedMix(mixPath, target, measured) {
    const { left, right } = await decode(mixPath);
    const gainDb = target.target - measured.integrated;
    const ceiling = target.truePeak - 0.3;
    let src = { left, right }, limitDb = null;
    if (measured.truePeak + gainDb > ceiling) { limitDb = ceiling - gainDb; src = limit(left, right, { ceilingDb: limitDb }); }
    const out = applyGainDb(src.left, src.right, gainDb);
    const path = mixPath.replace(/\.wav$/, `.fix-${sha1(JSON.stringify([target, measured])).slice(0, 10)}.wav`);
    writeFileSync(path, encodeWav(out.left, out.right, SAMPLE_RATE));
    const note = `The encoded file measured ${r2(measured.integrated)} LUFS and ${r2(measured.truePeak)} dBTP; its audio was corrected by ${gainDb >= 0 ? '+' : ''}${r2(gainDb)} dB${limitDb !== null ? ` after limiting the peaks to ${r2(limitDb)} dBTP` : ''} and encoded again.`;
    return { path, gainDb: r2(gainDb), limitDb: r2(limitDb), note };
  }

  /**
   * A narration: a voice recording plus its script and the time of every word. timings are what a voice service or an
   * aligner returned (a word list, character alignment, whisper.cpp JSON: see core/words.js importWords); they are aligned
   * to the script, so word i is the script's word i in every take. The same name again makes a new version: a new take
   * of the same script, which keeps everything anchored to its words. transcript (optional): a speech-to-text transcript
   * of the take, checked against the script (case, punctuation and numerals do not count).
   * @param {{ slug: string, path?: string, data?: Buffer, ext?: string, script: string, timings: any, unit?: 's'|'ms', transcript?: any, language?: string,
   *   voice?: any, license?: string, description?: string, title?: string, tags?: string[], take?: string, forClip?: string, author: string }} o
   */
  async function addNarration({ slug, path, data, ext, script, timings, unit, transcript, language = 'en', voice, license, description, title, tags, take, forClip, author }) {
    if (!SLUG_RE.test(slug ?? '')) throw new StudioError(`"${slug}" is not a valid asset name: use lowercase letters, digits and dashes`);
    if (typeof script !== 'string' || !script.trim()) throw new StudioError('script: the text the narration was meant to say');
    let imported;
    try { imported = importWords(timings, { unit }); } catch (e) { throw new StudioError(`timings: ${e.message}`); }
    if (!imported.words.length) throw new StudioError('timings: no words found');
    const aligned = alignWords(script, imported.words, { language });
    const previous = narrationOf(library.versionRow(slug));
    const warnings = [];
    if (previous && previous.script.trim() !== script.trim()) warnings.push(`The script differs from version ${library.versionRow(slug).version}'s: words anchored by index may now point at other words.`);
    if (aligned.stats.missing) warnings.push(`${aligned.stats.missing} script word${aligned.stats.missing === 1 ? ' was' : 's were'} not found in the timings; their times are interpolated (missing: true).`);
    if (aligned.stats.extra) warnings.push(`${aligned.stats.extra} word${aligned.stats.extra === 1 ? '' : 's'} in the timings are not in the script (kept as extra).`);
    const check = transcript !== undefined && transcript !== null ? checkTranscript(script, transcript, { language }) : checkTranscript(script, imported.words, { language });
    const narration = { script, language, words: aligned.words, extra: aligned.extra, stats: aligned.stats, source: imported.source, take: take ?? null, voice: voice ?? null,
      transcript: { from: transcript !== undefined && transcript !== null ? 'transcript' : 'timings', ok: check.ok, slips: check.slips, drops: check.drops, insertions: check.insertions } };
    const r = await library.addFileAsset({
      slug, type: 'sound', path, data, ext, author, forClip, license, title,
      description: description ?? `Narration: "${script.trim().slice(0, 120)}${script.trim().length > 120 ? '…' : ''}" with the time of every word.`,
      tags: [...new Set(['narration', 'voice', ...(tags ?? [])])], meta: { narration },
      note: previous ? `New take${take ? ` (${take})` : ''} of the narration` : undefined,
    });
    return { asset: r.asset, words: aligned.words.length, stats: aligned.stats, source: imported.source, transcript: narration.transcript, warnings };
  }

  return { decode, plan, mix, mixFile, stems, report, masterInfo, correctedMix, addNarration };
}
