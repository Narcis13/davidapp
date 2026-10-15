// Render: start a render from the editor, watch it finish, read what the studio measured on the file (about 20 s).
//   node scripts/record-studio.mjs http://127.0.0.1:8796/ render-check showcase/footage/render-check.mp4
// Needs the state scripts/recordings/prepare.mjs makes ("my-first-clip"; run editor-place first so it holds the new item).

export const start = '/clips/my-first-clip';
export const ready = '[data-testid=preview-canvas][data-frame]';

/** @param {import('../lib/record.mjs').Recorder} r */
export default async function (r) {
  await r.waitFor('[data-testid=render-button]');
  await r.pause(900);

  r.mark('render');
  await r.click('[data-testid=render-button]');
  await r.waitFor('[data-testid=render-row]');
  await r.pause(600);

  r.mark('progress');
  await r.until("document.querySelector('[data-testid=render-row]')?.dataset.status === 'done'", 'the render to finish');
  await r.pause(900);

  r.mark('report');
  await r.click('[data-testid=render-row]');
  await r.pause(1500);
  await r.scroll(420, { ms: 900 });
  await r.pause(1500);
  await r.scroll(420, { ms: 900 });
  await r.pause(1500);

  r.mark('gallery');
  await r.click('[data-testid=open-in-gallery]');
  await r.waitFor('[data-testid=player]');
  await r.evaluate("document.querySelector('[data-testid=player]').play()");
  await r.pause(3500);
}
