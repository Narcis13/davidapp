// The studio's HTTP server: a JSON API over the studio services, the media it produces (with
// Range support so video seeks), and the static UI. The UI loads src/core straight from /core,
// so the preview runs the same runtime the renderer does.

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { ENGINE_VERSION, FORMATS, makeRef } from '../core/engine.js';
import { ROOT, FONTS_DIR, fontManifest } from '../render/host.js';
import { StudioError } from '../studio/studio.js';
import { createAgentRuns } from '../studio/agent-run.js';
import { MAX_UPLOAD } from '../studio/uploads.js';
import { json as parseJson } from '../db/db.js';
import { zonesOf } from '../studio/inspect.js';
import { moreRoutes } from './routes/index.js';
import { fromQuery } from '../studio/provenance.js';
import { createDocs } from '../docs/docs.js';
import { createTools } from '../mcp/tools.js';
import { shareOf } from '../studio/share.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.srt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon',
};
const STATUS = { invalid: 400, rejected: 422, not_found: 404, conflict: 409, forbidden: 403, unsupported: 415, unavailable: 501, too_large: 413 };
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const TOKEN_COOKIE = 'studio_token';
const DROPPED = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED']);
/** Shown instead of the studio when STUDIO_TOKEN is set and this browser has not signed in. */
const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Sign in · Fablecut</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b10; color: #f4f1ea; font: 16px/1.4 system-ui, sans-serif; }
  form { width: min(22rem, calc(100% - 2rem)); display: grid; gap: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0; }
  p { margin: 0; color: #b7b3c7; }
  input { font: inherit; padding: 0.6rem 0.7rem; border-radius: 8px; border: 1px solid #3a3848; background: #16161f; color: inherit; }
  button { font: inherit; padding: 0.6rem 0.7rem; border: 0; border-radius: 8px; background: #ffd166; color: #0b0b10; font-weight: 700; }
  .err { color: #ff8b8b; min-height: 1.4em; }
</style>
</head>
<body>
<form>
  <h1>Fablecut</h1>
  <p>This studio is not open to the network. Enter its token to continue.</p>
  <label>Token <input name="token" type="password" autocomplete="current-password" required></label>
  <p class="err" role="alert"></p>
  <button type="submit">Open the studio</button>
</form>
<script>
document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.querySelector('.err');
  err.textContent = '';
  const token = new FormData(e.target).get('token');
  let res;
  try { res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); }
  catch { err.textContent = 'The studio server is not reachable.'; return; }
  if (res.ok) { location.reload(); return; }
  err.textContent = 'That token was not accepted.';
});
</script>
</body>
</html>`;
/** What /share/<slug> answers when there is no such clip. @param {string} slug (the route allows only a-z, 0-9 and dashes) */
const shareMissing = (slug) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Clip not found · Fablecut</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b10; color: #f4f1ea; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 26rem; padding: 1rem; }
  h1 { font-size: 1.25rem; }
  p { color: #b7b3c7; }
</style>
</head>
<body><main><h1>This clip is not here</h1><p>There is no clip called “${slug}” on this studio. It may have been renamed or removed: ask whoever sent the link for a new one.</p></main></body>
</html>`;
const secretEqual = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
/** The manual's pages draw no script and no inline style, so they are served under a policy that allows neither. */
const DOCS_CSP = "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
/** Packages the studio page may load from node_modules (Faqir UI's stylesheets for the manual, CodeMirror 6 and what it imports). */
const VENDOR = new Set(['@faqir-ui/core', 'codemirror','@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@codemirror/lang-javascript', '@codemirror/search', '@codemirror/autocomplete', '@codemirror/lint',
  '@lezer/common', '@lezer/highlight', '@lezer/lr', '@lezer/javascript', 'style-mod', 'w3c-keyname', 'crelt', '@marijn/find-cluster-break']);

/**
 * hosts: the Host names the server answers to (default: loopback names only), or null for any.
 *   null is refused unless `token` is set: a studio on the network is otherwise open to whoever can reach it.
 * token: when set (at least 16 characters), every request needs this secret, as a bearer token or the sign-in cookie.
 * env: where to look for the claude CLI for "Run now" (PATH, STUDIO_CLAUDE_BIN).
 * @param {any} studio @param {{ log?: (line: string) => void, author?: string, hosts?: string[] | null, token?: string, env?: Record<string, string | undefined> }} [o]
 */
export function createStudioServer(studio, { log = () => {}, author = process.env.STUDIO_AUTHOR ?? 'studio-user', hosts = LOCAL_HOSTS, token = undefined, env = process.env } = {}) {
  if (token !== undefined && (typeof token !== 'string' || token.length < 16)) throw new Error('STUDIO_TOKEN must be at least 16 characters');
  if (hosts === null && !token) throw new Error('Refusing to answer every Host name without STUDIO_TOKEN. Bind the studio to 127.0.0.1, or set STUDIO_TOKEN to a long random secret.');
  const { library, clips, renders, lineage, requests, uploads } = studio;
  const runs = createAgentRuns(studio, { env });
  const UI = join(ROOT, 'src', 'ui');
  const CORE = join(ROOT, 'src', 'core');

  const send = (res, status, body, headers = {}) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...headers });
    res.end(data);
  };
  const png = (res, data) => send(res, 200, Buffer.from(data), { 'content-type': 'image/png' });

  const realRoots = new Map();
  /** True when `full` is `base` or a file inside it, after symlinks are resolved. */
  function insideRoot(base, full) {
    let root = realRoots.get(base);
    if (!root) {
      try { root = realpathSync(base); } catch { return false; }
      realRoots.set(base, root);
    }
    let real;
    try { real = realpathSync(full); } catch { return false; }
    const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const r = fold(real), b = fold(root);
    return r === b || r.startsWith(b.endsWith(sep) ? b : b + sep);
  }

  /** Serve a file under `base`, refusing anything that resolves outside it, including through a symlink. Supports Range. */
  function file(req, res, base, rel, { cache = 'no-cache', headers: extra = {} } = {}) {
    let decoded;
    try { decoded = decodeURIComponent(rel); } catch { return send(res, 400, { error: 'Malformed path' }); }
    const full = resolve(base, normalize(decoded).replace(/^([/\\])+/, ''));
    if (full !== base && !full.startsWith(base + sep)) return send(res, 403, { error: 'Forbidden' });
    if (!existsSync(full) || !statSync(full).isFile()) return send(res, 404, { error: `Not found: ${rel}` });
    if (!insideRoot(base, full)) return send(res, 403, { error: 'Forbidden' });
    const { size } = statSync(full);
    // nosniff + sandbox: an SVG image asset opened directly must not run script on this origin
    const headers = { 'content-type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': cache, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...(extname(full).toLowerCase() === '.svg' && base !== UI ? { 'content-security-policy': 'sandbox' } : {}), ...extra };
    // pipeline closes the file when the client goes away (video scrubbing aborts requests all the time)
    const stream = (opts) => pipeline(createReadStream(full, opts), res, () => {});
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) return send(res, 416, { error: 'Range not satisfiable' }, { 'content-range': `bytes */${size}` });
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      return stream({ start, end });
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    return stream();
  }

  /**
   * The request body, at most `limit` bytes. A larger one is refused only after the rest of it has
   * been read and dropped: throwing inside the loop destroys the socket, and so does an answer that
   * closes the connection while the client is still sending (measured: 9 of 10 such answers were
   * lost), and either way the browser shows a network error instead of the reason.
   */
  async function read(req, limit, message) {
    const chunks = [];
    let size = 0, over = Number(req.headers['content-length']) > limit;
    for await (const c of req) {
      if (over) continue;
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; } else chunks.push(c);
    }
    if (over) throw new StudioError(message, 'too_large');
    return chunks;
  }

  async function body(req) {
    const chunks = await read(req, 8e6, 'The request body is larger than 8 MB');
    if (!chunks.length) return {};
    // JSON only: a form post from another site cannot carry this content type without a preflight
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new StudioError('Send the request body as application/json', 'unsupported');
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StudioError('The request body is not valid JSON'); }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new StudioError('The request body must be a JSON object');
    return data;
  }

  const fontFile = (x) => ({ url: `/fonts/${x.file}`, weight: x.weight, style: x.style });
  // ext: the family's Latin Extended files, registered under their own alias (see fontString in core/lib/text.js)
  // uploaded families are listed for the font menus without files: a clip's preview loads the files it pins through its bundle
  const fonts = () => [
    ...fontManifest().map((f) => ({ family: f.family, slug: f.slug, license: f.license, files: f.files.map(fontFile), ext: f.ext ? { family: f.ext.family, files: f.ext.files.map(fontFile) } : undefined })),
    ...library.fontCatalog().uploaded().map((u) => ({ family: u.family, slug: u.faces[0].slug, license: u.faces[0].license, uploaded: true, files: [] })),
  ];

  /** The browser-side bundle: sources and pinned deps, with image URLs instead of paths. */
  function browserBundle(b) {
    const images = {};
    for (const [ref, img] of Object.entries(b.images ?? {})) images[ref] = { url: `/media/${library.requireVersion(ref).file}`, vector: img.vector ?? null };
    // a sequence's frames are fetched as the preview needs them: /media/files/<slug>@<v>/000123.png
    const sequences = {};
    for (const [ref, s] of Object.entries(b.sequences ?? {})) sequences[ref] = { url: `/media/${s.file}/`, frames: s.frames, fps: s.fps, width: s.width, height: s.height };
    // footage frames come decoded from the server, as the render workers get them: /api/footage/<slug>/<v>/<index>.png|jpg
    const footage = {};
    for (const [ref, v] of Object.entries(b.videos ?? {})) footage[ref] = { url: `/api/footage/${ref.replace('@', '/')}/`, meta: v.meta };
    // the uploaded fonts a clip pins: one alias per pinned set, the files by URL (served from /media/files/)
    const fonts = Object.fromEntries(Object.entries(b.fonts ?? {}).map(([alias, set]) => [alias, { family: set.family, files: set.files.map((f) => ({ ref: f.ref, url: `/media/${f.file}`, weight: f.weight, style: f.style })) }]));
    return { key: b.key, assets: b.assets, images, sequences, footage, ...(b.fonts ? { fonts } : {}), beats: b.beats ?? [], words: b.words, captions: b.captions, lane: b.lane };
  }

  /** What the editor needs to know about each asset version a composition names. */
  function describeRefs(composition) {
    const out = {};
    for (const track of composition.tracks) for (const item of track.items) {
      if (out[item.asset]) continue;
      const row = library.requireVersion(item.asset);
      out[item.asset] = { ref: item.asset, slug: row.slug, version: row.version, latestVersion: row.latest_version, type: row.type, kind: row.kind, title: row.title ?? row.slug, description: row.description, duration: row.duration, schema: parseJson(row.schema, {}), thumb: row.thumb };
    }
    return out;
  }

  async function clipBundle(composition) {
    const pinned = clips.prepare(composition).composition;
    const { bundle, audio } = await clips.bundleFor(pinned);
    // the words (for the timeline) and the anchors' distances come with it, so the editor shows the narration
    return { composition: pinned, bundle: browserBundle(bundle), beats: audio.beats, words: bundle.words ?? [], captions: bundle.captions ?? null, anchors: clips.anchorReport(pinned), zones: zonesOf(pinned), assets: describeRefs(pinned) };
  }

  /** @type {[string, RegExp, (ctx: any) => any, { raw?: boolean }?][]} */
  const routes = [
    ['GET', /^\/api\/status$/, () => ({
      name: 'Fablecut', engine: ENGINE_VERSION, formats: FORMATS, fonts: fonts(), tags: library.allTags(), agent: { runNow: runs.available() },
      counts: { assets: library.search({ limit: 1 }).total, clips: clips.listClips().length, renders: renders.list({ limit: 200 }).length },
    })],

    // assets
    ['GET', /^\/api\/assets$/, ({ query }) => library.search({
      query: query.get('query') ?? undefined, type: query.get('type') || undefined, kind: query.get('kind') || undefined,
      tags: query.get('tag') ? query.get('tag').split(',').filter(Boolean) : undefined, format: query.get('format') || undefined,
      originClip: query.get('origin') || undefined, usedByClip: query.get('usedBy') || undefined, derivedFrom: query.get('derivedFrom') || undefined,
      author: query.get('author') || undefined, derivation: query.get('derivation') || undefined,
      needsDescription: query.get('needsDescription') ? query.get('needsDescription') === '1' : undefined,
      favorite: query.get('favorite') === '1' || undefined, featured: query.get('featured') === '1' || undefined, recent: query.get('recent') === '1' || undefined,
      collection: query.get('collection') || undefined, sort: query.get('sort') || undefined, facets: query.get('facets') === '1',
      limit: int(query.get('limit') ?? 100, 100, 1, 200), offset: int(query.get('offset') ?? 0, 0, 0, 1e9),
    })],
    ['POST', /^\/api\/assets\/bulk$/, ({ data }) => library.bulk({ slugs: data.slugs, addTags: data.addTags, removeTags: data.removeTags, favorite: data.favorite, featured: data.featured, collection: data.collection, author: data.author ?? author })],
    ['PUT', /^\/api\/assets\/([a-z0-9-]+)\/favorite$/, ({ params, data }) => { library.setFavorite(params[0], data.on !== false); return { ok: true }; }],
    ['PUT', /^\/api\/assets\/([a-z0-9-]+)\/featured$/, ({ params, data }) => { library.setFeatured(params[0], data.on !== false); return { ok: true }; }],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/opened$/, ({ params }) => { library.touch(params[0], 'opened'); return { ok: true }; }],
    ['GET', /^\/api\/collections$/, () => ({ collections: library.listCollections() })],
    ['POST', /^\/api\/collections\/([a-z0-9-]+)\/remove$/, ({ params, data }) => { library.removeFromCollection(params[0], data.slugs ?? []); return { collections: library.listCollections() }; }],
    ['POST', /^\/api\/assets\/validate$/, async ({ data }) => {
      const d = await studio.draftBundle({ slug: data.name ?? 'draft', source: data.source });
      const m = d.validation.meta;
      return { ok: true, ref: d.ref, kind: m.kind, schema: m.schema, duration: m.duration, formats: m.formats, warnings: d.validation.warnings, bundle: browserBundle(d.bundle) };
    }],
    ['POST', /^\/api\/assets$/, async ({ data }) => {
      const r = await library.createAsset({ slug: data.name, source: data.source, note: data.note, forClip: data.forClip, author: data.author ?? author });
      return { asset: r.asset, warnings: r.warnings };
    }],
    ['GET', /^\/api\/assets\/([a-z0-9-]+)$/, ({ params, query }) => ({ ...library.getAsset(query.get('version') ? makeRef(params[0], Number(query.get('version'))) : params[0]), notes: studio.compounding.notesOf(params[0]), examples: studio.compounding.examples(params[0]) })],
    ['GET', /^\/api\/compounding$/, () => ({ clips: clips.listClips().map((c) => studio.compounding.metrics(c.slug)), table: studio.compounding.table() })],
    ['GET', /^\/api\/assets\/([a-z0-9-]+)\/bundle$/, ({ params, query }) => {
      const a = library.getAsset(query.get('version') ? makeRef(params[0], Number(query.get('version'))) : params[0], { includeSource: false });
      // with=ref,ref: assets and images chosen through parameters of type asset/image in the playground
      const extra = (query.get('with') ?? '').split(',').filter(Boolean);
      return { ref: a.ref, bundle: browserBundle(library.bundle([a.ref, ...extra])) };
    }],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/versions$/, async ({ params, data }) => {
      const r = await library.updateAsset({ slug: params[0], source: data.source, note: data.note, forClip: data.forClip, author: data.author ?? author });
      return { asset: r.asset, warnings: r.warnings };
    }],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/fork$/, async ({ params, data }) => {
      const r = await library.forkAsset({ ref: data.version ? makeRef(params[0], data.version) : params[0], slug: data.name, source: data.source, note: data.note, forClip: data.forClip, author: data.author ?? author });
      return { asset: r.asset, warnings: r.warnings };
    }],
    // tweak and keep: new defaults, presets, metadata, diffs
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/defaults$/, async ({ params, data }) => {
      const r = await library.saveDefaults({ slug: params[0], params: data.params, note: data.note, author: data.author ?? author });
      return { asset: r.asset, warnings: r.warnings };
    }],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/preset$/, async ({ params, data }) => {
      const r = await library.createPreset({ base: data.version ? makeRef(params[0], data.version) : params[0], slug: data.name, params: data.params, title: data.title, description: data.description, tags: data.tags, author: data.author ?? author });
      return { asset: r.asset, warnings: r.warnings };
    }],
    ['PUT', /^\/api\/assets\/([a-z0-9-]+)\/metadata$/, ({ params, data }) => library.setMetadata({ slug: params[0], title: data.title, description: data.description, tags: data.tags, provenance: data.provenance, version: data.version, author: data.author ?? author })],
    ['GET', /^\/api\/assets\/([a-z0-9-]+)\/diff$/, ({ params, query }) => library.diffVersions(params[0], int(query.get('a'), 1, 1, 1e6), int(query.get('b'), 1, 1, 1e6))],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/bake$/, async ({ params, data }) => {
      const r = await studio.bakeSequence({ ref: data.version ? makeRef(params[0], data.version) : params[0], slug: data.name, params: data.params, format: data.format, width: data.width, height: data.height, fps: data.fps, duration: data.duration, title: data.title, description: data.description, tags: data.tags, author: data.author ?? author });
      return { asset: r.asset, cached: r.cached, frames: r.frames };
    }],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/precomp$/, async ({ params, data }) => {
      const r = await clips.savePrecomp({ clip: params[0], items: data.items, slug: data.name, title: data.title, description: data.description, tags: data.tags, expose: data.expose ?? [], replace: !!data.replace, author: data.author ?? author });
      return { asset: r.asset, clip: r.clip };
    }],
    // the exact frame, drawn by the renderer (PNG)
    ['POST', /^\/api\/frame\/asset$/, async ({ data, res }) => png(res, (await studio.assetFrame({ ref: data.ref, source: data.source, slug: data.name, params: data.params, t: data.t, duration: data.duration, format: data.format, width: data.width, height: data.height, background: data.background, maxSize: data.maxSize })).png)],
    ['POST', /^\/api\/frame\/clip$/, async ({ data, res }) => png(res, (await studio.clipFrame({ clip: data.clip, composition: data.composition, isolate: data.isolate, t: data.t, maxSize: data.maxSize })).png)],
    ['POST', /^\/api\/audio\/asset$/, async ({ data, req, res }) => {
      // an audio asset on its own, as a one-item clip
      const row = library.requireVersion(data.ref);
      const duration = Math.min(60, data.duration ?? row.duration ?? 4);
      const wav = await studio.clipAudio({ composition: { width: 320, height: 180, fps: 30, duration, tracks: [{ type: 'audio', items: [{ id: 'a', asset: data.ref, start: 0, duration, params: data.params ?? {} }] }] } });
      return file(req, res, studio.dataDir, wav.slice(studio.dataDir.length + 1));
    }],

    // clips
    ['GET', /^\/api\/clips$/, () => ({ clips: clips.listClips() })],
    ['POST', /^\/api\/clips$/, async ({ data }) => (await clips.createClip({ slug: data.name, title: data.title, description: data.description, format: data.format, fps: data.fps, duration: data.duration, background: data.background, composition: data.composition, author: data.author ?? author })).clip],
    ['GET', /^\/api\/clips\/([a-z0-9-]+)$/, async ({ params }) => {
      const clip = clips.getClip(params[0]);
      return { ...clip, ...(await clipBundle(clip.composition)) };
    }],
    ['PUT', /^\/api\/clips\/([a-z0-9-]+)$/, async ({ params, data }) => {
      const r = await clips.updateClip(params[0], { title: data.title, description: data.description, composition: data.composition, revision: data.revision });
      return { ...r.clip, ...(await clipBundle(r.clip.composition)), checked: r.checked };
    }],
    // every pinned version the saved clip uses (direct and nested), with where each came from
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/assets$/, ({ params }) => ({ assets: clips.clipAssets(params[0]) })],
    // pin and bundle a draft composition for the preview, without saving it
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/bundle$/, async ({ data }) => clipBundle(data.composition)],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/audio$/, async ({ params, data, req, res }) => {
      const wav = await studio.clipAudio(data.composition ? { composition: data.composition } : { clip: params[0] });
      return file(req, res, studio.dataDir, wav.slice(studio.dataDir.length + 1));
    }],
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/audio\.wav$/, async ({ params, req, res }) => {
      const wav = await studio.clipAudio({ clip: params[0] });
      return file(req, res, studio.dataDir, wav.slice(studio.dataDir.length + 1));
    }],
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/frame\.png$/, async ({ params, query, res }) => {
      // ?only=a,b or ?except=a,b draws some of the items (comma-separated item ids)
      const ids = (k) => (query.get(k) ? query.get(k).split(',') : undefined);
      const isolate = query.has('only') || query.has('except') ? { only: ids('only'), except: ids('except') } : undefined;
      return png(res, (await studio.clipFrame({ clip: params[0], isolate, t: Number(query.get('t') ?? 0), maxSize: Number(query.get('maxSize') ?? 640) })).png);
    }],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/add-assets$/, async ({ params, data }) => {
      const r = await clips.addAssets({ slug: params[0], assets: data.slugs ?? [], at: data.at, author: data.author ?? author });
      return { clip: r.clip.slug, revision: r.clip.revision, added: r.added };
    }],
    // v3: what the studio measures about a clip: its issues (check_clip, stills as URLs), a frame's text layout, the mix
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/check$/, async ({ params, data }) => {
      const r = await studio.checks.checkClip({ clip: data.composition ? undefined : params[0], name: params[0], composition: data.composition, format: data.format, from: data.from, to: data.to, step: data.step, only: data.only });
      return { ...r, clip: params[0], issues: r.issues.map((i) => ({ ...i, still: i.still ? `/media/frames/${basename(i.still)}` : null })) };
    }],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/layout$/, async ({ params, data }) => studio.inspect.layoutReport({ clip: data.composition ? undefined : params[0], composition: data.composition, format: data.format, t: data.t ?? 0 })],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/audio-report$/, async ({ params, data }) => studio.audio.report(await studio.compositionOf({ clip: data.composition ? undefined : params[0], composition: data.composition }), { silence: data.silence, minSilence: data.minSilence })],
    // body (all optional): { format | formats: [1–3 formats] (→ { batch, renders }), draft: true | { scale }, workers: 1–16, posterAt: seconds,
    // final: true (refused while the clip holds a placeholder or an unlicensed file; writes the credits) }
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/render$/, ({ params, data }) => {
      if (data.format !== undefined && data.formats !== undefined) throw new StudioError('Give format or formats, not both');
      const options = { draft: data.draft || undefined, workers: data.workers, poster: data.posterAt, final: data.final || undefined };
      return data.formats !== undefined
        ? renders.enqueueBatch({ clip: params[0], formats: data.formats, requestedBy: author, options })
        : renders.enqueue({ clip: params[0], requestedBy: author, format: data.format, options });
    }],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/remix$/, async ({ params, data }) => (await clips.remixClip({ slug: params[0], newSlug: data.name, format: data.format, title: data.title, author: data.author ?? author })).clip],

    // uploads waiting for the agent to describe them
    ['GET', /^\/api\/uploads$/, ({ query }) => ({ assets: uploads.undescribed(int(query.get('limit') ?? 50, 50, 1, 100)) })],
    // requests to the agent, and its proposals
    ['GET', /^\/api\/requests$/, ({ query }) => ({ requests: requests.list({ status: query.get('status') ? query.get('status').split(',') : undefined, scope: query.get('scope') || undefined, asset: query.get('asset') || undefined, clip: query.get('clip') || undefined, limit: int(query.get('limit') ?? 50, 50, 1, 200) }) })],
    ['POST', /^\/api\/requests$/, ({ data }) => requests.create({ scope: data.scope, asset: data.asset, version: data.version, clip: data.clip, items: data.items, at: data.at, params: data.params, message: data.message, author: data.author ?? author })],
    ['GET', /^\/api\/requests\/(\d+)$/, ({ params }) => ({ ...requests.get(Number(params[0])), running: runs.isRunning(params[0]) })],
    ['POST', /^\/api\/requests\/(\d+)\/messages$/, ({ params, data }) => requests.reply({ id: Number(params[0]), author: data.author ?? author, body: data.body })],
    ['POST', /^\/api\/requests\/(\d+)\/cancel$/, ({ params }) => { runs.isRunning(params[0]) && runs.cancel(params[0]); return requests.cancel({ id: Number(params[0]), author }); }],
    ['POST', /^\/api\/requests\/(\d+)\/run$/, ({ params }) => runs.start(Number(params[0]), author)],
    ['POST', /^\/api\/requests\/(\d+)\/run\/cancel$/, ({ params }) => runs.cancel(Number(params[0]))],
    ['POST', /^\/api\/proposals\/(\d+)\/accept$/, async ({ params, data }) => requests.accept({ proposal: Number(params[0]), author, force: !!data.force })],
    ['POST', /^\/api\/proposals\/(\d+)\/reject$/, ({ params, data }) => requests.reject({ proposal: Number(params[0]), author, reason: data.reason })],
    // what a proposal would look like: a bundle for the preview worker, same as a draft or a clip
    ['GET', /^\/api\/proposals\/(\d+)\/preview$/, async ({ params }) => {
      const p = requests.proposal(Number(params[0]));
      if (p.kind === 'clip-edit') {
        const current = clips.getClip(p.target);
        return { proposal: p, current: current.revision, ...(await clipBundle(clips.applyOps(current.composition, p.payload.operations))) };
      }
      const d = await studio.draftBundle({ slug: p.target, source: p.payload.source });
      const m = d.validation.meta;
      return { proposal: p, ref: d.ref, kind: m.kind, schema: m.schema, duration: m.duration, formats: m.formats, bundle: browserBundle(d.bundle) };
    }],

    // renders, gallery, lineage
    ['GET', /^\/api\/renders$/, ({ query }) => ({ renders: renders.list({ status: query.get('status') || undefined, clip: query.get('clip') || undefined, limit: int(query.get('limit') ?? 50, 50, 1, 200) }) })],
    ['GET', /^\/api\/renders\/(\d+)$/, ({ params }) => renders.get(Number(params[0]))],
    // the report of a finished render (from its encoded file) with the URLs of its sheets, subtitles and words
    ['GET', /^\/api\/renders\/(\d+)\/report$/, ({ params }) => {
      const r = renders.get(Number(params[0]));
      const files = r.stats?.files ?? {};
      if (r.status !== 'done' || !files.report) throw new StudioError(r.status !== 'done' ? `Render ${r.id} is ${r.status}` : `Render ${r.id} was made before the studio wrote render reports`, 'not_found');
      const url = (p) => (p ? `/media/${p}` : null);
      return {
        render: r.id, loudness: r.stats.loudness, problems: r.stats.problems ?? [], timings: { render: r.stats.renderSeconds, mix: r.stats.mixSeconds, report: r.stats.reportSeconds, loudness: r.stats.loudnessSeconds },
        report: JSON.parse(readFileSync(join(studio.dataDir, files.report), 'utf8')), urls: { srt: url(r.srt), vtt: url(files.vtt), words: url(files.words), report: url(files.report), sheets: (files.sheets ?? []).map(url) },
      };
    }],
    ['POST', /^\/api\/renders\/(\d+)\/cancel$/, ({ params }) => renders.cancel(Number(params[0]))],
    ['GET', /^\/api\/gallery$/, () => ({ renders: renders.gallery() })],
    ['GET', /^\/api\/lineage$/, () => ({ ...lineage.graph(), report: lineage.report() })],
    // iteration 4: each area keeps its routes in its own module (src/server/routes/); { raw: true } routes read the body themselves
    ...moreRoutes({ studio, author, send, png, file, read, int: (v, fallback, min, max) => int(v, fallback, min, max) }),
  ];

  const cookieToken = (req) => {
    const m = new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]*)`).exec(String(req.headers.cookie ?? ''));
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch { return ''; }
  };
  const authed = (req) => {
    if (!token) return true;
    const header = String(req.headers.authorization ?? '');
    const bearer = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '').trim() : '';
    return secretEqual(bearer, token) || secretEqual(cookieToken(req), token);
  };
  // Lax, not Strict: a share link opened from a chat app is a navigation from another site, and Strict would leave the cookie
  // off it. Writes from other sites stay refused: the Origin check, a JSON body, and Lax sends no cookie with a cross-site POST.
  const sessionCookie = ` ${TOKEN_COOKIE}=${encodeURIComponent(token ?? '')}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`.trim();

  /** Only answer requests addressed to this machine, and refuse writes that come from another site's page. */
  function guard(req) {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (hosts && !hosts.includes(host.replace(/:\d+$/, ''))) throw new StudioError(`This studio answers only to ${hosts.join(', ')}`, 'forbidden');
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let same = false;
      try { same = new URL(origin).host.toLowerCase() === host; } catch { /* not a URL */ }
      if (!same) throw new StudioError('Requests from other origins are not accepted', 'forbidden');
    }
  }

  const int = (v, fallback, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback; };

  // ── live updates: the events table, tailed and pushed as server-sent events ───────────────
  const listeners = new Set();
  let lastEvent = studio.events.latest();
  const sse = (res, e) => res.write(`id: ${e.id}\nevent: ${e.topic}\ndata: ${JSON.stringify(e)}\n\n`);
  const tail = setInterval(() => {
    try {
      if (!listeners.size) { lastEvent = studio.events.latest(); return; }
      for (let rows = studio.events.since(lastEvent, 500); rows.length; rows = studio.events.since(lastEvent, 500)) {
        lastEvent = rows[rows.length - 1].id;
        for (const res of listeners) for (const e of rows) sse(res, e);
      }
    } catch (e) {
      if (!/database is locked|busy/i.test(String(e?.message))) console.error(`ERROR event stream: ${e?.stack ?? e}`);
    }
  }, 250);
  tail.unref();
  const ping = setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 20000);
  ping.unref();

  function events(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    // a reconnecting client says what it saw last, and gets what it missed
    const seen = Number(req.headers['last-event-id']);
    if (Number.isInteger(seen) && seen > 0) for (const e of studio.events.since(seen, 1000)) if (e.id <= lastEvent) sse(res, e);
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
  }

  /**
   * One uploaded file as the raw request body (Content-Type: the image's type), ?name=photo.png.
   * Not JSON on purpose: a page on another site cannot send an image/* body without a CORS
   * preflight, which this server never answers, and the Origin check refuses it anyway.
   */
  async function receiveUpload(req, url) {
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!/^image\/(png|jpeg|webp|svg\+xml)\b/.test(type)) throw new StudioError('Upload one PNG, JPEG, WebP or SVG file as the request body, with its image/* Content-Type', 'unsupported');
    const chunks = await read(req, MAX_UPLOAD, `The file is larger than ${MAX_UPLOAD / 1e6} MB`);
    // where it came from: ?license=&license_url=&source_url=&creator=&credit=&date=&ai_generated=&content_id=&restrictions=&placeholder=&redistributable=
    const r = await uploads.upload({ name: url.searchParams.get('name') || 'upload', data: Buffer.concat(chunks), author: url.searchParams.get('author') || author, forClip: url.searchParams.get('clip') || undefined, provenance: fromQuery(url.searchParams) });
    return { asset: r.asset, duplicate: r.duplicate, removed: r.removed, svg: r.svg };
  }

  // the manual is compiled on its first visit, so a mistake in a template never stops the studio from starting
  let docs = null, toolList = null;
  function docsPage(res, slug, url) {
    if (slug === 'index' && url.pathname !== '/docs') return send(res, 301, '', { location: '/docs' });
    docs ??= createDocs(studio, { tools: () => (toolList ??= createTools(studio).tools), runNow: () => runs.available() });
    const { status, html } = slug === 'search' ? docs.search(url.searchParams.get('q') ?? '') : docs.page(slug);
    return send(res, status, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': DOCS_CSP, 'x-content-type-options': 'nosniff' });
  }

  async function handle(req, res) {
    guard(req);
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (token && path === '/api/session' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.token !== 'string' || !secretEqual(data.token, token)) throw new StudioError('That token was not accepted', 'forbidden');
      return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie });
    }
    if (token && !authed(req)) {
      // a page (a screen, the manual, a share link) gets the sign-in form; data and modules get 401
      const openPage = (req.method === 'GET' || req.method === 'HEAD') && !/^\/(api|media|core|fonts|vendor|ui|player)(\/|$)|^\/share\/[^/]+\/bundle\.json$/.test(path);
      // connect-src 'self': this page posts the token with fetch. default-src 'none' would block that request.
      if (openPage) return send(res, 200, req.method === 'HEAD' ? '' : LOGIN_HTML, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
      return send(res, 401, { error: 'Sign in required', code: 'forbidden' });
    }
    if (path === '/api/events' && req.method === 'GET') return events(req, res);
    if (path === '/api/uploads' && req.method === 'POST') return send(res, 200, await receiveUpload(req, url));
    if (path.startsWith('/api/')) {
      for (const [method, re, fn, opts] of routes) {
        const m = re.exec(path);
        if (!m || method !== req.method) continue;
        const data = req.method === 'GET' || opts?.raw ? {} : await body(req);
        const out = await fn({ params: m.slice(1), query: url.searchParams, data, req, res });
        if (!res.headersSent && out !== undefined) send(res, 200, out);
        return;
      }
      return send(res, 404, { error: `No route for ${req.method} ${path}` });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    // only what the studio produces for viewing: never the database or the caches
    // each folder is its own root, so "renders/..\studio.db" cannot climb out of it
    const media = /^\/media\/(thumbs|files|renders|frames)\/(.+)$/.exec(path);
    if (media) return file(req, res, join(studio.dataDir, media[1]), media[2]);
    if (path.startsWith('/media/')) return send(res, 404, { error: `Not found: ${path}` });
    if (path.startsWith('/fonts/')) return file(req, res, FONTS_DIR, path.slice(7), { cache: 'max-age=86400' });
    if (path.startsWith('/core/')) return file(req, res, CORE, path.slice(6));
    // the code editor's modules, straight from node_modules (an allowlist of packages; no CDN)
    const vendor = /^\/vendor\/((?:@[a-z0-9-]+\/)?[a-z0-9-]+)\/(.+)$/.exec(path);
    if (vendor && VENDOR.has(vendor[1])) return file(req, res, join(ROOT, 'node_modules', vendor[1]), vendor[2], { cache: 'max-age=86400' });
    if (path.startsWith('/ui/')) return file(req, res, UI, path.slice(4));
    if (path === '/favicon.ico') return file(req, res, UI, 'favicon.svg');
    // share links: a clip's page and its bundle with the studio's media URLs (src/studio/share.js), and the player it runs
    const share = /^\/share\/([a-z0-9-]+)(\/bundle\.json)?\/?$/.exec(path);
    if (share && share[2]) return send(res, 200, await shareOf(studio).liveBundle(share[1]));
    if (share) {
      // a link to a clip that is not here (renamed, removed, a typo) is a page that says so, not a JSON error
      let html;
      try { html = await shareOf(studio).livePage(share[1]); } catch (e) {
        if (!(e instanceof StudioError) || e.code !== 'not_found') throw e;
        return send(res, 404, shareMissing(share[1]), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
      }
      return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8' });
    }
    if (path.startsWith('/player/')) return file(req, res, join(ROOT, 'src', 'player'), path.slice(8));
    // the manual: pages drawn here, on the server, from src/docs/templates
    const doc = /^\/docs(?:\/([a-z0-9-]+))?\/?$/.exec(path);
    if (doc) return docsPage(res, doc[1] ?? 'index', url);
    // every other path is a screen of the single-page app
    return file(req, res, UI, 'index.html', { headers: { 'content-security-policy': "frame-ancestors 'none'" } });
  }

  const server = createServer((req, res) => {
    const t0 = performance.now();
    res.on('finish', () => { if (req.url.startsWith('/api/')) log(`${req.method} ${req.url} ${res.statusCode} ${Math.round(performance.now() - t0)}ms`); });
    handle(req, res).catch((e) => {
      // a client that went away mid-response (scrubbing a video does this constantly) is not a server error
      if (DROPPED.has(e?.code)) return res.headersSent || res.writableEnded ? undefined : res.end();
      // an over-limit body was read to its end first (see read), so the answer arrives; the connection is not kept
      if (e instanceof StudioError) return res.headersSent ? res.end() : send(res, STATUS[e.code] ?? 400, { error: e.message, code: e.code, details: e.details }, e.code === 'too_large' ? { connection: 'close' } : {});
      console.error(`ERROR ${req.method} ${req.url}\n${e?.stack ?? e}`);
      return res.headersSent ? res.end() : send(res, 500, { error: 'Internal server error' });
    });
  });
  server.on('close', () => {
    clearInterval(tail);
    clearInterval(ping);
    runs.stopAll();
    for (const res of listeners) res.end();
    listeners.clear();
  });
  return server;
}
