// HTTP routes: fonts (iteration 4).
//
//   POST /api/fonts?name=acme-sans&license=OFL-1.1[&family=&weight=&style=&title=&description=&tags=a,b&source=&author=&note=]
//        and, as for any file asset: &license_url=&source_url=&creator=&credit=&date=&ai_generated=&content_id=&restrictions=&placeholder=&redistributable=
//        the font file as the raw request body (Content-Type font/ttf, font/otf, font/woff2 or application/octet-stream)
//   GET  /api/fonts   the families a font parameter can name, bundled and uploaded

import { MAX_FONT_BYTES, coverageSummary } from '../../studio/fonts.js';
import { StudioError } from '../../studio/library.js';
import { fromQuery } from '../../studio/provenance.js';

// Not JSON on purpose, like image uploads: a page on another site cannot send a font/* body without a CORS preflight.
const TYPES = /^(font\/(ttf|otf|sfnt|woff2)|application\/(octet-stream|font-sfnt|x-font-ttf|x-font-otf|font-woff2|vnd\.ms-opentype))$/;

/** @param {any} api @returns {any[]} */
export default function routes(api) {
  const { studio, author, read } = api;
  return [
    ['GET', /^\/api\/fonts$/, () => ({ fonts: studio.fonts.listFonts() })],
    ['POST', /^\/api\/fonts$/, async ({ req }) => {
      const url = new URL(req.url, 'http://localhost');
      const type = String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
      if (type && !TYPES.test(type)) throw new StudioError('Send one TTF, OTF or WOFF2 file as the request body, with Content-Type font/ttf, font/otf, font/woff2 or application/octet-stream', 'unsupported');
      const q = (k) => url.searchParams.get(k) || undefined;
      const chunks = await read(req, MAX_FONT_BYTES, `The font file is larger than ${MAX_FONT_BYTES / 1e6} MB`);
      const weight = q('weight');
      const r = await studio.fonts.addFont({
        name: q('name'), data: Buffer.concat(chunks), originalName: q('file'), license: q('license'), family: q('family'),
        weight: weight === undefined ? undefined : Number(weight), style: q('style'), title: q('title'), description: q('description'),
        tags: q('tags')?.split(',').map((t) => t.trim()).filter(Boolean), source: q('source'), provenance: fromQuery(url.searchParams), note: q('note'), author: q('author') ?? author,
      });
      return { asset: r.asset, coverage: coverageSummary(r.asset.meta.coverage), thumb: `/media/${r.asset.thumb}`, file: `/media/${r.asset.file}` };
    }, { raw: true }],
  ];
}
