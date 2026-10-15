// Stand-ins for the tests (switched on by STUDIO_SPEECH_STUB=1, which only tests set): a voice that says every
// word as a short tone at a known time, and a "transcriber" that knows those times because the voice wrote
// them down next to the audio (by the hash of its bytes). No model, no program, deterministic.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StudioError } from '../library.js';
import { wavBytes } from './wav.js';

const SR = 24000;
export const STUB_VOICES = [
  { id: 'stub-low', label: 'Low tone', language: 'en-us', gender: 'male', grade: 'B', hz: 140 },
  { id: 'stub-mid', label: 'Middle tone', language: 'en-us', gender: 'female', grade: 'A', hz: 220 },
  { id: 'stub-high', label: 'High tone', language: 'en-gb', gender: 'female', grade: 'C', hz: 330 },
  { id: 'stub-deep', label: 'Deep tone', language: 'en-gb', gender: 'male', grade: 'D', hz: 90 },
  // like a hosted service: returns the word times with the audio
  { id: 'stub-timed', label: 'Tone with word times', language: 'en-us', gender: 'female', grade: 'A', hz: 260, timed: true },
];

/** @param {{ dir: string }} o `dir`: where the sidecar files go */
export function stubAdapter({ dir }) {
  mkdirSync(dir, { recursive: true });

  async function voices() {
    return STUB_VOICES.map(({ id, label, language, gender, grade }) => ({ id, label, language, gender, grade }));
  }

  /** @param {{ text: string, voice?: string, speed?: number, out: string }} a */
  async function synthesize({ text, voice = 'stub-mid', speed = 1, out }) {
    const v = STUB_VOICES.find((x) => x.id === voice);
    if (!v) throw new StudioError(`Unknown voice "${voice}" for the stub engine. Voices: ${STUB_VOICES.map((x) => x.id).join(', ')}`);
    const words = text.split(/\s+/).filter(Boolean);
    let at = 0.2;
    const timed = words.map((w) => {
      const d = (0.12 + 0.04 * w.length) / speed;
      const row = { text: w, start: Math.round(at * 1000) / 1000, end: Math.round((at + d) * 1000) / 1000 };
      at += d + 0.08;
      return row;
    });
    const samples = new Float32Array(Math.round((at + 0.3) * SR));
    timed.forEach((w, k) => {
      const hz = v.hz * (1 + 0.04 * (k % 5));
      const a = Math.round(w.start * SR), b = Math.round(w.end * SR);
      for (let i = a; i < b; i++) {
        const env = Math.min(1, (i - a) / 240, (b - i) / 240);
        samples[i] = 0.3 * env * Math.sin((2 * Math.PI * hz * i) / SR);
      }
    });
    const bytes = wavBytes(samples, SR);
    writeFileSync(out, bytes);
    writeFileSync(join(dir, `${createHash('sha1').update(bytes).digest('hex')}.json`), JSON.stringify(timed));
    return { wavPath: out, sampleRate: SR, seconds: 0.01, words: v.timed ? timed : undefined };
  }
  return { name: 'stub', voices, synthesize };
}

/** The transcriber for audio the stub voice made: { models, transcribe }. */
export function stubTranscriber({ dir }) {
  /** @param {{ path: string, model: string, language?: string, refine?: boolean }} a */
  async function transcribe({ path, model }) {
    let words;
    try { words = JSON.parse(readFileSync(join(dir, `${createHash('sha1').update(readFileSync(path)).digest('hex')}.json`), 'utf8')); } catch {
      throw new StudioError(`The stub transcriber only knows audio made by the stub voice; ${path} is not one`);
    }
    return { text: words.map((w) => w.text).join(' '), words, model, seconds: 0.01 };
  }
  return { transcribe };
}
