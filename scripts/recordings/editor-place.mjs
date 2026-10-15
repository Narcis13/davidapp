// Editor: add an asset from the library to a clip, move it on the timeline, trim its end, play (about 18 s).
//   node scripts/record-studio.mjs http://127.0.0.1:8796/ editor-place showcase/footage/editor-place.mp4
// Needs the state scripts/recordings/prepare.mjs makes (the showcase library and "my-first-clip").

export const start = '/clips/my-first-clip';
export const ready = '[data-testid=preview-canvas][data-frame]';

const ITEM = '[data-testid=item][data-id^="text-word-reveal"]';

/** @param {import('../lib/record.mjs').Recorder} r */
export default async function (r) {
  await r.waitFor('[data-testid=timeline]');
  await r.pause(900);

  r.mark('add');
  await r.click('[data-testid=add-item]');
  await r.waitFor('[data-testid=picker-search]');
  await r.fill('[data-testid=picker-search]', 'word reveal');
  await r.waitFor('[data-testid=picker-option][data-slug=text-word-reveal]');
  await r.pause(500);
  await r.click('[data-testid=picker-option][data-slug=text-word-reveal]');
  const item = await r.waitFor(ITEM);
  await r.pause(800);

  r.mark('select');
  await r.click(ITEM);
  await r.waitFor('[data-testid=inspector] [data-testid=selected-id]');
  await r.pause(700);

  r.mark('move');
  await r.drag({ x: item.cx, y: item.cy }, { x: item.cx + 90, y: item.cy });
  await r.pause(700);

  r.mark('trim');
  const moved = await r.waitFor(ITEM);
  await r.drag({ x: moved.x + moved.width - 3, y: moved.cy }, { x: moved.x + moved.width - 70, y: moved.cy });
  await r.pause(800);

  r.mark('play');
  await r.click('[data-testid=play]');
  await r.pause(2600);
  await r.click('[data-testid=play]');
  await r.pause(900);

  r.mark('save');
  await r.click('[data-testid=save]');
  await r.until("document.querySelector('[data-testid=unsaved]')?.hidden !== false", 'the clip to be saved');
  await r.pause(1000);
}
