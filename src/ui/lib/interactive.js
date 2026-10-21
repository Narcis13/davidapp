// The editor's Interactive panel: what an interactive composition is made of, read-only. Its variables (with their
// first values), its scenes (range on the timeline, what happens at the end), its wires as sentences, and the
// problems the composition's validation reports. Clicking a scene selects it (the editor moves the playhead there).
// The wording comes from lib/wires.js.

import { fill, h, plural } from '/ui/lib/util.js';
import { endText, onText, rangeText, varsOf, wireParts } from '/ui/lib/wires.js';

/**
 * @param {{ onScene: (id: string) => void }} o
 * @returns {{ el: HTMLElement, update: (comp: any, errors: { path: string, message: string }[]) => void, select: (id: string | null) => void }}
 */
export function mountInteractivePanel({ onScene }) {
  const count = h('span.count', { 'data-testid': 'interactive-count' });
  const body = h('div.iv-body');
  const el = h('section.panel.interactive-panel', { 'data-testid': 'interactive-panel', hidden: true }, h('div.panel-head', h('h2', 'Interactive'), count), body);
  let selected = null;

  function sceneRow(scene, I) {
    const b = h('button.iv-scene', { type: 'button', 'data-testid': 'interactive-scene', 'data-scene': scene.id, 'aria-pressed': String(scene.id === selected), title: 'Move the playhead to this scene' },
      h('b', scene.id),
      scene.id === I.start ? h('span.badge', 'start') : null,
      h('span.muted', `${rangeText(scene)} · ${endText(scene)}`));
    b.addEventListener('click', () => onScene(scene.id));
    return h('li', b);
  }

  function wireRow(w, i) {
    const p = wireParts(w);
    return h('li.iv-wire', { 'data-testid': 'interactive-wire', 'data-on': p.on, 'data-index': String(i) },
      h('div.iv-wire-on', h('code', { title: onText(p.on) }, p.on), p.where ? h('span.muted', p.where) : null, p.when ? h('span.muted', `if ${p.when}`) : null),
      h('ul.iv-actions', p.actions.map((a) => h('li', a))));
  }

  return {
    el,
    select(id) {
      selected = id;
      for (const b of el.querySelectorAll('[data-testid=interactive-scene]')) b.setAttribute('aria-pressed', String(b.dataset.scene === id));
    },
    update(comp, errors) {
      const I = comp?.interactive;
      el.hidden = !I;
      if (!I) { body.replaceChildren(); return; }
      const vars = varsOf(I);
      count.textContent = `${plural(I.scenes.length, 'scene')} · ${plural(vars.length, 'variable')} · ${plural(I.wires.length, 'wire')}`;
      fill(body,
        errors.length ? h('div.notice.error', { 'data-testid': 'interactive-errors', 'data-count': String(errors.length), role: 'alert' },
          h('b', plural(errors.length, 'problem')),
          h('ul', errors.map((e) => h('li', h('code', e.path), ': ', e.message)))) : null,
        h('h3', 'Variables'),
        vars.length
          ? h('ul.iv-vars', vars.map(([name, v]) => h('li', { 'data-testid': 'interactive-var', 'data-name': name }, h('code', name), ' = ', h('b', String(v)))))
          : h('p.muted.iv-none', 'None. Variables hold a score, a switch or a name that wires change and items show.'),
        h('h3', 'Scenes'),
        h('ol.iv-scenes', I.scenes.map((s) => sceneRow(s, I))),
        h('h3', 'Wires'),
        I.wires.length
          ? h('ol.iv-wires', I.wires.map(wireRow))
          : h('p.muted.iv-none', 'None. A wire runs actions when something happens: a press, a key, a scene starting or ending.'),
        I.transition || I.music?.length ? h('p.hint.iv-extra',
          I.transition ? `Scenes change through ${String(I.transition.asset).replace(/@\d+$/, '')} (${Math.round(I.transition.duration * 100) / 100} s). ` : null,
          I.music?.length ? `Music: ${I.music.join(', ')}.` : null) : null,
        h('p.hint', 'Read-only here: change scenes, variables and wires with edit_clip, or ask Claude. Play runs the draft shown on the timeline.'));
      for (const b of el.querySelectorAll('[data-testid=interactive-scene]')) b.setAttribute('aria-pressed', String(b.dataset.scene === selected));
    },
  };
}
