// The standard library every asset receives as f.lib. It is part of the engine: changing what
// these functions return changes what existing assets draw, so bump ENGINE_VERSION when you do.

import * as math from './math.js';
import * as color from './color.js';
import * as beat from './beat.js';
import { noise, fbm } from './noise.js';
import { createText } from './text.js';
import { createAudio } from './audio.js';
import * as fx from './fx.js';

/** @param {{ sampleRate?: number }} [o] */
export function createLib({ sampleRate } = {}) {
  return Object.freeze({
    ...math,
    math,
    color,
    beat,
    noise,
    fbm,
    text: createText(),
    audio: createAudio(sampleRate),
    fx,
  });
}
