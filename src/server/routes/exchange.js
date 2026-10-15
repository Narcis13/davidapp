// HTTP routes: exchange (iteration 4).
//
//   GET  /api/clips/<slug>/export   what an export would write, and whether the clip's folder in the repo is up to date (a dry run)
//   POST /api/clips/<slug>/export   write the clip and its closure to the repo (body, all optional: { frames, force })

/** @param {any} api @returns {any[]} */
export default function routes(api) {
  const { studio } = api;
  return [
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/export$/, ({ params }) => studio.exchange.status(params[0])],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/export$/, ({ params, data }) => studio.exchange.exportClip(params[0], { frames: data?.frames, force: data?.force })],
  ];
}
