#!/usr/bin/env node
// Start the studio: web UI + API on one port, and a render-queue runner.
//
//   PORT          default 8787
//   HOST          default 127.0.0.1 (any other address needs STUDIO_TOKEN)
//   STUDIO_TOKEN  a secret of at least 16 characters: every request must carry it (the browser signs in once)
//   STUDIO_HOSTS  extra Host names to answer to, comma-separated (a reverse proxy's public name; needs STUDIO_TOKEN)
//   STUDIO_DATA   data directory (default: <repo>/data)

import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../studio/studio.js';
import { createStudioServer } from './http.js';
import { closeFootageService } from '../render/footage.js';

// the settings are checked before the studio opens its database or starts its render runner
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT must be a whole number from 0 to 65535, not "${process.env.PORT}".`);
  process.exit(1);
}
const host = process.env.HOST ?? '127.0.0.1';
const token = process.env.STUDIO_TOKEN ?? '';
if (token && token.length < 16) {
  console.error('STUDIO_TOKEN must be at least 16 characters.');
  process.exit(1);
}
// loopback by default. Another address (HOST=0.0.0.0) answers only when STUDIO_TOKEN is set; the page asks for it.
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
if (!loopback && !token) {
  console.error('Refusing to listen on a non-loopback address without STUDIO_TOKEN. Use HOST=127.0.0.1, or set STUDIO_TOKEN to a long random secret.');
  process.exit(1);
}
// behind a reverse proxy the studio listens on loopback but is addressed by its public name
const extraHosts = (process.env.STUDIO_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (extraHosts.length && !token) {
  console.error('STUDIO_HOSTS puts the studio on a public name: set STUDIO_TOKEN to a long random secret too.');
  process.exit(1);
}
const hosts = !loopback ? null : extraHosts.length ? ['localhost', '127.0.0.1', '[::1]', ...extraHosts] : undefined;
const studio = createStudio({ role: 'server', runner: true });
const server = createStudioServer(studio, { log: (line) => console.log(line), hosts, token: token || undefined });
const pidFile = join(studio.dataDir, 'server.pid');

server.listen(port, host, () => {
  writeFileSync(pidFile, String(process.pid));
  const address = server.address();
  const shown = host.includes(':') ? `[${host}]` : host;
  console.log(`Fablecut studio: http://${shown}:${typeof address === 'object' && address ? address.port : port}  (data: ${studio.dataDir})`);
});
server.on('error', (e) => { console.error(`ERROR could not start the server: ${e.message}`); process.exit(1); });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections();
  // the footage decoders the preview started are FFmpeg processes of their own: stop them with the studio
  try { rmSync(pidFile, { force: true }); await studio.close(); await closeFootageService(); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => {
  console.error(`ERROR uncaught exception: ${e?.stack ?? e}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`ERROR unhandled rejection: ${reason instanceof Error ? reason.stack : reason}`);
});
