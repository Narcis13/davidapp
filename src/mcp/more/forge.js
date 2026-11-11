// MCP tools: the forge. Assets made ahead of the clips that will use them: written as candidates (create_asset,
// fork_asset, create_preset with candidate: true), checked alone in every format (check_asset), tried under several
// parameter sets (asset_variants), then promoted into the library or rejected with a reason.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../../render/host.js';
import { CHECKS } from '../../studio/checks.js';
import { ASSET_CHECKS, MAX_VARIANTS } from '../../studio/forge.js';

/** @param {any} api { studio, who, image, z, REF, PARAMS, AUTHOR, FORMAT, COMPOSITION, compactAsset, compactRender } */
export default function tools(api) {
  const { studio, who, z, REF, PARAMS, AUTHOR, FORMAT, compactAsset } = api;
  return [
    {
      name: 'check_asset',
      title: 'Check an asset on its own',
      description: `The checks a clip gets, run on one visual asset placed alone on a frame of each format (default: the formats it declares, else all three), over its natural duration, with the params given (default: its defaults). Default checks: ${ASSET_CHECKS.join(', ')} (text outside the safe zone or cut by the frame, text boxes that overlap, text under the size floor, contrast under 4.5:1 against the worst pixels behind it, characters the fonts lack); the first and last frame, the hold and the captions are about a clip, so only: [...] asks for them. pass: no error in any format. The result is kept on the version (get_asset shows it as checked), and promote_asset needs a passing check of the latest version. Each issue has its format, time, numbers and a still. Motions, transitions, effects, values and audio change or feed something else, so a clip checks them (check_clip).`,
      input: {
        ref: REF,
        params: PARAMS.optional().describe('Check with these params (default: the asset\'s defaults). Long text, a light colour: check the params a clip will push it to.'),
        formats: z.array(FORMAT).min(1).max(3).optional().describe('Default: the formats the asset declares, else all three'),
        duration: z.number().positive().max(120).optional().describe('Seconds (default: its natural duration, else 3)'),
        step: z.number().min(0.04).max(5).optional().describe('Seconds between sampled frames (default: a twelfth of the duration, 0.1–0.5)'),
        only: z.array(z.enum(/** @type {[string, ...string[]]} */ (CHECKS))).min(1).optional().describe(`Run these checks instead (default ${ASSET_CHECKS.join(', ')})`),
        background: z.string().optional().describe('The ground it is checked on (default #101018, the library\'s dark ground); contrast is measured against it'),
        stills: z.boolean().optional().describe('Default true'),
      },
      run: async (a) => {
        const r = await studio.forge.checkAsset({ ref: a.ref, params: a.params, formats: a.formats, duration: a.duration, step: a.step, only: a.only, background: a.background, stills: a.stills !== false });
        const next = r.pass
          ? (r.stage === 'candidate' ? `It passes. promote_asset { name: "${r.asset.split('@')[0]}" } puts it in the library.` : 'It passes.')
          : 'Fix what is listed with update_asset (a new version), then check again.';
        return { json: { ...r, next } };
      },
    },
    {
      name: 'asset_variants',
      title: 'Try an asset under several parameter sets',
      description: `One visual asset drawn under several parameter sets or random seeds, as one labelled grid: a row per variant (its number and what it changes), a few frames across its duration in each (frames, default 4), or the one frame at t. Give variants (a list of parameter sets, or { params, seed }), vary ({ param: [values] }: each value tried, crossed with the other varied params and with each variant), seeds (each variant tried with each seed), or several of them; at most ${MAX_VARIANTS} in all. Nothing is saved: keep a look you like with create_preset { base, name, params } (cheaper than new code), or save_defaults when it should be the asset's own default.`,
      input: {
        ref: REF,
        variants: z.array(z.record(z.string(), z.any())).max(MAX_VARIANTS).optional().describe('Parameter sets, each a set of params or { params, seed }'),
        vary: z.record(z.string(), z.array(z.any()).min(1)).optional().describe('{ param: [values] }: each value tried, crossed with the rest'),
        seeds: z.array(z.number().int().min(0)).max(MAX_VARIANTS).optional().describe('Random seeds to try each variant with'),
        frames: z.number().int().min(1).max(8).optional().describe('Frames across the duration in each row (default 4)'),
        t: z.number().min(0).optional().describe('Draw the one frame at this time instead'),
        format: FORMAT.optional(),
        duration: z.number().positive().optional(),
        background: z.string().optional().describe('Default #101018'),
      },
      readOnly: true,
      run: async (a) => {
        const r = await studio.forge.variants({ ref: a.ref, variants: a.variants, vary: a.vary, seeds: a.seeds, frames: a.frames, t: a.t, format: a.format, duration: a.duration, background: a.background });
        return { json: { asset: r.asset, variants: r.variants, times: r.times, next: `Keep a look: create_preset { base: "${r.asset}", name, params } (candidate: true while forging).` }, images: [{ png: r.png, path: r.path }] };
      },
    },
    {
      name: 'promote_asset',
      title: 'Promote a forge candidate into the library',
      description: 'Put a candidate (or a rejected asset) into the library: search_assets and suggest_assets list it from now on. A visual asset needs a passing check_asset of its latest version; force: true with a reason promotes it anyway (the reason is kept as a note). Motions, transitions, effects, values and audio are not checked on their own. A clip that uses a candidate promotes it too.',
      input: {
        name: z.string().describe('Asset name'),
        force: z.boolean().optional().describe('Promote without a passing check (give a reason)'),
        reason: z.string().optional().describe('Why (needed with force; kept as a note)'),
        author: AUTHOR,
      },
      run: (a) => {
        const r = studio.library.promote({ slug: a.name, author: who(a.author), force: !!a.force, reason: a.reason });
        return { json: { promoted: compactAsset(r.asset), from: r.from, checked: r.checked } };
      },
    },
    {
      name: 'reject_asset',
      title: 'Reject a forge candidate',
      description: 'Take a candidate out of the forge: it is kept (versions are never deleted) but listed only by search_assets { stage: "rejected" }. The reason is kept as a note on it, so the next forge run reads why and does not make the same thing again. Only a candidate is rejected; a library asset is improved with update_asset.',
      input: {
        name: z.string().describe('Asset name'),
        reason: z.string().min(4).describe('What is wrong with it'),
        author: AUTHOR,
      },
      run: (a) => {
        const r = studio.library.rejectCandidate({ slug: a.name, author: who(a.author), reason: a.reason });
        return { json: { rejected: compactAsset(r.asset) } };
      },
    },
    {
      name: 'list_candidates',
      title: 'List forge candidates',
      description: 'The forge\'s queue: every candidate (or, with stage, the rejected ones) with its last check (pass, errors, formats, params) and its notes, newest first, and a contact sheet of their thumbnails. A candidate with no check yet says checked: null.',
      input: {
        stage: z.enum(['candidate', 'rejected']).optional().describe('Default candidate'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 40'),
      },
      readOnly: true,
      run: async (a) => {
        const r = studio.library.search({ stage: a.stage ?? 'candidate', sort: 'newest', limit: a.limit ?? 40 });
        const list = r.assets.map((x) => ({ ...compactAsset(x), stage: x.stage, checked: x.checked, notes: studio.compounding.notesOf(x.slug).slice(-3).map((n) => n.body) }));
        const thumbs = r.assets.filter((x) => x.thumb).slice(0, 24);
        const images = thumbs.length ? [api.image(`candidates-${Date.now().toString(36)}`, await sheetOf(studio, thumbs))] : [];
        return { json: { total: r.total, candidates: list }, images };
      },
    },
  ];
}

/** Thumbnails in a numbered grid (the numbers follow the list). */
async function sheetOf(studio, list) {
  const cols = 4, cw = 240, ch = 135, pad = 6;
  const c = createCanvas(cols * (cw + pad) + pad, Math.ceil(list.length / cols) * (ch + pad) + pad);
  const g = c.getContext('2d');
  g.fillStyle = '#16161d';
  g.fillRect(0, 0, c.width, c.height);
  for (const [i, s] of list.entries()) {
    const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + pad);
    try { const img = await loadImage(readFileSync(join(studio.dataDir, s.thumb))); const k = Math.min(cw / img.width, ch / img.height); g.drawImage(img, x + (cw - img.width * k) / 2, y + (ch - img.height * k) / 2, img.width * k, img.height * k); } catch { /* no thumbnail */ }
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(x, y + ch - 22, cw, 22);
    g.fillStyle = s.checked?.pass === false ? '#ff8a8a' : '#ffffff';
    g.font = '600 13px "JetBrains Mono"';
    g.fillText(`${i + 1} ${s.ref}`.slice(0, 30), x + 6, y + ch - 7);
  }
  return c.toBuffer('image/png');
}
