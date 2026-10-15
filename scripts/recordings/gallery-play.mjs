// Gallery: a finished clip, playing in the studio (about 10 s): the result an onboarding video shows first.
//   node scripts/record-studio.mjs http://127.0.0.1:8796/ gallery-play showcase/footage/gallery-play.mp4
// Needs a finished render of clip 7 (scripts/recordings/prepare.mjs makes one).

export const start = '/gallery';
export const ready = '[data-testid=gallery-card]';

/** @param {import('../lib/record.mjs').Recorder} r */
export default async function (r) {
  await r.pause(800);
  r.mark('open');
  await r.click('[data-testid=gallery-card]');
  await r.waitFor('[data-testid=player]');
  await r.pause(400);
  r.mark('play');
  await r.evaluate("(() => { const v = document.querySelector('[data-testid=player]'); v.muted = true; v.currentTime = 2; return v.play(); })()");
  await r.pause(8000);
}
