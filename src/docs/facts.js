// What the manual reads from the running studio, so the pages that list things (the MCP tools, the
// formats, the platform profiles, the fonts, the kit, the size of the library) can never go stale.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, FORMATS, MAX_CLIP_SECONDS } from '../core/engine.js';
import { PLATFORMS } from '../core/platforms.js';
import { ROOT, fontManifest } from '../render/host.js';

/** The MCP tools by area, in the order the reference page shows them. A tool missing here lands in "Other". */
export const TOOL_GROUPS = [
  { title: 'Start here', tools: ['studio_guide', 'suggest_assets'] },
  { title: 'Find and read assets', tools: ['search_assets', 'get_asset', 'list_clip_assets', 'diff_versions'] },
  { title: 'Write assets', tools: ['validate_asset', 'create_asset', 'update_asset', 'fork_asset'] },
  { title: 'Keep a tweak and organise', tools: ['save_defaults', 'create_preset', 'save_precomp', 'set_asset_metadata', 'organize_assets', 'add_asset_note'] },
  { title: 'Pictures, sounds, footage and fonts', tools: ['upload_image', 'list_undescribed', 'describe_asset', 'add_file_asset', 'bake_asset', 'bake_sequence', 'add_footage', 'footage_frames', 'add_font', 'list_fonts'] },
  { title: 'Compose clips', tools: ['list_clips', 'get_clip', 'create_clip', 'update_clip', 'edit_clip', 'remix_clip', 'repin_clip'] },
  { title: 'Look at frames', tools: ['render_asset_frame', 'render_clip_frame', 'frame_hashes'] },
  { title: 'Check a clip', tools: ['check_clip', 'layout_report', 'caption_pages', 'anchor_report', 'audio_report', 'export_stems'] },
  { title: 'Voice and transcription', tools: ['speech_status', 'voice_samples', 'generate_narration', 'add_narration', 'transcribe', 'check_transcript'] },
  { title: 'Render', tools: ['start_render', 'get_render', 'list_renders', 'cancel_render', 'render_report'] },
  { title: 'Licences, credits and the repo', tools: ['check_provenance', 'clip_credits', 'export_clip', 'import_clip'] },
  { title: 'Requests from the studio', tools: ['list_requests', 'claim_request', 'get_request', 'reply_request', 'propose_asset_version', 'propose_new_asset', 'propose_clip_edit', 'complete_request'] },
  { title: 'Reports', tools: ['reuse_report', 'compounding_report'] },
];

/** A zod schema's wrappers peeled off: its type name, whether it may be left out, and its description. @param {any} schema */
export function describeSchema(schema) {
  let s = schema, optional = false, description = schema?.description;
  for (let i = 0; i < 8 && s?.def; i++) {
    const t = s.def.type;
    if (t !== 'optional' && t !== 'default' && t !== 'nullable' && t !== 'prefault') break;
    if (t !== 'nullable') optional = true;
    s = s.def.innerType;
    description ??= s?.description;
  }
  const t = s?.def?.type ?? 'any';
  let type = t;
  if (t === 'enum') type = Object.values(s.def.entries ?? {}).map((v) => JSON.stringify(v)).join(' | ');
  else if (t === 'array') type = `array of ${describeSchema(s.def.element).type}`;
  else if (t === 'record') type = 'object (map)';
  else if (t === 'union') type = s.def.options.map((o) => describeSchema(o).type).join(' or ');
  else if (t === 'literal') type = (s.def.values ?? []).map((v) => JSON.stringify(v)).join(' | ');
  return { type, optional, description: description ?? '' };
}

/** The tools, grouped, each with its parameters. @param {any[]} tools */
export function toolFacts(tools) {
  const view = (t) => ({
    name: t.name, title: t.title ?? t.name, description: t.description ?? '', readOnly: !!t.readOnly,
    params: Object.entries(t.input ?? {}).map(([name, schema]) => ({ name, ...describeSchema(schema) })),
  });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const id = (title) => `tools-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const groups = TOOL_GROUPS.map((g) => ({ id: id(g.title), title: g.title, tools: g.tools.filter((n) => byName.has(n)).map((n) => view(byName.get(n))) }));
  const listed = new Set(TOOL_GROUPS.flatMap((g) => g.tools));
  const other = tools.filter((t) => !listed.has(t.name)).map(view);
  if (other.length) groups.push({ id: id('Other'), title: 'Other', tools: other });
  return { count: tools.length, groups: groups.filter((g) => g.tools.length) };
}

let pkg;
const packageVersion = () => (pkg ??= JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))).version;
const sides = (z) => `${z.top} / ${z.right} / ${z.bottom} / ${z.left}`;

/**
 * Everything the templates read about the studio, as plain JSON data.
 * @param {any} studio @param {{ tools?: any[], runNow?: boolean }} [o]
 */
export function liveFacts(studio, { tools = [], runNow = false } = {}) {
  const { library, clips, renders } = studio;
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const uploaded = safe(() => library.fontCatalog().uploaded(), []);
  const kit = safe(() => library.search({ tags: ['kit'], limit: 60, sort: 'name' }).assets, []);
  return {
    version: packageVersion(),
    engine: ENGINE_VERSION,
    maxClipSeconds: MAX_CLIP_SECONDS,
    dataDir: studio.dataDir,
    runNow,
    counts: {
      assets: safe(() => library.search({ limit: 1 }).total, 0),
      clips: safe(() => clips.listClips().length, 0),
      renders: safe(() => renders.list({ limit: 200 }).length, 0),
    },
    formats: Object.entries(FORMATS).map(([name, f]) => ({ name, label: f.label, size: `${f.width} × ${f.height}`, safe: sides(f.safe) })),
    platforms: Object.values(PLATFORMS).map((p) => ({ id: p.id, name: p.name, formats: p.formats.join(', '), zones: sides(p.zones), maxDuration: `${p.limits.maxDuration} s` })),
    fonts: [
      ...fontManifest().map((f) => ({ family: f.family, weights: [...new Set(f.files.map((x) => `${x.weight}${x.style === 'italic' ? ' italic' : ''}`))].join(', '), license: f.license ?? 'OFL-1.1', source: 'bundled' })),
      ...uploaded.map((u) => ({ family: u.family, weights: [...new Set(u.faces.map((x) => `${x.weight}${x.style === 'italic' ? ' italic' : ''}`))].join(', '), license: u.faces[0]?.license ?? 'unknown', source: 'added' })),
    ],
    kit: kit.map((a) => ({ ref: a.ref, slug: a.ref.replace(/@\d+$/, ''), title: a.title ?? a.ref, description: a.description ?? '' })),
    tools: toolFacts(tools),
  };
}
