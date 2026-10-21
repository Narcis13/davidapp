// HTTP routes: share links (iteration 5). Where a clip can be shared from, and its export to a static folder
// (output/share/<slug>; the MCP tool and scripts/share.mjs can write elsewhere). The page itself (/share/<slug>,
// /share/<slug>/bundle.json) and the player's files (/player/) are served by http.js.

import { shareOf } from '../../studio/share.js';

/** @param {any} api { studio, author, send, png, file, read, int } */
export default function routes({ studio }) {
  return [
    ['GET', /^\/api\/clips\/([a-z0-9-]+)\/share$/, ({ params }) => shareOf(studio).info(params[0])],
    // body (all optional): { baseUrl: where the folder will be published (for link previews), posterAt: seconds, quality: 1–100 }
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/share$/, ({ params, data }) => shareOf(studio).exportClip(params[0], { baseUrl: data.baseUrl, posterAt: data.posterAt, quality: data.quality })],
  ];
}
