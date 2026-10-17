// The studio's manual, drawn on the server with Faqir UI's template engine (@faqir-ui/template).
//
// Every page is a partial in templates/pages/<slug>.faqir; a short wrapper puts it in templates/layout.faqir,
// which draws the navigation, the title and the page's contents around it. The templates are compiled
// when the docs are created and again whenever a template file changes (a template mistake is an error with
// its file and line, never a broken page), and rendered on every request with what the studio knows at that moment (src/docs/facts.js).

import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@faqir-ui/template/compile';
import { render } from '@faqir-ui/template';
import { components } from '@faqir-ui/template/registry';
import { createFileLoader } from '@faqir-ui/template/node';
import { GROUPS, PAGES, hrefOf } from './pages.js';
import { liveFacts } from './facts.js';
import { inline, marked, paragraph } from './inline.js';

export const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), 'templates');
const HELPERS = { md: inline, p: paragraph, marked };
const SEARCH_LIMIT = 30;

/** The wrapper that puts one partial in the layout. @param {string} partial */
const wrapper = (partial) => `layout "layout.faqir"\n\nblock content\n  include "${partial}" (d=d)\n`;

/**
 * Compile every page, the search page and the not-found page. Throws one error that lists every
 * diagnostic (file:line:col code message) when any template has a mistake.
 */
export function compileDocs() {
  const loader = createFileLoader(TEMPLATES);
  const problems = [];
  const one = (name, partial) => {
    const { ast, diagnostics } = compile(wrapper(partial), { file: name, loader, components, helpers: Object.keys(HELPERS) });
    for (const d of diagnostics) problems.push(`${d.file}:${d.line}:${d.col} ${d.code} ${d.message}`);
    return ast;
  };
  const pages = new Map(PAGES.map((p) => [p.slug, one(`pages/${p.slug}.wrapper`, `pages/${p.slug}.faqir`)]));
  const search = one('search.wrapper', 'search.faqir');
  const notFound = one('not-found.wrapper', 'not-found.faqir');
  if (problems.length) throw new Error(`The docs templates have ${problems.length} problem(s):\n${problems.join('\n')}`);
  return { pages, search, notFound };
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
/** Text of an HTML fragment: tags dropped, the entities the engine writes decoded, spaces collapsed. @param {string} html */
export const textOf = (html) => html.replace(/<\/?(?:a|code|strong|kbd|mark|span|em|b|i)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]).replace(/\s+/g, ' ').trim();

/** The h2 headings of a rendered page, for its "On this page" list. @param {string} html */
export function headingsOf(html) {
  return [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({ id: m[1], text: textOf(m[2]) }));
}

/** The article of a rendered page: what sits between the layout's content markers. @param {string} html */
export const contentOf = (html) => html.split('<!-- docs:content -->')[1]?.split('<!-- docs:end -->')[0] ?? '';

/**
 * @param {any} studio
 * @param {{ tools?: () => any[], runNow?: () => boolean, cacheMs?: number }} [o]
 *   tools: the MCP tool definitions (src/mcp/tools.js), for the tool reference; runNow: whether "Run now" is available
 */
export function createDocs(studio, { tools = () => [], runNow = () => false, cacheMs = 30_000 } = {}) {
  // a template edited while the studio runs is compiled again on the next visit, so the pages are never stale
  const stamp = () => readdirSync(TEMPLATES, { recursive: true }).filter((f) => String(f).endsWith('.faqir')).map((f) => `${f}:${statSync(join(TEMPLATES, String(f))).mtimeMs}`).join('|');
  let compiledStamp = stamp(), compiled = compileDocs();
  const fresh = () => {
    const now = stamp();
    if (now !== compiledStamp) { compiled = compileDocs(); compiledStamp = now; index = null; }
    return compiled;
  };
  let facts = null, factsAt = 0, index = null, indexAt = 0;
  const live = () => {
    if (!facts || Date.now() - factsAt > cacheMs) { facts = liveFacts(studio, { tools: tools(), runNow: runNow() }); factsAt = Date.now(); }
    return facts;
  };

  const nav = (current) => GROUPS.map((g) => ({ title: g.title, pages: g.pages.map((p) => ({ title: p.title, href: hrefOf(p.slug), current: p.slug === current })) }));
  const link = (p) => (p ? { title: p.title, href: hrefOf(p.slug) } : null);

  /** Render a compiled page twice: the first pass finds its headings, the second draws its contents list. */
  function draw(ast, page, extra = {}) {
    const d = { site: { name: 'Fablecut', version: live().version }, nav: nav(page.slug), page, live: live(), toc: [], ...extra };
    const first = render(ast, { d }, { helpers: HELPERS });
    const toc = headingsOf(contentOf(first));
    return toc.length > 1 ? render(ast, { d: { ...d, toc } }, { helpers: HELPERS }) : first;
  }

  function pageInfo(slug) {
    const i = PAGES.findIndex((p) => p.slug === slug);
    const p = PAGES[i];
    return { slug, title: p.title, summary: p.summary, group: p.group, href: hrefOf(slug), prev: link(PAGES[i - 1]), next: link(PAGES[i + 1]) };
  }

  /** The text of every page, cut at its h2 headings: what a search looks through. */
  function searchIndex() {
    if (index && Date.now() - indexAt < cacheMs) return index;
    index = [];
    for (const p of PAGES) {
      const html = contentOf(draw(fresh().pages.get(p.slug), pageInfo(p.slug)));
      const parts = html.split(/(?=<h2 id=")/);
      for (const part of parts) {
        const h = /^<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/.exec(part);
        index.push({ slug: p.slug, page: p.title, id: h ? h[1] : null, heading: h ? textOf(h[2]) : p.title, text: textOf(h ? part.slice(h[0].length) : part) });
      }
    }
    indexAt = Date.now();
    return index;
  }

  /** Sections that hold every word of the query, best first, each with a snippet around its first match. @param {string} query */
  function find(query) {
    const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_@.-]+/u).filter((w) => w.length > 1))].slice(0, 8);
    if (!words.length) return [];
    const results = [];
    for (const s of searchIndex()) {
      const hay = `${s.page} ${s.heading} ${s.text}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      let score = 0;
      for (const w of words) {
        if (s.page.toLowerCase().includes(w)) score += 8;
        if (s.heading.toLowerCase().includes(w)) score += 5;
        score += Math.min(6, s.text.toLowerCase().split(w).length - 1);
      }
      results.push({ score, title: s.heading === s.page ? s.page : `${s.page} › ${s.heading}`, href: `${hrefOf(s.slug)}${s.id ? `#${s.id}` : ''}`, snippet: snippet(s.text, words) });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, SEARCH_LIMIT).map(({ title, href, snippet: parts }) => ({ title, href, snippet: parts }));
  }

  return {
    slugs: PAGES.map((p) => p.slug),
    /** The HTML of a page, or of the not-found page. @param {string} slug */
    page(slug) {
      if (!fresh().pages.has(slug)) return { status: 404, html: draw(fresh().notFound, { slug: 'not-found', title: 'Page not found', summary: `There is no page called “${slug}” in the manual.`, group: 'Docs', href: '', prev: null, next: null }) };
      return { status: 200, html: draw(fresh().pages.get(slug), pageInfo(slug)) };
    },
    /** The search page for a query. @param {string} query */
    search(query) {
      const q = String(query ?? '').slice(0, 200).trim();
      const results = q ? find(q) : [];
      return { status: 200, html: draw(fresh().search, { slug: 'search', title: q ? `Search: ${q}` : 'Search the manual', summary: q ? `${results.length} ${results.length === 1 ? 'section matches' : 'sections match'} every word you typed.` : 'Type a few words: every page and section is searched.', group: 'Docs', href: '/docs/search', prev: null, next: null }, { query: q, results }) };
    },
    find,
  };
}

/** About 220 characters around the first word found, split into plain and matched parts for <mark>. @param {string} text @param {string[]} words */
export function snippet(text, words) {
  const lower = text.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  const start = Math.max(0, at - 80);
  let cut = text.slice(start, start + 220);
  if (start > 0) cut = `…${cut.replace(/^\S*\s/, '')}`;
  if (start + 220 < text.length) cut = `${cut.replace(/\s\S*$/, '')}…`;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return cut.split(re).filter(Boolean).map((part) => ({ text: part, hit: words.includes(part.toLowerCase()) }));
}
