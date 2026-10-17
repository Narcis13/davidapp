# Faqir UI 1.2.5: issues found while building Fablecut's manual

Fablecut's manual (`/docs`, sources in `src/docs/`) is drawn on the server with `@faqir-ui/template@1.2.5`,
the `@faqir-ui/core@1.2.5` default theme bundle and `faqir-ui-cli@1.2.5` (used to audit every page in
`test/docs.test.js`). These are the problems met on the way, for a later session on the Faqir repository
(github.com/Narcis13/faqir-ui). Each has a reproduction, what we expected, and the workaround Fablecut uses now,
so the workaround can be removed once the fix ships.

Severity: **high** blocks or distorts a normal use; **medium** forces a workaround; **low** is friction or polish.

| # | Area | Issue | Severity |
|---|---|---|---|
| 1 | template | No inline markup and no whitespace control: punctuation after an inline element always gets a space | high |
| 2 | template | `table` cannot be called (`unavailable`), and a plain `data-ui="table"` fails the audit unless it carries six slots and a controller | high |
| 3 | template | `tabs` and `accordion` calls render empty sample triggers and panels, silently | high |
| 4 | template / audit | Calls leave empty interactive elements (an `<a>` with no href or text, nameless tab buttons) and the audit passes them | medium |
| 5 | template | Unfilled optional slots render as empty elements that take space | medium |
| 6 | template | `checkbox`, `radio`, `switch`, `toggle` cannot be called | medium |
| 7 | template | `nav` takes exactly one link; a navigation menu cannot be built with a call | medium |
| 8 | template | Partials take no children, so a wrapper (a scroll region around a table) cannot be reused | medium |
| 9 | packaging | No `faqir-ui` package on npm, and `@faqir-ui/template` does not show in `npm search` | medium |
| 10 | packaging / docs | The template language spec is not in any tarball; READMEs link to monorepo paths | medium |
| 11 | CSS | `collapsible` trigger spreads its children with `space-between` | low |
| 12 | CSS | `prose` tables have no overflow handling on narrow screens | low |
| 13 | registry | `stack` still declares `variant=vertical|horizontal`, removed in 1.0 | low |
| 14 | registry | `text` mixes two size scales; some variant groups default to an empty value | low |
| 15 | core | Theme bundles are ~725 KB unminified CSS, and there is no minified CSS build | low |

---

## 1. No inline markup, no whitespace control (template, high)

The grammar has no inline element syntax: an element can only be its own line, and rule 12.1.1 puts every
node on its own output line. So a period or comma right after an inline element is always preceded by a
space when the browser renders the line break:

```
p
  | Run
  code npm install
  | .
```

renders `<p>\n  Run\n  <code>npm install</code>\n  .\n</p>`, displayed as “Run `npm install` .”. There is no Pug-like
`#[code npm install]` interpolation and no way to trim the whitespace between two nodes. Prose with code,
links, keys or emphasis in mid-sentence (most of a manual) cannot be written without stray spaces. The same
happens to search snippets built from `mark` elements: “start_render” renders as “start_ render”.

**Expected:** an inline construct inside text, for example `p Run #[code npm install].` or `#[a(href="/x") link]`,
compiled to the same AST nodes as child elements, and/or a whitespace-trim marker between siblings.

**Fablecut's workaround:** `src/docs/inline.js` is a small helper that escapes a string and turns `` `code` ``,
`**strong**`, `[[key]]` and `[label](href)` into HTML, and the templates write it with the language's own `raw`
keyword (`raw p("…")`, `raw md("…")`, `raw marked(r.snippet)`). It works, but it moves most of the manual's
text out of the engine's escaping and into a host helper.

## 2. `table` cannot be called, and a plain table fails the audit (template, high)

`components.unavailable.table` is

> table: boolean prop "no-resize" declares an attr but is not a valid prop name

so `+table` is `unknown-component`. The docs (§19) even show `+table` with `@tbody` as an example. A plain
element instead,

```
div(data-ui="table")
  table
    tr
      td x
```

compiles (plain `data-ui` elements are not checked) but `faqir audit` reports six **critical** `required-slot`
findings (`table`, `thead`, `tbody`, `tr`, `th`, `td` parts) and a `controller-loaded` error. A read-only data
table in a server-rendered page needs neither the interactive controller nor six parts.

**Expected:** the IR accepts the `no-resize` prop (or the manifest renames it, e.g. `noResize`), and a static
table is possible: either the table manifest marks its parts optional when no interactive feature is used, or a
CSS-only `data-table` primitive exists beside the recipe.

**Fablecut's workaround:** every table is a plain `<table>` inside `data-ui="prose"` (styled by `base/prose.css`),
wrapped in a `div(role="region" aria-label="…" tabindex="0")` for scrolling (see #12).

## 3. `tabs` and `accordion` render empty samples (template, high)

Their triggers and panels are required parts that repeat in the reference tree, so (§11.4) they are not
fillable and render "as the reference ships it". The table gives `tabs` only the slot `list` and `accordion` no
slot at all. The result of `+tabs` is two nameless tab buttons and two empty panels; `+accordion` is two
collapsed items with empty `<span>` triggers. Compile reports nothing.

```html
<div data-ui="tabs">
  <div data-part="list" role="tablist">
    <button data-part="trigger" role="tab" id="t-1-tab-1" aria-controls="t-1-panel-1" aria-selected="true"></button>
    <button data-part="trigger" role="tab" id="t-1-tab-2" aria-controls="t-1-panel-2" aria-selected="false" tabindex="-1"></button>
  </div>
  …
```

**Expected:** a way to give repeated parts their content (an `items` argument, or repeated fills such as
`@tab` / `@panel` pairs), or at least a compile diagnostic (`no-fillable-content`) instead of shipping sample
markup.

**Fablecut's workaround:** the manual uses `collapsible` (one `<details>` per question) instead of `accordion`,
and no tabs.

## 4. Empty interactive elements, and the audit passes them (template + audit, medium)

When only the required slot is filled, the reference tree's other elements keep their contract attributes but
lose their placeholders:

- `+breadcrumb` with `@current` renders `<a data-part="item"></a>`: a link with no `href` and no text.
- `+tabs` renders tab buttons with no accessible name (#3).
- `+nav` renders its one link with `data-state="active"` and no `href` (#7).

`faqir audit` reports none of these (it reported only the table and controller findings on the same page).
An empty link or a nameless button is a WCAG 2.4.4 / 4.1.2 failure.

**Expected:** compile drops an element whose required content (an `href` placeholder, a label) was a sample, or
diagnoses it; and the audit gains a rule for links without `href` or text and buttons without an accessible name.

## 5. Unfilled optional slots take space (template, medium)

`+card(title="Assets")` with `@body` renders `<p data-part="description"></p>` and `<div data-part="footer"></div>`;
`+stat` renders an empty `<span data-part="change">`; `+empty-state`, `+quote`, `+timeline` and `+stepper` render
empty description, figcaption, time and label parts. The component CSS pads and spaces these parts, so a card
gets a visible blank band under its body.

**Expected:** an optional slot whose reference content was only a sample placeholder is omitted when it is not
filled (the element is not a structural part), or the component CSS hides `:empty` optional parts.

**Fablecut's workaround** (`src/ui/css/docs.css`):
`[data-ui="card"] [data-part="description"]:empty, [data-ui="card"] > [data-part="footer"]:empty { display: none; }`
and the same for the stat's `change` part.

## 6. `checkbox`, `radio`, `switch`, `toggle` cannot be called (template, medium)

Their `templates.html` root is a group of samples (`cluster` or `radio-group`), so the table lists them as
unavailable. Server-rendered forms are a main use of a server template engine.

**Expected:** each manifest's `templates.html` holds one instance (the gallery can keep its sample group
elsewhere), so the components are callable.

## 7. `nav` takes one link (template, medium)

`nav` has the required, single slot `link`, filled into the one `<a data-part="link" data-state="active">` of the
reference. A navigation with several links, each with its own `href` and `aria-current`, cannot be made with
`+nav`; the plain-element route loses the manifest checks.

**Expected:** a repeatable item (see #3), or a documented pattern of `+nav` with plain `a(data-part="link")`
children as its default slot.

**Fablecut's workaround:** the sidebar is a plain `nav(aria-label="Manual")` with lists of links (`partials/nav.faqir`).

## 8. Partials cannot take children (template, medium)

`include` passes parameters only; there are no mixins and no blocks for partials (§10.3, decision 9). A wrapper
that is the same everywhere (the scrollable, labelled region around each table) cannot be written once, so the
manual repeats `div(role="region" aria-label="…" tabindex="0")` in front of every table (about 40 times).

**Expected:** a partial may declare one content block (`include "partials/region.faqir" (label="…")` with an
indented body passed as its `block content`), keeping the fresh scope rule for parameters.

## 9. Package names on npm (packaging, medium)

`npm install faqir-ui` (and `npm view faqir-ui`) is a 404: the family is `faqir-ui-cli`, `@faqir-ui/core`,
`@faqir-ui/template`, `@faqir-ui/forms`, `@faqir-ui/rules`, `@faqir-ui/mcp`, `@faqir-ui/react` and `@faqir-ui/vue`.
`npm search faqir` lists seven of them but not `@faqir-ui/template` (published, 1.2.5), the one a server needs.

**Expected:** a `faqir-ui` package (an umbrella or a pointer that depends on the CLI and names the others), and
`@faqir-ui/template` given the same `keywords` as its siblings (`faqir`, `ui`, `ssr`, …) so search finds it.

## 10. The template spec is not shipped (packaging / docs, medium)

`@faqir-ui/template`'s README says "the full language is specified in `../../docs/template.md`", a path into the
monorepo that does not exist in the package. The 40 KB spec is in no tarball (we read it from GitHub at the
`v1.2.5` tag). The CLI README likewise links `packages/*/README.md`, `docs/layout.md`, `docs/security.md` and more,
none of which ship.

**Expected:** `docs/template.md` copied into the template package (`files`), README links that are absolute
GitHub URLs pinned to the release tag, or both.

## 11. `collapsible` trigger spreads its content (CSS, low)

`registry/primitives/collapsible/collapsible.css`:

```css
[data-ui="collapsible"] > [data-part="trigger"] { display: flex; align-items: center; justify-content: space-between; … }
```

With more than one child in the trigger (`code` + text, as in a list of commands), the children are spread
across the row and the text lands in the middle.

**Expected:** `justify-content: flex-start` with the chevron pushed to the end (`margin-inline-start: auto` on the
indicator).

**Fablecut's workaround:** the trigger's content is wrapped in one `span`, and
`[data-ui="collapsible"] > [data-part="trigger"] > span { flex: 1 1 auto; text-align: start; }`.

## 12. `prose` tables overflow on phones (CSS, low)

`[data-ui="prose"] table { inline-size: 100%; }` has no overflow handling; a table with a few columns of code
pushes the page wider than a 390 px phone.

**Expected:** a documented scroll wrapper in `prose.css` (for example
`[data-ui="prose"] :where([role="region"]):has(> table) { overflow-x: auto; }`) or `display: block; overflow-x: auto`
on the table itself.

## 13. `stack` still declares `variant` (registry, low)

The template table for `stack` has `variant=vertical|horizontal` beside `direction`, although the README says the
direction moved from `data-variant` to `data-direction` and the old form was removed in 1.0. `+stack(variant="horizontal")`
is accepted at compile time.

## 14. `text` sizes and empty defaults (registry, low)

`text` accepts `xs|sm|base|lg|xl|2xl|3xl|4xl|display` and also `1|2|3|4|5|6`, two scales in one group. `empty-state`'s
`size` (`sm`), `separator`'s `size` and `stat`'s `trend` have an empty default, so the generated table and the
bindings show `default: ""` for a group whose only value is not the default.

## 15. Unminified theme bundles (core, low)

Each `dist/faqir.<theme>.css` is about 725 KB (19,000 lines, comments included). There is a minified engine
(`faqir-core.min.js`) but no `.min.css`. Served gzip it is fine; without compression it is heavy for a docs page.

**Expected:** `faqir.<theme>.min.css` next to each bundle, with SRI hashes in `sri.json`.

---

## What worked well

- `compile` never threw for template mistakes; diagnostics carried a stable code, the file and the line, and the
  first compile of all 27 templates was clean once the content followed the grammar.
- Escaping by context, the URL scheme check (`javascript:` refused) and the ban on data in `l-*` and `on*`
  attributes made a CSP of `script-src 'none'; style-src 'self'` possible: the engine writes no inline script or style.
- Server output passed `faqir audit` with zero findings on all 23 pages (17 to 86 components each), with
  callouts, cards, stats, collapsibles, grids, clusters, kbd and text components.
- Overriding the semantic tokens on `:root` re-themed the default bundle to Fablecut's palette with no other change.
- `faqir audit --stdin --json` needs no project, which made the audit a plain test.
