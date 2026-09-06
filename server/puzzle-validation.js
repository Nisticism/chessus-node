/*
 * Puzzle validation.
 *
 * Deliberately narrow. Mate in 1 is the one goal the server can judge, because
 * "is the opponent mated?" is a question the move engine already answers. For
 * that goal every legal move is enumerated and tested, so a creator is told when
 * some other piece also mates - which they genuinely cannot eyeball on a site
 * where the pieces are user-defined.
 *
 * A line longer than one move cannot be judged either: the opponent's replies
 * are the creator's script, not an engine's best defence, so "is this forced?"
 * is not a question there is anything to ask. What IS checked is that every
 * move in the line is legal from the position the one before it leaves behind -
 * which catches the common authoring slip of recording a move that the piece
 * cannot actually make - and whether the line happens to end in mate.
 *
 * Every other goal is the creator's declaration. A puzzle does not have to win
 * the game; winning material is a puzzle too, and there is no general way to
 * score that yet. Those come back as 'not_checkable' and are refined by the
 * people solving them.
 *
 * NOTHING HERE BLOCKS PUBLISHING. The result is advice for the creator. A puzzle
 * with two mates is still a puzzle; the creator decides whether to fix it.
 *
 * The move engine is reused wholesale from game-socket.js (already exported as
 * pure functions for the AI), so a puzzle is judged by exactly the same rules as
 * a live game. No second implementation to drift.
 */
const {
  getAllLegalMovesForPlayer,
  validateAndApplyMove,
  isCheckmate,
} = require('./game-socket');

const GOALS = {
  CHECKMATE_IN_1: 'checkmate_in_1',
  WIN_MATERIAL: 'win_material',
  SPECIFIC_MOVE: 'specific_move',
  CUSTOM: 'custom',
};

/** Only this one can be decided by the server today. */
const MECHANICAL_GOALS = new Set([GOALS.CHECKMATE_IN_1]);

const VALIDATION = {
  VALID: 'valid',
  AMBIGUOUS: 'ambiguous',
  UNSOLVABLE: 'unsolvable',
  NOT_CHECKABLE: 'not_checkable',
};

/** Stable identity for a move, so two descriptions of the same move compare equal. */
function moveKey(move) {
  if (!move) return '';
  const from = move.from ? `${move.from.x},${move.from.y}` : '?';
  const to = move.to ? `${move.to.x},${move.to.y}` : '?';
  const extra = [
    move.pieceId ?? '',
    move.isRangedAttack ? 'R' : '',
    move.isCastling ? `C${move.castlingWith ?? ''}` : '',
    move.via ? `V${move.via.x},${move.via.y}` : '',
    move.promotionPieceId ? `P${move.promotionPieceId}` : '',
  ].filter(Boolean).join('|');
  return `${from}>${to}${extra ? '#' + extra : ''}`;
}

/** A puzzle is solved from a game-shaped state; build one the engine accepts. */
function buildGameState(puzzle, gameType) {
  return {
    // Deep-copied per candidate move: validateAndApplyMove mutates.
    pieces: JSON.parse(JSON.stringify(puzzle.position)),
    gameType,
    currentTurn: puzzle.side_to_move,
    status: 'active',
    moveHistory: [],
    players: [
      { id: 'puzzle_p1', position: 1, username: 'Player 1' },
      { id: 'puzzle_p2', position: 2, username: 'Player 2' },
    ],
    // No clocks, no vetoes, no premoves - a puzzle is a position, not a game.
    timeControl: null,
    otherGameData: gameType?.other_game_data || {},
  };
}

/**
 * Apply a move to a fresh copy of the position.
 * Returns { ok, state, reason } - state is post-move when ok.
 */
async function applyToFreshState(puzzle, gameType, move) {
  const state = buildGameState(puzzle, gameType);
  let applied;
  try {
    applied = await validateAndApplyMove(state, move, { skipTurnCheck: true });
  } catch (err) {
    return { ok: false, state: null, reason: `engine rejected the move: ${err.message}` };
  }
  if (applied && applied.valid === false) {
    return { ok: false, state: null, reason: applied.reason || 'illegal move' };
  }
  return { ok: true, state, reason: null };
}

/**
 * Apply a whole line, ply by ply, to one state.
 *
 * Returns { ok, state, plyIndex, reason }. plyIndex is the move that failed,
 * counted from 0, so a creator can be told WHICH move in the line is wrong
 * rather than just that something is.
 */
async function playLine(puzzle, gameType, line) {
  const state = buildGameState(puzzle, gameType);
  const opponent = puzzle.side_to_move === 1 ? 2 : 1;
  for (let i = 0; i < line.length; i++) {
    /*
     * The engine decides whose piece a move is allowed to touch from
     * gameState.currentTurn, and it does not advance it itself - a live game
     * does that in its own flow. Alternate it by hand or every reply in the
     * line comes back as "Not your piece".
     */
    state.currentTurn = i % 2 === 0 ? puzzle.side_to_move : opponent;
    let applied;
    try {
      // eslint-disable-next-line no-await-in-loop -- strictly sequential: each
      // move is made from the position the previous one left behind.
      applied = await validateAndApplyMove(state, line[i], { skipTurnCheck: true });
    } catch (err) {
      return { ok: false, state, plyIndex: i, reason: `engine rejected the move: ${err.message}` };
    }
    if (applied && applied.valid === false) {
      return { ok: false, state, plyIndex: i, reason: applied.reason || 'illegal move' };
    }
  }
  return { ok: true, state, plyIndex: -1, reason: null };
}

/** Is this move mate? Only meaningful for CHECKMATE_IN_1. */
async function moveIsMate(puzzle, gameType, move) {
  const { ok, state } = await applyToFreshState(puzzle, gameType, move);
  if (!ok) return false;
  const opponent = puzzle.side_to_move === 1 ? 2 : 1;
  return !!isCheckmate(state, opponent);
}

/**
 * Check a puzzle as far as the server is able.
 *
 * Returns { status, solutions, intendedWorks, detail }. Callers should treat a
 * non-VALID status as something to show the creator, never as a reason to
 * refuse the save.
 */
async function validatePuzzle(puzzle, gameType) {
  const line = Array.isArray(puzzle.solution_line) ? puzzle.solution_line : [puzzle.solution_line].filter(Boolean);
  const intended = line[0];
  if (!intended) {
    return { status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false, detail: 'no intended solution recorded' };
  }

  /*
   * A multi-move line: check that it can actually be played, and say whether it
   * finishes with mate. Uniqueness is out of reach - see the note at the top -
   * so this comes back as advice either way.
   */
  if (line.length > 1) {
    const played = await playLine(puzzle, gameType, line);
    if (!played.ok) {
      const which = played.plyIndex % 2 === 0
        ? `your move ${Math.floor(played.plyIndex / 2) + 1}`
        : `the opponent's reply ${Math.floor(played.plyIndex / 2) + 1}`;
      return {
        status: VALIDATION.UNSOLVABLE,
        solutions: [],
        intendedWorks: false,
        detail: `${which} cannot be played: ${played.reason}`,
      };
    }
    const defender = puzzle.side_to_move === 1 ? 2 : 1;
    played.state.currentTurn = defender;
    const endsInMate = !!isCheckmate(played.state, defender);
    const moves = Math.ceil(line.length / 2);
    return {
      status: VALIDATION.NOT_CHECKABLE,
      solutions: [intended],
      intendedWorks: true,
      detail: `the whole ${moves}-move line is legal${endsInMate ? ' and ends in checkmate' : ''}. `
        + 'Whether the opponent could have defended differently is your call - the replies are the ones you wrote.',
      endsInMate,
    };
  }

  // Goals the server cannot score. Confirm the move is at least legal, so a
  // puzzle whose answer cannot be played is still caught, and leave the rest to
  // the solvers.
  if (!MECHANICAL_GOALS.has(puzzle.goal)) {
    const { ok, reason } = await applyToFreshState(puzzle, gameType, intended);
    return {
      status: ok ? VALIDATION.NOT_CHECKABLE : VALIDATION.UNSOLVABLE,
      solutions: ok ? [intended] : [],
      intendedWorks: ok,
      detail: ok
        ? `'${puzzle.goal}' is judged by the creator; the server only confirmed the move is legal`
        : `the recorded solution is not a legal move: ${reason}`,
    };
  }

  const state = buildGameState(puzzle, gameType);
  const candidates = getAllLegalMovesForPlayer(state, puzzle.side_to_move) || [];

  const solutions = [];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- the engine mutates shared
    // structures, so these must not overlap.
    if (await moveIsMate(puzzle, gameType, candidate)) solutions.push(candidate);
  }

  const intendedKey = moveKey(intended);
  const intendedWorks = solutions.some((m) => moveKey(m) === intendedKey);

  if (solutions.length === 0) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions: [],
      intendedWorks: false,
      detail: `no legal move delivers mate (${candidates.length} legal moves examined)`,
    };
  }
  if (!intendedWorks) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions,
      intendedWorks: false,
      detail: `the recorded solution is not mate, though ${solutions.length} other move(s) are`,
    };
  }
  if (solutions.length > 1) {
    const others = solutions.filter((m) => moveKey(m) !== intendedKey).map(moveKey);
    return {
      status: VALIDATION.AMBIGUOUS,
      solutions,
      intendedWorks: true,
      detail: `${solutions.length} moves deliver mate: also ${others.join(', ')}`,
    };
  }
  return { status: VALIDATION.VALID, solutions, intendedWorks: true, detail: null };
}

module.exports = {
  validatePuzzle,
  moveIsMate,
  applyToFreshState,
  moveKey,
  GOALS,
  MECHANICAL_GOALS,
  VALIDATION,
};
