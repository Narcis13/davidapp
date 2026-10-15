// Speech inside the studio: the steps clip 7 did by hand outside it. A voice is made (Kokoro, ElevenLabs), its words
// are timed (whisper.cpp, or the voice service itself), the take is checked against the script, and the narration
// asset is created, behind one service. Every piece is optional: with no tool configured the studio still imports
// files (add_narration with timings), and `status` says what to set for each missing piece.
//
// Configuration lives outside the repo (environment, or a git-ignored .env at the repo root; see speech/config.js).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../render/host.js';
import { ffmpegPath } from '../render/ffmpeg.js';
import { checkTranscripts } from '../core/words.js';
import { StudioError, SLUG_RE } from './library.js';
import { narrationOf } from './audio.js';
import { resolveConfig, exists, kokoroPaths } from './speech/config.js';
import { whisperTranscriber } from './speech/whisper.js';
import { kokoroAdapter, KOKORO_LICENSE } from './speech/kokoro.js';
import { elevenLabsAdapter, ELEVENLABS_LICENSE } from './speech/elevenlabs.js';
import { stubAdapter, stubTranscriber } from './speech/stub.js';
import { wavSeconds } from './speech/wav.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const r2 = (v) => Math.round(v * 100) / 100;
const MAX_LINE = 600, MAX_SCRIPT = 30000;

const HOW = {
  cli: 'Install whisper.cpp (a release build from https://github.com/ggml-org/whisper.cpp) and set STUDIO_WHISPER_CLI to the whisper-cli executable, or put whisper-cli on PATH.',
  model: 'Download a ggml model (for word times use ggml-small.en.bin from https://huggingface.co/ggerganov/whisper.cpp; base.en starts words up to 350 ms early) and set STUDIO_WHISPER_MODEL to its path.',
  model2: 'Optional: set STUDIO_WHISPER_MODEL_2 to a second model (ggml-base.en.bin) and the transcript check calls a word wrong only when both models do.',
  ffmpeg: 'Install FFmpeg (it converts the audio for whisper), or set FFMPEG_PATH to the executable.',
  none: 'Set STUDIO_TTS=kokoro and STUDIO_KOKORO_DIR (the folder that holds tts/say.mjs with kokoro-js installed), or set ELEVENLABS_API_KEY for the hosted voice (STUDIO_TTS=elevenlabs).',
  kokoroDir: 'Set STUDIO_KOKORO_DIR to the folder that holds tts/say.mjs (kokoro-js installed in tts/node_modules).',
  elevenKey: 'Set ELEVENLABS_API_KEY (in the environment or in the git-ignored .env at the repo root).',
};

/**
 * @param {any} ctx @param {{ library: any, audio: any }} deps
 */
export function createSpeech(ctx, { library, audio }) {
  const root = join(ctx.dataDir, 'speech');
  const dirs = { work: join(root, 'tmp'), samples: join(root, 'samples'), takes: join(root, 'takes'), cache: join(root, 'cache'), stub: join(root, 'stub') };
  /** @type {{ env?: Record<string, string | undefined>, dotenv?: string | false, fetch?: typeof fetch, timeout?: number } | null} */
  let override = null;
  const ensure = (d) => { mkdirSync(d, { recursive: true }); return d; };

  /**
   * Replace where the settings come from (tests): env is the whole environment, dotenv a file path or false, fetch the
   * network call the hosted voice uses. configure(null) goes back to process.env and the repo's .env.
   * @param {typeof override} o
   */
  function configure(o) { override = o; adapters.clear(); }
  const config = () => resolveConfig(override ? { env: override.env ?? {}, dotenv: override.dotenv ?? false } : { env: process.env, dotenv: join(ROOT, '.env') });
  const timeout = () => override?.timeout ?? 600000;

  // ---------------------------------------------------------------- what is available

  /** The transcription models in use: [{ id: 'primary' | 'secondary', model (path, or a name for the stub) }]. */
  function modelsOf(cfg) {
    if (cfg.stub) return [{ id: 'primary', model: 'stub-small' }, { id: 'secondary', model: 'stub-base' }];
    const out = [];
    if (cfg.whisper.cli && cfg.whisper.model) out.push({ id: 'primary', model: cfg.whisper.model });
    if (cfg.whisper.cli && cfg.whisper.model && cfg.whisper.model2) out.push({ id: 'secondary', model: cfg.whisper.model2 });
    return out;
  }

  function transcriptionProblems(cfg) {
    const missing = [];
    if (cfg.stub) return missing;
    const w = cfg.whisper;
    if (!w.cli) missing.push({ piece: 'whisper-cli', set: 'STUDIO_WHISPER_CLI', how: HOW.cli });
    else if (!exists.file(w.cli)) missing.push({ piece: 'whisper-cli', set: 'STUDIO_WHISPER_CLI', how: `${w.cli} is not a file. ${HOW.cli}` });
    if (!w.model) missing.push({ piece: 'whisper model', set: 'STUDIO_WHISPER_MODEL', how: HOW.model });
    else if (!exists.file(w.model)) missing.push({ piece: 'whisper model', set: 'STUDIO_WHISPER_MODEL', how: `${w.model} is not a file. ${HOW.model}` });
    if (w.model2 && !exists.file(w.model2)) missing.push({ piece: 'second whisper model', set: 'STUDIO_WHISPER_MODEL_2', how: `${w.model2} is not a file. ${HOW.model2}` });
    return missing;
  }

  function ffmpegProblem() {
    try { return { found: true, path: ffmpegPath() }; } catch (e) { return { found: false, error: e.message }; }
  }

  function voiceProblems(cfg) {
    if (cfg.tts === 'stub') return [];
    if (cfg.tts === 'none') return [{ piece: 'voice engine', set: 'STUDIO_TTS', how: HOW.none }];
    if (cfg.tts === 'kokoro') {
      if (!cfg.kokoroDir) return [{ piece: 'Kokoro folder', set: 'STUDIO_KOKORO_DIR', how: HOW.kokoroDir }];
      const p = kokoroPaths(cfg.kokoroDir);
      if (!exists.dir(cfg.kokoroDir)) return [{ piece: 'Kokoro folder', set: 'STUDIO_KOKORO_DIR', how: `${cfg.kokoroDir} is not a folder. ${HOW.kokoroDir}` }];
      if (!exists.file(p.script)) return [{ piece: 'Kokoro script', set: 'STUDIO_KOKORO_DIR', how: `${p.script} was not found. ${HOW.kokoroDir}` }];
      if (!exists.dir(join(p.dir, 'node_modules', 'kokoro-js'))) return [{ piece: 'kokoro-js', set: 'STUDIO_KOKORO_DIR', how: `kokoro-js is not installed in ${p.dir}: run npm install kokoro-js there.` }];
      return [];
    }
    if (cfg.tts === 'elevenlabs') return cfg.elevenlabsKey ? [] : [{ piece: 'ElevenLabs key', set: 'ELEVENLABS_API_KEY', how: HOW.elevenKey }];
    return [{ piece: 'voice engine', set: 'STUDIO_TTS', how: `STUDIO_TTS is "${cfg.tts}"; use kokoro, elevenlabs or none.` }];
  }

  /**
   * What is available, and for each missing piece what to set or install. Never returns the API key.
   * @returns {{ transcription: any, voice: any, ffmpeg: any, config: any, note: string }}
   */
  function status() {
    const cfg = config();
    const tm = transcriptionProblems(cfg), ff = ffmpegProblem();
    const missingT = [...tm, ...(ff.found || cfg.stub ? [] : [{ piece: 'ffmpeg', set: 'FFMPEG_PATH', how: HOW.ffmpeg }])];
    const vm = voiceProblems(cfg);
    const optional = [];
    if (!cfg.stub && !cfg.whisper.model2 && !tm.length) optional.push({ piece: 'second whisper model', set: 'STUDIO_WHISPER_MODEL_2', how: HOW.model2 });
    return {
      transcription: {
        available: !missingT.length,
        stub: cfg.stub || undefined,
        cli: cfg.whisper.cli ? { path: cfg.whisper.cli, source: cfg.whisper.cliSource, found: exists.file(cfg.whisper.cli) } : null,
        models: cfg.stub ? modelsOf(cfg).map((m) => ({ id: m.id, name: m.model, found: true })) : [['primary', cfg.whisper.model], ['secondary', cfg.whisper.model2]].filter(([, p]) => p).map(([id, p]) => ({ id, path: p, found: exists.file(p) })),
        missing: missingT, optional,
      },
      voice: { engine: cfg.tts, available: !vm.length && cfg.tts !== 'none', missing: vm, ...(cfg.tts === 'kokoro' && cfg.kokoroDir ? { dir: cfg.kokoroDir } : {}), ...(cfg.tts === 'elevenlabs' ? { key: cfg.elevenlabsKey ? 'set' : 'not set' } : {}) },
      ffmpeg: ff,
      config: { dotenv: cfg.dotenv, set: cfg.set, keys: ['STUDIO_WHISPER_CLI', 'STUDIO_WHISPER_MODEL', 'STUDIO_WHISPER_MODEL_2', 'STUDIO_TTS', 'STUDIO_KOKORO_DIR', 'ELEVENLABS_API_KEY'] },
      note: 'Without any of this the studio still imports files: add_narration with timings works as before.',
    };
  }

  const problemText = (list) => list.map((m) => `${m.piece}: ${m.how}`).join(' ');

  // ---------------------------------------------------------------- transcription

  const adapters = new Map();
  /** @returns {{ transcribe: (a: { path: string, model: string, language?: string, refine?: boolean }) => Promise<any> }} */
  function transcriber(cfg) {
    if (cfg.stub) return stubTranscriber({ dir: ensure(dirs.stub) });
    const missing = [...transcriptionProblems(cfg)];
    const ff = ffmpegProblem();
    if (!ff.found) missing.push({ piece: 'ffmpeg', set: 'FFMPEG_PATH', how: HOW.ffmpeg });
    if (missing.length) throw new StudioError(`Transcription is not set up. ${problemText(missing)}`);
    return whisperTranscriber({ cli: cfg.whisper.cli, dir: ensure(dirs.work), timeout: timeout() });
  }

  function sourceFile({ ref, path }) {
    if (ref) {
      const row = library.requireVersion(ref);
      if (row.type !== 'sound') throw new StudioError(`${ref} is a ${row.type} asset; give a sound (a narration or an audio file)`);
      return library.absFile(row);
    }
    if (!path) throw new StudioError('Give ref (a sound asset) or path (an audio file)');
    if (!existsSync(path) || !statSync(path).isFile()) throw new StudioError(`Audio file not found: ${path}`, 'not_found');
    return path;
  }

  function pickModel(cfg, model) {
    const all = modelsOf(cfg);
    if (model === undefined || model === null || model === 'primary') {
      if (!all.length) throw new StudioError(`Transcription is not set up. ${problemText(transcriptionProblems(cfg)) || HOW.model}`);
      return all[0];
    }
    if (model === 'secondary' || model === 'second') {
      const m = all.find((x) => x.id === 'secondary');
      if (!m) throw new StudioError(`There is no second model. ${HOW.model2}`);
      return m;
    }
    if (cfg.stub) return { id: 'custom', model: String(model) };
    if (!exists.file(model)) throw new StudioError(`model: "${model}" is not primary, secondary or the path of a whisper ggml file`);
    return { id: 'custom', model };
  }

  /**
   * Words and their times from an audio file (a sound asset by `ref`, or a file by `path`):
   * { text, words: [{ text, start, end }], model, seconds, cached? }. model: 'primary' (default), 'secondary', or a ggml path.
   * The result of a file and model is kept, so checking a take again does not run whisper again. whisper's token times put a
   * word's start in the silence before it, so by default (refine) starts and ends are moved onto the sound; `rawWords` keeps
   * what whisper said.
   * @param {{ ref?: string, path?: string, model?: string, language?: string, cache?: boolean, refine?: boolean }} o
   */
  async function transcribe({ ref, path, model, language = 'en', cache: useCache = true, refine = true } = {}) {
    const cfg = config();
    const file = sourceFile({ ref, path });
    const m = pickModel(cfg, model);
    const tr = transcriber(cfg);
    const st = statSync(m.model, { throwIfNoEntry: false });
    const key = cfg.stub || !useCache ? null : sha1(JSON.stringify([createHash('sha1').update(readFileSync(file)).digest('hex'), m.model, st?.size, st?.mtimeMs, language, refine]));
    const cached = key ? join(dirs.cache, `${key}.json`) : null;
    if (cached && existsSync(cached)) { try { return { ...JSON.parse(readFileSync(cached, 'utf8')), cached: true }; } catch { /* rewritten below */ } }
    const r = await tr.transcribe({ path: file, model: m.model, language, refine });
    if (cached) { ensure(dirs.cache); const tmp = `${cached}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(r)); renameSync(tmp, cached); }
    return r;
  }

  /** One transcript per configured model (one or two), in order. @param {{ ref?: string, path?: string }} src @param {string} [language] */
  async function transcribeEach(src, language) {
    const cfg = config();
    const ids = modelsOf(cfg).map((m) => m.id);
    if (!ids.length) throw new StudioError(`Transcription is not set up. ${problemText(transcriptionProblems(cfg)) || HOW.model}`);
    const out = [];
    for (const id of ids) out.push(await transcribe({ ...src, model: id, language }));
    return out;
  }

  /**
   * Word times for a take that came without them (add_narration with align): the primary model's words as the timings,
   * and every model's words as independent transcripts for the check. `data` (bytes) is written to a temp file first.
   * @param {{ path?: string, data?: Buffer, ext?: string, language?: string }} o
   */
  async function timingsFor({ path, data, ext, language = 'en' }) {
    let tmp = null;
    try {
      if (!path) {
        if (!data) throw new StudioError('Give the audio file (path or data_base64) to align');
        // the extension names the temp file: a short suffix only, never a path
        if (ext !== undefined && !/^\.[a-z0-9]{1,5}$/i.test(ext)) throw new StudioError(`ext must be a file extension such as ".wav" (got ${JSON.stringify(ext).slice(0, 40)})`);
        tmp = join(ensure(dirs.work), `align-${process.pid}-${Date.now()}${ext ?? '.wav'}`);
        writeFileSync(tmp, data);
      }
      const results = await transcribeEach({ path: tmp ?? path }, language);
      return { words: results[0].words, transcripts: results.length > 1 ? results.map((r) => r.words) : undefined, models: results.map((r) => r.model), seconds: r2(results.reduce((n, r) => n + (r.cached ? 0 : r.seconds), 0)) };
    } finally {
      if (tmp) rmSync(tmp, { force: true });
    }
  }

  /**
   * The transcript check made by the studio: the take is transcribed with every configured model and compared with the
   * script, a word counting as wrong only when all models say so. Give `narration` (its audio and script) or `script` and `path`.
   * @param {{ narration?: string, path?: string, script?: string, language?: string }} o
   */
  async function checkTake({ narration, path, script, language }) {
    let src, text = script, lang = language;
    if (narration) {
      const row = library.requireVersion(narration);
      const n = narrationOf(row);
      if (!n) throw new StudioError(`${narration} is not a narration (it has no script)`);
      text ??= n.script;
      lang ??= n.language;
      src = { ref: narration };
    } else src = { path };
    if (!text) throw new StudioError('Give narration or script');
    if (!narration && !path) throw new StudioError('transcribe needs the audio: give narration (a narration asset) or path (an audio file)');
    const results = await transcribeEach(src, lang ?? 'en');
    const check = checkTranscripts(text, results.map((r) => r.words), { language: lang ?? 'en' });
    return { ...check, models: results.map((r) => r.model), seconds: r2(results.reduce((n, r) => n + (r.cached ? 0 : r.seconds), 0)) };
  }

  // ---------------------------------------------------------------- voices

  /** @returns {any} the adapter of the configured engine; throws what to set when there is none */
  function adapter() {
    const cfg = config();
    const problems = voiceProblems(cfg);
    if (problems.length) throw new StudioError(`No voice engine is ready. ${problemText(problems)}`);
    const key = `${cfg.tts}|${cfg.kokoroDir}|${cfg.elevenlabsKey ? 'k' : ''}`;
    let a = adapters.get(key);
    if (!a) {
      if (cfg.tts === 'stub') a = Object.assign(stubAdapter({ dir: ensure(dirs.stub) }), { license: 'Test stand-in (not a real voice)' });
      else if (cfg.tts === 'kokoro') a = Object.assign(kokoroAdapter({ dir: cfg.kokoroDir, work: dirs.work, timeout: timeout() }), { license: KOKORO_LICENSE });
      else a = Object.assign(elevenLabsAdapter({ key: cfg.elevenlabsKey, fetch: override?.fetch, timeout: override?.timeout }), { license: ELEVENLABS_LICENSE });
      adapters.set(key, a);
    }
    return a;
  }

  /** The voices of the configured engine → { engine, voices: [{ id, label, language, gender?, grade? }] }. */
  async function voices() {
    const a = adapter();
    return { engine: a.name, voices: await a.voices() };
  }

  const gradeRank = (g) => (g ? 'ABCDF'.indexOf(g[0]) * 3 + (g.includes('+') ? -1 : g.includes('-') ? 1 : 0) : 99);
  /** `count` voices that differ from one another: the best of each language and gender first. */
  function diverse(all, count) {
    const groups = new Map();
    for (const v of [...all].sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade))) {
      const k = `${v.language}|${v.gender ?? ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    }
    const lists = [...groups.values()].sort((a, b) => gradeRank(a[0].grade) - gradeRank(b[0].grade));
    const out = [];
    for (let round = 0; out.length < count && lists.some((l) => l[round]); round++) for (const l of lists) if (l[round] && out.length < count) out.push(l[round]);
    return out;
  }

  const checkSpeed = (speed) => { if (speed !== undefined && !(typeof speed === 'number' && speed >= 0.5 && speed <= 2)) throw new StudioError('speed: a number between 0.5 and 2 (1 is normal)'); };

  /**
   * Takes of one line in different voices, to choose from. Saved under <data>/speech/samples/ (a take already made is reused).
   * @param {{ line: string, voices?: string[], count?: number, speed?: number }} o
   */
  async function voiceSamples({ line, voices: ids, count = 3, speed = 1 }) {
    if (typeof line !== 'string' || !line.trim()) throw new StudioError('line: the sentence to speak (not empty)');
    if (line.length > MAX_LINE) throw new StudioError(`line: at most ${MAX_LINE} characters for a sample (this one has ${line.length})`);
    if (!Number.isInteger(count) || count < 1 || count > 12) throw new StudioError('count: a whole number from 1 to 12');
    checkSpeed(speed);
    const a = adapter();
    const all = await a.voices();
    let chosen;
    if (ids?.length) {
      chosen = ids.map((id) => {
        const v = all.find((x) => x.id === id);
        if (!v) throw new StudioError(`Unknown voice "${id}" for ${a.name}. Voices: ${all.map((x) => x.id).slice(0, 40).join(', ')}${all.length > 40 ? ', …' : ''}`);
        return v;
      });
    } else chosen = diverse(all, count);
    if (!chosen.length) throw new StudioError(`${a.name} has no voices to sample`);
    ensure(dirs.samples);
    const text = line.trim().replace(/\s+/g, ' ');
    const samples = [];
    for (const v of chosen) {
      const out = join(dirs.samples, `${sha1(JSON.stringify([a.name, v.id, speed, text])).slice(0, 10)}-${v.id.replace(/[^a-z0-9_-]+/gi, '_')}.wav`);
      let cached = true;
      if (!existsSync(out) || statSync(out).size < 100) { cached = false; await a.synthesize({ text, voice: v.id, speed, out }); }
      samples.push({ voice: v.id, label: v.label, language: v.language, gender: v.gender, grade: v.grade, path: out, seconds: r2(wavSeconds(out)), cached });
    }
    return { engine: a.name, line: text, speed, samples };
  }

  /**
   * A narration made entirely inside the studio: the voice speaks the script, the words are timed (by the voice service,
   * else by transcribing the take and aligning it to the script), the take is checked against the script, and the sound
   * asset with its words is created. The same name again is a new take (a new version) that keeps the anchors.
   * @param {{ script: string, voice: string, speed?: number, name: string, title?: string, description?: string, forClip?: string, language?: string, provenance?: any, author: string, check?: boolean }} o
   */
  async function generateNarration({ script, voice, speed = 1, name, title, description, forClip, language = 'en', provenance, author, check = true }) {
    if (!SLUG_RE.test(name ?? '')) throw new StudioError(`name: "${name}" is not a valid asset name: use lowercase letters, digits and dashes`);
    if (typeof script !== 'string' || !script.trim()) throw new StudioError('script: the text to speak (not empty)');
    if (script.length > MAX_SCRIPT) throw new StudioError(`script: at most ${MAX_SCRIPT} characters; split the narration into parts`);
    if (typeof voice !== 'string' || !voice) throw new StudioError('voice: a voice id (voice_samples lists some)');
    checkSpeed(speed);
    const a = adapter();
    const all = await a.voices();
    if (!all.some((v) => v.id === voice)) throw new StudioError(`Unknown voice "${voice}" for ${a.name}. Voices: ${all.map((x) => x.id).slice(0, 40).join(', ')}${all.length > 40 ? ', …' : ''}`);
    // fail before minutes of synthesis when the words could not be timed afterwards
    const cfg = config();
    const canTranscribe = modelsOf(cfg).length > 0 && (cfg.stub || ffmpegProblem().found) && !transcriptionProblems(cfg).length;
    if (a.name !== 'elevenlabs' && !canTranscribe) throw new StudioError(`The ${a.name} voice gives no word times, and there is no transcriber to time them. ${problemText([...transcriptionProblems(cfg), ...(ffmpegProblem().found ? [] : [{ piece: 'ffmpeg', how: HOW.ffmpeg }])]) || HOW.cli}`);
    const text = script.trim();
    const out = join(ensure(dirs.takes), `${name}-${sha1(JSON.stringify([a.name, voice, speed, text])).slice(0, 8)}.wav`);
    const s = await a.synthesize({ text, voice, speed, out });
    let timings = s.words, transcripts, models, tSeconds = 0;
    try {
      if (!timings || (check && canTranscribe)) {
        const results = await transcribeEach({ path: s.wavPath }, language);
        tSeconds = r2(results.reduce((n, r) => n + (r.cached ? 0 : r.seconds), 0));
        models = results.map((r) => r.model);
        timings ??= results[0].words;
        if (check) transcripts = results.map((r) => r.words);
      }
      const r = await audio.addNarration({
        slug: name, path: s.wavPath, script: text, timings, transcripts, language, author, forClip, title,
        voice: { engine: a.name, voice, speed, license: a.license, timedBy: s.words ? a.name : models?.[0] },
        // a generated take is AI-generated, under the engine's licence, made by the voice; what the caller says wins
        provenance: { license: a.license, aiGenerated: true, creator: `${a.name} voice ${voice}`, ...(provenance ?? {}) },
        description: description ?? `Narration (${a.name}, voice ${voice}): "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}" with the time of every word.`,
        tags: [a.name, 'generated'],
      });
      rmSync(s.wavPath, { force: true });
      return { ...r, voice: { engine: a.name, id: voice, speed }, seconds: { voice: s.seconds, transcription: tSeconds }, models, timedBy: s.words ? a.name : models?.[0] };
    } catch (e) {
      if (e instanceof StudioError) { e.message += ` (the voice take is kept at ${s.wavPath})`; }
      throw e;
    }
  }

  return { configure, status, transcribe, timingsFor, checkTake, voices, voiceSamples, generateNarration, dirs };
}
