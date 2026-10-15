// Library search: type a search, open a filter, hover cards, open an asset's playground (about 14 s).
//   node scripts/record-studio.mjs http://127.0.0.1:8796/ library-search showcase/footage/library-search.mp4

export const start = '/';
export const ready = '[data-testid=asset-card]';

/** @param {import('../lib/record.mjs').Recorder} r */
export default async function (r) {
  await r.waitFor('[data-testid=search]');
  await r.pause(900);
  r.mark('search');
  await r.click('[data-testid=search]');
  await r.type('text');
  await r.until(`document.querySelectorAll('[data-testid=asset-card]').length > 0 && new URL(location.href).searchParams.get('q') === 'text'`, 'the search results');
  await r.pause(900);

  r.mark('filter');
  await r.click('[data-testid=filter-kind] [data-value=visual]');
  await r.pause(900);

  r.mark('hover');
  const cards = '[data-testid=asset-card]';
  await r.hover(`${cards}:nth-of-type(2)`, { dwell: 600 });
  await r.hover(`${cards}:nth-of-type(4)`, { dwell: 600 });

  r.mark('open');
  await r.click(`${cards}:nth-of-type(3)`);
  await r.waitFor('[data-testid=detail-panel]');
  await r.pause(1200);

  r.mark('playground');
  await r.click('[data-testid=detail-open]');
  await r.waitFor('[data-testid=preview-canvas][data-frame]');
  await r.pause(2200);
}
