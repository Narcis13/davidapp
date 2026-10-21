// The live side of an interactive clip: a clock, the viewer's input stamped with session frames, and the
// fold of core/interactive.js between them. A page (the share player, the studio editor) gives it a draw
// function that renders a view (in its worker) and resolves to that frame's hit regions, and feeds it pointer
// and key events in frame pixels. The input it records is the log a replay plays back to the same frames:
// an event is stamped with the frame being drawn or on screen, and read against that frame's regions.
//
//   const s = createSession(composition, { draw, onAudio, onFrame, onError })
//   s.start()  s.pause()  s.resume()  s.stop()  s.input({ type, x, y, pointer, key, shift })
//   s.log  s.state  s.frame  s.regions  s.regionAt(x, y)  s.paused

import { initialState, advance, applyInput, viewOf, inside, focusables } from '../core/interactive.js';

/**
 * @param {any} comp a normalized, pinned interactive composition
 * @param {{ draw: (view: any) => Promise<any[] | undefined>, onAudio?: (cues: { start: { item: string, offset: number, loop?: boolean }[], stop: string[] }) => void,
 *   onFrame?: (n: number, view: any, state: any) => void, onError?: (e: Error) => void, now?: () => number, raf?: (fn: () => void) => any, cancel?: (id: any) => void }} o
 */
export function createSession(comp, { draw, onAudio = () => {}, onFrame = () => {}, onError = () => {}, now = () => performance.now(), raf = (fn) => requestAnimationFrame(fn), cancel = (id) => cancelAnimationFrame(id) }) {
  const fps = comp.fps;
  const audioItems = comp.tracks.filter((t) => t.type === 'audio' && !t.muted && !t.hidden).flatMap((t) => t.items);
  const music = new Set(comp.interactive.music ?? []);
  // gen: which start this is; a frame still being drawn when the session restarts belongs to the old one and is dropped
  let state, shown, regions, pending, open, base, pausedAt, busy, timer, stopped, log, heard, playing, gen = 0;

  function reset() {
    gen++;
    state = initialState(comp);
    shown = -1; regions = []; pending = []; open = 0; log = [];
    base = now(); pausedAt = null; busy = false; heard = 0; playing = new Map();
  }
  reset();
  stopped = true;

  const clock = () => Math.max(0, Math.floor((((pausedAt ?? now()) - base) / 1000) * fps));

  /** Which audio starts and stops between two frames: cues from play actions, timeline audio the playhead enters or leaves. */
  function audioBetween(view) {
    const start = [], stop = [];
    for (const x of state.sounds) if (x.n > heard) { start.push({ item: x.item, offset: 0 }); heard = x.n; }
    const t = view.frame / fps;
    const entry = `${state.scene}@${state.entered}`;
    const now = new Map();
    for (const item of audioItems) {
      if (item.cue || music.has(item.id)) continue;
      if (t >= item.start && t < item.start + item.duration) now.set(item.id, entry);
    }
    for (const [id, was] of playing) if (now.get(id) !== was) stop.push(id);
    for (const [id, e] of now) {
      if (playing.get(id) === e) continue;
      const item = audioItems.find((i) => i.id === id);
      start.push({ item: id, offset: Math.max(0, t - item.start), ...(item.loop ? { loop: true } : {}) });
    }
    playing = now;
    return { start, stop };
  }

  async function tick() {
    if (stopped) return;
    timer = raf(tick);
    if (busy || pausedAt !== null) return;
    const m = clock();
    if (m <= shown) return;
    busy = true;
    const mine = gen;
    try {
      // the events stamped with the frame on screen are read against the regions it drew; then time runs on to m
      if (pending.length) { state = applyInput(comp, state, open, pending, regions); pending = []; }
      state = advance(comp, state, Math.max(m, state.f));
      const n = state.f;
      open = n;
      const view = viewOf(comp, state, n);
      const cues = audioBetween(view);
      if (cues.start.length || cues.stop.length) onAudio(cues);
      const drawn = (await draw(view)) ?? [];
      if (mine !== gen) return;
      regions = drawn;
      shown = n;
      onFrame(n, view, state);
    } catch (e) {
      if (mine !== gen) return;
      stopped = true;
      cancel(timer);
      onError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (mine === gen) busy = false;
    }
  }

  return {
    /** Start playing from the first frame (music starts here: call it from a tap so sound may play). */
    start() {
      reset();
      stopped = false;
      if (music.size) onAudio({ start: [...music].map((item) => ({ item, offset: 0, loop: true })), stop: [] });
      timer = raf(tick);
    },
    stop() { stopped = true; cancel(timer); onAudio({ start: [], stop: [...playing.keys(), ...music] }); },
    /** Hold the clock (a hidden tab, the pause button): input is ignored until resume. */
    pause() { if (pausedAt === null) pausedAt = now(); },
    resume() { if (pausedAt !== null) { base += now() - pausedAt; pausedAt = null; } },
    get paused() { return pausedAt !== null; },
    /**
     * Viewer input in frame pixels: { type: down|move|up|cancel|leave|key, x, y, pointer: mouse|touch|pen, key, shift }.
     * Moves within one frame are kept as one (the last), as the log records them.
     */
    input(ev) {
      // nothing is on screen before the first frame: input then would be read against regions nobody saw
      if (stopped || pausedAt !== null || shown < 0) return;
      const e = ev.type === 'key' ? { f: open, type: 'key', key: ev.key, ...(ev.shift ? { shift: true } : {}) }
        : ev.type === 'leave' || ev.type === 'cancel' ? { f: open, type: ev.type }
          : { f: open, type: ev.type, x: Math.round(ev.x * 10) / 10, y: Math.round(ev.y * 10) / 10, pointer: ev.pointer ?? 'mouse' };
      const last = pending.at(-1);
      if (e.type === 'move' && last?.type === 'move') { pending[pending.length - 1] = e; log[log.length - 1] = e; return; }
      pending.push(e);
      log.push(e);
    },
    /**
     * Should Tab (Shift+Tab) leave the clip for the page? Yes from a visible focus on its last (first) control, or with no
     * control to reach: the page never traps the keyboard. A focus a click left is not shown, so the first Tab shows it.
     */
    tabLeaves(shift) {
      const stops = focusables(regions);
      const i = stops.findIndex((r) => r.key === state.focus);
      return !stops.length || (state.focusVisible && (shift ? i === 0 : i === stops.length - 1));
    },
    /** The region under a frame-pixel point on the frame on screen (for the cursor), or null. */
    regionAt(x, y) { for (let i = regions.length - 1; i >= 0; i--) if (inside(regions[i], x, y)) return regions[i]; return null; },
    get log() { return log; },
    get state() { return state; },
    get frame() { return shown; },
    get regions() { return regions; },
  };
}
