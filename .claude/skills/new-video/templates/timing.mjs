// <slug>'s clock. Every start and duration of compose.mjs comes from here. Seconds land on whole frames; every cut
// and every hold is named. Without a voice the music's bar grid sets the cuts; with one, the narration's words do
// (read them from the words JSON the studio wrote and compute the scene starts from them, as clips 7 to 10 do).

import { readFileSync } from 'node:fs';

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));

export const FPS = 30;
/** Seconds on whole frames. */
export const f = (s) => Math.round(s * FPS) / FPS;

/** One bar of the music, in seconds (4/4). Cuts fall on bars. */
export const BAR = f((60 / script.bpm) * 4);
const bars = (n) => f(n * BAR);

/** Where each beat's scene starts: a number of bars from the start. The hook is read for its first bar. */
export const SCENES = {
  hook: { start: 0 },
  body: { start: bars(2) },
  cta: { start: bars(6) },
};
/** The end card holds this long after it is in. */
export const HOLD = 2.5;
/** Scenes overlap by this much: the next comes in while the last goes out, so the screen never empties. */
export const OVERLAP = 0.4;

export const DURATION = f(SCENES.cta.start + 1 + HOLD);

const ids = Object.keys(SCENES);
/** A scene's items run from its start to the next scene's start plus the overlap (the last to the end). */
export const sceneEnd = (id) => (ids.indexOf(id) < ids.length - 1 ? f(SCENES[ids[ids.indexOf(id) + 1]].start + OVERLAP) : DURATION);
