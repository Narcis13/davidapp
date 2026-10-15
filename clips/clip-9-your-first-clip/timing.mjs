// Clip 9's clock. Every start, duration and trim of compose.mjs comes from here, and every time here comes from the
// narration's words (showcase/voice/clip-9-voice.words.json, made by generate_narration) or is a named hold.
//
// The narration is one take of the six beats of script.json. It is placed as six items (the same asset, each its own
// stretch of the take), so each step of the onboarding gets room after its words for the action to be seen; the
// voice is never sped up or stretched, only spaced.

import { readFileSync } from 'node:fs';

const words = JSON.parse(readFileSync(new URL('../../showcase/voice/clip-9-voice.words.json', import.meta.url), 'utf8'));
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

/** Where each beat starts on the clip (the scene's cut) and where its words begin after it. */
export const SCENES = {
  result: { start: 0, voice: 1.0 },
  find: { start: 8.0, voice: 8.6 },
  tune: { start: 17.5, voice: 18.0 },
  place: { start: 27.0, voice: 27.4 },
  render: { start: 37.0, voice: 37.5 },
  next: { start: 46.0, voice: 46.4 },
};
/** The end card holds after the last word: at least 2 s, and the clip ends on it. */
export const HOLD = 3.0;

/**
 * The narration items: for beat k, the stretch of the take between the silences around its words (halfway between the
 * last word of the beat before and its first word, and so on), placed so that stretch begins at the scene's voice time.
 */
export const VOICE = BEATS.map((b, k) => {
  const prevEnd = k ? words[BEATS[k - 1].last].end : 0;
  const nextStart = k < BEATS.length - 1 ? words[BEATS[k + 1].first].start : words[b.last].end + 0.4;
  const from = k ? (prevEnd + words[b.first].start) / 2 : 0;
  const to = (words[b.last].end + nextStart) / 2;
  const at = SCENES[b.id].voice;
  return { id: `vo-${b.id}`, beat: b.id, start: f(at), offset: Math.round(from * 1000) / 1000, duration: f(to - from), first: b.first, last: b.last };
});

/** Clip time of a word (its start), through the narration item that holds it. */
export const wordAt = (i) => {
  const v = VOICE.find((x) => i >= x.first && i <= x.last);
  return v.start + words[i].start - v.offset;
};

const lastWordEnd = (() => { const v = VOICE[VOICE.length - 1]; return v.start + words[v.last].end - v.offset; })();
export const DURATION = f(lastWordEnd + HOLD);

/** Scene ends: the next scene's start, and the clip's end for the last. */
const ids = Object.keys(SCENES);
export const sceneEnd = (id) => (ids.indexOf(id) < ids.length - 1 ? SCENES[ids[ids.indexOf(id) + 1]].start : DURATION);
export const sceneLength = (id) => f(sceneEnd(id) - SCENES[id].start);

/**
 * The stretch of each recording a scene plays: `in` (seconds into the file) and `speed`, chosen so the action the
 * voice names happens while it is named (the times are the recording's marks and clicks; see each sidecar).
 */
export const FOOTAGE = {
  result: { asset: 'studio-gallery-play', in: 0.8, speed: 1 },
  find: { asset: 'studio-library-search', in: 0.6, speed: 1.25 },
  tune: { asset: 'studio-playground-param', in: 4.5, speed: 1.15 },
  place: { asset: 'studio-editor-place', in: 0.9, speed: 1.6 },
  render: { asset: 'studio-render-check', in: 1.2, speed: 1.5 },
};

/** Clip time of a moment in a scene's recording (seconds into the file). */
export const clipTimeOf = (scene, t) => f(SCENES[scene].start + (t - FOOTAGE[scene].in) / FOOTAGE[scene].speed);
