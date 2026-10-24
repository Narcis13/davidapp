#!/usr/bin/env node
// The studio's MCP server (stdio). Claude Code starts it from .mcp.json; it opens the same data
// directory as the studio web app, so what the AI creates shows up there at once. Renders it
// queues are picked up by this process (and by the web server, if that is running too).
//
//   STUDIO_DATA    data directory (default: <repo>/data)
//   STUDIO_AUTHOR  recorded as the author of assets and clips (default: mcp-client)
//   STUDIO_TOOLS   comma-separated tool names: only these are offered (a "Run now" session gets the read and answer tools)
//   STUDIO_RUNNER  0: do not pick up queued renders (a short-lived server would take a render down with it)

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStudio } from '../studio/studio.js';
import { createTools } from './tools.js';
import { buildMcpServer } from './build.js';
import { closeFootageService } from '../render/footage.js';

// stdout carries the protocol: anything else printed there would corrupt it
console.log = (...args) => console.error(...args);

const studio = createStudio({ role: 'mcp', runner: process.env.STUDIO_RUNNER !== '0' });
// an allowlist is enforced where the tools are registered: a tool that is not registered cannot be called
const only = process.env.STUDIO_TOOLS ? new Set(process.env.STUDIO_TOOLS.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const server = buildMcpServer(createTools(studio), only);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await studio.close(); await closeFootageService(); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

await server.connect(new StdioServerTransport());
