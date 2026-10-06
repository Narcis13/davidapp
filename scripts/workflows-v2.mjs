// The studio's iteration-2 workflows, driven in headless Chrome with real input (mouse drags, keys,
// typed text, files dropped from outside) against a running studio, each one checked as it goes and
// written as a GIF plus stills. They change the data they run on (versions, presets, uploads,
// requests), so point them at a copy of the showcase, never at a library you want to keep.
//
//   STUDIO_DATA=<that studio's data dir> node scripts/workflows-v2.mjs <base-url> [out-dir] [workflow …]
//
//   canvas      move with snapping, scale by a corner, rotate (free and in 15° steps) on the preview; the inspector follows, and the handles follow the inspector; undo
//   layers      drag a track above another and an item to another layer; the preview's stacking changes; undo and redo
//   playground  tweak and keep: params as a new version, as a preset, metadata without a new version, a version diff
//   request     ask the agent from the clip editor; the agent answers over MCP; the proposal appears live, is previewed and accepted
//   uploads     a PNG, a JPG and an SVG dropped on the library; the agent describes them over MCP; search finds them by tag
//   live        the library, a clip and the requests screen follow changes made over MCP with no reload
//
// out-dir (default docs/showcase/v2) gets gifs/workflow-<name>.gif, studio/<name>-*.png and
// reports/workflows.json. Exits 1 when a check fails or the page logs a problem.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession } from './lib/browser.mjs';
import { connect, callTool } from './mcp.mjs';
import { ROOT, createCanvas } from '../src/render/host.js';

const [base, outArg, ...names] = process.argv.slice(2);
if (!base) { console.error('usage: STUDIO_DATA=<dir> node scripts/workflows-v2.mjs <base-url> [out-dir] [workflow …]'); process.exit(2); }
const out = outArg ?? join(ROOT, 'docs', 'showcase', 'v2');
for (const d of ['gifs', 'studio', 'reports']) mkdirSync(join(out, d), { recursive: true });
const CLIP = 'clip-4-direct-the-studio';
const report = {};
let failed = false;

/** One workflow: its own browser session; `expect` records a named check. */
async function workflow(name, what, fn, opts = {}) {
  if (names.length && !names.includes(name)) return;
  console.log(`${name}: ${what}`);
  const s = await openSession(opts);
  const checks = {};
  const expect = (label, ok, detail) => { checks[label] = !!ok; console.log(`  ${ok ? '✓' : '✖'} ${label}${detail !== undefined ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`); if (!ok) failed = true; };
  let error = null;
  try {
    await fn(s, expect);
  } catch (e) {
    error = e.message;
    console.log(`  ✖ ${e.message}`);
    failed = true;
    await s.shot(join(out, 'studio', `${name}-failed.png`)).catch(() => {});
  }
  const frames = await s.gif(join(out, 'gifs', `workflow-${name}.gif`)).catch((e) => { error ??= e.message; return 0; });
  if (s.problems.length) { failed = true; for (const p of s.problems) console.log(`  CONSOLE ${p}`); }
  report[name] = { what, checks, consoleProblems: s.problems, gif: `gifs/workflow-${name}.gif`, frames, ...(error ? { error } : {}) };
  await s.close();
}

// ---- helpers that run in the page
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const setValue = (sel, value, event = 'input') => `(() => { const el = ${q(sel)}; el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('${event}', { bubbles: true })); })()`;
const editorReady = `${q('[data-testid=preview-canvas]')}?.dataset.frame !== undefined && document.querySelectorAll('[data-testid=item]').length > 0`;
const transform = `Object.fromEntries([...document.querySelectorAll('[data-testid^=tf-]')].map((e) => [e.dataset.testid.slice(3), isNaN(Number(e.value)) ? e.value : Number(e.value)]))`;
const trackOrder = `[...document.querySelectorAll('.tl-row[data-track]')].map((r) => r.dataset.track)`;
/** How much of the preview is near-white ink (the titles), read from the canvas the user sees. */
const ink = `(async () => { const c = ${q('[data-testid=preview-canvas]')}; await new Promise((r) => setTimeout(r, 350)); const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const g = k.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, k.width, k.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) n++; return n; })()`;
const near = (a, b, eps) => Math.abs(a - b) <= eps;

async function openEditor(s, t) {
  await s.goto(`${base}/clips/${CLIP}`, editorReady);
  await s.evaluate(setValue('[data-testid=scrub]', t));
  await s.sleep(700);
}
const handle = (s, name) => s.rect(`[data-testid=handle][data-handle=${name}]`).then((r) => ({ x: r.cx, y: r.cy }));

// ---- on-canvas: move, scale, rotate
await workflow('canvas', 'move with snapping, scale and rotate on the preview; the inspector stays in sync', async (s, expect) => {
  await openEditor(s, 3);
  s.step('Clip 4 at 0:03. Select the logo layer in the timeline');
  await s.click('[data-testid=item][data-id=logo]');
  await s.evaluate('window.scrollTo(0, 0)');
  await s.sleep(300);
  await s.frame();
  const t0 = await s.evaluate(transform);
  expect('the selected layer shows its box and six handles', (await s.evaluate(`document.querySelectorAll('[data-testid=handle]').length`)) === 6, t0);

  s.step('Drag it towards the middle: it snaps to the centre line');
  const stage = await s.rect('[data-testid=preview-canvas]');
  const from = await handle(s, 'move');
  const guides = await s.drag(from, { x: stage.cx + 4, y: from.y + 60 }, { during: () => s.evaluate(`document.querySelectorAll('[data-testid=snap-guide]').length`) });
  const t1 = await s.evaluate(transform);
  expect('a snap guide shows while dragging', guides >= 1, `${guides} guide(s)`);
  expect('the layer snapped to the centre and the inspector shows it', t1.x === 0.5 && t1.y > t0.y, { x: t1.x, y: t1.y });

  s.step('Drag the bottom-right corner: the box grows, the opposite corner stays');
  const nw0 = await handle(s, 'nw');
  const se = await handle(s, 'se');
  await s.drag(se, { x: se.x + 90, y: se.y + 70 });
  const t2 = await s.evaluate(transform);
  const nw1 = await handle(s, 'nw');
  expect('width and height grew in the inspector', t2.width > t1.width * 1.5 && t2.height > t1.height * 1.5, { width: t2.width, height: t2.height });
  expect('the opposite corner did not move', near(nw0.x, nw1.x, 1.5) && near(nw0.y, nw1.y, 1.5), { before: nw0, after: nw1 });

  s.step('Drag the rotation handle a third of a quarter turn');
  const turn = async (deg, opts) => {
    const c = await handle(s, 'move'), k = await handle(s, 'rotate');
    const a = (deg * Math.PI) / 180, dx = k.x - c.x, dy = k.y - c.y;
    await s.drag(k, { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) }, opts);
    return s.evaluate(transform);
  };
  const t3 = await turn(30);
  expect('the inspector shows the angle', near(t3.rotation, 30, 2), t3.rotation);
  s.step('With Shift held the angle moves in steps of 15°');
  const t4 = await turn(19, { modifiers: ['shift'] });
  expect('rotation with Shift lands on a multiple of 15°', t4.rotation === 45, t4.rotation);

  s.step('Type 0 in the inspector: the handles on the canvas follow');
  await s.evaluate(setValue('[data-testid=tf-rotation]', 0, 'change'));
  await s.evaluate(setValue('[data-testid=tf-rotation]', 0, 'input'));
  await s.sleep(500);
  await s.frame();
  const c = await handle(s, 'move'), k = await handle(s, 'rotate');
  expect('the rotation handle is straight above the box again', near(k.x, c.x, 1.5) && k.y < c.y, { handle: k, centre: c });
  await s.shot(join(out, 'studio', 'canvas-handles.png'));

  s.step('Undo, step by step, back to where it started');
  let back = null;
  for (let i = 0; i < 8; i++) {
    await s.key('z', { modifiers: ['ctrl'] });
    back = await s.evaluate(transform);
    if (back.x === t0.x && back.y === t0.y && back.width === t0.width && back.rotation === t0.rotation) break;
  }
  await s.frame();
  expect('undo restores the layout', back.x === t0.x && back.y === t0.y && back.width === t0.width && back.height === t0.height && back.rotation === t0.rotation, back);
});

// ---- layers: drag a track, drag an item to another layer
await workflow('layers', 'dragging a track or an item to another layer changes what is in front; undo and redo', async (s, expect) => {
  await openEditor(s, 11);
  s.step('Clip 4 at 0:11: the title is behind the 3D orb');
  const order0 = await s.evaluate(trackOrder);
  const ink0 = await s.evaluate(ink);
  await s.frame();
  await s.shot(join(out, 'studio', 'layers-title-behind.png'));
  expect('the title track starts under the 3D track', order0.indexOf('behind') > order0.indexOf('3d'), order0.join(' › '));

  s.step('Drag the "Titles behind" track above the 3D track');
  await s.rect('.tl-row[data-track="3d"]');
  await s.rect('[data-testid=track-handle][data-track=behind]');
  const grip = await s.rect('[data-testid=track-handle][data-track=behind]', { scroll: false });
  const row3d = await s.rect('.tl-row[data-track="3d"]', { scroll: false });
  await s.drag({ x: grip.cx, y: grip.cy }, { x: grip.cx, y: row3d.cy - 4 }, { steps: 10 });
  await s.sleep(700);
  const order1 = await s.evaluate(trackOrder);
  const ink1 = await s.evaluate(ink);
  await s.evaluate('window.scrollTo(0, 0)');
  await s.frame();
  await s.shot(join(out, 'studio', 'layers-title-in-front.png'));
  expect('the track is now above the 3D track', order1.indexOf('behind') < order1.indexOf('3d'), order1.join(' › '));
  expect('the preview shows the whole title in front of the orb', ink1 > ink0 * 1.15, { titleInkBehind: ink0, titleInkInFront: ink1 });

  s.step('Undo: the title goes back behind');
  await s.key('z', { modifiers: ['ctrl'] });
  await s.sleep(600);
  const inkU = await s.evaluate(ink);
  await s.frame();
  expect('undo restores the order and the picture', (await s.evaluate(trackOrder)).join() === order0.join() && inkU === ink0, { ink: inkU });
  s.step('Redo: in front again');
  await s.key('y', { modifiers: ['ctrl'] });
  await s.sleep(600);
  const inkR = await s.evaluate(ink);
  await s.frame();
  expect('redo reapplies it', (await s.evaluate(trackOrder)).join() === order1.join() && inkR === ink1, { ink: inkR });
  await s.key('z', { modifiers: ['ctrl'] });
  await s.sleep(500);

  s.step('Drag one item, the title itself, up to the "Titles" layer in front of the orb');
  const trackOf = (id) => s.evaluate(`${q('[data-testid=item][data-id=behind-title]').replace('behind-title', id)}.closest('.tl-row').dataset.track`);
  const before = await trackOf('behind-title');
  await s.rect('.tl-row[data-track=titles]');
  await s.rect('[data-testid=item][data-id=behind-title]');
  const rowTitles = await s.rect('.tl-row[data-track=titles]', { scroll: false });
  const item = await s.rect('[data-testid=item][data-id=behind-title]', { scroll: false });
  // press away from the playhead, which lies over the middle of the item at 0:11
  const gx = item.x + item.width * 0.2;
  await s.drag({ x: gx, y: item.cy }, { x: gx, y: rowTitles.y + 10 }, { steps: 10 });
  await s.sleep(800);
  const after = await trackOf('behind-title');
  const inkI = await s.evaluate(ink);
  await s.evaluate('window.scrollTo(0, 0)');
  await s.frame();
  expect('the item moved to the other layer', before === 'behind' && after === 'titles', `${before} → ${after}`);
  expect('and is drawn in front of the orb', inkI > ink0 * 1.15, { titleInkBehind: ink0, titleInkInFront: inkI });
  await s.key('z', { modifiers: ['ctrl'] });
  await s.sleep(600);
  expect('undo puts it back', (await trackOf('behind-title')) === 'behind' && (await s.evaluate(ink)) === ink0);
});

// ---- what the agent does, over MCP, as Claude Code would
let agent = null;
const mcp = async (tool, args) => {
  agent ??= await connect({ author: 'claude-code' });
  const r = await callTool(agent, tool, args);
  if (r.isError) throw new Error(`${tool}: ${r.text}`);
  return r;
};
const api = (s, path) => s.evaluate(`fetch(${JSON.stringify(path)}).then((r) => (r.ok ? r.json() : null))`);
/** Click a field, replace what it holds by typing. */
async function fill(s, selector, text) {
  await s.click(selector, { settle: 120 });
  await s.evaluate(`${q(selector)}.select?.()`);
  await s.type(text);
}
// proof that the page was never reloaded: a mark on window that a navigation would lose
const mark = `(() => { window.__sameDocument = true; })()`;
const sameDocument = 'window.__sameDocument === true';
const playgroundReady = `${q('[data-testid=preview-canvas]')}?.dataset.frame !== undefined && !!${q('[data-testid=params]')}`;

// ---- playground: tweak and keep
await workflow('playground', 'tweak and keep: new defaults as a version, a preset, metadata, a version diff', async (s, expect) => {
  const A = 'lower-third';
  await s.goto(`${base}/assets/${A}`, playgroundReady);
  const a0 = await api(s, `/api/assets/${A}`);
  s.step('The lower third in the playground. Change the title, the corner and the scale');
  await fill(s, '[data-testid=param-title]', 'Breaking news');
  await s.evaluate(setValue('[data-testid=param-corner]', 'top-right', 'change'));
  await s.evaluate(setValue('[data-testid=param-scale]', 1.3));
  await s.sleep(700);
  await s.frame();
  expect('the panel counts the changed values', /3/.test(await s.evaluate(`${q('[data-testid=changed-count]')}.textContent`)), await s.evaluate(`${q('[data-testid=changed-count]')}.textContent`));

  s.step('Save as new version: these values become the defaults');
  await s.click('[data-testid=save-defaults]');
  const a1 = await s.waitFor(`fetch('/api/assets/${A}').then((r) => r.json()).then((a) => (a.latestVersion === ${a0.latestVersion + 1} ? a : null))`, 'the new version');
  await s.sleep(800);
  await s.frame();
  await s.shot(join(out, 'studio', 'playground-new-defaults.png'), { full: true });
  const old = await api(s, `/api/assets/${A}?version=${a0.latestVersion}`);
  expect('a new version holds the values as defaults', a1.schema.title.default === 'Breaking news' && a1.schema.corner.default === 'top-right' && a1.schema.scale.default === 1.3, `${A}@${a1.latestVersion}`);
  expect('the version before is untouched', old.schema.title.default === a0.schema.title.default && old.sourceHash === a0.sourceHash, `${A}@${old.version}`);

  s.step('Change the title again and save it as a preset instead');
  await fill(s, '[data-testid=param-title]', 'Live from the studio');
  await s.click('[data-testid=save-preset]');
  await fill(s, '[data-testid=preset-name]', 'lower-third-live');
  await fill(s, '[data-testid=preset-title]', 'Lower third · live');
  await s.frame();
  await s.click('[data-testid=preset-create]');
  const p = await s.waitFor(`fetch('/api/assets/lower-third-live').then((r) => (r.ok ? r.json() : null))`, 'the preset');
  await s.waitFor(`location.pathname === '/assets/lower-third-live' && ${playgroundReady}`, 'the preset in the playground').catch(() => {});
  await s.sleep(800);
  await s.frame();
  await s.shot(join(out, 'studio', 'playground-preset.png'), { full: true });
  expect('the preset is its own asset, pinned to the version it was made from', p.derivation === 'preset' && p.forkedFrom === `${A}@${a1.latestVersion}` && p.schema.title.default === 'Live from the studio', { derivation: p.derivation, base: p.forkedFrom });

  s.step('The preset used in a clip (added over MCP), drawn by the renderer');
  await mcp('edit_clip', { clip: CLIP, operations: [{ op: 'add_item', track: 'titles', item: { id: 'live-third', asset: 'lower-third-live', start: 16, duration: 5 } }] });
  const shot = await mcp('render_clip_frame', { clip: CLIP, t: 18 });
  writeFileSync(join(out, 'studio', 'playground-preset-in-clip.png'), shot.images[0]);
  const used = await api(s, `/api/clips/${CLIP}/assets`);
  expect('the clip pins the preset', used.assets.some((x) => x.ref === 'lower-third-live@1' && x.direct));

  s.step('Back on the lower third: edit its title and tags. No new version is made');
  await s.goto(`${base}/assets/${A}`, playgroundReady);
  await s.click('[data-testid=meta-edit]');
  await fill(s, '[data-testid=meta-title]', 'Lower third (name and source)');
  await fill(s, '[data-testid=meta-tags]', 'lower-third, caption, label, newsroom');
  await s.frame();
  await s.click('[data-testid=meta-save]');
  const a2 = await s.waitFor(`fetch('/api/assets/${A}').then((r) => r.json()).then((a) => (a.title === 'Lower third (name and source)' ? a : null))`, 'the edited title');
  await s.sleep(500);
  await s.frame();
  await s.shot(join(out, 'studio', 'playground-metadata.png'), { full: true });
  expect('title and tags changed without a new version', a2.latestVersion === a1.latestVersion && a2.tags.includes('newsroom') && a2.edited && a2.declared.title !== a2.title, { version: a2.latestVersion, tags: a2.tags });
  expect('search finds it by the new tag', (await api(s, '/api/assets?query=newsroom')).assets.some((x) => x.slug === A));

  s.step('Compare versions: the source that changed and the same frame of both');
  await s.click('[data-testid=diff-open]');
  await s.waitFor(`${q('[data-testid=diff-view]')} && !${q('[data-testid=diff]')}.hidden && !!document.querySelector('[data-testid=diff-frame-a-canvas]') && !!document.querySelector('[data-testid=diff-frame-b-canvas]')`, 'the diff');
  await s.sleep(900);
  await s.evaluate(`${q('[data-testid=diff]')}.scrollIntoView({ block: 'start' })`);
  await s.frame();
  await s.shot(join(out, 'studio', 'playground-diff.png'), { full: true });
  const stats = await s.evaluate(`${q('[data-testid=diff-stats]')}.textContent`);
  expect('the diff shows changed lines and two frames', /\d/.test(stats), stats);
});

// ---- ask the agent about a clip
await workflow('request', 'ask the agent from the clip editor; the proposal arrives live, is previewed and accepted', async (s, expect) => {
  await openEditor(s, 16);
  await s.evaluate(mark);
  const rev0 = await s.evaluate(`${q('[data-testid=revision]')}.textContent`);
  s.step('Clip 4 at 0:16. Open "Ask the agent" and write what you want');
  await s.click('[data-testid=agent-open]');
  await fill(s, '[data-testid=agent-input]', 'Add a lower third at 0:16 that says who is asking.');
  await s.frame();
  await s.click('[data-testid=agent-send]');
  const id = await s.waitFor(`fetch('/api/requests?clip=${CLIP}').then((r) => r.json()).then((x) => (x.requests ?? x).find((r) => r.status === 'open' && /who is asking/.test(r.title))?.id)`, 'the request in the queue');
  await s.sleep(500);
  await s.frame();

  s.step(`Claude Code picks request #${id} from the queue over MCP and proposes a clip edit`);
  const ctx = (await mcp('claim_request', { id })).json;
  await s.sleep(900);
  await s.frame();
  await mcp('propose_clip_edit', { request: id, operations: [{ op: 'add_item', track: 'titles', item: { id: 'asked-third', asset: 'lower-third-studio', start: 16, duration: 5, params: { title: 'Asked from the studio', subtitle: 'a request, a proposal, one click' } } }], summary: 'A lower third at 0:16 (the studio preset): "Asked from the studio".' });
  await s.waitFor(`!!${q('[data-testid=agent-proposal]')}`, 'the proposal in the open page');
  await s.sleep(600);
  await s.frame();
  expect('the agent got the clip and frames with the request', ctx.request?.id === id && !!ctx.scope, Object.keys(ctx.scope ?? {}).join(', '));
  expect('the proposal appeared without a reload', await s.evaluate(sameDocument));

  s.step('Preview: the proposed edit drawn on the clip, before anything is saved');
  await s.click('[data-testid=agent-preview]');
  await s.waitFor(`${q('[data-testid=proposal-bar]')} && !${q('[data-testid=proposal-bar]')}.hidden`, 'the proposal preview');
  await s.sleep(900);
  await s.evaluate('window.scrollTo(0, 0)');
  await s.frame();
  await s.shot(join(out, 'studio', 'request-clip-proposal.png'));
  expect('the clip itself has not changed yet', (await s.evaluate(`${q('[data-testid=revision]')}.textContent`)) === rev0, rev0);

  s.step('Accept: the edit becomes the next revision of the clip');
  await s.click('[data-testid=agent-accept]');
  const done = await s.waitFor(`fetch('/api/requests/${id}').then((r) => r.json()).then((r) => (r.status === 'done' ? r : null))`, 'the request to be done');
  await s.waitFor(`!!${q('[data-testid=item][data-id=asked-third]')}`, 'the new item in the timeline');
  await s.sleep(900);
  await s.evaluate('window.scrollTo(0, 0)');
  await s.frame();
  await s.shot(join(out, 'studio', 'request-clip-accepted.png'), { full: true });
  const rev1 = await s.evaluate(`${q('[data-testid=revision]')}.textContent`);
  expect('the request is done and its proposal accepted', done.proposals.some((p) => p.status === 'accepted'), done.proposals.map((p) => `${p.kind} ${p.status}`).join(', '));
  expect('the timeline shows the new item in a new revision, still the same page', rev1 !== rev0 && await s.evaluate(sameDocument), `${rev0} → ${rev1}`);
  writeFileSync(join(out, 'reports', 'request-clip-live.json'), `${JSON.stringify({ what: 'A clip request made in the editor by scripts/workflows-v2.mjs (the user side in headless Chrome, the agent side over MCP).', request: { ...done, proposals: done.proposals.map(({ thumb: _t, meta: _m, ...p }) => p) } }, null, 1)}\n`);
});

// ---- uploads: three files dropped on the library, described by the agent
await workflow('uploads', 'a PNG, a JPG and an SVG dropped on the library; the agent describes them; search finds them by tag', async (s, expect) => {
  // the test images are drawn here, not downloaded
  const dir = join(out, 'studio', 'upload-samples');
  mkdirSync(dir, { recursive: true });
  const draw = (w, hh, paint) => { const c = createCanvas(w, hh); paint(c.getContext('2d'), w, hh); return c; };
  const sea = draw(1280, 720, (g, w, hh) => {
    const sky = g.createLinearGradient(0, 0, 0, hh); sky.addColorStop(0, '#0b1d3a'); sky.addColorStop(0.6, '#f08a4b'); sky.addColorStop(1, '#16213e'); g.fillStyle = sky; g.fillRect(0, 0, w, hh);
    g.fillStyle = '#0d1b2a'; g.fillRect(0, hh * 0.62, w, hh * 0.38);
    g.fillStyle = '#f4f1de'; g.fillRect(w * 0.7, hh * 0.3, 26, hh * 0.32); g.fillStyle = '#e63946'; g.fillRect(w * 0.7 - 8, hh * 0.27, 42, 26);
    g.fillStyle = '#ffd166'; g.beginPath(); g.arc(w * 0.3, hh * 0.56, 60, 0, Math.PI * 2); g.fill();
  });
  const dunes = draw(1200, 900, (g, w, hh) => {
    g.fillStyle = '#f6d7a7'; g.fillRect(0, 0, w, hh);
    for (let i = 0; i < 5; i++) { g.fillStyle = ['#e9b872', '#d99a52', '#c27d3a', '#a5612b', '#7d4420'][i]; g.beginPath(); g.moveTo(0, hh); for (let x = 0; x <= w; x += 20) g.lineTo(x, hh * (0.45 + i * 0.1) + Math.sin(x / (130 + i * 40) + i * 2) * (60 - i * 8)); g.lineTo(w, hh); g.fill(); }
    g.fillStyle = '#fff4d6'; g.beginPath(); g.arc(w * 0.78, hh * 0.2, 70, 0, Math.PI * 2); g.fill();
  });
  // the SVG carries what a hostile file would: the sanitiser drops it and says so
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" onload="alert(1)"><script>alert(2)</script><circle cx="100" cy="100" r="88" fill="#1b4dff"/><path d="M60 128 L100 52 L140 128 Z" fill="none" stroke="#5ce1e6" stroke-width="12" stroke-linejoin="round"/><circle cx="100" cy="112" r="10" fill="#ffb347"/></svg>';
  await s.goto(`${base}/`, `document.querySelectorAll('[data-testid=asset-card]').length > 0`);
  const taken = (await api(s, '/api/assets?query=lighthouse-at-dusk')).assets.some((a) => a.slug === 'lighthouse-at-dusk');
  const tag = taken ? `-${Date.now().toString(36)}` : '';
  /** @type {[string, Buffer][]} */
  const files = [[`lighthouse-at-dusk${tag}.png`, sea.toBuffer('image/png')], [`desert-dunes${tag}.jpg`, dunes.toBuffer('image/jpeg')], [`compass-mark${tag}.svg`, Buffer.from(tag ? svg.replace('r="88"', `r="${80 + (Date.now() % 9)}"`) : svg)]];
  if (tag) { for (const c of [sea, dunes]) { const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.font = '20px sans-serif'; g.fillText(tag, 20, 30); } files[0][1] = sea.toBuffer('image/png'); files[1][1] = dunes.toBuffer('image/jpeg'); }
  for (const [name, data] of files) writeFileSync(join(dir, name), data);
  const slugs = files.map(([name]) => name.replace(/\.[a-z]+$/, ''));

  await s.evaluate(mark);
  const count0 = await s.evaluate(`${q('[data-testid=result-count]')}.textContent`);
  s.step('The library. Drag three image files in from the desktop: a PNG, a JPG and an SVG');
  await s.frame();
  await s.dropFiles({ x: 720, y: 450 }, files.map(([name]) => join(dir, name)));
  await s.waitFor(`document.querySelectorAll('[data-testid=upload-row][data-state=done]').length === 3`, 'three finished uploads', 30000);
  await s.sleep(900);
  await s.frame();
  await s.shot(join(out, 'studio', 'uploads-dropped.png'));
  const rows = await s.evaluate(`[...document.querySelectorAll('[data-testid=upload-row]')].map((r) => r.dataset.name + ': ' + r.textContent.replace(/\\s+/g, ' ').trim())`);
  expect('all three were added', rows.length === 3, rows);
  expect('the SVG was sanitised and the studio says what it removed', rows.some((r) => /\.svg/.test(r) && /Removed from the SVG/.test(r) && /script/.test(r)), rows.find((r) => /\.svg/.test(r)));
  const svgAsset = await api(s, `/api/assets/${slugs[2]}`);
  const stored = await s.evaluate(`fetch('/media/${svgAsset.meta.sidecar}').then((r) => r.text())`);
  expect('nothing active is left in the stored SVG', !/script|onload/i.test(stored) && /<circle/.test(stored));

  s.step('They wait for a description. Claude Code looks at each one over MCP and describes it');
  const waiting = await mcp('list_undescribed', {});
  expect('the agent is handed the images themselves', waiting.images.length >= 3 && slugs.every((x) => waiting.text.includes(x)), `${waiting.images.length} image(s)`);
  const words = [
    { title: 'Lighthouse at dusk', description: 'A flat, graphic seascape at dusk: a white lighthouse with a red lamp room on the right, a low yellow sun over a dark sea, the sky going from navy to orange. 16:9.', tags: ['lighthouse', 'sea', 'dusk', 'sunset', 'background'], uses: ['full-frame background under a title', 'slow push-in behind an intro'] },
    { title: 'Desert dunes', description: 'Five layered sand dunes in warm ochres under a pale sun, flat shapes with soft wavy ridges. 4:3.', tags: ['desert', 'dunes', 'sand', 'warm', 'background'], uses: ['calm background for a quote', 'parallax layers behind text'] },
    { title: 'Compass mark', description: 'A round blue badge with a cyan open triangle pointing up and an orange dot: a compass or direction mark. Square, vector.', tags: ['compass', 'badge', 'logo', 'mark', 'vector'], uses: ['logo in a corner', 'draw on with svg-draw-on'] },
  ];
  for (const [i, slug] of slugs.entries()) await mcp('describe_asset', { name: slug, ...words[i] });
  await s.waitFor(`fetch('/api/assets?needsDescription=1').then((r) => r.json()).then((x) => !x.assets.some((a) => ${JSON.stringify(slugs)}.includes(a.slug)))`, 'the descriptions to land');
  await s.sleep(1200);
  await s.frame();
  expect('the library updated without a reload', await s.evaluate(sameDocument), `${count0} → ${await s.evaluate(`${q('[data-testid=result-count]')}.textContent`)}`);

  s.step('Search by a word the agent used as a tag: "lighthouse"');
  await fill(s, '[data-testid=search]', 'lighthouse');
  await s.waitFor(`!!${q(`[data-testid=asset-card][data-slug="${slugs[0]}"]`)} && document.querySelectorAll('[data-testid=asset-card]').length <= 3`, 'the search result');
  await s.sleep(600);
  await s.frame();
  await s.shot(join(out, 'studio', 'uploads-found-by-tag.png'));
  const found = {};
  for (const [i, slug] of slugs.entries()) found[words[i].tags[0]] = (await api(s, `/api/assets?query=${words[i].tags[0]}`)).assets.some((a) => a.slug === slug);
  expect('each upload is found by a tag from its description', Object.values(found).every(Boolean), found);
  s.step('Open it: the description, tags and palette the library keeps');
  await s.click(`[data-testid=asset-card][data-slug="${slugs[0]}"]`);
  await s.waitFor(`${q('[data-testid=detail-panel]')} && !${q('[data-testid=detail-panel]')}.hidden`, 'the detail panel');
  await s.sleep(700);
  await s.frame();
  await s.shot(join(out, 'studio', 'uploads-described.png'));
});

// ---- live updates: changes made over MCP show in open pages
await workflow('live', 'the library, a clip and the requests screen follow changes made over MCP, with no reload', async (s, expect) => {
  const n = Date.now().toString(36);
  await s.goto(`${base}/?sort=newest`, `document.querySelectorAll('[data-testid=asset-card]').length > 0`);
  await s.evaluate(mark);
  const count0 = await s.evaluate(`${q('[data-testid=result-count]')}.textContent`);
  s.step(`The library, newest first (${count0}). An agent creates an asset over MCP, outside any request`);
  await s.frame();
  await mcp('create_asset', { name: `live-ring-${n}`, source: `asset({\n  description: 'A ring that grows from the centre, made over MCP while the library was open.',\n  tags: ['shape', 'ring', 'live'],\n  duration: 2,\n  params: { color: { type: 'color', default: '#5ce1e6' } },\n  render(f, p) { const { ctx } = f; ctx.strokeStyle = p.color; ctx.lineWidth = f.height * 0.03; ctx.beginPath(); ctx.arc(f.width / 2, f.height / 2, f.height * 0.35 * Math.min(1, f.t), 0, Math.PI * 2); ctx.stroke(); },\n});` });
  await s.waitFor(`!!${q(`[data-testid=asset-card][data-slug="live-ring-${n}"]`)}`, 'the new card');
  await s.sleep(600);
  await s.frame();
  await s.shot(join(out, 'studio', 'live-library.png'));
  const count1 = await s.evaluate(`${q('[data-testid=result-count]')}.textContent`);
  expect('the new asset appeared in the open library', count1 !== count0 && await s.evaluate(sameDocument), `${count0} → ${count1}`);

  const clip = 'clip-6-what-the-library-holds';
  await s.goto(`${base}/clips/${clip}`, editorReady);
  await s.evaluate(mark);
  const rev0 = await s.evaluate(`${q('[data-testid=revision]')}.textContent`);
  const dur0 = await s.evaluate(`${q('[data-testid=item][data-id=third]')}.getBoundingClientRect().width`);
  s.step(`Clip 6 open in the editor (${rev0}). The agent edits the clip over MCP`);
  await s.frame();
  const item = (await api(s, `/api/clips/${clip}`)).composition.tracks.flatMap((t) => t.items).find((it) => it.id === 'third');
  await mcp('edit_clip', { clip, operations: [{ op: 'update_item', id: 'third', patch: { duration: item.duration + 4 } }] });
  await s.waitFor(`${q('[data-testid=revision]')}.textContent !== ${JSON.stringify(rev0)}`, 'the editor to take the new revision');
  await s.sleep(800);
  await s.frame();
  await s.shot(join(out, 'studio', 'live-editor.png'));
  const dur1 = await s.evaluate(`${q('[data-testid=item][data-id=third]')}.getBoundingClientRect().width`);
  expect('the editor shows the new revision and the longer item', dur1 > dur0 && await s.evaluate(sameDocument), `${rev0} → ${await s.evaluate(`${q('[data-testid=revision]')}.textContent`)}; item ${Math.round(dur0)} → ${Math.round(dur1)} px`);

  await s.goto(`${base}/requests`, `!!${q('[data-testid=request-list]')}`);
  await s.evaluate(mark);
  s.step('The requests screen. Ask for something about the library');
  await fill(s, '[data-testid=request-input]', `Which assets would suit a weather report? (${n})`);
  await s.click('[data-testid=request-send]');
  const id = await s.waitFor(`fetch('/api/requests?scope=library').then((r) => r.json()).then((x) => (x.requests ?? x).find((r) => r.title.includes('${n}'))?.id)`, 'the request');
  await s.waitFor(`location.pathname === '/requests/${id}' && !!${q('[data-testid=agent-thread]')}`, 'the request thread');
  const state = (st) => `fetch('/api/requests/${id}').then((r) => r.json()).then((r) => r.status === '${st}')`;
  const shown = `document.querySelector('.page-head .title-row')?.textContent ?? ''`;
  const open = await s.evaluate(shown);
  await s.frame();
  s.step(`The agent claims #${id} over MCP: the thread says it is being worked on`);
  await mcp('claim_request', { id });
  await s.waitFor(state('working'), 'the request to be claimed');
  await s.waitFor(`${shown} !== ${JSON.stringify(open)}`, 'the thread to show it');
  await s.sleep(400);
  const working = await s.evaluate(shown);
  await s.frame();
  s.step('…and answers: the reply is in the thread, the request is done');
  await mcp('complete_request', { id, message: 'bg-gradient-drift under text-counter for the temperature, lower-third-studio for the place name, terrain-3d for a relief map.' });
  await s.waitFor(`[...document.querySelectorAll('[data-testid=agent-message]')].some((m) => /relief map/.test(m.textContent))`, 'the answer in the thread');
  await s.sleep(500);
  const done = await s.evaluate(shown);
  await s.frame();
  await s.shot(join(out, 'studio', 'live-request-thread.png'));
  expect('the open thread followed the agent: claimed, then answered', open !== working && working !== done, [open, working, done]);
  await s.click('[data-testid=request-back]');
  await s.waitFor(`${q(`[data-testid=request-row][data-id="${id}"]`)}?.dataset.status === 'done'`, 'the row in the list');
  await s.frame();
  await s.shot(join(out, 'studio', 'live-requests.png'));
  expect('all of it in the same page, never reloaded', await s.evaluate(sameDocument));
});

await agent?.close();
writeFileSync(join(out, 'reports', 'workflows.json'), `${JSON.stringify({ what: 'Studio workflows driven in headless Chrome with real mouse, keyboard and file-drop input (scripts/workflows-v2.mjs); every check is asserted by the script.', base, workflows: report }, null, 1)}\n`);
console.log(failed ? '\nworkflows: FAILED' : '\nworkflows: all checks passed');
process.exit(failed ? 1 : 0);
