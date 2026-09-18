import React from "react";
import styles from "./promotionchooser.module.scss";

/*
 * "What does it become?"
 *
 * A promoting move cannot be submitted until the piece is named: the choice is
 * part of the answer, because the server's moveKey folds promotionPieceId in -
 * promoting to a rook when the line says queen is a different move, not a near
 * miss. So every board that lets somebody play a puzzle has to be able to ask.
 *
 * It used to exist only on the puzzle's own page. The home card navigated there
 * mid-puzzle and the Discord activity said "finish it on the site", which in
 * Discord means leaving the thing you were playing in. Both of those were the
 * absence of this component rather than a decision about where puzzles belong.
 *
 * The options come from /puzzle-move-info verbatim: { id, piece_name,
 * image_location, player }. `id` is submitted as-is (it is what the answer is
 * matched against) and is deliberately NOT parsed here.
 *
 * `imageFor` is the caller's own resolver, because the three boards resolve
 * piece art differently - one of them has a piece-definition map to fall back
 * on and the others do not - and a picture is the one thing this dialog cannot
 * work out for itself.
 */
const PromotionChooser = ({
  options,
  defaultPlayer,
  imageFor,
  onChoose,
  onCancel,
  tone,
}) => {
  if (!options?.length) return null;

  return (
    <div
      className={`${styles["backdrop"]}${tone ? ` ${styles[`tone-${tone}`] || ''}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Choose what this piece promotes to"
    >
      <div className={styles["dialog"]}>
        <h3>What does it become?</h3>
        <p>Your move promotes. Pick the piece.</p>
        <div className={styles["options"]}>
          {options.map((o) => {
            const src = imageFor
              ? imageFor({
                piece_id: o.id,
                image_location: o.image_location,
                player_id: o.player ?? defaultPlayer,
              })
              : null;
            return (
              <button
                key={`${o.id}:${o.player ?? 'own'}`}
                type="button"
                className={styles["option"]}
                onClick={() => onChoose(o)}
              >
                {src
                  ? <img src={src} alt="" draggable={false} />
                  : <span className={styles["fallback"]}>{(o.piece_name || '?').charAt(0)}</span>}
                <span>{o.piece_name}</span>
                {o.player === 0 && <em>neutral</em>}
                {o.player != null && o.player !== 0 && <em>Player {o.player}</em>}
              </button>
            );
          })}
        </div>
        <button type="button" className={styles["cancel"]} onClick={onCancel}>
          Take the move back
        </button>
      </div>
    </div>
  );
};

export default PromotionChooser;
