// "Run now": work one request with a headless Claude Code session (`claude -p`), started by the
// web server. The session sees only the studio's MCP server, and on it only the tools that read
// the studio and answer requests, so whatever it does lands as a proposal the user still has to
// accept. It has a timeout and can be cancelled; its progress is streamed into the request thread.
// Without the CLI on PATH (or STUDIO_CLAUDE_BIN) the studio hides the button; the inbox flow, an
// agent working the queue over MCP, works either way.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { ROOT } from '../render/host.js';
import { StudioError } from './library.js';

/** The tools a Run now session may call: reading the studio, and answering requests. */
export const RUN_TOOLS = ['studio_guide', 'search_assets', 'suggest_assets', 'get_asset', 'validate_asset', 'render_asset_frame', 'list_clips', 'get_clip', 'list_clip_assets', 'render_clip_frame',
  'list_requests', 'claim_request', 'get_request', 'reply_request', 'propose_asset_version', 'propose_new_asset', 'propose_clip_edit', 'complete_request'];

/** The claude CLI to run: STUDIO_CLAUDE_BIN, or `claude` on PATH. null when there is none. */
export function findClaude(env = process.env) {
  if (env.STUDIO_CLAUDE_BIN !== undefined) return env.STUDIO_CLAUDE_BIN && existsSync(env.STUDIO_CLAUDE_BIN) ? env.STUDIO_CLAUDE_BIN : null;
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of String(env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const n of names) {
      const file = join(dir, n);
      try { if (existsSync(file) && statSync(file).isFile()) return file; } catch { /* unreadable PATH entry */ }
    }
  }
  return null;
}

export function promptFor(r) {
  return [
    `You are Claude Code, working inside the Fablecut video studio through its MCP server (the tools named mcp__studio__*). The user asked for something in request #${r.id}: "${r.title}".`,
    '',
    `1. Call claim_request with id ${r.id}. It returns the request thread, its scope (the asset's source, schema and params on screen, or the clip's composition and the selected items) and rendered frames to look at.`,
    '2. If you need to, call studio_guide (the asset contract and the layout model), search_assets or suggest_assets (reuse what exists), get_asset, validate_asset (see a filmstrip of a draft) or render_clip_frame.',
    '3. Answer with one proposal: propose_asset_version (a new version of the asset), propose_new_asset, or propose_clip_edit (edit_clip operations). Give it a one-sentence summary. The user compares it with what is there now and accepts or rejects it in the studio.',
    '   If nothing should change, call complete_request with a short answer instead.',
    '',
    'Keep the change to what was asked, keep frames deterministic (f.t, params and f.rng only), and stop after the proposal.',
  ].join('\n');
}

/**
 * @param {any} studio
 * @param {{ env?: Record<string, string | undefined>, timeoutSeconds?: number, author?: string }} [o]
 */
export function createAgentRuns(studio, { env = process.env, timeoutSeconds = Number(env.STUDIO_AGENT_TIMEOUT ?? 600), author = 'claude-code-run' } = {}) {
  const { requests } = studio;
  /** request id → { child, timer, ended, reason } */
  const active = new Map();

  const available = () => !!findClaude(env);

  // a session that was running when the studio stopped is gone with it
  for (const r of studio.db.prepare("SELECT id, run FROM requests WHERE run LIKE '%\"status\":\"running\"%'").all()) {
    requests.setRun(r.id, { ...JSON.parse(r.run), status: 'failed', finishedAt: new Date().toISOString() });
    requests.note(r.id, 'studio', 'system', 'Run now: the studio restarted while the session was running.');
  }

  function configFile() {
    const dir = join(studio.dataDir, 'cache');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'agent-mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers: { studio: { command: process.execPath, args: [join(ROOT, 'src', 'mcp', 'server.js')], env: { STUDIO_DATA: studio.dataDir, STUDIO_AUTHOR: author } } } }, null, 1));
    return file;
  }

  /** What one line of the CLI's stream-json output says, as a short line for the thread (or null). */
  function describe(line) {
    let m;
    try { m = JSON.parse(line); } catch { return null; }
    if (m.type === 'assistant') {
      const parts = [];
      for (const c of m.message?.content ?? []) {
        if (c.type === 'text' && c.text?.trim()) parts.push(c.text.trim().slice(0, 600));
        if (c.type === 'tool_use') parts.push(`→ ${String(c.name).replace(/^mcp__studio__/, '')}`);
      }
      return parts.length ? parts.join('\n') : null;
    }
    if (m.type === 'result') return `Claude Code finished (${m.subtype}${m.num_turns ? `, ${m.num_turns} turns` : ''}${m.duration_ms ? `, ${Math.round(m.duration_ms / 1000)} s` : ''}).`;
    return null;
  }

  /** Start a session on the request. */
  function start(id, user) {
    const bin = findClaude(env);
    if (!bin) throw new StudioError('The claude CLI is not on PATH, so "Run now" is not available. Work the request from Claude Code over MCP instead.', 'unavailable');
    const r = requests.get(id);
    if (['done', 'cancelled'].includes(r.status)) throw new StudioError(`Request #${r.id} is ${r.status}`, 'conflict');
    if (active.has(r.id)) throw new StudioError(`Request #${r.id} already has a session running`, 'conflict');
    const args = ['-p', promptFor(r), '--output-format', 'stream-json', '--verbose',
      '--mcp-config', configFile(), '--strict-mcp-config', '--tools', '', '--allowedTools', RUN_TOOLS.map((t) => `mcp__studio__${t}`).join(','),
      '--permission-mode', 'dontAsk', '--restricted', '--no-session-persistence'];
    const child = spawn(bin, args, { cwd: ROOT, env: { ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const startedAt = new Date().toISOString();
    const run = { child, timer: null, ended: false, reason: null };
    active.set(r.id, run);
    requests.setRun(r.id, { status: 'running', startedAt, by: user, timeoutSeconds, pid: child.pid ?? null });
    requests.note(r.id, 'studio', 'system', `Run now: Claude Code started with the studio's tools only (stops after ${Math.round(timeoutSeconds / 60)} min).`);
    let buffer = '', stderr = '';
    child.stdout.on('data', (d) => {
      buffer += d.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const text = line && describe(line);
        if (text) { try { requests.note(r.id, author, 'progress', text); } catch { /* the database was busy; the next line will do */ } }
      }
    });
    child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d.toString('utf8'); });
    run.timer = setTimeout(() => stop(r.id, 'timeout'), timeoutSeconds * 1000);
    run.timer.unref?.();
    child.on('error', (e) => { stderr += e.message; });
    child.on('close', (code) => {
      clearTimeout(run.timer);
      active.delete(r.id);
      run.ended = true;
      const status = run.reason ?? (code === 0 ? 'done' : 'failed');
      requests.setRun(r.id, { status, startedAt, finishedAt: new Date().toISOString(), exitCode: code, by: user });
      const says = { done: 'Run now: the session ended.', failed: `Run now: the session failed (exit ${code}).${stderr.trim() ? ` ${stderr.trim().slice(0, 600)}` : ''}`, timeout: `Run now: stopped after ${timeoutSeconds} s.`, cancelled: 'Run now: cancelled.' };
      requests.note(r.id, 'studio', 'system', says[status] ?? `Run now: ${status}.`);
      requests.release(r.id, author);
    });
    return requests.get(r.id);
  }

  /** Stop a running session (cancel, timeout, shutdown). */
  function stop(id, reason = 'cancelled') {
    const run = active.get(Number(id));
    if (!run || run.ended) return false;
    run.reason = reason;
    run.child.kill('SIGTERM');
    setTimeout(() => { if (!run.ended) run.child.kill('SIGKILL'); }, 3000).unref?.();
    return true;
  }

  function cancel(id) {
    if (!stop(id, 'cancelled')) throw new StudioError(`Request #${id} has no session running`, 'conflict');
    return requests.get(id);
  }

  const stopAll = () => { for (const id of active.keys()) stop(id, 'cancelled'); };

  return { available, start, cancel, stopAll, isRunning: (id) => active.has(Number(id)) };
}
