// Play mode of the clip editor: an interactive composition run as its viewer would, on the preview canvas.
// A session (player/session.js: the clock, the input stamped with frames, the fold of core/interactive.js) asks
// this module's `draw` for each frame; the preview worker draws it and answers with the frame's hit regions.
// What the viewer does reaches the session as input in frame pixels: the pointer on the canvas (mapped from CSS
// pixels), the keys while the canvas has the focus. Sound goes through Web Audio: each audio item is mixed by the
// studio (the same mixer a render uses) into a buffer, started where the session says (a play action, music, an
// audio item the playhead enters). The bar holds Play (pause and resume), Restart, Stop, Copy log, a toggle for the
// hit regions and a live readout of the scene and the variables.
//
//   const play = createPlay({ slug, canvas, pv, host, composition, blocked, onMode, onFrame, onStop })
//   play.el   play.stop()   play.refresh(t)   play.destroy()   play.mode

import { api } from '/ui/lib/api.js';
import { fill, h, icon, s } from '/ui/lib/util.js';
import { sceneAtTime, varsOf } from '/ui/lib/wires.js';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'Dead', 'Process', 'Unidentified', 'AltGraph']);
const LABEL = { design: 'Play', loading: 'Loading', playing: 'Pause', paused: 'Resume', error: 'Play again' };

/** Web Audio for a session: one buffer per audio item (made by the studio), started and stopped on the session's cues. */
function createSound(slug, comp, problem, stat = () => {}) {
  const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
  /** @type {AudioContext | null} */
  let ctx = null;
  try { ctx = Ctx ? new Ctx() : null; ctx?.resume?.(); } catch { ctx = null; }
  const master = ctx?.createGain();
  master?.connect(ctx.destination);
  /** @type {Map<string, any>} */
  const items = new Map();
  for (const track of comp.tracks) if (track.type === 'audio' && !track.muted && !track.hidden) for (const item of track.items) items.set(item.id, item);
  const buffers = new Map();
  const live = new Map();
  const gen = new Map();

  /** The item mixed on its own (its fades, gain, offset and parameters) from its own start, as an AudioBuffer. */
  function bufferOf(id) {
    if (!buffers.has(id)) {
      buffers.set(id, (async () => {
        const item = items.get(id);
        if (!item || !ctx) return null;
        const keep = {};
        for (const k of ['offset', 'assetDuration', 'gain', 'fadeIn', 'fadeOut', 'keyframes', 'seedId']) if (item[k] !== undefined) keep[k] = item[k];
        const mini = { width: comp.width, height: comp.height, fps: comp.fps, duration: Math.max(0.1, item.duration), tracks: [{ id: 'sound', type: 'audio', items: [{ id: item.id, asset: item.asset, start: 0, duration: item.duration, params: item.params ?? {}, ...keep }] }] };
        const blob = await api.blob(`/api/clips/${slug}/audio`, { composition: mini });
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        stat('buffers');
        return decoded;
      })().catch((e) => { problem(`The sound of "${id}" could not be made: ${e.message}`); return null; }));
    }
    return buffers.get(id);
  }

  async function start({ item, offset = 0, loop = false }) {
    if (!ctx) return;
    const g = gen.get(item) ?? 0;
    const buffer = await bufferOf(item);
    if (!buffer || (gen.get(item) ?? 0) !== g || ctx.state === 'closed') return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!loop;
    src.connect(master);
    if (!live.has(item)) live.set(item, new Set());
    live.get(item).add(src);
    src.onended = () => live.get(item)?.delete(src);
    src.start(0, Math.min(Math.max(0, offset), Math.max(0, buffer.duration - 0.01)));
    stat('started');
  }
  function stopItem(id) {
    gen.set(id, (gen.get(id) ?? 0) + 1);
    for (const src of live.get(id) ?? []) { try { src.stop(); } catch { /* already ended */ } }
    live.delete(id);
  }
  return {
    get available() { return !!ctx; },
    /** The cues a session reports: { start: [{ item, offset, loop }], stop: [item ids] }. */
    cues({ start: starts = [], stop = [] }) {
      for (const id of stop) stopItem(id);
      for (const c of starts) start(c);
    },
    /** The sounds a wire plays and the music, mixed ahead so the first cue does not wait for the studio. */
    preload(ids) { for (const id of ids) if (items.has(id)) bufferOf(id); },
    stopAll() { for (const id of items.keys()) stopItem(id); },
    pause() { ctx?.suspend?.().catch(() => {}); },
    resume() { ctx?.resume?.().catch(() => {}); },
    close() { this.stopAll(); ctx?.close?.().catch(() => {}); ctx = null; },
  };
}

/**
 * @param {{
 *   slug: string, canvas: HTMLCanvasElement, pv: any, host: HTMLElement,
 *   composition: () => any, blocked?: () => string | null,
 *   onMode?: (mode: string, was: string) => void, onFrame?: (n: number, view: any, state: any) => void, onStop?: () => void,
 * }} o
 *   composition: the interactive composition to play (the draft, in the format laid out); blocked: why it cannot play now, or null;
 *   host: the element over the canvas, for the hit-region outlines.
 */
export function createPlay({ slug, canvas, pv, host, composition, blocked = () => null, onMode = () => {}, onFrame = () => {}, onStop = () => {} }) {
  /** @type {'design' | 'loading' | 'playing' | 'paused' | 'error'} */
  let mode = 'design';
  let session = null, sound = null, lastLog = [], mod = null, token = 0, playComp = null;
  let lastSig = '', lastShown = 0, regionsOn = false, fps = 30;

  const playBtn = h('button.btn.primary.iv-play', { type: 'button', 'data-testid': 'play-interactive', 'data-playing': 'false', 'data-mode': 'design', title: 'Play the clip as a viewer would: click, tap and press keys on the stage' }, icon('play', 16), h('span.iv-play-label', 'Play'));
  const restartBtn = h('button.btn', { type: 'button', 'data-testid': 'interactive-restart', disabled: true, title: 'Start again from the first scene' }, 'Restart');
  const stopBtn = h('button.btn', { type: 'button', 'data-testid': 'interactive-stop', disabled: true, title: 'Back to the design timeline' }, 'Stop');
  const logBtn = h('button.btn', { type: 'button', 'data-testid': 'interactive-log', disabled: true, title: 'Copy the recorded input as JSON; it replays the same session' }, 'Copy log');
  const regionsBtn = h('button.btn.toggle', { type: 'button', 'data-testid': 'interactive-regions', 'aria-pressed': 'false', title: 'Outline what can be pressed' }, 'Hit regions');
  const state = h('div.iv-state', { 'data-testid': 'interactive-state', 'data-mode': 'design', role: 'status', 'aria-live': 'off' });
  const note = h('p.iv-note', { 'data-testid': 'interactive-note', role: 'status' });
  const el = h('div.play-bar', { 'data-testid': 'play-bar' }, h('div.play-bar-row', playBtn, restartBtn, stopBtn, logBtn, regionsBtn), state, note);
  const overlay = s('svg', { class: 'iv-regions', 'data-testid': 'region-overlay', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  overlay.style.display = 'none';
  host.append(overlay);

  const say = (text, kind = '') => { note.textContent = text; note.className = `iv-note${kind ? ` ${kind}` : ''}`; note.hidden = !text; };
  say('');

  function setMode(next) {
    const was = mode;
    mode = next;
    el.dataset.mode = next;
    host.dataset.play = next;
    const active = next === 'playing' || next === 'paused' || next === 'loading';
    playBtn.dataset.playing = String(next === 'playing');
    playBtn.dataset.mode = next;
    playBtn.disabled = next === 'loading';
    fill(playBtn, icon(next === 'playing' ? 'pause' : 'play', 16), h('span.iv-play-label', LABEL[next]));
    restartBtn.disabled = !(next === 'playing' || next === 'paused');
    stopBtn.disabled = !(active || next === 'error');
    logBtn.disabled = !(session?.log?.length || lastLog.length);
    // the canvas takes the keys while a session runs; the page's own tab order is left alone otherwise
    if (next === 'design') { canvas.removeAttribute('tabindex'); canvas.style.touchAction = ''; canvas.style.cursor = ''; } else { canvas.tabIndex = 0; canvas.style.touchAction = 'none'; }
    state.dataset.mode = next;
    if (was !== next) onMode(next, was);
  }

  // ── the readout ──────────────────────────────────────────────────────────────────────────
  function varChips(vars) { return Object.entries(vars).map(([k, v]) => h('span.iv-chip', { 'data-var': k }, h('span', k), ' ', h('b', String(v)))); }

  function readout(st, n) {
    state.dataset.scene = st.scene ?? '';
    state.dataset.vars = JSON.stringify(st.vars);
    state.dataset.frame = String(n);
    state.dataset.focus = st.focus ?? '';
    state.dataset.events = String(session?.log.length ?? 0);
    fill(state,
      h('span.iv-chip.scene', 'Scene ', h('b', st.scene ?? 'none')),
      varChips(st.vars),
      h('span.iv-chip.quiet', `${(n / fps).toFixed(1)} s`),
      st.focus ? h('span.iv-chip.quiet', 'focus ', h('b', st.focus.split(':').slice(0, 2).join('.'))) : null,
      h('span.iv-chip.quiet', `${session?.log.length ?? 0} inputs`));
  }

  /** Not playing: the scene the playhead is in and the variables' first values (what the design timeline draws). */
  function refresh(t) {
    if (mode !== 'design') return;
    const comp = composition();
    const scene = sceneAtTime(comp.interactive, t);
    state.dataset.scene = scene?.id ?? '';
    state.dataset.vars = JSON.stringify(comp.interactive?.vars ?? {});
    state.dataset.frame = String(Math.round(t * comp.fps));
    delete state.dataset.focus; delete state.dataset.events;
    fill(state,
      h('span.iv-chip.quiet', 'Not playing'),
      h('span.iv-chip.scene', 'Playhead in ', h('b', scene?.id ?? 'no scene')),
      varChips(Object.fromEntries(varsOf(comp.interactive))));
  }

  // ── hit regions drawn over the canvas ────────────────────────────────────────────────────
  function drawRegions(regions, focus) {
    overlay.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    overlay.replaceChildren(...regions.map((r) => {
      const [a, b, c, d, e, f] = r.m;
      const at = (x, y) => `${(a * x + c * y + e).toFixed(1)},${(b * x + d * y + f).toFixed(1)}`;
      const pts = r.shape === 'circle'
        ? Array.from({ length: 36 }, (_, i) => at(r.x + r.w / 2 + (Math.cos((i / 36) * Math.PI * 2) * r.w) / 2, r.y + r.h / 2 + (Math.sin((i / 36) * Math.PI * 2) * r.h) / 2))
        : [at(r.x, r.y), at(r.x + r.w, r.y), at(r.x + r.w, r.y + r.h), at(r.x, r.y + r.h)];
      const title = s('title', {}, r.label ?? `${r.item}.${r.name}`);
      return s('polygon', { points: pts.join(' '), class: r.key === focus ? 'on focus' : 'on', 'data-key': r.key }, title);
    }));
  }
  regionsBtn.addEventListener('click', () => {
    regionsOn = !regionsOn;
    regionsBtn.setAttribute('aria-pressed', String(regionsOn));
    regionsBtn.classList.toggle('on', regionsOn);
    overlay.style.display = regionsOn ? '' : 'none';
    if (regionsOn && session) drawRegions(session.regions, session.state?.focus);
  });

  // ── the session ──────────────────────────────────────────────────────────────────────────
  function frameDrawn(n, view, st) {
    const now = performance.now();
    const sig = `${st.scene}|${JSON.stringify(st.vars)}|${st.focus}`;
    if (sig !== lastSig || now - lastShown > 120) { lastSig = sig; lastShown = now; readout(st, n); }
    if (regionsOn) drawRegions(session.regions, st.focus);
    logBtn.disabled = !session.log.length;
    onFrame(n, view, st);
  }

  /** A new session on the composition being played; one a frame of which is still in flight when it ends cannot reach back (see `session ===`). */
  function launch() {
    lastSig = '';
    const created = mod.createSession(playComp, {
      draw: (view) => pv.drawView(view),
      onAudio: (cues) => { if (session === created) sound?.cues(cues); },
      onFrame: (n, view, st) => { if (session === created) frameDrawn(n, view, st); },
      onError: (e) => { if (session === created) failed(e.message); },
    });
    session = created;
    created.start();
  }

  function failed(message) {
    sound?.stopAll();
    pv.onError(message);
    say('');
    setMode('error');
  }

  async function start() {
    if (mode === 'loading' || mode === 'playing' || mode === 'paused') return;
    const why = blocked();
    if (why) { say(why, 'error'); return; }
    say('');
    pv.onError(null);
    const mine = ++token;
    setMode('loading');
    // the audio context is made inside the click that starts play, so the browser lets it sound
    const comp = composition();
    fps = comp.fps;
    sound?.close();
    el.dataset.buffers = '0';
    el.dataset.started = '0';
    sound = createSound(slug, comp, (m) => say(m, 'warn'), (what) => { el.dataset[what] = String(Number(el.dataset[what] ?? 0) + 1); });
    try {
      mod ??= await import('/player/session.js');
    } catch (e) {
      if (mine === token) failed(`The player could not be loaded: ${e.message}`);
      return;
    }
    if (mine !== token) return;
    try {
      pv.setComposition(comp);
      pv.lock(true);
      lastLog = [];
      playComp = comp;
      launch();
    } catch (e) {
      failed(e.message);
      return;
    }
    setMode('playing');
    canvas.focus({ preventScroll: true });
    const music = comp.interactive.music ?? [];
    const cues = comp.tracks.flatMap((t) => (t.type === 'audio' ? t.items : [])).filter((i) => i.cue || music.includes(i.id)).map((i) => i.id);
    sound.preload(cues);
    if (!sound.available) say('Sound is not available in this browser.', 'warn');
  }

  function pause() {
    if (mode !== 'playing') return;
    session.pause();
    sound?.pause();
    setMode('paused');
  }
  function resume() {
    if (mode !== 'paused') return;
    session.resume();
    sound?.resume();
    setMode('playing');
    canvas.focus({ preventScroll: true });
  }

  /** Back to the design timeline: the session stops (its log stays copyable), the preview draws the design frame again. */
  function stop() {
    if (mode === 'design') return;
    token++;
    if (session) { lastLog = [...session.log]; session.stop(); session = null; }
    sound?.close();
    sound = null;
    overlay.replaceChildren();
    pv.onError(null);
    pv.lock(false);
    say('');
    setMode('design');
    onStop();
  }

  function restart() {
    if (mode !== 'playing' && mode !== 'paused') return;
    sound?.stopAll();
    sound?.resume();
    // a new session: a frame of the old one still being drawn must not land in the new one
    const old = session;
    session = null;
    old.stop();
    lastLog = [];
    launch();
    if (mode === 'paused') setMode('playing');
    canvas.focus({ preventScroll: true });
  }

  playBtn.addEventListener('click', () => { if (mode === 'playing') pause(); else if (mode === 'paused') resume(); else start(); });
  restartBtn.addEventListener('click', restart);
  stopBtn.addEventListener('click', stop);

  // ── the log ──────────────────────────────────────────────────────────────────────────────
  logBtn.addEventListener('click', async () => {
    const log = session?.log?.length ? [...session.log] : lastLog;
    if (!log.length) return;
    const text = JSON.stringify(log);
    const count = `${log.length} input event${log.length === 1 ? '' : 's'}`;
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied ${count}. Replay it with play_clip.`, 'ok');
    } catch {
      // no clipboard here (or no permission): the same JSON as a file
      const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `${slug}-input-log.json` });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      say(`Saved ${count} as ${slug}-input-log.json.`, 'ok');
    }
  });

  // ── input: the pointer and the keys, in frame pixels ─────────────────────────────────────
  const toFrame = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / (r.width || 1), y: ((e.clientY - r.top) * canvas.height) / (r.height || 1) };
  };
  const pointer = (e) => (e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse');
  const live = () => mode === 'playing' && session;

  canvas.addEventListener('pointerdown', (e) => {
    if (!live() || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer cannot be captured */ }
    const p = toFrame(e);
    session.input({ type: 'move', ...p, pointer: pointer(e) });
    session.input({ type: 'down', ...p, pointer: pointer(e) });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live()) return;
    const p = toFrame(e);
    session.input({ type: 'move', ...p, pointer: pointer(e) });
    canvas.style.cursor = session.regionAt(p.x, p.y) ? 'pointer' : '';
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!live()) return;
    session.input({ type: 'up', ...toFrame(e), pointer: pointer(e) });
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  });
  canvas.addEventListener('pointercancel', () => { if (live()) session.input({ type: 'cancel' }); });
  canvas.addEventListener('pointerleave', (e) => {
    if (live() && e.pointerType !== 'touch' && !(e.buttons & 1)) { session.input({ type: 'leave' }); canvas.style.cursor = ''; }
  });
  canvas.addEventListener('contextmenu', (e) => { if (mode !== 'design') e.preventDefault(); });

  canvas.addEventListener('keydown', (e) => {
    if (!live() || e.ctrlKey || e.metaKey || e.altKey || MODIFIERS.has(e.key) || /^F\d+$/.test(e.key)) return;
    if (e.key === 'Tab') {
      // Tab walks the things that can be pressed; past either end it moves on, so the keyboard is never trapped here
      if (session.tabLeaves(e.shiftKey)) return;
    }
    // the page must not scroll or act on a key the clip is using
    e.preventDefault();
    if (e.repeat && !e.key.startsWith('Arrow')) return;
    session.input({ type: 'key', key: e.key, shift: e.shiftKey });
  });

  // a clip in a background tab holds still; it does not start again by itself
  const hidden = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', hidden);

  setMode('design');

  return {
    el,
    get mode() { return mode; },
    get session() { return session; },
    stop,
    refresh,
    destroy() {
      document.removeEventListener('visibilitychange', hidden);
      token++;
      if (session) { session.stop(); session = null; }
      sound?.close();
      overlay.remove();
    },
  };
}
