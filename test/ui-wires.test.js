// The editor's Interactive panel words its wires, conditions and scenes from the composition's `interactive` section
// (src/ui/lib/wires.js: pure functions, no DOM). The sentences are what an author reads, so they are pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionText, conditionText, endText, onText, rangeText, sceneAtTime, valueText, varsOf, wireParts } from '../src/ui/lib/wires.js';

test('ui wires: values and conditions read as short expressions', () => {
  assert.equal(valueText({ $var: 'score' }), 'score');
  assert.equal(valueText('$value'), 'the event\'s value');
  assert.equal(valueText('hello'), '"hello"');
  assert.equal(valueText(3), '3');
  assert.equal(conditionText({ var: 'score', gte: 3 }), 'score ≥ 3');
  assert.equal(conditionText({ var: 'lives', eq: { $var: 'max' } }), 'lives = max');
  assert.equal(conditionText({ scene: ['play', 'win'] }), 'in play or win');
  assert.equal(conditionText({ all: [{ var: 'a', lt: 1 }, { any: [{ var: 'b', ne: true }, { scene: 'menu' }] }] }), 'a < 1 and (b ≠ true or in menu)');
  assert.equal(conditionText({ not: { var: 'muted', eq: true } }), 'not muted = true');
});

test('ui wires: every kind of action has a sentence', () => {
  assert.equal(actionText({ go: 'play' }), 'go to play');
  assert.equal(actionText({ go: 'back' }), 'go back');
  assert.equal(actionText({ go: 'next', transition: { asset: 'tx-wipe@2', params: {}, duration: 0.4 } }), 'go to the next scene through tx-wipe 0.4 s');
  assert.equal(actionText({ go: 'win', transition: false }), 'go to win (a cut)');
  assert.equal(actionText({ set: { score: 0, name: 'ada' } }), 'set score to 0, name to "ada"');
  assert.equal(actionText({ add: { score: 1 }, min: 0, max: 5 }), 'add 1 to score (min 0, max 5)');
  assert.equal(actionText({ add: { page: 1 }, min: 0, max: 3, wrap: true }), 'add 1 to page (min 0, max 3, wraps)');
  assert.equal(actionText({ toggle: 'muted' }), 'toggle muted');
  assert.equal(actionText({ send: 'tap', event: 'flash' }), 'send flash to tap');
  assert.equal(actionText({ send: 'bar', event: 'fill', value: { $var: 'score' } }), 'send fill to bar with score');
  assert.equal(actionText({ play: 'blip' }), 'play blip');
  assert.equal(actionText({ restart: true }), 'restart');
  assert.equal(actionText({ if: { var: 'score', gte: 3 }, then: [{ play: 'chime' }, { go: 'win' }] }), 'if score ≥ 3: play chime; go to win');
  assert.equal(actionText({ if: { var: 'score', gte: 3 }, then: [{ go: 'win' }], else: [{ add: { score: 1 } }] }), 'if score ≥ 3: go to win; otherwise add 1 to score');
});

test('ui wires: a wire splits into what it listens to, where, when, and what it does', () => {
  assert.deepEqual(wireParts({ on: 'tap.press', scene: 'play', if: { var: 'score', lt: 5 }, do: [{ add: { score: 1 } }, { play: 'blip' }] }),
    { on: 'tap.press', where: 'in play', when: 'score < 5', actions: ['add 1 to score', 'play blip'] });
  assert.deepEqual(wireParts({ on: 'key:m', do: { toggle: 'muted' } }), { on: 'key:m', where: '', when: '', actions: ['toggle muted'] });
  assert.equal(onText('key:ArrowRight'), 'the ArrowRight key');
  assert.equal(onText('key:any'), 'any key');
  assert.equal(onText('enter:play'), 'scene play begins');
  assert.equal(onText('end:win'), 'scene win reaches its end');
  assert.equal(onText('start.press'), 'start fires press');
  assert.equal(onText('tap'), 'a press on nothing');
});

test('ui wires: scenes say where they are and what happens at their end; the playhead finds its scene', () => {
  const I = { vars: { score: 0, muted: false }, scenes: [{ id: 'menu', start: 0, duration: 3, end: 'loop' }, { id: 'play', start: 3, duration: 4, end: 'next' }, { id: 'win', start: 7, duration: 3, end: 'hold', final: true }, { id: 'again', start: 10, duration: 1.5, end: 'menu' }] };
  assert.deepEqual(I.scenes.map(endText), ['loops', 'goes to the next scene', 'holds, final', 'goes to menu']);
  assert.deepEqual(I.scenes.map(rangeText), ['0 to 3 s', '3 to 7 s', '7 to 10 s', '10 to 11.5 s']);
  assert.deepEqual(varsOf(I), [['score', 0], ['muted', false]]);
  assert.deepEqual(varsOf(undefined), []);
  assert.equal(sceneAtTime(I, 0).id, 'menu');
  assert.equal(sceneAtTime(I, 2.999).id, 'menu');
  assert.equal(sceneAtTime(I, 3).id, 'play');
  assert.equal(sceneAtTime(I, 10.2).id, 'again');
  assert.equal(sceneAtTime(I, 11.5), null);
  assert.equal(sceneAtTime(undefined, 1), null);
});
