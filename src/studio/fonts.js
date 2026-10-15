// Font files as library assets: a TTF, OTF or WOFF2 with its licence becomes a versioned `font` asset whose
// family, weight, style and coverage are read from the file. A clip pins the font assets of the uploaded
// families it uses (composition.fonts, see clips.prepare), so it keeps the files it was made with after the
// font gets a new version. The read side (families, pins, the sets a worker registers) is in library.js.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { GlobalFonts } from '@napi-rs/canvas';
import { ENGINE_VERSION, makeRef } from '../core/engine.js';
import { createCanvas, fontManifest } from '../render/host.js';
import { parseFont, summarizeCoverage } from '../render/glyphs.js';
import { json, now, transaction } from '../db/db.js';
import { SLUG_RE, StudioError, renameRetry, tempOf } from './library.js';

export const MAX_FONT_BYTES = 25e6;
const MAX_LICENSE_FILE = 200_000;
const FORMATS = { ttf: { ext: '.ttf', mime: 'font/ttf' }, otf: { ext: '.otf', mime: 'font/otf' }, woff2: { ext: '.woff2', mime: 'font/woff2' } };
const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
const weightName = (w) => WEIGHT_NAMES[w] ?? WEIGHT_NAMES[Math.round(w / 100) * 100] ?? String(w);

/** What a coverage record says in a line or two: the count, the blocks it fills, and the two questions people ask. */
export function coverageSummary(c) {
  if (!c) return null;
  return {
    codepoints: c.codepoints,
    blocks: c.blocks.map((b) => `${b.name} ${b.covered}/${b.total}`),
    latinExtendedA: c.latinExtendedA,
    romanian: c.romanian,
  };
}

/** @param {any} ctx @param {any} library */
export function createFonts(ctx, library) {
  const { db, dataDir } = ctx;
  const q = (sql) => db.prepare(sql);

  /**
   * A specimen drawn with the font itself, under an alias of its own hash. The alias stays registered in this process: taking a
   * font out of Skia's registry (GlobalFonts.remove) rebuilds it and changes how the bundled families match their weights.
   * @returns {Buffer}
   */
  function specimen(file, sha, { family, weight, style, license, covers }) {
    const alias = `fc-thumb-${sha.slice(0, 10)}`;
    if (!GlobalFonts.has(alias) && !GlobalFonts.registerFromPath(file, alias)) throw new StudioError('The font file could not be loaded for drawing (it may be damaged, or use an outline format this studio cannot draw). Check it opens in another program.', 'rejected');
    const c = createCanvas(640, 360);
    const g = c.getContext('2d');
    g.fillStyle = '#101018'; g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
    const face = `${style === 'italic' ? 'italic ' : ''}${weight}`;
    g.font = `${face} 120px "${alias}"`; g.fillText('Aa', 40, 170);
    g.font = `${face} 40px "${alias}"`; g.fillText(family.length > 24 ? `${family.slice(0, 23)}…` : family, 40, 240);
    g.fillStyle = '#8b93b0'; g.font = `${face} 26px "${alias}"`; g.fillText('Hamburgefonstiv 0123456789', 40, 290);
    if (covers) g.fillText('ăâîșț ĂÂÎȘȚ', 40, 326);
    g.font = '500 16px "Inter"'; g.textAlign = 'right';
    g.fillText(`${weight} ${style} · ${license}`.slice(0, 40), 612, 340);
    return c.toBuffer('image/png');
  }

  /**
   * Add a font file to the library, or a new version of the font asset `name`.
   * The file is given as `path` or as `data` (bytes). The family, weight and style are read from the file unless given.
   * @param {{ name: string, path?: string, data?: Buffer, originalName?: string, license: string, licenseFile?: string, family?: string, weight?: number, style?: string, title?: string, description?: string, tags?: string[], source?: string, author: string, note?: string }} o
   */
  async function addFont({ name, path, data, originalName, license, licenseFile, family, weight, style, title, description, tags = [], source, author, note }) {
    if (!SLUG_RE.test(name ?? '')) throw new StudioError(`"${name}" is not a valid asset name: use lowercase letters, digits and dashes (2–64 characters), e.g. "acme-sans" or "acme-sans-bold"`);
    if (!author) throw new StudioError('author is required');
    if (!Array.isArray(tags) || !tags.every((t) => /^[a-z0-9][a-z0-9-]*$/.test(t))) throw new StudioError('tags must be lowercase-kebab strings');
    let bytes = data;
    if (!bytes) {
      if (!path) throw new StudioError('Give the font file: path (a TTF, OTF or WOFF2 file), or its bytes');
      if (!existsSync(path) || !statSync(path).isFile()) throw new StudioError(`File not found: ${path}`, 'not_found');
      const size = statSync(path).size;
      if (size > MAX_FONT_BYTES) throw new StudioError(`${basename(path)} is ${(size / 1e6).toFixed(1)} MB; font files are at most ${MAX_FONT_BYTES / 1e6} MB`, 'rejected');
      bytes = readFileSync(path);
    }
    const label = originalName ?? (path ? basename(path) : name);
    if (bytes.length > MAX_FONT_BYTES) throw new StudioError(`${label} is ${(bytes.length / 1e6).toFixed(1)} MB; font files are at most ${MAX_FONT_BYTES / 1e6} MB`, 'rejected');
    if (!bytes.length) throw new StudioError(`${label} is empty`, 'rejected');

    /** @type {ReturnType<typeof parseFont>} */
    let info;
    try { info = parseFont(bytes, label); } catch (e) {
      throw new StudioError(`${e.message}. Add a TTF, OTF or WOFF2 font file.`, 'rejected');
    }
    if (info.format === 'woff') throw new StudioError(`${label} is a WOFF 1 file; add it as WOFF2, TTF or OTF (any converter makes one from it)`, 'rejected');
    if (info.format === 'ttc') throw new StudioError(`${label} is a font collection; add one font of it as TTF or OTF`, 'rejected');
    const kind = FORMATS[info.format];

    // the licence is part of the asset: free text such as "OFL-1.1" or "Apache-2.0", and optionally the licence file itself
    const lic = typeof license === 'string' ? license.trim() : '';
    if (!lic) {
      throw new StudioError(`A licence is required: say what the font is licensed under (e.g. "OFL-1.1", "Apache-2.0", "commercial, licensed to us"), and optionally give license_file.${info.licenseText ? ` The file says: "${info.licenseText.slice(0, 200)}"` : ''}`);
    }
    if (lic.length > 200) throw new StudioError('license is a short text such as "OFL-1.1" (at most 200 characters); give the full text as license_file');
    let licenseText = null;
    if (licenseFile) {
      if (!existsSync(licenseFile) || !statSync(licenseFile).isFile()) throw new StudioError(`license_file not found: ${licenseFile}`, 'not_found');
      if (statSync(licenseFile).size > MAX_LICENSE_FILE) throw new StudioError(`license_file is larger than ${MAX_LICENSE_FILE / 1000} KB; give the licence text, not a bundle`, 'rejected');
      licenseText = readFileSync(licenseFile);
    }
    if (source !== undefined && (typeof source !== 'string' || source.length > 300)) throw new StudioError('source is where the font came from (a URL or a few words, at most 300 characters)');

    // family, weight, style: what the file says, unless overridden
    let fam = (family ?? info.family ?? '').trim();
    if (!fam) throw new StudioError(`${label} has no family name; give family`);
    if (fam.length > 80 || [...fam].some((c) => c === '"' || c === '\\' || c.charCodeAt(0) < 32)) throw new StudioError('family is a plain name of at most 80 characters, without quotes (e.g. "Acme Sans")');
    const w = weight ?? info.weight;
    if (!Number.isInteger(w) || w < 1 || w > 1000) throw new StudioError('weight is a whole number from 1 to 1000 (400 regular, 700 bold)');
    const st = style ?? info.style;
    if (st !== 'normal' && st !== 'italic') throw new StudioError('style is "normal" or "italic"');

    // a bundled family keeps its files and its pixels: an upload cannot take its name (or its Latin Extended alias)
    const key = fam.toLowerCase();
    const taken = fontManifest().find((f) => f.family.toLowerCase() === key || f.ext?.family.toLowerCase() === key);
    if (taken) throw new StudioError(`${taken.family} is bundled with the studio; give your font another family name (family: "${fam} Custom", for example)`, 'conflict');

    const existing = q('SELECT * FROM assets WHERE slug = ?').get(name);
    if (existing && existing.type !== 'font') throw new StudioError(`"${name}" already exists as a ${existing.type} asset; pick another name`, 'conflict');
    const prev = existing ? library.versionRow(name) : null;
    if (prev && !library.isUploadedFont(prev)) throw new StudioError(`"${name}" is a font bundled with the studio and cannot get new versions; give your font another name`, 'conflict');
    // one family, several font assets: a weight and style belong to one of them
    const catalog = library.fontCatalog().find(fam);
    if (catalog && !catalog.bundled) {
      fam = catalog.family; // the family keeps the spelling it was first uploaded with
      const clash = catalog.faces.find((f) => f.slug !== name && f.weight === w && f.style === st);
      if (clash) throw new StudioError(`${clash.slug} already provides ${fam} ${w} ${st}. Add a new version of ${clash.slug} (name: "${clash.slug}"), or give this file another weight or style`, 'conflict');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (prev && json(prev.meta, {}).sha256 === sha256) throw new StudioError(`The file is identical to ${makeRef(name, prev.version)}; nothing to save.`, 'conflict');

    const version = (existing?.latest_version ?? 0) + 1;
    const file = `files/${name}@${version}${kind.ext}`;
    const licFile = licenseText ? `files/${name}@${version}.license.txt` : null;
    const coverage = summarizeCoverage(info.codepoints);
    const fileTmp = join(dataDir, tempOf(file));
    const licTmp = licFile ? join(dataDir, tempOf(licFile)) : null;
    const thumb = `thumbs/${name}@${version}.png`;
    const thumbTmp = join(dataDir, tempOf(thumb));
    const cleanup = () => { for (const t of [fileTmp, licTmp, thumbTmp]) if (t) rmSync(t, { force: true }); };
    try {
      writeFileSync(fileTmp, bytes);
      if (licTmp) writeFileSync(licTmp, licenseText);
      writeFileSync(thumbTmp, specimen(fileTmp, sha256, { family: fam, weight: w, style: st, license: lic, covers: coverage.romanian }));
      const meta = {
        family: fam, weight: w, style: st, license: lic, ...(licFile ? { licenseFile: licFile } : {}), ...(source ? { source } : {}),
        coverage, uploaded: true, bytes: bytes.length, sha256, format: info.format, subfamily: info.subfamily, fullName: info.fullName,
        glyphs: info.glyphs, unitsPerEm: info.unitsPerEm, ...(info.variable ? { variable: true } : {}),
        originalName: label, ...(info.licenseText ? { embeddedLicense: info.licenseText.slice(0, 500) } : {}), ...(info.copyright ? { copyright: info.copyright.slice(0, 300) } : {}),
      };
      const shownTitle = title?.trim() || `${fam} ${weightName(w)}${st === 'italic' ? ' Italic' : ''}`;
      const blocks = coverage.blocks.slice(0, 4).map((b) => b.name).join(', ');
      const text = (description ?? '').trim() || `${fam} ${w}${st === 'italic' ? ' italic' : ''}: a ${info.format.toUpperCase()} font licensed ${lic}, ${coverage.codepoints} characters (${blocks || 'no standard blocks'}${coverage.latinExtendedA ? '' : '; not all of Latin Extended-A'}). Use it by family name "${fam}" in any parameter of type "font".`;
      const allTags = [...new Set(['font', 'uploaded', ...(st === 'italic' ? ['italic'] : []), ...tags])];
      const at = now();
      transaction(db, () => {
        const assetId = existing?.id ?? q('INSERT INTO assets (slug, type, latest_version, created_at) VALUES (?, ?, 0, ?)').run(name, 'font', at).lastInsertRowid;
        const current = q('SELECT latest_version FROM assets WHERE id = ?').get(assetId).latest_version;
        if (current !== version - 1) throw new StudioError(`"${name}" changed while the font was being read (now v${current}); try again.`, 'conflict');
        q(`INSERT INTO asset_versions (asset_id, version, title, description, tags, file, mime, meta, thumb, author, note, parent_version, engine, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(assetId, version, shownTitle, text, JSON.stringify(allTags), file, kind.mime, JSON.stringify(meta), thumb, author, note ?? null, prev?.version_id ?? null, ENGINE_VERSION, at);
        q('UPDATE assets SET latest_version = ? WHERE id = ?').run(version, assetId);
        library.reindexLatest(assetId);
        ctx.events?.emit('asset', name, version === 1 ? 'created' : 'version', { ref: makeRef(name, version), author, type: 'font' });
      });
      renameRetry(fileTmp, join(dataDir, file));
      if (licTmp) renameRetry(licTmp, join(dataDir, licFile));
      renameRetry(thumbTmp, join(dataDir, thumb));
    } catch (e) {
      cleanup();
      if (/UNIQUE constraint/i.test(String(e?.message))) throw new StudioError(`"${name}" was saved by someone else at the same moment; try again.`, 'conflict');
      throw e;
    }
    return { asset: library.getAsset(makeRef(name, version), { includeSource: false }), coverage, thumbPath: join(dataDir, thumb) };
  }

  /**
   * Every family a font parameter can name: the bundled ones and the uploaded ones, with their weights, licences and refs.
   * @returns {{ family: string, bundled: boolean, license: string, faces: { ref: string, weight: number, style: string, license?: string, title?: string, coverage?: any }[] }[]}
   */
  function listFonts() {
    const out = fontManifest().map((f) => ({
      family: f.family, bundled: true, license: f.license,
      faces: f.files.map((x) => ({ ref: makeRef(f.slug, 1), weight: x.weight, style: x.style })),
    }));
    for (const u of library.fontCatalog().uploaded()) {
      out.push({
        family: u.family, bundled: false, license: [...new Set(u.faces.map((f) => f.license))].join(', '),
        faces: u.faces.map((f) => {
          const a = library.getAsset(f.ref, { includeSource: false });
          return { ref: f.ref, weight: f.weight, style: f.style, license: f.license, title: a.title, coverage: coverageSummary(a.meta.coverage) };
        }),
      });
    }
    return out;
  }

  return { addFont, listFonts };
}
