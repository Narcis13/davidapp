// Copy the open-licensed font files the studio ships with from their @fontsource packages into
// fonts/, with each family's license next to them, and write fonts/fonts.json.
//   node scripts/vendor-fonts.mjs
import { copyFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAMILIES = [
  { family: 'Inter', pkg: 'inter', faces: [[400, 'normal'], [600, 'normal'], [800, 'normal']], tags: ['sans', 'ui', 'body'] },
  { family: 'Space Grotesk', pkg: 'space-grotesk', faces: [[400, 'normal'], [700, 'normal']], tags: ['sans', 'display', 'geometric'] },
  { family: 'JetBrains Mono', pkg: 'jetbrains-mono', faces: [[400, 'normal'], [700, 'normal']], tags: ['mono', 'code'] },
  { family: 'Anton', pkg: 'anton', faces: [[400, 'normal']], tags: ['display', 'condensed', 'impact'] },
  { family: 'Playfair Display', pkg: 'playfair-display', faces: [[700, 'normal'], [900, 'normal'], [700, 'italic']], tags: ['serif', 'display', 'editorial'] },
];

mkdirSync(join(root, 'fonts/licenses'), { recursive: true });
const manifest = [];
for (const f of FAMILIES) {
  const dir = join(root, 'node_modules/@fontsource', f.pkg);
  const license = `licenses/${f.pkg}-LICENSE.txt`;
  copyFileSync(join(dir, 'LICENSE'), join(root, 'fonts', license));
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = [];
  for (const [weight, style] of f.faces) {
    const name = `${f.pkg}-latin-${weight}-${style}.woff2`;
    const src = join(dir, 'files', name);
    if (!existsSync(src)) throw new Error(`missing ${src}`);
    copyFileSync(src, join(root, 'fonts', name));
    files.push({ file: name, weight, style });
  }
  manifest.push({ family: f.family, slug: `font-${f.pkg}`, tags: f.tags, license: 'OFL-1.1', licenseFile: license, source: `@fontsource/${f.pkg}@${pkg.version}`, files });
}
writeFileSync(join(root, 'fonts/fonts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`fonts: ${manifest.length} families, ${manifest.reduce((n, m) => n + m.files.length, 0)} files`);
