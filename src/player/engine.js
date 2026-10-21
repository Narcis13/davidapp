// The player engine: runs a clip's asset code in a module worker (worker.js: the renderer's own runtime) and
// presents its frames on a canvas. It knows nothing of the page around it, so the share page (player.js) and the
// studio editor play bundles through the same code.
//
//   const engine = new Engine({ canvas });
//   await engine.load({ composition, bundle, fonts }, { base: bundleUrl, onProgress: (p) => … });
//   const r = await engine.drawFrame(frame, { fast, ahead, ui });   // presents it → { frame, width, height, regions, texts }
//   await engine.preload([0, 1, 2], { onProgress });    engine.setComposition(c);    engine.destroy();
//
// bundle: the browser bundle (assets, images, sequences, footage, fonts, beats, words, captions, lane) as the studio's
// /api/clips/<slug> or an exported share's bundle.json has it. fonts: the bundled families the clip draws with, as
// /api/status lists them. Every URL in them may be relative: it is resolved against `base` (default: the page), so the
// same bundle plays from the studio (/media/…) and from an exported folder under any path.

const DRAW_MS = 20000;

/** @param {string | undefined} url @param {string | URL} base */
const abs = (url, base) => (url ? new URL(url, base).href : url);
const mapValues = (o, fn) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, fn(v)]));

/** The bundle with every media URL absolute (a worker resolves relative URLs against its own script, not the page). */
export function resolveBundle(bundle, base) {
  return {
    ...bundle,
    images: mapValues(bundle.images, (i) => ({ ...i, url: abs(i.url, base) })),
    sequences: mapValues(bundle.sequences, (s) => ({ ...s, url: abs(s.url, base) })),
    footage: mapValues(bundle.footage, (v) => ({ ...v, url: abs(v.url, base) })),
    ...(bundle.fonts ? { fonts: mapValues(bundle.fonts, (set) => ({ ...set, files: set.files.map((f) => ({ ...f, url: abs(f.url, base) })) })) } : {}),
  };
}

/** Bundled font families with absolute file URLs. */
export const resolveFonts = (fonts, base) => (fonts ?? []).map((fam) => ({
  ...fam, files: fam.files.map((f) => ({ ...f, url: abs(f.url, base) })),
  ...(fam.ext ? { ext: { ...fam.ext, files: fam.ext.files.map((f) => ({ ...f, url: abs(f.url, base) })) } } : {}),
}));

export class Engine {
  /** @param {{ canvas?: HTMLCanvasElement | null, worker?: string | URL, timeout?: number }} [o] */
  constructor({ canvas = null, worker = new URL('./worker.js', import.meta.url), timeout = DRAW_MS } = {}) {
    this.workerUrl = worker;
    this.timeout = timeout;
    this.worker = null; this.pending = new Map(); this.nextId = 1;
    this.input = null; this.loaded = false; this.loading = null;
    this.composition = null;
    this.out = null; this.canvas = null;
    if (canvas) this.attach(canvas);
  }

  /** Present frames on this canvas (its context becomes a bitmaprenderer). */
  attach(canvas) {
    this.canvas = canvas;
    this.out = canvas.getContext('bitmaprenderer');
  }

  spawn() {
    const worker = new Worker(this.workerUrl, { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      if (data.progress) return p.onProgress?.(data.progress[0] / Math.max(1, data.progress[1]));
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.ok) p.resolve(data); else p.reject(new Error(data.error));
    };
    worker.onerror = (e) => { e.preventDefault(); this.kill(new Error(e.message || 'The player could not start its worker')); };
    this.worker = worker;
    this.loaded = false;
  }

  kill(err) {
    this.worker?.terminate();
    this.worker = null;
    this.loaded = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  /** @param {any} msg @param {{ timeout?: number, onProgress?: (p: number) => void, transfer?: any[] }} [o] */
  send(msg, { timeout = this.timeout, onProgress, transfer = [] } = {}) {
    if (!this.worker) this.spawn();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        // asset code that never returns: stop the worker; the next request starts a fresh one and loads again
        this.pending.delete(id);
        this.kill(new Error('Stopped'));
        reject(new Error('The clip took too long to draw a frame, so the player stopped it.'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, onProgress });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /**
   * Load a clip into the worker. input: { composition, bundle, fonts? }; base: what relative URLs in it are relative
   * to (an exported bundle.json's own URL). onProgress: 0…1 over the fonts and images it loads.
   * @param {{ composition: any, bundle: any, fonts?: any[] }} input
   * @param {{ base?: string | URL, onProgress?: (p: number) => void }} [o]
   */
  async load(input, { base = location.href, onProgress } = {}) {
    this.input = { composition: input.composition, bundle: resolveBundle(input.bundle, base), fonts: resolveFonts(input.fonts, base) };
    this.composition = input.composition;
    this.loaded = false;
    await this.ensureLoaded(onProgress);
  }

  async ensureLoaded(onProgress) {
    if (!this.worker) this.spawn();
    if (this.loaded) return;
    if (!this.input) throw new Error('Nothing is loaded: call load() first');
    this.loading ??= this.send({ op: 'load', ...this.input, composition: this.composition }, { timeout: 120000, onProgress })
      .then(() => { this.loaded = true; }).finally(() => { this.loading = null; });
    await this.loading;
  }

  /** A composition that uses the same asset versions (an editor's draft). */
  setComposition(composition) {
    this.composition = composition;
    if (this.loaded) this.send({ op: 'setComposition', composition }).catch(() => {});
  }

  /**
   * Draw a frame and present it on the attached canvas. extra: { fast (playing: footage from the studio comes as
   * JPEG), ahead (fetch the media of that many frames after it), ui (an interactive composition's state), record }.
   * → what the worker returned: { frame, width, height, regions, texts }.
   * @param {number} frame @param {{ fast?: boolean, ahead?: number, ui?: any, record?: boolean }} [extra]
   */
  async drawFrame(frame, extra = {}) {
    await this.ensureLoaded();
    const r = await this.send({ op: 'clipFrame', frame, ...extra });
    const { bitmap } = r;
    if (this.canvas) {
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) { this.canvas.width = bitmap.width; this.canvas.height = bitmap.height; }
      this.out.transferFromImageBitmap(bitmap);
    } else bitmap.close();
    return { frame: r.frame, width: bitmap.width, height: bitmap.height, regions: r.regions, texts: r.texts };
  }

  /**
   * Fetch the media (footage and sequence frames) of these frames before they are drawn.
   * @param {number[]} frames @param {{ fast?: boolean, onProgress?: (p: number) => void }} [o]
   */
  async preload(frames, { fast = false, onProgress } = {}) {
    await this.ensureLoaded();
    return this.send({ op: 'preload', frames, fast }, { timeout: 120000, onProgress });
  }

  destroy() {
    this.kill(new Error('Closed'));
    this.input = null;
  }
}
