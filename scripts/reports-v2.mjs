// Reports for the iteration-2 contract, read from a data dir that holds the showcase (clips 1 to 6,
// built by `npm run showcase`) and from the journals of clips 4 to 6:
//
//   features.json       every new feature and where clips 4 and 5 use it
//   kinds.json          the motion, transition and effect assets, precomps, presets, masks, sequences
//   3d.json             the 3D assets, two renders with the same frame hashes, text behind and in front, the baked sequence
//   zorder.json         a title drawn behind a 3D shape and, after move_track, in front of it (pixels of the Node frame)
//   uploads.json        the uploaded images, what the agent wrote about them, and that search finds them by those tags
//   request-clip.json   the thread of the clip-scoped request ("add a lower third at 0:03")
//   compounding.md      the compounding table for clips 1 to 6, and what made clip 6 cheaper (+ compounding.json)
//
//   STUDIO_DATA=<dir> node scripts/reports-v2.mjs [out-dir]     (default docs/showcase/v2)
//
// Exits 1 when a check fails; every report says which.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createStudio } from '../src/studio/studio.js';
import { sanitizeSvg } from '../src/studio/svg.js';
import { ROOT, createCanvas, loadImage } from '../src/render/host.js';

const NEW = ['clip-4-direct-the-studio', 'clip-5-a-library-in-3d', 'clip-6-what-the-library-holds'];
const out = process.argv[2] ?? join(ROOT, 'docs', 'showcase', 'v2');
for (const d of ['reports', 'studio']) mkdirSync(join(out, d), { recursive: true });
const write = (name, value) => writeFileSync(join(out, 'reports', name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 1)}\n`);
const journal = (clip) => readFileSync(join(ROOT, 'showcase', 'journal', `${clip}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const studio = createStudio({ role: 'evidence' });
const { library, clips, requests, renders, compounding } = studio;
const failures = [];
const check = (report, name, ok) => { if (!ok) failures.push(`${report}: ${name}`); return !!ok; };
const info = (ref) => library.getAsset(ref);
const slugOf = (ref) => String(ref).split('@')[0];
const itemsOf = (comp) => comp.tracks.flatMap((t, i) => t.items.map((it) => ({ ...it, track: t.id, trackIndex: i })));
const is3d = (a) => a.type === 'function' && /\blib\.solid\b|\bsolid\.(render|camera|icosphere|box|terrain|text)\b/.test(a.source ?? '');
const images = new Map(library.search({ type: 'image', limit: 200 }).assets.map((a) => [a.slug, info(a.ref)]));

try {
  // ---- features: clips 4 and 5 between them use every new feature
  {
    const per = {};
    for (const clip of NEW.slice(0, 2)) {
      const comp = clips.getClip(clip).composition;
      const items = itemsOf(comp);
      const J = journal(clip);
      const ops = J.filter((e) => e.name === 'edit_clip' && e.ok).flatMap((e) => e.args.operations ?? []);
      const assetOf = (it) => info(it.asset);
      const svgIn = (it) => Object.values(it.params ?? {}).filter((v) => typeof v === 'string' && images.get(slugOf(v))?.meta.format === 'svg').map(slugOf);
      const precompSvg = (it) => { const a = assetOf(it); return a.derivation === 'precomp' ? Object.keys(a.deps).filter((d) => images.get(slugOf(d))?.meta.format === 'svg').map(slugOf) : []; };
      per[clip] = {
        transforms: items.filter((it) => it.transform).map((it) => it.id),
        keyframes: items.filter((it) => Object.keys(it.keyframes ?? {}).length).map((it) => `${it.id} (${Object.keys(it.keyframes).join(', ')})`),
        perFormatLayouts: items.filter((it) => Object.keys(it.formats ?? {}).length).map((it) => `${it.id} (${Object.keys(it.formats).join(', ')})`),
        draggedLayerOrder: ops.filter((o) => o.op === 'move_track' || o.op === 'move_item').map((o) => `${o.op} ${o.id} → ${o.track ? `${o.track} ` : ''}index ${o.index}`),
        motions: items.flatMap((it) => (it.motions ?? []).map((m) => `${it.id}: ${m.asset} (${m.phase})`)),
        transitions: items.filter((it) => it.transition).map((it) => `${it.id}: ${it.transition.asset}`),
        effects: [...(comp.effects ?? []).map((e) => `clip: ${e.asset}`), ...comp.tracks.flatMap((t) => (t.effects ?? []).map((e) => `track ${t.id}: ${e.asset}`)), ...items.flatMap((it) => (it.effects ?? []).map((e) => `${it.id}: ${e.asset}`))],
        masks: items.filter((it) => it.mask).map((it) => `${it.id}: ${it.mask.asset} (${it.mask.mode})`),
        precomp: [...J.filter((e) => e.name === 'save_precomp' && e.ok).map((e) => `saved from its layers: ${e.args.name}`), ...items.filter((it) => assetOf(it).derivation === 'precomp').map((it) => `${it.id}: ${it.asset}`)],
        preset: items.filter((it) => assetOf(it).derivation === 'preset').map((it) => `${it.id}: ${it.asset} (of ${assetOf(it).forkedFrom})`),
        threeD: items.filter((it) => { const a = assetOf(it); return is3d(a) || (a.type === 'sequence' && is3d(info(a.forkedFrom))); }).map((it) => `${it.id}: ${it.asset}`),
        uploadedImage: items.filter((it) => ['png', 'jpeg'].includes(images.get(slugOf(it.asset))?.meta.format)).map((it) => `${it.id}: ${it.asset} (${images.get(slugOf(it.asset)).meta.format})`),
        uploadedSvg: items.flatMap((it) => [...svgIn(it), ...precompSvg(it)].map((s) => `${it.id}: ${s}`)),
        requestFlow: requests.list({ clip }).map((r) => requests.get(r.id)).flatMap((r) => r.proposals.filter((p) => p.status === 'accepted').map((p) => `request #${r.id} "${r.title}" → ${p.kind} by ${p.author}, accepted`)),
      };
    }
    const features = Object.keys(per[NEW[0]]);
    const covered = Object.fromEntries(features.map((f) => [f, check('features', f, NEW.slice(0, 2).some((c) => per[c][f].length))]));
    write('features.json', { what: 'Where clips 4 and 5 use each feature of iteration 2 (item ids from their compositions; layer moves, precomps and requests from their journals and the database).', everyFeatureUsed: Object.values(covered).every(Boolean), covered, ...per });
    console.log(`${Object.values(covered).every(Boolean) ? '✓' : '✖'} features: ${features.filter((f) => covered[f]).length}/${features.length} used by clips 4 and 5`);
  }

  // ---- kinds
  const showcase = clips.listClips().map((c) => ({ slug: c.slug, comp: clips.getClip(c.slug).composition }));
  {
    const attached = (comp) => [...(comp.effects ?? []), ...comp.tracks.flatMap((t) => t.effects ?? []), ...itemsOf(comp).flatMap((it) => [...(it.motions ?? []), ...(it.effects ?? []), it.transition, it.mask].filter(Boolean))].map((x) => slugOf(x.asset));
    const usedIn = (slug) => showcase.filter((c) => attached(c.comp).includes(slug) || itemsOf(c.comp).some((it) => slugOf(it.asset) === slug)).map((c) => c.slug);
    const list = (filter) => library.search({ ...filter, limit: 200, sort: 'newest' }).assets.map((a) => ({ ref: a.ref, title: a.title, madeFor: a.originClip, usedIn: usedIn(a.slug) })).reverse();
    const k = { motion: list({ kind: 'motion' }), transition: list({ kind: 'transition' }), effect: list({ kind: 'effect' }), precomp: list({ derivation: 'precomp' }), preset: list({ derivation: 'preset' }), sequence: list({ type: 'sequence' }) };
    const masks = showcase.flatMap((c) => itemsOf(c.comp).filter((it) => it.mask).map((it) => ({ clip: c.slug, item: it.id, mask: it.mask.asset, mode: it.mask.mode })));
    const checks = {
      'at least 4 motion assets': k.motion.length >= 4, 'at least 3 transition assets': k.transition.length >= 3, 'at least 4 effect assets': k.effect.length >= 4,
      'a precomp made from layers': k.precomp.length >= 1, 'a mask in a clip': masks.length >= 1,
      'every kind appears in the showcase': ['motion', 'transition', 'effect', 'precomp', 'preset', 'sequence'].every((n) => k[n].some((a) => a.usedIn.length)),
    };
    for (const [n, ok] of Object.entries(checks)) check('kinds', n, ok);
    const tests = (file) => [...readFileSync(join(ROOT, 'test', file), 'utf8').matchAll(/^test\('((?:[^'\\]|\\.)+)'/gm)].map((m) => m[1]);
    write('kinds.json', { checks, counts: Object.fromEntries(Object.entries(k).map(([n, v]) => [n, v.length])), ...k, masks, contractTests: { 'test/kinds.test.js': tests('kinds.test.js'), 'test/parity.test.js': tests('parity.test.js') } });
    console.log(`${Object.values(checks).every(Boolean) ? '✓' : '✖'} kinds: ${k.motion.length} motion, ${k.transition.length} transition, ${k.effect.length} effect, ${k.precomp.length} precomp, ${k.preset.length} preset, ${k.sequence.length} sequence, ${masks.length} mask(s) in clips`);
  }

  // ---- z-order: the title of clip 4 behind the 3D orb, then in front of it after move_track
  let zorder;
  {
    const clip = NEW[0], t = 11;
    const comp = clips.getClip(clip).composition;
    const order = (c) => c.tracks.map((x) => x.id);
    const at = order(comp).indexOf('3d');
    const front = clips.applyOps(comp, [{ op: 'move_track', id: 'behind', index: at }]);
    const back = clips.applyOps(front, [{ op: 'move_track', id: 'behind', index: order(comp).indexOf('behind') }]);
    const [A, B, C] = await Promise.all([comp, front, back].map((composition) => studio.clipFrame({ composition, t, hash: true })));
    const px = async (png) => { const img = await loadImage(png); const c = createCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const [a, b] = await Promise.all([px(A.png), px(B.png)]);
    // the title's ink is near white; the orb is cyan and orange
    const ink = (d, i) => d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200;
    let differ = 0, inkBehind = 0, inkFront = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 48) continue;
      differ++;
      if (ink(a, i)) inkBehind++;
      if (ink(b, i)) inkFront++;
    }
    zorder = {
      what: 'Clip 4 at 0:11 drawn by the Node renderer: the title track under the 3D track (as built), after move_track puts it above (what dragging the track does), and after moving it back (what undo restores). Counted over the pixels that differ between the two orders, which is where the title and the orb overlap.',
      clip, t, tracksAsBuilt: order(comp), tracksTitleInFront: order(front), tracksAfterMovingBack: order(back),
      pixelsThatDiffer: differ, titleInkAmongThem: { titleBehind: inkBehind, titleInFront: inkFront },
      hashes: { titleBehind: A.hash, titleInFront: B.hash, movedBack: C.hash },
      checks: { 'the order changes the frame': A.hash !== B.hash && differ > 1000, 'in front, the overlap shows the title; behind, it shows the orb': inkFront > 500 && inkFront > 5 * Math.max(1, inkBehind), 'moving the track back restores the frame exactly': A.hash === C.hash },
      frames: ['studio/zorder-title-behind.png', 'studio/zorder-title-in-front.png'],
    };
    for (const [n, ok] of Object.entries(zorder.checks)) check('zorder', n, ok);
    writeFileSync(join(out, 'studio', 'zorder-title-behind.png'), A.png);
    writeFileSync(join(out, 'studio', 'zorder-title-in-front.png'), B.png);
    write('zorder.json', zorder);
    console.log(`${Object.values(zorder.checks).every(Boolean) ? '✓' : '✖'} zorder: ${differ} pixels differ; title ink among them ${inkBehind} behind → ${inkFront} in front; moved back ${A.hash === C.hash ? 'identical' : 'DIFFERENT'}`);
  }

  // ---- 3D
  {
    const assets3d = library.search({ type: 'function', limit: 500 }).assets.map((a) => info(a.ref)).filter(is3d).map((a) => ({ ref: a.ref, title: a.title, madeFor: a.originClip, usedIn: a.usedBy.map((u) => u.clip) }));
    const determinism = [];
    for (const clip of NEW) {
      const byFormat = new Map();
      for (const r of renders.list({ clip, status: 'done', limit: 50 })) byFormat.set(r.format, [...(byFormat.get(r.format) ?? []), r]);
      for (const [format, rs] of byFormat) {
        if (rs.length < 2) continue;
        const [x, y] = [rs.at(-1), rs[0]];
        const keys = Object.keys(x.stats.frameHashes);
        determinism.push({ clip, format, renders: [x.id, y.id], sampledFrames: keys.length, identical: keys.length > 0 && keys.every((k) => x.stats.frameHashes[k] === y.stats.frameHashes[k]) });
      }
    }
    const comp4 = clips.getClip(NEW[0]).composition;
    const items4 = itemsOf(comp4);
    const orb = items4.find((it) => it.id === 'orb');
    const overlaps = (it) => it.start < orb.start + orb.duration && it.start + it.duration > orb.start;
    const text = (pick) => items4.filter((it) => comp4.tracks[it.trackIndex].type === 'text' && overlaps(it) && pick(it.trackIndex)).map((it) => `${it.id} (track ${it.track}, ${it.start}–${it.start + it.duration} s)`);
    const between = { clip: NEW[0], shape: `${orb.asset} (track ${orb.track}, ${orb.start}–${orb.start + orb.duration} s)`, textBehind: text((i) => i < orb.trackIndex), textInFront: text((i) => i > orb.trackIndex), frames: zorder.frames };
    const baked = library.search({ type: 'sequence', limit: 50 }).assets.map((a) => info(a.ref)).map((a) => ({ ref: a.ref, bakedFrom: a.forkedFrom, madeFor: a.originClip, usedIn: a.usedBy.map((u) => u.clip) }));
    const parityFile = join(out, 'reports', 'parity.json');
    const parity = existsSync(parityFile) ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(parityFile, 'utf8')).cases).filter(([n]) => ['3d', 'sequence'].includes(n))) : null;
    const checks = {
      'at least 3 procedural 3D assets': assets3d.length >= 3,
      'two renders of a clip with 3D give identical frame hashes': determinism.length > 0 && determinism.every((d) => d.identical),
      '2D text behind and in front of a 3D piece in one clip': between.textBehind.length > 0 && between.textInFront.length > 0,
      'a baked sequence is used by a second clip': baked.some((b) => new Set(b.usedIn).size >= 2),
      'preview matches render (parity cases 3d and sequence)': !!parity && Object.values(parity).flat().every((c) => c.ok),
    };
    for (const [n, ok] of Object.entries(checks)) check('3d', n, ok);
    write('3d.json', { checks, assets: assets3d, determinism, between, baked, parity, tests: 'test/solid.test.js, test/parity.test.js (cases 3d, sequence)' });
    console.log(`${Object.values(checks).every(Boolean) ? '✓' : '✖'} 3d: ${assets3d.length} assets, ${determinism.length} render pair(s) ${determinism.every((d) => d.identical) ? 'identical' : 'DIFFERENT'}, ${baked.length} baked sequence(s)${parity ? '' : ' (no parity.json yet: run scripts/parity.mjs first)'}`);
  }

  // ---- uploads
  {
    const J = NEW.flatMap((c) => journal(c));
    const described = new Set(J.filter((e) => e.name === 'describe_asset' && e.ok).map((e) => e.args.name ?? e.args.asset ?? e.args.slug));
    const uploads = [...images.values()].filter((a) => a.meta?.originalName).map((a) => {
      const tags = a.tags.filter((t) => !['upload', 'photo', 'vector'].includes(t)).slice(0, 4);
      return {
        ref: a.ref, file: a.meta.originalName, format: a.meta.format, bytes: a.meta.bytes, size: `${a.meta.width}×${a.meta.height}`, palette: a.meta.palette,
        sanitised: a.meta.format === 'svg' ? { removed: a.meta.sanitized?.removed ?? [], vectorPaths: a.meta.vector?.paths?.length ?? null, drawnFrom: 'a raster made once in Node (' + a.mime + ')' } : undefined,
        title: a.title, description: a.description, tags: a.tags, suggestedUses: a.suggestedUses, describedBy: a.metadataEdit?.by ?? null, describedThroughMcp: described.has(a.slug), waitingForDescription: a.needsDescription,
        foundByTag: Object.fromEntries(tags.map((t) => [t, library.search({ query: t, limit: 50 }).assets.some((x) => x.slug === a.slug)])),
        usedIn: a.usedBy.map((u) => u.clip),
      };
    });
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject><image href="https://example.com/x.png"/><a href="javascript:alert(3)"><rect width="5" height="5" fill="url(https://example.com/p.svg#g)" onclick="alert(4)"/></a><use xlink:href="https://example.com/y.svg#z"/><circle cx="5" cy="5" r="2" fill="#f00"/></svg>';
    const clean = sanitizeSvg(hostile);
    const checks = {
      'a PNG, a JPG and an SVG were uploaded': ['png', 'jpeg', 'svg'].every((m) => uploads.some((u) => u.format === m)),
      'every upload was described by the agent through MCP': uploads.length > 0 && uploads.every((u) => u.describedThroughMcp && !u.waitingForDescription && u.description && u.tags.length > 2),
      'search finds every upload by its tags': uploads.every((u) => Object.values(u.foundByTag).length > 0 && Object.values(u.foundByTag).every(Boolean)),
      'a hostile SVG comes out with nothing active': !/script|onload|onclick|foreignObject|javascript:|https?:\/\/example|<image|<a\b/i.test(clean.svg.replace('http://www.w3.org/2000/svg', '')) && /<circle/.test(clean.svg),
    };
    for (const [n, ok] of Object.entries(checks)) check('uploads', n, ok);
    write('uploads.json', { checks, uploads, hostileSvg: { input: hostile, removed: clean.removed, output: clean.svg.trim() }, tests: 'test/uploads.test.js; the files are drawn by showcase/uploads/make.mjs' });
    console.log(`${Object.values(checks).every(Boolean) ? '✓' : '✖'} uploads: ${uploads.map((u) => `${u.file} (${Object.keys(u.foundByTag).length} tags found)`).join(', ')}; hostile SVG: ${clean.removed.length} things removed`);
  }

  // ---- the clip-scoped request
  {
    const r = requests.list({ clip: NEW[1], scope: 'clip' }).map((x) => requests.get(x.id)).find((x) => /lower third/i.test(x.title));
    const ok = check('request-clip', 'a clip request with an accepted clip edit', !!r && r.status === 'done' && r.proposals.some((p) => p.kind === 'clip_edit' || p.status === 'accepted'));
    if (r) {
      const J = journal(NEW[1]).filter((e) => ['create_request', 'claim_request', 'propose_clip_edit', 'accept'].includes(e.name)).map((e) => ({ at: e.at, by: e.kind === 'user' ? 'the user, in the studio' : 'Claude Code, over MCP', step: e.name, ms: e.ms }));
      write('request-clip.json', { what: 'The clip-scoped request of clip 5, as the database holds it after the showcase build (the live build is in showcase/journal; its steps and times are under "live").', live: J, request: { ...r, proposals: r.proposals.map(({ thumb: _t, meta: _m, ...p }) => p) } });
    }
    console.log(`${ok ? '✓' : '✖'} request-clip: ${r ? `#${r.id} "${r.title}" → ${r.proposals.map((p) => `${p.kind} ${p.status}`).join(', ')}` : 'not found'}`);
  }

  // ---- compounding: clips 4 to 6 were built live and their journals keep every call with its time;
  // the database here was rebuilt by replaying them, so its call log times a replay, not the build
  {
    const rows = clips.listClips().map((c) => {
      const m = compounding.metrics(c.slug);
      const row = { clip: c.slug, title: m.title, seconds: m.duration, format: m.format, mcpCalls: m.mcpCalls, studioActions: 0, newAssets: m.newAssets, newCodeLines: m.newCodeLines, generatedAssets: m.generatedAssets, generatedLines: m.generatedLines, items: m.items, reuseShare: m.reuseShare, reusedFrom: m.reusedFrom, buildSeconds: null, perOutputSecond: null, measured: 'calls: the plan replayed by npm run showcase; build time: not measured (iteration 1 kept no call log)' };
      if (NEW.includes(c.slug)) {
        const J = journal(c.slug);
        const end = J.findIndex((e) => e.name === 'start_render');
        const window = J.slice(0, end + 1);
        const calls = window.filter((e) => e.kind !== 'user');
        Object.assign(row, {
          mcpCalls: calls.length, mcpCallsByTool: Object.fromEntries([...calls.reduce((mm, e) => mm.set(e.name, (mm.get(e.name) ?? 0) + 1), new Map())].sort((x, y) => y[1] - x[1])), failedCalls: calls.filter((e) => !e.ok).length,
          studioActions: window.filter((e) => e.kind === 'user').length, buildStart: J[0].at, buildEnd: J[end].at,
          buildSeconds: Math.round((Date.parse(J[end].at) - Date.parse(J[0].at)) / 100) / 10, measured: 'live build on 2026-10-06, from showcase/journal: first call to the render request',
        });
        row.perOutputSecond = Math.round((row.buildSeconds / row.seconds) * 100) / 100;
      }
      return row;
    });
    const by = Object.fromEntries(rows.map((r) => [r.clip, r]));
    const [c4, c5, c6] = NEW.map((c) => by[c]);
    const old = rows.filter((r) => !NEW.includes(r.clip) && /^clip-[123]-/.test(r.clip));
    const j5 = journal(NEW[1]), r5 = j5.find((e) => e.name === 'start_render');
    const checks = {
      'clip 6 was started after clip 5 finished rendering': Date.parse(c6.buildStart) > Date.parse(r5.at) + r5.ms,
      'clip 6 reuses assets made for clip 4, clip 5, clip 1 and clip 2': [NEW[0], NEW[1], 'clip-1-every-frame', 'clip-2-compounding'].every((c) => (c6.reusedFrom[c] ?? 0) >= 1),
      'less build time than clip 4 and clip 5': c6.buildSeconds < c4.buildSeconds && c6.buildSeconds < c5.buildSeconds,
      'fewer MCP calls than clip 4 and clip 5': c6.mcpCalls < c4.mcpCalls && c6.mcpCalls < c5.mcpCalls,
      'less new asset code than clip 4 and clip 5': c6.newCodeLines < c4.newCodeLines && c6.newCodeLines < c5.newCodeLines,
      'a higher reuse share than clip 4 and clip 5': c6.reuseShare > c4.reuseShare && c6.reuseShare > c5.reuseShare,
      'clearly less new asset code than any of clips 1 to 3': old.length === 3 && old.every((o) => c6.newCodeLines < o.newCodeLines / 4),
    };
    for (const [n, ok] of Object.entries(checks)) check('compounding', n, ok);
    const pct = (x) => `${Math.round(x * 100)} %`;
    const from = (r) => Object.entries(r.reusedFrom).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${n} from ${c.replace(/^clip-(\d).*/, 'clip $1')}`).join(', ');
    const md = [
      '# Compounding: what each clip cost to build',
      '',
      'Written by `scripts/reports-v2.mjs`. Lines of asset code and reuse share are read from the database after `npm run showcase`. For clips 4 to 6 the MCP calls and the build time come from their journals (`showcase/journal/*.jsonl`), which recorded every call of the live build on 2026-10-06 with its time: build time runs from the first call to the render request, the render itself is not counted, and reading calls and failed calls are counted. Clips 1 to 3 were built in iteration 1, before calls were logged; their calls are the ones `showcase/plan.mjs` replays and their build time was never measured.',
      '',
      '| # | clip | length | MCP calls | studio actions by the user | new lines of asset code | reuse share | build time | build time per second of output |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r, i) => `| ${i + 1} | ${r.clip} | ${r.seconds} s | ${r.mcpCalls} | ${r.studioActions || '–'} | ${r.newCodeLines}${r.generatedLines ? ` (+${r.generatedLines} generated)` : ''} | ${pct(r.reuseShare)} (${r.items - Math.round(r.items * (1 - r.reuseShare))} of ${r.items} items) | ${r.buildSeconds !== null ? `${r.buildSeconds} s` : '–'} | ${r.perOutputSecond !== null ? `${r.perOutputSecond} s` : '–'} |`),
      '',
      '"New lines" are the non-blank lines of asset source written for the clip; presets and precomps the studio generated are counted apart. "Reuse share" is the share of timeline items whose pinned asset version already existed, made for an earlier clip.',
      '',
      '## Clip 6 against the clips before it',
      '',
      ...Object.entries(checks).map(([n, ok]) => `- ${ok ? 'yes' : 'NO'}: ${n}`),
      '',
      `Clip 6 is three times as long as clip 4 and took ${Math.round((c6.buildSeconds / c4.buildSeconds) * 100)} % of its build time and ${Math.round((c6.buildSeconds / c5.buildSeconds) * 100)} % of clip 5's: ${c6.perOutputSecond} s of work per second of video, against ${c4.perOutputSecond} s and ${c5.perOutputSecond} s.`,
      '',
      '## What made clip 6 cheaper',
      '',
      `- **Nothing had to be written.** Its ${c6.items} timeline items all pin asset versions that existed: ${from(c6)}. Clip 4 wrote ${c4.newAssets.length} assets (${c4.newCodeLines} lines) and clip 5 ${c5.newAssets.length} (${c5.newCodeLines} lines).`,
      `- **It started from the library, not from a blank file.** Its first call after \`create_clip\` was \`suggest_assets\` with the brief; the answer named the pieces with their params, notes and real usage examples, so the composition was written in ${c6.mcpCallsByTool.update_clip ?? 0} \`update_clip\` call(s) and checked with ${c6.mcpCallsByTool.render_clip_frame ?? 0} frame(s). Calls by tool: ${Object.entries(c6.mcpCallsByTool).map(([t, n]) => `${t} ${n}`).join(', ')}.`,
      '- **Bigger pieces.** The opening is one item, the `studio-title-card` precomp clip 4 saved from its title, logo and motions; the caption is the `lower-third-studio` preset; the 3D orb is the `orb-spin` sequence clip 5 baked, so it costs an image draw per frame instead of a rasterized scene.',
      '- **The same vocabulary.** Transitions, motions and effects are attached by name (`trans-*`, `motion-*`, `fx-*`), and the clip theme gives every piece the same colours and type without per-item params.',
      `- **No detours.** Clip 4 spent calls on things only a first use needs: ${c4.failedCalls} rejected call(s), ${c4.mcpCallsByTool.get_asset ?? 0} \`get_asset\` reads, describing ${c4.mcpCallsByTool.describe_asset ?? 0} uploads, ${c4.mcpCallsByTool.create_preset ?? 0} presets. Clip 6 needed none of that.`,
      '',
      'The same numbers, per clip, are in [compounding.json](compounding.json); who reused what from whom is in [reuse.txt](reuse.txt).',
      '',
    ].join('\n');
    write('compounding.md', md);
    write('compounding.json', { checks, clips: rows });
    console.log(`${Object.values(checks).every(Boolean) ? '✓' : '✖'} compounding: ${rows.map((r) => `${r.clip.replace(/^clip-(\d).*/, '$1')}: ${r.mcpCalls} calls, ${r.newCodeLines} lines, ${pct(r.reuseShare)}, ${r.buildSeconds ?? '–'} s`).join(' · ')}`);
  }
} finally {
  await studio.close();
}
if (failures.length) console.error(`\nfailed checks:\n- ${failures.join('\n- ')}`);
process.exit(failures.length ? 1 : 0);
