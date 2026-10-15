// Transcription with whisper.cpp: the audio is converted to 16 kHz mono by FFmpeg, whisper-cli writes its
// full JSON (-ojf: a time for every token, which is where word starts come from; -ml 1 word starts include
// the silence before a word), and the studio's own whisper import turns that into words.

import { availableParallelism } from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ffmpegPath, run } from '../../render/ffmpeg.js';
import { importWords } from '../../core/words.js';
import { StudioError } from '../library.js';
import { runProgram } from './process.js';
import { exists } from './config.js';
import { readWav } from './wav.js';
import { refineWords } from './refine.js';

/** whisper.cpp's name for a model's DTW alignment heads, from the model file name (ggml-small.en.bin → small.en), or null. */
export function dtwPreset(model) {
  const m = /^ggml-(tiny|base|small|medium)(\.en)?(?:-q\d(?:_\d)?)?\.bin$/i.exec(basename(model));
  return m ? `${m[1].toLowerCase()}${m[2] ? '.en' : ''}` : null;
}

/**
 * The DTW time (seconds) of each word, grouped like the importer groups tokens (words/whisper import in core/words.js):
 * the time of the word's last token with a letter or digit. null when the words do not line up with `heard`, or no time is there.
 * @param {any} raw whisper-cli -ojf output @param {{ text: string }[]} heard the words the importer made
 */
export function wordAnchors(raw, heard) {
  const words = [];
  let cur = null;
  for (const seg of raw.transcription) {
    let first = true;
    for (const t of seg.tokens ?? []) {
      const text = String(t?.text ?? '');
      if (/^\s*[[<][\s\S]*[\]>]\s*$/.test(text) || text.trim() === '') continue;
      const punctuation = !/[\p{L}\p{N}]/u.test(text);
      if (!cur || /^\s/.test(text) || (first && !punctuation)) { cur = { text: text.trim(), anchor: null }; words.push(cur); } else cur.text += text.trim();
      if (!punctuation && Number.isFinite(t.t_dtw) && t.t_dtw >= 0) cur.anchor = t.t_dtw / 100;
      first = false;
    }
  }
  if (words.length !== heard.length || words.some((w, i) => w.text !== heard[i].text)) return null;
  return words.some((w) => w.anchor !== null) ? words.map((w) => w.anchor) : null;
}

/**
 * @param {{ cli: string, dir: string, timeout?: number }} o `dir`: where the job folders go (removed afterwards)
 */
export function whisperTranscriber({ cli, dir, timeout = 900000 }) {
  /**
   * Words of an audio file → { text, words: [{ text, start, end }], model (file name), seconds }.
   * @param {{ path: string, model: string, language?: string, refine?: boolean }} a
   */
  async function transcribe({ path, model, language = 'en', refine = true }) {
    if (!exists.file(cli)) throw new StudioError(`whisper-cli was not found at ${cli}. Set STUDIO_WHISPER_CLI to the whisper.cpp executable (see speech_status).`);
    if (!exists.file(model)) throw new StudioError(`The whisper model ${model} was not found. Set STUDIO_WHISPER_MODEL to a ggml model file such as ggml-small.en.bin (see speech_status).`);
    if (/\.en\./.test(basename(model)) && !/^en/i.test(language)) throw new StudioError(`${basename(model)} is an English-only model; for language "${language}" set a multilingual model (such as ggml-small.bin)`);
    if (!exists.file(path)) throw new StudioError(`Audio file not found: ${path}`, 'not_found');
    mkdirSync(dir, { recursive: true });
    const job = mkdtempSync(join(dir, 'job-'));
    const t0 = performance.now();
    try {
      const wav = join(job, 'in16k.wav');
      let r;
      try { r = await run(ffmpegPath(), ['-v', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]); } catch (e) { throw new StudioError(e.message); }
      if (r.code !== 0 || !exists.file(wav)) throw new StudioError(`Could not read ${path} as audio: ${r.stderr.trim() || 'FFmpeg made no output'}`);
      const base = join(job, 'out');
      const args = ['-m', model, '-f', wav, '-ojf', '-of', base, '-np', '-t', String(Math.min(8, availableParallelism()))];
      if (!/\.en\./.test(basename(model))) args.push('-l', language.slice(0, 2).toLowerCase());
      const what = `whisper-cli (${basename(model)})`;
      // DTW token times (they do not drift) say which sound belongs to which word; they need flash attention off
      const dtw = refine ? dtwPreset(model) : null;
      if (dtw) {
        try { await runProgram(cli, [...args, '-dtw', dtw, '-nfa'], { timeout, what }); } catch (e) { if (/did not finish/.test(e.message)) throw e; await runProgram(cli, args, { timeout, what }); }
      } else await runProgram(cli, args, { timeout, what });
      let raw;
      try { raw = JSON.parse(readFileSync(`${base}.json`, 'utf8')); } catch { throw new StudioError(`${what} wrote no readable JSON for ${path}`); }
      const heard = Array.isArray(raw.transcription) && raw.transcription.length ? importWords(raw).words : [];
      // starts and ends are moved onto the pauses of the sound (see refine.js); the times whisper gave stay in rawWords
      let words = heard, refined = null;
      if (refine && heard.length) {
        const anchors = wordAnchors(raw, heard);
        if (anchors) { const pcm = readWav(wav); const f = refineWords(heard, anchors, pcm.samples, pcm.sampleRate); words = f.words; refined = { boundaries: f.moved, of: heard.length + 1 }; }
      }
      return { text: words.map((w) => w.text).join(' '), words, ...(refine ? { rawWords: heard, refined } : {}), model: basename(model), seconds: Math.round(performance.now() - t0) / 1000 };
    } finally {
      rmSync(job, { recursive: true, force: true });
    }
  }
  return { transcribe };
}
