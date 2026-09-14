import React from "react";
import styles from "./placementtray.module.scss";
import { placeableName } from "../../helpers/placement";

/*
 * The row of pieces you can put down, for a game that places rather than moves.
 *
 * One component for every board that offers a placement - the builder, the
 * solver, the home card, the Discord activity - because the gesture is the
 * same in all four (pick a piece, then click a square) and four copies of it
 * would be four chances for the gesture to mean something slightly different.
 *
 * `tone` is the only concession to where it is drawn: the Discord activity
 * sits on Discord's own greys rather than on the site's panels, so it gets
 * darker chrome. The geometry and the held-piece ring are identical, because
 * "this one is in my hand" has to look the same wherever a board appears.
 */
const PlacementTray = ({
  items,
  heldKey,
  onPick,
  label = "Place a piece",
  imageFor,
  tone = "site",
  disabled = false,
}) => {
  if (!items || !items.length) return null;

  return (
    <div className={`${styles.tray} ${tone === "discord" ? styles.discord : ""}`}>
      <span className={styles.label}>{label}</span>
      <div className={styles.items}>
        {items.map((item) => {
          const held = heldKey === item.key;
          const name = placeableName(item);
          const src = imageFor ? imageFor(item) : null;
          return (
            <button
              key={item.key}
              type="button"
              disabled={disabled}
              // Picking the held piece again puts it back, so there is always a
              // way to stop placing without clicking the board.
              onClick={() => onPick(held ? null : item)}
              className={`${styles.item} ${held ? styles.held : ""}`}
              title={`${name} — ${item.player === 0 ? "neutral" : `Player ${item.player}`}`}
              aria-pressed={held}
            >
              {src
                ? <img src={src} alt="" className={styles.img} />
                : <span className={styles.letter}>{name.slice(0, 1)}</span>}
              {/* Two identical-looking stones differ only in who owns them, so
                  the number has to be on the button. */}
              <span className={styles.who}>{item.player === 0 ? "N" : item.player}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PlacementTray;
