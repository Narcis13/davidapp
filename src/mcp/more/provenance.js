// MCP tools: provenance (iteration 4). Where a file asset came from and what may be done with it; the credits of a
// clip; whether a final render may go ahead.

import { fromArgs } from '../../studio/provenance.js';

export { fromArgs };

/** The optional inputs every tool that creates a file asset takes (spread into its input; a tool may replace `license`). @param {any} z */
export function provenanceInput(z) {
  return {
    license: z.string().optional().describe('Licence: an SPDX id such as "CC0-1.0", "CC-BY-4.0", "OFL-1.1", "Apache-2.0", "original" (made for this studio), or free text. Leave it out only when it is not known: the asset is then recorded with an unknown licence and a final render refuses it.'),
    license_url: z.string().optional().describe('Web address of the licence text'),
    source_url: z.string().optional().describe('Where the file came from (a web address)'),
    creator: z.string().optional().describe('Who made it'),
    credit: z.string().optional().describe('The credit line to print, e.g. "Photo: Jane Doe / Unsplash"'),
    date: z.string().optional().describe('ISO date it was made or obtained, e.g. 2025-03-14 (default: today)'),
    ai_generated: z.boolean().optional().describe('Made by a generative AI (listed separately in the credits)'),
    content_id: z.boolean().optional().describe('Registered with a content-ID system, so a platform may claim a video that uses it'),
    restrictions: z.string().optional().describe('Free text, e.g. "editorial use only"'),
    placeholder: z.boolean().optional().describe('A stand-in that must be replaced before a final render'),
    redistributable: z.boolean().optional().describe('May the file be committed to a public repo (default: yes for original, CC0, CC-BY, OFL, MIT, ISC, Apache; no when the licence is unknown)'),
  };
}

/** @param {any} api @returns {any[]} */
export default function tools(api) {
  const { studio, z } = api;
  const { provenance } = studio;
  return [
    {
      name: 'clip_credits',
      title: 'Credits and sources of a clip',
      description: 'The credits and sources of a clip, generated from everything it pins (every version in its closure, deps of deps, fonts, footage, narrations and their voices): { credits: [lines to print], sources: [{ ref, type, title, license, licenseUrl, sourceUrl, creator, credit, aiGenerated, contentId, restrictions }], problems, warnings }. problems are what stop a final render (a placeholder, a file with no licence); warnings are restrictions, content-ID material and voices with no recorded licence. format "markdown" also returns the Markdown a final render writes next to the MP4 (<name>.credits.md): grouped into footage, images, sound and music, voice and fonts, with AI-generated and content-ID material listed separately. The studio\'s own motion graphics and the bundled fonts appear once, briefly.',
      input: { clip: z.string(), format: z.enum(['json', 'markdown']).optional().describe('markdown adds the credits file') },
      readOnly: true,
      run: (a) => {
        const r = provenance.credits({ clip: a.clip, format: a.format });
        return a.format === 'markdown' ? { text: r.markdown, json: { credits: r.credits, sources: r.sources, problems: r.problems, warnings: r.warnings } } : { json: r };
      },
    },
    {
      name: 'check_provenance',
      title: 'Check a clip before a final render',
      description: 'What would stop a final render of the clip (start_render { final: true }), without rendering: every pinned asset that is a placeholder (flag or tag) or a file with no licence, each with what to do about it, and the warnings (restrictions, content ID). ready is true when nothing stops it.',
      input: { clip: z.string() },
      readOnly: true,
      run: (a) => ({ json: provenance.check({ clip: a.clip }) }),
    },
  ];
}
