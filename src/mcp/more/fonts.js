// MCP tools: fonts (iteration 4). A font file becomes a library asset with its licence, family, weight, style and coverage.

import { readFileSync } from 'node:fs';
import { coverageSummary } from '../../studio/fonts.js';

/** @param {any} api @returns {any[]} */
export default function tools(api) {
  const { studio, who, z, AUTHOR } = api;
  return [
    {
      name: 'add_font',
      title: 'Add a font file',
      description: 'Add a TTF, OTF or WOFF2 file to the library as a font asset (type "font"), or a new version of one that exists. The family, weight and style are read from the file (override them with family, weight, style); a licence is required ("OFL-1.1", "Apache-2.0", "commercial, licensed to us"; license_file keeps the licence text with the font). The file\'s coverage is read: how many characters, which Unicode blocks, and whether it covers Latin Extended-A. A thumbnail is drawn with the font itself. It works at once, in the preview and in renders, no restart: name the family in any parameter of type "font". A clip pins the font assets of the family when it is saved, so it keeps the files it was made with when you add a new version; repin_clip moves it to the newest. Several weights of one family are several font assets with the same family (acme-sans, acme-sans-bold). A family name a bundled font already uses (Inter, Playfair Display, …) is refused. Text drawn with a raw ctx.font string, not through f.lib.text, does not use pinned fonts.',
      input: {
        path: z.string().describe('Absolute path of the font file (at most 25 MB)'),
        name: z.string().describe('Asset name: lowercase letters, digits and dashes, e.g. "acme-sans" or "acme-sans-bold". An existing font asset gets a new version.'),
        license: z.string().describe('The licence, as short text: "OFL-1.1", "Apache-2.0", "commercial, licensed to us"'),
        family: z.string().optional().describe('Family name; default: the one in the file'),
        weight: z.number().int().min(1).max(1000).optional().describe('400 regular, 700 bold; default: the file\'s'),
        style: z.enum(['normal', 'italic']).optional().describe('Default: the file\'s'),
        title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(),
        source: z.string().optional().describe('Where the font came from (a URL)'),
        license_file: z.string().optional().describe('Absolute path of the licence text to keep with the font'),
        note: z.string().optional().describe('What is new in this version'),
        author: AUTHOR,
      },
      run: async (a) => {
        const r = await studio.fonts.addFont({ name: a.name, path: a.path, license: a.license, licenseFile: a.license_file, family: a.family, weight: a.weight, style: a.style, title: a.title, description: a.description, tags: a.tags, source: a.source, note: a.note, author: who(a.author) });
        const m = r.asset.meta;
        return {
          json: { added: r.asset.ref, version: r.asset.version, family: m.family, weight: m.weight, style: m.style, license: m.license, licenseFile: m.licenseFile, format: m.format, bytes: m.bytes, sha256: m.sha256, coverage: coverageSummary(m.coverage), use: `Name "${m.family}" in a font parameter of an asset in a clip; saving the clip pins ${r.asset.ref}.` },
          images: [{ png: readFileSync(r.thumbPath), path: r.thumbPath }],
        };
      },
    },
    {
      name: 'list_fonts',
      title: 'List the fonts',
      description: 'Every font family a font parameter can name: the ones bundled with the studio and the uploaded ones, with their weights and styles, licences, asset refs and (uploaded) coverage.',
      input: {},
      readOnly: true,
      run: () => ({ json: { fonts: studio.fonts.listFonts() } }),
    },
  ];
}
