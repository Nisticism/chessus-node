import { useRef, useCallback, useEffect } from 'react';

/**
 * Lightweight undo stack hook.
 *
 * Usage:
 *   const { pushUndo, undo, clear } = useUndoStack({ maxDepth: 50 });
 *
 *   // Before mutating state, capture the previous value and push a restorer:
 *   pushUndo(() => setSomething(prevSnapshot));
 *   setSomething(newValue);
 *
 * The hook installs a global Ctrl+Z / Cmd+Z keydown listener that:
 *   - Ignores the event when focus is in an editable text field (so native text-undo
 *     inside <input>, <textarea>, contenteditable elements still works as expected).
 *   - Pops and runs the most recent undo function otherwise.
 *
 * Each consuming component gets its own independent stack, so hosting the hook in a
 * single wizard step yields step-scoped undo behavior.
 */
export default function useUndoStack({ maxDepth = 50 } = {}) {
  const stackRef = useRef([]);

  const pushUndo = useCallback((undoFn) => {
    if (typeof undoFn !== 'function') return;
    stackRef.current.push(undoFn);
    if (stackRef.current.length > maxDepth) stackRef.current.shift();
  }, [maxDepth]);

  const undo = useCallback(() => {
    const fn = stackRef.current.pop();
    if (fn) {
      try { fn(); } catch (_) { /* swallow undo errors */ }
      return true;
    }
    return false;
  }, []);

  const clear = useCallback(() => { stackRef.current = []; }, []);

  // Returns true when focus is inside an editable text surface where the browser's
  // native text undo should be allowed to run instead of our app-level undo.
  const isEditableTarget = (target) => {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT') {
      // Skip non-text inputs (checkbox, radio, range, color, etc.) — those should be undoable.
      const type = (target.type || 'text').toLowerCase();
      const textTypes = ['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time'];
      return textTypes.includes(type);
    }
    if (tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    return false;
  };

  useEffect(() => {
    const handler = (e) => {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z');
      if (!isUndo) return;
      if (isEditableTarget(e.target)) return; // let native text undo run
      if (stackRef.current.length === 0) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  return { pushUndo, undo, clear };
}
