// HTTP routes: share links (iteration 5). Where a clip can be shared from, and its export to a static folder
// (output/share/<slug>; the MCP tool and scripts/share.mjs can write elsewhere). The page itself (/share/<slug>,
// /share/<slug>/bundle.json) and the player's files (/player/) are served by http.js.

import { basename, dirname } from 'node:path';
import { shareOf } from '../../studio/share.js';

/** @param {any} api { studio, author, send, png, file, read, int } */
export default function routes({ studio, file }) {
  return [
    // one audio item of an interactive clip, for its live share page
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/sounds\/([A-Za-z0-9_-]+)$/, async ({ params, req, res }) => { const path = await shareOf(studio).soundFile(params[0], params[1]); file(req, res, dirname(path), basename(path)); }],
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/share$/, ({ params }) => shareOf(studio).info(params[0])],
    // body (all optional): { baseUrl: where the folder will be published (for link previews), posterAt: seconds, quality: 1–100 }
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/share$/, ({ params, data }) => shareOf(studio).exportClip(params[0], { baseUrl: data.baseUrl, posterAt: data.posterAt, quality: data.quality })],
  ];
}
