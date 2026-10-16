// Refuse a commit that carries media: stills, sheets, voice samples, renders. Git holds code (clips/, assets/,
// work/*/NOTES.md, …) and the asset store (library/: fonts, logos and uploads a clip needs to re-render); every
// other picture, sound or video stays on disk. Run from the repo root after `git add`, before `git commit`.
//
//   node .claude/skills/new-video/scripts/check-no-media.mjs           # staged files
//   node .claude/skills/new-video/scripts/check-no-media.mjs --all     # every tracked and staged file
//
// Exit 1 lists the offenders and the `git rm --cached` that unstages them (the files stay on disk).

import { execFileSync } from 'node:child_process';

const MEDIA = /\.(png|jpe?g|gif|webp|bmp|tiff?|wav|mp3|m4a|aac|ogg|flac|mp4|mov|webm|mkv|avi)$/i;
const ALLOWED = [/^library\//, /^assets\//];

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);
const files = process.argv.includes('--all')
  ? git('ls-files')
  : git('diff', '--cached', '--name-only', '--diff-filter=ACMR');
const bad = files.filter((f) => MEDIA.test(f) && !ALLOWED.some((r) => r.test(f)));

if (!bad.length) { console.log(`No media ${process.argv.includes('--all') ? 'tracked' : 'staged'} outside library/ and assets/.`); process.exit(0); }
console.error(`${bad.length} media file(s) would go into git:\n${bad.map((f) => `  ${f}`).join('\n')}`);
console.error(`\nUnstage them (they stay on disk) and make sure .gitignore covers them:\n  git rm --cached -q -- ${bad.map((f) => JSON.stringify(f)).join(' ')}`);
process.exit(1);
