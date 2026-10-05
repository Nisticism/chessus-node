import React from "react";

/*
 * Stepping back through a finished puzzle - solved or revealed - under the
 * board, the same four controls and words as the match review.
 *
 * Its own component because PuzzleSolver sits at the hooks lint's path limit:
 * the page renders this unconditionally and it decides for itself whether
 * there is anything to show.
 */
export function ReviewControls({ show, label, step, caption, onFirst, onBack, onForward, onLast, styles }) {
  if (!show) return null;
  return (
    <div className={styles["review-below"]}>
      <div className={styles["review-controls"]}>
        <button type="button" onClick={onFirst} disabled={step === -1} title="Starting position">⏮</button>
        <button type="button" onClick={onBack} disabled={step === -1} title="Previous move (left arrow)">◀</button>
        <button type="button" onClick={onForward} disabled={step == null} title="Next move (right arrow)">▶</button>
        <button type="button" onClick={onLast} disabled={step == null} title="Final position">⏭ Final</button>
      </div>
      <h3 className={styles["board-title"]}>{label}</h3>
      {caption && <p className={styles["review-caption"]}>{caption}</p>}
    </div>
  );
}

/*
 * Start the puzzle over: after a reveal ("play it yourself now") and after
 * solving ("again"). Only a first attempt is ever rated, so neither moves a
 * rating twice.
 */
export function PlayAgainButton({ outcome, onClick, busy, styles }) {
  if (outcome !== 'solved' && outcome !== 'revealed') return null;
  return (
    <button type="button" className={styles["btn"]} onClick={onClick} disabled={busy}>
      {outcome === 'revealed' ? 'Play this puzzle' : 'Play again'}
    </button>
  );
}
