// MCP tools: footage (iteration 4). Video files as library assets, and a look at their frames to pick trim points.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '../../render/host.js';
import { footageService } from '../../render/footage.js';
import { frameAt, frameTime } from '../../core/footage.js';
import { StudioError } from '../../studio/library.js';
import { provenanceInput, fromArgs } from './provenance.js';

/** @param {any} api @returns {any[]} */
export default function tools({ studio, who, image, z, REF, AUTHOR }) {
  const { library } = studio;
  const facts = (a) => {
    const m = a.meta;
    return { footage: a.ref, width: m.width, height: m.height, fps: m.fps, frames: m.frames, duration: m.duration, constantRate: m.constantRate, rotation: m.rotation, codec: m.codec, colour: m.colour, audio: m.audio, bytes: m.bytes, sha256: m.sha256, license: m.license };
  };
  const pngOf = (rel) => ({ png: readFileSync(join(studio.dataDir, rel)), path: join(studio.dataDir, rel) });

  /** A labelled grid of source frames (time and frame index on each), straight from the decoder. */
  async function sheet(row, picks, cellWidth) {
    const meta = library.footageMeta(row);
    const src = { ...meta, path: library.absFile(row) };
    const cols = Math.min(picks.length, meta.width >= meta.height ? 4 : 6);
    const cw = cellWidth, ch = Math.round((cw * meta.height) / meta.width), gap = 6, pad = 8;
    const rows = Math.ceil(picks.length / cols);
    const out = createCanvas(pad * 2 + cols * cw + (cols - 1) * gap, pad * 2 + rows * ch + (rows - 1) * gap);
    const g = out.getContext('2d');
    g.fillStyle = '#16161d';
    g.fillRect(0, 0, out.width, out.height);
    g.imageSmoothingQuality = 'high';
    for (const [n, p] of picks.entries()) {
      const x = pad + (n % cols) * (cw + gap), y = pad + Math.floor(n / cols) * (ch + gap);
      g.drawImage(library.canvasOf(await footageService().frame(src, p.index), meta.width, meta.height), x, y, cw, ch);
      const label = `${p.t.toFixed(3)}s · #${p.index}`;
      g.font = '600 13px "JetBrains Mono"';
      g.fillStyle = 'rgba(0,0,0,0.72)';
      g.fillRect(x, y, g.measureText(label).width + 10, 20);
      g.fillStyle = '#ffffff';
      g.fillText(label, x + 5, y + 15);
    }
    return out.toBuffer('image/png');
  }

  return [
    {
      name: 'add_footage',
      title: 'Add a video file (footage)',
      description: 'Add a video file (MP4, MOV, M4V, WebM, MKV; a screen recording, a camera clip, a test video) to the library as footage. The file is kept as it is and read once: size as displayed (rotation applied), frame rate, duration, colour, sound, and the time of every frame, so any clip frame rate shows exact source frames (the last frame at or before each clip time; no blending) and the preview and the render show the same frame. Use it as a layer like an image: params fit, in and out (trim, seconds into the file; out 0 = the end), speed, loop, hold (freeze on a time; -1 plays); with transforms, keyframes, motions, effects and masks. Its sound plays when the same ref is put on an audio track (offset = the trim in). Footage can also go into a visual asset\'s image parameter (a browser frame, a camera): the asset sees the frame at its own time. HDR files and files over 4096 px or 20 minutes are refused. An existing name gets a new version.',
      input: {
        path: z.string().describe('Path of the video file on this machine'),
        name: z.string().describe('Asset name (lowercase-kebab), e.g. "studio-tour-library"'),
        description: z.string().describe('What the footage shows and where it came from'),
        title: z.string().optional(), tags: z.array(z.string()).optional(),
        ...provenanceInput(z),
        license: z.string().optional().describe('Licence of the file: "original" for a recording made for this studio (e.g. a screen recording), an SPDX id such as "CC-BY-4.0", or free text. Left out, it is recorded as unknown and a final render refuses the footage.'),
        for_clip: z.string().optional(), author: AUTHOR,
      },
      run: async (a) => {
        const r = await library.addFootage({ slug: a.name, path: a.path, description: a.description, title: a.title, tags: a.tags ?? ['footage'], provenance: fromArgs(a), forClip: a.for_clip, author: who(a.author) });
        const images = [pngOf(r.asset.thumb)];
        if (r.asset.meta.strip?.file) images.push(pngOf(r.asset.meta.strip.file));
        return { json: { ...facts(r.asset), provenance: r.asset.provenance }, images };
      },
    },
    {
      name: 'footage_frames',
      title: 'Look at frames of footage',
      description: 'A contact sheet of a footage asset\'s own frames, each labelled with its time in the file and its frame index: use it to pick trim points (in, out, hold) and to find the moment a click or a change happens. Give times (seconds into the file), or count frames spread over from–to (default the whole file).',
      input: {
        ref: REF, times: z.array(z.number().min(0)).min(1).max(48).optional().describe('Seconds into the file'),
        count: z.number().int().min(1).max(48).optional().describe('Frames spread over the range (default 12)'),
        from: z.number().min(0).optional(), to: z.number().min(0).optional(),
        cell_width: z.number().int().min(80).max(960).optional().describe('Width of each cell in px (default 320)'),
      },
      readOnly: true,
      run: async (a) => {
        const row = library.requireVersion(a.ref);
        if (row.type !== 'video') throw new StudioError(`${a.ref} is a ${row.type} asset; footage_frames takes footage (add_footage)`);
        const meta = library.footageMeta(row);
        const from = a.from ?? 0, to = Math.min(a.to ?? meta.duration, meta.duration);
        if (!(to > from)) throw new StudioError(`from (${from}) must come before to (${to}); the footage is ${meta.duration} s long`);
        const n = a.count ?? 12;
        const times = a.times ?? Array.from({ length: n }, (_, i) => from + ((i + 0.5) / n) * (to - from));
        const picks = times.map((t) => { const index = frameAt(meta.table, Math.min(t, meta.duration - 1e-6)); return { t: Math.round(frameTime(meta.table, index) * 1000) / 1000, index }; });
        const png = await sheet(row, picks, a.cell_width ?? 320);
        return { json: { ref: `${row.slug}@${row.version}`, frames: picks, fps: meta.fps, duration: meta.duration }, images: [image(`${row.slug}@${row.version}-frames`, png)] };
      },
    },
  ];
}
