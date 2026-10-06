// The preview stage: the canvas the preview worker draws into, sized to fit its pane at the
// frame's aspect ratio, with overlays (safe zone, guides), an error banner, the transport
// (play, scrub, time) and an optional "exact frame" image next to the live preview.
// Asset code never runs here: everything is drawn through Preview (a Web Worker).

import { safeZone } from '/core/engine.js';
import { Preview } from '/ui/preview.js';
import { fill, fmtTime, h, icon, s } from '/ui/lib/util.js';

const isTyping = (el) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY', 'VIDEO', 'AUDIO'].includes(el.tagName));

/**
 * @param {{ guides?: boolean, compact?: boolean, onTime?: (t: number) => void, onState?: (playing: boolean) => void }} [o]
 */
export function createStage({ guides = false, compact = false, onTime = () => {}, onState = () => {} } = {}) {
  let width = 1920, height = 1080, duration = 0, fps = 30, scrubbing = false;

  const canvas = h('canvas', { width: 16, height: 9, 'data-testid': 'preview-canvas', 'aria-label': 'Preview' });
  const overlay = s('svg', { class: 'overlay', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const errorEl = h('div.stage-error', { role: 'alert', hidden: true, 'data-testid': 'preview-error' });
  const frame = h('div.frame.busy', canvas, overlay, errorEl);
  const liveCaption = h('span.stage-caption', 'Preview · browser');
  const liveCell = h('div.stage-cell', frame);
  const exactImg = h('img', { alt: 'The same frame drawn by the renderer', 'data-testid': 'exact-frame-image' });
  const exactCaption = h('span.stage-caption');
  const exactCell = h('div.stage-cell', h('div.frame', exactImg));
  const exactWrap = h('div.stage-pane', { hidden: true }, exactCell, h('div.stage-pane-foot', exactCaption, h('button.btn.small', { type: 'button', 'data-testid': 'exact-frame-close', onclick: () => hideExact() }, 'Close')));
  const liveWrap = h('div.stage-pane', liveCell, h('div.stage-pane-foot', { hidden: true }, liveCaption));
  const box = h('div.stage-box', liveWrap, exactWrap);

  const playBtn = h('button.icon-btn.play', { type: 'button', 'data-testid': 'play', 'aria-label': 'Play', title: 'Play or pause (Space)' }, icon('play', 20));
  const scrub = h('input.scrub', { type: 'range', min: 0, max: 1, step: 0.01, value: '0', 'data-testid': 'scrub', 'aria-label': 'Scrub' });
  const readout = h('span.timecode', { 'data-testid': 'time' }, '0:00.00 / 0:00.00');
  const safeBtn = h('button.btn.small.toggle', { type: 'button', 'data-testid': 'toggle-safe', 'aria-pressed': 'false' }, 'Safe zone');
  const guidesBtn = guides ? h('button.btn.small.toggle', { type: 'button', 'data-testid': 'toggle-guides', 'aria-pressed': 'false' }, 'Guides') : null;
  // compact: the overlay toggles sit in the transport row (the clip editor keeps the timeline in view)
  const transport = h('div.transport', playBtn, scrub, readout, compact ? h('div.transport-extras', safeBtn, guidesBtn) : null);
  let showSafe = false, showGuides = false;

  const pv = new Preview(canvas, {
    onTime(t) {
      if (!scrubbing) scrub.value = String(t);
      setReadout(t);
      onTime(t);
    },
    onError(message) {
      if (message) { errorEl.textContent = message; errorEl.hidden = false; frame.classList.remove('busy'); }
      else { errorEl.hidden = true; errorEl.textContent = ''; }
    },
    onState(playing) {
      fill(playBtn, icon(playing ? 'pause' : 'play', 20));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      playBtn.dataset.playing = String(playing);
      onState(playing);
    },
  });

  function setReadout(t) { readout.textContent = `${fmtTime(t)} / ${fmtTime(duration)}`; }

  function drawOverlay() {
    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    overlay.replaceChildren();
    const safe = safeZone(width, height);
    const u = Math.max(width, height) / 400;   // one "pixel" of overlay ink, in frame units
    if (showGuides) {
      const g = s('g', { class: 'guides', 'data-testid': 'guides-overlay' });
      for (const k of [1 / 3, 2 / 3]) {
        g.append(s('line', { x1: width * k, y1: 0, x2: width * k, y2: height }), s('line', { x1: 0, y1: height * k, x2: width, y2: height * k }));
      }
      const c = Math.min(width, height) * 0.04;
      g.append(s('line', { class: 'cross', x1: width / 2 - c, y1: height / 2, x2: width / 2 + c, y2: height / 2 }), s('line', { class: 'cross', x1: width / 2, y1: height / 2 - c, x2: width / 2, y2: height / 2 + c }));
      if (height > width) {
        // where a short-video app puts its own UI: header, caption block, action column
        const col = width * 0.14;
        g.append(
          s('rect', { class: 'platform', x: 0, y: 0, width, height: safe.top, rx: u * 4 }),
          s('rect', { class: 'platform', x: 0, y: height - safe.bottom, width, height: safe.bottom, rx: u * 4 }),
          s('rect', { class: 'platform', x: width - col - u * 4, y: height * 0.45, width: col, height: height - safe.bottom - height * 0.45 - u * 4, rx: col / 2 }),
          s('text', { x: width / 2, y: safe.top / 2, 'font-size': u * 9, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, 'platform header'),
          s('text', { x: width / 2, y: height - safe.bottom / 2, 'font-size': u * 9, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, 'caption and buttons'));
      }
      overlay.append(g);
    }
    if (showSafe) {
      const g = s('g', { class: 'safe', 'data-testid': 'safe-overlay' });
      g.append(
        s('path', { class: 'shade', 'fill-rule': 'evenodd', d: `M0 0H${width}V${height}H0Z M${safe.x} ${safe.y}v${safe.height}h${safe.width}v${-safe.height}Z` }),
        s('rect', { x: safe.x, y: safe.y, width: safe.width, height: safe.height }),
        s('text', { x: safe.x + u * 5, y: safe.y + u * 13, 'font-size': u * 8 }, 'safe zone'));
      overlay.append(g);
    }
  }

  function toggle(btn, on) { btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('on', on); }
  safeBtn.addEventListener('click', () => { showSafe = !showSafe; toggle(safeBtn, showSafe); drawOverlay(); });
  guidesBtn?.addEventListener('click', () => { showGuides = !showGuides; toggle(guidesBtn, showGuides); drawOverlay(); });

  playBtn.addEventListener('click', () => pv.toggle());
  scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  const endScrub = () => { scrubbing = false; };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('input', () => { pv.pause(); pv.seek(Number(scrub.value)); });

  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const typing = isTyping(e.target) && e.target !== scrub;
    if (e.key === ' ' || e.code === 'Space') {
      if (typing) return;
      e.preventDefault();
      pv.toggle();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping(e.target)) {
      e.preventDefault();
      pv.pause();
      pv.seek(pv.time + (e.key === 'ArrowLeft' ? -1 : 1) / fps);
    }
  };
  document.addEventListener('keydown', onKey);

  let exactUrl = null;
  function hideExact() {
    exactWrap.hidden = true;
    liveWrap.lastElementChild.hidden = true;
    box.classList.remove('compare');
    if (exactUrl) { URL.revokeObjectURL(exactUrl); exactUrl = null; }
    exactImg.removeAttribute('src');
  }

  const el = h(`div.stage${compact ? '.compact' : ''}`, box, transport);

  return {
    el, pv, canvas, safeBtn, guidesBtn,
    /** The element that holds the canvas and its overlays (for layers drawn on top, such as handles). */
    frame, transport,
    /** The frame size the preview draws at: sets the aspect ratio of the pane and the overlays. */
    setSize(w, hgt) {
      width = w; height = hgt;
      box.style.setProperty('--ar', String(w / hgt));
      box.classList.toggle('landscape', w > hgt);
      drawOverlay();
    },
    setDuration(d, rate = 30) {
      duration = d; fps = rate;
      scrub.max = String(d);
      scrub.step = String(1 / rate);
      scrub.value = String(Math.min(pv.time, d));
      setReadout(Math.min(pv.time, d));
    },
    /** Wrap pv.showAsset / pv.showClip so the pane shows a busy state until the first frame. */
    async show(fn) {
      frame.classList.add('busy');
      try { await fn(pv); } finally { frame.classList.remove('busy'); }
      setReadout(pv.time);
      scrub.value = String(pv.time);
    },
    /** Put a renderer-made frame (a PNG blob) beside the live preview. */
    showExact(blob, caption) {
      if (exactUrl) URL.revokeObjectURL(exactUrl);
      exactUrl = URL.createObjectURL(blob);
      exactImg.src = exactUrl;
      exactCaption.textContent = caption;
      exactWrap.hidden = false;
      liveWrap.lastElementChild.hidden = false;
      box.classList.add('compare');
    },
    hideExact,
    destroy() {
      document.removeEventListener('keydown', onKey);
      hideExact();
      pv.destroy();
    },
  };
}
