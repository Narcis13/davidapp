// Running an outside program (whisper-cli, the Kokoro script) as a child process with a timeout and an
// error that says what went wrong, instead of a hang or a stack trace.

import { spawn } from 'node:child_process';
import { StudioError } from '../library.js';

const tail = (s, n = 600) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

/**
 * Run `cmd args` to completion → { stdout, stderr, seconds }. Rejects with a StudioError when the program is missing,
 * does not finish within `timeout` ms (it is killed), or exits with a code other than 0.
 * @param {string} cmd @param {string[]} args @param {{ cwd?: string, timeout?: number, what?: string, env?: Record<string, string | undefined> }} [o]
 */
export function runProgram(cmd, args, { cwd, timeout = 600000, what = cmd, env } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let out = '', err = '', done = false, timer = null;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true, env: env ?? process.env }); } catch (e) { return reject(new StudioError(`Could not start ${what}: ${e.message}`)); }
    child.stdout.on('data', (d) => { out += d; if (out.length > 1e6) out = out.slice(-5e5); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 1e6) err = err.slice(-5e5); });
    child.stdin.on('error', () => {});
    child.stdin.end();
    child.on('error', (e) => finish(reject, new StudioError(e.code === 'ENOENT' ? `Could not start ${what}: "${cmd}" was not found` : `Could not start ${what}: ${e.message}`)));
    child.on('close', (code, signal) => {
      if (code === 0) return finish(resolve, { stdout: out, stderr: err, seconds: Math.round((performance.now() - t0)) / 1000 });
      finish(reject, new StudioError(`${what} failed (${signal ? `signal ${signal}` : `exit code ${code}`}): ${tail(err || out) || 'no output'}`));
    });
    timer = setTimeout(() => {
      child.kill();
      finish(reject, new StudioError(`${what} did not finish within ${Math.round(timeout / 1000)} s and was stopped`));
    }, timeout);
  });
}
