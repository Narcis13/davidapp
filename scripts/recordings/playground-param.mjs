// Playground: scrub the time, change a parameter, see the preview change (about 17 s).
//   node scripts/record-studio.mjs http://127.0.0.1:8796/ playground-param showcase/footage/playground-param.mp4
// Needs the showcase library (text-char-reveal); `bash .claude/goal-loop/serve.sh seed <port> <dir>` builds it.

export const start = '/assets/text-char-reveal';
export const ready = '[data-testid=preview-canvas][data-frame]';

const CANVAS = '[data-testid=preview-canvas]';
const frame = (r) => r.evaluate(`document.querySelector('${CANVAS}').dataset.frame`);
/** Scrub to a time and wait until the preview has drawn it. */
async function scrubTo(r, t, ms) {
  const before = await frame(r);
  await r.slider('[data-testid=scrub]', t, { ms });
  await r.until(`document.querySelector('${CANVAS}').dataset.frame !== ${JSON.stringify(before)}`, 'the preview to follow the scrub');
}

/** @param {import('../lib/record.mjs').Recorder} r */
export default async function (r) {
  await r.waitFor(CANVAS);
  await r.waitFor('[data-testid=params]');
  await r.pause(900);

  r.mark('scrub');
  await scrubTo(r, 0.4, 700);
  await r.pause(600);
  await scrubTo(r, 1.5, 800);
  await r.pause(600);

  r.mark('parameter');
  await r.fill('[data-testid=param-text]', 'Change a parameter. *See the frame.*');
  await r.pause(700);
  await r.slider('[data-testid=param-size-range]', 230, { ms: 800 });
  await r.pause(700);
  await r.slider('[data-testid=param-weight-range]', 400, { ms: 600 });
  await r.pause(600);

  r.mark('scrub again');
  await scrubTo(r, 2.8, 800);
  await r.pause(1200);
}
