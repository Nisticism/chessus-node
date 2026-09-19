/*
 * How many answers does a puzzle have, and is the one it records the shortest?
 *
 * WHY THIS IS A SEPARATE QUESTION FROM VALIDATION
 *
 * validatePuzzle answers "can this line be played, and does it reach the goal".
 * For a one-move puzzle it also answers "is it the only move", because that is
 * one enumeration. For anything longer it deliberately does not: the note at the
 * top of puzzle-validation.js explains that a stored line scripts ONE defence,
 * so whether the opponent could have defended better is the creator's call.
 *
 * That was the right call for judging a line. It is the wrong call for the
 * question a creator actually wants answered, which is "is my mate in two
 * really a mate in two, and is my move the only one that does it". Both halves
 * are decidable - they are just a search, and a search nobody had written.
 *
 * WHAT IT ESTABLISHES
 *
 *   MINIMAL DEPTH   the fewest of the solver's moves in which the goal can be
 *                   forced. Found by iterative deepening, so "the minimum is 3"
 *                   means 1 and 2 were both searched and neither worked - not
 *                   that 3 was the first thing tried.
 *
 *   SOLUTIONS       every first move that forces the goal in that many moves.
 *                   One is a unique puzzle. More than one is not wrong, but the
 *                   creator should know, and a solver may legitimately find any
 *                   of them.
 *
 * FORCED means what it says: every reply the opponent has must still leave a
 * win. That is an AND over their moves and an OR over ours, and it is the whole
 * difference between a proof and a line that happened to work once against the
 * defence somebody played.
 *
 * HONEST ABOUT ITS LIMITS. The work is the opponent's branching to the power of
 * the depth, so it is budgeted in ENGINE CALLS - every applyPly, wherever it
 * happens. When the budget runs out it says so, and a negative result under an
 * exhausted budget means "not found", never "does not exist". Callers must not
 * flatten that distinction: a puzzle that could not be checked is not a puzzle
 * that failed.
 */

const {
  buildGameState, applyPly, goalMet, terminalOutcome, MECHANICAL_GOALS,
} = require('./puzzle-validation');
const { getAllLegalMovesForPlayer } = require('./game-socket');

const other = (n) => (Number(n) === 1 ? 2 : 1);
const sq = (p) => `(${p.x},${p.y})`;

const cloneState = (state) => ({
  ...state,
  pieces: JSON.parse(JSON.stringify(state.pieces)),
  moveHistory: [],
});

/**
 * Did this position meet the GOAL?
 *
 * The goal, and nothing else. terminalOutcome also reports stalemate, whose
 * winner is null, so an `||` against it would let a checkmate puzzle accept a
 * draw - which is exactly what happened to two puzzles before this was pinned
 * down. A terminal outcome counts only as a WIN FOR THIS PLAYER.
 */
const meetsGoal = (state, player, res, goal) => {
  if (goalMet(goal, state, player, res)) return true;
  const term = terminalOutcome(state, other(player), res);
  return !!(term && Number(term.winner) === Number(player));
};

/**
 * Run a uniqueness analysis.
 *
 * @param {object} rules    { game, pieces, placements } - the puzzle's own rules
 * @param {object} puzzle   needs position (already hydrated), side_to_move,
 *                          setup_move, goal, game_type_id, initial_pieces
 * @param {object} opts     { maxDepth = 3, budget = 250000 }
 * @returns {Promise<object>} see the shape below
 */
async function analyseUniqueness(rules, puzzle, opts = {}) {
  const maxDepth = Math.max(1, Math.min(Number(opts.maxDepth) || 3, 6));
  const budget = Math.max(1000, Number(opts.budget) || 250000);
  const side = Number(puzzle.side_to_move);
  const goal = puzzle.goal;

  const base = {
    verdict: 'unchecked',
    goal,
    minimalDepth: null,
    solutions: [],
    solutionCount: 0,
    unique: null,
    budgetExhausted: false,
    engineCalls: 0,
    maxDepthSearched: 0,
  };

  if (!MECHANICAL_GOALS.has(goal)) {
    return {
      ...base,
      verdict: 'not_mechanical',
      note: 'This goal is judged by the people solving it, not by the engine, so '
        + '"how many answers" is not a question the engine can settle.',
    };
  }

  let engineCalls = 0;
  let exhausted = false;
  const spend = () => {
    engineCalls++;
    if (engineCalls > budget) exhausted = true;
    return !exhausted;
  };

  const apply = async (state, move) => {
    if (!spend()) return null;
    const next = cloneState(state);
    const res = await applyPly(next, move, { autoPromote: false });
    return res.ok ? { state: next, res } : null;
  };

  /** Every move a player has, each promotion choice its own candidate. */
  const movesFor = async (state, player) => {
    const candidates = getAllLegalMovesForPlayer(state, player) || [];
    const out = [];
    for (const cand of candidates) {
      if (exhausted) return out;
      if (!spend()) return out;
      const probe = cloneState(state);
      probe.currentTurn = player;
      // eslint-disable-next-line no-await-in-loop -- the engine mutates its input
      const first = await applyPly(probe, cand, { autoPromote: false });
      if (first.needsPromotionChoice) {
        for (const o of (first.promotionEligible?.options || [])) {
          out.push({
            move: { ...cand, promotionPieceId: o.id ?? o.piece_id,
              ...(o.player != null ? { promotionPlayer: o.player } : {}) },
            label: `${sq(cand.from)}→${sq(cand.to)}=${o.piece_name}`,
          });
        }
      } else if (first.ok) {
        out.push({ move: cand, label: `${sq(cand.from)}→${sq(cand.to)}` });
      }
    }
    return out;
  };

  /**
   * Does THIS move of the solver's force the goal, given `movesLeft` moves in
   * total (this one included)?
   *
   * Three ways it can, and the third is the one a first version missed:
   *
   *   1. the move itself meets the goal;
   *   2. the opponent has no reply at all and the position is already a win;
   *   3. EVERY reply the opponent has either meets the goal by itself, or
   *      leaves a position the solver can still force from.
   *
   * (3) is what a bait is. In a forced-capture game you offer a piece where
   * taking it is the only legal move and taking it is what loses - so the goal
   * is met by the OPPONENT's move, not yours, and a search that only asks
   * "did my move win" reports a perfectly good puzzle as having no solution.
   * That is what it did to the antichess bait: "no forced win within 1 move"
   * about a puzzle whose whole idea is that their move is the win.
   */
  const moveWins = async (state, move, movesLeft) => {
    const played = await apply({ ...state, currentTurn: side }, move);
    if (!played) return false;
    if (meetsGoal(played.state, side, played.res, goal)) return true;

    const replies = await movesFor(played.state, other(side));
    // No reply and not a win: whatever this position is, it is not the answer.
    if (!replies.length) return false;

    for (const r of replies) {
      if (exhausted) return false;
      const afterReply = await apply({ ...played.state, currentTurn: other(side) }, r.move);
      if (!afterReply) continue;
      // Their own move handed it over.
      if (meetsGoal(afterReply.state, side, afterReply.res, goal)) continue;
      // Otherwise the solver needs another move, and has to have one left.
      if (movesLeft <= 1) return false;
      // eslint-disable-next-line no-await-in-loop
      if (!(await canForce(afterReply.state, movesLeft - 1))) return false;
    }
    return true;
  };

  /** Does the solver have ANY move that forces the goal from here? */
  const canForce = async (state, movesLeft) => {
    if (movesLeft <= 0 || exhausted) return false;
    const mine = await movesFor(state, side);
    for (const m of mine) {
      if (exhausted) return false;
      // eslint-disable-next-line no-await-in-loop
      if (await moveWins(state, m.move, movesLeft)) return true;
    }
    return false;
  };

  const root = buildGameState(puzzle, rules.game);

  for (let depth = 1; depth <= maxDepth; depth++) {
    base.maxDepthSearched = depth;
    const first = await movesFor(root, side);
    const winners = [];

    /*
     * Every first move that forces the goal, not just the first one found - the
     * count IS the answer here. Through the same moveWins the recursion uses, so
     * the root and the depths below it cannot disagree about what winning means.
     */
    for (const m of first) {
      if (exhausted) break;
      // eslint-disable-next-line no-await-in-loop
      if (await moveWins(root, m.move, depth)) winners.push(m.label);
    }

    if (winners.length) {
      return {
        ...base,
        verdict: winners.length === 1 ? 'unique' : 'multiple',
        minimalDepth: depth,
        solutions: winners,
        solutionCount: winners.length,
        unique: winners.length === 1,
        budgetExhausted: exhausted,
        engineCalls,
      };
    }
    if (exhausted) break;
  }

  return {
    ...base,
    verdict: exhausted ? 'budget_exhausted' : 'none_found',
    budgetExhausted: exhausted,
    engineCalls,
    note: exhausted
      ? 'The search ran out of budget before it could settle this. Not found is not '
        + 'the same as does not exist.'
      : `No forced win exists within ${maxDepth} of the solver's moves.`,
  };
}

/** One sentence a person can read, from an analysis result. */
function describeUniqueness(result, recordedDepth) {
  if (!result) return '';
  switch (result.verdict) {
    case 'not_mechanical':
      return result.note;
    case 'unique':
      return `Exactly one solution, and it is a ${result.minimalDepth}-move win`
        + `${recordedDepth && recordedDepth !== result.minimalDepth
          ? ` - but this puzzle records a ${recordedDepth}-move line, so a faster answer exists`
          : ''}.`;
    case 'multiple':
      return `${result.solutionCount} different first moves force the goal in `
        + `${result.minimalDepth} ${result.minimalDepth === 1 ? 'move' : 'moves'}`
        + `${recordedDepth && recordedDepth !== result.minimalDepth
          ? `, and this puzzle records a ${recordedDepth}-move line` : ''}.`;
    case 'budget_exhausted':
      return 'Too large to settle within the search budget. This does not mean the '
        + 'puzzle is wrong - only that its uniqueness is unproven.';
    default:
      return `No forced win found within ${result.maxDepthSearched} `
        + `${result.maxDepthSearched === 1 ? 'move' : 'moves'}.`;
  }
}

module.exports = { analyseUniqueness, describeUniqueness, meetsGoal };
