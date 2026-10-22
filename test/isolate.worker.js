// Runs evaluateBrowser off the test process: installing the isolate replaces constructors in that realm.
import { parentPort, workerData } from 'node:worker_threads';
import { evaluateBrowser } from '../src/core/isolate.js';

try {
  const def = evaluateBrowser(workerData.source, 'asset.js');
  try {
    parentPort.postMessage({ value: def.render({}) });
  } catch (e) {
    parentPort.postMessage({ error: e.message });
  }
} catch (e) {
  parentPort.postMessage({ loadError: e.message });
}
