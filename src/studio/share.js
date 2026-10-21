// Share links: a clip as a web page that plays it. The page runs the clip's own asset code in the viewer's browser
// (src/player: a module worker with the renderer's runtime, drawing on canvas), so there is no MP4 and no embed.
//
// Two forms, one page (src/player/page.html):
//   - the studio serves /share/<slug> with its own media URLs (live: whatever the clip is now);
//   - exportClip writes one self-contained folder (index.html, bundle.json, player/, core/, media/) that plays from
//     any static server under any path: every URL in it is relative, nothing comes from elsewhere. Footage goes as
//     the frames the clip shows (WebP, identical frames once), the mix as AAC, fonts as the families it names.
//
// A base URL (where the folder will be published) only makes og:image and og:url absolute, for link previews.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'acorn';
import { ROOT, FONTS_DIR, fontManifest, nodeHost, createCanvas, loadImage } from '../render/host.js';
import { createRuntime } from '../core/runtime.js';
import { footageService } from '../render/footage.js';
import { ffmpegPath, run } from '../render/ffmpeg.js';
import { StudioError, canvasOf } from './library.js';

/** The bundle.json format; a folder whose bundle.json has it is an export, so a new export may replace it. */
export const SHARE_VERSION = 1;
/** The file an export writes before anything else, so a folder it left half written can be replaced by the next. */
const EXPORT_MARK = '.fablecut-share';
const SRC = join(ROOT, 'src');
const PLAYER = join(SRC, 'player');
export const SHARE_DIR = join(ROOT, 'output', 'share');
/** Footage and sequence frames as lossy WebP at this quality: measured on clip 11 (1440×900 screen recording), q80 is 60 KB a frame
 * against 467 KB as PNG, 313 KB as lossless WebP and 112 KB as JPEG q80, with a mean error of 1 (0–255) on the frame. */
const FOOTAGE_QUALITY = 80;
/** The poster shows until the first frame is drawn: JPEG, at most this long a side, so it arrives first. */
const POSTER = { side: 1280, quality: 84 };
const OG = { width: 1200, height: 630 };
// Characters the bundled fonts draw from their Latin Extended files ("<Family> Ext"): only shipped when the clip has one
const EXTENDED = /[\u0100-\u036f\u1d00-\u1eff\u2020\u20a0-\u20c0\u2113\u2c60-\u2c7f\ua720-\ua7ff]/u;

const sha1 = (data) => createHash('sha1').update(data).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mapEntries = (o, fn) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, fn(k, v)]));
const fileName = (ref) => ref.replace('@', '-v');
const shapeOf = (c) => (c.width > c.height ? 'wide' : c.width < c.height ? 'tall' : 'square');

/**
 * The browser bundle (the shape the studio preview gets, see browserBundle in server/http.js) with URLs from `url`:
 * { image(ref, img), sequence(ref, s), footage(ref, v), upload(file) }, and for an export files(ref): the frames it kept.
 * @param {any} b @param {any} url
 */
function browserBundle(b, url) {
  const images = mapEntries(b.images, (ref, img) => ({ url: url.image(ref, img), vector: img.vector ?? null }));
  // an export lists the file of each frame it kept (files: { index: name }); the studio serves them all by index
  const files = (ref) => (url.files ? { files: url.files(ref) } : {});
  const sequences = mapEntries(b.sequences, (ref, s) => ({ url: url.sequence(ref, s), frames: s.frames, fps: s.fps, width: s.width, height: s.height, ...files(ref) }));
  const footage = mapEntries(b.videos, (ref, v) => ({ url: url.footage(ref, v), meta: v.meta, ...files(ref) }));
  const fonts = b.fonts && mapEntries(b.fonts, (_alias, set) => ({ family: set.family, files: set.files.map((f) => ({ ref: f.ref, url: url.upload(f), weight: f.weight, style: f.style })) }));
  return { key: b.key, assets: b.assets, images, sequences, footage, ...(fonts ? { fonts } : {}), beats: b.beats ?? [], words: b.words, captions: b.captions, lane: b.lane };
}

/**
 * The bundled families a clip can draw with, in the shape /api/status lists them: Inter (every text's default) and each
 * family named anywhere in its composition, asset sources, words or captions. Their Latin Extended files only when one of
 * those characters appears. `url(file)` → the URL of a font file.
 */
export function fontsFor(composition, bundle, url) {
  const text = [JSON.stringify(composition), ...Object.values(bundle.assets ?? {}).map((a) => a.source), JSON.stringify(bundle.words ?? []), JSON.stringify(bundle.captions ?? null)].join('\n')
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (_, a, b) => String.fromCodePoint(parseInt(a ?? b, 16)));
  const lower = text.toLowerCase();
  const ext = EXTENDED.test(text);
  const file = (f) => ({ url: url(f.file), weight: f.weight, style: f.style });
  return fontManifest().filter((f) => f.family === 'Inter' || lower.includes(f.family.toLowerCase()))
    .map((f) => ({ family: f.family, files: f.files.map(file), ...(ext && f.ext ? { ext: { family: f.ext.family, files: f.ext.files.map(file) } } : {}) }));
}

/** Every module the given ones import, relative imports followed (static, re-exports and literal dynamic imports). */
export function moduleClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  const visit = (node, file) => {
    if (!node || typeof node.type !== 'string') return;
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ImportExpression')
      && typeof node.source?.value === 'string' && node.source.value.startsWith('.')) queue.push(resolve(dirname(file), node.source.value));
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) for (const c of v) visit(c, file);
      else if (v && typeof v === 'object') visit(v, file);
    }
  };
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    visit(parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), file);
  }
  return [...seen].sort();
}

/** The player's files: its modules (with what they import from src/core), stylesheet and icon → paths relative to src/. */
export function playerFiles() {
  const own = readdirSync(PLAYER).filter((f) => /\.(js|css|svg)$/.test(f)).map((f) => join(PLAYER, f));
  const modules = moduleClosure(own.filter((f) => f.endsWith('.js')));
  const all = [...new Set([...own, ...modules])];
  for (const f of all) if (!f.startsWith(SRC + sep)) throw new Error(`The player imports ${f}, outside src/`);
  return all.map((f) => relative(SRC, f).split(sep).join('/')).sort();
}

/** The page: page.html with the clip's title, description, shape, URLs and link-preview tags filled in. */
function pageHtml({ title, description, root, bundle, poster, width, height, image, url }) {
  const meta = [
    ['property', 'og:type', 'website'], ['property', 'og:site_name', 'Fablecut'], ['property', 'og:title', title], ['property', 'og:description', description],
    ['property', 'og:image', image], ['property', 'og:image:type', 'image/jpeg'], ['property', 'og:image:width', OG.width], ['property', 'og:image:height', OG.height],
    ['property', 'og:image:alt', `A frame of “${title}”`], ...(url ? [['property', 'og:url', url]] : []),
    ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', title], ['name', 'twitter:description', description], ['name', 'twitter:image', image],
  ].map(([k, name, v]) => `<meta ${k}="${name}" content="${esc(v)}">`).join('\n');
  const values = { title, description, root, bundle, poster, width, height, shape: shapeOf({ width, height }), meta };
  return readFileSync(join(PLAYER, 'page.html'), 'utf8').replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, raw, name) => (raw ? values[raw] : esc(values[name])));
}

/** Total bytes of a folder's files. */
function folderBytes(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? folderBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}

/** @param {any} studio */
export function createShare(studio) {
  const { clips } = studio;

  /** The clip, its pinned composition and render bundle, and the facts the page shows. */
  async function load(slug) {
    if (typeof slug !== 'string' || !slug) throw new StudioError('Give the clip\'s name');
    const clip = clips.getClip(slug);
    const composition = clip.composition;
    const { bundle, audio } = await clips.bundleFor(composition);
    const title = clip.title || slug;
    const description = clip.description?.trim() || `A ${Math.round(composition.duration)} s clip made with Fablecut.`;
    // an interactive clip has no mix: each audio item plays when the session says so (sounds below)
    // an interactive clip has no mix: each audio item plays when the session says so (soundsOf), by its index in this list
    return { clip, composition, bundle, hasAudio: !composition.interactive && audio.inputs.length > 0, sounds: composition.interactive ? audioItems(composition) : [], title, description };
  }

  const total = (c) => Math.max(1, Math.round(c.duration * c.fps));
  /** The poster's frame: the given time, else 40% in (as a render's poster). */
  function posterFrame(composition, at) {
    if (at !== undefined && !(typeof at === 'number' && at >= 0 && at < composition.duration)) throw new StudioError(`poster_at must be a time in the clip, from 0 up to ${composition.duration} s`);
    return Math.min(total(composition) - 1, at !== undefined ? Math.round(at * composition.fps) : Math.round(total(composition) * 0.4));
  }

  // ── served by the studio ───────────────────────────────────────────────────────────────────

  /** What /share/<slug>/bundle.json serves: the clip with the studio's own media URLs. */
  async function liveBundle(slug) {
    const c = await load(slug);
    const { library } = studio;
    const bundle = browserBundle(c.bundle, {
      image: (ref) => `/media/${library.requireVersion(ref).file}`,
      sequence: (_ref, s) => `/media/${s.file}/`,
      footage: (ref) => `/api/footage/${ref.replace('@', '/')}/`,
      upload: (f) => `/media/${f.file}`,
    });
    return { share: SHARE_VERSION, clip: { slug, title: c.title, description: c.description }, composition: c.composition, bundle, fonts: fontsFor(c.composition, c.bundle, (f) => `/fonts/${f}`), audio: c.hasAudio ? `/api/clips/${slug}/audio.wav` : null, ...(c.sounds.length ? { sounds: soundsOf(c.sounds, (k) => `/api/clips/${slug}/sounds/${k}`) } : {}) };
  }

  /**
   * The page /share/<slug> serves: the player, the bundle above, the poster drawn by the renderer on request.
   * @param {string} slug @param {{ posterAt?: number }} [o]
   */
  async function livePage(slug, { posterAt } = {}) {
    const clip = clips.getClip(slug);
    const comp = clip.composition;
    const poster = `/api/clips/${slug}/frame.png?t=${posterFrame(comp, posterAt) / comp.fps}&maxSize=${Math.max(comp.width, comp.height)}`;
    return pageHtml({ title: clip.title || slug, description: clip.description?.trim() || `A ${Math.round(comp.duration)} s clip made with Fablecut.`, root: '/', bundle: `/share/${slug}/bundle.json`, poster, width: comp.width, height: comp.height, image: poster, url: null });
  }

  // ── the static export ──────────────────────────────────────────────────────────────────────

  /** Make `dir` empty: refused when it holds something other than an earlier export. */
  function prepare(dir) {
    if (existsSync(dir)) {
      if (!statSync(dir).isDirectory()) throw new StudioError(`${dir} is a file; give a folder for the export`);
      const entries = readdirSync(dir);
      // an earlier export: its bundle.json, or (one that stopped half way) the marker every export writes first
      let earlier = existsSync(join(dir, EXPORT_MARK));
      try { earlier ||= JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8')).share !== undefined; } catch { /* not an export */ }
      if (entries.length && !earlier) throw new StudioError(`${dir} is not empty and holds no earlier share export; give an empty or new folder`);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, EXPORT_MARK), 'A Fablecut share export (src/studio/share.js): a new export may replace this folder.\n');
  }

  /** The sequence and footage frames the clip draws, frame by frame (what its preview would fetch): ref → Set of indices. */
  function shownMedia(composition, bundle) {
    const rt = createRuntime(nodeHost);
    for (const [ref, s] of Object.entries(bundle.sequences ?? {})) rt.setSequence(ref, { frames: s.frames, fps: s.fps, width: s.width, height: s.height, get: () => null });
    for (const [ref, v] of Object.entries(bundle.videos ?? {})) rt.setFootage(ref, { meta: v.meta, get: () => null });
    rt.load(bundle.assets ?? {});
    const sequences = new Map(), footage = new Map();
    const add = (m, ref, i) => { if (!m.has(ref)) m.set(ref, new Set()); m.get(ref).add(i); };
    for (let f = 0; f < total(composition); f++) {
      for (const { ref, index } of rt.sequenceFramesAt(composition, f)) add(sequences, ref, index);
      for (const { ref, index } of rt.footageFramesAt(composition, f)) add(footage, ref, index);
    }
    return { sequences, footage };
  }

  /**
   * The frames a clip shows of one footage or sequence asset, written as WebP (four encodes at a time), a frame identical
   * to an earlier one only once. frameAt(i) → { data (what identifies it), canvas() → its picture }.
   * → { files: { index: file }, shown, unique }
   */
  async function writeFrames(indices, frameAt, dir, quality) {
    mkdirSync(dir, { recursive: true });
    const byHash = new Map(), files = {}, writing = new Set();
    for (const i of [...indices].sort((a, b) => a - b)) {
      const f = await frameAt(i);
      const h = sha1(f.data).slice(0, 16);
      if (!byHash.has(h)) {
        const name = `${h}.webp`;
        byHash.set(h, name);
        const p = Promise.resolve(f.canvas()).then((c) => c.encode('webp', quality)).then((buf) => writeFileSync(join(dir, name), buf));
        writing.add(p);
        p.finally(() => writing.delete(p)).catch(() => {});
        if (writing.size >= 4) await Promise.race(writing);
      }
      files[i] = byHash.get(h);
    }
    await Promise.all(writing);
    return { files, shown: indices.size, unique: byHash.size };
  }

  /** A footage frame as the studio's footage service decodes it for the render: the same source frame, converted the same way. */
  const footageFrame = (v) => async (i) => {
    const data = await footageService().frame({ ...v.meta, path: v.path }, i);
    return { data, canvas: () => canvasOf(data, v.meta.width, v.meta.height) };
  };
  /** A baked sequence's frame: its PNG (with its transparency). */
  const sequenceFrame = (s) => async (i) => {
    const data = readFileSync(join(s.dir, `${String(i).padStart(6, '0')}.png`));
    return { data, canvas: async () => { const img = await loadImage(data); const c = createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); return c; } };
  };

  /** A poster frame as JPEG, and the 1200×630 link-preview card: the frame over a blurred copy of itself, with a play mark. */
  async function posters(png) {
    const img = await loadImage(png);
    const k = Math.min(1, POSTER.side / Math.max(img.width, img.height));
    const full = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
    const pg = full.getContext('2d');
    pg.imageSmoothingQuality = 'high';
    pg.drawImage(img, 0, 0, full.width, full.height);
    const card = createCanvas(OG.width, OG.height);
    const g = card.getContext('2d');
    // the backdrop: the frame covering the card, blurred by drawing it tiny and scaling it back up
    const tiny = createCanvas(24, Math.round((24 * OG.height) / OG.width));
    const kt = Math.max(tiny.width / img.width, tiny.height / img.height);
    tiny.getContext('2d').drawImage(img, (tiny.width - img.width * kt) / 2, (tiny.height - img.height * kt) / 2, img.width * kt, img.height * kt);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(tiny, 0, 0, OG.width, OG.height);
    g.fillStyle = 'rgba(8, 8, 12, 0.55)';
    g.fillRect(0, 0, OG.width, OG.height);
    // the frame itself, contained with a margin, rounded
    const m = 36, s = Math.min((OG.width - 2 * m) / img.width, (OG.height - 2 * m) / img.height);
    const w = img.width * s, h = img.height * s, x = (OG.width - w) / 2, y = (OG.height - h) / 2;
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.55)'; g.shadowBlur = 40; g.shadowOffsetY = 12;
    g.fillStyle = '#000';
    g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.roundRect(x, y, w, h, 18); g.clip();
    g.drawImage(img, x, y, w, h);
    g.restore();
    // a play mark, so the preview reads as something to watch
    const r = 52, cx = OG.width / 2, cy = OG.height / 2;
    g.fillStyle = 'rgba(14, 14, 20, 0.62)';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)'; g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(cx - r * 0.3, cy - r * 0.42); g.lineTo(cx + r * 0.48, cy); g.lineTo(cx - r * 0.3, cy + r * 0.42); g.closePath(); g.fill();
    return { poster: await full.encode('jpeg', POSTER.quality), card: await card.encode('jpeg', 84) };
  }

  /**
   * Write the clip's share folder → what was written and how big it is. out: the folder (default output/share/<slug>);
   * baseUrl: where it will be published (only for the link-preview tags); posterAt: the poster's time (default 40% in);
   * quality: the WebP quality of footage and sequence frames (1–100, default 80).
   * @param {string} slug @param {{ out?: string, baseUrl?: string, posterAt?: number, quality?: number }} [o]
   */
  async function exportClip(slug, { out, baseUrl, posterAt, quality = FOOTAGE_QUALITY } = {}) {
    const t0 = performance.now();
    let base = null;
    if (baseUrl !== undefined && baseUrl !== null && baseUrl !== '') {
      try { base = new URL(baseUrl); } catch { throw new StudioError(`base_url "${baseUrl}" is not a URL; give where the folder will be published, such as https://example.com/clips/${slug}/`); }
      if (!/^https?:$/.test(base.protocol)) throw new StudioError('base_url must be an http or https URL');
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      base.search = ''; base.hash = '';
    }
    if (!(Number.isInteger(quality) && quality >= 1 && quality <= 100)) throw new StudioError('quality must be a whole number from 1 to 100');
    const c = await load(slug);
    const { composition: comp, bundle: b } = c;
    const dir = resolve(out ?? join(SHARE_DIR, slug));
    if (dir === ROOT || dir === SRC || ROOT.startsWith(dir + sep)) throw new StudioError(`${dir} holds the studio itself; give a folder of its own for the export`);
    const posterPng = (await studio.clipFrame({ clip: slug, frame: posterFrame(comp, posterAt) })).png;
    prepare(dir);
    const put = (rel, data) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
    const copy = (from, rel) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); copyFileSync(from, p); };

    // the player and the runtime, in the layout their relative imports expect
    const code = playerFiles();
    for (const rel of code) copy(join(SRC, rel), rel);

    // fonts: the bundled families it names, the uploaded ones it pins
    const fonts = fontsFor(comp, b, (file) => `media/fonts/${file}`);
    for (const fam of fonts) for (const f of [...fam.files, ...(fam.ext?.files ?? [])]) copy(join(FONTS_DIR, basename(f.url)), f.url);
    // footage and baked sequences: only the frames it shows, as WebP (measured on clip 11's footage and clip 5's baked
    // orb: a quarter or less of PNG, alpha kept exactly, a mean error under 1 of 255)
    const shown = shownMedia(comp, b);
    const frames = [], kept = {};
    for (const [kind, list, frameAt] of [['footage', b.videos, footageFrame], ['sequences', b.sequences, sequenceFrame]]) {
      for (const [ref, asset] of Object.entries(list ?? {})) {
        const r = await writeFrames(shown[kind].get(ref) ?? new Set(), frameAt(asset), join(dir, 'media', kind, fileName(ref)), quality);
        kept[ref] = r.files;
        frames.push({ ref, kind, shown: r.shown, unique: r.unique, format: 'webp', quality });
      }
    }
    const bundle = browserBundle(b, {
      image: (ref, img) => { const rel = `media/images/${fileName(ref)}${extname(img.path)}`; copy(img.path, rel); return rel; },
      sequence: (ref) => `media/sequences/${fileName(ref)}/`,
      footage: (ref) => `media/footage/${fileName(ref)}/`,
      files: (ref) => kept[ref],
      upload: (f) => { const rel = `media/fonts/${fileName(f.ref)}${extname(f.path)}`; copy(f.path, rel); return rel; },
    });

    // the mix, as AAC: the same WAV the render encodes
    let audio = null;
    if (c.hasAudio) {
      const wav = await studio.clipAudio({ clip: slug });
      audio = `media/sound/${slug}.m4a`;
      mkdirSync(join(dir, 'media', 'sound'), { recursive: true });
      const r = await run(ffmpegPath(), ['-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(dir, audio)]);
      if (r.code !== 0) throw new StudioError(`The clip's sound could not be encoded: ${r.stderr.trim().split('\n').pop()}`);
    }

    // an interactive clip's sounds, one file per audio item (the session starts and stops them), as AAC like the mix; named
    // by their index, so no item id ends up in a path
    let sounds;
    if (c.sounds.length) {
      mkdirSync(join(dir, 'media', 'sound'), { recursive: true });
      for (const [k, item] of c.sounds.entries()) {
        const wav = await studio.clipAudio({ composition: solo(comp, item) });
        const r = await run(ffmpegPath(), ['-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(dir, 'media', 'sound', `${k}.m4a`)]);
        if (r.code !== 0) throw new StudioError(`The sound of item "${item.id}" could not be encoded: ${r.stderr.trim().split('\n').pop()}`);
      }
      sounds = soundsOf(c.sounds, (k) => `media/sound/${k}.m4a`);
    }

    const { poster, card } = await posters(posterPng);
    put('poster.jpg', poster);
    put('og.jpg', card);
    const data = { share: SHARE_VERSION, clip: { slug, title: c.title, description: c.description }, composition: comp, bundle, fonts, audio, ...(sounds ? { sounds } : {}), poster: 'poster.jpg', made: new Date().toISOString() };
    put('bundle.json', JSON.stringify(data));
    put('index.html', pageHtml({
      title: c.title, description: c.description, root: '', bundle: 'bundle.json', poster: 'poster.jpg', width: comp.width, height: comp.height,
      image: base ? new URL('og.jpg', base).href : 'og.jpg', url: base ? base.href : null,
    }));

    const size = (rel) => (existsSync(join(dir, rel)) ? (statSync(join(dir, rel)).isDirectory() ? folderBytes(join(dir, rel)) : statSync(join(dir, rel)).size) : 0);
    const breakdown = {
      page: size('index.html'), bundle: size('bundle.json'), posters: size('poster.jpg') + size('og.jpg'), player: size('player'), core: size('core'),
      fonts: size('media/fonts'), images: size('media/images'), sequences: size('media/sequences'), footage: size('media/footage'), sound: size('media/sound'),
    };
    const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
    return {
      clip: slug, title: c.title, dir, index: join(dir, 'index.html'), url: base ? base.href : null, studioPath: `/share/${slug}`,
      bytes: folderBytes(dir), files: count(dir), breakdown, frames, audio, fonts: fonts.map((f) => f.family), modules: code.filter((f) => f.endsWith('.js')).length,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      ...(sounds ? { sounds: Object.keys(sounds).length } : {}),
      // a link preview (WhatsApp, Slack, Facebook) needs absolute URLs: say so when they are relative
      ...(base ? {} : { warnings: ['og:image and og:url are relative: link previews show only with absolute URLs; export again with base_url set to where the folder will be published'] }),
    };
  }

  /** The sound of one audio item of an interactive clip, mixed on its own (what /api/clips/<slug>/sounds/<index> serves). */
  async function soundFile(slug, index) {
    const c = await load(slug);
    const item = c.sounds[index];
    if (!item) throw new StudioError(`Clip "${slug}" has no sound ${index} to play (it has ${c.sounds.length})`, 'not_found');
    return studio.clipAudio({ composition: solo(c.composition, item) });
  }

  /** Where the clip can be shared from: the studio's path, and the default export folder if one was written. */
  function info(slug) {
    const clip = clips.getClip(slug);
    const dir = join(SHARE_DIR, slug);
    let exported = null;
    try {
      const data = JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8'));
      exported = { dir, bytes: folderBytes(dir), at: data.made ?? null };
    } catch { /* never exported there */ }
    return { clip: clip.slug, title: clip.title, path: `/share/${clip.slug}`, interactive: !!clip.composition.interactive, exported };
  }

  return { liveBundle, livePage, exportClip, info, soundFile };
}

/** The audio items of an interactive clip the session can play: those of its tracks that are not muted or hidden. */
const audioItems = (comp) => comp.tracks.filter((t) => t.type === 'audio' && !t.muted && !t.hidden).flatMap((t) => t.items);

/**
 * One audio item as a composition of its own, from its own start: mixed by the studio, it keeps its gain, fades, offset
 * and parameters (the editor's play mode mixes it the same way).
 */
function solo(comp, item) {
  const keep = {};
  for (const k of ['offset', 'assetDuration', 'gain', 'fadeIn', 'fadeOut', 'keyframes', 'seedId']) if (item[k] !== undefined) keep[k] = item[k];
  return { width: comp.width, height: comp.height, fps: comp.fps, duration: Math.max(0.1, item.duration), tracks: [{ id: 'sound', type: 'audio', items: [{ id: item.id, asset: item.asset, start: 0, duration: item.duration, params: item.params ?? {}, ...keep }] }] };
}

/**
 * The sounds of an interactive clip, by audio item id: { url, gain: 1 (the mix has it), loop?, cue? }. The session
 * (src/player/session.js) says when each starts and stops; the page plays them through Web Audio.
 */
function soundsOf(items, urlOf) {
  return Object.fromEntries(items.map((item, k) => [item.id, { url: urlOf(k), gain: 1, ...(item.loop ? { loop: true } : {}), ...(item.cue ? { cue: true } : {}) }]));
}

const services = new WeakMap();
/** The share service of a studio, made once. @param {any} studio @returns {ReturnType<typeof createShare>} */
export function shareOf(studio) {
  let s = services.get(studio);
  if (!s) services.set(studio, (s = createShare(studio)));
  return s;
}

