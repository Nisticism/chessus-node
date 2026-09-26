/*
 * "Opponent chooses the piece type" in a live game - the browser half of
 * server/designated-piece.js.
 *
 * Before every action the player who is NOT about to act picks a piece type
 * from a list, and the player who is must move a piece of that type if one
 * can move. The chooser's clock runs while they choose.
 *
 * A choice belongs to one action: how many actions have been played and who
 * is to act. When the game moves on, this asks the server about the new
 * action (designationSync) and the server answers with designationStatus -
 * whether a choice is due, and, to the chooser only, what to choose from.
 * Until that answer arrives the same rule the server uses is applied here, so
 * the clock and the banner switch the moment a move lands.
 */
import React, { useEffect, useMemo, useState } from "react";
import styles from "./livegame.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const otherSide = (pos) => (Number(pos) === 1 ? 2 : 1);

export const isDesignationState = (gs) => !!(gs
  && gs.otherGameData?.designate_piece_type === true
  && !gs.gameType?.simultaneous_turns);

const keyOf = (forAction, mover) => `${forAction}:${mover}`;

/**
 * The choice for the action about to be played, and everything the page needs
 * to show it. `captureActionPieceId` is LiveGame's pending capture action: a
 * continuation of the move just made, not a new action.
 */
export function useDesignation({ gameState, gameId, captureActionPieceId, onGameEvent, designationSync, designatePieceType, onClock }) {
  const enabled = isDesignationState(gameState);
  const live = gameState?.status === 'active' || gameState?.status === 'ready';
  const forAction = Array.isArray(gameState?.moveHistory) ? gameState.moveHistory.length : 0;
  const mover = Number(gameState?.currentTurn);
  const key = enabled && live ? keyOf(forAction, mover) : null;

  // The server's latest word, for whichever action it was about.
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    return onGameEvent("designationStatus", (data) => {
      if (parseInt(data?.gameId) !== parseInt(gameId)) return;
      // The server's clocks, and whose is running: the chooser's while a
      // choice is due, the mover's once it is made.
      if (data.playerTimes && onClock) onClock(data.playerTimes, data.needsChoice ? data.chooser : data.mover);
      setStatus(data);
    });
  }, [enabled, onGameEvent, gameId, onClock]);

  // A new action (or a fresh load): ask about it. This is also what makes a
  // bot choose for its opponent.
  useEffect(() => {
    if (key) designationSync(parseInt(gameId));
  }, [key, gameId, designationSync]);

  const serverSays = status && keyOf(status.forAction, status.mover) === key ? status : null;
  const d = serverSays ? serverSays.designation : gameState?.designation;
  const dForNow = d && keyOf(d.forAction, d.mover) === key ? d : null;

  let needsChoice = false;
  if (key) {
    needsChoice = serverSays
      ? !!serverSays.needsChoice
      : !dForNow
        && !gameState?.repositionPhase?.active
        && captureActionPieceId == null
        && gameState?.chainCapturePieceId == null
        && gameState?.captureActionsPieceId == null
        && gameState?.rangedCaptureActionsPieceId == null;
  }

  const log = status?.designationLog || gameState?.designationLog;
  const choices = needsChoice && serverSays?.choices ? serverSays.choices : null;
  const designation = !needsChoice && dForNow && dForNow.pieceId != null ? dForNow : null;

  // One object per change, so the handlers that read it are not rebuilt on
  // every render.
  return useMemo(() => ({
    enabled,
    key,
    needsChoice,
    chooser: needsChoice ? otherSide(mover) : null,
    mover: key ? mover : null,
    // The type in force for this action, or null (none chosen / free move).
    designation,
    choices,
    log: log || [],
    choose: (pieceId) => designatePieceType(parseInt(gameId), pieceId),
  }), [enabled, key, needsChoice, mover, designation, choices, log, designatePieceType, gameId]);
}

/*
 * Why this piece may not be picked up now, or null. `movesOf(piece)` returns
 * the piece's moves as the board computes them. A piece of another type may
 * move when no piece of the chosen type can - the server applies the same
 * rule.
 */
export function designationBlockReason(dz, piece, myPieces, movesOf) {
  if (!dz?.enabled || !piece) return null;
  if (dz.needsChoice) return "Waiting for your opponent to choose which piece type you must move.";
  const d = dz.designation;
  if (!d || Number(piece.piece_id) === Number(d.pieceId)) return null;
  const typeCanMove = (myPieces || []).some(
    (p) => Number(p.piece_id) === Number(d.pieceId) && (movesOf(p) || []).length > 0
  );
  return typeCanMove ? `You must move a ${d.pieceName || 'piece of the chosen type'} this action.` : null;
}

const imageOf = (choice, forPlayer) => {
  if (choice?.image) return choice.image.startsWith('http') ? choice.image : `${ASSET_URL}${choice.image}`;
  if (choice?.imageLocation) {
    try {
      const arr = JSON.parse(choice.imageLocation);
      if (Array.isArray(arr) && arr.length) {
        const p = arr[Math.min(forPlayer === 2 ? 1 : 0, arr.length - 1)];
        if (p.startsWith('http')) return p;
        return p.startsWith('/') ? `${ASSET_URL}${p}` : `${ASSET_URL}/uploads/pieces/${p}`;
      }
    } catch { /* not JSON */ }
  }
  return null;
};

const bannerStyle = { background: 'rgba(117, 124, 252, 0.18)', color: '#c8ccff', display: 'flex', alignItems: 'center', gap: 8 };

/*
 * The banner under the turn line, and - for the chooser - the list of types
 * to choose from. The list can be hidden to look at the board; the clock keeps
 * running.
 */
export function DesignationPanel({ dz, myPosition }) {
  const [hidden, setHidden] = useState(false);
  const [sent, setSent] = useState(null);
  const choosing = !!(dz?.needsChoice && myPosition != null && dz.chooser === myPosition);
  const turnKey = dz?.needsChoice ? dz.key : null;

  // A new choice to make: show the list again.
  useEffect(() => { setHidden(false); setSent(null); }, [turnKey]);

  if (!dz?.enabled || dz.mover == null) return null;

  let banner;
  if (dz.needsChoice) {
    if (choosing) {
      banner = (
        <>
          Choose which piece type your opponent must move.
          {hidden && (
            <button type="button" className={styles["minimize-button"]} style={{ padding: '2px 10px' }} onClick={() => setHidden(false)}>
              Choose
            </button>
          )}
        </>
      );
    } else if (dz.mover === myPosition) {
      banner = 'Waiting for your opponent to choose which piece type you must move…';
    } else {
      banner = `Player ${dz.chooser} is choosing which piece type Player ${dz.mover} must move…`;
    }
  } else if (dz.designation) {
    const name = dz.designation.pieceName || 'piece';
    banner = dz.mover === myPosition
      ? <>You must move a <strong>{name}</strong> if one can move.</>
      : <>{dz.chooser == null && myPosition === otherSide(dz.mover) ? 'Your opponent' : `Player ${dz.mover}`} must move a <strong>{name}</strong> if one can move.</>;
  } else {
    return null;
  }

  const choices = dz.choices;
  return (
    <>
      <span className={styles["move-error"]} style={bannerStyle}>{banner}</span>
      {choosing && !hidden && (
        <div className={styles["promotion-modal-overlay"]}>
          <div className={styles["promotion-modal"]} onClick={(e) => e.stopPropagation()}>
            <h3>Choose a piece type</h3>
            {!choices ? (
              <p>Loading the piece types…</p>
            ) : choices.length === 0 ? (
              <p>Your opponent has no pieces to choose from, so they may move freely.</p>
            ) : (
              <p>Your opponent must move a piece of this type, if one can move. Your clock is running.</p>
            )}
            {choices && choices.length > 0 && (
              <div className={styles["promotion-options"]}>
                {choices.map((c) => {
                  const src = imageOf(c, dz.mover);
                  return (
                    <button
                      key={c.pieceId}
                      type="button"
                      className={styles["promotion-option"]}
                      disabled={sent != null}
                      title={c.name}
                      onClick={() => { setSent(c.pieceId); dz.choose(c.pieceId); }}
                    >
                      {src ? <img src={src} alt={c.name} draggable={false} /> : <span className={styles["piece-name"]}>?</span>}
                      <span className={styles["piece-label"]}>{c.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className={styles["promotion-modal-actions"]}>
              {choices && choices.length === 0 && (
                <button type="button" className={styles["minimize-button"]} disabled={sent != null} onClick={() => { setSent('none'); dz.choose(null); }}>
                  Continue
                </button>
              )}
              <button type="button" className={styles["cancel-button"]} onClick={() => setHidden(true)}>
                Look at the board
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/*
 * The type that was chosen for one move in the move history, shown before
 * the move: "Knight › Nf3". Placements and passes were free, so the tag says
 * what was chosen, not what moved.
 */
export function DesignationTag({ log, index, move }) {
  if (!Array.isArray(log) || !log.length || !move) return null;
  const entry = log.find((e) => e.forAction === index && (move.position == null || Number(e.mover) === Number(move.position)));
  if (!entry) return null;
  const name = entry.pieceName || 'any';
  return (
    <span
      title={`Player ${entry.chooser} chose: ${entry.pieceName || 'no type (nothing to choose)'}`}
      style={{ fontSize: '0.75em', opacity: 0.7, marginRight: 4 }}
    >
      {name} ›
    </span>
  );
}
