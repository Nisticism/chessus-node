/*
 * Puzzle validation.
 *
 * The point of this module is that "is there exactly one answer?" is COMPUTED,
 * not taken on trust from the creator. Every legal move for the solving side is
 * enumerated and tested against the puzzle's goal; a puzzle with two winning
 * moves is ambiguous and cannot be published, and one with none is unsolvable.
 *
 * That matters more here than on a normal chess site: pieces are user-defined,
 * so a creator genuinely cannot eyeball whether some other piece on the board
 * also delivers mate. Reports from solvers are the backstop for goals the
 * validator cannot express - not the primary way ambiguity is found.
 *
 * The move engine is reused wholesale from game-socket.js (it already exports
 * these as pure functions for the AI), so a puzzle is judged by exactly the same
 * rules as a live game. No second implementation to drift.
 */
const {
  getAllLegalMovesForPlayer,
  validateAndApplyMove,
  isCheckmate,
} = require('./game-socket');

/** Goals the validator can decide mechanically. */
const GOALS = {
  CHECKMATE_IN_1: 'checkmate_in_1',
  SPECIFIC_MOVE: 'specific_move',
};

const VALIDATION = {
  VALID: 'valid',
  AMBIGUOUS: 'ambiguous',
  UNSOLVABLE: 'unsolvable',
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
 * Does this move achieve the puzzle's goal?
 * Returns { achieved, reason } - reason is for the creator, not the solver.
 */
async function moveAchievesGoal(puzzle, gameType, move) {
  const state = buildGameState(puzzle, gameType);
  const opponent = puzzle.side_to_move === 1 ? 2 : 1;

  let applied;
  try {
    applied = await validateAndApplyMove(state, move, { skipTurnCheck: true });
  } catch (err) {
    return { achieved: false, reason: `engine rejected the move: ${err.message}` };
  }
  if (applied && applied.valid === false) {
    return { achieved: false, reason: applied.reason || 'illegal move' };
  }

  switch (puzzle.goal) {
    case GOALS.CHECKMATE_IN_1:
      return { achieved: !!isCheckmate(state, opponent), reason: 'not mate' };
    case GOALS.SPECIFIC_MOVE:
      // The creator nominated one move. Uniqueness is trivially true, so this
      // goal exists for puzzles whose point is not expressible as a win
      // condition ("find the only move that saves the queen"). It is the
      // creator's judgement, and reports are the correction mechanism.
      return { achieved: true, reason: 'creator-nominated move' };
    default:
      return { achieved: false, reason: `unknown goal ${puzzle.goal}` };
  }
}

/**
 * Validate a puzzle by brute force over the solving side's legal moves.
 *
 * Returns:
 *   { status, solutions, intendedWorks, detail }
 *
 * `solutions` is every move that achieves the goal, so an ambiguous puzzle can
 * show the creator exactly what else works rather than just saying "ambiguous".
 */
async function validatePuzzle(puzzle, gameType) {
  const intended = Array.isArray(puzzle.solution_line) ? puzzle.solution_line[0] : puzzle.solution_line;
  if (!intended) {
    return { status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false, detail: 'no intended solution recorded' };
  }

  // SPECIFIC_MOVE is the creator's call by definition; only check it is legal.
  if (puzzle.goal === GOALS.SPECIFIC_MOVE) {
    const check = await moveAchievesGoal(puzzle, gameType, intended);
    return check.achieved
      ? { status: VALIDATION.VALID, solutions: [intended], intendedWorks: true, detail: null }
      : { status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false, detail: check.reason };
  }

  const state = buildGameState(puzzle, gameType);
  const candidates = getAllLegalMovesForPlayer(state, puzzle.side_to_move) || [];

  const solutions = [];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- order does not matter, but the
    // engine mutates shared structures, so these must not overlap.
    const { achieved } = await moveAchievesGoal(puzzle, gameType, candidate);
    if (achieved) solutions.push(candidate);
  }

  const intendedKey = moveKey(intended);
  const intendedWorks = solutions.some((m) => moveKey(m) === intendedKey);

  if (solutions.length === 0) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions: [],
      intendedWorks: false,
      detail: `no legal move achieves ${puzzle.goal} (${candidates.length} legal moves examined)`,
    };
  }
  if (!intendedWorks) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions,
      intendedWorks: false,
      detail: `the recorded solution does not achieve ${puzzle.goal}, though ${solutions.length} other move(s) do`,
    };
  }
  if (solutions.length > 1) {
    const others = solutions.filter((m) => moveKey(m) !== intendedKey).map(moveKey);
    return {
      status: VALIDATION.AMBIGUOUS,
      solutions,
      intendedWorks: true,
      detail: `${solutions.length} moves achieve the goal: also ${others.join(', ')}`,
    };
  }
  return { status: VALIDATION.VALID, solutions, intendedWorks: true, detail: null };
}

module.exports = { validatePuzzle, moveAchievesGoal, moveKey, GOALS, VALIDATION };
