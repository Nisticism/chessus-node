import { useEffect, useState } from "react";
import { BLOCKED_DOT_MODES } from "./moveEngine";

/*
 * How a board draws the hollow "blocked" dots (moveEngine.calculateBlockedTargets):
 *
 *   'pattern' (default) - everywhere the piece's pattern reaches that it cannot
 *                         go now. Costs next to nothing on any board.
 *   'first'             - only the square that actually stops it. Heavier on a
 *                         very large board full of pieces.
 *   'off'               - none.
 *
 * Kept per browser (localStorage), like the board's other display choices, and
 * read by each board at hover time - so changing it in one place applies to
 * every board on the next hover, with no extra state in the boards themselves.
 */
const KEY = "gridgrove.blockedDotMode";
const EVENT = "gridgrove:blocked-dot-mode";

export const BLOCKED_DOT_MODE_LABELS = {
  pattern: "Full pattern",
  first: "Only what's in the way",
  off: "Off",
};

export const readBlockedDotMode = () => {
  try {
    const v = window.localStorage.getItem(KEY);
    return BLOCKED_DOT_MODES.includes(v) ? v : "pattern";
  } catch (_) {
    return "pattern";
  }
};

export const writeBlockedDotMode = (mode) => {
  if (!BLOCKED_DOT_MODES.includes(mode)) return;
  try { window.localStorage.setItem(KEY, mode); } catch (_) { /* private mode: this tab only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
};

/** The current mode, kept in step with changes from any other control or tab. */
export const useBlockedDotMode = () => {
  const [mode, setMode] = useState(readBlockedDotMode);
  useEffect(() => {
    const sync = () => setMode(readBlockedDotMode());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [mode, writeBlockedDotMode];
};
