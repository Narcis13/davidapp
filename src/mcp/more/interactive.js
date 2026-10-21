// MCP tools for interactive clips (v5). An interactive clip is played, not rendered: play_clip plays it as a viewer would
// (scripted steps or a recorded input log) and reports the states it passes through; check_clip, layout_report,
// render_clip_frame and edit_clip know the interactive parts (see tools.js and src/studio/checks.js).

import { StudioError } from '../../studio/library.js';
import { hitRegions, playFrames } from '../../studio/inspect.js';

/** The most stills play_clip returns: the trace is the answer, the pictures only help to see it. */
const MAX_STILLS = 6;

/** What `create_clip { interactive: true }` starts from: one scene as long as the clip, holding, no wires. */
export const skeleton = (duration) => ({ start: 'main', vars: {}, scenes: [{ id: 'main', start: 0, duration, end: 'hold' }], wires: [] });

/**
 * What an agent needs after it has changed an interactive clip: the scenes, the variables and the wires with the index that
 * update_wire and remove_wire take. {} for a clip that is not interactive.
 * @param {any} composition
 */
export function interactiveSummary(composition) {
  const I = composition.interactive;
  if (!I) return {};
  return { interactive: {
    start: I.start,
    scenes: I.scenes.map((s) => `${s.id}: ${s.start}s+${s.duration}s, end ${s.end}${s.final ? ', final' : ''}`),
    vars: I.vars,
    wires: I.wires.map((w, i) => `${i}: ${w.on}${w.scene === undefined ? '' : ` in ${[].concat(w.scene).join(', ')}`}`),
  } };
}

/** `count` of the frames, spread over the list, the first and the last always among them. */
const spread = (frames, count) => (frames.length <= count ? frames : [...new Set(Array.from({ length: count }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (count - 1))]))]);

/** @param {any} api @returns {any[]} */
export default function tools(api) {
  const { studio, z, image, FORMAT, COMPOSITION } = api;
  return [
    {
      name: 'play_clip',
      title: 'Play an interactive clip',
      description: 'Play an interactive clip (one with an `interactive` section) as a viewer would, and report the states it passes through. Give steps (what a viewer does, in order) or log (the raw input a player recorded); with neither, the clip runs by itself. steps: { wait: seconds } · { tap: "<item>" } or { tap: { item, region?, id? } } (presses and releases the middle of that item\'s hit region as the frame draws it) · { key: "ArrowRight", shift? } · { down | move | up: { x, y } } (frame pixels; pointer: mouse|touch|pen). A tap on an item with no hit region at that time fails and lists the regions there: wait first if it appears later. Each step takes a frame (a tap two, a wait its seconds), starting at frame 1. The result: the log that was played (play it again with log, or give it to a bug report: the same log always gives the same frames), then a trace of the session at times (seconds; default: after each step, then the end): the scene, the variables, the focused region, the playhead on the design timeline, the SHA-256 of the frame (equal hashes are identical frames), optionally the hit regions it draws (regions: true); and up to 6 stills spread over the trace. It plays a saved clip or a draft composition, in any format. A clip with no interactive section is refused: add one with create_clip { interactive: true } or edit_clip { op: "set_interactive" }.',
      input: {
        clip: z.string().optional().describe('Clip name (or give composition)'),
        composition: COMPOSITION.optional().describe('A draft composition to play instead of the saved clip (validated and pinned, not saved)'),
        format: FORMAT.optional().describe('Play it in another format'),
        steps: z.array(z.record(z.string(), z.any())).max(500).optional().describe('What a viewer does: { wait } { tap } { key } { down } { move } { up }'),
        log: z.array(z.record(z.string(), z.any())).max(20000).optional().describe('Raw input events { f (session frame), type: down|move|up|cancel|leave|key, x, y (frame pixels), pointer, key, shift } instead of steps'),
        times: z.array(z.number().min(0)).max(200).optional().describe('Session seconds to report (default: after each step, then the end)'),
        stills: z.boolean().optional().describe('Return stills of up to 6 of the reported times (default true)'),
        regions: z.boolean().optional().describe('List the hit regions each reported frame draws: item, event, label, box in frame pixels, size in CSS px at phone size'),
        max_size: z.number().int().min(64).max(3840).optional().describe('Longest side of the stills (default 640)'),
      },
      readOnly: true,
      run: async (a) => {
        if (a.steps && a.log) throw new StudioError('Give steps or log, not both: steps are what a viewer does, log is the raw input those become');
        const comp = await studio.compositionOf({ clip: a.clip, composition: a.composition, format: a.format });
        if (!comp.interactive) throw new StudioError(`${a.clip ? `Clip "${a.clip}"` : 'The composition'} is not interactive: it has no interactive section to play. Add one with edit_clip { op: "set_interactive", interactive: { scenes: [...], wires: [...] } }, or start a clip with create_clip { interactive: true }.`);
        const fps = comp.fps;
        // the frames to report: the times asked for, else after each step (a log: after each frame with input)
        const { frames, ends } = playFrames(fps, a);
        const name = `${a.clip ?? 'draft'}${a.format ? `-${a.format}` : ''}-play`;
        const wantStills = a.stills !== false;
        const maxSize = a.max_size ?? 640;
        const play = (o) => studio.play({ clip: a.clip, composition: a.composition, format: a.format, maxSize, ...o }).catch((e) => {
          // the tap that found nothing already says where and which regions are there: say what to do about it
          if (e instanceof StudioError && /nothing to tap on/.test(e.message)) throw new StudioError(`${e.message}. Add a { wait } step before the tap if the item appears later in the scene, name the region (tap: { item, region, id }) when the item has several, or press a point with { down } and { up } in frame pixels.`, e.code);
          throw e;
        });
        let r;
        if (!wantStills || frames.length <= MAX_STILLS) r = await play({ steps: a.steps, log: a.log, frames, stills: wantStills, regions: a.regions });
        else {
          // a long trace: all of its states, then the log played again for the few frames that get a picture (the same frames: the log is the whole input)
          r = await play({ steps: a.steps, log: a.log, frames, regions: a.regions });
          const pictured = await play({ log: r.log, frames: spread(frames, MAX_STILLS), stills: true });
          const pngs = new Map(pictured.frames.map((f) => [f.frame, f]));
          for (const f of r.frames) {
            const p = pngs.get(f.frame);
            if (!p) continue;
            if (p.hash !== f.hash) throw new Error(`replaying the log drew frame ${f.frame} differently (${f.hash}, then ${p.hash}): the studio is not deterministic here, please report it`);
            f.png = p.png;
          }
        }
        const stepAt = new Map(ends.map((n, i) => [n, i]));
        const trace = r.frames.map((f) => ({
          frame: f.frame, t: f.t, ...(!a.times && a.steps && stepAt.has(f.frame) ? { afterStep: stepAt.get(f.frame), step: a.steps[stepAt.get(f.frame)] } : {}),
          playhead: f.playhead, scene: f.state.scene, vars: f.state.vars, focus: f.state.focus, history: f.state.history, hash: f.hash,
          ...(f.regions ? { regions: hitRegions(f.regions, comp) } : {}),
        }));
        const shown = r.frames.filter((f) => f.png);
        return {
          json: { clip: a.clip ?? null, format: comp.format, width: comp.width, height: comp.height, fps, events: r.log.length, lastEvent: r.last, log: r.log, trace, end: r.end, stills: shown.map((f) => f.frame) },
          images: shown.map((f) => image(`${name}-f${f.frame}`, f.png)),
        };
      },
    },
  ];
}
