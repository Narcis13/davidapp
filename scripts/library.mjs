// Move a clip between a library and the repo, with everything it needs (see src/studio/exchange.js).
//
//   STUDIO_DATA=<dir> node scripts/library.mjs export <clip> [--no-frames] [--force] [--dry-run]
//   STUDIO_DATA=<dir> node scripts/library.mjs import <folder> [--files <dir>]... [--replace] [--verify]
//
// --data <dir> says the data dir instead of STUDIO_DATA. One of them is required: the default data dir is the user's
// studio (./data), and this script never touches it by accident. The repo is this checkout, or STUDIO_REPO.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudio } from '../src/studio/studio.js';

const usage = 'usage: STUDIO_DATA=<dir> node scripts/library.mjs export <clip> [--no-frames] [--force] [--dry-run]\n       STUDIO_DATA=<dir> node scripts/library.mjs import <folder> [--files <dir>]... [--replace] [--verify]\n       (--data <dir> instead of STUDIO_DATA)';

/** Split the arguments: flags with a value (--files may repeat), switches, and the rest. */
function parse(argv) {
  const out = { rest: [], files: [], data: undefined, flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') out.data = argv[++i];
    else if (a === '--files') out.files.push(argv[++i]);
    else if (a.startsWith('--')) out.flags.add(a.slice(2));
    else out.rest.push(a);
  }
  return out;
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
export async function main(argv, log = console.log, err = console.error) {
  const { rest, files, data, flags, } = parse(argv);
  const [cmd, target] = rest;
  if (!['export', 'import'].includes(cmd) || !target) { err(usage); return 2; }
  const dataDir = data ?? process.env.STUDIO_DATA;
  if (!dataDir) {
    err(`Set STUDIO_DATA (or pass --data) to the data dir to use: the default is ./data, the user's studio, and this script does not touch it unasked.\n${usage}`);
    return 2;
  }
  const studio = createStudio({ dataDir: resolve(dataDir), role: 'cli', poolSize: 4 });
  try {
    const r = cmd === 'export'
      ? await studio.exchange.exportClip(target, { frames: !flags.has('no-frames'), force: flags.has('force'), dryRun: flags.has('dry-run') })
      : await studio.exchange.importClip(resolve(target), { files, replace: flags.has('replace'), verify: flags.has('verify') });
    log(JSON.stringify(r, null, 2));
    if (cmd === 'import' && r.verify?.differ?.length) return 3;
    return 0;
  } catch (e) {
    err(`✖ ${e.message}`);
    return 1;
  } finally {
    await studio.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
  // the render workers are unref'd, but be sure nothing keeps the process alive
  setTimeout(() => process.exit(), 200).unref();
}
