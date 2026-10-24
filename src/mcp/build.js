// One MCP server over the studio's tools. The stdio server (server.js) makes one for its process;
// the web server's /mcp route (Streamable HTTP, stateless) makes one per request.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const INSTRUCTIONS = 'A studio for making videos with code. Assets are parameterized JS functions (plus images, sounds, fonts) in a versioned library; clips are compositions of assets. Call studio_guide first. Search before you create: every clip should reuse what earlier clips left behind.';

/**
 * only: tool names to offer (the rest are not registered, so they cannot be called), or null for all.
 * @param {{ tools: any[], call: (name: string, args: any) => any }} toolset @param {Set<string> | null} [only]
 */
export function buildMcpServer({ tools, call }, only = null) {
  const server = new McpServer({ name: 'fablecut-studio', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  for (const tool of tools) {
    if (only && !only.has(tool.name)) continue;
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: !!tool.readOnly } }, (args) => call(tool.name, args));
  }
  return server;
}
