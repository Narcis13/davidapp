#!/usr/bin/env node
// Start the studio: web UI + API on one port, and a render-queue runner.
//
//   PORT          default 8787
//   HOST          default 127.0.0.1
//   STUDIO_DATA   data directory (default: <repo>/data)

import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../studio/studio.js';
import { createStudioServer } from './http.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const studio = createStudio({ role: 'server', runner: true });
// loopback names by default; binding another address on purpose (HOST=0.0.0.0) opens it to whoever can reach it
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
const server = createStudioServer(studio, { log: (line) => console.log(line), hosts: loopback ? undefined : null });
const pidFile = join(studio.dataDir, 'server.pid');

server.listen(port, host, () => {
  writeFileSync(pidFile, String(process.pid));
  console.log(`Fablecut studio: http://${host}:${port}  (data: ${studio.dataDir})`);
});
server.on('error', (e) => { console.error(`ERROR could not start the server: ${e.message}`); process.exit(1); });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections();
  try { rmSync(pidFile, { force: true }); await studio.close(); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
