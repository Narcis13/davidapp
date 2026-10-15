// Clip 10's clock. Every start and duration of compose.mjs comes from here, and every time here comes from the
// narration's words (showcase/voice/clip-10-voice.words.json, made by generate_narration) or is a named hold.
// The take is one reading of the four beats of script.json, placed as four items so each beat has room for its picture.

import { readFileSync } from 'node:fs';

const words = JSON.parse(readFileSync(new URL('../../showcase/voice/clip-10-voice.words.json', import.meta.url), 'utf8'));
const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));

export const FPS = 30;
/** Seconds on whole frames. */
export const f = (s) => Math.round(s * FPS) / FPS;

/** The first and last word index of each beat, counted from the script's words. */
export const BEATS = (() => {
  let i = 0;
  return script.beats.map((b) => {
    const n = b.voice.trim().split(/\s+/).length;
    const span = { id: b.id, first: i, last: i + n - 1 };
    i += n;
    return span;
  });
})();

/** Where each beat's scene starts, and where its words begin. */
export const SCENES = {
  outcome: { start: 0, voice: 0.3 },
  product: { start: 4.6, voice: 5.0 },
  proof: { start: 13.0, voice: 13.4 },
  cta: { start: 21.6, voice: 22.0 },
};
/** The end card holds after the last word. */
export const HOLD = 2.6;
/** Scenes overlap by this much: the next comes in while the last goes out, so the screen never empties. */
export const OVERLAP = 0.4;

/** The narration items: each beat's stretch of the take, from the silence before it to the silence after it. */
export const VOICE = BEATS.map((b, k) => {
  const prevEnd = k ? words[BEATS[k - 1].last].end : 0;
  const nextStart = k < BEATS.length - 1 ? words[BEATS[k + 1].first].start : words[b.last].end + 0.4;
  const from = k ? (prevEnd + words[b.first].start) / 2 : 0;
  const to = (words[b.last].end + nextStart) / 2;
  return { id: `vo-${b.id}`, beat: b.id, start: f(SCENES[b.id].voice), offset: Math.round(from * 1000) / 1000, duration: f(to - from), first: b.first, last: b.last };
});

/** Clip time of a word (its start). */
export const wordAt = (i) => {
  const v = VOICE.find((x) => i >= x.first && i <= x.last);
  return v.start + words[i].start - v.offset;
};

const lastWordEnd = (() => { const v = VOICE[VOICE.length - 1]; return v.start + words[v.last].end - v.offset; })();
export const DURATION = f(lastWordEnd + HOLD);

const ids = Object.keys(SCENES);
/** A scene's items run from its start to the next scene's start plus the overlap (the last to the end). */
export const sceneEnd = (id) => (ids.indexOf(id) < ids.length - 1 ? f(SCENES[ids[ids.indexOf(id) + 1]].start + OVERLAP) : DURATION);

/** Small leads and lags around the words: how long before its word a thing starts to come in (out: how long the opening stays once the next scene starts). */
export const LEAD = { pop: 0.15, label: 0.2, card: 0.5, out: 0.2 };
/** The chart draws over this long, starting on its word. */
export const CHART = { draw: 1.6 };
/** The opening headline is read for this long before anything else moves. */
export const TITLE_HOLD = 0.6;
