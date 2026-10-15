// The hosted voice: ElevenLabs text-to-speech with timestamps. The response carries the audio and the time of every
// character, which the studio's own import turns into word times, so a take needs no transcription to be aligned.
// Needs ELEVENLABS_API_KEY; the key is sent only to api.elevenlabs.io and never returned or logged.

import { importWords } from '../../core/words.js';
import { StudioError } from '../library.js';
import { writeWav } from './wav.js';

export const ELEVENLABS_LICENSE = 'ElevenLabs terms of service (commercial use depends on the plan the key belongs to)';
const API = 'https://api.elevenlabs.io';
const SAMPLE_RATE = 24000;

/**
 * @param {{ key: string, fetch?: typeof fetch, model?: string, timeout?: number }} o
 */
export function elevenLabsAdapter({ key, fetch: doFetch = globalThis.fetch, model = 'eleven_multilingual_v2', timeout = 120000 }) {
  async function call(path, init) {
    let res;
    try { res = await doFetch(`${API}${path}`, { ...init, headers: { 'xi-api-key': key, ...init?.headers }, signal: AbortSignal.timeout(timeout) }); } catch (e) {
      throw new StudioError(e?.name === 'TimeoutError' ? `ElevenLabs did not answer within ${Math.round(timeout / 1000)} s` : `Could not reach ElevenLabs: ${e?.message ?? e}`);
    }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); const d = j.detail; detail = typeof d === 'string' ? d : d?.message ?? JSON.stringify(d ?? j); } catch { /* no body */ }
      const hint = res.status === 401 ? ' (check ELEVENLABS_API_KEY)' : res.status === 429 ? ' (rate limit or out of credits)' : '';
      throw new StudioError(`ElevenLabs answered ${res.status}${hint}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
    }
    return res.json();
  }

  let listed = null;
  /** @returns {Promise<{ id: string, label: string, language: string, gender?: string, grade?: string }[]>} */
  async function voices() {
    if (listed) return listed;
    const j = await call('/v1/voices', { method: 'GET' });
    const list = Array.isArray(j?.voices) ? j.voices : [];
    return (listed = list.map((v) => ({
      id: String(v.voice_id), label: String(v.name ?? v.voice_id),
      language: String(v.labels?.language ?? v.labels?.accent ?? v.fine_tuning?.language ?? 'en'),
      gender: v.labels?.gender ? String(v.labels.gender) : undefined,
      grade: undefined,
    })));
  }

  /**
   * Speak `text` → { wavPath, sampleRate, seconds, words } (word times from the character alignment).
   * voice: a voice id from voices(). speed: 0.7 to 1.2 (ElevenLabs' own range).
   * @param {{ text: string, voice: string, speed?: number, out: string }} a
   */
  async function synthesize({ text, voice, speed = 1, out }) {
    if (!voice) throw new StudioError('Give a voice id (see speech_status or voice_samples for the list)');
    if (!(speed >= 0.7 && speed <= 1.2)) throw new StudioError('ElevenLabs speed must be between 0.7 and 1.2');
    const t0 = performance.now();
    const body = { text, model_id: model, voice_settings: { speed } };
    const j = await call(`/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=pcm_${SAMPLE_RATE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (typeof j?.audio_base64 !== 'string' || !j.audio_base64) throw new StudioError('ElevenLabs returned no audio');
    const pcm = Buffer.from(j.audio_base64, 'base64');
    const samples = new Float32Array(Math.floor(pcm.length / 2));
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
    writeWav(out, samples, SAMPLE_RATE);
    const alignment = j.alignment ?? j.normalized_alignment;
    let words;
    if (alignment) { try { words = importWords({ alignment }).words; } catch (e) { throw new StudioError(`ElevenLabs alignment: ${e.message}`); } }
    return { wavPath: out, sampleRate: SAMPLE_RATE, seconds: Math.round(performance.now() - t0) / 1000, words };
  }

  return { name: 'elevenlabs', voices, synthesize };
}
