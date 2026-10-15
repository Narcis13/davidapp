// The marketing half of the motion-graphics kit: kit-plate, kit-chart-line, kit-chart-donut, kit-steps, kit-icon (Lucide,
// vendored with its licence) and end-card version 3 (a call to action, a url, a vector logo). Every asset is created in a
// temp studio (the validator draws test frames), drawn at a few times under two themes, and its text is checked in the
// layout report. Writes the contact sheets docs/showcase/v4/studio/kit-marketing.png and kit-icons.png.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool } from '../scripts/mcp.mjs';
import { createCanvas, loadImage, registerFonts } from '../src/render/host.js';
import { NAMES, CURATED, vendoredIcons, withBlock, ASSET, VENDOR } from '../scripts/vendor-icons.mjs';
import { tempStudio, AUTHOR } from './helpers.js';

registerFonts();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (file) => readFileSync(join(ROOT, 'assets', file), 'utf8');
const SHEETS = join(ROOT, 'docs', 'showcase', 'v4', 'studio');

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <path d="M20 100 L60 20 L100 100 Z" fill="#7b5cff" stroke="#16121f" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="60" cy="72" r="14" fill="#ffd166"/>
</svg>`;

let t, studio;
before(async () => {
  t = tempStudio();
  studio = t.studio;
  for (const slug of ['easing', 'theme-tide', 'theme-ember', 'theme-sketchbook']) await studio.library.createAsset({ slug, source: src(`${slug}.js`), author: AUTHOR });
  // the default logo of end-card, and an SVG logo
  const mark = createCanvas(240, 240);
  const g = mark.getContext('2d');
  g.fillStyle = '#ffd166'; g.beginPath(); g.arc(120, 120, 100, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#16121f'; g.fillRect(90, 60, 60, 120);
  await studio.uploads.upload({ name: 'mark.png', data: mark.toBuffer('image/png'), author: AUTHOR, slug: 'fablecut-mark' });
  await studio.uploads.upload({ name: 'logo.svg', data: Buffer.from(LOGO_SVG), author: AUTHOR, slug: 'logo-svg' });
  for (const slug of ['kit-plate', 'kit-chart-line', 'kit-chart-donut', 'kit-steps', 'kit-icon']) await studio.library.createAsset({ slug, source: src(`${slug}.js`), author: AUTHOR });
  // end-card: versions 1, 2 and 3 the way the library has them
  await studio.library.createAsset({ slug: 'end-card', source: src('end-card.js'), author: AUTHOR });
  await studio.library.updateAsset({ slug: 'end-card', source: src('end-card.v2.js'), author: AUTHOR });
  await studio.library.updateAsset({ slug: 'end-card', source: src('end-card.v3.js'), author: AUTHOR });
});
after(async () => { await t.cleanup(); });

const W = 640, H = 360;
/** A draft clip with one item per entry, on a theme (or none). */
const clip = (items, theme = 'theme-tide', size = [W, H]) => ({
  width: size[0], height: size[1], fps: 10, duration: 6, background: '#07111f', ...(theme ? { theme } : {}),
  tracks: [{ id: 'main', type: 'visual', items: items.map((it, i) => ({ id: `i${i}`, start: 0, duration: 6, ...it })) }],
});
const hashAt = async (composition, time) => (await studio.frameHashes({ composition, times: [time] }))[0].hash;

/** The kit items as the tests (and the contact sheet) use them: the asset, its params and the box it sits in. */
const KIT = {
  'kit-plate': { asset: 'kit-plate', params: { eyebrow: 'Growth', title: 'Views, *doubled*' }, transform: { x: 0.5, y: 0.5, width: 0.9, height: 0.8 } },
  'kit-chart-line': { asset: 'kit-chart-line', params: {}, transform: { x: 0.5, y: 0.5, width: 0.9, height: 0.9 } },
  'kit-chart-donut': { asset: 'kit-chart-donut', params: {}, transform: { x: 0.5, y: 0.5, width: 0.9, height: 0.9 } },
  'kit-steps': { asset: 'kit-steps', params: {}, transform: { x: 0.5, y: 0.5, width: 0.9, height: 0.5 } },
  'kit-icon': { asset: 'kit-icon', params: { name: 'rocket' }, transform: { x: 0.5, y: 0.5, width: 0.3, height: 0.5 } },
  'end-card': { asset: 'end-card', params: { clipTheme: true, logo: 'logo-svg', logoMode: 'auto', title: 'Make your next video with *code*', line: 'Free to try', cta: 'Start building', url: 'fablecut.dev' } },
};

test('every marketing kit asset draws at several times, differently under two themes and over time', async () => {
  for (const [name, def] of Object.entries(KIT)) {
    const a = clip([{ ...def }], 'theme-tide'), b = clip([{ ...def }], 'theme-ember');
    const times = [0.3, 1.2, 4];
    const tide = [], ember = [];
    for (const time of times) { tide.push(await hashAt(a, time)); ember.push(await hashAt(b, time)); }
    for (let i = 0; i < times.length; i++) assert.notEqual(tide[i], ember[i], `${name} at ${times[i]} s: the same pixels under two themes`);
    assert.ok(new Set(tide).size >= 2, `${name} does not move over time`);
    assert.equal(await hashAt(a, 1.2), tide[1], `${name} draws the same frame twice`);
  }
});

test('the theme parameter works without a clip theme, and a clip theme wins when there is one', async () => {
  const draw = (params, theme) => studio.frameHashes({ composition: clip([{ ...KIT['kit-steps'], params }], theme), times: [2] }).then((r) => r[0].hash);
  const noTheme = await draw({ theme: 'theme-tide' }, null);
  const ember = await draw({ theme: 'theme-ember' }, null);
  assert.notEqual(noTheme, ember, 'the parameter picks the theme when the clip has none');
  assert.equal(await draw({ theme: 'theme-tide' }, 'theme-ember'), await draw({ theme: 'theme-ember' }, 'theme-ember'), 'with a clip theme the parameter is not used');
  assert.equal(await draw({ theme: 'theme-ember' }, 'theme-ember'), ember, 'and it is the same as the parameter naming that theme');
});

test('their text is measured in the layout report, with its size floor and above it', async () => {
  for (const name of ['kit-plate', 'kit-chart-line', 'kit-chart-donut', 'kit-steps', 'end-card']) {
    // at rest, and while it eases in (the plate scales, the chart's labels and the button pop): never under the floor
    for (const time of [0.25, 0.7, 2.5, 4.5]) {
      const report = await studio.inspect.layoutReport({ composition: clip([{ ...KIT[name] }], 'theme-tide', [1280, 720]), t: time });
      const texts = report.texts.filter((x) => x.item === 'i0');
      if (time === 4.5) assert.ok(texts.length >= 2, `${name} shows text in the layout report (${texts.length})`);
      for (const x of texts) {
        assert.ok(x.floor >= 2.5, `${name}: "${x.text}" carries a floor (${x.floor})`);
        assert.ok(x.screenPct >= x.floor - 0.05, `${name} at ${time} s: "${x.text}" is ${x.screenPct}% of the short side, under its floor of ${x.floor}%`);
      }
    }
  }
  // the icon draws no text at all
  const icon = await studio.inspect.layoutReport({ composition: clip([{ ...KIT['kit-icon'] }]), t: 2 });
  assert.equal(icon.texts.length, 0);
  // the chart's numbers are among them, and the donut counted up to its share
  const line = await studio.inspect.layoutReport({ composition: clip([{ ...KIT['kit-chart-line'] }]), t: 4.5 });
  const said = line.texts.map((x) => x.text);
  for (const s of ['80', '60', '20', '0', 'Jan', 'Jun', '63', '29', 'New', 'Reused']) assert.ok(said.includes(s), `chart text "${s}" in ${JSON.stringify(said)}`);
  const donut = await studio.inspect.layoutReport({ composition: clip([{ ...KIT['kit-chart-donut'] }]), t: 4.5 });
  assert.ok(donut.texts.some((x) => x.text === '72%'), 'the donut counted up to 72%');
});

test('steps: `at` times and a keyframed `current` move the marker; the done steps are ticked', async () => {
  const at = (times, time) => hashAt(clip([{ ...KIT['kit-steps'], params: { at: times } }]), time);
  const times = [0.5, 1.5, 2.5, 3.5];
  assert.notEqual(await at(times, 1), await at(times, 2), 'step 1 then step 2');
  assert.notEqual(await at(times, 3.2), await at(times, 5), 'the marker moves on to the last step');
  assert.equal(await at(times, 4.6), await at(times, 5.4), 'and holds still there');
  // one more time than there are steps ticks the last one too
  const ticked = [...times, 4.5];
  assert.notEqual(await at(ticked, 4), await at(ticked, 5.5), 'the last step is ticked at the extra time');
  assert.equal(await at(ticked, 5.0), await at(ticked, 5.5));
  const keyed = clip([{ ...KIT['kit-steps'], params: { at: [] }, keyframes: { 'params.current': [{ t: 0, v: 0 }, { t: 3, v: 3 }] } }]);
  const a = await hashAt(keyed, 0.5), b = await hashAt(keyed, 2), c = await hashAt(keyed, 3.4);
  assert.equal(new Set([a, b, c]).size, 3);
  // the column: a tall box gives a column, forcing it in a wide box does too
  const wide = await hashAt(clip([{ ...KIT['kit-steps'], params: { direction: 'column' }, transform: { x: 0.5, y: 0.5, width: 0.5, height: 0.9 } }]), 2);
  const row = await hashAt(clip([{ ...KIT['kit-steps'], params: { direction: 'row' }, transform: { x: 0.5, y: 0.5, width: 0.5, height: 0.9 } }]), 2);
  assert.notEqual(wide, row);
});

test('bad input gives an error that says what to do, and a label that cannot fit fails loudly instead of shrinking', async () => {
  const draw = (def) => studio.frameHashes({ composition: clip([{ ...def }]), times: [3] });
  await assert.rejects(draw({ ...KIT['kit-chart-line'], params: { series: [{ label: 'A', values: [1, 2, 3, 4, 5, 6, 7], color: '' }] } }), /series 1 \("A"\) has 7 values but there are only 6 labels/);
  await assert.rejects(draw({ ...KIT['kit-chart-line'], params: { series: [{ label: 'A', values: [1, 2, 3], color: 'not-a-colour' }] } }), /not a CSS colour/);
  await assert.rejects(draw({ ...KIT['kit-chart-donut'], params: { segments: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] } }), /add up to zero/);
  await assert.rejects(draw({ ...KIT['kit-icon'], params: { color: 'blurple' } }), /not a CSS colour/);
  await assert.rejects(draw({ ...KIT['kit-icon'], params: { name: 'not-an-icon' } }), /expected one of/);
  await assert.rejects(draw({ ...KIT['kit-plate'], params: { fill: 'nope' } }), /not a CSS colour/);
  // six long labels in a narrow box: the text floor stops the shrinking and the asset fails with the item and the reason
  await assert.rejects(draw({ ...KIT['kit-steps'], params: { steps: ['Internationalization', 'Authentication', 'Acknowledgement', 'Configuration', 'Synchronization', 'Documentation'] }, transform: { x: 0.5, y: 0.5, width: 0.7, height: 0.5 } }), /size floor/);
  // a chart box too small for its text says so
  await assert.rejects(draw({ ...KIT['kit-chart-line'], transform: { x: 0.5, y: 0.5, width: 0.12, height: 0.12 } }), /too small|size floor/);
});

// ---- end card, version 3 ---------------------------------------------------------------------------

test('end-card@3 with the new parameters at their defaults draws exactly like end-card@2', async () => {
  const variants = [
    { logo: 'fablecut-mark' },
    { logo: 'logo-svg', title: 'Checked by *the studio*', line: 'Fablecut · iteration 3', size: 7.4, plate: true },
    { logo: 'fablecut-mark', theme: 'theme-ember', inDur: 0, title: 'Mai mult *cu mai puțin*' },
    { logo: 'logo-svg', theme: 'theme-sketchbook', size: 5, plate: true },
  ];
  for (const params of variants) {
    for (const format of ['horizontal', 'vertical', 'square']) {
      for (const time of [0, 0.3, 0.8, 2.5]) {
        const a = await studio.assetFrame({ ref: 'end-card@2', params, t: time, format, hash: true, maxSize: 480 });
        const b = await studio.assetFrame({ ref: 'end-card@3', params, t: time, format, hash: true, maxSize: 480 });
        assert.equal(b.hash, a.hash, `end-card@3 differs from @2 for ${JSON.stringify(params)} in ${format} at ${time} s`);
      }
    }
  }
  // ... and the same inside a clip that has a theme (version 3 reads its theme parameter, as version 2 did)
  const inClip = (ref) => hashAt(clip([{ asset: ref, params: { logo: 'fablecut-mark' } }], 'theme-ember'), 2);
  assert.equal(await inClip('end-card@3'), await inClip('end-card@2'));
});

test('end-card@3: a call to action, a url and a vector logo change the card, and the card still holds from 1 s on', async () => {
  const base = { logo: 'logo-svg', title: 'Make your next video with *code*', line: 'Free to try' };
  const plain = await hashAt(clip([{ asset: 'end-card', params: base }]), 3);
  const cta = await hashAt(clip([{ asset: 'end-card', params: { ...base, cta: 'Start building' } }]), 3);
  const url = await hashAt(clip([{ asset: 'end-card', params: { ...base, url: 'fablecut.dev' } }]), 3);
  assert.equal(new Set([plain, cta, url]).size, 3);
  // vector logo: not the raster, and the same drawing at every time after the ease in
  const asImage = await hashAt(clip([{ asset: 'end-card', params: { ...base, logoMode: 'image' } }]), 3);
  const asSvg = await hashAt(clip([{ asset: 'end-card', params: { ...base, logoMode: 'svg' } }]), 3);
  assert.notEqual(asImage, asSvg, 'the vector drawing is not the raster');
  const held = { ...base, cta: 'Start building', url: 'fablecut.dev', logoMode: 'auto' };
  const still = await hashAt(clip([{ asset: 'end-card', params: held }]), 1.2);
  for (const time of [1.5, 2.4, 3.9]) assert.equal(await hashAt(clip([{ asset: 'end-card', params: held }]), time), still, `still at ${time} s`);
  assert.notEqual(await hashAt(clip([{ asset: 'end-card', params: held }]), 0.5), still, 'and it did move before');
  // a PNG logo cannot be drawn as vectors: say so
  await assert.rejects(hashAt(clip([{ asset: 'end-card', params: { ...base, logo: 'fablecut-mark', logoMode: 'svg' } }]), 3), /needs an uploaded SVG/);
  // auto falls back to the raster for a PNG
  await hashAt(clip([{ asset: 'end-card', params: { ...base, logo: 'fablecut-mark', logoMode: 'auto' } }]), 3);
});

const ratio = (a, b) => {
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})/i.exec(hex);
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('end-card@3: the button text colour passes 4.5:1 on any button colour, light, dark or in between', async () => {
  for (const ctaColor of ['#5ce1e6', '#1b1f3b', '#e8553d', '#7b5cff', '#ffd166', '#ffffff', '#222222']) {
    const report = await studio.inspect.layoutReport({ composition: clip([{ asset: 'end-card', params: { logo: 'fablecut-mark', cta: 'Start building', ctaColor } }]), t: 3 });
    const text = report.texts.find((x) => x.text === 'Start building');
    assert.ok(text, 'the button text is in the layout report');
    const fill = /#[0-9a-f]{6}/i.exec(text.fill)?.[0] ?? text.fill;
    assert.ok(ratio(fill, ctaColor) >= 4.5, `button text ${fill} on ${ctaColor} is ${ratio(fill, ctaColor).toFixed(2)}:1`);
  }
});

// ---- the icons ---------------------------------------------------------------------------------------

/** Pixels of a PNG (or any image) that differ from the flat background it was drawn on. */
async function inkOf(png) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.fillStyle = '#101018'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x10) + Math.abs(d[i + 1] - 0x10) + Math.abs(d[i + 2] - 0x18) > 24) n++;
  return n;
}

test('the vendored icon set: the licence, the version and the count are there, and the asset holds exactly the vendored icons', () => {
  const lic = readFileSync(join(VENDOR, 'LICENSE'), 'utf8');
  assert.match(lic, /^ISC License/);
  assert.match(lic, /Lucide Icons and Contributors/);
  const version = JSON.parse(readFileSync(join(VENDOR, 'VERSION.json'), 'utf8'));
  assert.equal(version.name, 'lucide-static');
  assert.equal(version.license, 'ISC');
  assert.match(version.version, /^\d+\.\d+\.\d+$/);
  assert.ok(existsSync(join(VENDOR, 'UPSTREAM-README.md')), 'the upstream README is kept');
  const files = readdirSync(join(VENDOR, 'icons')).filter((f) => f.endsWith('.svg'));
  assert.equal(files.length, NAMES.length, 'one vendored SVG per curated icon');
  assert.equal(version.icons, NAMES.length);
  assert.ok(NAMES.length >= 140 && NAMES.length <= 200, `about 150 icons (${NAMES.length})`);
  assert.equal(new Set(NAMES).size, NAMES.length, 'no icon listed twice');
  for (const must of ['arrow-right', 'check', 'x', 'play', 'film', 'clapperboard', 'sparkles', 'rocket', 'chart-line', 'trending-up', 'captions', 'subtitles', 'languages', 'accessibility', 'graduation-cap', 'git-branch']) assert.ok(NAMES.includes(must), `${must} is in the set`);
  assert.equal(Object.values(CURATED).flat().length, NAMES.length);
  // the asset is what the generator makes from the vendored SVGs (node scripts/vendor-icons.mjs --check)
  const source = readFileSync(ASSET, 'utf8');
  assert.equal(withBlock(source, vendoredIcons()), source, 'assets/kit-icon.js is out of date: run node scripts/vendor-icons.mjs');
  const asset = studio.library.getAsset('kit-icon@1');
  assert.match(asset.description, /Lucide/);
  assert.match(asset.description, /ISC/);
  assert.deepEqual(asset.schema.name.options, NAMES, 'the name list is the vendored icons');
  assert.ok(asset.tags.includes('kit'));
});

test('kit-icon draws every included icon without error, each different from a blank frame', async () => {
  const sheet = [];
  for (const name of NAMES) {
    const r = await studio.assetFrame({ ref: 'kit-icon@1', params: { name, draw: 0, pop: 0 }, t: 1, width: 128, height: 128, background: '#101018', maxSize: 128 });
    const ink = await inkOf(r.png);
    assert.ok(ink > 120, `${name} drew ${ink} pixels: it is blank or nearly`);
    // and it is the icon Lucide draws: the vendored SVG rasterised at the same size has about the same ink
    const svg = readFileSync(join(VENDOR, 'icons', `${name}.svg`), 'utf8').replace(/currentColor/g, '#5ce1e6').replace(/width="24"/, 'width="128"').replace(/height="24"/, 'height="128"');
    const ref = await inkOf(Buffer.from(svg));
    assert.ok(Math.abs(ink - ref) <= ref * 0.04, `${name}: ${ink} pixels drawn, ${ref} in Lucide's own SVG`);
    sheet.push({ name, png: r.png });
  }
  await writeIconSheet(sheet);
});

test('kit-icon: weight, colour, draw-on and pop', async () => {
  const ink = async (params, time) => inkOf((await studio.assetFrame({ ref: 'kit-icon@1', params: { name: 'zap', ...params }, t: time, width: 128, height: 128, background: '#101018', maxSize: 128 })).png);
  assert.ok(await ink({ weight: 3, draw: 0, pop: 0 }, 1) > await ink({ weight: 1, draw: 0, pop: 0 }, 1), 'a heavier weight draws more');
  const mid = await ink({ draw: 1, pop: 0 }, 0.5), full = await ink({ draw: 1, pop: 0 }, 1.5), start = await ink({ draw: 1, pop: 0 }, 0.05);
  assert.ok(start < mid && mid < full, `the stroke traces on: ${start} < ${mid} < ${full}`);
  // the pop: small and faint at first, the full icon after
  assert.ok(await ink({ draw: 0, pop: 0.5 }, 0.1) < await ink({ draw: 0, pop: 0.5 }, 1));
  // a colour of its own, and the same icon in two colours has the same shape
  const red = await studio.assetFrame({ ref: 'kit-icon@1', params: { name: 'zap', color: '#ff0000', draw: 0, pop: 0 }, t: 1, width: 64, height: 64, hash: true });
  const blue = await studio.assetFrame({ ref: 'kit-icon@1', params: { name: 'zap', color: '#0000ff', draw: 0, pop: 0 }, t: 1, width: 64, height: 64, hash: true });
  assert.notEqual(red.hash, blue.hash);
  const [ri, bi] = [await inkOf(red.png), await inkOf(blue.png)];
  assert.ok(Math.abs(ri - bi) <= ri * 0.03, `the same shape in two colours: ${ri} and ${bi} pixels`);
});

// ---- MCP over stdio ----------------------------------------------------------------------------------

test('over MCP: create the kit assets, look at a frame, measure its text', async () => {
  const dataDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'studio-mcp-'));
  const client = await connect({ dataDir, author: 'kit-test' });
  try {
    const call = (name, args) => callTool(client, name, args);
    for (const slug of ['easing', 'theme-tide']) assert.ok(!(await call('create_asset', { name: slug, source: src(`${slug}.js`) })).isError);
    for (const slug of ['kit-steps', 'kit-chart-donut', 'kit-icon']) {
      const r = await call('create_asset', { name: slug, source: src(`${slug}.js`) });
      assert.ok(!r.isError, r.text);
      assert.equal(r.json.created, `${slug}@1`);
      assert.equal(r.images.length, 1, 'a thumbnail comes back');
    }
    const found = await call('search_assets', { tags: ['kit'] });
    assert.deepEqual(found.json.assets.map((a) => a.ref).sort(), ['kit-chart-donut@1', 'kit-icon@1', 'kit-steps@1']);
    const frame = await call('render_asset_frame', { ref: 'kit-steps@1', params: { current: 2.4, steps: ['Plan', 'Shoot', 'Cut', 'Share'] }, t: 1 });
    assert.ok(!frame.isError, frame.text);
    assert.equal(frame.images.length, 1);
    const report = await call('layout_report', { composition: clip([{ asset: 'kit-steps', params: { steps: ['Plan', 'Shoot', 'Cut', 'Share'] } }]), t: 3 });
    assert.ok(!report.isError, report.text);
    assert.deepEqual(report.json.texts.filter((x) => x.item === 'i0' && /^[A-Z][a-z]+$/.test(x.text)).map((x) => x.text), ['Plan', 'Shoot', 'Cut', 'Share']);
    assert.ok(report.json.texts.every((x) => x.floor >= 2.5));
    // a bad parameter comes back as an error the model can act on
    const bad = await call('render_asset_frame', { ref: 'kit-icon@1', params: { name: 'nope' } });
    assert.ok(bad.isError);
    assert.match(bad.text, /expected one of/);
  } finally {
    await client.close();
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the db file */ }
  }
});

// ---- contact sheets ----------------------------------------------------------------------------------

/** The kit's items on plates, the way a clip would use them: one cell per scene, under theme-tide, 1920×1080 each. */
/** @type {[string, any[]][]} */
const SCENES = [
  ['plate, steps and an icon', [
    { asset: 'kit-plate', params: { eyebrow: 'Onboarding', title: 'From footage to *finished*, in four steps' }, transform: { x: 0.5, y: 0.5, width: 0.88, height: 0.76 } },
    { asset: 'kit-icon', params: { name: 'clapperboard', draw: 1, weight: 1.75 }, transform: { x: 0.84, y: 0.27, width: 0.1, height: 0.18 } },
    { asset: 'kit-steps', params: { steps: ['Upload', 'Describe', 'Build', 'Render'], current: 2.3 }, transform: { x: 0.5, y: 0.64, width: 0.76, height: 0.24 } },
  ]],
  ['line chart on a plate', [
    { asset: 'kit-plate', params: { eyebrow: '', title: '' }, transform: { x: 0.5, y: 0.5, width: 0.92, height: 0.88 } },
    { asset: 'kit-chart-line', params: {}, transform: { x: 0.5, y: 0.5, width: 0.84, height: 0.78 } },
  ]],
  ['donut chart on a plate', [
    { asset: 'kit-plate', params: { eyebrow: '', title: '' }, transform: { x: 0.5, y: 0.5, width: 0.92, height: 0.88 } },
    { asset: 'kit-chart-donut', params: {}, transform: { x: 0.5, y: 0.5, width: 0.84, height: 0.78 } },
  ]],
  ['steps in a column, icons', [
    { asset: 'kit-plate', params: { eyebrow: 'Workflow', title: 'Five *moves*' }, transform: { x: 0.3, y: 0.5, width: 0.5, height: 0.88 } },
    { asset: 'kit-steps', params: { steps: ['Record', 'Trim', 'Annotate', 'Caption', 'Export'], current: 2.5, direction: 'column' }, transform: { x: 0.3, y: 0.63, width: 0.4, height: 0.56 } },
    { asset: 'kit-icon', params: { name: 'video', draw: 1 }, transform: { x: 0.66, y: 0.28, width: 0.1, height: 0.18 } },
    { asset: 'kit-icon', params: { name: 'captions', draw: 1 }, transform: { x: 0.78, y: 0.28, width: 0.1, height: 0.18 } },
    { asset: 'kit-icon', params: { name: 'download', draw: 1 }, transform: { x: 0.9, y: 0.28, width: 0.1, height: 0.18 } },
    { asset: 'kit-icon', params: { name: 'trending-up', draw: 1, weight: 1.25, color: '#ffb347' }, transform: { x: 0.72, y: 0.62, width: 0.22, height: 0.4 } },
  ]],
  ['end card with a call to action', [
    { asset: 'end-card', params: { logo: 'logo-svg', logoMode: 'auto', title: 'Make your next video with *code*', line: 'Free to try', cta: 'Start building', url: 'fablecut.dev' } },
  ]],
  ['icons drawing on', [
    ...['sparkles', 'rocket', 'heart', 'zap', 'globe', 'award'].map((name, i) => ({ asset: 'kit-icon', params: { name, draw: [0, 1.3, 1.7, 2.3, 3.2, 5][i], pop: 0.3, weight: 2 }, transform: { x: 0.12 + i * 0.152, y: 0.5, width: 0.13, height: 0.23 } })),
  ]],
];

test('contact sheet: the marketing kit under theme-tide', async () => {
  const cells = [];
  for (const [label, items] of SCENES) {
    const duration = 8;
    const composition = { width: 1920, height: 1080, fps: 30, duration, background: '#07111f', theme: 'theme-tide', tracks: [{ id: 'main', type: 'visual', items: items.map((it, i) => ({ id: `s${i}`, start: 0, duration, ...it })) }] };
    const time = label === 'icons drawing on' ? 1 : 6.2;
    const r = await studio.clipFrame({ composition, t: time, maxSize: 960 });
    cells.push({ label, png: r.png });
  }
  mkdirSync(SHEETS, { recursive: true });
  const cw = 960, ch = 540, gap = 12, cols = 2, rows = Math.ceil(cells.length / cols);
  const sheet = createCanvas(cols * cw + (cols + 1) * gap, rows * ch + (rows + 1) * gap);
  const g = sheet.getContext('2d');
  g.fillStyle = '#16161d';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < cells.length; i++) {
    const img = await loadImage(cells[i].png);
    g.drawImage(img, gap + (i % cols) * (cw + gap), gap + Math.floor(i / cols) * (ch + gap), cw, ch);
  }
  writeFileSync(join(SHEETS, 'kit-marketing.png'), sheet.toBuffer('image/png'));
  assert.ok(existsSync(join(SHEETS, 'kit-marketing.png')));
});

/** Every included icon with its name, on one sheet. */
async function writeIconSheet(icons) {
  mkdirSync(SHEETS, { recursive: true });
  const cols = 16, cell = 120, label = 20, pad = 12;
  const rows = Math.ceil(icons.length / cols);
  const sheet = createCanvas(cols * cell + pad * 2, rows * (cell + label) + pad * 2 + 40);
  const g = sheet.getContext('2d');
  g.fillStyle = '#101018';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.fillStyle = '#8ba0bf';
  g.font = '600 18px "Inter"';
  g.fillText(`Lucide ${JSON.parse(readFileSync(join(VENDOR, 'VERSION.json'), 'utf8')).version} (ISC licence): the ${icons.length} icons of kit-icon`, pad, 28);
  for (let i = 0; i < icons.length; i++) {
    const x = pad + (i % cols) * cell, y = pad + 40 + Math.floor(i / cols) * (cell + label);
    g.drawImage(await loadImage(icons[i].png), x + 8, y, cell - 16, cell - 16);
    g.fillStyle = '#8ba0bf';
    g.font = '400 11px "JetBrains Mono"';
    const w = g.measureText(icons[i].name).width;
    g.fillText(icons[i].name, x + (cell - w) / 2, y + cell - 4);
  }
  writeFileSync(join(SHEETS, 'kit-icons.png'), sheet.toBuffer('image/png'));
}
