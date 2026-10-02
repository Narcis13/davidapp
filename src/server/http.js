// The studio's HTTP server: a JSON API over the studio services, the media it produces (with
// Range support so video seeks), and the static UI. The UI loads src/core straight from /core,
// so the preview runs the same runtime the renderer does.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ENGINE_VERSION, FORMATS, makeRef } from '../core/engine.js';
import { ROOT, FONTS_DIR, fontManifest } from '../render/host.js';
import { StudioError } from '../studio/studio.js';
import { json as parseJson } from '../db/db.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.srt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const STATUS = { invalid: 400, rejected: 422, not_found: 404, conflict: 409, forbidden: 403, unsupported: 415 };
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * hosts: the Host names the server answers to (default: loopback names only), or null for any.
 * @param {any} studio @param {{ log?: (line: string) => void, author?: string, hosts?: string[] | null }} [o]
 */
export function createStudioServer(studio, { log = () => {}, author = process.env.STUDIO_AUTHOR ?? 'studio-user', hosts = LOCAL_HOSTS } = {}) {
  const { library, clips, renders, lineage } = studio;
  const UI = join(ROOT, 'src', 'ui');
  const CORE = join(ROOT, 'src', 'core');

  const send = (res, status, body, headers = {}) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store', ...headers });
    res.end(data);
  };
  const png = (res, data) => send(res, 200, Buffer.from(data), { 'content-type': 'image/png' });

  /** Serve a file under `base`, refusing anything that resolves outside it. Supports Range. */
  function file(req, res, base, rel, { cache = 'no-cache' } = {}) {
    let decoded;
    try { decoded = decodeURIComponent(rel); } catch { return send(res, 400, { error: 'Malformed path' }); }
    const full = resolve(base, normalize(decoded).replace(/^([/\\])+/, ''));
    if (full !== base && !full.startsWith(base + sep)) return send(res, 403, { error: 'Forbidden' });
    if (!existsSync(full) || !statSync(full).isFile()) return send(res, 404, { error: `Not found: ${rel}` });
    const { size } = statSync(full);
    // nosniff + sandbox: an SVG image asset opened directly must not run script on this origin
    const headers = { 'content-type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': cache, 'x-content-type-options': 'nosniff', ...(extname(full).toLowerCase() === '.svg' && base !== UI ? { 'content-security-policy': 'sandbox' } : {}) };
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

  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 8e6) throw new StudioError('Request body too large'); chunks.push(c); }
    if (!chunks.length) return {};
    // JSON only: a form post from another site cannot carry this content type without a preflight
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new StudioError('Send the request body as application/json', 'unsupported');
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StudioError('The request body is not valid JSON'); }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new StudioError('The request body must be a JSON object');
    return data;
  }

  const fonts = () => fontManifest().map((f) => ({ family: f.family, slug: f.slug, license: f.license, files: f.files.map((x) => ({ url: `/fonts/${x.file}`, weight: x.weight, style: x.style })) }));

  /** The browser-side bundle: sources and pinned deps, with image URLs instead of paths. */
  function browserBundle(b) {
    const images = {};
    for (const ref of Object.keys(b.images ?? {})) images[ref] = { url: `/media/${library.requireVersion(ref).file}` };
    return { key: b.key, assets: b.assets, images, beats: b.beats ?? [] };
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
    return { composition: pinned, bundle: browserBundle(bundle), beats: audio.beats, assets: describeRefs(pinned) };
  }

  /** @type {[string, RegExp, (ctx: any) => any][]} */
  const routes = [
    ['GET', /^\/api\/status$/, () => ({
      name: 'Fablecut', engine: ENGINE_VERSION, formats: FORMATS, fonts: fonts(), tags: library.allTags(),
      counts: { assets: library.search({ limit: 1 }).total, clips: clips.listClips().length, renders: renders.list({ limit: 200 }).length },
    })],

    // assets
    ['GET', /^\/api\/assets$/, ({ query }) => library.search({
      query: query.get('query') ?? undefined, type: query.get('type') || undefined, kind: query.get('kind') || undefined,
      tags: query.get('tag') ? query.get('tag').split(',').filter(Boolean) : undefined, format: query.get('format') || undefined,
      originClip: query.get('origin') || undefined, usedByClip: query.get('usedBy') || undefined, derivedFrom: query.get('derivedFrom') || undefined,
      limit: int(query.get('limit') ?? 100, 100, 1, 200), offset: int(query.get('offset') ?? 0, 0, 0, 1e9),
    })],
    ['POST', /^\/api\/assets\/validate$/, async ({ data }) => {
      const d = await studio.draftBundle({ slug: data.name ?? 'draft', source: data.source });
      const m = d.validation.meta;
      return { ok: true, ref: d.ref, kind: m.kind, schema: m.schema, duration: m.duration, formats: m.formats, warnings: d.validation.warnings, bundle: browserBundle(d.bundle) };
    }],
    ['POST', /^\/api\/assets$/, async ({ data }) => {
      const r = await library.createAsset({ slug: data.name, source: data.source, note: data.note, forClip: data.forClip, author: data.author ?? author });
      return { asset: r.asset, warnings: r.warnings };
    }],
    ['GET', /^\/api\/assets\/([a-z0-9-]+)$/, ({ params, query }) => library.getAsset(query.get('version') ? makeRef(params[0], Number(query.get('version'))) : params[0])],
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
    // the exact frame, drawn by the renderer (PNG)
    ['POST', /^\/api\/frame\/asset$/, async ({ data, res }) => png(res, (await studio.assetFrame({ ref: data.ref, source: data.source, slug: data.name, params: data.params, t: data.t, duration: data.duration, format: data.format, width: data.width, height: data.height, background: data.background, maxSize: data.maxSize })).png)],
    ['POST', /^\/api\/frame\/clip$/, async ({ data, res }) => png(res, (await studio.clipFrame({ clip: data.clip, composition: data.composition, t: data.t, maxSize: data.maxSize })).png)],
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
      const r = await clips.updateClip(params[0], { title: data.title, description: data.description, composition: data.composition });
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
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/frame\.png$/, async ({ params, query, res }) => png(res, (await studio.clipFrame({ clip: params[0], t: Number(query.get('t') ?? 0), maxSize: Number(query.get('maxSize') ?? 640) })).png)],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/render$/, ({ params }) => renders.enqueue({ clip: params[0], requestedBy: author })],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/remix$/, async ({ params, data }) => (await clips.remixClip({ slug: params[0], newSlug: data.name, format: data.format, title: data.title, author: data.author ?? author })).clip],

    // renders, gallery, lineage
    ['GET', /^\/api\/renders$/, ({ query }) => ({ renders: renders.list({ status: query.get('status') || undefined, clip: query.get('clip') || undefined, limit: int(query.get('limit') ?? 50, 50, 1, 200) }) })],
    ['GET', /^\/api\/renders\/(\d+)$/, ({ params }) => renders.get(Number(params[0]))],
    ['POST', /^\/api\/renders\/(\d+)\/cancel$/, ({ params }) => renders.cancel(Number(params[0]))],
    ['GET', /^\/api\/gallery$/, () => ({ renders: renders.gallery() })],
    ['GET', /^\/api\/lineage$/, () => ({ ...lineage.graph(), report: lineage.report() })],
  ];

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

  async function handle(req, res) {
    guard(req);
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (path.startsWith('/api/')) {
      for (const [method, re, fn] of routes) {
        const m = re.exec(path);
        if (!m || method !== req.method) continue;
        const data = req.method === 'GET' ? {} : await body(req);
        const out = await fn({ params: m.slice(1), query: url.searchParams, data, req, res });
        if (!res.headersSent && out !== undefined) send(res, 200, out);
        return;
      }
      return send(res, 404, { error: `No route for ${req.method} ${path}` });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    // only what the studio produces for viewing: never the database or the caches
    // each folder is its own root, so "renders/..\studio.db" cannot climb out of it
    const media = /^\/media\/(thumbs|files|renders)\/(.+)$/.exec(path);
    if (media) return file(req, res, join(studio.dataDir, media[1]), media[2]);
    if (path.startsWith('/media/')) return send(res, 404, { error: `Not found: ${path}` });
    if (path.startsWith('/fonts/')) return file(req, res, FONTS_DIR, path.slice(7), { cache: 'max-age=86400' });
    if (path.startsWith('/core/')) return file(req, res, CORE, path.slice(6));
    if (path.startsWith('/ui/')) return file(req, res, UI, path.slice(4));
    if (path === '/favicon.ico') return file(req, res, UI, 'favicon.svg');
    // every other path is a screen of the single-page app
    return file(req, res, UI, 'index.html');
  }

  const server = createServer((req, res) => {
    const t0 = performance.now();
    res.on('finish', () => { if (req.url.startsWith('/api/')) log(`${req.method} ${req.url} ${res.statusCode} ${Math.round(performance.now() - t0)}ms`); });
    handle(req, res).catch((e) => {
      if (e instanceof StudioError) return res.headersSent ? res.end() : send(res, STATUS[e.code] ?? 400, { error: e.message, code: e.code, details: e.details });
      console.error(`ERROR ${req.method} ${req.url}\n${e?.stack ?? e}`);
      return res.headersSent ? res.end() : send(res, 500, { error: 'Internal server error' });
    });
  });
  return server;
}
