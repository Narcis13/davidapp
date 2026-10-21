// The share page: one clip, drawn in the viewer's browser by its own asset code (engine.js runs the renderer's
// runtime in a worker), with a player around it: loading progress, the poster until the first frame, a big play
// button, play/pause, scrubber and time, sound, full screen, replay, keyboard shortcuts. A video clip plays muted by
// itself (a picture needs no permission) and its sound starts on the first tap or click; with prefers-reduced-motion
// nothing starts by itself. An interactive composition is handed to playInteractive instead.
//
// The page (page.html, filled in by src/studio/share.js) says where the bundle is: <main data-bundle="bundle.json">.
// What a check reads: main[data-state] (loading, ready, playing, paused, ended, error), canvas[data-frame],
// main[data-first-frame] (ms from navigation to the first frame drawn).

import { Engine } from './engine.js';
import { createSession } from './session.js';

const root = /** @type {HTMLElement} */ (document.querySelector('[data-share]'));
const $ = (id) => /** @type {any} */ (root.querySelector(`[data-testid=${id}]`));
const el = {
  frame: $('frame'), canvas: $('canvas'), poster: $('poster'), loading: $('loading'), big: $('big-play'), message: $('message'),
  play: $('play'), time: $('time'), scrub: $('scrub'), sound: $('sound'), hint: $('sound-hint'), full: $('fullscreen'), controls: $('controls'),
};
const spinner = root.querySelector('.spinner');
const coarse = matchMedia('(pointer: coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const setState = (s) => { root.dataset.state = s; };
/** Show the canvas instead of the poster (once a frame is on it). */
const reveal = () => { root.dataset.drawn = ''; };

function progress(p) {
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  el.loading.style.setProperty('--p', String(pct));
  el.loading.setAttribute('aria-valuenow', String(pct));
  el.loading.querySelector('.loading-text').textContent = `${pct}%`;
}

function fail(message) {
  setState('error');
  el.message.textContent = message;
  el.message.hidden = false;
  el.big.hidden = true; el.hint.hidden = true; spinner.hidden = true;
}

/** Everything the player needs: a module worker that can draw on an OffscreenCanvas and hand back bitmaps. */
function supported() {
  try {
    return typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function' && typeof ImageBitmapRenderingContext === 'function'
      && !!new OffscreenCanvas(1, 1).getContext('2d');
  } catch { return false; }
}

/** A JSON file, reporting how much of it has arrived. */
async function fetchJson(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`its data did not load (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.json();
  const reader = res.body.getReader();
  const chunks = [];
  for (let got = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onProgress(Math.min(1, (got += value.length) / total));
  }
  return JSON.parse(await new Blob(chunks).text());
}

const fmt = (s) => { const v = Math.max(0, Math.floor(s + 1e-6)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

// ── full screen: the element when the browser can, else the page covers the screen (iPhone) ───────────────
function setupFullscreen(composition) {
  const wide = composition.width > composition.height;
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    delete root.dataset.full;
    try { screen.orientation?.unlock?.(); } catch { /* not lockable here */ }
  };
  const enter = () => {
    if (document.fullscreenEnabled && root.requestFullscreen) {
      root.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        // a wide clip on a phone held upright: turn the picture sideways where the browser allows it (Android)
        if (wide && coarse) /** @type {any} */ (screen.orientation)?.lock?.('landscape').catch(() => {});
      }, () => { root.dataset.full = 'page'; });
    } else root.dataset.full = 'page';
  };
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === root) root.dataset.full = 'screen';
    else if (root.dataset.full === 'screen') delete root.dataset.full;
    sync();
  });
  const sync = () => el.full.setAttribute('aria-label', root.dataset.full ? 'Exit full screen' : 'Full screen');
  const toggle = () => { if (root.dataset.full) exit(); else enter(); sync(); };
  el.full.addEventListener('click', toggle);
  return { toggle, exit, active: () => !!root.dataset.full };
}

/** The pointer's position in composition pixels (the canvas shows the whole composition, letterboxed by the page). */
function toComposition(e) {
  const r = el.canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * el.canvas.width) / r.width, y: ((e.clientY - r.top) * el.canvas.height) / r.height };
}

async function main() {
  if (!supported()) return fail('This browser cannot play the clip. Open the link in an up-to-date Chrome, Safari, Edge or Firefox.');
  progress(0.03);
  const base = new URL(root.dataset.bundle, location.href);
  const data = await fetchJson(base, (p) => progress(0.03 + p * 0.27));
  const engine = new Engine({ canvas: el.canvas });
  await engine.load(data, { base, onProgress: (p) => progress(0.3 + p * 0.4) });
  const full = setupFullscreen(data.composition);
  if (data.composition.interactive) {
    root.dataset.interactive = '';
    el.canvas.tabIndex = 0;
    const ui = { root, canvas: el.canvas, setState, fail, reveal, progress, toComposition, fullscreen: full, data, base };
    return playInteractive(engine, el.canvas, data.composition, ui);
  }
  return playVideo(engine, data, base, full);
}

/**
 * An interactive composition: not a timeline to scrub but a session (session.js) that reacts to taps, clicks, keys
 * and the pointer. Until the viewer presses play the page shows the start scene settled, still; the press starts the
 * session and its sound (the browser's autoplay rules want a gesture). Pointer input on the canvas goes to the session
 * in composition pixels, keys while the clip is playing go to it too (Tab moves through the clip's own controls and
 * then on out of it, so the page never traps the keyboard). The sounds are one buffer per audio item, started and
 * stopped as the session says. window.fablecut exposes the session and frame timings to checks and the playthrough bot.
 * ui: { root, canvas, setState(name), fail(message), reveal(), progress(0…1), toComposition(event), fullscreen, data, base }.
 * @param {Engine} engine @param {HTMLCanvasElement} canvas @param {any} composition @param {any} ui
 */
async function playInteractive(engine, canvas, composition, ui) {
  const { data, base } = ui;
  root.querySelector('.details').append(el.controls);
  root.querySelector('[data-testid=keys]').innerHTML = '<kbd>Tab</kbd><kbd>Enter</kbd> its buttons, and the keys it shows';

  // ── sound: decoded before the first tap, heard from it on ────────────────────────────────────
  const AC = window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext;
  const sounds = data.sounds ?? {};
  const actx = AC && Object.keys(sounds).length ? new AC({ latencyHint: 'interactive' }) : null;
  const master = actx?.createGain();
  master?.connect(actx.destination);
  const buffers = new Map(), voices = new Map();
  let muted = false;
  if (actx) {
    const entries = Object.entries(sounds);
    let done = 0;
    await Promise.all(entries.map(async ([id, s]) => {
      const res = await fetch(new URL(s.url, base));
      if (!res.ok) throw new Error(`its sound "${id}" did not load (${res.status})`);
      buffers.set(id, await actx.decodeAudioData(await res.arrayBuffer()));
      ui.progress(0.7 + (++done / entries.length) * 0.2);
    }));
    el.sound.hidden = false;
  }
  function onAudio({ start, stop }) {
    if (!actx) return;
    for (const id of stop) { try { voices.get(id)?.stop(); } catch { /* already over */ } voices.delete(id); }
    for (const c of start) {
      const buffer = buffers.get(c.item);
      if (!buffer || (!c.loop && c.offset >= buffer.duration)) continue;
      const src = actx.createBufferSource();
      src.buffer = buffer;
      src.loop = !!c.loop;
      const gain = actx.createGain();
      gain.gain.value = sounds[c.item].gain ?? 1;
      src.connect(gain).connect(master);
      src.start(actx.currentTime, c.loop ? c.offset % buffer.duration : c.offset);
      // a cue may sound over itself (two hits in a row); anything else plays once at a time
      if (!sounds[c.item].cue) { try { voices.get(c.item)?.stop(); } catch { /* over */ } voices.set(c.item, src); }
    }
  }
  function setMuted(m) {
    muted = m;
    root.toggleAttribute('data-muted', m);
    el.sound.setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off');
    if (master) master.gain.value = m ? 0 : 1;
  }

  // ── drawing: the session asks for each frame; timings are kept for the checks ─────────────────
  const stats = { drawn: 0, skipped: 0, last: -1, ms: [], started: 0 };
  async function draw(view) {
    const t0 = performance.now();
    const r = await engine.drawFrame(view.frame, { ui: view.ui, transition: view.transition ?? undefined });
    stats.ms.push(Math.round((performance.now() - t0) * 10) / 10);
    if (stats.ms.length > 3600) stats.ms.shift();
    return r.regions ?? [];
  }
  const session = createSession(composition, {
    draw,
    onAudio,
    onFrame(n) {
      if (stats.last >= 0 && n > stats.last + 1) stats.skipped += n - stats.last - 1;
      stats.last = n; stats.drawn++;
      canvas.dataset.frame = String(n);
      canvas.dataset.scene = session.state.scene;
    },
    onError(e) { stopSound(); ui.fail(`The clip stopped: ${e.message}`); },
  });
  const stopSound = () => { for (const v of voices.values()) { try { v.stop(); } catch { /* over */ } } voices.clear(); };
  /** @type {any} */ (window).fablecut = { session, engine, stats, composition };

  // ── the still before it starts: the start scene as it settles, with the play button over it ─────
  const start = composition.interactive.scenes.find((s) => s.id === composition.interactive.start);
  await engine.drawFrame(Math.round((start.start + start.duration) * composition.fps) - 1, {});
  root.dataset.firstFrame = String(Math.round(performance.now()));
  ui.progress(1);
  ui.reveal();
  ui.setState('ready');
  el.big.hidden = false;
  el.big.setAttribute('aria-label', 'Play');
  el.big.focus({ preventScroll: true });

  function begin() {
    actx?.resume();
    setMuted(muted);
    if (root.dataset.state === 'ready') { session.start(); stats.started = performance.now(); } else session.resume();
    ui.setState('playing');
    el.big.hidden = true;
    el.play.setAttribute('aria-label', 'Pause');
    canvas.focus({ preventScroll: true });
  }
  function hold() {
    if (root.dataset.state !== 'playing') return;
    session.pause();
    actx?.suspend();
    ui.setState('paused');
    el.big.hidden = false;
    el.big.setAttribute('aria-label', 'Resume');
    el.play.setAttribute('aria-label', 'Play');
  }
  el.big.addEventListener('click', begin);
  el.play.addEventListener('click', () => (root.dataset.state === 'playing' ? hold() : begin()));
  el.sound.addEventListener('click', () => setMuted(!muted));
  document.addEventListener('visibilitychange', () => { if (document.hidden) hold(); });

  // ── input: the pointer on the canvas, keys while it plays ─────────────────────────────────────
  const playing = () => root.dataset.state === 'playing';
  const point = (type, e) => { const p = ui.toComposition(e); session.input({ type, x: p.x, y: p.y, pointer: e.pointerType || 'mouse' }); return p; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!playing()) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    point('down', e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!playing()) return;
    const p = point('move', e);
    canvas.style.cursor = session.regionAt(p.x, p.y) ? 'pointer' : '';
  });
  canvas.addEventListener('pointerup', (e) => { if (playing()) point('up', e); });
  canvas.addEventListener('pointercancel', () => { if (playing()) session.input({ type: 'cancel' }); });
  canvas.addEventListener('pointerleave', (e) => { if (playing() && e.pointerType === 'mouse' && !canvas.hasPointerCapture?.(e.pointerId)) session.input({ type: 'leave' }); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const OWN = new Set([' ', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  document.addEventListener('keydown', (e) => {
    if (!playing() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/** @type {any} */ (e.target)?.closest?.('.controls, .made, .big')) return;
    // held keys repeat: only the arrows (a slider) take the repeats
    if (e.repeat && !e.key.startsWith('Arrow')) { e.preventDefault(); return; }
    if (e.key === 'Tab') {
      // past the clip's last control (or before its first) the browser moves focus on: no keyboard trap
      const list = session.regions.filter((r) => r.focus !== false);
      const i = list.findIndex((r) => r.key === session.state.focus);
      if (!list.length || (!e.shiftKey && i === list.length - 1) || (e.shiftKey && i === 0)) return;
    }
    session.input({ type: 'key', key: e.key, shift: e.shiftKey });
    if (OWN.has(e.key) || e.key.length === 1) e.preventDefault();
  });
}

/**
 * A video clip: a clock (the sound's own time while it plays, else the page's), one frame drawn at a time (frames
 * are skipped when drawing is slower than the clip), the media of the next two seconds fetched while it plays.
 * @param {Engine} engine @param {any} data @param {URL} base @param {any} full
 */
async function playVideo(engine, data, base, full) {
  const comp = data.composition;
  const fps = comp.fps, duration = comp.duration;
  const total = Math.max(1, Math.round(duration * fps));
  const frameAt = (s) => Math.max(0, Math.min(total - 1, Math.floor(s * fps + 1e-6)));
  const audio = data.audio ? new Audio(new URL(data.audio, base).href) : null;
  if (audio) { audio.preload = 'auto'; root.append(Object.assign(audio, { hidden: true })); audio.dataset.testid = 'audio'; }

  let t = 0, playing = false, startedAt = 0, raf = 0;
  let muted = true, soundChosen = false, scrubbing = false;
  let shown = -1, shownFast = false, busy = false, drawStarted = 0, buffering = false;

  // ── drawing: one frame in flight; a newer wish replaces an older one ────────────────────────
  async function draw(frame, fast) {
    busy = true; drawStarted = performance.now();
    try {
      await engine.drawFrame(frame, { fast, ahead: fast ? Math.round(fps * 2) : 0 });
      shown = frame; shownFast = fast;
      el.canvas.dataset.frame = String(frame);
      if (!root.dataset.firstFrame) root.dataset.firstFrame = String(Math.round(performance.now()));
      if (buffering) {
        // back from waiting on the network: the clock resumes at the frame that arrived
        buffering = false; spinner.hidden = true;
        t = frame / fps; startedAt = performance.now() - t * 1000;
        if (audio && !muted && playing) startAudio();
      }
    } catch (e) {
      if (playing) stop();
      fail(`The clip stopped: ${e.message}`);
      throw e;
    } finally {
      busy = false;
    }
  }
  /** Draw what should be on screen now, if it is not there yet. */
  function pump() {
    if (busy || root.dataset.state === 'error') return;
    const want = frameAt(t);
    if (want !== shown || (!playing && shownFast)) draw(want, playing).then(() => { if (!playing) pump(); }, () => {});
  }

  // ── the clock ──────────────────────────────────────────────────────────────────────────────
  function startAudio() {
    audio.currentTime = Math.min(t, duration);
    audio.play().catch(() => { setMuted(true); });
  }
  /** While the sound plays, the picture follows it; a sound far off (it ignored a seek) is moved instead. */
  function followAudio() {
    if (!audio || muted || audio.paused || audio.readyState < 3) return;
    const d = audio.currentTime - t;
    if (Math.abs(d) > 0.75) audio.currentTime = t;
    else if (Math.abs(d) > 0.04) { t = audio.currentTime; startedAt = performance.now() - t * 1000; }
  }
  function tick() {
    if (!playing) return;
    if (busy && !buffering && performance.now() - drawStarted > 450) {
      // the frame waits for its media: hold the clock (and the sound) until it arrives
      buffering = true; spinner.hidden = false; audio?.pause();
    }
    if (!buffering && !scrubbing) {
      t = (performance.now() - startedAt) / 1000;
      followAudio();
      if (t >= duration) return end();
    }
    showTime();
    pump();
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (playing || root.dataset.state === 'error') return;
    if (t >= duration - 1 / fps) t = 0;
    playing = true;
    setState('playing');
    reveal();
    el.big.hidden = true;
    el.play.setAttribute('aria-label', 'Pause');
    startedAt = performance.now() - t * 1000;
    if (audio && !muted) startAudio();
    showHint();
    chrome();
    raf = requestAnimationFrame(tick);
  }
  /** Stop the clock and the sound. */
  function stop() {
    playing = false; buffering = false; spinner.hidden = true;
    cancelAnimationFrame(raf);
    audio?.pause();
    el.play.setAttribute('aria-label', 'Play');
    el.hint.hidden = true;
  }
  function pause() {
    if (!playing) return;
    stop();
    setState('paused');
    el.big.hidden = false;
    el.big.setAttribute('aria-label', 'Play');
    chrome();
    pump(); // the frame it stopped on, drawn exactly
  }
  function end() {
    stop();
    t = duration;
    setState('ended');
    el.big.hidden = false;
    el.big.setAttribute('aria-label', 'Replay');
    showTime();
    chrome();
    pump();
  }
  const toggle = () => (playing ? pause() : play());

  function seek(s) {
    t = Math.max(0, Math.min(duration, s));
    if (playing) { startedAt = performance.now() - t * 1000; if (audio && !muted) audio.currentTime = t; }
    else if (root.dataset.state === 'ended' && t < duration - 1 / fps) { setState('paused'); el.big.setAttribute('aria-label', 'Play'); }
    showTime();
    pump();
  }

  // ── sound ──────────────────────────────────────────────────────────────────────────────────
  function setMuted(m) {
    muted = m;
    root.toggleAttribute('data-muted', m);
    el.sound.setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off');
    if (!audio) return;
    if (m) audio.pause(); else if (playing && !buffering) startAudio();
    showHint();
  }
  /** The viewer's first say about sound (a tap, a click, a key): sound on, unless they said off. */
  function chooseSound(on) {
    soundChosen = true;
    setMuted(!on);
  }
  const showHint = () => { el.hint.hidden = !(audio && muted && playing && !soundChosen); };
  el.hint.querySelector('span').textContent = coarse ? 'Tap for sound' : 'Click for sound';

  // ── controls that hide while it plays ──────────────────────────────────────────────────────
  let chromeTimer = 0;
  function chrome() {
    root.dataset.chrome = 'on';
    clearTimeout(chromeTimer);
    if (playing) chromeTimer = setTimeout(() => { if (playing && !el.controls.matches(':hover') && !el.controls.querySelector(':focus-visible')) root.dataset.chrome = 'off'; }, 2600);
  }
  function showTime() {
    const p = duration > 0 ? (t / duration) * 100 : 0;
    el.time.querySelector('.now').textContent = fmt(t);
    if (!scrubbing) el.scrub.value = String(t);
    el.scrub.style.setProperty('--p', `${p}%`);
    el.scrub.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(duration)}`);
  }

  el.time.querySelector('.total').textContent = fmt(duration);
  el.scrub.max = String(duration);
  el.scrub.step = String(1 / fps);

  el.big.addEventListener('click', () => {
    // pressing play is the first say about sound: it starts with it
    if (audio && !soundChosen) chooseSound(true);
    play();
  });
  el.play.addEventListener('click', toggle);
  el.sound.addEventListener('click', () => chooseSound(muted));
  el.hint.addEventListener('click', () => { chooseSound(true); if (!playing) play(); chrome(); });

  el.frame.addEventListener('click', (e) => {
    if (e.target.closest('.controls, .big, .sound-hint') || !['playing', 'paused', 'ended', 'ready'].includes(root.dataset.state)) return;
    // the first tap on a clip playing without sound turns the sound on
    if (audio && muted && playing && !soundChosen) { chooseSound(true); chrome(); return; }
    // a finger first brings the controls back; a mouse plays and pauses
    if (coarse && root.dataset.chrome === 'off') return chrome();
    toggle();
  });
  el.frame.addEventListener('dblclick', (e) => { if (!coarse && !e.target.closest('.controls')) full.toggle(); });
  el.frame.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') chrome(); });
  el.frame.addEventListener('pointerleave', () => { if (playing) { clearTimeout(chromeTimer); chromeTimer = setTimeout(() => { if (playing) root.dataset.chrome = 'off'; }, 600); } });

  // the scrubber: the clock holds while it is dragged, the sound waits
  el.scrub.addEventListener('pointerdown', () => { scrubbing = true; audio?.pause(); });
  el.scrub.addEventListener('input', () => { seek(Number(el.scrub.value)); chrome(); });
  const release = () => {
    if (!scrubbing) return;
    scrubbing = false;
    if (playing) { startedAt = performance.now() - t * 1000; if (audio && !muted) startAudio(); }
  };
  el.scrub.addEventListener('change', release);
  el.scrub.addEventListener('pointerup', release);
  el.scrub.addEventListener('pointercancel', release);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !['playing', 'paused', 'ended', 'ready'].includes(root.dataset.state)) return;
    const onButton = /** @type {any} */ (e.target)?.tagName === 'BUTTON';
    switch (e.key) {
      case ' ': case 'k': case 'K':
        if (onButton && e.key === ' ') return; // a focused button takes Space itself
        if (!playing && audio && !soundChosen) chooseSound(true);
        toggle(); break;
      case 'ArrowLeft': case 'ArrowRight': {
        // also on the focused scrubber: 5 s, not its one-frame step
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) { pause(); seek((frameAt(t) + dir) / fps); } else seek(t + dir * 5);
        break;
      }
      case 'Home': seek(0); break;
      case 'End': seek(duration); break;
      case 'f': case 'F': full.toggle(); break;
      case 'm': case 'M': if (audio) chooseSound(muted); break;
      case 'Escape': if (root.dataset.full === 'page') full.exit(); return;
      default: return;
    }
    e.preventDefault();
    chrome();
  });
  // a clip in a background tab stops (its sound too); it does not start again by itself
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ── ready: the first second's media, the first frame, then play (muted) or wait for the viewer ───────
  // (fast: from the studio, footage as JPEG, as it plays; an export has one file per frame either way)
  await engine.preload(Array.from({ length: Math.min(total, fps) }, (_, i) => i), { fast: true, onProgress: (p) => progress(0.7 + p * 0.25) });
  await draw(0, false);
  progress(1);
  if (audio) { el.sound.hidden = false; setMuted(true); }
  setState('ready');
  showTime();
  if (reducedMotion) {
    // nothing moves until the viewer says so: the poster stays, with the play button
    el.big.hidden = false;
    chrome();
  } else {
    play();
  }
}

main().catch((e) => { if (root.dataset.state !== 'error') fail(`The clip could not be played: ${e.message}`); });
