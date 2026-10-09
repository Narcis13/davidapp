// A small MCP client for the studio's server: list its tools or call one from the command line.
// It talks to the server over stdio exactly as Claude Code does.
//
//   node scripts/mcp.mjs tools
//   node scripts/mcp.mjs call search_assets '{"query":"typewriter"}'
//   node scripts/mcp.mjs call create_asset '{"name":"x","source":"@file:assets/x.js"}'
//   node scripts/mcp.mjs call render_clip_frame '{"clip":"demo","t":2}' --out frame.png
//
// A string value "@file:<path>" is replaced by that file's text. Images in the result are written
// to --out (or next to the path the server reports) and their paths printed.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Start the studio MCP server as a child process and connect to it. @param {{ dataDir?: string, author?: string }} [o] */
export async function connect({ dataDir, author } = {}) {
  const env = { ...process.env };
  if (dataDir) env.STUDIO_DATA = dataDir;
  if (author) env.STUDIO_AUTHOR = author;
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/mcp/server.js')], env, stderr: 'inherit' });
  const client = new Client({ name: 'studio-cli', version: '0.1.0' });
  await client.connect(transport);
  return client;
}

/** Replace "@file:path" strings anywhere in the arguments with the file's contents, and "@path:path" with its absolute path. */
export function inlineFiles(value, base = process.cwd()) {
  if (typeof value === 'string' && value.startsWith('@file:')) return readFileSync(join(base, value.slice(6)), 'utf8');
  if (typeof value === 'string' && value.startsWith('@path:')) return join(base, value.slice(6));
  if (Array.isArray(value)) return value.map((v) => inlineFiles(v, base));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inlineFiles(v, base)]));
  return value;
}

/** Call a tool → { text, json, images: [Buffer], isError }. @param {any} client @param {string} name @param {any} [args] @param {{ timeout?: number }} [o] */
export async function callTool(client, name, args = {}, { timeout = 900000 } = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const texts = r.content.filter((c) => c.type === 'text').map((c) => c.text);
  const text = texts.join('\n');
  let json = null;
  for (const t of texts) { try { json = JSON.parse(t); } catch { /* prose */ } }
  return { text, json, images: r.content.filter((c) => c.type === 'image').map((c) => Buffer.from(c.data, 'base64')), isError: !!r.isError };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, name, raw, ...rest] = process.argv.slice(2);
  const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : null;
  const client = await connect();
  try {
    if (cmd === 'tools') {
      const { tools } = await client.listTools();
      for (const t of tools) console.log(`${t.name.padEnd(20)} ${t.description.split('. ')[0]}.`);
    } else if (cmd === 'call' && name) {
      const r = await callTool(client, name, inlineFiles(raw ? JSON.parse(raw) : {}));
      console.log(r.text);
      if (out && r.images[0]) { writeFileSync(out, r.images[0]); console.log(`image → ${out}`); }
      if (r.isError) process.exitCode = 1;
    } else {
      console.error('usage: node scripts/mcp.mjs tools | call <tool> \'<json args>\' [--out file.png]');
      process.exitCode = 2;
    }
  } finally {
    await client.close();
  }
}
