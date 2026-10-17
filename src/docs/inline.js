// Inline markup for the manual's sentences. The template language has no inline elements (a child element
// is always its own line, so a period after it renders as " ."), so a sentence that names code, a key or a
// link is written as one string and turned into HTML here, then written with the template's `raw`.
// Only these forms are read; everything else is escaped text:
//
//   `code`            <code>code</code>            (its content is never read further)
//   **strong**        <strong>strong</strong>
//   [[Ctrl+S]]        <kbd data-ui="kbd">Ctrl+S</kbd>
//   [label](href)     <a href="href">label</a>      (href: /path, #anchor or http(s)://; anything else throws)
//
// The strings come from the templates in src/docs/templates, never from data a visitor sends.

const TOKEN = /`([^`]+)`|\*\*(.+?)\*\*|\[\[(.+?)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** @param {string} s */
export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param {string} href */
function safeHref(href) {
  if (/^(\/(?!\/)|#|https?:\/\/)/.test(href)) return href;
  throw new Error(`docs: a link must start with /, # or http(s)://, not ${JSON.stringify(href)}`);
}

/**
 * The HTML of one sentence or paragraph of inline markup.
 * @param {unknown} text
 * @returns {string}
 */
export function inline(text) {
  if (typeof text !== 'string') throw new TypeError('docs: inline() takes a string');
  let out = '', last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<strong>${inline(m[2])}</strong>`;
    else if (m[3] !== undefined) out += `<kbd data-ui="kbd">${escapeHtml(m[3])}</kbd>`;
    else {
      const href = safeHref(m[5]);
      const external = href.startsWith('http');
      out += `<a href="${escapeHtml(href)}"${external ? ' rel="noreferrer"' : ''}>${inline(m[4])}</a>`;
    }
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/** A paragraph: `raw p("…")` in a template. @param {unknown} text */
export const paragraph = (text) => `<p>${inline(text)}</p>`;

/**
 * A search snippet with its matches in <mark>, as one run of HTML: the template engine puts every node on a
 * line of its own, which would show a space on each side of a match ("start_ render"). Every part is escaped.
 * @param {{ text: string, hit: boolean }[]} parts
 */
export const marked = (parts) => parts.map((p) => (p.hit ? `<mark>${escapeHtml(p.text)}</mark>` : escapeHtml(p.text))).join('');
