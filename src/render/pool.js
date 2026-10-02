// A pool of render worker threads with a watchdog. Each request names the bundle it needs; a
// worker that has a different bundle loaded is sent the new one first. A request that overruns
// its timeout gets its worker terminated and replaced, so runaway asset code can't take the
// process down with it.

import { Worker } from 'node:worker_threads';

export class RenderError extends Error {
  /** @param {string} message @param {any} [extra] */
  constructor(message, extra = {}) {
    super(message);
    this.name = 'RenderError';
    Object.assign(this, extra);
  }
}

export class WorkerPool {
  constructor({ size = 2 } = {}) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
    this.closed = false;
  }

  spawn() {
    const worker = new Worker(new URL('./frame-worker.js', import.meta.url));
    const w = { worker, busy: false, key: null, pending: new Map() };
    worker.on('message', (m) => {
      const p = w.pending.get(m.id);
      if (!p) return;
      w.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new RenderError(m.error.message, { logs: m.error.logs, assetStack: m.error.stack }));
    });
    const fail = (err) => {
      this.workers = this.workers.filter((x) => x !== w);
      for (const p of w.pending.values()) { clearTimeout(p.timer); p.reject(err); }
      w.pending.clear();
      this.pump();
    };
    worker.on('error', (/** @type {any} */ err) => fail(new RenderError(`Render worker crashed: ${err.message}`)));
    worker.on('exit', () => fail(new RenderError('Render worker exited')));
    worker.unref();
    this.workers.push(w);
    return w;
  }

  send(w, msg, timeout) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        w.pending.delete(id);
        this.workers = this.workers.filter((x) => x !== w);
        w.worker.removeAllListeners('exit');
        w.worker.terminate();
        reject(new RenderError(`Timed out after ${timeout / 1000}s: asset code is taking too long to run (an endless loop, or far too much drawing per frame). The worker was stopped.`, { timeout: true }));
        this.pump();
      }, timeout);
      w.pending.set(id, { resolve, reject, timer });
      w.worker.postMessage({ ...msg, id });
    });
  }

  /**
   * Run one request. opts.bundle: { key, assets, images, composition, beats } loaded before the
   * request when the worker doesn't have it. opts.timeout in ms.
   */
  /** @param {string} op @param {any} [payload] @param {any} [opts] @returns {Promise<any>} */
  run(op, payload = {}, opts = {}) {
    if (this.closed) return Promise.reject(new RenderError('The render pool is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ op, payload, opts, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.queue.length && !this.closed) {
      const key = this.queue[0].opts.bundle?.key;
      const idle = this.workers.filter((x) => !x.busy);
      let w = idle.find((x) => x.key === key) ?? idle[0];
      if (!w && this.workers.length < this.size) w = this.spawn();
      if (!w) return;
      const task = this.queue.shift();
      w.busy = true;
      this.exec(w, task).then(task.resolve, task.reject).finally(() => { w.busy = false; this.pump(); });
    }
  }

  async exec(w, { op, payload, opts }) {
    const timeout = opts.timeout ?? 15000;
    if (opts.bundle && w.key !== opts.bundle.key) {
      w.key = null;
      await this.send(w, { op: 'load', bundle: opts.bundle }, timeout);
      w.key = opts.bundle.key;
    }
    return this.send(w, { op, ...payload }, timeout);
  }

  async destroy() {
    this.closed = true;
    for (const t of this.queue.splice(0)) t.reject(new RenderError('The render pool is closed'));
    const ws = this.workers.splice(0);
    await Promise.all(ws.map((w) => { w.worker.removeAllListeners('exit'); for (const p of w.pending.values()) { clearTimeout(p.timer); p.reject(new RenderError('Cancelled')); } return w.worker.terminate(); }));
  }
}
