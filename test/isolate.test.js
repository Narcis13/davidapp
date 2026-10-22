// The asset sandbox: source must not be able to compile new code, in Node or in the browser evaluator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createCanvas, evaluate, takeLogs } from '../src/render/host.js';

const asset = (body) => `asset({\n  description: 'A sandbox probe asset.',\n  tags: ['probe'],\n  render(f) {\n    ${body}\n  },\n});\n`;

function inBrowser(source) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./isolate.worker.js', import.meta.url), { workerData: { source } });
    worker.once('message', (msg) => { worker.terminate(); resolve(msg); });
    worker.once('error', reject);
  });
}

test('a normal asset still runs, and console output is kept', () => {
  const def = evaluate(asset(`console.log('hello from the asset'); return 7;`));
  assert.equal(def.render({}), 7);
  assert.match(takeLogs().join('\n'), /hello from the asset/);
});

test('compiling a string from inside an asset is refused, in Node and in the browser evaluator', async () => {
  const source = asset(`const F = ({}).constructor.constructor; return F('return 1')();`);
  const def = evaluate(source);
  assert.throws(() => def.render({}), /not available|disallowed|Code generation/i);
  const browser = await inBrowser(source);
  assert.match(browser.error ?? browser.loadError ?? '', /not available|disallowed|Code generation/i);
});

test('a host function handed to render cannot be used to compile a string', () => {
  const def = evaluate(asset(`const F = f.ctx.fillRect.constructor; return F('return process.pid')();`));
  const ctx = createCanvas(8, 8).getContext('2d');
  assert.throws(() => def.render({ ctx }), /not available|disallowed|Code generation/i);
  assert.equal(/** @type {any} */ (Object.prototype).polluted, undefined);
});

test('import() written with a unicode escape is rejected before it runs', async () => {
  const source = asset(`return import\\u0028'data:text/javascript,export default 1'\\u0029`);
  assert.throws(() => evaluate(source), /import\(\) is not available/);
  const browser = await inBrowser(source);
  assert.match(browser.loadError ?? '', /import\(\) is not available/);
});

test('Math.random and eval stay unavailable', async () => {
  const random = evaluate(asset(`return Math.random();`));
  assert.throws(() => random.render({}), /f\.rng\(\)/);
  const viaEval = asset(`return eval('1');`);
  assert.throws(() => evaluate(viaEval), /eval and new Function/);
  const browser = await inBrowser(viaEval);
  assert.match(browser.loadError ?? '', /eval and new Function/);
});
