// HTTP routes: provenance (iteration 4).
//
//   GET /api/clips/<slug>/credits[?format=markdown|md]
//        { credits: [lines], sources: [{ ref, type, title, license, licenseUrl, sourceUrl, creator, credit, aiGenerated, contentId, restrictions, … }], problems, warnings };
//        format=markdown adds `markdown` (the file a final render writes); format=md answers with the Markdown itself (text/markdown)
//   GET /api/clips/<slug>/provenance
//        { clip, ready, problems, warnings }: what would stop a final render of the clip
//
// The rest of the feature sits in routes that exist: a file asset's provenance is in GET /api/assets/<ref> (`provenance`), set on
// upload with query parameters (POST /api/uploads, /api/footage, /api/fonts: license, license_url, source_url, creator, credit,
// date, ai_generated, content_id, restrictions, placeholder, redistributable), edited with PUT /api/assets/<slug>/metadata
// { provenance: { … }, version? }, and a final render is POST /api/clips/<slug>/render { final: true }.

import { StudioError } from '../../studio/library.js';

/** @param {any} api @returns {any[]} */
export default function routes(api) {
  const { studio, send } = api;
  return [
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/credits$/, ({ params, query, res }) => {
      const format = query.get('format') ?? 'json';
      if (!['json', 'markdown', 'md'].includes(format)) throw new StudioError(`format is json, markdown or md; got "${format}"`);
      const r = studio.provenance.credits({ clip: params[0], format: format === 'json' ? 'json' : 'markdown' });
      if (format === 'md') return send(res, 200, r.markdown, { 'content-type': 'text/markdown; charset=utf-8' });
      return r;
    }],
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/provenance$/, ({ params }) => studio.provenance.check({ clip: params[0] })],
  ];
}
