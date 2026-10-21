// Development data for the interactive-mode screens of the studio editor: a few small inline assets that emit and
// react to events (a button, a counter bound to a variable, a title, a background, a wipe, two sounds) and an
// interactive clip "interactive-demo" with three scenes, variables and wires. Works on an empty data dir
// (`bash .claude/goal-loop/serve.sh fresh <port> <dir>`) or on top of any other data; running it again changes nothing.
//
//   STUDIO_DATA=<dir> node scripts/dev-seed-v5.mjs
//
// The clip: menu (a Start button, loops) → play (a Tap button and a counter; three taps win; Escape goes back) → win
// (Play again restarts). The m key toggles the muted variable. The sounds are cues played by wires; a quiet pad loops
// as the session's music.

import { createStudio } from '../src/studio/studio.js';

const AUTHOR = 'dev-seed';
const SLUG = 'interactive-demo';

/** The assets of the demo, by slug. */
const ASSETS = {
  'demo-ui-bg': `asset({
    title: 'Demo background', description: 'A flat dark gradient behind a demo scene, with a faint grid.', tags: ['bg', 'demo'],
    params: { top: { type: 'color', default: '#171a2e' }, bottom: { type: 'color', default: '#0b0b12' } },
    render(f, p) {
      const { ctx, lib } = f;
      const g = ctx.createLinearGradient(0, 0, 0, f.height);
      g.addColorStop(0, p.top); g.addColorStop(1, p.bottom);
      ctx.fillStyle = g; ctx.fillRect(0, 0, f.width, f.height);
      ctx.strokeStyle = lib.color.alpha('#ffffff', 0.04); ctx.lineWidth = 2;
      const step = f.height / 12;
      for (let x = 0; x < f.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, f.height); ctx.stroke(); }
      for (let y = 0; y < f.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(f.width, y); ctx.stroke(); }
    },
  })`,
  'demo-ui-title': `asset({
    title: 'Demo title', description: 'A title with a smaller line under it, centred in its box.', tags: ['text', 'demo'],
    params: {
      text: { type: 'string', default: 'Title' }, sub: { type: 'string', default: '' },
      color: { type: 'color', default: '#ffffff' }, subColor: { type: 'color', default: '#9aa3c7' },
      font: { type: 'font', default: 'Inter' },
    },
    render(f, p) {
      const { ctx, lib } = f;
      const a = lib.clamp01(f.t / 0.35);
      ctx.globalAlpha = a;
      ctx.translate(0, (1 - a) * f.height * 0.08);
      const T = lib.text.layout(ctx, p.text, { font: p.font, weight: 800, size: f.height * (p.sub ? 0.5 : 0.7), wrap: 'none', maxWidth: f.width, fit: true });
      const S = p.sub ? lib.text.layout(ctx, p.sub, { font: p.font, weight: 400, size: f.height * 0.2, wrap: 'none', maxWidth: f.width, fit: true }) : null;
      const gap = S ? f.height * 0.08 : 0;
      const total = T.height + gap + (S ? S.height : 0);
      let y = (f.height - total) / 2;
      lib.text.fill(ctx, T, (f.width - T.width) / 2, y, { color: p.color });
      y += T.height + gap;
      if (S) lib.text.fill(ctx, S, (f.width - S.width) / 2, y, { color: p.subColor });
    },
  })`,
  'demo-ui-button': `asset({
    title: 'Demo button', description: 'A rounded button that fires press when tapped or activated from the keyboard, and flashes when sent flash.', tags: ['ui', 'button', 'demo'],
    params: {
      label: { type: 'string', default: 'Go' }, fill: { type: 'color', default: '#ffd166' }, color: { type: 'color', default: '#0b0b12' },
      font: { type: 'font', default: 'Inter' }, hotkey: { type: 'string', default: '' },
    },
    events: { emits: { press: 'when the button is pressed' }, accepts: { flash: 'blinks white' } },
    render(f, p) {
      const { ctx, lib } = f;
      const s = f.ui.hit('press', 0, 0, f.width, f.height, { label: p.label, keys: p.hotkey ? [p.hotkey] : undefined });
      const flash = lib.clamp01(1 - f.ui.since('flash') / 0.3);
      const lift = s.down ? 0.97 : s.hover ? 1.03 : 1;
      let fill = s.down ? lib.color.darken(p.fill, 0.25) : s.hover ? lib.color.lighten(p.fill, 0.2) : p.fill;
      if (flash > 0) fill = lib.color.mix(fill, '#ffffff', flash);
      ctx.translate(f.width / 2, f.height / 2);
      ctx.scale(lift, lift);
      ctx.beginPath();
      ctx.roundRect(-f.width / 2, -f.height / 2, f.width, f.height, f.height * 0.28);
      ctx.fillStyle = fill; ctx.fill();
      if (s.focus) { ctx.lineWidth = f.height * 0.08; ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
      const L = lib.text.layout(ctx, p.label, { font: p.font, weight: 800, size: f.height * 0.42, wrap: 'none', maxWidth: f.width * 0.84, fit: true });
      lib.text.fill(ctx, L, -L.width / 2, -L.height / 2, { color: p.color });
    },
  })`,
  'demo-ui-counter': `asset({
    title: 'Demo counter', description: 'A row of pips that fill as a value rises toward a goal, with the number beside it.', tags: ['ui', 'counter', 'demo'],
    params: {
      value: { type: 'number', default: 0 }, goal: { type: 'integer', default: 3, min: 1, max: 12 },
      fill: { type: 'color', default: '#7cf5c0' }, font: { type: 'font', default: 'Inter' },
    },
    render(f, p) {
      const { ctx, lib } = f;
      const c = f.ui.changed('value');
      const pop = c ? lib.clamp01(1 - c.since / 0.25) : 0;
      const r = f.height * 0.3;
      const gap = r * 0.9;
      const total = p.goal * 2 * r + (p.goal - 1) * gap;
      const x0 = (f.width - total) / 2 + r;
      for (let i = 0; i < p.goal; i++) {
        const on = i < p.value;
        const grow = on && i === Math.floor(p.value) - 1 ? 1 + pop * 0.35 : 1;
        ctx.beginPath();
        ctx.arc(x0 + i * (2 * r + gap), f.height * 0.5, r * grow, 0, Math.PI * 2);
        if (on) { ctx.fillStyle = p.fill; ctx.fill(); } else { ctx.lineWidth = f.height * 0.05; ctx.strokeStyle = lib.color.alpha('#ffffff', 0.35); ctx.stroke(); }
      }
    },
  })`,
  'demo-wipe': `asset({
    kind: 'transition', title: 'Demo wipe', description: 'A wipe from left to right between two scenes.', tags: ['transition', 'demo'], duration: 0.4,
    render(f) { f.ctx.drawImage(f.from.canvas, 0, 0); const w = f.width * f.progress; f.ctx.drawImage(f.to.canvas, 0, 0, w, f.height, 0, 0, w, f.height); },
  })`,
  'demo-blip': `asset({
    kind: 'audio', title: 'Demo blip', description: 'A short blip for a button press.', tags: ['audio', 'sfx', 'demo'], duration: 0.2,
    params: { freq: { type: 'number', default: 660, min: 100, max: 2000, step: 1 }, gain: { type: 'number', default: 0.4, min: 0, max: 1, step: 0.01 } },
    render(f, p) { return f.lib.audio.fade(f.lib.audio.tone({ freq: p.freq, dur: f.duration, decay: 0.06, attack: 0.002, gain: p.gain }), 0.002, 0.03); },
  })`,
  'demo-pad': `asset({
    kind: 'audio', title: 'Demo pad', description: 'A quiet two-note pad that loops under a demo.', tags: ['audio', 'music', 'demo'], duration: 4,
    params: { root: { type: 'number', default: 110, min: 40, max: 400, step: 1 }, gain: { type: 'number', default: 0.25, min: 0, max: 1, step: 0.01 } },
    render(f, p) {
      const A = f.lib.audio;
      const out = A.tone({ freq: p.root, dur: f.duration, wave: 'sine', gain: p.gain });
      A.mix(out, A.tone({ freq: p.root * 1.5, dur: f.duration, wave: 'sine', gain: p.gain * 0.6 }), 0, 1);
      return A.fade(out, 0.4, 0.4);
    },
  })`,
};

const button = (id, label, start, duration, box, extra = {}) => ({ id, asset: 'demo-ui-button', start, duration, params: { label, ...extra.params }, transform: { x: 0.5, width: 0.28, height: 0.15, ...box } });

/** The composition of the demo clip (unpinned: the studio pins it when it is saved). */
const COMPOSITION = {
  format: 'horizontal', fps: 30, duration: 10, background: '#0b0b12',
  tracks: [
    { id: 'bg', name: 'Background', type: 'visual', items: [{ id: 'bg', asset: 'demo-ui-bg', start: 0, duration: 10 }] },
    { id: 'ui', name: 'Interface', type: 'visual', items: [
      { id: 'title-menu', asset: 'demo-ui-title', start: 0, duration: 3, params: { text: 'Three taps to win', sub: 'A tiny interactive clip' }, transform: { y: 0.3, width: 0.8, height: 0.28 } },
      button('start', 'Start', 0, 3, { y: 0.66 }, { params: { fill: '#ffd166' } }),
      { id: 'title-play', asset: 'demo-ui-title', start: 3, duration: 4, params: { text: 'Tap it', sub: 'Escape goes back' }, transform: { y: 0.2, width: 0.7, height: 0.24 } },
      { id: 'counter', asset: 'demo-ui-counter', start: 3, duration: 4, params: { value: { $var: 'score' }, goal: 3 }, transform: { y: 0.45, width: 0.6, height: 0.18 } },
      button('tap', 'Tap', 3, 4, { y: 0.7 }, { params: { fill: '#7cf5c0' } }),
      { id: 'title-win', asset: 'demo-ui-title', start: 7, duration: 3, params: { text: 'Nice', sub: 'You tapped it three times' }, transform: { y: 0.34, width: 0.7, height: 0.3 } },
      button('again', 'Play again', 7, 3, { y: 0.7 }, { params: { fill: '#ff8fab' } }),
    ] },
    { id: 'sfx', name: 'Sounds', type: 'audio', items: [
      { id: 'blip', asset: 'demo-blip', start: 0, duration: 0.2, cue: true },
      { id: 'chime', asset: 'demo-blip', start: 0.5, duration: 0.2, cue: true, params: { freq: 990 } },
      { id: 'bed', asset: 'demo-pad', start: 0, duration: 4, gain: 0.5 },
    ] },
  ],
  interactive: {
    start: 'menu',
    vars: { score: 0, muted: false },
    scenes: [
      { id: 'menu', start: 0, duration: 3, end: 'loop' },
      { id: 'play', start: 3, duration: 4, end: 'hold' },
      { id: 'win', start: 7, duration: 3, end: 'hold', final: true },
    ],
    transition: { asset: 'demo-wipe', params: {}, duration: 0.4 },
    music: ['bed'],
    wires: [
      { on: 'start.press', do: [{ play: 'blip' }, { go: 'play' }] },
      { on: 'enter:play', do: { set: { score: 0 } } },
      { on: 'tap.press', scene: 'play', do: [{ add: { score: 1 }, max: 5 }, { send: 'tap', event: 'flash' }, { play: 'blip' }, { if: { var: 'score', gte: 3 }, then: [{ play: 'chime' }, { go: 'win' }] }] },
      { on: 'key:Escape', scene: 'play', do: { go: 'back' } },
      { on: 'again.press', do: { restart: true } },
      { on: 'key:m', do: { toggle: 'muted' } },
    ],
  },
};

const studio = createStudio({ role: 'seed', runner: false });
try {
  if (!studio.db.prepare('SELECT 1 FROM clips WHERE slug = ?').get(SLUG)) {
    await studio.clips.createClip({ slug: SLUG, title: 'Interactive demo', description: 'Three scenes, a button, a counter and sound, for the play mode of the editor.', author: AUTHOR, format: 'horizontal', fps: 30, duration: 10 });
  }
  for (const [slug, source] of Object.entries(ASSETS)) {
    if (!studio.library.versionRow(slug)) await studio.library.createAsset({ slug, source, author: AUTHOR, forClip: SLUG });
  }
  if (studio.clips.getClip(SLUG).composition.interactive) console.log(`clip ${SLUG} is already interactive: left as it is`);
  else {
    const r = await studio.clips.updateClip(SLUG, { composition: COMPOSITION, by: AUTHOR });
    const I = COMPOSITION.interactive;
    console.log(`clip ${SLUG} saved at revision ${r.clip.revision}: ${I.scenes.length} scenes, ${Object.keys(I.vars).length} variables, ${I.wires.length} wires`);
  }
} finally {
  await studio.close();
}
