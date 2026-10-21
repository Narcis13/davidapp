// A tiny static file server, for checking an exported share page with the studio stopped (any static host works).
//
//   node scripts/serve-static.mjs <folder> [--port 8800] [--prefix some/path]
//
// --prefix serves the folder under a sub-path, as GitHub Pages does (/<repo>/…), to prove the page needs none of
// its own. Range requests are answered (Safari asks for audio in ranges). Prints one line per request with --log.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const folder = argv[0] && !argv[0].startsWith('--') ? resolve(argv[0]) : null;
if (!folder || !existsSync(folder)) {
  console.error('usage: node scripts/serve-static.mjs <folder> [--port 8800] [--prefix some/path] (no leading slash: Git Bash turns /x into a Windows path)');
  process.exit(2);
}
const port = Number(opt('port', 8800));
const prefix = `/${opt('prefix', '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const log = argv.includes('--log');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

const server = createServer((req, res) => {
  const done = (status, text, headers = {}) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers }); res.end(text); };
  res.on('finish', () => { if (log) console.log(`${req.method} ${req.url} ${res.statusCode}`); });
  if (req.method !== 'GET' && req.method !== 'HEAD') return done(405, 'Method not allowed');
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return done(400, 'Bad path'); }
  if (path === prefix.slice(0, -1)) return done(301, '', { location: prefix });
  if (!path.startsWith(prefix)) return done(404, 'Not found');
  let full = resolve(folder, normalize(path.slice(prefix.length)).replace(/^([/\\])+/, ''));
  if (full !== folder && !full.startsWith(folder + sep)) return done(403, 'Forbidden');
  if (existsSync(full) && statSync(full).isDirectory()) {
    if (!path.endsWith('/')) return done(301, '', { location: `${path}/` });
    full = join(full, 'index.html');
  }
  if (!existsSync(full) || !statSync(full).isFile()) return done(404, 'Not found');
  const { size, mtime } = statSync(full);
  const headers = { 'content-type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'last-modified': mtime.toUTCString(), 'cache-control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return done(416, '', { 'content-range': `bytes */${size}` });
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(full, { start, end }), res, () => {});
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(full), res, () => {});
});
server.listen(port, '127.0.0.1', () => console.log(`serving ${folder} at http://127.0.0.1:${port}${prefix}`));
