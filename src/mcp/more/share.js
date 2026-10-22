// MCP tools: share links (iteration 5). A clip as a web page that plays it in any browser: served by the studio, or
// exported to a folder any static server can host.

import { shareOf } from '../../studio/share.js';

/** @param {any} api { studio, who, image, z, REF, PARAMS, AUTHOR, FORMAT, COMPOSITION, compactAsset, compactRender } */
export default function tools(api) {
  const { studio, z } = api;
  return [
    {
      name: 'share_clip',
      title: 'Share a clip as a web page',
      description: 'Make a clip shareable as a link: a web page that plays it in the viewer\'s browser (phone or desktop) with its own player, drawn on canvas by the clip\'s own asset code (the renderer\'s runtime in a worker): no MP4, no embed. The studio already serves it at /share/<clip> (studioUrl). This writes the static export: one self-contained folder (index.html, bundle.json, player/, core/, media/: the fonts the clip names, its images, the footage frames it shows as WebP, its mix as AAC, a poster and a 1200×630 link-preview card) that plays from any static server under any path, with the studio stopped; every URL in it is relative and nothing loads from elsewhere. It is never published: copy the folder to a host yourself. base_url (where it will be published) only makes the og:image and og:url tags absolute, which WhatsApp and other link previews need. Writing again replaces what an earlier export wrote in the same folder and keeps anything else there (a CNAME, a .git folder); a non-empty folder that holds no earlier export is refused. The new export is built next to the folder and moved in only when it is complete, so a failed export leaves the last one as it was. Returns the folder, its total bytes with a breakdown (footage is usually most of it), and the footage frames shown and kept.',
      input: {
        clip: z.string().describe('Clip name'),
        base_url: z.string().optional().describe('Where the folder will be published, such as https://example.com/clips/my-clip/ (only for the link-preview tags)'),
        out: z.string().optional().describe('Folder to write (absolute path); default output/share/<clip> in the repo'),
        poster_at: z.number().optional().describe('The poster frame\'s time in seconds (default 40% in, as a render\'s poster)'),
        quality: z.number().int().min(1).max(100).optional().describe('WebP quality of the footage frames (default 80; 90 is sharper and about a third larger)'),
      },
      run: async (a) => {
        const r = await shareOf(studio).exportClip(a.clip, { out: a.out, baseUrl: a.base_url, posterAt: a.poster_at, quality: a.quality });
        const port = process.env.PORT ?? 8787;
        return {
          json: {
            ...r, studioUrl: `http://127.0.0.1:${port}${r.studioPath}`,
            next: `Check it with the studio stopped: node scripts/serve-static.mjs "${r.dir}" and open the address it prints. To publish, copy the folder to any static host${r.url ? ` at ${r.url}` : ' (pass base_url for link previews)'}.`,
          },
        };
      },
    },
  ];
}
