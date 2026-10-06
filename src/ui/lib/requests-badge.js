// The nav badge on Requests: how many requests wait for the user or the agent (open, working,
// review). Counted once, then again on every live 'request' event; hidden at 0.

import { api } from '/ui/lib/api.js';
import { live } from '/ui/lib/live.js';
import { debounce } from '/ui/lib/util.js';

export function startRequestsBadge() {
  const badge = document.querySelector('[data-testid="requests-badge"]');
  if (!badge) return () => {};
  let busy = false, again = false;
  async function count() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const { requests } = await api.get('/api/requests?status=open,working,review&limit=200');
      const n = requests.length;
      const review = requests.filter((r) => r.status === 'review').length;
      badge.textContent = String(n);
      badge.hidden = n === 0;
      badge.setAttribute('aria-label', `${n} waiting${review ? `, ${review} to review` : ''}`);
    } catch {
      // the server is away; the next event tries again
    } finally {
      busy = false;
    }
    if (again) { again = false; count(); }
  }
  const later = debounce(count, 150);
  const off = live.on('request', later);
  count();
  return () => { off(); later.cancel(); };
}
