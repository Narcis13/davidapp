// The source editor: CodeMirror 6 (vendored through the import map in index.html) with JavaScript
// highlighting, line numbers, search, undo and lint markers for the validation error.
//
//   const ed = createCodeEditor({ value, readOnly, label, testid, onSave });
//   ed.el            the host element; ed.el.value gets/sets the document, and it fires `input`
//                    (bubbling) when the user edits, so scripted recipes and textarea code keep working
//   ed.markError(message, problems)   put the error on its line (parsed from the message, or from
//                                     details.problems [{ line, column?, message }])
//   ed.clearErrors()  ed.focus()  ed.destroy()

import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { setDiagnostics, lintGutter } from '@codemirror/lint';
import { keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { h } from '/ui/lib/util.js';

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--bg-2)', fontSize: '12.5px', maxWidth: '100%' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--bg-2)', color: 'var(--faint)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(122, 162, 255, 0.28) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(255, 209, 102, 0.18) !important', outline: '1px solid rgba(255, 209, 102, 0.4)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 209, 102, 0.22)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--line-2)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--surface-3)', color: 'var(--text)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-3)', border: 'none', color: 'var(--muted)' },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#ff8fb1' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a6e3a1' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#ffb86c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7f819c', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7aa2ff' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#c6d0f5' },
  { tag: [t.definition(t.variableName)], color: '#ffd166' },
  { tag: [t.variableName], color: '#ececf4' },
  { tag: [t.typeName, t.className], color: '#7cf5c0' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#a0a2ba' },
  { tag: t.invalid, color: '#ff7b7b' },
]);

/** Where an error message points: "(slug@3.js:12:5)" or "line 12:" → { line, column }. */
export function errorPosition(message) {
  const m = /\.js:(\d+):(\d+)\)/.exec(message ?? '') ?? /\bline (\d+)(?::(\d+))?/i.exec(message ?? '');
  return m ? { line: Number(m[1]), column: m[2] ? Number(m[2]) : null } : null;
}

/**
 * @param {{ value?: string, readOnly?: boolean, label?: string, testid?: string, onSave?: () => void }} [o]
 */
export function createCodeEditor({ value = '', readOnly = false, label = 'Source', testid, onSave } = {}) {
  const host = h('div.cm-host', { 'data-testid': testid, role: 'group', 'aria-label': label });
  const editable = new Compartment();
  let silent = false;

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: value,
      extensions: [
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { onSave?.(); return true; } }]),
        basicSetup,
        javascript(),
        syntaxHighlighting(highlight),
        theme,
        lintGutter(),
        EditorState.tabSize.of(2),
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || silent) return;
          host.dispatchEvent(new Event('input', { bubbles: true }));
        }),
      ],
    }),
  });
  // the editor's own DOM input events stay inside: the host fires one `input` per document change
  view.dom.addEventListener('input', (e) => e.stopPropagation());

  const get = () => view.state.doc.toString();
  function set(text) {
    const next = String(text ?? '');
    if (next === get()) return;
    silent = true;
    try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } }); } finally { silent = false; }
  }
  Object.defineProperty(host, 'value', { get, set, configurable: true });

  function lineRange(line, column) {
    const doc = view.state.doc;
    const ln = doc.line(Math.min(Math.max(1, line), doc.lines));
    const from = column ? Math.min(ln.from + column - 1, ln.to) : ln.from + (/^\s*/.exec(ln.text)?.[0].length ?? 0);
    return { from: Math.min(from, ln.to), to: ln.to };
  }
  /** The first syntax error the JavaScript parser finds (the server gives no line for those). */
  function firstParseError() {
    let at = -1;
    syntaxTree(view.state).iterate({ enter(n) { if (at < 0 && n.type.isError) { at = n.from; return false; } return at < 0; } });
    return at;
  }

  return {
    el: host,
    view,
    get value() { return get(); },
    set value(v) { set(v); },
    setReadOnly(on) { view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(on), EditorView.editable.of(!on)]) }); },
    /**
     * Mark the validation error on its line. Returns the line it marked, or null.
     * @param {string} message @param {{ line?: number, column?: number, message?: string }[]} [problems]
     */
    markError(message, problems = []) {
      const list = problems.filter((p) => Number.isFinite(p?.line)).map((p) => ({ line: p.line, column: p.column ?? null, message: p.message ?? message }));
      if (!list.length) {
        const pos = errorPosition(message);
        if (pos) list.push({ ...pos, message });
        else if (/unknown key "([\w$]+)"/.test(message ?? '')) {
          // asset({ … }) with a key it does not know: the first place the key is written
          const name = /unknown key "([\w$]+)"/.exec(message)[1];
          const m = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}\\s*:`).exec(get());
          if (m) { const at = m.index + m[1].length, ln = view.state.doc.lineAt(at); list.push({ line: ln.number, column: at - ln.from + 1, message }); }
        } else if (/SyntaxError/.test(message ?? '')) {
          const at = firstParseError();
          if (at >= 0) { const ln = view.state.doc.lineAt(at); list.push({ line: ln.number, column: at - ln.from + 1, message }); }
        }
      }
      const diagnostics = list.map((p) => ({ ...lineRange(p.line, p.column), severity: 'error', message: p.message, source: 'validate' }));
      view.dispatch(setDiagnostics(view.state, diagnostics));
      if (!list.length) return null;
      const first = view.state.doc.line(Math.min(Math.max(1, list[0].line), view.state.doc.lines));
      view.dispatch({ effects: EditorView.scrollIntoView(first.from, { y: 'center' }) });
      host.dataset.errorLine = String(first.number);
      return first.number;
    },
    clearErrors() {
      view.dispatch(setDiagnostics(view.state, []));
      delete host.dataset.errorLine;
    },
    focus() { view.focus(); },
    destroy() { view.destroy(); },
  };
}
