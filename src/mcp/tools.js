// The MCP tool surface: what an AI client can do in the studio. Each tool is a thin layer over
// the studio services; results are JSON text, plus PNG images wherever seeing the frame helps.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ENGINE_VERSION, FORMATS } from '../core/engine.js';
import { ROOT } from '../render/host.js';
import { StudioError } from '../studio/studio.js';
import { sideBySide } from '../render/host.js';

const FORMAT = z.enum(['vertical', 'horizontal', 'square']);
const REF = z.string().describe('Asset reference: "name" (latest version) or "name@3" (pinned)');
const PARAMS = z.record(z.string(), z.any()).describe('Parameter values, validated against the asset\'s schema');
const AUTHOR = z.string().optional().describe('Who is writing this (model id or person). Defaults to the server\'s STUDIO_AUTHOR.');
const COMPOSITION = z.record(z.string(), z.any()).describe('Clip composition: { format | width+height, fps, duration, background, seed, easing?, tracks: [{ id, name, type: visual|text|audio, hidden, locked, solo, muted, items: [{ id, asset, start, duration, params, fadeIn, fadeOut, opacity, blend, transform: { space: frame|safe, x, y, width, height (fractions of the space), anchorX, anchorY, scale, scaleX, scaleY, rotation (degrees) }, keyframes: { x|y|scale|rotation|opacity|params.<name>: [{ t, v, ease }] }, formats: { vertical|horizontal|square: { transform, keyframes, params, hidden, opacity } }, offset, assetDuration, gain (audio), beats (audio) }] }] }. Tracks draw bottom to top; a visual track also takes image assets (params.fit: contain|cover|fill). See studio_guide for the layout model.');

const compactAsset = (a) => ({ ref: a.ref, type: a.type, kind: a.kind, title: a.title, description: a.description, tags: a.tags, formats: a.formats, duration: a.duration, params: a.params, author: a.author, originClip: a.originClip, forkedFrom: a.forkedFrom, usedByClips: a.usedByClips });
const compactRender = (r) => ({ id: r.id, clip: r.clip, status: r.status, progress: Math.round(r.progress * 1000) / 1000, framesDone: r.framesDone, framesTotal: r.framesTotal, error: r.error, output: r.outputPath, poster: r.posterPath, srt: r.srt, log: r.log || undefined, stats: r.status === 'done' ? { renderSeconds: r.stats.renderSeconds, framesPerSecond: r.stats.framesPerSecond, realtimeFactor: r.stats.realtimeFactor, probe: r.stats.probe, frameHashes: r.stats.frameHashes } : undefined });

/** @param {any} studio @param {{ author?: string }} [o] */
export function createTools(studio, { author: defaultAuthor = process.env.STUDIO_AUTHOR ?? 'mcp-client' } = {}) {
  const { library, clips, renders, lineage } = studio;
  const who = (a) => a ?? defaultAuthor;
  const image = (name, png) => ({ png, path: studio.saveFrame(name, png) });

  const saved = (r, verb) => ({
    json: { [verb]: r.asset.ref, kind: r.asset.kind, params: r.asset.params, deps: r.asset.deps, originClip: r.asset.originClip, forkedFrom: r.asset.forkedFrom, warnings: r.warnings, testFrames: r.frames, console: r.logs?.length ? r.logs : undefined },
    images: [{ png: r.thumb, path: r.thumbPath }],
  });

  const compactRequest = (r) => ({ id: r.id, scope: r.scope, title: r.title, status: r.status, asset: r.assetRef, clip: r.clip, items: r.items, at: r.at, params: r.params, claimedBy: r.claimedBy,
    thread: r.messages.filter((m) => m.role !== 'progress').map((m) => `${m.role === 'user' ? 'user' : m.author} (${m.role}): ${m.body}`),
    proposals: r.proposals.map((p) => ({ id: p.id, kind: p.kind, target: p.target, base: p.base, status: p.status, summary: p.summary, result: p.result })) });

  async function requestContext(id) {
    const c = await studio.requests.context(id);
    return { json: { request: compactRequest(c.request), scope: c.scope, frames: c.images.map((i) => i.caption) }, images: c.images.map((i) => image(i.name, i.png)) };
  }

  const proposalResult = ({ request, proposal }) => ({
    json: { proposal: proposal.id, kind: proposal.kind, target: proposal.target, base: proposal.base, wouldBe: proposal.meta.wouldBe, warnings: proposal.meta.warnings, framesChecked: proposal.meta.framesChecked, request: request.id, status: request.status, next: 'The user reviews it in the studio. Stop here, or wait for their reply (claim_request again later).' },
    images: proposal.thumb ? [{ png: readFileSync(join(studio.dataDir, proposal.thumb)), path: join(studio.dataDir, proposal.thumb) }] : [],
  });

  /** @type {{ name: string, title: string, description: string, input: Record<string, any>, readOnly?: boolean, run: (a: any) => Promise<any> | any }[]} */
  const tools = [
    {
      name: 'studio_guide',
      title: 'Studio guide',
      description: 'How to write assets and clips in this studio: the asset contract, the frame object, the standard library, parameter types, and what is in the library right now. Read this before creating assets.',
      input: {},
      readOnly: true,
      run: () => {
        const fn = library.search({ type: 'function', limit: 200 });
        const stats = { engine: ENGINE_VERSION, formats: FORMATS, assets: library.search({ limit: 1 }).total, functionAssets: fn.total, clips: clips.listClips().map((c) => c.slug), fonts: library.fontFamilies(), tags: library.allTags().slice(0, 40).map((t) => `${t.tag} (${t.n})`) };
        return { text: `${readFileSync(join(ROOT, 'docs', 'ASSET_CONTRACT.md'), 'utf8')}\n\n## Workflow\n\n1. create_clip (empty) so new assets can record which clip they were made for.\n2. search_assets before writing anything: reuse, update_asset or fork_asset what exists.\n3. validate_asset to see a filmstrip of a draft; create_asset when it looks right.\n4. update_clip / edit_clip to place assets on the timeline; render_clip_frame (sheet: true) to look at the result.\n5. start_render, then get_render until it is done.\n\n## Library now\n\n${JSON.stringify(stats, null, 1)}` };
      },
    },
    {
      name: 'search_assets',
      title: 'Search assets',
      description: 'Find assets in the library by full text (name, description, tags, source), type, kind, tags, format and lineage. Returns the latest version of each match.',
      input: {
        query: z.string().optional().describe('Full-text query, e.g. "typewriter cursor"'),
        type: z.enum(['function', 'image', 'sound', 'font', 'sequence']).optional(),
        kind: z.enum(['visual', 'value', 'audio', 'motion', 'transition', 'effect']).optional().describe('Function assets only'),
        tags: z.array(z.string()).optional().describe('All of these tags'),
        format: FORMAT.optional().describe('Designed for this format'),
        origin_clip: z.string().optional().describe('Assets first produced by this clip'),
        used_by_clip: z.string().optional().describe('Assets this clip uses (any version)'),
        derived_from: z.string().optional().describe('Forks of this asset'),
        derivation: z.enum(['fork', 'bake', 'preset', 'precomp']).optional().describe('Only presets, precomps, bakes or forks'),
        favorite: z.boolean().optional(), featured: z.boolean().optional(), collection: z.string().optional(),
        needs_description: z.boolean().optional().describe('Uploads still waiting for a description'),
        sort: z.enum(['relevance', 'newest', 'used', 'name']).optional().describe('relevance (default): text rank boosted by featured, favourites and use'),
        facets: z.boolean().optional().describe('Also return counts per type, kind, tag, format, author, origin clip, used by, collection'),
        limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional(),
      },
      readOnly: true,
      run: (a) => {
        const r = library.search({ query: a.query, type: a.type, kind: a.kind, tags: a.tags, format: a.format, originClip: a.origin_clip, usedByClip: a.used_by_clip, derivedFrom: a.derived_from, derivation: a.derivation, favorite: a.favorite, featured: a.featured, collection: a.collection, needsDescription: a.needs_description, sort: a.sort, facets: !!a.facets, limit: a.limit ?? 40, offset: a.offset ?? 0 });
        return { json: { total: r.total, assets: r.assets.map(compactAsset), facets: r.facets } };
      },
    },
    {
      name: 'get_asset',
      title: 'Inspect an asset',
      description: 'Everything about one asset version: source code, parameter schema, pinned dependencies, version history, lineage (forked from, made for which clip) and which clips use it.',
      input: { ref: REF, include_source: z.boolean().optional().describe('Default true') },
      readOnly: true,
      run: (a) => ({ json: library.getAsset(a.ref, { includeSource: a.include_source !== false }) }),
    },
    {
      name: 'validate_asset',
      title: 'Try out asset source',
      description: 'Dry run for a draft: compiles the source in the sandbox, checks the contract and determinism, and returns a filmstrip of frames across its duration. Nothing is saved. Use it to look at an asset before create_asset or update_asset.',
      input: {
        source: z.string().describe('The asset source: one asset({...}) call'),
        name: z.string().optional().describe('The name it will be saved under (so error locations and self-references are right)'),
        params: PARAMS.optional(),
        format: FORMAT.optional(),
        duration: z.number().positive().optional().describe('Seconds to preview; defaults to the asset\'s natural duration or 3'),
        frames: z.number().int().min(1).max(24).optional().describe('Frames in the filmstrip (default 8)'),
      },
      readOnly: true,
      run: async (a) => {
        const sheet = await studio.assetSheet({ source: a.source, slug: a.name ?? 'draft', params: a.params, format: a.format, duration: a.duration, count: a.frames ?? 8 });
        return { json: { valid: true, wouldBe: sheet.ref, times: sheet.times }, images: [image(`draft-${a.name ?? 'asset'}-sheet`, sheet.png)] };
      },
    },
    {
      name: 'create_asset',
      title: 'Create an asset',
      description: 'Add a new function asset (graphics, animation, value or audio written as JS) to the library as version 1. The source is validated and test frames are rendered before it is accepted; a broken asset is rejected with the reason. Returns its thumbnail.',
      input: {
        name: z.string().describe('Unique lowercase-kebab name, e.g. "text-word-reveal"'),
        source: z.string().describe('The asset source: one asset({...}) call. See studio_guide.'),
        for_clip: z.string().optional().describe('The clip this asset is being made for (recorded as its origin)'),
        note: z.string().optional(),
        author: AUTHOR,
      },
      run: async (a) => saved(await library.createAsset({ slug: a.name, source: a.source, forClip: a.for_clip, note: a.note, author: who(a.author) }), 'created'),
    },
    {
      name: 'update_asset',
      title: 'Edit an asset (new version)',
      description: 'Save edited source as the next version of an existing asset. Versions are immutable: clips and assets that pinned an older version keep rendering exactly as before until they are re-pinned (repin_clip, or update the assets that use it).',
      input: {
        name: z.string(),
        source: z.string().describe('The complete new source'),
        note: z.string().optional().describe('What changed'),
        for_clip: z.string().optional().describe('The clip this version is being made for'),
        author: AUTHOR,
      },
      run: async (a) => saved(await library.updateAsset({ slug: a.name, source: a.source, forClip: a.for_clip, note: a.note, author: who(a.author) }), 'updated'),
    },
    {
      name: 'fork_asset',
      title: 'Fork an asset',
      description: 'Create a new asset that starts from another asset\'s source (optionally with changed source). The fork records where it came from.',
      input: {
        ref: REF.describe('The asset version to fork'),
        name: z.string().describe('Name of the new asset'),
        source: z.string().optional().describe('Changed source; omit to copy as-is'),
        for_clip: z.string().optional(),
        note: z.string().optional(),
        author: AUTHOR,
      },
      run: async (a) => saved(await library.forkAsset({ ref: a.ref, slug: a.name, source: a.source, forClip: a.for_clip, note: a.note, author: who(a.author) }), 'created'),
    },
    {
      name: 'add_file_asset',
      title: 'Add an image or sound file',
      description: 'Add an image (png, jpg, webp, svg) or sound (wav, mp3, m4a, ogg) from a local file as a library asset. Only add media you made or that is properly licensed; say which in `license`.',
      input: {
        name: z.string(),
        type: z.enum(['image', 'sound']),
        path: z.string().describe('Absolute path of the file'),
        description: z.string(),
        tags: z.array(z.string()).optional(),
        license: z.string().optional().describe('e.g. "original", "CC0"'),
        for_clip: z.string().optional(),
        author: AUTHOR,
      },
      run: async (a) => ({ json: { added: compactAsset((await library.addFileAsset({ slug: a.name, type: a.type, path: a.path, description: a.description, tags: a.tags ?? [], license: a.license, forClip: a.for_clip, author: who(a.author) })).asset) } }),
    },
    {
      name: 'bake_asset',
      title: 'Bake an asset into a file asset',
      description: 'Render one frame of a visual asset and store it as an image asset, or synthesize an audio asset and store it as a WAV sound asset. The new asset keeps its lineage back to the source. Use it for textures, logos, stills and one-shot sounds.',
      input: {
        ref: REF,
        name: z.string().describe('Name of the new image or sound asset'),
        description: z.string(),
        params: PARAMS.optional(),
        t: z.number().min(0).optional(),
        duration: z.number().positive().optional(),
        width: z.number().int().min(16).max(3840).optional(),
        height: z.number().int().min(16).max(3840).optional(),
        transparent: z.boolean().optional().describe('Keep the background transparent (default true)'),
        tags: z.array(z.string()).optional(),
        for_clip: z.string().optional(),
        author: AUTHOR,
      },
      run: async (a) => {
        const src = library.getAsset(a.ref, { includeSource: false });
        if (src.kind === 'audio') {
          // an audio asset bakes to a WAV sound asset
          const duration = a.duration ?? src.duration ?? 2;
          const wav = await studio.clipAudio({ composition: { width: 320, height: 180, fps: 30, duration, tracks: [{ type: 'audio', items: [{ id: 'bake', asset: src.ref, start: 0, duration, params: a.params ?? {} }] }] } });
          const r = await library.addFileAsset({ slug: a.name, type: 'sound', path: wav, description: a.description, tags: a.tags ?? ['baked'], forClip: a.for_clip, author: who(a.author), derivedFrom: src.ref, meta: { bakedFrom: src.ref, params: a.params ?? {} } });
          return { json: { added: compactAsset(r.asset), duration: r.asset.duration } };
        }
        const frame = await studio.assetFrame({ ref: a.ref, params: a.params, t: a.t, duration: a.duration, width: a.width ?? 1080, height: a.height ?? 1080, background: a.transparent === false ? '#101018' : 'rgba(0,0,0,0)' });
        const r = await library.addFileAsset({ slug: a.name, type: 'image', data: frame.png, ext: '.png', description: a.description, tags: a.tags ?? ['baked'], forClip: a.for_clip, author: who(a.author), derivedFrom: frame.ref, meta: { bakedFrom: frame.ref, params: a.params ?? {} } });
        return { json: { added: compactAsset(r.asset) }, images: [image(`baked-${a.name}`, frame.png)] };
      },
    },
    {
      name: 'bake_sequence',
      title: 'Bake an asset into a frame sequence',
      description: 'Render a visual asset (a 3D scene, a heavy effect, anything expensive) once into a frame-sequence asset: PNG frames with a transparent background. Use the sequence as a layer in any clip (params.fit, params.loop); it is fast to preview and render, and it keeps its lineage back to the source. Cached: the same asset version, params, size, fps and duration return the sequence already baked (cached: true).',
      input: {
        ref: REF, name: z.string().describe('Name of the sequence asset'), params: PARAMS.optional(),
        format: FORMAT.optional(), width: z.number().int().min(16).max(3840).optional(), height: z.number().int().min(16).max(3840).optional(),
        fps: z.number().int().min(1).max(60).optional(), duration: z.number().positive().max(60).optional(),
        title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), for_clip: z.string().optional(), author: AUTHOR,
      },
      run: async (a) => {
        const r = await studio.bakeSequence({ ref: a.ref, slug: a.name, params: a.params, format: a.format, width: a.width, height: a.height, fps: a.fps, duration: a.duration, title: a.title, description: a.description, tags: a.tags, forClip: a.for_clip, author: who(a.author) });
        return { json: { sequence: r.asset.ref, cached: r.cached, frames: r.frames, seconds: r.seconds, bakedFrom: r.asset.forkedFrom, meta: r.asset.meta }, images: r.asset.thumb ? [{ png: readFileSync(join(studio.dataDir, r.asset.thumb)), path: join(studio.dataDir, r.asset.thumb) }] : [] };
      },
    },
    {
      name: 'render_asset_frame',
      title: 'Render an asset frame to PNG',
      description: 'Draw one frame of a saved asset (or a filmstrip across its duration with sheet: true) so you can see it. Returns the PNG and the path it was written to.',
      input: {
        ref: REF,
        params: PARAMS.optional(),
        t: z.number().min(0).optional().describe('Seconds into the asset (default: 60% of its duration)'),
        duration: z.number().positive().optional(),
        format: FORMAT.optional(),
        sheet: z.boolean().optional().describe('Return a filmstrip of several frames instead of one'),
        frames: z.number().int().min(1).max(24).optional().describe('Frames in the filmstrip (default 8)'),
        max_size: z.number().int().min(64).max(3840).optional().describe('Longest side of the returned PNG (default 960)'),
      },
      readOnly: true,
      run: async (a) => {
        if (a.sheet) {
          const s = await studio.assetSheet({ ref: a.ref, params: a.params, duration: a.duration, format: a.format, count: a.frames ?? 8 });
          return { json: { ref: s.ref, times: s.times }, images: [image(`${s.ref}-sheet`, s.png)] };
        }
        const r = await studio.assetFrame({ ref: a.ref, params: a.params, t: a.t, duration: a.duration, format: a.format, maxSize: a.max_size ?? 960, hash: true });
        return { json: { ref: r.ref, width: r.width, height: r.height, sha256: r.hash }, images: [image(`${r.ref}-t${a.t ?? 'mid'}`, r.png)] };
      },
    },
    {
      name: 'list_clips',
      title: 'List clips',
      description: 'Every clip in the studio with its format, duration, revision and how many assets it uses.',
      input: {},
      readOnly: true,
      run: () => ({ json: { clips: clips.listClips() } }),
    },
    {
      name: 'get_clip',
      title: 'Inspect a clip',
      description: 'A clip\'s composition (timeline of tracks and items with pinned asset versions and params) and the assets it uses.',
      input: { clip: z.string().describe('Clip name') },
      readOnly: true,
      run: (a) => ({ json: clips.getClip(a.clip) }),
    },
    {
      name: 'create_clip',
      title: 'Create a clip',
      description: 'Create a clip. Give a composition, or just format/fps/duration to start empty (so assets can then be created with for_clip). Asset references are pinned to exact versions, params are validated against each asset\'s schema, and sample frames are drawn to catch run-time errors.',
      input: {
        name: z.string().describe('Unique lowercase-kebab name'),
        title: z.string().optional(),
        description: z.string().optional(),
        format: FORMAT.optional(),
        fps: z.number().int().min(1).max(60).optional(),
        duration: z.number().positive().max(120).optional().describe('Seconds (max 120)'),
        background: z.string().optional(),
        composition: COMPOSITION.optional(),
        author: AUTHOR,
      },
      run: async (a) => {
        const r = await clips.createClip({ slug: a.name, title: a.title, description: a.description, format: a.format, fps: a.fps, duration: a.duration, background: a.background, composition: a.composition, author: who(a.author) });
        return { json: { created: r.clip.slug, format: r.clip.format, duration: r.clip.duration, revision: r.clip.revision, checked: r.checked, assets: r.clip.assets.map((x) => `${x.ref} (${x.relation})`) } };
      },
    },
    {
      name: 'update_clip',
      title: 'Replace a clip\'s composition',
      description: 'Save a new composition (and/or title and description) for a clip. Unpinned asset references are pinned to the latest version; references that are already pinned stay where they are.',
      input: { clip: z.string(), title: z.string().optional(), description: z.string().optional(), composition: COMPOSITION.optional() },
      run: async (a) => {
        const r = await clips.updateClip(a.clip, { title: a.title, description: a.description, composition: a.composition });
        return { json: { updated: r.clip.slug, revision: r.clip.revision, duration: r.clip.duration, checked: r.checked, assets: r.clip.assets.map((x) => `${x.ref} (${x.relation})`) } };
      },
    },
    {
      name: 'edit_clip',
      title: 'Edit a clip with operations',
      description: 'Apply small edits to a clip without resending the whole composition: timeline, layers and layout. Operations: { op: "set", duration?, fps?, background?, seed?, format? } · { op: "add_track", track: { id, type, name }, index? } · { op: "remove_track", id } · { op: "move_track", id, index } (draw order: the last track is in front) · { op: "update_track", id, patch: { name, hidden, locked, solo, muted } } · { op: "add_item", track, item } · { op: "update_item", id, patch } (patch.params merges; null removes a param) · { op: "remove_item", id } · { op: "move_item", id, track, index? } · { op: "set_transform", id, transform, format? } (merges; null removes a field; with format it edits that format\'s override) · { op: "set_keyframes", id, prop, keyframes, format? } · { op: "add_keyframe", id, prop, t, v, ease?, format? } · { op: "remove_keyframe", id, prop, t, format? } · { op: "set_override", id, format, override } · { op: "split_item", id, at } · { op: "duplicate_item", id, newId?, start?, track? }.',
      input: { clip: z.string(), operations: z.array(z.record(z.string(), z.any())).min(1) },
      run: async (a) => {
        const r = await clips.editClip(a.clip, a.operations);
        return { json: { updated: r.clip.slug, revision: r.clip.revision, checked: r.checked, tracks: r.clip.composition.tracks.map((t) => ({ id: t.id, type: t.type, items: t.items.map((i) => `${i.id}: ${i.asset} ${i.start}s+${i.duration}s`) })) } };
      },
    },
    {
      name: 'remix_clip',
      title: 'Remix a clip into another format',
      description: 'Create a new clip from an existing one in a different format (e.g. horizontal → vertical). Assets re-flow from the new frame size and safe zones.',
      input: { clip: z.string(), name: z.string().describe('Name of the new clip'), format: FORMAT, title: z.string().optional(), author: AUTHOR },
      run: async (a) => {
        const r = await clips.remixClip({ slug: a.clip, newSlug: a.name, format: a.format, title: a.title, author: who(a.author) });
        return { json: { created: r.clip.slug, format: r.clip.format, remixedFrom: r.clip.remixedFrom, checked: r.checked } };
      },
    },
    {
      name: 'repin_clip',
      title: 'Move a clip to newer asset versions',
      description: 'Re-pin a clip\'s asset references to the latest versions, in place or (with name) as a new clip, leaving the original untouched. `only` limits it to some assets.',
      input: { clip: z.string(), name: z.string().optional().describe('Create a new clip with this name instead of changing the clip'), only: z.array(z.string()).optional().describe('Asset names to move (default: all)'), author: AUTHOR },
      run: async (a) => {
        const r = await clips.repinClip({ slug: a.clip, newSlug: a.name, only: a.only, author: who(a.author) });
        return { json: { clip: r.clip.slug, revision: r.clip.revision, checked: r.checked, assets: r.clip.assets.map((x) => x.ref) } };
      },
    },
    {
      name: 'list_clip_assets',
      title: 'List the assets a clip uses',
      description: 'The pinned asset versions in a clip\'s closure (direct and nested), with where each came from: created for this clip, reused from an earlier clip, or a new version of an earlier asset.',
      input: { clip: z.string() },
      readOnly: true,
      run: (a) => ({ json: { clip: a.clip, assets: clips.clipAssets(a.clip).map((x) => ({ ref: x.ref, type: x.type, kind: x.kind, direct: x.direct, depth: x.depth, relation: x.relation, originClip: x.originClip, forkedFrom: x.forkedFrom, latestVersion: x.latestVersion })) } }),
    },
    {
      name: 'render_clip_frame',
      title: 'Render a clip frame to PNG',
      description: 'Draw one frame of a clip at time t, or (sheet: true) a contact sheet of frames across the clip, straight from the composition without encoding. Use it to look at your work.',
      input: {
        clip: z.string(),
        t: z.number().min(0).optional().describe('Seconds'),
        sheet: z.boolean().optional().describe('Return a contact sheet instead of one frame'),
        frames: z.number().int().min(1).max(48).optional().describe('Frames in the sheet (default 12)'),
        from: z.number().min(0).optional().describe('Sheet: start of the range in seconds'),
        to: z.number().min(0).optional().describe('Sheet: end of the range in seconds'),
        max_size: z.number().int().min(64).max(3840).optional().describe('Longest side of the returned PNG (default 960)'),
      },
      readOnly: true,
      run: async (a) => {
        if (a.sheet) {
          const s = await studio.clipSheet({ clip: a.clip, count: a.frames ?? 12, from: a.from, to: a.to });
          return { json: { clip: a.clip, frames: s.frames }, images: [image(`${a.clip}-sheet${a.from !== undefined ? `-${a.from}-${a.to}` : ''}`, s.png)] };
        }
        const r = await studio.clipFrame({ clip: a.clip, t: a.t ?? 0, maxSize: a.max_size ?? 960, hash: true });
        return { json: { clip: a.clip, t: r.t, frame: r.frame, sha256: r.hash }, images: [image(`${a.clip}-t${r.t.toFixed(2)}`, r.png)] };
      },
    },
    {
      name: 'frame_hashes',
      title: 'Hash clip frames',
      description: 'SHA-256 of the raw pixels of a clip at the given times. Equal hashes mean identical frames: use it to check determinism and that an old clip is unchanged after its assets got new versions.',
      input: { clip: z.string(), times: z.array(z.number().min(0)).min(1).max(64) },
      readOnly: true,
      run: async (a) => ({ json: { clip: a.clip, frames: await studio.frameHashes({ clip: a.clip, times: a.times }) } }),
    },
    {
      name: 'start_render',
      title: 'Render a clip to MP4',
      description: 'Queue a render of the clip to H.264/AAC MP4. Returns the render id at once; poll get_render, or pass wait_seconds to wait here for up to that long.',
      input: { clip: z.string(), format: FORMAT.optional().describe('Render the same composition in another format; each item\'s overrides for that format apply'), wait_seconds: z.number().min(0).max(900).optional() },
      run: async (a) => {
        let r = renders.enqueue({ clip: a.clip, format: a.format, requestedBy: defaultAuthor });
        if (a.wait_seconds) r = await renders.wait(r.id, a.wait_seconds * 1000);
        return { json: compactRender(r) };
      },
    },
    {
      name: 'get_render',
      title: 'Render status',
      description: 'Status and progress of a render; when done: the MP4 path, poster, SRT, timings, ffprobe facts and sampled frame hashes.',
      input: { id: z.number().int(), wait_seconds: z.number().min(0).max(900).optional().describe('Wait up to this long for it to finish') },
      readOnly: true,
      run: async (a) => ({ json: compactRender(a.wait_seconds ? await renders.wait(a.id, a.wait_seconds * 1000) : renders.get(a.id)) }),
    },
    {
      name: 'list_renders',
      title: 'List renders',
      description: 'The render queue and history, newest first.',
      input: { status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']).optional(), clip: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      readOnly: true,
      run: (a) => ({ json: { renders: renders.list({ status: a.status, clip: a.clip, limit: a.limit ?? 20 }).map(compactRender) } }),
    },
    {
      name: 'cancel_render',
      title: 'Cancel a render',
      description: 'Cancel a queued or running render.',
      input: { id: z.number().int() },
      run: (a) => ({ json: compactRender(renders.cancel(a.id)) }),
    },
    {
      name: 'organize_assets',
      title: 'Tag, favourite, feature or collect assets',
      description: 'Change many assets at once: add or remove tags (a metadata edit, no new versions), mark them favourite or featured (both raise them in search), or put them in a collection (made if it does not exist). Featured is for the pieces you want the next clip to start from.',
      input: { names: z.array(z.string()).min(1).max(500), add_tags: z.array(z.string()).optional(), remove_tags: z.array(z.string()).optional(), favorite: z.boolean().optional(), featured: z.boolean().optional(), collection: z.string().optional(), author: AUTHOR },
      run: (a) => ({ json: { ...library.bulk({ slugs: a.names, addTags: a.add_tags ?? [], removeTags: a.remove_tags ?? [], favorite: a.favorite, featured: a.featured, collection: a.collection, author: who(a.author) }), collections: library.listCollections() } }),
    },

    // ── tweak and keep ───────────────────────────────────────────────────────────────────
    {
      name: 'save_defaults',
      title: 'Save params as an asset\'s new defaults',
      description: 'Make a parameter set the defaults of a new version of an asset: the source is rewritten in place (each `default:` in the params declaration), validated and saved as the next version. Clips that pin older versions are unchanged.',
      input: { name: z.string(), params: PARAMS, note: z.string().optional(), for_clip: z.string().optional(), author: AUTHOR },
      run: async (a) => saved(await library.saveDefaults({ slug: a.name, params: a.params, note: a.note, forClip: a.for_clip, author: who(a.author) }), 'updated'),
    },
    {
      name: 'create_preset',
      title: 'Save params as a preset',
      description: 'A preset is a new named asset: another asset plus a chosen parameter set as its defaults. It pins the base version, gets its own thumbnail, shows in search and lineage, and is used in clips like any asset (its params can still be changed per item).',
      input: { base: REF.describe('The asset (version) the preset is made from'), name: z.string().describe('Name of the preset asset'), params: PARAMS.describe('The parameter values it keeps'), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), for_clip: z.string().optional(), author: AUTHOR },
      run: async (a) => saved(await library.createPreset({ base: a.base, slug: a.name, params: a.params, title: a.title, description: a.description, tags: a.tags, forClip: a.for_clip, author: who(a.author) }), 'created'),
    },
    {
      name: 'save_precomp',
      title: 'Save clip layers as one asset (precomp)',
      description: 'Group layers of a clip into a new visual asset that draws them with their timing, layout, motions and effects (f.layers). expose turns item params into the precomp\'s own params (current values become defaults), so an intro or a stat scene becomes one reusable piece. With replace: true the items are swapped for one item using it.',
      input: { clip: z.string(), items: z.array(z.string()).min(1), name: z.string(), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), expose: z.array(z.object({ item: z.string(), param: z.string(), name: z.string().optional() })).optional(), replace: z.boolean().optional(), author: AUTHOR },
      run: async (a) => {
        const r = await clips.savePrecomp({ clip: a.clip, items: a.items, slug: a.name, title: a.title, description: a.description, tags: a.tags, expose: a.expose ?? [], replace: !!a.replace, author: who(a.author) });
        return { json: { created: r.asset.ref, params: r.asset.params, uses: r.asset.deps, clip: r.clip ? { revision: r.clip.revision } : undefined } };
      },
    },
    {
      name: 'set_asset_metadata',
      title: 'Edit an asset\'s title, description or tags',
      description: 'Change how an asset is named, described and tagged in the library, without a new code version (it applies to every version and to search). null resets a field to what the source declares. Describing an upload takes it off the needs-description list.',
      input: { name: z.string(), title: z.string().nullable().optional(), description: z.string().nullable().optional(), tags: z.array(z.string()).nullable().optional(), author: AUTHOR },
      run: (a) => { const r = library.setMetadata({ slug: a.name, title: a.title, description: a.description, tags: a.tags, author: who(a.author) }); return { json: { updated: r.ref, title: r.title, description: r.description, tags: r.tags, declared: r.declared } }; },
    },
    {
      name: 'diff_versions',
      title: 'Compare two versions of an asset',
      description: 'A unified diff of two versions\' source, plus the same frame of each side by side (same t and params).',
      input: { name: z.string(), a: z.number().int().describe('Older version'), b: z.number().int().describe('Newer version'), t: z.number().min(0).optional(), params: PARAMS.optional() },
      readOnly: true,
      run: async (a) => {
        const d = library.diffVersions(a.name, a.a, a.b);
        const images = [];
        const row = library.requireVersion(d.b.ref);
        if (row.type === 'function' && row.kind === 'visual') {
          const [fa, fb] = await Promise.all([d.a.ref, d.b.ref].map((ref) => studio.assetFrame({ ref, params: a.params ?? {}, t: a.t, maxSize: 640 })));
          images.push(image(`${a.name}-v${a.a}-vs-v${a.b}`, await sideBySide(fa.png, fb.png)));
        }
        return { text: d.unified, json: { a: d.a.ref, b: d.b.ref, added: d.added, removed: d.removed }, images };
      },
    },

    // ── uploads and their descriptions ───────────────────────────────────────────────────
    {
      name: 'upload_image',
      title: 'Upload an image or SVG',
      description: 'Add a PNG, JPEG, WebP or SVG file as an image asset, the same way a drag-and-drop in the studio does: the type is read from the bytes, a file already in the library is not added twice (duplicate: true), an SVG is sanitised (scripts, event handlers, external references and foreignObject are dropped; a DOCTYPE rejects it) and rasterised, and the size, a dominant palette and a thumbnail are extracted. It then waits on the needs-description list.',
      input: { path: z.string().optional().describe('Absolute path of the file'), data_base64: z.string().optional().describe('Or the file\'s bytes, base64'), name: z.string().describe('File name, e.g. "skyline.jpg"'), for_clip: z.string().optional(), author: AUTHOR },
      run: async (a) => {
        if (!a.path && !a.data_base64) throw new StudioError('Give path or data_base64');
        const data = a.path ? readFileSync(a.path) : Buffer.from(a.data_base64, 'base64');
        const r = await studio.uploads.upload({ name: a.name, data, author: who(a.author), forClip: a.for_clip });
        return { json: { asset: r.asset.ref, duplicate: r.duplicate, removedFromSvg: r.removed, width: r.asset.meta.width, height: r.asset.meta.height, palette: r.asset.meta.palette, needsDescription: r.asset.needsDescription }, images: [{ png: readFileSync(join(studio.dataDir, r.asset.thumb)), path: join(studio.dataDir, r.asset.thumb) }] };
      },
    },
    {
      name: 'list_undescribed',
      title: 'Uploads waiting for a description',
      description: 'Uploaded images that still need a title, description, tags and suggested uses, with each image attached so you can see it. Describe each one with describe_asset.',
      input: { limit: z.number().int().min(1).max(20).optional() },
      readOnly: true,
      run: (a) => {
        const list = studio.uploads.undescribed(a.limit ?? 8);
        return {
          json: { count: list.length, uploads: list.map((x, i) => ({ image: i + 1, ref: x.ref, file: x.meta.originalName, format: x.meta.format, size: `${x.meta.natural?.width ?? x.meta.width}×${x.meta.natural?.height ?? x.meta.height}`, palette: x.meta.palette, removedFromSvg: x.meta.sanitized?.removed, vector: !!x.meta.vector })) },
          images: list.map((x) => ({ png: readFileSync(join(studio.dataDir, x.thumb)), path: join(studio.dataDir, x.thumb) })),
        };
      },
    },
    {
      name: 'describe_asset',
      title: 'Describe an uploaded image',
      description: 'Write what an uploaded image is: a short title, one or two sentences of description (what it shows, its style and colours), search tags, and suggested uses in a clip ("full-frame background with a slow Ken Burns", "logo drawn on with f.svg"). The studio shows it at once and library search finds the image by these tags.',
      input: { name: z.string(), title: z.string(), description: z.string(), tags: z.array(z.string()).min(1), uses: z.array(z.string()).optional(), author: AUTHOR },
      run: (a) => { const r = studio.uploads.describe({ slug: a.name, title: a.title, description: a.description, tags: a.tags, uses: a.uses, author: who(a.author) }); return { json: { described: r.ref, title: r.title, tags: r.tags, uses: r.suggestedUses, needsDescription: r.needsDescription } }; },
    },

    // ── requests from the studio ─────────────────────────────────────────────────────────
    {
      name: 'list_requests',
      title: 'List requests from the studio',
      description: 'The queue of requests the user wrote in the studio ("a neon lower third", "make this slower", "add a stat scene at 0:12"), newest first, each scoped to an asset, a clip (and selected items) or the library. Status: open (waiting for an agent), working (claimed), review (a proposal waits for the user), done, cancelled.',
      input: { status: z.array(z.enum(['open', 'working', 'review', 'done', 'cancelled'])).optional().describe('Default: open, working and review'), limit: z.number().int().min(1).max(100).optional() },
      readOnly: true,
      run: (a) => ({ json: { requests: studio.requests.list({ status: a.status ?? ['open', 'working', 'review'], limit: a.limit ?? 20 }).map((r) => ({ id: r.id, scope: r.scope, title: r.title, status: r.status, asset: r.assetRef, clip: r.clip, items: r.items, at: r.at, claimedBy: r.claimedBy, messages: r.messages, pendingProposals: r.pending, createdAt: r.createdAt })) } }),
    },
    {
      name: 'claim_request',
      title: 'Claim a request and read it',
      description: 'Take a request to work on (the given id, or the oldest open one) and get everything needed to do it: the thread, the scope (asset source, schema and the params on screen; or the clip composition, the selected items and the playhead) and rendered frames. The claim holds for 15 minutes and is renewed by replying or proposing. With wait_seconds, waits for a request to arrive. Answer with propose_asset_version, propose_new_asset or propose_clip_edit (the user accepts it in the studio), or complete_request.',
      input: { id: z.number().int().optional(), wait_seconds: z.number().min(0).max(300).optional().describe('When the queue is empty, wait up to this long for a request') },
      run: async (a) => {
        const end = Date.now() + (a.wait_seconds ?? 0) * 1000;
        let r = studio.requests.claim({ id: a.id, agent: defaultAuthor });
        while (!r && Date.now() < end) {
          await new Promise((res) => setTimeout(res, 1000));
          r = studio.requests.claim({ id: a.id, agent: defaultAuthor });
        }
        if (!r) return { json: { claimed: null, message: 'No open requests.' } };
        return requestContext(r.id);
      },
    },
    {
      name: 'get_request',
      title: 'Read a request',
      description: 'A request\'s thread, proposals and scope (with rendered frames) without claiming it.',
      input: { id: z.number().int() },
      readOnly: true,
      run: (a) => requestContext(a.id),
    },
    {
      name: 'reply_request',
      title: 'Reply in a request thread',
      description: 'Write in the request\'s thread: a question for the user, or a note about the work. The user sees it live in the studio.',
      input: { id: z.number().int(), message: z.string() },
      run: (a) => ({ json: compactRequest(studio.requests.reply({ id: a.id, author: defaultAuthor, role: 'agent', body: a.message })) }),
    },
    {
      name: 'propose_asset_version',
      title: 'Propose a new version of an asset',
      description: 'Answer a request with a new version of an asset (default: the asset the request is about). The source is validated and test frames are drawn now, but nothing is saved: the user compares it side by side with the current version in the studio and accepts it (then it becomes the next version), rejects it, or replies with more feedback. Returns the proposal\'s thumbnail.',
      input: { request: z.number().int(), name: z.string().optional().describe('The asset; default: the request\'s asset'), source: z.string().describe('The complete new source'), note: z.string().optional().describe('What changed (becomes the version note)'), summary: z.string().describe('One sentence for the user: what this proposal does') },
      run: async (a) => proposalResult(await studio.requests.propose({ id: a.request, agent: defaultAuthor, kind: 'asset-version', name: a.name, source: a.source, note: a.note, summary: a.summary })),
    },
    {
      name: 'propose_new_asset',
      title: 'Propose a new asset',
      description: 'Answer a request with a new asset (validated now, saved only when the user accepts). For a clip request the new asset is recorded as made for that clip.',
      input: { request: z.number().int(), name: z.string().describe('Unique lowercase-kebab name'), source: z.string(), note: z.string().optional(), summary: z.string() },
      run: async (a) => proposalResult(await studio.requests.propose({ id: a.request, agent: defaultAuthor, kind: 'new-asset', name: a.name, source: a.source, note: a.note, summary: a.summary })),
    },
    {
      name: 'propose_clip_edit',
      title: 'Propose an edit to a clip',
      description: 'Answer a request with edit_clip operations on a clip (default: the request\'s clip). They are applied to a copy, validated and drawn now; the clip changes only when the user accepts. On accept they are re-applied to the clip as it is then, so the user can keep editing meanwhile. Returns the frame at the request\'s playhead.',
      input: { request: z.number().int(), clip: z.string().optional(), operations: z.array(z.record(z.string(), z.any())).min(1).describe('The same operations as edit_clip'), summary: z.string() },
      run: async (a) => proposalResult(await studio.requests.propose({ id: a.request, agent: defaultAuthor, kind: 'clip-edit', clip: a.clip, operations: a.operations, summary: a.summary })),
    },
    {
      name: 'complete_request',
      title: 'Complete a request without a proposal',
      description: 'Close a request with an answer when nothing should change (a question answered, or the asked-for thing already exists).',
      input: { id: z.number().int(), message: z.string().optional() },
      run: (a) => ({ json: compactRequest(studio.requests.complete({ id: a.id, agent: defaultAuthor, body: a.message })) }),
    },
    {
      name: 'reuse_report',
      title: 'Reuse report',
      description: 'How the library compounds: for each clip, which assets it created and which it reused from earlier clips (as-is, as a new version, or as a fork).',
      input: {},
      readOnly: true,
      run: () => ({ text: lineage.report() }),
    },
  ];

  /**
   * Run a tool by name and shape the result as MCP content. Errors come back as isError results.
   * @returns {Promise<any>}
   */
  async function call(name, args = {}) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}"` }] };
    try {
      const out = await tool.run(args);
      const content = [];
      const paths = (out.images ?? []).map((i) => i.path);
      if (out.text) content.push({ type: 'text', text: out.text });
      if (out.json) content.push({ type: 'text', text: JSON.stringify(paths.length ? { ...out.json, png: paths.length === 1 ? paths[0] : paths } : out.json, null, 1) });
      for (const img of out.images ?? []) content.push({ type: 'image', data: Buffer.from(img.png).toString('base64'), mimeType: 'image/png' });
      return { content };
    } catch (e) {
      const known = e instanceof StudioError;
      return { isError: true, content: [{ type: 'text', text: known ? e.message : `Internal error in ${name}: ${e?.stack ?? e}` }] };
    }
  }

  return { tools, call };
}
