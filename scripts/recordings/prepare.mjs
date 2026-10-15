// The studio state clip 9's recordings start from, made through the MCP server in a scratch data dir: the showcase
// library (built by `serve.sh seed`), a render of clip 7 for the gallery, and "my-first-clip", a short horizontal clip
// with a background and a title, ready for the editor and render workflows.
//
//   STUDIO_DATA=<scratch dir with the showcase library> node scripts/recordings/prepare.mjs
//
// Refuses to run without STUDIO_DATA, so the user's ./data is never touched.

import { connect, callTool } from '../mcp.mjs';

if (!process.env.STUDIO_DATA) { console.error('Set STUDIO_DATA to a scratch data dir (never ./data).'); process.exit(2); }
const client = await connect({ author: 'recording-setup' });
const call = async (name, args) => {
  const r = await callTool(client, name, args);
  if (r.isError) throw new Error(`${name}: ${r.text}`);
  return r.json;
};
try {
  // the gallery's newest render: clip 7, the voiced explainer
  const done = (await call('list_renders', { clip: 'clip-7-a-video-that-checks-itself', status: 'done', limit: 5 })).renders;
  if (!done.length) {
    const r = await call('start_render', { clip: 'clip-7-a-video-that-checks-itself', draft: true, wait_seconds: 900 });
    console.log(`clip 7 rendered: render #${r.id ?? r.render?.id}`);
  }
  const clips = (await call('list_clips', {})).clips.map((c) => c.slug);
  if (!clips.includes('my-first-clip')) {
    await call('create_clip', { name: 'my-first-clip', title: 'My first clip', description: 'A first clip made in the onboarding video: a background and a title, then an asset placed from the library.', format: 'horizontal', duration: 6 });
    await call('update_clip', {
      clip: 'my-first-clip',
      composition: {
        format: 'horizontal', fps: 30, duration: 6, theme: 'theme-tide',
        tracks: [
          { id: 'bg', type: 'visual', name: 'Background', items: [{ id: 'bg', asset: 'bg-gradient-drift', start: 0, duration: 6, params: {} }] },
          { id: 'title', type: 'text', name: 'Title', items: [{ id: 'title', asset: 'title-plate', start: 0.3, duration: 5.4, params: { text: 'My first clip', eyebrow: 'Fablecut' }, transform: { x: 0.24, y: 0.15, width: 0.4, height: 0.16 } }] },
        ],
      },
    });
    console.log('my-first-clip created');
  }
} finally {
  await client.close();
}
