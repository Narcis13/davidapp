// Seed a data directory with the small fixture library the tests use (a few assets, two clips,
// one finished render). Handy for working on the studio UI without building the whole showcase.
//   STUDIO_DATA=<dir> node scripts/dev-seed.mjs
import { createStudio } from '../src/studio/studio.js';
import { seedAssets, smallComposition, AUTHOR, DOT } from '../test/helpers.js';

const studio = createStudio({ role: 'dev-seed' });
try {
  await studio.clips.createClip({ slug: 'demo', title: 'Demo clip', description: 'A tiny clip made from the test fixtures.', author: AUTHOR, width: 320, height: 180, fps: 10, duration: 2 });
  await seedAssets(studio, 'demo');
  await studio.clips.updateClip('demo', { composition: smallComposition() });
  await studio.library.updateAsset({ slug: 'dot', author: AUTHOR, note: 'bigger default radius', source: DOT.replace('default: 20', 'default: 48'), forClip: 'demo' });
  await studio.library.forkAsset({ ref: 'dot@1', slug: 'dot-fork', author: AUTHOR });
  await studio.clips.createClip({
    slug: 'demo-vertical', title: 'Demo vertical', description: 'Reuses the demo assets in a vertical frame.', author: AUTHOR,
    composition: { format: 'vertical', fps: 30, duration: 6, background: '#101018', tracks: [
      { id: 'main', type: 'visual', items: [{ id: 'scene', asset: 'scene', start: 0, duration: 6, params: { title: 'Vertical' } }, { id: 'dot2', asset: 'dot-fork', start: 1, duration: 4 }] },
      { id: 'titles', type: 'text', items: [{ id: 'label', asset: 'label', start: 1, duration: 4, params: { text: 'Safe zone' }, fadeIn: 0.4, fadeOut: 0.4 }] },
      { id: 'music', type: 'audio', items: [{ id: 'kick', asset: 'kick', start: 0, duration: 6, gain: 0.7 }] },
    ] },
  });
  studio.renders.startRunner();
  const r = await studio.renders.wait(studio.renders.enqueue({ clip: 'demo', requestedBy: 'dev-seed' }).id, 60000);
  console.log(`seeded ${studio.dataDir}: clips demo, demo-vertical; render #${r.id} ${r.status}`);
} finally {
  await studio.close();
}
