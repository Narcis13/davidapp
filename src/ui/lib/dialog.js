// Modal dialogs on the native <dialog> element: a generic one, and a yes/no question.

import { h, icon } from '/ui/lib/util.js';

/**
 * openDialog({ title, body, actions, testid }) → { el, close(value), closed: Promise<value> }
 * `body` is a node; `actions` are buttons placed in the footer.
 */
export function openDialog({ title, body, actions = [], testid = 'dialog', wide = false }) {
  let result;
  let done;
  const closed = new Promise((resolve) => { done = resolve; });
  const el = h(`dialog.dialog${wide ? '.wide' : ''}`, { 'data-testid': testid, 'aria-label': title },
    h('header.dialog-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => el.close() }, icon('close'))),
    h('div.dialog-body', body),
    actions.length ? h('footer.dialog-foot', actions) : null);
  el.addEventListener('close', () => { el.remove(); done(result); });
  el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  document.body.append(el);
  el.showModal();
  return { el, closed, close(value) { result = value; el.close(); } };
}

/** Ask a yes/no question → Promise<boolean>. */
export function confirmDialog(message, { ok = 'OK', cancel = 'Cancel', title = 'Are you sure' } = {}) {
  const yes = h('button.btn.primary', { type: 'button', 'data-testid': 'confirm-ok' }, ok);
  const no = h('button.btn', { type: 'button', 'data-testid': 'confirm-cancel' }, cancel);
  const d = openDialog({ title, body: h('p', message), actions: [no, yes], testid: 'confirm' });
  yes.addEventListener('click', () => d.close(true));
  no.addEventListener('click', () => d.close(false));
  return d.closed.then((v) => v === true);
}
