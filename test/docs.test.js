// The manual (/docs): every page compiles, renders over HTTP with the studio's live facts, passes Faqir UI's
// own audit, links only to pages and sections that exist, and the search finds what the pages say.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tempStudio } from './helpers.js';
import { createStudioServer } from '../src/server/http.js';
import { compileDocs, contentOf, headingsOf, snippet } from '../src/docs/docs.js';
import { PAGES, hrefOf } from '../src/docs/pages.js';
import { TOOL_GROUPS, toolFacts } from '../src/docs/facts.js';
import { inline, marked } from '../src/docs/inline.js';
import { createTools } from '../src/mcp/tools.js';
import { ROOT } from '../src/render/host.js';

let t, server, base;
const pages = new Map();
const get = (path) => fetch(base + path, { redirect: 'manual' });

before(async () => {
  t = tempStudio();
  server = createStudioServer(t.studio);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const p of PAGES) {
    const res = await get(hrefOf(p.slug));
    pages.set(p.slug, { status: res.status, headers: res.headers, html: await res.text() });
  }
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

/** Faqir UI's audit of one HTML document, as JSON (the CLI that ships with faqir-ui-cli). */
function audit(html) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'node_modules', 'faqir-ui-cli', 'dist', 'faqir.mjs'), 'audit', '--stdin', '--json'], { env: { ...process.env, FAQIR_FORCE_NODE: '1' } });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', reject);
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`faqir audit printed no JSON: ${out.slice(0, 400)}`, { cause: e })); } });
    child.stdin.end(html);
  });
}

test('every template compiles without a diagnostic', () => {
  const { pages: asts, search, notFound } = compileDocs();
  assert.equal(asts.size, PAGES.length);
  assert.ok(search && notFound);
});

test('every page is served as HTML under a policy without scripts or inline styles', () => {
  for (const [slug, p] of pages) {
    assert.equal(p.status, 200, `${slug}: ${p.html.slice(0, 300)}`);
    assert.match(p.headers.get('content-type'), /^text\/html/);
    assert.match(p.headers.get('content-security-policy'), /script-src 'none'/);
    const page = PAGES.find((x) => x.slug === slug);
    assert.ok(p.html.includes(`<h1>${page.title.replace(/&/g, '&amp;')}</h1>`), `${slug} has its title`);
    assert.doesNotMatch(p.html, /<script|\sstyle="|\son[a-z]+="/i, `${slug} has no script, inline style or handler`);
    assert.ok(contentOf(p.html).length > 1500, `${slug} has a body worth reading`);
  }
});

test('addresses: /docs/index goes to /docs, an unknown page is a 404 with the navigation', async () => {
  const index = await get('/docs/index');
  assert.equal(index.status, 301);
  assert.equal(index.headers.get('location'), '/docs');
  const missing = await get('/docs/no-such-page');
  assert.equal(missing.status, 404);
  const html = await missing.text();
  assert.match(html, /Page not found/);
  assert.match(html, /href="\/docs\/install"/);
  assert.equal((await get('/docs/Bad_Name')).status, 200, 'not a docs address: the studio app answers it');
});

test('every page passes the Faqir UI audit', async () => {
  const reports = await Promise.all([...pages].map(async ([slug, p]) => [slug, await audit(p.html)]));
  for (const [slug, r] of reports) {
    const findings = r.results.map((f) => `${f.severity} ${f.rule_id} line ${f.line}: ${f.message}`);
    assert.deepEqual(findings, [], `${slug}:\n${findings.join('\n')}`);
  }
});

test('internal links point at pages and sections that exist', () => {
  const ids = new Map([...pages].map(([slug, p]) => [hrefOf(slug), new Set([...p.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  for (const [slug, p] of pages) {
    for (const [, href] of p.html.matchAll(/href="(\/docs[^"]*|#[^"]*)"/g)) {
      const [path, hash] = href.startsWith('#') ? [hrefOf(slug), href.slice(1)] : href.split('#');
      if (path === '/docs/search') continue;
      assert.ok(ids.has(path), `${slug} links to ${href}, which is not a page`);
      if (hash) assert.ok(ids.get(path).has(hash), `${slug} links to ${href}, which has no #${hash}`);
    }
  }
});

test('every page with sections has an "On this page" list that matches its headings', () => {
  for (const [slug, p] of pages) {
    const heads = headingsOf(contentOf(p.html));
    assert.equal(new Set(heads.map((h) => h.id)).size, heads.length, `${slug}: section ids are unique`);
    if (heads.length > 1) for (const h of heads) assert.ok(p.html.includes(`<a href="#${h.id}">`), `${slug} lists #${h.id}`);
  }
});

test('the tool reference lists every MCP tool, each in a named group', () => {
  const { tools } = createTools(t.studio);
  const facts = toolFacts(tools);
  assert.equal(facts.count, tools.length);
  assert.ok(!facts.groups.some((g) => g.title === 'Other'), `tools missing from TOOL_GROUPS: ${facts.groups.find((g) => g.title === 'Other')?.tools.map((x) => x.name)}`);
  const html = pages.get('mcp-tools').html;
  for (const tool of tools) assert.ok(html.includes(`id="tool-${tool.name}"`), `${tool.name} is on the reference page`);
  assert.equal(new Set(TOOL_GROUPS.flatMap((g) => g.tools)).size, TOOL_GROUPS.flatMap((g) => g.tools).length, 'no tool is listed twice');
});

test('search finds sections by every word, ranks titles first and escapes what was typed', async () => {
  const res = await get('/docs/search?q=final+render+licence');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /href="\/docs\/provenance#/);
  assert.match(html, /<mark>/);
  const evil = await (await get('/docs/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
  assert.doesNotMatch(evil, /<script>alert/);
  assert.match(evil, /&lt;script&gt;alert\(1\)/);
  const none = await (await get('/docs/search?q=zzzqqqxxy')).text();
  assert.match(none, /Nothing in the manual holds all of those words/);
});

test('inline markup: code, strong, keys and links, and nothing else', () => {
  assert.equal(inline('Run `npm <i>` and **save** with [[Ctrl+S]], see [the library](/docs/library).'),
    'Run <code>npm &lt;i&gt;</code> and <strong>save</strong> with <kbd data-ui="kbd">Ctrl+S</kbd>, see <a href="/docs/library">the library</a>.');
  assert.equal(inline('<b>"x"</b> & *y*'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; *y*');
  assert.throws(() => inline('[x](javascript:alert(1))'), /must start with/);
  assert.deepEqual(snippet('one two three', ['two']), [{ text: 'one ', hit: false }, { text: 'two', hit: true }, { text: ' three', hit: false }]);
  assert.equal(marked([{ text: 'start_', hit: false }, { text: 'render', hit: true }, { text: ' <x>', hit: false }]), 'start_<mark>render</mark> &lt;x&gt;');
});

test('share links and interactive clips have their pages, found by search, linked from the start page', async () => {
  for (const [q, href] of [['export folder base url', '/docs/share'], ['wires scenes variables', '/docs/interactive'], ['STUDIO_TOKEN', '/docs/config']]) {
    const html = await (await get(`/docs/search?q=${encodeURIComponent(q)}`)).text();
    assert.ok(html.includes(`href="${href}`), `searching "${q}" finds ${href}`);
  }
  const start = pages.get('index').html;
  assert.ok(start.includes('href="/docs/share"') && start.includes('href="/docs/interactive"'));
});
