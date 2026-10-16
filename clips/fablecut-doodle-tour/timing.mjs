// fablecut-doodle-tour's clock. Every start and duration of compose.mjs comes from here. Seconds land on whole frames;
// every cut and every hold is named. Text and music only: the music's bar grid (120 bpm, a bar is 2 s) sets the cuts.

import { readFileSync } from 'node:fs';

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));

export const FPS = 30;
/** Seconds on whole frames. */
export const f = (s) => Math.round(s * FPS) / FPS;

/** One bar of the music, in seconds (4/4). Cuts fall on bars. */
export const BAR = f((60 / script.bpm) * 4);
const bars = (n) => f(n * BAR);

/** Where each beat's scene starts, in bars. Longer beats where there is more to read (the chat, the checks). */
export const SCENES = {
  hook: { start: 0 },
  function: { start: bars(4) },
  library: { start: bars(9) },
  reuse: { start: bars(14) },
  agent: { start: bars(19) },
  shapes: { start: bars(25) },
  solid: { start: bars(29) },
  checks: { start: bars(33) },
  sound: { start: bars(38) },
  cta: { start: bars(41) },
};
/** The clip ends 4 bars after the end card arrives; it settles, pushes in slowly, and is still for the last HOLD seconds. */
export const DURATION = bars(45);
export const HOLD = 2.6;
/** The scribble that carries each cut, and the overlap that lets it take the scene before. */
export const TRANS = 0.7;
export const OVERLAP = 0.7;

const ids = Object.keys(SCENES);
/** A scene's items run from its start to the next scene's start plus the overlap (the last to the end). */
export const sceneEnd = (id) => (ids.indexOf(id) < ids.length - 1 ? f(SCENES[ids[ids.indexOf(id) + 1]].start + OVERLAP) : DURATION);
