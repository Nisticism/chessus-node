/*
 * Vetoes on the puzzle page (server/puzzle-veto.js has the model).
 *
 * A puzzle in a veto game is answered in steps, not just moves:
 *
 *   pre-emptive  the bot's bans are shown before each of your moves; after
 *                your move you veto up to N of their moves, then they reply
 *   reactive     the bot may veto a move you show - you just choose again; and
 *                each move THEY show, you veto or let through. A reactive
 *                puzzle opens with that decision, on the board before it
 *
 * The server says what comes next ("next") after every step, one thing at a
 * time, so nothing on this page ever holds the answer.
 *
 * Kept out of PuzzleSolver, which is at the size where one more branch trips
 * the hooks lint: it calls usePuzzleVetoes once and renders <VetoPanel>.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from '../../services/axios-interceptor';
import API_URL from '../../global/global';
import authHeader from '../../services/auth-header';
import { colToFile } from '../../helpers/pieceMovementUtils';

const isPlace = (m) => !!m && (m.type === 'place' || m.isPlacement);

/** Same identity as the server's vetoKey: squares, not piece ids. */
export const vetoKey = (m) => {
  if (!m || !m.to) return '';
  if (isPlace(m)) return `place:${m.to.x},${m.to.y}`;
  const parts = [`${m.from ? m.from.x : '?'},${m.from ? m.from.y : '?'}>${m.to.x},${m.to.y}`];
  if (m.isRangedAttack) parts.push('r');
  if (m.isCastling) parts.push('c');
  if (m.via) parts.push(`v${m.via.x},${m.via.y}`);
  return parts.join('|');
};

const squareName = (s, boardHeight) => `${colToFile(s.x)}${boardHeight - s.y}`;

/** "e2 → e4", or "placing on d5". */
export const vetoName = (m, boardHeight) => (isPlace(m)
  ? `placing on ${squareName(m.to, boardHeight)}`
  : `${squareName(m.from, boardHeight)} → ${squareName(m.to, boardHeight)}`);

/** A move as a veto: its squares and the flags that make it a different move. */
const asVeto = (from, move) => {
  const out = { from: { x: from.x, y: from.y }, to: { x: move.x, y: move.y } };
  if (move.isRangedAttack) out.isRangedAttack = true;
  if (move.isCastling) { out.isCastling = true; if (move.castlingWith != null) out.castlingWith = move.castlingWith; }
  if (move.via) out.via = { x: move.via.x, y: move.via.y };
  return out;
};

/*
 * `ui` is how the page is changed: its setters, and the helpers that apply a
 * ply to its board. Passed in so this can finish a step the same way the
 * page's own submit finishes a move.
 */
export function usePuzzleVetoes({ puzzle, puzzleId, startedAt, moveEngine, enginePieces, boardWidth, boardHeight, placesPieces, ui }) {
  const cfg = puzzle?.veto || null;
  const [steps, setSteps] = useState([]);
  const [next, setNext] = useState(null);
  const [picks, setPicks] = useState([]);
  const [pickFrom, setPickFrom] = useState(null);
  const [notice, setNotice] = useState(null);
  // A reactive puzzle's opening, sent with the answer (it is not in the line).
  const [opening, setOpening] = useState(null);

  // A fresh puzzle starts from what the server said first.
  useEffect(() => {
    setSteps([]);
    setNext(puzzle?.veto?.next || null);
    setPicks([]);
    setPickFrom(null);
    setNotice(null);
  }, [puzzle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const expect = cfg ? (next?.expect || null) : null;
  const side = Number(puzzle?.side_to_move) || 1;
  const opponent = side === 1 ? 2 : 1;

  // The moves of the opponent piece being picked for a veto.
  const pickDots = useMemo(() => {
    if (!pickFrom || expect !== 'veto' || !moveEngine) return [];
    return moveEngine.calculateValidMoves(pickFrom, enginePieces, boardWidth, boardHeight, false, false, false, false) || [];
  }, [pickFrom, expect, moveEngine, enginePieces, boardWidth, boardHeight]);

  const togglePick = useCallback((m) => {
    const k = vetoKey(m);
    setPicks((prev) => {
      if (prev.some((p) => vetoKey(p) === k)) return prev.filter((p) => vetoKey(p) !== k);
      if (prev.length >= (cfg?.perTurn || 1)) {
        setNotice(`You can veto at most ${cfg?.perTurn || 1} move${(cfg?.perTurn || 1) === 1 ? '' : 's'} per turn.`);
        return prev;
      }
      setNotice(null);
      return [...prev, m];
    });
  }, [cfg]);

  /*
   * A click on the board, when it belongs to a veto rather than to a move.
   * Returns true when it was used. While a decision is pending the board is
   * read-only: the answer is one of the two buttons.
   */
  const handleClick = useCallback((x, y) => {
    if (!cfg) return false;
    if (expect === 'decide') return true;
    if (expect !== 'veto') return false;
    if (pickFrom) {
      const m = pickDots.find((d) => d.x === x && d.y === y && !d.isPotentialCapture);
      if (m) { togglePick(asVeto(pickFrom, m)); setPickFrom(null); return true; }
    }
    const piece = enginePieces.find((p) => p.x === x && p.y === y);
    if (piece && Number(piece.player_id) === opponent) {
      setPickFrom(pickFrom?.id === piece.id ? null : piece);
      return true;
    }
    if (!piece && placesPieces && !cfg.disallowPlacement) {
      togglePick({ type: 'place', to: { x, y } });
      return true;
    }
    setPickFrom(null);
    return true;
  }, [cfg, expect, pickFrom, pickDots, enginePieces, opponent, placesPieces, togglePick]);

  /* ----- moves: the page's own submit asks these two ----------------------- */

  const moveBody = useCallback((move) => ({
    steps: [...steps, { kind: 'move', move }],
    duration_ms: Date.now() - startedAt,
  }), [steps, startedAt]);

  /*
   * After the server judged a move. Returns true when the bot VETOED it (a
   * reactive game): the page puts the piece back and the solver chooses
   * again - nothing was recorded, nothing is lost.
   */
  const afterMove = useCallback((data, move) => {
    if (!cfg) return false;
    if (data?.veto?.opening !== undefined) setOpening(data.veto.opening);
    if (data?.status === 'vetoed') {
      setNotice('The bot vetoed that move. Choose another - that costs nothing.');
      if (data.veto?.next) setNext(data.veto.next);
      return true;
    }
    setNotice(null);
    // A wrong move leaves the prompt as it was: they try the same step again.
    if (data?.status === 'continue' || data?.solved) {
      setSteps((prev) => [...prev, { kind: 'move', move }]);
      setNext(data?.veto?.next || null);
    }
    return false;
  }, [cfg]);

  /* ----- vetoes and decisions: sent from the panel ------------------------- */

  const send = useCallback(async (step) => {
    const sent = [...steps, step];
    ui.setBusy(true);
    try {
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzleId}/solve`,
        { steps: sent, duration_ms: Date.now() - startedAt },
        { headers: authHeader() }
      );
      if (data.rating) ui.setRatingChange(data.rating);
      else if (data.ratingNote) ui.setRatingNote(data.ratingNote);
      if (Number.isFinite(data.movesTotal)) ui.setProgress({ played: data.movesPlayed || 0, total: data.movesTotal });
      setPicks([]);
      setPickFrom(null);
      setNotice(null);

      if (data.status === 'wrong') {
        ui.setAttempts((n) => n + 1);
        ui.setOutcome('wrong');
        return;
      }
      setSteps(sent);
      setNext(data.veto?.next || null);
      if (data.veto?.opening !== undefined) setOpening(data.veto.opening);
      // The move their turn ended with, played in the way every reply is.
      if (data.reply) {
        ui.playReply(data.reply, data.position);
      } else if (data.position) {
        ui.setPlacements(ui.fromServerPosition(data.position));
      }
      if (data.veto?.setupMove) ui.setSetupMove(data.veto.setupMove);
      if (data.solved) {
        ui.setSolution(data.solution || null);
        ui.setOutcome('solved');
      } else {
        ui.setOutcome('continue');
      }
    } catch (err) {
      ui.setError(err?.response?.data?.message || 'Could not submit that');
    } finally {
      ui.setBusy(false);
    }
  }, [steps, puzzleId, startedAt, ui]);

  const submitVeto = useCallback((none = false) => send({ kind: 'veto', vetoes: none ? [] : picks }), [send, picks]);
  const decide = useCallback((veto) => send({ kind: 'decide', veto: !!veto }), [send]);

  const revealBody = useCallback(
    () => ({ steps, revealed: true, duration_ms: Date.now() - startedAt }),
    [steps, startedAt]
  );

  const reset = useCallback(() => {
    setSteps([]);
    setNext(puzzle?.veto?.next || null);
    setPicks([]);
    setPickFrom(null);
    setNotice(null);
  }, [puzzle]);

  /*
   * What a square shows for the vetoes: the bot's bans (pre-emptive), the
   * move the opponent is showing (reactive), the moves picked so far, and the
   * opponent piece being picked from.
   */
  const squareMarks = useCallback((x, y) => {
    if (!cfg) return [];
    const at = (s) => s && Number(s.x) === x && Number(s.y) === y;
    const marks = [];
    if (expect === 'move') {
      for (const b of (next?.banned || [])) {
        if (at(b.to)) marks.push('veto-banned-to');
        else if (at(b.from)) marks.push('veto-banned-from');
      }
    }
    if (expect === 'decide' && next?.proposal) {
      if (at(next.proposal.to)) marks.push('veto-proposal-to');
      else if (at(next.proposal.from)) marks.push('veto-proposal-from');
    }
    if (expect === 'veto') {
      for (const p of picks) {
        if (at(p.to)) marks.push('veto-picked-to');
        else if (at(p.from)) marks.push('veto-picked-from');
      }
      if (pickFrom && pickFrom.x === x && pickFrom.y === y) marks.push('veto-picking');
    }
    return marks;
  }, [cfg, expect, next, picks, pickFrom]);

  return {
    active: !!cfg,
    cfg,
    placesPieces: !!placesPieces,
    opening,
    expect,
    next,
    steps,
    picks,
    notice,
    pickDots,
    // True while the page is waiting on a veto or a decision, not a move.
    awaiting: expect === 'veto' || expect === 'decide',
    handleClick,
    moveBody,
    afterMove,
    submitVeto,
    decide,
    removePick: (m) => setPicks((prev) => prev.filter((p) => vetoKey(p) !== vetoKey(m))),
    reset,
    squareMarks,
    revealBody,
  };
}

/** The veto half of the side panel. */
export function VetoPanel({ vet, busy, finished, boardHeight, styles }) {
  if (!vet.active || finished) return null;
  const { cfg, expect, next, picks, notice, steps } = vet;
  const reactive = cfg.style === 'reactive';
  return (
    <div className={`${styles["notice"]} ${styles["notice-info"]} ${styles["veto-panel"]}`}>
      <strong>{reactive ? 'Reactive vetoes' : 'Pre-emptive vetoes'}</strong>
      {cfg.steps > 0 && (
        <span className={styles["veto-progress"]}> · step {Math.min((steps.length || 0) + 1, cfg.steps)} of {cfg.steps}</span>
      )}

      {expect === 'move' && !reactive && (
        next?.banned?.length ? (
          <p>
            The bot has vetoed {next.banned.map((b) => vetoName(b, boardHeight)).join(', ')}
            {' '}— marked on the board. You cannot play {next.banned.length === 1 ? 'it' : 'them'}.
          </p>
        ) : <p>The bot vetoed nothing this turn. Make your move.</p>
      )}
      {expect === 'move' && reactive && (
        <p>Make your move. The bot may veto it; if it does, choose another — that costs nothing.</p>
      )}

      {expect === 'veto' && (
        <>
          <p>
            Now veto up to {cfg.perTurn} of their move{cfg.perTurn === 1 ? '' : 's'}: click one of their pieces,
            then the square it could go to.{vet.placesPieces && !cfg.disallowPlacement ? ' To ban placing a piece, click an empty square.' : ''}
          </p>
          {picks.length > 0 && (
            <ul className={styles["veto-picks"]}>
              {picks.map((p) => (
                <li key={vetoKey(p)}>
                  {vetoName(p, boardHeight)}
                  <button type="button" className={styles["veto-remove"]} onClick={() => vet.removePick(p)} aria-label="Remove this veto">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles["veto-actions"]}>
            <button type="button" className={styles["btn"]} disabled={busy || !picks.length} onClick={() => vet.submitVeto(false)}>
              Submit veto
            </button>
            <button type="button" className={styles["btn-secondary"]} disabled={busy} onClick={() => vet.submitVeto(true)}>
              Veto nothing
            </button>
          </div>
        </>
      )}

      {expect === 'decide' && next?.proposal && (
        <>
          <p>
            {next.opening ? 'Your opponent wants to play ' : 'They want to play '}
            <strong>{vetoName(next.proposal, boardHeight)}</strong> — marked on the board. Veto it, or let it be played?
          </p>
          <div className={styles["veto-actions"]}>
            <button type="button" className={styles["btn"]} disabled={busy} onClick={() => vet.decide(true)}>Veto it</button>
            <button type="button" className={styles["btn-secondary"]} disabled={busy} onClick={() => vet.decide(false)}>Let it be played</button>
          </div>
        </>
      )}

      {notice && <p className={styles["veto-notice"]}>{notice}</p>}
    </div>
  );
}

/*
 * Three small pieces of the puzzle page's panel, here rather than inline so
 * PuzzleSolver stays under the hooks lint's path limit. Each is what the page
 * showed before, with the veto case folded in.
 */

/** "That's it - keep going", unless a veto or a decision is due first. */
export function ContinueNotice({ outcome, vet, styles }) {
  if (outcome !== 'continue' || vet.awaiting) return null;
  return (
    <div className={`${styles["notice"]} ${styles["notice-ok"]}`}>
      That's it. Your opponent has answered — keep going.
    </div>
  );
}

/** "Move 2 of 3". Only worth showing once there is more than one move to find;
 * a veto puzzle counts its steps in the veto panel instead. */
export function MoveProgress({ movesToFind, progress, finished, vet, styles }) {
  if (movesToFind <= 1 || finished || vet.active) return null;
  return (
    <div className={styles["progress"]}>
      Move <strong>{(progress?.played || 0) + 1}</strong> of {movesToFind}
    </div>
  );
}

/** What to click next, while a move is what is wanted. */
export function MoveHint({ outcome, selected, vet, styles }) {
  if (outcome === 'solved' || outcome === 'revealed' || vet.awaiting) return null;
  return (
    <p className={styles["hint"]}>
      {selected ? 'Now click where it should go.' : 'Click the piece you want to move.'}
    </p>
  );
}

/*
 * The vetoes in a finished or revealed answer, since they are part of it:
 * which moves were banned, which the solver should have vetoed, and - for a
 * reactive puzzle - how its opening went.
 */
export function VetoAnswer({ vet, solution, outcome, boardHeight, styles }) {
  if (!vet.active || (outcome !== 'revealed' && outcome !== 'solved') || !Array.isArray(solution)) return null;
  const reactive = vet.cfg.style === 'reactive';
  const names = (list) => list.map((m) => vetoName(m, boardHeight)).join(', ');
  const rows = [];
  if (vet.opening?.move) {
    rows.push(vet.opening.vetoes?.length
      ? `Their opening: veto ${names(vet.opening.vetoes)}, then let ${vetoName(vet.opening.move, boardHeight)} be played.`
      : `Their opening: let ${vetoName(vet.opening.move, boardHeight)} be played.`);
  }
  solution.forEach((ply, i) => {
    const list = ply?.vetoes || [];
    const yours = i % 2 === 0;
    const turn = `${yours ? 'Your move' : 'Their reply'} ${Math.floor(i / 2) + 1}`;
    if (!list.length) {
      if (!yours && !reactive) rows.push(`${turn}: you veto nothing.`);
      return;
    }
    if (reactive) {
      rows.push(yours
        ? `${turn}: the bot vetoes ${names(list)} if you show ${list.length === 1 ? 'it' : 'them'}.`
        : `${turn}: veto ${names(list)}, then let their move be played.`);
    } else {
      rows.push(yours ? `${turn}: the bot has vetoed ${names(list)}.` : `${turn}: you veto ${names(list)}.`);
    }
  });
  if (!rows.length) return null;
  return (
    <div className={`${styles["notice"]} ${styles["notice-info"]}`}>
      The vetoes in the answer:
      <ul className={styles["veto-picks"]}>
        {rows.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </div>
  );
}
