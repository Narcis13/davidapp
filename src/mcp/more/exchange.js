// MCP tools: exchange (iteration 4). A clip leaves the library for the repo with everything it needs, and comes back into any library.

/** @param {any} api @returns {any[]} */
export default function tools(api) {
  const { studio, who, z } = api;
  return [
    {
      name: 'export_clip',
      title: 'Write a clip to the repo',
      description: 'Write a clip to its folder in the repo (clips/<clip>/clip.json) with its closure: every asset version it pins (with its number, so versions 2 and 4 stay 2 and 4), presets, precomps, fonts, footage, narrations and uploads, kept once for every clip in the repo\'s content store (library/versions, library/sources, library/files by SHA-256). clip.json also holds the composition as saved and the hashes of up to 48 frames drawn now, so an import can check itself. Files that may not be redistributed (provenance redistributable: false) or are over 50 MB are listed by SHA-256 with their licence and source and not copied; baked sequences go as their recipe; bundled fonts are listed. Nothing is ever deleted from the store, and exporting an unchanged clip changes no file. A ref the store already has with different content stops the export (conflicts), unless force. dry_run: only say what would be written and whether the folder is up to date. The repo is this checkout, or STUDIO_REPO.',
      input: {
        clip: z.string().describe('Clip name'),
        dry_run: z.boolean().optional().describe('Write nothing and draw nothing: report what an export would change, and whether the folder is up to date'),
        frames: z.boolean().optional().describe('Draw the check frames (default true; false keeps the hashes already in clip.json when they still apply)'),
        force: z.boolean().optional().describe('Replace the store\'s record of a ref that has different content there'),
      },
      run: async (a) => ({ json: await studio.exchange.exportClip(a.clip, { dryRun: a.dry_run, frames: a.frames, force: a.force }) }),
    },
    {
      name: 'import_clip',
      title: 'Create a clip from its folder in the repo',
      description: 'Create the clip of an exported folder (clips/<name>, the one with clip.json) in this library: every version of its closure is made with its exact number, in dependency order (versions the library already has with the same content are reused), then the clip with the exported composition, so the refs are the same and so are the frames. A version that exists here with other content is a conflict: all conflicts and every missing file are listed and nothing is written. Files kept out of git (external) are looked up by SHA-256 in the folders given as files; a missing one is named with its licence and source. Function versions are compiled and drawn by the render workers; images, footage and fonts get their thumbnails; baked sequences are baked again from their recipe. verify: draw the check frames and compare them with the export\'s (the result says which differ; emoji and some fonts draw per operating system, so compare on the machine that exported). replace: update the clip when it exists.',
      input: {
        folder: z.string().describe('Absolute path of the clip\'s folder in a repo (clips/<name>); the repo must have library/'),
        files: z.array(z.string()).optional().describe('Folders to look in for external files, by SHA-256 (whatever the files are called)'),
        replace: z.boolean().optional().describe('Update the clip when it already exists'),
        verify: z.boolean().optional().describe('Draw the check frames and compare them'),
        author: z.string().optional().describe('Recorded as the clip\'s author (default: the server\'s STUDIO_AUTHOR)'),
      },
      run: async (a) => ({ json: await studio.exchange.importClip(a.folder, { files: a.files, replace: a.replace, verify: a.verify, author: who(a.author) }) }),
    },
  ];
}
