// The local voice: Kokoro-82M through kokoro-js, run as a child process (`node say.mjs` in
// STUDIO_KOKORO_DIR/tts). It writes a 24 kHz mono WAV and gives no word times; with `exactTimes` the
// adapter makes a take whose word times it knows by construction (see exactTake).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StudioError } from '../library.js';
import { runProgram } from './process.js';
import { exists, kokoroPaths } from './config.js';
import { readWav, soundSpan, writeWav } from './wav.js';

export const KOKORO_LICENSE = 'Apache-2.0 (Kokoro-82M weights and voices, kokoro-js)';

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {{ dir: string, work: string, timeout?: number }} o `dir`: STUDIO_KOKORO_DIR; `work`: scratch folder for text files
 */
export function kokoroAdapter({ dir, work, timeout = 600000 }) {
  const paths = kokoroPaths(dir);
  let listed = null;

  function check() {
    if (!exists.dir(dir)) throw new StudioError(`STUDIO_KOKORO_DIR is ${dir}, which is not a folder. Point it at the folder that holds tts/say.mjs.`);
    if (!exists.file(paths.script)) throw new StudioError(`${paths.script} was not found. STUDIO_KOKORO_DIR must hold tts/say.mjs (kokoro-js installed in tts/node_modules).`);
  }
  const say = (args, what) => runProgram(process.execPath, [paths.script, ...args], { cwd: paths.dir, timeout, what });

  /** @returns {Promise<{ id: string, label: string, language: string, gender?: string, grade?: string }[]>} */
  async function voices() {
    if (listed) return listed;
    check();
    const { stdout } = await say(['--list'], 'Kokoro (voice list)');
    const out = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+grade\s+(\S+)/.exec(line.trim());
      if (m) out.push({ id: m[1], label: `${m[1].split('_')[1][0].toUpperCase()}${m[1].split('_')[1].slice(1)} (${m[3].toLowerCase()}, ${m[2]})`, language: m[2], gender: m[3].toLowerCase(), grade: m[4] });
    }
    if (!out.length) throw new StudioError('Kokoro listed no voices; run `node say.mjs --list` in STUDIO_KOKORO_DIR/tts to see why');
    return (listed = out);
  }

  async function ensureVoice(voice) {
    const all = await voices();
    if (!all.some((v) => v.id === voice)) throw new StudioError(`Unknown voice "${voice}" for Kokoro. Voices: ${all.map((v) => v.id).join(', ')}`);
  }

  /**
   * Speak `text` → { wavPath, sampleRate, seconds, words? }. exactTimes: every word synthesised on its own, trimmed, and
   * placed with fixed gaps, so `words` ([{ text, start, end }]) are the true times; the take is not natural speech.
   * @param {{ text: string, voice?: string, speed?: number, out: string, exactTimes?: boolean, gap?: number }} a
   */
  async function synthesize({ text, voice = 'af_heart', speed = 1, out, exactTimes = false, gap = 0.2 }) {
    check();
    await ensureVoice(voice);
    mkdirSync(work, { recursive: true });
    const job = mkdtempSync(join(work, 'kokoro-'));
    try {
      const clean = (w) => w.replace(/[^\p{L}\p{N}'’-]+/gu, '').replace(/^[-'’]+|[-'’]+$/g, '');
      const kept = text.split(/\s+/).filter((w) => clean(w) !== '');
      // one word per line: the splitter ends a sentence at a newline, so each word is spoken on its own
      const spoken = exactTimes ? kept.map(clean).join('\n') : text;
      const file = join(job, 'text.txt');
      writeFileSync(file, spoken, 'utf8');
      const raw = exactTimes ? join(job, 'raw.wav') : out;
      const timings = join(job, 'timings.json');
      const r = await say(['--voice', voice, '--speed', String(speed), '--out', raw, '--text-file', file, '--timings', timings], `Kokoro (${voice})`);
      if (!exists.file(raw)) throw new StudioError(`Kokoro finished without writing ${raw}: ${r.stderr.trim().slice(-300) || r.stdout.trim().slice(-300)}`);
      if (!exactTimes) {
        // Kokoro gives no word times, but it speaks sentence by sentence and knows where each one lies in the file
        let sentences;
        try { sentences = JSON.parse(readFileSync(timings, 'utf8')).sentences; } catch { /* an older say.mjs */ }
        return { wavPath: out, sampleRate: readWav(out).sampleRate, seconds: r.seconds, sentences };
      }
      const sentences = JSON.parse(readFileSync(timings, 'utf8')).sentences ?? [];
      if (sentences.length !== kept.length) throw new StudioError(`exactTimes needs every word spoken as its own sentence, but Kokoro made ${sentences.length} sentences from ${kept.length} words (numbers alone and abbreviations such as "sat" or "st" run into their neighbours). Change the script.`);
      const take = exactTake(readWav(raw), sentences, kept, gap);
      writeWav(out, take.samples, take.sampleRate);
      return { wavPath: out, sampleRate: take.sampleRate, seconds: r.seconds, words: take.words };
    } finally {
      rmSync(job, { recursive: true, force: true });
    }
  }

  return { name: 'kokoro', voices, synthesize };
}

/**
 * Cut the sentences out of Kokoro's file (each was spoken alone), trim the silence around each where the sound is
 * under a threshold, and lay them out with fixed gaps: 0.3 s before the first, `gap` between, 0.3 s after the last.
 * → { samples, sampleRate, words: [{ text, start, end }] } where start and end are the first and last sample placed.
 */
export function exactTake({ samples, sampleRate }, sentences, texts, gap = 0.2) {
  const lead = Math.round(0.3 * sampleRate), g = Math.round(gap * sampleRate), fade = Math.round(0.002 * sampleRate);
  const parts = sentences.map((s, k) => {
    const a = Math.max(0, Math.round(s.start * sampleRate) - 240), b = Math.min(samples.length, Math.round(s.end * sampleRate) + 240);
    const seg = samples.subarray(a, b);
    const span = soundSpan(seg, sampleRate);
    if (!span) throw new StudioError(`Kokoro's take of the word "${texts[k]}" is silent`);
    const w = Float32Array.from(seg.subarray(span[0], span[1]));
    for (let i = 0; i < fade && i < w.length; i++) { w[i] *= i / fade; w[w.length - 1 - i] *= i / fade; }
    return w;
  });
  const total = lead * 2 + parts.reduce((n, p) => n + p.length, 0) + g * (parts.length - 1);
  const out = new Float32Array(total);
  const words = [];
  let at = lead;
  parts.forEach((p, k) => {
    out.set(p, at);
    words.push({ text: texts[k], start: round3(at / sampleRate), end: round3((at + p.length) / sampleRate) });
    at += p.length + g;
  });
  return { samples: out, sampleRate, words };
}
