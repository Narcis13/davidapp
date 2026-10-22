// The manual's pages, in reading order. Each slug has a template in templates/pages/<slug>.faqir that
// holds the page's body; the layout draws the title, the summary, the navigation and the page's contents.

/** @typedef {{ slug: string, title: string, summary: string }} Page */

/** @type {{ title: string, pages: Page[] }[]} */
export const GROUPS = [
  {
    title: 'Start here',
    pages: [
      { slug: 'index', title: 'Welcome to Fablecut', summary: 'What Fablecut is, what it is good at, and how this manual is laid out.' },
      { slug: 'install', title: 'Install and run', summary: 'What you need on your computer, the three commands that start the studio, and where your work is kept.' },
      { slug: 'concepts', title: 'The big ideas', summary: 'Assets, versions, clips, pinning and the library that grows with every clip: the five ideas everything else builds on.' },
      { slug: 'first-clip', title: 'Your first clip', summary: 'A guided walk from an empty clip to a rendered MP4, first by hand in the studio, then by asking Claude.' },
    ],
  },
  {
    title: 'The studio',
    pages: [
      { slug: 'library', title: 'The library', summary: 'Finding, filtering, favouriting and organising assets, and adding your own pictures, videos and fonts.' },
      { slug: 'playground', title: 'The playground', summary: 'One asset on its own: preview it, tune its parameters, keep a tweak, read and edit its code.' },
      { slug: 'editor', title: 'The clip editor', summary: 'The preview, the timeline, the inspector and the side panels where a clip is put together.' },
      { slug: 'shortcuts', title: 'Keyboard and mouse', summary: 'Every shortcut, drag and modifier key in the studio, on one page.' },
      { slug: 'agent', title: 'Ask the agent', summary: 'Ask for a change in plain words, get a proposal, compare it with what you have and accept it.' },
      { slug: 'renders', title: 'Render, gallery and lineage', summary: 'Turning a clip into an MP4, following the queue, and looking at what was made and what was reused.' },
    ],
  },
  {
    title: 'Making videos',
    pages: [
      { slug: 'compositions', title: 'How a clip is built', summary: 'Tracks, items, layout, keyframes, formats, motions, effects, transitions, masks and markers, as the studio stores them.' },
      { slug: 'assets', title: 'Writing assets', summary: 'The contract every asset follows: one pure function of time, its parameters, its kinds and the tools it gets.' },
      { slug: 'media', title: 'Pictures, video and fonts', summary: 'Uploading images and SVG logos, adding footage and screen recordings, baking sequences and adding fonts.' },
      { slug: 'sound', title: 'Sound, voice and captions', summary: 'Music, narration with word times, captions built from the words, ducking and a loudness target.' },
      { slug: 'quality', title: 'Checks and quality', summary: 'What the studio measures before and after a render, and how to read and fix what it finds.' },
      { slug: 'provenance', title: 'Licences and credits', summary: 'Where every file came from, what stops a final render, and the credits written next to the video.' },
      { slug: 'repo', title: 'Clips in the repo', summary: 'Writing a finished clip to the repository and rebuilding it in any library, with the same frames.' },
    ],
  },
  {
    title: 'Share and play',
    pages: [
      { slug: 'share', title: 'Share a clip as a link', summary: 'A page that plays any clip in the viewer\'s browser: the live link, a folder you can publish anywhere, and what the viewer sees.' },
      { slug: 'interactive', title: 'Interactive clips', summary: 'Clips that are played, not watched: scenes, variables and wires, playing one in the editor, and the checks that crawl its states.' },
    ],
  },
  {
    title: 'Working with Claude',
    pages: [
      { slug: 'claude', title: 'Claude Code and the studio', summary: 'How Claude drives the studio over MCP, what to ask for, and how to work the request queue.' },
      { slug: 'mcp-tools', title: 'MCP tool reference', summary: 'Every tool the studio offers Claude, with its parameters, read from the running studio.' },
    ],
  },
  {
    title: 'Reference',
    pages: [
      { slug: 'config', title: 'Settings and folders', summary: 'Environment variables, the data directory, and where every kind of file lives in the repository.' },
      { slug: 'scripts', title: 'Commands and scripts', summary: 'The npm scripts and the command-line tools for building, checking and measuring.' },
      { slug: 'troubleshooting', title: 'Troubleshooting and FAQ', summary: 'Common problems, what causes them and how to fix them.' },
      { slug: 'glossary', title: 'Glossary', summary: 'The words this manual and the studio use, in one place.' },
    ],
  },
];

/** Every page, in reading order, with its group. */
export const PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.title })));

/** The URL of a page. @param {string} slug */
export const hrefOf = (slug) => (slug === 'index' ? '/docs' : `/docs/${slug}`);
