// Requests to the agent: the inbox. (Filled in by the shell work of iteration 2.)

import { h } from '/ui/lib/util.js';

export async function mount(view, ctx) {
  ctx.setTitle('Requests');
  view.replaceChildren(h('section.page', h('h1', 'Requests')));
}
