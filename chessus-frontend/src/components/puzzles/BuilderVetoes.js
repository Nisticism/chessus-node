/*
 * Recording vetoes in the puzzle builder (server/puzzle-veto.js has the model).
 *
 * Every ply can carry `vetoes`: moves vetoed against that ply's mover by the
 * other side. The creator records them BEFORE the ply they belong to - "Add
 * vetoes", click the mover's piece and where it could go - and they are
 * attached when that ply is recorded:
 *
 *   pre-emptive  before your move: the bot's veto, shown to the solver
 *                before their reply: the veto the solver must find
 *   reactive     before your move: moves the bot rejects if the solver shows them
 *                before their reply: moves they show first, which the solver
 *                should veto, in the order they are shown
 *
 * In a reactive game the puzzle opens with the solver deciding on "their last
 * move", so the moves they showed before it are recorded on the setup step,
 * on the board as it was before that move.
 *
 * Kept out of PuzzleBuilder, which is too large to take more branches.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from '../../services/axios-interceptor';
import API_URL from '../../global/global';
import authHeader from '../../services/auth-header';
import { vetoKey, vetoName } from './PuzzleVetoes';

const keyOf = (x, y) => `${y},${x}`;

/** The game's veto rules, as the server reads them. */
export const builderVetoConfig = (game) => {
  if (!game || !Number(game.veto_enabled) || Number(game.simultaneous_turns)) return null;
  return {
    style: game.veto_style === 'reactive' ? 'reactive' : 'preemptive',
    perTurn: Math.max(1, Math.min(5, Number(game.veto_per_turn_limit) || 1)),
    disallowPlacement: !!Number(game.veto_disallow_placement),
  };
};

/** The board before the setup move: the moved piece back where it came from. */
const boardBeforeSetup = (cells, setup) => {
  if (!setup?.from || !setup?.to) return cells;
  const next = { ...cells };
  const moved = next[keyOf(setup.to.x, setup.to.y)];
  if (!moved) return cells;
  delete next[keyOf(setup.to.x, setup.to.y)];
  next[keyOf(setup.from.x, setup.from.y)] = moved;
  return next;
};

export function useBuilderVetoes({
  game, gameId, mode, sideToMove, solutionLine, solutionBoard, placements,
  setupMove, setSetupMove, nextSide, lineFull, placesPieces,
}) {
  const cfg = useMemo(() => builderVetoConfig(game), [game]);
  const [pending, setPending] = useState([]);   // for the next ply in the line
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState(null);         // {x, y} of the mover's piece
  const [hints, setHints] = useState([]);
  const [notice, setNotice] = useState(null);

  const other = Number(sideToMove) === 1 ? 2 : 1;
  // Which list is being edited: the setup move's (reactive opening) or the next ply's.
  const target = mode === 'setup' && cfg?.style === 'reactive' && setupMove ? 'setup'
    : mode === 'solution' && !lineFull ? 'line' : null;
  const mover = target === 'setup' ? other : nextSide;
  const board = useMemo(
    () => (target === 'setup' ? boardBeforeSetup(placements, setupMove) : solutionBoard),
    [target, placements, setupMove, solutionBoard]
  );
  const list = useMemo(
    () => (target === 'setup' ? (setupMove?.vetoes || []) : pending),
    [target, setupMove, pending]
  );

  // The next ply changed (one recorded or undone): its vetoes start afresh.
  useEffect(() => { setPending([]); setAdding(false); setSel(null); setHints([]); }, [solutionLine.length, mode]);

  const setList = useCallback((updater) => {
    if (target === 'setup') {
      setSetupMove((prev) => (prev ? { ...prev, vetoes: updater(prev.vetoes || []) } : prev));
    } else {
      setPending(updater);
    }
  }, [target, setSetupMove]);

  const toggle = useCallback((v) => {
    const k = vetoKey(v);
    setList((prev) => {
      if (prev.some((p) => vetoKey(p) === k)) return prev.filter((p) => vetoKey(p) !== k);
      if (prev.length >= (cfg?.perTurn || 1)) {
        setNotice(`This game allows ${cfg?.perTurn || 1} veto${(cfg?.perTurn || 1) === 1 ? '' : 'es'} per turn.`);
        return prev;
      }
      setNotice(null);
      return [...prev, v];
    });
  }, [cfg, setList]);

  const loadHints = useCallback(async (x, y) => {
    const position = Object.entries(board).map(([k, v]) => {
      const [py, px] = k.split(',').map(Number);
      return { ...v, x: px, y: py };
    });
    try {
      const { data } = await axios.post(
        `${API_URL}game-types/${gameId}/puzzle-moves`,
        { position, side_to_move: mover, setup_move: target === 'setup' ? null : setupMove, x, y },
        { headers: authHeader() }
      );
      return (data?.moves || []).filter((m) => !m.isPotentialCapture);
    } catch (_) {
      return [];
    }
  }, [board, gameId, mover, target, setupMove]);

  /*
   * A board click while adding vetoes. Returns true when it was used - which,
   * while adding, is always: the next click that means "record a move" comes
   * after Done.
   */
  const handleClick = useCallback((x, y) => {
    if (!cfg || !adding || !target) return false;
    if (sel) {
      const m = hints.find((h) => Number(h.x) === x && Number(h.y) === y);
      if (m) {
        const v = { from: { x: sel.x, y: sel.y }, to: { x, y } };
        if (m.isRangedAttack) v.isRangedAttack = true;
        if (m.isCastling) v.isCastling = true;
        toggle(v);
        setSel(null); setHints([]);
        return true;
      }
    }
    const here = board[keyOf(x, y)];
    if (here && Number(here.player_id) === Number(mover)) {
      if (sel && sel.x === x && sel.y === y) { setSel(null); setHints([]); return true; }
      setSel({ x, y });
      loadHints(x, y).then(setHints);
      return true;
    }
    if (!here && placesPieces && !cfg.disallowPlacement) {
      toggle({ type: 'place', to: { x, y } });
      return true;
    }
    setSel(null); setHints([]);
    return true;
  }, [cfg, adding, target, sel, hints, board, mover, placesPieces, toggle, loadHints]);

  /** The ply with the pending vetoes on it, when it is recorded. */
  const attach = useCallback((ply) => (target === 'line' && pending.length
    ? { ...ply, vetoes: pending } : ply), [target, pending]);

  const marks = useCallback((x, y) => {
    if (!cfg || !target) return [];
    const at = (s) => s && Number(s.x) === x && Number(s.y) === y;
    const out = [];
    for (const v of list) {
      if (at(v.to)) out.push('veto-to');
      else if (at(v.from)) out.push('veto-from');
    }
    if (sel && sel.x === x && sel.y === y) out.push('veto-sel');
    return out;
  }, [cfg, target, list, sel]);

  return {
    active: !!cfg,
    cfg,
    target,
    mover,
    solverSide: Number(sideToMove),
    adding,
    list,
    hints: adding ? hints : [],
    notice,
    // In a reactive game with the opening decision recorded, the builder's
    // setup step shows the board before their move.
    setupBoard: target === 'setup' && adding ? board : null,
    handleClick,
    attach,
    marks,
    start: () => { setAdding(true); setNotice(null); },
    stop: () => { setAdding(false); setSel(null); setHints([]); },
    remove: (v) => setList((prev) => prev.filter((p) => vetoKey(p) !== vetoKey(v))),
  };
}

/** What the vetoes being recorded mean, and the list so far. */
export function BuilderVetoPanel({ veto, boardHeight, styles }) {
  if (!veto.active || !veto.target) return null;
  const { cfg, target, mover, adding, list, notice } = veto;
  const reactive = cfg.style === 'reactive';
  const solverMoves = target === 'line' && Number(mover) === Number(veto.solverSide);
  let what;
  if (target === 'setup') {
    what = 'The puzzle opens with the solver deciding on their move. Record the moves they showed BEFORE it, in order: the solver should veto each, then let their last move be played. Leave it empty if the right answer is simply to let it through.';
  } else if (!reactive) {
    what = solverMoves
      ? 'The bot’s veto before this move: moves the solver may not play. Shown to the solver.'
      : 'The veto the solver must make before this reply: the moves they should ban. Part of the answer.';
  } else {
    what = solverMoves
      ? 'Moves the bot vetoes if the solver shows them. Hidden; showing one costs the solver nothing.'
      : 'Moves they show before this reply, in order. The solver should veto each, then let the reply be played.';
  }
  return (
    <div className={`${styles["notice"]} ${styles["notice-info"]}`}>
      <strong>{reactive ? 'Reactive vetoes' : 'Pre-emptive vetoes'}</strong> — up to {cfg.perTurn} per turn
      <p style={{ margin: '6px 0' }}>{what}</p>
      {list.length > 0 && (
        <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
          {list.map((v) => (
            <li key={vetoKey(v)}>
              {vetoName(v, boardHeight)}
              <button type="button" className={styles["link-btn"]} onClick={() => veto.remove(v)}>remove</button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <>
          <p style={{ margin: '6px 0' }}>
            Click a Player {mover} piece, then the square it could go to.
          </p>
          <button type="button" className={styles["btn-secondary"]} onClick={veto.stop}>Done adding vetoes</button>
        </>
      ) : (
        <button type="button" className={styles["btn-secondary"]} onClick={veto.start}>Add vetoes</button>
      )}
      {notice && <p style={{ margin: '6px 0', color: '#fbbf24' }}>{notice}</p>}
    </div>
  );
}

/** A recorded ply's vetoes, in the line readout. */
export function PlyVetoNote({ ply, index, cfg, boardHeight, styles }) {
  if (!cfg || !ply?.vetoes?.length) return null;
  const yours = index % 2 === 0;
  const names = ply.vetoes.map((v) => vetoName(v, boardHeight)).join(', ');
  const text = cfg.style === 'reactive'
    ? (yours ? `bot rejects ${names}` : `shows ${names} first (veto)`)
    : (yours ? `bot vetoed ${names}` : `your veto: ${names}`);
  return <span className={styles["ply-castle"]}> · {text}</span>;
}

/** The reactive opening's shown-first moves, beside "Their last move". */
export function SetupVetoNote({ setupMove, cfg, boardHeight }) {
  if (!cfg || cfg.style !== 'reactive' || !setupMove?.vetoes?.length) return null;
  return <> · shown first (veto): {setupMove.vetoes.map((v) => vetoName(v, boardHeight)).join(', ')}</>;
}
