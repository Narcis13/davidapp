// HTTP routes: footage (iteration 4). Frames for the preview, decoded by the same footage service as the
// render workers use (so the preview shows the same source frame, converted the same way), and uploads.

import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { footageService } from '../../render/footage.js';
import { StudioError } from '../../studio/library.js';
import { fromQuery, parseProvenance } from '../../studio/provenance.js';

/** Encoded preview frames, newest kept, at most this many bytes (the decoded frames have their own budget). */
const ENCODED_LIMIT = 128 * 1024 * 1024;
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;

/** @param {any} api @returns {any[]} */
export default function routes({ studio, author, send }) {
  const { library } = studio;
  const encoded = new Map();
  let bytes = 0;
  const remember = (key, buf) => {
    encoded.set(key, buf); bytes += buf.length;
    while (bytes > ENCODED_LIMIT && encoded.size > 1) { const [k, v] = encoded.entries().next().value; encoded.delete(k); bytes -= v.length; }
  };

  /** One frame of a footage version as PNG (exact, for a paused preview and parity) or JPEG (fast, while playing). */
  async function frame({ params, res }) {
    const [slug, version, index, ext] = params;
    const key = params.join('/');
    let buf = encoded.get(key);
    if (buf) { encoded.delete(key); encoded.set(key, buf); }
    else {
      const row = library.requireVersion(`${slug}@${version}`);
      if (row.type !== 'video') throw new StudioError(`${slug}@${version} is a ${row.type} asset, not footage`);
      const meta = library.footageMeta(row);
      const i = Number(index);
      if (i >= meta.table.pts.length) throw new StudioError(`${slug}@${version} has frames 0–${meta.table.pts.length - 1}`, 'not_found');
      const data = await footageService().frame({ ...meta, path: library.absFile(row) }, i);
      const c = library.canvasOf(data, meta.width, meta.height);
      buf = ext === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 90);
      remember(key, buf);
    }
    // a version never changes, so neither does its frame
    send(res, 200, buf, { 'content-type': ext === 'png' ? 'image/png' : 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
  }

  /**
   * An uploaded video file as the raw request body, streamed to disk (never held in memory), then added like
   * add_footage: ?name=clip.mp4&slug=&title=&description=&clip=
   * and where it came from: &license=&license_url=&source_url=&creator=&credit=&date=&ai_generated=&content_id=&restrictions=&placeholder=&redistributable=
   */
  async function upload({ req, query }) {
    const name = query.get('name') || 'footage.mp4';
    const ext = extname(name).toLowerCase();
    const type = String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
    // a form on another site can POST text/plain without a preflight; a video body cannot
    if (!/^(video\/[a-z0-9.+-]+|application\/octet-stream)$/.test(type)) {
      for await (const _c of req) { /* drop the body so the refusal arrives */ }
      throw new StudioError('Send the video as the request body with a video/* Content-Type or application/octet-stream', 'unsupported');
    }
    if (!['.mp4', '.m4v', '.mov', '.webm', '.mkv'].includes(ext)) throw new StudioError(`"${name}" is not a video file the studio takes (MP4, MOV, M4V, WebM, MKV)`, 'unsupported');
    if (Number(req.headers['content-length']) > MAX_UPLOAD) throw new StudioError('The file is larger than 2 GB', 'too_large');
    // said before the bytes are streamed: a mistake in it costs nothing
    parseProvenance(fromQuery(query));
    const dir = join(studio.dataDir, 'files');
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.upload-${randomBytes(6).toString('hex')}${ext}`);
    let size = 0;
    try {
      const counter = new Transform({
        transform(chunk, _enc, done) { size += chunk.length; done(size > MAX_UPLOAD ? new StudioError('The file is larger than 2 GB', 'too_large') : null, chunk); },
      });
      await pipeline(req, counter, createWriteStream(tmp));
      if (!size) throw new StudioError('The upload was empty');
      const base = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
      const slug = query.get('slug') || (base.length >= 2 ? base : `footage-${randomBytes(3).toString('hex')}`);
      const r = await library.addFootage({
        slug, path: tmp, move: true, author: query.get('author') || author, forClip: query.get('clip') || undefined,
        title: query.get('title') || undefined, provenance: fromQuery(query),
        description: query.get('description') || `Footage uploaded in the studio from "${name}".`,
        tags: ['footage'],
      });
      return { asset: r.asset };
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  return [
    ['GET', /^\/api\/footage\/([a-z0-9-]+)\/(\d+)\/(\d+)\.(png|jpg)$/, frame],
    ['POST', /^\/api\/footage$/, upload, { raw: true }],
  ];
}
