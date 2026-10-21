// HTTP routes: interactive clips (iteration 5), for the editor. An interactive clip is played, not rendered.
//
//   POST /api/clips/<slug>/play
//        body: { composition?, format?, log | steps, times?, frames?, regions? } (composition: the editor's unsaved draft); without times or
//        frames it reports the session after each step (each frame of the log that has input)
//        → { log, frames: [{ frame, t, playhead, state, hash, regions? }], end, last }: the log that was played and the session at each
//        time asked for (seconds, or session frames) as scene, variables and focus, with the SHA-256 of the frame it draws and,
//        with regions: true, the hit regions it draws as the layout report lists them. No pictures: the editor's player draws them.
//   POST /api/clips/<slug>/check-interactive
//        body: { composition?, format?, maxStates?, step?, only?, stills? } → what check_clip answers for an interactive clip (issues with
//        their scene and state, the state graph in `interactive.crawl`); stills (default false) are URLs under /media/frames/

import { basename } from 'node:path';
import { StudioError } from '../../studio/library.js';
import { hitRegions, playFrames } from '../../studio/inspect.js';

/** @param {any} api @returns {any[]} */
export default function routes(api) {
  const { studio } = api;
  return [
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/play$/, async ({ params, data }) => {
      const which = { clip: params[0], composition: data.composition, format: data.format };
      const comp = await studio.compositionOf(which);
      const frames = data.frames ?? (data.times ? undefined : playFrames(comp.fps, data).frames);
      const r = await studio.play({ ...which, log: data.log, steps: data.steps, times: data.times, frames, regions: !!data.regions });
      return data.regions ? { ...r, frames: r.frames.map((f) => ({ ...f, regions: hitRegions(f.regions ?? [], comp) })) } : r;
    }],
    ['POST', /^\/api\/clips\/([a-z0-9-]+)\/check-interactive$/, async ({ params, data }) => {
      const which = { clip: data.composition ? undefined : params[0], composition: data.composition, format: data.format };
      if (!(await studio.compositionOf(which)).interactive) throw new StudioError(`Clip "${params[0]}" is not interactive: it has no interactive section. /check measures a video.`, 'invalid');
      const r = await studio.checks.checkClip({ ...which, name: params[0], step: data.step, only: data.only, maxStates: data.maxStates, stills: !!data.stills });
      return { ...r, clip: params[0], issues: r.issues.map((i) => ({ ...i, still: i.still ? `/media/frames/${basename(i.still)}` : null })) };
    }],
  ];
}
