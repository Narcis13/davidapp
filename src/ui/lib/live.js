// Live updates: one EventSource per page on /api/events (the server tails the database's events
// table, so changes made by any process, the MCP server included, arrive here). Screens subscribe
// to topics and refresh what they show.
//
//   const off = live.on('asset', (e) => { … });   // e: { id, topic, key, action, data, source, at }
//   live.on('*', fn)                               // every event
//   ctx.onCleanup(off);

const listeners = new Map();
let source = null;

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  for (const topic of ['asset', 'clip', 'render', 'request', 'library']) {
    source.addEventListener(topic, (m) => {
      let e;
      try { e = JSON.parse(m.data); } catch { return; }
      for (const fn of listeners.get(topic) ?? []) fn(e);
      for (const fn of listeners.get('*') ?? []) fn(e);
    });
  }
  // the browser reconnects by itself (with Last-Event-ID); nothing to report in the console
  source.onerror = () => {};
}

export const live = {
  /** fn(event) for every event of a topic (asset, clip, render, request, library) or '*'. Returns the unsubscribe function. */
  on(topic, fn) {
    connect();
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(fn);
    return () => listeners.get(topic)?.delete(fn);
  },
};
