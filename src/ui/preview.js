// Preview: draws asset and clip frames into a <canvas> through the preview worker, with
// playback, scrubbing and (for clips) audio. The page never runs asset code itself.
//
//   const pv = new Preview(canvasEl, { onTime, onError, onState });
//   await pv.showAsset({ ref, bundle, params, duration, width, height });   // asset playground
//   await pv.showClip({ composition, bundle, audioUrl });                   // clip editor
//   pv.setParams(p)  pv.setComposition(c)  pv.seek(t)  pv.play()  pv.pause()  pv.toggle()  pv.destroy()
//   pv.setRecord(true)   // clip frames also report the measured text (frame pixels) through onTexts(texts, frame)

const WATCHDOG_MS = 5000;
let fontsPromise = null;
const loadFonts = () => (fontsPromise ??= fetch('/api/status').then((r) => r.json()).then((s) => s.fonts));

export class Preview {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, { onTime = () => {}, onError = () => {}, onState = () => {}, onTexts = () => {} } = {}) {
    this.canvas = canvas;
    this.out = canvas.getContext('bitmaprenderer');
    this.onTime = onTime; this.onError = onError; this.onState = onState; this.onTexts = onTexts;
    this.record = false;
    this.worker = null; this.pending = new Map(); this.nextId = 1;
    this.mode = null; this.view = null; this.loaded = null;
    this.time = 0; this.playing = false; this.inflight = false; this.dirty = false;
    this.audio = null; this.raf = 0; this.error = null; this.destroyed = false;
    this.loop = true;
  }

  get duration() { return this.mode === 'clip' ? this.view.composition.duration : this.view?.duration ?? 0; }
  get fps() { return this.mode === 'clip' ? this.view.composition.fps : this.view?.fps ?? 30; }

  spawn() {
    const worker = new Worker('/ui/preview-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.ok) p.resolve(data); else p.reject(new Error(data.error));
    };
    worker.onerror = (e) => { e.preventDefault(); this.kill(new Error(e.message || 'The preview worker failed to start')); };
    this.worker = worker;
    this.ready = loadFonts().then((fonts) => this.send({ op: 'fonts', fonts }, 15000));
  }

  kill(err) {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  send(msg, timeout = WATCHDOG_MS) {
    if (!this.worker) this.spawn();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        // asset code that never returns: stop the worker; the next request starts a fresh one
        this.pending.delete(id);
        this.kill(new Error('Stopped'));
        reject(new Error('The preview timed out: asset code is taking too long to draw a frame. The preview worker was restarted.'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...msg, id });
    });
  }

  async ensureLoaded() {
    if (!this.worker) { this.spawn(); this.workerLoaded = null; }
    await this.ready;
    if (this.workerLoaded !== this.loaded) {
      await this.send({ op: 'load', bundle: this.loaded.bundle, composition: this.loaded.composition }, 20000);
      this.workerLoaded = this.loaded;
    }
  }

  /** Show one asset. view: { ref, bundle, params, duration, width, height, fps, seed, background } */
  async showAsset(view) {
    this.pause();
    this.mode = 'asset';
    this.view = { fps: 30, seed: 1, background: '#101018', params: {}, ...view };
    this.loaded = { bundle: view.bundle, composition: null };
    this.setAudio(view.audioUrl ?? null);
    this.time = Math.min(this.time, this.duration);
    return this.draw();
  }

  /** Show a clip. view: { composition, bundle, audioUrl } */
  async showClip(view) {
    this.pause();
    this.mode = 'clip';
    this.view = { ...view };
    this.loaded = { bundle: view.bundle, composition: view.composition };
    this.setAudio(view.audioUrl ?? null);
    this.time = Math.min(this.time, this.duration);
    return this.draw();
  }

  /** Ask for the measured text of every clip frame (for the editor's text overlay); off clears it. */
  setRecord(on) {
    if (!!on === this.record) return;
    this.record = !!on;
    if (!this.record) this.onTexts([], 0); else this.request();
  }

  setParams(params) { if (this.mode === 'asset') { this.view.params = params; this.request(); } }
  setView(patch) { Object.assign(this.view, patch); this.time = Math.min(this.time, this.duration); this.request(); }
  /** A draft composition that uses the same asset versions as the loaded bundle. */
  setComposition(composition) { if (this.mode === 'clip') { this.view.composition = composition; this.request(); } }

  setAudio(url) {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
    if (url) { this.audio = new Audio(url); this.audio.preload = 'auto'; }
  }

  request() {
    if (this.inflight) { this.dirty = true; return; }
    this.draw();
  }

  async draw() {
    if (this.destroyed || !this.view) return;
    this.inflight = true; this.dirty = false;
    const t = this.time;
    try {
      await this.ensureLoaded();
      const v = this.view;
      const frame = Math.min(Math.round(t * this.fps), Math.max(0, Math.round(this.duration * this.fps) - 1));
      const r = this.mode === 'clip'
        ? await this.send({ op: 'clipFrame', frame, composition: v.composition, record: this.record })
        : await this.send({ op: 'assetFrame', ref: v.ref, params: v.params, t: Math.min(t, Math.max(0, v.duration - 1 / v.fps)), duration: v.duration, width: v.width, height: v.height, fps: v.fps, seed: v.seed, background: v.background });
      if (this.destroyed) return;
      if (this.canvas.width !== r.bitmap.width || this.canvas.height !== r.bitmap.height) { this.canvas.width = r.bitmap.width; this.canvas.height = r.bitmap.height; }
      this.out.transferFromImageBitmap(r.bitmap);
      this.canvas.dataset.frame = String(frame);
      if (this.record && this.mode === 'clip') this.onTexts(r.texts ?? [], frame);
      if (this.error) { this.error = null; this.onError(null); }
    } catch (e) {
      this.error = e.message;
      this.pause();
      this.onError(e.message);
    } finally {
      this.inflight = false;
      if (this.dirty && !this.destroyed) this.draw();
    }
  }

  seek(t) {
    this.time = Math.max(0, Math.min(t, this.duration));
    if (this.audio && this.playing) this.audio.currentTime = this.time;
    this.onTime(this.time);
    this.request();
  }

  play() {
    if (this.playing || !this.view) return;
    if (this.time >= this.duration - 1 / this.fps) this.time = 0;
    this.playing = true;
    this.onState(true);
    const start = performance.now() - this.time * 1000;
    if (this.audio) { this.audio.currentTime = this.time; this.audio.play().catch(() => {}); }
    const tick = () => {
      if (!this.playing) return;
      let t = (performance.now() - start) / 1000;
      if (this.audio && !this.audio.paused && this.audio.currentTime > 0) t = this.audio.currentTime;
      if (t >= this.duration) {
        this.time = this.duration;
        this.onTime(this.time);
        this.pause();
        return;
      }
      this.time = t;
      this.onTime(t);
      this.request();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    this.onState(false);
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.setAudio(null);
    this.kill(new Error('Closed'));
  }
}
