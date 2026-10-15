// Check a motion prompt against the studio: every MCP tool and tool option it names must exist, and none of the
// workarounds the studio has since made unnecessary may remain. The tools come from a real MCP server on an empty,
// throwaway data dir (so the list is the one a session following the prompt would see).
//
//   node scripts/prompt-tools.mjs [prompt.md] [--out report.txt]
//
// Names are the snake_case words of the prompt (`render_clip_frame`, `max_size`): each must be a tool, an input of a
// tool, or a word on the short list of snake_case words that are neither (env vars are UPPER_CASE and not checked).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './mcp.mjs';

const argv = process.argv.slice(2);
const prompt = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out') ?? 'motion_prompt_fablecut.md';
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;

/** snake_case words in a prompt that name no tool or option on purpose. */
const NOT_TOOLS = new Set(['snake_case']);

/**
 * Workarounds an earlier prompt needed and the studio no longer does: each is a phrase that must not come back.
 * [pattern, what the studio does instead]
 */
const WORKAROUNDS = [
  [/has no video asset|no tool\s+exposes|library\.addSequence/i, 'footage is an asset (add_footage)'],
  [/restart the studio|read fonts\.json when they start/i, 'fonts are assets that work at once (add_font)'],
  [/does not duck|premix a ducked|split the music around the voice/i, 'ducking is a property of the music item (duck)'],
  [/does not set loudness|holds sample peaks at 0\.95/i, 'composition.loudness sets the target; the render measures and corrects'],
  [/STUDIO_RENDER_WORKERS/, 'start_render takes workers'],
  [/sanitiser drops style sheets/i, 'internal style sheets are inlined and the upload reports what it could not keep'],
  [/has no scale|animatic renders at full size/i, 'start_render takes draft'],
  [/draws only the clip's own shape|reformat in\s+src\/core/i, 'render_clip_frame and frame_hashes take format'],
  [/version numbers differ between\s+libraries/i, 'export_clip / import_clip keep the refs'],
  [/guesses the spoken word|splitting the page evenly/i, 'captions are built from the words'],
  [/createStudio\(\)\.clipFrame|createStudio\(\)\.clipAudio|createStudio in\s+src\/studio/i, 'everything is an MCP tool'],
  [/takes stills, not video/i, 'footage is an asset'],
  [/align the audio to the script\. Save them/i, 'generate_narration / align: the studio aligns'],
  [/craft\/checks\//i, 'check_clip and the studio tools measure the checks'],
];

const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'prompt-tools-'));
const client = await connect({ dataDir, author: 'prompt-tools' });
let report;
try {
  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  const options = new Map();
  for (const t of tools) for (const k of Object.keys(t.inputSchema?.properties ?? {})) options.set(k, [...(options.get(k) ?? []), t.name]);
  const text = readFileSync(prompt, 'utf8');
  const lines = text.split(/\r?\n/);
  const seen = new Map();
  lines.forEach((line, i) => {
    // not inside a section tag (<render_contract>) or a path
    for (const m of line.matchAll(/(?<![\w./<-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w>-])/g)) {
      const w = m[0];
      if (!seen.has(w)) seen.set(w, []);
      seen.get(w).push(i + 1);
    }
  });
  const toolsNamed = [], optionsNamed = [], unknown = [];
  for (const [w, at] of [...seen].sort()) {
    if (names.has(w)) toolsNamed.push(w);
    else if (options.has(w)) optionsNamed.push(`${w} (${options.get(w).slice(0, 3).join(', ')}${options.get(w).length > 3 ? ', …' : ''})`);
    else if (!NOT_TOOLS.has(w)) unknown.push(`${w} (line ${at.join(', ')})`);
  }
  const left = [];
  for (const [re, instead] of WORKAROUNDS) lines.forEach((line, i) => { if (re.test(line)) left.push(`line ${i + 1}: "${line.trim()}" → ${instead}`); });
  // a phrase can wrap: check the text with the line breaks taken out too
  const flat = text.replace(/\s+/g, ' ');
  for (const [re, instead] of WORKAROUNDS) if (re.test(flat) && !left.some((l) => l.endsWith(instead))) left.push(`(across lines) ${re} → ${instead}`);
  report = [
    `Prompt: ${prompt}`,
    `MCP tools on the server: ${names.size}`,
    `Tools the prompt names (${toolsNamed.length}): ${toolsNamed.join(', ')}`,
    `Tool options the prompt names (${optionsNamed.length}): ${optionsNamed.join(', ')}`,
    `Unknown names (${unknown.length}): ${unknown.join(', ') || 'none'}`,
    `Workarounds left (${left.length}):${left.length ? `\n- ${left.join('\n- ')}` : ' none'}`,
    unknown.length || left.length ? 'FAIL' : 'PASS',
  ].join('\n');
} finally {
  await client.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log(report);
if (out) writeFileSync(out, `${report}\n`);
process.exit(report.endsWith('PASS') ? 0 : 1);
