// The showcase as a sequence of MCP tool calls, in the order it was made. build.mjs replays it.
// Clip 1 creates its own assets; clip 2 reuses them (one as a new version) and adds its own;
// clip 3 reuses assets from both.

import clip1 from './clips/clip-1-every-frame.mjs';
import clip2 from './clips/clip-2-compounding.mjs';
import clip3 from './clips/clip-3-release-notes.mjs';

export const AUTHOR = 'claude-fable-5-1';

const C1 = 'clip-1-every-frame';
const C2 = 'clip-2-compounding';
const C3 = 'clip-3-release-notes';

const create = (name, forClip) => ({ tool: 'create_asset', args: { name, source: `@file:assets/${name}.js`, for_clip: forClip } });
const render = (clip) => ({ tool: 'start_render', args: { clip, wait_seconds: 900 }, render: true });

export const steps = [
  // ── clip 1: every frame is a function ───────────────────────────────────────────────────
  { tool: 'create_clip', args: { name: C1, title: 'Every frame is a function', description: 'A vertical manifesto for video made with code: kinetic type, a typed-out asset, counters and captions, cut to a synthesized beat.', format: 'vertical', fps: 30, duration: 32 } },
  ...[
    // foundations
    'easing', 'spring', 'text-block', 'theme-ember',
    // the text-animation family
    'text-word-reveal', 'text-char-reveal', 'text-line-reveal', 'text-typewriter', 'text-kinetic', 'text-highlight', 'text-counter', 'text-captions',
    // graphics
    'bg-gradient-drift', 'beat-bars', 'progress-segments', 'sparkle-field', 'logo-mark',
    // scenes composed from the above
    'code-window', 'stat-trio', 'logo-sting',
    // sound
    'drum-kick', 'drum-snare', 'drum-hat', 'synth-note', 'music-loop', 'sfx-whoosh',
  ].map((n) => create(n, C1)),
  { tool: 'bake_asset', args: { ref: 'logo-mark', name: 'fablecut-mark', description: 'The Fablecut mark as a transparent 512×512 PNG, baked from the logo-mark asset at its final frame.', params: { animate: false }, width: 512, height: 512, tags: ['logo', 'brand', 'still'], for_clip: C1 } },
  create('watermark', C1),
  { tool: 'update_clip', args: { clip: C1, composition: clip1 } },
  render(C1),

  // ── clip 2: the library compounds ───────────────────────────────────────────────────────
  { tool: 'create_clip', args: { name: C2, title: 'The library compounds', description: 'A horizontal data story about reuse: the chart, the lineage diagram and the versioning explainer are new; almost everything around them comes from clip 1.', format: 'horizontal', fps: 30, duration: 32 } },
  // an asset from clip 1, edited into a new version for this clip
  { tool: 'update_asset', args: { name: 'text-word-reveal', source: '@file:assets/text-word-reveal.v2.js', note: 'Words rise from behind a mask by default; adds the mode parameter (mask, rise, pop).', for_clip: C2 } },
  ...['theme-tide', 'bg-grid', 'text-scramble', 'lower-third', 'chart-bars', 'lineage-flow', 'pin-diagram'].map((n) => create(n, C2)),
  { tool: 'update_clip', args: { clip: C2, composition: clip2 } },
  render(C2),

  // ── clip 3: what's new ──────────────────────────────────────────────────────────────────
  { tool: 'create_clip', args: { name: C3, title: "What's new in Fablecut", description: 'Square release notes built from a bullet-list template. Reuses kinetic type, captions, music and the logo from clip 1 and the chart, lower third, scramble and grid from clip 2.', format: 'square', fps: 30, duration: 32 } },
  { tool: 'bake_asset', args: { ref: 'sfx-whoosh', name: 'whoosh-hit', description: 'A darker, punchier whoosh baked to a WAV file from the sfx-whoosh audio asset, for scene changes.', params: { brightness: 1800, peak: 0.62, gain: 0.6 }, duration: 0.8, tags: ['sfx', 'transition', 'whoosh', 'baked'], for_clip: C3 } },
  ...['badge-pill', 'template-bullets', 'format-frames'].map((n) => create(n, C3)),
  // a fork: clip 1's sparkle field, turned into a burst
  { tool: 'fork_asset', args: { ref: 'sparkle-field@1', name: 'confetti-burst', source: '@file:assets/confetti-burst.js', note: 'Forked from sparkle-field: particles burst from a point and fall under gravity.', for_clip: C3 } },
  { tool: 'update_clip', args: { clip: C3, composition: clip3 } },
  render(C3),
];
