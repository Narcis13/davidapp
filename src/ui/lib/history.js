// Undo and redo for the clip editor: snapshots of the draft composition (as JSON text, so a later
// edit of the live object cannot reach into the past). One checkpoint is taken before each edit;
// edits that arrive in a burst under the same key (a drag, typing in one field) share one.
//
//   const history = createHistory({ onChange });
//   history.checkpoint(draft, 'tf-x:title');   // before changing draft
//   const prev = history.undo(draft);           // → the composition to restore, or null
//   const next = history.redo(draft);

const COALESCE_MS = 900;

/** @param {{ limit?: number, onChange?: (state: { canUndo: boolean, canRedo: boolean }) => void }} [o] */
export function createHistory({ limit = 200, onChange = () => {} } = {}) {
  let past = [], future = [], lastKey = null, lastAt = 0;
  const notify = () => onChange({ canUndo: past.length > 0, canRedo: future.length > 0 });

  return {
    /** Remember `comp` as it is before an edit. A repeated key within a short time adds nothing (→ false). */
    checkpoint(comp, key = null) {
      const now = performance.now();
      if (key && key === lastKey && now - lastAt < COALESCE_MS) { lastAt = now; return false; }
      past.push(JSON.stringify(comp));
      if (past.length > limit) past.shift();
      future = [];
      lastKey = key; lastAt = now;
      notify();
      return true;
    },
    /** Forget the last checkpoint (the edit it was taken for did not happen). */
    discard() { past.pop(); lastKey = null; notify(); },
    /** End a burst: the next edit takes its own checkpoint even with the same key. */
    seal() { lastKey = null; },
    undo(current) {
      const snap = past.pop();
      if (snap === undefined) return null;
      future.push(JSON.stringify(current));
      lastKey = null;
      notify();
      return JSON.parse(snap);
    },
    redo(current) {
      const snap = future.pop();
      if (snap === undefined) return null;
      past.push(JSON.stringify(current));
      lastKey = null;
      notify();
      return JSON.parse(snap);
    },
    clear() { past = []; future = []; lastKey = null; notify(); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
