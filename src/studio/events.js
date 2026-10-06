// Change events. Every service writes one row per change to the `events` table, whichever process
// made the change (the web server, an MCP server started by Claude Code, a script). The web server
// tails the table and pushes new rows to the studio as server-sent events, so the processes never
// have to talk to each other: the database is the bus.

import { now } from '../db/db.js';

const KEEP = 20000;

export function createEvents(ctx) {
  const { db } = ctx;
  const insert = db.prepare('INSERT INTO events (topic, key, action, data, source, at) VALUES (?, ?, ?, ?, ?, ?)');
  const after = db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?');
  const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events');
  let writes = 0;

  /**
   * Record a change. topic: asset | clip | render | request | library; key: what changed.
   * Synchronous: call it inside the transaction that makes the change, so the two commit together.
   */
  function emit(topic, key, action, data = {}) {
    insert.run(topic, key === undefined || key === null ? null : String(key), action, JSON.stringify(data), ctx.role ?? 'studio', now());
    // keep the table small: the studio only ever needs the recent tail
    if (++writes % 500 === 0) db.prepare('DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?').run(KEEP);
  }

  const shape = (r) => ({ id: r.id, topic: r.topic, key: r.key, action: r.action, data: JSON.parse(r.data), source: r.source, at: r.at });

  /** Events after `id`, oldest first. */
  const since = (id, limit = 500) => after.all(id, limit).map(shape);
  const latest = () => last.get().id;

  return { emit, since, latest };
}
