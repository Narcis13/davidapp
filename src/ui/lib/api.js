// The studio's HTTP API. Failures become ApiError with the server's message, so screens can show
// them in the page; nothing is written to the console.

export class ApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('The studio server is not reachable. Is it still running?');
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(data?.error ?? `The request failed (${res.status})`, res.status, data);
  }
  return res;
}

export const api = {
  get: (url) => request('GET', url).then((r) => r.json()),
  post: (url, body = {}) => request('POST', url, body).then((r) => r.json()),
  put: (url, body = {}) => request('PUT', url, body).then((r) => r.json()),
  /** POST that answers with a file (PNG, WAV) → Blob */
  blob: (url, body = {}) => request('POST', url, body).then((r) => r.blob()),
};

let statusPromise = null;
/** /api/status: formats and fonts never change while the page is open; tags and counts do (fresh: true). */
export function getStatus({ fresh = false } = {}) {
  if (fresh || !statusPromise) {
    const p = api.get('/api/status');
    statusPromise = p;
    p.catch(() => { if (statusPromise === p) statusPromise = null; });
  }
  return statusPromise;
}

/** Query string from an object, skipping empty values. */
export function qs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const text = q.toString();
  return text ? `?${text}` : '';
}

// The render queue, polled in one place: the nav badge and the queue screen both listen.
const listeners = new Set();
let renders = [], timer = 0, polling = false, again = false, failed = null;

const isActive = (r) => r.status === 'queued' || r.status === 'running';

async function poll() {
  clearTimeout(timer);
  if (polling) { again = true; return; }
  polling = true;
  try {
    if (!document.hidden) {
      renders = (await api.get('/api/renders?limit=100')).renders;
      failed = null;
    }
  } catch (e) {
    failed = e.message;
  } finally {
    polling = false;
  }
  if (again) { again = false; return poll(); }
  for (const fn of listeners) fn(renders, failed);
  if (listeners.size) timer = setTimeout(poll, renders.some(isActive) ? 700 : listeners.size > 1 ? 3000 : 6000);
}

export const renderQueue = {
  isActive,
  /** fn(renders, error) is called after every poll. Returns the unsubscribe function. */
  subscribe(fn) {
    listeners.add(fn);
    poll();
    return () => { listeners.delete(fn); if (!listeners.size) clearTimeout(timer); };
  },
  refresh: poll,
  get current() { return renders; },
};
