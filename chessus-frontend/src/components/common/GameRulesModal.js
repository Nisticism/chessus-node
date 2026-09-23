import React, { useEffect, useState } from "react";
import axios from "axios";
import { describePieceBriefly } from "../../helpers/pieceRules";
import styles from "./gamerulesmodal.module.scss";

/*
 * What you need to know to solve THIS puzzle, without leaving it.
 *
 * A puzzle is set in somebody's invented game, and the solver has very likely
 * never seen it before. Sending them to the game's page to find out how a piece
 * moves means leaving the puzzle - so this is a modal, and it is the same modal
 * on the puzzle's own page, on the home card and inside Discord.
 *
 * MOVEMENT FIRST, and most of the space. It is what a solver reaches for: the
 * question in front of them is "where can this thing go", and everything else
 * is context. Win conditions and the handful of mechanics that change how a
 * turn works follow underneath, in a sentence each.
 *
 * Only the pieces actually on the board are listed, and a piece both sides have
 * gets two thumbnails rather than two entries - the movement is the same, and
 * saying it twice would push the thing a solver came for further down.
 *
 * The rules come from the puzzle's own frozen snapshot, so what this says is
 * what the board in front of them actually does, even if the game has since
 * been edited.
 */

const DEFAULT_API = (process.env.REACT_APP_API_URL || "") + "/api/";
const DEFAULT_ASSET = process.env.REACT_APP_ASSET_URL || process.env.REACT_APP_API_URL || "";

/** One side's artwork for a piece, out of the per-player image list. */
const imageForSide = (imageLocation, side, assetBase) => {
  if (!imageLocation) return null;
  let list = imageLocation;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch (_) { list = [imageLocation]; }
  }
  if (!Array.isArray(list) || !list.length) return null;
  const path = list[Math.min(Math.max(0, Number(side) - 1), list.length - 1)];
  if (!path) return null;
  if (String(path).startsWith("http")) return path;
  return `${assetBase}${String(path).startsWith("/") ? "" : "/uploads/pieces/"}${path}`;
};

/*
 * The mechanics worth a line, and only those.
 *
 * A game has dozens of flags; almost none of them change what a solver does
 * next. These are the ones that change how a TURN works, which is the thing
 * that would otherwise make a correct-looking move fail.
 */
const mechanicLines = (c) => {
  const out = [];
  if (c.actions_per_turn > 1) out.push(`You get ${c.actions_per_turn} moves per turn, not one.`);
  if (c.forced_capture_condition) out.push("If you can capture, you must.");
  if (c.fog_of_war || c.hide_enemy_pieces) out.push("This game normally hides part of the board; the puzzle shows all of it.");
  if (c.promotion_condition) out.push("Getting a promotable piece to a promotion square wins outright — it does not promote.");
  return out;
};

/** How the game is won, in the order a solver would care. */
const winLines = (c) => {
  const out = [];
  if (c.mate_condition) {
    out.push(c.mate_condition_requires_all
      ? "Checkmate: every one of a player's key pieces must be checkmated at once."
      : "Checkmate a key piece and the game is over.");
  }
  if (c.capture_condition) {
    out.push(c.capture_condition_requires_all
      ? "Capture all of a player's key pieces to win."
      : "Capture a key piece and the game is over.");
  }
  if (c.lose_all_pieces_condition) out.push("Losing all of your own pieces WINS the game.");
  if (c.no_moves_condition) out.push("Leaving a player with no legal move wins.");
  if (c.squares_condition) out.push("Controlling the marked squares wins.");
  if (c.piece_count_condition) out.push("Reducing the opponent's pieces far enough wins.");
  if (c.line_condition) out.push("Making a line of your own pieces wins.");
  if (c.points_to_win) out.push(`First to ${c.points_to_win} points wins.`);
  if (c.stalemate_win_condition) out.push("A stalemated player WINS rather than draws.");
  if (!out.length) out.push("Capture the opponent's key piece.");
  return out;
};

const GameRulesModal = ({ puzzleId, open, onClose, apiBase = DEFAULT_API, assetBase = DEFAULT_ASSET }) => {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !puzzleId) return undefined;
    let cancelled = false;
    setError(null);
    axios.get(`${apiBase}puzzles/${puzzleId}/rules`)
      .then(({ data }) => { if (!cancelled) setRules(data); })
      .catch(() => { if (!cancelled) setError("Could not load the rules for this game."); });
    return () => { cancelled = true; };
  }, [open, puzzleId, apiBase]);

  // Escape closes it, the same as clicking away.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles["overlay"]} onClick={onClose} role="presentation">
      <div
        className={styles["modal"]}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="How this game works"
      >
        {/* The shell keeps the rounded corners and clips; this scrolls inside
            it, so the scrollbar's square ends cannot poke out past the radius. */}
        <div className={styles["body"]}>
        <div className={styles["head"]}>
          <h2>{rules?.game_name ? `How ${rules.game_name} works` : "How this game works"}</h2>
          <button className={styles["close"]} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <p className={styles["error"]}>{error}</p>}
        {!rules && !error && <p className={styles["loading"]}>Loading…</p>}

        {rules && (
          <>
            <h3 className={styles["section"]}>The pieces</h3>
            <ul className={styles["pieces"]}>
              {rules.pieces.map((p) => {
                const { moves, captures } = describePieceBriefly(p);
                return (
                  <li key={p.piece_id} className={styles["piece"]}>
                    <span className={styles["thumbs"]}>
                      {/* Both sides' artwork when both sides have it, rather
                          than the same movement written out twice. */}
                      {p.sides.map((side) => {
                        const src = imageForSide(p.image_location, side, assetBase);
                        return src ? (
                          <img key={side} src={src} alt={`${p.piece_name} (player ${side})`} />
                        ) : null;
                      })}
                    </span>
                    <span className={styles["text"]}>
                      <strong>{p.piece_name}</strong>
                      <span className={styles["movement"]}>{moves || "Moves as set by this game."}</span>
                      {/* Only when taking differs from moving - a piece that
                          captures the way it moves is the assumption, and
                          saying so every time buries the ones that do not. */}
                      {captures && (
                        <span className={styles["movement"]}>Takes: {captures}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            <h3 className={styles["section"]}>How it is won</h3>
            <ul className={styles["notes"]}>
              {winLines(rules.conditions).map((line, i) => <li key={i}>{line}</li>)}
            </ul>

            {mechanicLines(rules.conditions).length > 0 && (
              <>
                <h3 className={styles["section"]}>Worth knowing</h3>
                <ul className={styles["notes"]}>
                  {mechanicLines(rules.conditions).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
};

export default GameRulesModal;
