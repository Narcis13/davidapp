#!/usr/bin/env node
// The studio's MCP server (stdio). Claude Code starts it from .mcp.json; it opens the same data
// directory as the studio web app, so what the AI creates shows up there at once. Renders it
// queues are picked up by this process (and by the web server, if that is running too).
//
//   STUDIO_DATA    data directory (default: <repo>/data)
//   STUDIO_AUTHOR  recorded as the author of assets and clips (default: mcp-client)
//   STUDIO_TOOLS   comma-separated tool names: only these are offered (a "Run now" session gets the read and answer tools)
//   STUDIO_RUNNER  0: do not pick up queued renders (a short-lived server would take a render down with it)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStudio } from '../studio/studio.js';
import { createTools } from './tools.js';

// stdout carries the protocol: anything else printed there would corrupt it
console.log = (...args) => console.error(...args);

const studio = createStudio({ role: 'mcp', runner: process.env.STUDIO_RUNNER !== '0' });
const { tools, call } = createTools(studio);
// an allowlist is enforced here, where the tools are: a tool that is not registered cannot be called
const only = process.env.STUDIO_TOOLS ? new Set(process.env.STUDIO_TOOLS.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const server = new McpServer(
  { name: 'fablecut-studio', version: '0.1.0' },
  { instructions: 'A studio for making videos with code. Assets are parameterized JS functions (plus images, sounds, fonts) in a versioned library; clips are compositions of assets. Call studio_guide first. Search before you create: every clip should reuse what earlier clips left behind.' },
);

for (const tool of tools) {
  if (only && !only.has(tool.name)) continue;
  server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: !!tool.readOnly } }, (args) => call(tool.name, args));
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await studio.close(); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

await server.connect(new StdioServerTransport());
