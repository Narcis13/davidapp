// Where the speech tools are, read from the environment and an optional git-ignored `.env` at the repo
// root (the same keys). Nothing is found by guessing paths; the one lookup is `whisper-cli` on PATH.
// Models and voice engines live outside the repo, so the studio only ever holds their paths.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const KEYS = ['STUDIO_WHISPER_CLI', 'STUDIO_WHISPER_MODEL', 'STUDIO_WHISPER_MODEL_2', 'STUDIO_TTS', 'STUDIO_KOKORO_DIR', 'ELEVENLABS_API_KEY'];

/** KEY=value lines; `#` comments, optional `export `, single or double quotes. Only the speech keys are kept. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2];
    const q = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(v);
    if (q) v = q[2];
    else v = v.replace(/\s+#.*$/, '');
    if (KEYS.includes(m[1])) out[m[1]] = v;
  }
  return out;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** `whisper-cli` on PATH → its full path, or null. */
export function findOnPath(name, env = process.env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = join(dir, name + e);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/**
 * The speech configuration → { whisper: { cli, cliSource, model, model2 }, tts, kokoroDir, elevenlabsKey, stub, dotenv }.
 * The environment wins over the .env file. Paths are taken as given (relative ones against the working directory); `status` checks they exist.
 * @param {{ env?: Record<string, string | undefined>, dotenv?: string | false }} o
 */
export function resolveConfig({ env = process.env, dotenv = false } = {}) {
  let fileValues = {};
  let dotenvUsed = null;
  if (dotenv && existsSync(dotenv)) { fileValues = parseDotenv(readFileSync(dotenv, 'utf8')); dotenvUsed = dotenv; }
  const get = (k) => {
    const v = env[k] ?? fileValues[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const cliEnv = get('STUDIO_WHISPER_CLI');
  const cli = cliEnv ?? findOnPath('whisper-cli', env);
  const kokoroDir = get('STUDIO_KOKORO_DIR');
  const key = get('ELEVENLABS_API_KEY');
  const stub = env.STUDIO_SPEECH_STUB === '1'; // tests only: never read from .env
  let tts = get('STUDIO_TTS')?.toLowerCase() ?? null;
  const asked = tts !== null;
  if (!tts) tts = stub ? 'stub' : kokoroDir ? 'kokoro' : key ? 'elevenlabs' : 'none';
  return {
    whisper: { cli, cliSource: cliEnv ? 'STUDIO_WHISPER_CLI' : cli ? 'PATH' : null, model: get('STUDIO_WHISPER_MODEL'), model2: get('STUDIO_WHISPER_MODEL_2') },
    tts, ttsAsked: asked, kokoroDir, elevenlabsKey: key, stub, dotenv: dotenvUsed,
    set: KEYS.filter((k) => get(k) !== null),
  };
}

/** The Kokoro command line pieces for a configured directory: { dir, script } or null. */
export const kokoroPaths = (dir) => (dir ? { dir: join(dir, 'tts'), script: join(dir, 'tts', 'say.mjs') } : null);

export const exists = { file: isFile, dir: isDir };
