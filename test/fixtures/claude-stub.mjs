#!/usr/bin/env node
// A stand-in for the `claude` CLI in tests ("Run now" without a model). It takes the same flags the
// studio passes, reads the prompt from stdin, connects to the MCP server named in --mcp-config exactly as Claude Code would,
// works the request named in the prompt, and prints stream-json lines like `claude -p --verbose`.
//
//   CLAUDE_STUB_MODE=work (default)  claim, propose a new version of the request's asset, finish
//   CLAUDE_STUB_MODE=hang            print one line and wait forever (timeouts and cancel)
//   CLAUDE_STUB_MODE=fail            exit 3 with a message on stderr

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const say = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const mode = process.env.CLAUDE_STUB_MODE ?? 'work';

say({ type: 'system', subtype: 'init', tools: (flag('--allowedTools') ?? '').split(','), mcp_servers: [{ name: 'studio', status: 'connected' }], args });
if (mode === 'fail') { process.stderr.write('stub: failing on purpose\n'); process.exit(3); }
if (mode === 'hang') { say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Thinking for a very long time…' }] } }); setInterval(() => {}, 1000); await new Promise(() => {}); }

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const id = Number(/request #(\d+)/.exec(prompt)?.[1]);
const server = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.studio;
const client = new Client({ name: 'claude-stub', version: '0.0.1' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env }, stderr: 'ignore' }));
const call = async (name, a) => {
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: `mcp__studio__${name}`, input: a }] } });
  const r = /** @type {any} */ (await client.callTool({ name, arguments: a }));
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};
try {
  const ctx = await call('claim_request', { id });
  say({ type: 'assistant', message: { content: [{ type: 'text', text: `Working on "${ctx.request.title}".` }] } });
  const source = ctx.scope.source.replace(/default: '#[0-9a-f]{6}'/i, "default: '#22ccff'");
  await call('propose_asset_version', { request: id, source: source === ctx.scope.source ? `${source}\n// tweaked` : source, summary: 'Stub: the default colour is now cyan.' });
  say({ type: 'result', subtype: 'success', result: 'Proposed a new version.', num_turns: 3, duration_ms: 1200 });
} catch (e) {
  say({ type: 'result', subtype: 'error_during_execution', result: e.message });
  process.exitCode = 1;
} finally {
  await client.close();
}
