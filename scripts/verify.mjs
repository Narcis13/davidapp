// Verify, through the MCP server, the two properties the showcase depends on:
//
//  1. Versioning holds. text-word-reveal was edited into v2 (for clip 2) after clip 1 was rendered.
//     Clip 1 still pins v1, so its frames today must hash the same as in its first render; a copy
//     of clip 1 re-pinned to v2 must differ exactly where the word reveal is on screen.
//  2. Rendering is deterministic. Rendering each showcase clip again gives the same sampled
//     frame hashes as its first render.
//
//   STUDIO_DATA=<dir with the showcase> node scripts/verify.mjs [reports-dir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool } from './mcp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'docs', 'showcase', 'reports');
mkdirSync(out, { recursive: true });

const CLIP = 'clip-1-every-frame', COPY = 'clip-1-repinned', ASSET = 'text-word-reveal';
const client = await connect({ author: 'verify-script' });
const call = async (name, args) => {
  const r = await callTool(client, name, args);
  if (r.isError) throw new Error(`${name}: ${r.text}`);
  return r.json;
};
let failed = false;
const check = (ok, message) => { console.log(`${ok ? '✓' : '✖'} ${message}`); if (!ok) failed = true; };

try {
  // ── 1. versioning ───────────────────────────────────────────────────────────────────────
  const asset = await call('get_asset', { ref: ASSET, include_source: false });
  const v2 = asset.versions.find((v) => v.version === 2);
  check(asset.version >= 2 && v2?.madeForClip === 'clip-2-compounding', `${ASSET} has a v2, made for ${v2?.madeForClip} (${v2?.note})`);
  const used = await call('list_clip_assets', { clip: CLIP });
  const pinned = used.assets.filter((a) => a.ref.startsWith(`${ASSET}@`)).map((a) => a.ref);
  check(pinned.length === 1 && pinned[0] === `${ASSET}@1`, `${CLIP} still pins ${pinned.join(', ')}`);

  const renders = (await call('list_renders', { clip: CLIP, status: 'done', limit: 100 })).renders;
  const first = renders[renders.length - 1];
  const comp = (await call('get_clip', { clip: CLIP })).composition;
  const fps = comp.fps;
  const frames = Object.keys(first.stats.frameHashes).map(Number);
  const times = frames.map((f) => f / fps);
  const now = await call('frame_hashes', { clip: CLIP, times });
  const same = now.frames.every((x) => x.hash === first.stats.frameHashes[x.frame]);
  check(same, `${CLIP}: ${frames.length} sampled frames drawn now hash the same as in render #${first.id}, made before ${ASSET}@2 existed`);

  const clips = (await call('list_clips', {})).clips;
  if (!clips.some((c) => c.slug === COPY)) await call('repin_clip', { clip: CLIP, name: COPY, only: [ASSET] });
  const copyAssets = (await call('list_clip_assets', { clip: COPY })).assets.filter((a) => a.direct && a.ref.startsWith(`${ASSET}@`)).map((a) => a.ref);
  check(copyAssets.includes(`${ASSET}@${asset.version}`), `${COPY} pins ${copyAssets.join(', ')} directly`);
  const item = comp.tracks.flatMap((t) => t.items).find((i) => i.asset === `${ASSET}@1`);
  // v2 changed how words arrive, so compare while they are arriving; once they have settled the
  // two versions draw the same thing, and outside the item nothing may differ at all
  const entrance = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((d) => Math.round((item.start + d) * fps) / fps);
  const compare = async (ts) => {
    const v1 = (await call('frame_hashes', { clip: CLIP, times: ts })).frames;
    const v2f = (await call('frame_hashes', { clip: COPY, times: ts })).frames;
    return v1.map((x, i) => ({ t: Math.round(x.t * 1000) / 1000, frame: x.frame, onScreen: x.t >= item.start && x.t < item.start + item.duration, v1: x.hash, v2: v2f[i].hash, changed: x.hash !== v2f[i].hash }));
  };
  const during = await compare(entrance);
  const rows = await compare(times);
  const outside = rows.filter((r) => !r.onScreen);
  check(during.every((r) => r.changed), `${COPY}: all ${during.length} frames sampled while the words arrive (${entrance[0].toFixed(2)}–${entrance[entrance.length - 1].toFixed(2)}s) differ from ${CLIP}`);
  check(outside.every((r) => !r.changed), `${COPY}: the ${outside.length} sampled frames outside that item are identical to ${CLIP}`);
  writeFileSync(join(out, 'versioning.json'), `${JSON.stringify({
    asset: ASSET, editedVia: 'MCP update_asset', versions: asset.versions.map((v) => ({ ref: v.ref, madeForClip: v.madeForClip, note: v.note })),
    clip: CLIP, pins: pinned, firstRender: first.id, framesCompared: frames.length, unchangedAfterEdit: same,
    repinnedCopy: COPY, repinnedPins: copyAssets, item: { id: item.id, start: item.start, duration: item.duration }, framesWhileWordsArrive: during, sampledFrames: rows,
  }, null, 1)}\n`);

  // ── 2. determinism ──────────────────────────────────────────────────────────────────────
  const determinism = [];
  for (const clip of clips.filter((c) => !c.remixedFrom).map((c) => c.slug)) {
    const done = (await call('list_renders', { clip, status: 'done', limit: 100 })).renders;
    const a = done[done.length - 1];
    const b = await call('start_render', { clip, wait_seconds: 900 });
    const keys = Object.keys(a.stats.frameHashes);
    const equal = b.status === 'done' && keys.length === Object.keys(b.stats.frameHashes).length && keys.every((k) => a.stats.frameHashes[k] === b.stats.frameHashes[k]);
    check(equal, `${clip}: render #${b.id} matches render #${a.id} on all ${keys.length} sampled frame hashes`);
    determinism.push({ clip, renders: [a.id, b.id], sampledFrames: keys.map(Number), identical: equal, hashes: a.stats.frameHashes, ffmpegLog: b.log ?? '' });
  }
  writeFileSync(join(out, 'determinism.json'), `${JSON.stringify(determinism, null, 1)}\n`);
} catch (e) {
  console.error(`✖ ${e.message}`);
  failed = true;
} finally {
  await client.close();
}
console.log(failed ? '\nverification FAILED' : `\nverified; reports in ${out}`);
process.exit(failed ? 1 : 0);
