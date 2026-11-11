// HTTP routes: the forge (assets made ahead of the clips that will use them).
//
//   POST /api/assets/<ref>/check     { params?, formats?, duration?, step?, only?, background?, stills? }
//        check_asset: { asset, stage, pass, errors, warnings, formats: [{ format, pass, errors, warnings, issues, counts }], … },
//        kept on the version (the asset's `checked`)
//   POST /api/assets/<ref>/variants  { variants?, vary?, seeds?, frames?, t?, format?, duration?, background? }
//        asset_variants: { asset, variants: [{ n, params, seed, label }], times, image: a data: URL of the grid (PNG) }
//   POST /api/assets/<slug>/promote  { force?, reason? }   a candidate into the library (needs a passing check, or force)
//   POST /api/assets/<slug>/reject   { reason }            a candidate out of the forge, the reason kept as a note
//
// Candidates are listed by GET /api/assets?stage=candidate (or candidates=1); stage=rejected and stage=all as well. A
// candidate is created like any asset (POST /api/assets, /fork, /preset) with { candidate: true }.

/** @param {any} api @returns {any[]} */
export default function routes(api) {
  const { studio, author } = api;
  const REF = '([a-z0-9-]+(?:@\\d+)?)';
  return [
    ['POST', new RegExp(`^/api/assets/${REF}/check$`), ({ params, data }) => studio.forge.checkAsset({ ref: params[0], params: data.params, formats: data.formats, duration: data.duration, step: data.step, only: data.only, background: data.background, stills: data.stills !== false })],
    ['POST', new RegExp(`^/api/assets/${REF}/variants$`), async ({ params, data }) => {
      const r = await studio.forge.variants({ ref: params[0], variants: data.variants, vary: data.vary, seeds: data.seeds, frames: data.frames, t: data.t, format: data.format, duration: data.duration, background: data.background });
      return { asset: r.asset, variants: r.variants, times: r.times, image: `data:image/png;base64,${r.png.toString('base64')}` };
    }],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/promote$/, ({ params, data }) => studio.library.promote({ slug: params[0], author: data.author ?? author, force: !!data.force, reason: data.reason })],
    ['POST', /^\/api\/assets\/([a-z0-9-]+)\/reject$/, ({ params, data }) => studio.library.rejectCandidate({ slug: params[0], author: data.author ?? author, reason: data.reason })],
  ];
}
